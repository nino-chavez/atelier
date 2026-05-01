---
id: ADR-044
trace_id: BRD:Epic-1
category: architecture
session: m5-exit-bootstrap-strategic-call-2026-05-01
composer: nino-chavez
timestamp: 2026-05-01T00:00:00Z
---

# Bootstrap inflection at M5-exit; local-stack scope; deploy decision deferred to network-access trigger

**Summary.** Build sessions become MCP clients of the Atelier substrate from M5-exit forward. The substrate runs on the local stack (`supabase start` + `npm run dev`); no cloud deploy is required. Claude Code (and any other MCP-compatible client used as a build agent) is configured against `http://localhost:3030/api/mcp` with a bearer token issued by the local Supabase Auth instance. Deploy is a separate decision deferred until a real network-access need surfaces (multi-machine team, remote-agent peer composer, second human composer needing URL access). Operationalizes BUILD-SEQUENCE M3's bootstrap commitment: *"From M4 on, every build session is observed through `/atelier`. The dashboard you are building is the dashboard you are using to coordinate building it."*

**Rationale.**

The M5 exit completes the substrate side of the bootstrap pre-conditions: 12-tool MCP endpoint (M2-mid), per-project git committer for `log_decision` (M2-mid), real Supabase Auth bearer flow proven by `real-client.smoke.ts` (M2-mid #1 BUNDLED), broadcast substrate for live presence (M4), and find_similar advisory tier (M5 per ADR-043). What remains is operational: configure the build agent as a client and start using the tools.

**Why now, at M5-exit, not after M6 or M7.** Per ADR-011 (destination-first design), BUILD-SEQUENCE explicitly committed to "M4+" for the bootstrap. M5 is done; the spec is overdue. M6 specifically adds the multi-composer surface (remote-principal composers + triage) — the exact code paths whose value depends on real-use validation. Building multi-composer code without a real second composer (Claude Code as a peer to the human composer) tests in the wrong configuration. Each milestone deferred is a milestone of latent bugs surfacing only at adoption, when there is no schedule slack and no team context to diagnose.

**Why local-stack only, not deploy.** The substrate has been built test-first against local Supabase from M1 onward. Every smoke test in CI runs against exactly this configuration. The smoke suite IS the local-bootstrap test. Local-bootstrap does not add validation surface; it changes only which client (the smoke harness vs. an interactive Claude Code session) is exercising the substrate. Deploy adds bug surface (TLS, OAuth callback URLs, Vercel function cold starts, env-var mismatches, DNS) that conflates with substrate bugs during the bootstrap inflection. Per the discipline-tax meta-finding, adding "deploy + cloud Supabase project" to the bootstrap scope was spec-accretion at the operational layer. The minimum that answers the bootstrap question is local-only.

**Why a separate ADR rather than folding into M5 close-out.** The bootstrap is a strategic timing decision that affects every milestone from M6 forward. It deserves its own canonical entry, same shape as ADR-039 (plan-review timing), ADR-041 (embedding default timing), so future readers can find the timing rationale without spelunking M5 commit messages.

**Decision.**

The reference implementation operates as follows from M5-exit forward:

1. **Build sessions open with `get_context`.** CLAUDE.md session-start checklist points at the live MCP endpoint as primary; canonical state precedence list as fallback only when the endpoint is unavailable (local stack down).
2. **Decisions log via `log_decision`.** The per-project git committer (per ARCH 7.8 / ADR-023) writes the ADR file under the bot identity; the human composer pushes via the standard PR flow. Direct-file-edit ADR authorship persists only as the fallback for when the endpoint is unreachable.
3. **Contributions flow through `claim` / `update` / `release`.** The substrate's contribution lifecycle becomes the canonical authoring surface, not direct file commits.
4. **find_similar advisory warnings fire at claim time** (per ARCH 6.2.1's implicit gate) and at PR time (per the v1 advisory tier in ADR-043). Composers see the warnings; the gate does not block.
5. **`/atelier` panels render live presence + active claims + decisions** for the build team, observable in real time via the broadcast substrate (M4).

The substrate runs on the local stack:
- `supabase start` (local Supabase Auth + Postgres + Realtime + pgvector)
- `npm run dev` in `prototype/` (Next.js endpoint at `localhost:3030/api/mcp`)
- Per-project git committer pointed at the local atelier clone
- OpenAI API key in local env for find_similar embeddings

The operator runbook is `docs/user/tutorials/local-bootstrap.md`. The wire-up is one fresh agent-session of work; the runbook is the artifact every adopter follows before they ever consider deploying.

**Consequences.**

- **M6 work flows through the substrate.** First decision logged via `log_decision` lands as the inaugural canonical-write through the live endpoint. M6's multi-composer surface is built BY a real composer USING multi-composer machinery — the most efficient bug-discovery configuration.
- **Operational debt becomes visible immediately.** Bearer token rotation, key rotation runbooks, claim-flow ergonomics, find_similar advisory noise levels — all surface in real use during M6. M7 polish has concrete data to prioritize against.
- **The local-bootstrap runbook is the v1 reference flow for Tier-1 adopters.** Any operator can run Atelier on their workstation without cloud commitments. Deploy becomes an opt-in escalation when the operator's needs cross a network-access threshold, not a precondition of using the substrate.
- **Claude Code (or any chosen MCP client) becomes a load-bearing component of the build team.** The methodology depends on the client implementing the MCP spec correctly. If a client lacks a feature (e.g., HTTP transport with bearer headers), the operator either swaps clients or files a feature request upstream. This is a new shape of dependency the project assumes.
- **The cross-encoder reranker timing (BRD-OPEN-QUESTIONS §27) gets real data.** Once Claude Code starts hitting find_similar advisory in real claim flows, we learn whether the advisory tier's 0.672 precision is acceptable in practice (humans easily filter false positives) or whether it generates enough noise that the blocking tier is needed sooner than v1.x.

**Trade-offs considered and rejected.**

| Option | Why rejected |
|---|---|
| **Original Option A (deploy + cloud Supabase as bootstrap precondition)** | Over-scoped. The bootstrap question is "does Claude Code talk to the substrate via MCP tools" — a usage question, not an infrastructure question. Smoke tests already prove the local config works end-to-end. Deploy adds bug surface that conflates with substrate bugs during the inflection. Spec-accretion at the operational layer per the discipline-tax meta-finding. |
| **Option B (defer bootstrap to after M6)** | Wrong order. M6 ships multi-composer machinery (remote-principal composers + triage) — the code paths whose value depends on real-use validation. Building them without a real second composer tests the smoke harness, not the actual substrate. The spec already committed to "M4+" so deferring further compounds the gap with our own destination-first principle. |
| **Option C (defer bootstrap to after M7)** | Loses two milestones of self-test data. Polished substrate that has never been used is the worst configuration — bugs surface during the polish phase when there is no schedule slack and no fresh team context. The polish should respond to real-use data, not be the first user. |
| **Option D (never as part of v1 build; first adopters become first dogfooders)** | Adopter experience is "be the bug-finder for a system the build team never used." Misses the most efficient bug-discovery configuration (the team with deepest context using the system during construction). Also fails the BUILD-SEQUENCE M3 commitment. |
| **Cloud Supabase + local Vercel dev (hybrid)** | Adds Supabase cloud setup tax without the deploy-validation benefit. If we are using local Vercel, local Supabase costs nothing additional and isolates more bug surface. Hybrid configurations multiply failure modes. |

**Reverse / revisit conditions.**

The deploy decision (ADR-044's intentional non-scope) revisits when a concrete network-access trigger fires. Filed as BRD-OPEN-QUESTIONS section 28 (event-triggered, with explicit trigger criteria per the methodology lesson from §25's premature-trigger experience). Triggers include:

- A second human composer joins the build team and needs the endpoint URL accessible from their machine
- A remote agent (claude.ai Connectors, ChatGPT Connectors) is wired in as a peer composer
- The team wants `/atelier` URL access for review purposes (architect-of-record sign-offs from a different machine, etc.)
- Continuous availability becomes a real need (sessions opening at random times need an always-up endpoint)

When any trigger fires, ADR-044's local-stack scope is not reversed — it persists as the development-time substrate config — but a peer ADR is filed for the deploy strategy alongside the deploy work. The local-stack config remains the documented fallback for offline / disconnected work even after deploy lands.

**Reverse condition for ADR-044 itself:** if real-use data during M6 shows the substrate has bugs that meaningfully interrupt build velocity (find_similar noise, broadcast lag, committer flakiness, MCP client compatibility issues), the bootstrap pauses while those bugs land in M7-or-earlier hot-fixes. The bootstrap does not become a hostage situation where the team can't make progress because the substrate they're using to make progress is broken.
