# AGENTS.md — Role definitions and agent rules

This file defines the roles, territories, and rules that agents must observe when working on this repo. It complements `CLAUDE.md` (which is agent-client-specific) and is read by every agent at session start.

---

## Roles

Seven composer roles. A composer has one default role and may hold secondary territory grants.

| Role | Primary territories | Can invite | Can author canonical state |
|---|---|---|---|
| **architect** | methodology, architecture, decisions, traceability | Yes | Yes |
| **pm** | product | Yes | Yes |
| **analyst** | requirements, strategy-research | No | Yes |
| **dev** | protocol, prototype-app, evaluation | No | Yes |
| **designer** | prototype-design | No | Yes |
| **admin** | none (platform role) | Yes | No |
| **stakeholder** | none (read-only) | No | No (comments → triage only) |

---

## Territory rules

See `.atelier/territories.yaml` for the canonical declaration. Key rules:

- **Cross-territory work routes through proposals.** If you need to modify an artifact outside your role's primary territories, create a `kind=proposal` contribution; do not directly edit.
- **Contracts are load-bearing.** A territory's `contracts_published` defines the interface downstream consumers depend on. Breaking changes route through cross-territory proposal flow (ADR-014).
- **Locks are per-scope, not per-file.** A `doc_region` lock on `docs/functional/BRD.md#section-3` allows concurrent edits to `docs/functional/BRD.md#section-4` by another composer.

---

## Agent-specific rules

These rules describe the **target operating state** (post-M2 when the 12-tool endpoint exists). Pre-M2, the equivalent is reading the charter files directly and following the rules manually; see `.atelier/checkpoints/SESSION.md` for the pre-M2 fallback.

1. **Read before writing.** Always pull `get_context` (post-M2) or read the charter files directly (pre-M2) before making changes.
2. **Run `find_similar` before creating contributions** (post-M5 when find_similar ships). The cost of checking is much lower than the cost of duplication.
3. **Claim before editing** (post-M2 when claim/lock primitives exist). Any edit to a shared artifact requires a claimed contribution and an acquired lock.
4. **Use fencing tokens on every write** (post-M2 when locks exist). Writes without current fencing token will be rejected server-side (ADR-004).
5. **Log decisions when making architectural/strategic/convention choices.** Keyword: "because". If the choice carries a 'because', it's a decision and belongs as a new file under `docs/architecture/decisions/ADR-NNN-<slug>.md` (per ADR-030). This rule applies pre-M2 (write the file directly) and post-M2 (call `log_decision`).
6. **Append-only for decisions.** Never edit prior decisions. Reversals are new entries with `reverses:` frontmatter.
7. **Respect scope boundaries.** If you're asked to build something that falls in an excluded category (per `docs/functional/PRD.md` §5), push back rather than implement.
8. **No emoji in commits, docs, or code** unless the user explicitly requests.

---

## Session lifecycle

```
register → work → heartbeat every 30s → deregister on completion
```

If heartbeat lapses past TTL (90s), the session is reaped: held locks release, claimed contributions return to `open`, fencing tokens invalidate. (Lifecycle is post-M2; pre-M2 there are no sessions or locks to reap.)

Always deregister cleanly when possible. Reaped sessions will be visible in `/atelier/observability` (post-M7) as a reaper-rate metric.

---

## Agent clients supported

The protocol is client-agnostic (ADR-013). Any client that can:
- Speak the agent interop protocol (MCP at v1)
- Maintain a session heartbeat loop
- Hold and present a composer token

...can participate. Current ecosystem (Q2 2026): Claude Code, Cursor, Codex, Windsurf, Aider (IDE); claude.ai with remote connectors, ChatGPT with MCP (web); custom CLIs (terminal).

---

## Sandbox rules

- **External-sourced content (via triage) never auto-merges.** Triage produces `kind=proposal` contributions that require explicit human approval (ADR-018).
- **Service-role datastore credentials live server-side only.** Clients (including this agent) only hold per-composer tokens (ADR-007 security consequence).
- **No direct datastore writes from clients.** All writes go through the agent endpoint, which enforces authorization and fencing.
