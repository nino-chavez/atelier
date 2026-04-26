# Implementing the Atelier protocol on other stacks

**Audience:** A team implementing the 12-tool Atelier protocol on a stack other than the v1 reference (Vercel + Supabase + MCP).

**Tier served:** Tier 3 — Specification.

The Atelier protocol is stack-agnostic per ADR-012 (capability-level architecture) and ADR-013 (12-tool endpoint). MCP is the v1 reference transport. The reference stack (Vercel + Supabase) is one valid implementation per ADR-027.

This guide tells you what you must implement to be protocol-compliant, regardless of stack.

---

## Required capabilities

Per [`../../functional/PRD.md §6`](../../functional/PRD.md), any compliant Atelier implementation must provide:

| Capability | Purpose | Reference impl choice | Your alternatives |
|---|---|---|---|
| Versioned file store | Canonical state for files, branches | GitHub | GitLab, Bitbucket, Gitea, Forgejo, your own |
| Relational datastore with RLS | Blackboard state with per-composer authorization | Supabase Postgres | Cloud SQL, Aurora, RDS, self-hosted Postgres |
| Pub/sub broadcast | Real-time push of row changes | Supabase Realtime | NOTIFY/LISTEN, Redis pub/sub, NATS, Kafka |
| Identity service | Signed tokens with role claims | Supabase Auth | Auth0, Clerk, Identity Platform, Keycloak, your own OIDC |
| Vector index | Semantic search for find_similar | pgvector | Pinecone, Weaviate, Qdrant, FAISS, your own |
| Serverless runtime | Stateless HTTP functions | Vercel Functions | Cloud Run, Lambda, Azure Functions, Fly.io |
| Static/edge hosting | Prototype web app | Vercel | Cloudflare Pages, Netlify, GCS+CDN, your own |
| Agent interop protocol | Standardized tool-call surface | MCP (Streamable HTTP) | gRPC, JSON-RPC, REST with OpenAPI, your own |
| Cron / scheduled jobs | Reapers, sync, reconcile | Vercel Cron | Cloud Scheduler, EventBridge, k8s CronJob |
| Observability sink | Telemetry storage + query | OpenTelemetry → telemetry table | Honeycomb, Datadog, Loki, your own |

Any stack that provides these, deployable behind a single self-hostable command, is a valid Atelier implementation.

## Required protocol semantics

The 12 tools must implement the semantics in [`../../functional/BRD.md Epic 2`](../../functional/BRD.md). Brief recap:

| Category | Tools | Must support |
|---|---|---|
| Session | `register`, `heartbeat`, `deregister` | Per-composer signed tokens; TTL with reaper |
| Context | `get_context` | Trace-ID-scoped state including charter + decisions + territory + contribution summary |
| Contribution | `claim`, `update`, `release` | Atomic create-and-claim path (per ADR-022); state machine per US-4.3 |
| Lock | `acquire_lock`, `release_lock` | Monotonic fencing tokens (per ADR-004); stale-token writes rejected server-side |
| Decision | `log_decision` | Repo-first writes (per ADR-005); append-only at datastore level |
| Contract | `publish_contract`, `get_contracts` | Per-territory contracts; pub/sub broadcasts on contract change |

If your implementation skips any of these, it is not protocol-compliant. Specifically: no skipping fencing tokens (ADR-004), no skipping repo-first decision writes (ADR-005), no skipping triage gate (ADR-018).

## Validation

A compliant implementation should pass:

1. **The conformance test suite.** Lands at M5 (alongside find_similar eval harness). Tests every tool against expected semantics.
2. **The fencing-token soak test.** Concurrent `acquire_lock` calls on the same scope; only one wins; loser's writes are rejected even after token expiry.
3. **The decision-durability test.** `log_decision` succeeds when the datastore is offline; mirror catches up on reconnect.
4. **The eval-set portability test.** The seed find_similar eval set produces equivalent precision/recall against your embedding model + vector index.

## Implementation reports we want to hear about

If you implement on a non-reference stack, we'd like to capture your experience as a `walks/` doc (per [`../walks/`](../walks/)) and possibly as a methodology refinement upstream (per [`../../developer/upstreaming.md`](../../developer/upstreaming.md)).

Especially interesting:
- Stacks that lack one of the required capabilities (we want to know what you substituted)
- Protocol semantics that were ambiguous (we want to clarify the spec)
- Performance characteristics that differed from the reference impl (we want to understand portability tax)

## Status

**Pre-M2.** The protocol is specified in NORTH-STAR/PRD/BRD; the conformance test suite lands at M5. Until then, this doc is forward-looking guidance for early implementers.
