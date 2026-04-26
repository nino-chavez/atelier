# Walks

**Audience question:** Does the design actually work end-to-end for a specific scenario?

**Primary tier served:** Tier 2 — Reference Implementation extenders validating their changes against canonical scenarios.

Walks are **scenario validations** — end-to-end traces of how a real user-week would flow through the schema, endpoint, and prototype. They are diagnostic, not specification: a successful walk confirms the design holds; a failing walk surfaces gaps that become new ADRs.

The analyst walk (2026-04-24) surfaced 5 gaps that landed as ADR-021 through ADR-025.

## Contents

| Walk | Persona | Date | Outcome |
|---|---|---|---|
| [`analyst-week-1.md`](./analyst-week-1.md) | Analyst principal (browser surface) | 2026-04-24 | Surfaced ADR-021/022/023/024/025 |

## Future walks (planned)

- `dev-week-1.md` — Dev principal claiming `files` contribution, racing a remote-surface committer
- `designer-week-1.md` — Designer principal authoring a `design_component`, surfacing Figma feedback via triage

## Related layers

- For the architecture being walked: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- For the decisions walks have surfaced: [`../decisions/`](../decisions/)
