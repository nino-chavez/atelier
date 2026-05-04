# Getting started with Atelier

> **Tier 1 — Reference Deployment.** "I want to try Atelier as-is for my team." For Tier 2 (fork and customize) see [`../developer/fork-and-customize.md`](../developer/fork-and-customize.md). For Tier 3 (apply the protocol on a different stack, or apply the methodology without this codebase) see [`../methodology/adoption-guide.md`](../methodology/adoption-guide.md) or [`../architecture/protocol/`](../architecture/protocol/). All three tiers are first-class at v1 per ADR-031.

Atelier is a self-hostable coordination substrate for mixed teams of humans and agents to concurrently author one canonical artifact across IDE, browser, and terminal surfaces — without drift. This page is the shortest path from "I cloned the repo" to "I'm signed into my local `/atelier` dashboard with a working bearer token."

It does not duplicate the operator runbooks. It points at them.

---

## Pick a starting mode

| Mode | When to pick it | Time | Runbook |
|---|---|---|---|
| **Local-only** (recommended) | One workstation. Evaluate the substrate. No network access required. | 15–30 min with prereqs | [`tutorials/local-bootstrap.md`](./tutorials/local-bootstrap.md) |
| **Deployed (Vercel + Supabase Cloud)** | Teammate joining from another machine, remote agent connectors (claude.ai / ChatGPT), continuous availability, external demo, CI auto-deploy. | 60–90 min one-time | [`tutorials/first-deploy.md`](./tutorials/first-deploy.md) |

Per ADR-044, **local-only is the canonical development flow**; deploy is event-triggered and adds operational debt without proportional benefit if no concrete trigger from `BRD-OPEN-QUESTIONS §28` has fired. If unsure, pick local-only — switching later is a URL swap, not a re-bootstrap.

---

## Prerequisites (local-only)

Install once:

- **Node.js 22+** — `node --version` should print v22 or higher.
- **Supabase CLI 1.x+** — `supabase --version`; install via `npm install -g supabase` or [the official guide](https://supabase.com/docs/guides/cli).
- **Docker Desktop or compatible runtime** — `docker info` should succeed (required by `supabase start`).
- **An MCP HTTP client** — Claude Code CLI 0.5+ (`claude --version`) is the reference client; any client implementing the Streamable HTTP MCP profile works.
- **An OpenAI API key** — for `find_similar` embeddings (https://platform.openai.com/api-keys; project key with embeddings scope is sufficient).

Plus a clone of this repo (or a fork).

---

## The shape of the local-only path

The canonical operator runbook is [`tutorials/local-bootstrap.md`](./tutorials/local-bootstrap.md). It is the source of truth for the steps, the troubleshooting decision tree, and the substrate-fix history. Follow it directly; this section is the shape, not a substitute.

The shape:

1. **`supabase start`** — boots the local Supabase stack and applies the 11 migrations under `supabase/migrations/`.
2. **`npm install` then `cd prototype && npm install`** — installs both the script-level CLI dependencies and the Next.js prototype dependencies.
3. **Seed your composer** — `scripts/bootstrap/seed-composer.ts` creates your Supabase Auth user and a `composers` row. Idempotent on email.
4. **Issue a bearer token** — `scripts/bootstrap/issue-bearer.ts` signs in and prints a 1-hour JWT.
5. **`cd prototype && npm run dev`** — starts the prototype on `http://localhost:3030`. Configure your MCP client against `http://localhost:3030/api/mcp` with the bearer.

Once the substrate is up, the `atelier dev` CLI is the canonical session-start entry — it runs the same pre-flight checks, starts Supabase if not running, starts the dev server, and rotates the bearer when needed. Re-running is a no-op against a healthy substrate. Use `atelier dev --preflight-only` for diagnostics without starting anything.

For a fresh project (rather than working inside this repo), `atelier init <project-name>` (D5) wraps Steps 1–4 plus a config customization pass:

```bash
atelier init my-project --email you@example.com --discipline architect
cd my-project && atelier dev
```

---

## What you'll have

- A running substrate at `http://localhost:3030/api/mcp` (static-bearer URL) and `http://localhost:3030/oauth/api/mcp` (OAuth-flow URL for remote connectors).
- A composer seeded against the canonical `atelier-self` project.
- A bearer token wired to your MCP client.
- The `/atelier` dashboard at `http://localhost:3030/atelier` showing live presence, contributions, decisions, and lock state across the five role lenses (analyst, dev, PM, designer, stakeholder per ADR-017) and the admin-gated `/atelier/observability` panel.
- Access to the 12-tool MCP surface: `register`, `heartbeat`, `deregister`, `get_context`, `find_similar`, `claim`, `update`, `release`, `log_decision`, `acquire_lock`, `release_lock`, `propose_contract_change` (per ADR-013, ADR-040).

---

## Now what?

- **Watch `/atelier`.** Open the dashboard. From your MCP client, run a `claim` → `update` → `release` cycle and watch them land in real time.
- **Run `find_similar`** from the lens panel or directly via the MCP tool to check for prior coverage of a topic. The advisory CI gate is P≥0.60 / R≥0.60 per ADR-043; ADR-047 reframed the blocking-tier threshold as v1.x opt-in after wider-eval.
- **Run the eval harness.** `npm run eval:find_similar` exercises the semantic-search primitive against the canonical seed corpus.
- **`log_decision`** to file an ADR through the per-project git committer (the bot writes the file; you push the PR). Per ADR-005 this is the only path that writes to the `decisions` table.
- **Read [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md)** for what shipped at v1 (M0–M7) and what's deferred to v1.x.
- **When you need network access** — a teammate joining, a remote claude.ai or ChatGPT Connectors session, continuous availability — switch to the deployed mode via [`tutorials/first-deploy.md`](./tutorials/first-deploy.md). Local-only stays the canonical development flow per ADR-044; deploy is a peer mode, not a replacement.

---

## Troubleshooting

The local-bootstrap [Troubleshooting section](./tutorials/local-bootstrap.md#troubleshooting) covers the four substrate-fix-class regressions observed during M5–M6 (port :3030 binding, JSON-vs-HTML 404 on `/.well-known/*`, `.mcp.json` not picked up, Authenticate-vs-Reconnect URL split misuse) plus standard Supabase startup, migration, and bearer-rotation issues. If your symptom doesn't match a tree branch there, file an issue with `claude mcp list` output and a dev-server log excerpt.

Bearer rotation has its own runbook: [`guides/rotate-bearer.md`](./guides/rotate-bearer.md). Full credential rotation (bearer + service role + OpenAI key) is in [`guides/rotate-secrets.md`](./guides/rotate-secrets.md).

---

## Cross-references

- ADR-031 — three-tier consumer model (this page is the Tier 1 entry)
- ADR-044 — bootstrap inflection (local-only canonical; deploy event-triggered)
- ADR-046 — deploy strategy (Vercel + Supabase Cloud peer mode)
- `BRD-OPEN-QUESTIONS §28` — concrete deploy trigger conditions
- [`tutorials/local-bootstrap.md`](./tutorials/local-bootstrap.md) — local operator runbook (canonical)
- [`tutorials/first-deploy.md`](./tutorials/first-deploy.md) — cloud deploy runbook (one-time provisioning + the `atelier deploy` polished-form contract)
- [`connectors/`](./connectors/) — per-client connector setup (Claude Code, claude.ai Connectors, ChatGPT Connectors)
- [`guides/`](./guides/) — operational how-tos (invite composers, manage territories, rotate secrets, upgrade schema, observability alerts)
