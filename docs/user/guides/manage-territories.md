# Manage territories

**Audience:** an operator (architect/admin role) curating the territory map for an Atelier project. Territories are the unit of ownership: each names a domain, who owns it, what scope pattern bounds it, and which contracts it publishes/consumes.

**Scope:** edits to `.atelier/territories.yaml`. The CLI does NOT write to the datastore — territories.yaml is canonical (per ADR-005, decisions write to repo first; the territories-mirror sync script propagates to the datastore on the next cycle).

---

## What `atelier territory` does

Per ADR-014 (territory + contract model), ADR-025 (review-routing key per `review_role`), ADR-038 (composer discipline enum), and ADR-039 (per-territory `plan_review` opt-in), each territory entry in `territories.yaml` carries:

| Field | Meaning |
|---|---|
| `name` | Kebab-case slug; unique within the file. |
| `owner_role` | Discipline of the territory's owner (`analyst | dev | pm | designer | architect`). |
| `review_role` | Discipline that reviews contributions reaching `state=review` (defaults to `owner_role` when omitted, per ADR-025). |
| `scope_kind` | Shape of the bounded artifact set (`files | doc_region | research_artifact | design_component | slice_config`). |
| `scope_pattern` | One or more glob patterns or path/anchor strings. |
| `contracts_published` | Names of contracts this territory authors. |
| `contracts_consumed` | Names of contracts this territory depends on. |
| `description` | Free-text rationale; appears in lens UI tooltips. |
| `requires_plan_review` | Boolean opt-in for the ADR-039 `plan_review` lifecycle gate. |

`atelier territory add` appends a new entry with these fields, validates against existing entries, preserves comments + ordering via the `eemeli/yaml` Document API, and runs the post-edit validator.

---

## Quick reference

```bash
atelier territory add \
  --name observability \
  --owner-role architect \
  --scope-kind files \
  --scope-pattern 'scripts/observability/**' \
  --description 'Telemetry + alert publishing substrate.'
```

When `--name`, `--owner-role`, `--scope-kind`, or `--scope-pattern` are missing AND stdin is a TTY, the CLI drops into an interactive prompt covering all required + optional fields. Pass `--non-interactive` to fail-fast instead.

---

## `atelier territory add` flags

| Flag | Required | Purpose |
|---|---|---|
| `--name <slug>` | yes | Kebab-case slug. Must be unique. |
| `--owner-role <discipline>` | yes | One of `analyst | dev | pm | designer | architect`. |
| `--review-role <discipline>` | no | Defaults to `owner_role` when omitted. |
| `--scope-kind <kind>` | yes | One of `files | doc_region | research_artifact | design_component | slice_config`. |
| `--scope-pattern <pattern>` | yes (1+) | Repeatable; comma-split also accepted (`"a/**,b/**"`). |
| `--description <text>` | no | Free text. Prompted interactively when stdin is a TTY and the flag is omitted. |
| `--contracts-published <name>` | no | Repeatable. |
| `--contracts-consumed <name>` | no | Repeatable. |
| `--requires-plan-review` | no | ADR-039 gate (default false). |
| `--non-interactive` | no | Skip prompts; fail if required flags missing. |
| `--dry-run` | no | Preview the YAML fragment without writing. |
| `--json` | no | Machine-readable output. |

Exit codes: `0` success; `1` validation failure (slug collision, invalid enum, parse error); `2` argument error or missing required flag in non-interactive mode.

---

## Common flows

### Add a territory non-interactively (CI / scripted contexts)

```bash
atelier territory add \
  --name observability \
  --owner-role architect \
  --scope-kind files \
  --scope-pattern 'scripts/observability/**' \
  --scope-pattern 'docs/user/guides/observability-alerts.md' \
  --contracts-published telemetry_event_schema \
  --description 'Telemetry pipeline + alert delivery.' \
  --non-interactive
```

The output prints the appended fragment, the validate-refs report, and "Next steps" pointing at the PR + sync flow.

### Add a territory interactively

```bash
atelier territory add
```

The prompt sequence covers `name`, `owner_role`, `review_role` (blank for default), `scope_kind`, `scope_pattern` (one per line, blank to finish), `description`, contracts, and `requires_plan_review`. Existing territory names are listed up-front so you don't collide.

### Preview without writing

```bash
atelier territory add --name observability --owner-role architect \
  --scope-kind files --scope-pattern 'scripts/observability/**' --dry-run
```

Renders the YAML fragment to stdout. Skips the post-edit validator (no file to validate).

### Scripted retrieval (`--json`)

```bash
atelier territory add --name foo --owner-role dev --scope-kind files \
  --scope-pattern 'src/foo/**' --non-interactive --dry-run --json | jq '.entry'
```

The JSON output carries `{ ok, dryRun, entry, filePath, validator }`.

---

## Governance

Per the `.atelier/territories.yaml` header (and BRD-OPEN-QUESTIONS §14):

- Any composer may propose a territory change via PR.
- Merge requires approval from a composer holding the `admin` access level (or a delegated approver per `.atelier/config.yaml`).
- The change takes effect on PR merge plus the next datastore reload (run `atelier sync publish-delivery` to force).
- Active contributions or locks on artifact scopes that exit a renamed/narrowed territory are NOT auto-released — coordinate with affected composers before merge.

---

## Validate-refs post-edit

After a successful write, `atelier territory add` runs `scripts/traceability/validate-refs.ts --per-pr` and surfaces the result. The validator walks markdown citations, not territories.yaml directly — so a FAIL here typically reflects pre-existing baseline issues unrelated to the new territory. To distinguish: stash the change and re-run the validator; if the same failures appear, they're pre-existing.

The CLI does NOT gate the exit code on validate-refs; it surfaces the report tail and lets you proceed.

---

## Related

- `.atelier/territories.yaml` — the canonical file you're editing. The header documents the schema.
- `docs/architecture/ARCHITECTURE.md` §6.6 — the territory + contract model.
- ADR-014 — territory + contract model extended to non-code artifacts.
- ADR-025 — review-routing keyed by `review_role`.
- ADR-038 — composer discipline + access_level enums.
- ADR-039 — `plan_review` per-territory opt-in.
- `atelier sync publish-delivery` — propagate the change to the datastore mirror.
