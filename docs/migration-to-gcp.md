---
trace_id: BRD:Epic-1
related_adrs: [ADR-027, ADR-028, ADR-029]
audience: ops
status: v1
last_reviewed: 2026-05-03
---

# Migration runbook: Vercel + Supabase Cloud → GCP

**Audience:** Operators running an Atelier deployment on the reference stack (Vercel + Supabase Cloud per ADR-027) who need to migrate to Google Cloud Platform.

**What this runbook is.** A step-by-step migration guide derived from ADR-029's GCP-portability constraint. Per ADR-029 the reference impl was deliberately built so this migration is **mechanical, not architectural** — there is no rewrite. Each capability swaps to a documented GCP equivalent.

**What this runbook is NOT.** A vendor evaluation, a cost comparison, or a recommendation. ADR-027 picked Vercel + Supabase for v1 ergonomics. This document is for operators who have *decided* to migrate and need to execute.

---

## 1. When to consider migrating

Per ADR-029 §"Re-evaluation triggers":

- **Vendor risk:** Vercel or Supabase deprecates a capability the deployment depends on.
- **Compliance:** Your organization mandates GCP for data-residency / security review reasons.
- **Cost inflection:** Vercel Functions or Supabase Pro pricing crosses an internal threshold.
- **Existing GCP investment:** You already operate other services on GCP and want to consolidate platform ownership.

Migration is **not** triggered by ADR-029 turning over; ADR-029 is the *enabling* constraint, not a recommendation.

---

## 2. Per-capability migration mapping

Source-of-truth is ADR-029. This table reproduces it with concrete migration steps per row.

| Capability | Reference (Vercel + Supabase) | GCP target | Migration step |
|---|---|---|---|
| **Relational datastore** | Supabase Postgres (PG 15+) | Cloud SQL for Postgres 15+ | `pg_dump` source → `pg_restore` target. Apply `supabase/migrations/*.sql` via standard `psql`. No ORM rewrite. |
| **RLS** | Postgres RLS policies | Postgres RLS policies | Migrates as-is with the schema dump. |
| **Identity** | Supabase Auth (signed JWTs) | Identity Platform (signed OIDC JWTs) | Re-issue users via Identity Platform admin API. Set `ATELIER_OIDC_ISSUER` to the Identity Platform issuer URL; `ATELIER_JWT_AUDIENCE` stays the same shape. Atelier verifies via OIDC standard (`scripts/endpoint/lib/jwks-verifier.ts`); no Supabase claim helpers used. |
| **Pub/sub broadcast** | Supabase Realtime (default adapter) | Postgres NOTIFY/LISTEN with WebSocket fan-out | Swap the `BroadcastService` adapter from `scripts/coordination/adapters/supabase-realtime.ts` to a sibling `postgres-notify.ts`. Interface contract in `scripts/coordination/lib/broadcast.ts` is unchanged. See §5 below for the adapter shape. |
| **Vector search** | pgvector on Supabase | pgvector on Cloud SQL | Migrates with the schema dump (pgvector ships in Cloud SQL Postgres 15+). Embedding service stays the same OpenAI-compatible adapter (`scripts/coordination/adapters/openai-compatible-embeddings.ts`) per ADR-041. |
| **Serverless runtime** | Vercel Functions (Node 20) | Cloud Run (Node 20 container) | Build Atelier endpoint as a Docker image. Standard Next.js + Node, no Vercel-specific runtime APIs (enforced by `npm run lint:portability` per ADR-029). Cloud Run autoscaling handles the same workload shape. |
| **Static hosting** | Vercel | Cloud Storage + Cloud CDN | `next build && next export` produces static output (where applicable; SSR routes go to Cloud Run). For full SSR, the Cloud Run image serves both static + dynamic. |
| **Cron** | Vercel Cron | Cloud Scheduler → HTTPS endpoints | Cron handlers are HTTPS endpoints in both. Move the `vercel.json` `crons` block to Cloud Scheduler jobs targeting the same paths. |
| **Observability** | Telemetry table + `/atelier/observability` | Telemetry table + Cloud Logging via OTEL collector | Telemetry table migrates with schema dump. The `/atelier/observability` dashboard works against any Postgres backend. Out-of-band log shipping (if used) wires through OpenTelemetry collector to Cloud Logging. |

---

## 3. Pre-migration checklist

Run before cutover. None of these are optional — skipping any will surface as drift after migration.

- [ ] **Audit `npm run lint:portability` is green on `main`.** This proves the codebase doesn't import `@vercel/edge`, `@vercel/kv`, `@vercel/edge-config`, or call `.rpc(` outside `scripts/coordination/adapters/`. If lint fails, fix the violations before migrating — they're exactly the surfaces that don't have a clean GCP equivalent.
- [ ] **Schema migration dump is reproducible.** `supabase db dump --schema public > schema.sql` produces a file that round-trips through `psql` cleanly against an empty Cloud SQL instance.
- [ ] **All ADRs from `docs/architecture/decisions/` reviewed.** Specifically ADR-027 (you're reversing the stack pick — log a new ADR), ADR-028 (Identity Platform replaces Supabase Auth — log adopter-side decision), ADR-029 (the constraint that makes this possible — confirm it held).
- [ ] **Operator runbook for the target stack drafted.** This runbook covers the migration; you also need a steady-state runbook for the GCP deployment. The shape mirrors `docs/user/tutorials/local-bootstrap.md` and `docs/user/tutorials/first-deploy.md`.
- [ ] **Backup window planned.** Migration includes a brief window where reads serve from the source while writes are paused. Coordinate with your active sessions.

---

## 4. Migration sequence

Per phases. Each phase is atomic — complete one fully before starting the next.

### Phase 1 — Provision GCP resources

```bash
# Cloud SQL for Postgres 15
gcloud sql instances create atelier-prod \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-7680 \
  --region=us-central1 \
  --enable-pgaudit

# Cloud Run service (placeholder; deploy in Phase 4)
gcloud run services create atelier-endpoint \
  --image=gcr.io/PROJECT/atelier-endpoint:v1 \
  --region=us-central1 \
  --no-traffic

# Identity Platform (enable in console; no CLI for initial setup)
# https://console.cloud.google.com/customer-identity
```

Capture: Cloud SQL connection string, Identity Platform OIDC issuer URL, Cloud Run URL.

### Phase 2 — Schema + data migration

```bash
# Source-side dump
supabase db dump --schema public > schema.sql
supabase db dump --data-only > data.sql

# Target-side restore
psql "postgresql://postgres:PASS@CLOUD_SQL_HOST:5432/postgres" \
  -c "CREATE EXTENSION IF NOT EXISTS pgvector;"

psql "postgresql://postgres:PASS@CLOUD_SQL_HOST:5432/postgres" \
  -f schema.sql

psql "postgresql://postgres:PASS@CLOUD_SQL_HOST:5432/postgres" \
  -f data.sql

# Verify row counts match
psql "postgresql://..." -c "SELECT COUNT(*) FROM contributions;"
psql "postgresql://..." -c "SELECT COUNT(*) FROM decisions;"
psql "postgresql://..." -c "SELECT COUNT(*) FROM embeddings;"
```

The ADR-005 append-only `decisions_block_delete` trigger migrates with the schema. RLS policies migrate with the schema.

### Phase 3 — Identity migration

Per-user steps for Identity Platform:

1. Export from Supabase Auth: user list including `id`, `email`, `metadata`.
2. Bulk-import via Identity Platform admin API. Issue a one-time password reset email so users re-authenticate.
3. Map old `auth.uid()` (from Supabase) to new Identity Platform `sub` claim. The `composers.identity_subject` column needs an UPDATE per migrated user — script this from the export/import correlation.

The Atelier endpoint authenticates via `sub` claim (`scripts/endpoint/lib/auth.ts`). Once `composers.identity_subject` aligns with new Identity Platform `sub` values, the rest works unchanged.

### Phase 4 — Adapter swap (broadcast)

Replace `scripts/coordination/adapters/supabase-realtime.ts` with a Postgres NOTIFY/LISTEN adapter implementing the same `BroadcastService` interface (`scripts/coordination/lib/broadcast.ts`).

Reference shape:

```typescript
// scripts/coordination/adapters/postgres-notify.ts
import { Client } from 'pg';
import { type BroadcastService, type BroadcastEnvelope } from '../lib/broadcast.ts';

export function postgresNotifyBroadcast(opts: { databaseUrl: string }): BroadcastService {
  const publishClient = new Client({ connectionString: opts.databaseUrl });
  return {
    async publish(env: BroadcastEnvelope): Promise<void> {
      await publishClient.query(`SELECT pg_notify($1, $2)`, [
        `atelier_project_${env.project_id}_events`,
        JSON.stringify(env),
      ]);
    },
    subscribe(channel, handler) {
      const sub = new Client({ connectionString: opts.databaseUrl });
      sub.connect();
      sub.query(`LISTEN atelier_project_${channel}_events`);
      sub.on('notification', (msg) => handler(JSON.parse(msg.payload!)));
      return () => sub.end();
    },
  };
}
```

Wire in `scripts/coordination/adapters/index.ts` (or wherever the adapter is selected) by reading an env var:

```typescript
const broadcast = process.env.ATELIER_BROADCAST_KIND === 'postgres-notify'
  ? postgresNotifyBroadcast({ databaseUrl: process.env.ATELIER_DATASTORE_URL! })
  : supabaseRealtimeBroadcast({ url: ..., serviceRoleKey: ... });
```

The publish path is fire-and-forget per ADR-005 (broadcast is downstream of the canonical Postgres write). Subscriber side reconciles against canonical state on `degraded=true` reconnects per ARCH 6.8.

### Phase 5 — Build + deploy to Cloud Run

```dockerfile
# Dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 3030
CMD ["npm", "run", "start"]
```

```bash
gcloud builds submit --tag gcr.io/PROJECT/atelier-endpoint:v1
gcloud run deploy atelier-endpoint \
  --image=gcr.io/PROJECT/atelier-endpoint:v1 \
  --region=us-central1 \
  --set-env-vars="ATELIER_DATASTORE_URL=postgresql://...,ATELIER_OIDC_ISSUER=https://...,ATELIER_JWT_AUDIENCE=...,ATELIER_BROADCAST_KIND=postgres-notify"
```

### Phase 6 — Cron migration

For each `vercel.json` cron entry:

```bash
gcloud scheduler jobs create http atelier-cron-NAME \
  --schedule="0 * * * *" \
  --uri="https://atelier-endpoint-XXXX.run.app/api/cron/NAME" \
  --http-method=POST \
  --oidc-service-account-email=cron-invoker@PROJECT.iam.gserviceaccount.com
```

The Atelier cron handlers don't change; only the trigger does.

### Phase 7 — DNS cutover + validation

1. Update DNS to point at the Cloud Run service (or the Cloud Load Balancer fronting it).
2. Run smoke tests against the new URL:
   - `curl <new-url>/.well-known/oauth-authorization-server` returns OAuth metadata
   - `npx tsx scripts/endpoint/__smoke__/real-client.smoke.ts` against the new endpoint passes
   - `/atelier/analyst` lens loads (with a valid Identity Platform JWT)
   - `/atelier/observability` dashboard renders for an admin composer
3. Monitor `telemetry` table for the first hour — error rate should match the pre-migration baseline.

### Phase 8 — Decommission source

After ≥7 days of stable operation:

1. Stop writes to the Supabase project (revoke service-role key).
2. Stop Vercel deployment auto-deploys.
3. Final dump for archival.
4. Tear down Vercel + Supabase resources.

---

## 5. The `BroadcastService` interface contract (for adapter authors)

If you need to write an adapter for a non-NOTIFY pub/sub backend (Cloud Pub/Sub, Memorystore Redis, etc.), implement this interface from `scripts/coordination/lib/broadcast.ts`:

```typescript
export interface BroadcastService {
  publish(envelope: BroadcastEnvelope): Promise<void>;
  subscribe(
    channelName: string,
    handler: (envelope: BroadcastEnvelope) => void,
  ): () => void; // returns unsubscribe
}
```

Constraints:
- **Per-channel FIFO + at-least-once.** Subscribers must be idempotent.
- **Channel naming.** `atelier:project:<project_id>:events`. Adapters may transform this (e.g., `atelier_project_<id>_events` for NOTIFY which doesn't allow `:`).
- **Ordering metadata.** `envelope.id` and `envelope.seq` are allocated by the publisher (Postgres sequence in `AtelierClient`). Adapters do NOT allocate.
- **Failure mode.** Publish failure is logged but does NOT block the canonical Postgres write per ADR-005. Subscribers reconcile on reconnect.

A new adapter must:
1. Live under `scripts/coordination/adapters/<vendor-or-protocol>.ts`
2. Have its imports allowlisted in `scripts/lint/portability-lint.ts` if it uses any vendor-proprietary surface
3. Pass the broadcast smoke (`npm run smoke:broadcast`) against the implementation

---

## 6. Validation criteria

Migration is complete when:

- [ ] `npm run smoke:endpoint` against the GCP endpoint passes
- [ ] `npm run smoke:real-client` against the GCP endpoint passes (real OIDC JWT issued by Identity Platform)
- [ ] `npm run smoke:broadcast` against the new adapter passes
- [ ] `/atelier` lens routes render correctly for at least one composer per discipline
- [ ] `/atelier/observability` renders correctly for an admin composer
- [ ] At least one full PR cycle through the substrate completes (claim → release → log_decision)
- [ ] Telemetry error rate over 24 hours matches pre-migration baseline (±10%)
- [ ] No portability lint regressions (`npm run lint:portability` stays green; adapter additions are correctly placed under `scripts/coordination/adapters/`)

---

## 7. Rollback

If migration fails before Phase 7 (DNS cutover), no rollback is needed — the source stack is still authoritative.

If migration fails *after* Phase 7:

1. Re-point DNS at the Vercel deployment.
2. The Supabase database accepts writes again (since you didn't decommission in Phase 8).
3. Any writes that landed on Cloud SQL during the Cloud Run window need to be reconciled into Supabase via a one-shot `pg_dump --data-only` of the affected tables → `psql` into Supabase. The append-only `decisions` trigger means reconciliation is by INSERT not UPDATE for that table.
4. Diagnose the failure, address it, retry the cutover.

The reason Phase 8 (decommission) is delayed by ≥7 days: this rollback path remains open for that window. After Phase 8, rollback would require recreating Supabase resources from the archival dump.

---

## 8. What this runbook does NOT cover

- **GCP IAM design.** Service accounts, roles, and least-privilege boundaries are deployment-shaped. See GCP IAM best-practices documentation.
- **VPC + Private Service Connect.** If your security posture requires Cloud SQL be unreachable from public internet, set up VPC Service Controls + Cloud SQL Auth Proxy. The Atelier endpoint code doesn't change; the connection string changes.
- **Multi-region failover.** Atelier v1 is single-region per ADR-027 / NORTH-STAR scope. Multi-region is an adopter-side architectural decision and ADR-worthy.
- **Cost optimization.** Cloud SQL machine sizing, Cloud Run min-instances, Cloud Scheduler quota — all GCP-side tuning.

---

## 9. Cross-references

- ADR-027 — Reference implementation stack (Vercel + Supabase + MCP)
- ADR-028 — Identity service default Supabase Auth, BYO supported
- ADR-029 — GCP-portability constraint (the *why* behind every decision in this runbook)
- ARCH §6.8 — BroadcastService capability
- `scripts/coordination/lib/broadcast.ts` — Interface contract
- `scripts/coordination/adapters/supabase-realtime.ts` — Reference adapter
- `scripts/lint/portability-lint.ts` — Constraint enforcement
- `docs/user/tutorials/first-deploy.md` — Reference deploy runbook (Vercel + Supabase Cloud)
- `docs/user/tutorials/local-bootstrap.md` — Local bringup runbook
