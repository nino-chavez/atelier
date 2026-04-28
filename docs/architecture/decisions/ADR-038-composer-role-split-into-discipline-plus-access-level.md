---
id: ADR-038
trace_id: BRD:Epic-14
category: architecture
session: expert-review-2026-04-28
composer: nino-chavez
timestamp: 2026-04-28T20:00:00Z
---

# Composer role split into discipline + access_level (and architect added as a first-class discipline)

**Summary.** `composers.default_role` is split into two columns: `composers.discipline` (analyst | dev | pm | designer | architect) and `composers.access_level` (member | admin | stakeholder). The previously-conflated single enum mixed work-discipline (4 values) with access-level (2 values). The split also adds `architect` as a first-class discipline -- previously used as `owner_role` across four territories in `.atelier/territories.yaml` but missing from the composers enum, a drift the data-model audit's supplemental sweep did not catch.

**Rationale.**

Surfaced by `pre-M1-data-model-audit.md` finding F12 (filed initially as BRD-OPEN-QUESTIONS section 20) and reinforced by an expert review on 2026-04-28 that recommended resolving the split before M1 schema implementation rather than deferring to v1.x.

**Why now, not v1.x.** If M1 encodes the conflated `default_role`, the v1.x split becomes a coordinated migration touching: schema (alter table, drop column, add columns, populate from old values), `.atelier/territories.yaml` semantics, BRD acceptance criteria referencing roles, ADR-017 lens-model vocabulary, and any composer rows that exist by then. Resolving now -- before any composer rows exist anywhere -- is materially cheaper.

**The architect drift.** Independent of the split, the supplemental sweep should have caught this and didn't: `composers.default_role` enum had 6 values (analyst | dev | pm | designer | admin | stakeholder), but `.atelier/territories.yaml` uses `architect` as `owner_role` for four territories (methodology, architecture, decisions, traceability) and as `review_role` for the same four. The roles section of territories.yaml defines `architect` explicitly. So a composer claiming an architect-owned territory would, under the old schema, have no valid `default_role` to declare. The split adds `architect` as a discipline, closing this drift.

**Decision.**

The composers table reshapes:

```
composers
  id (uuid, pk)
  project_id (fk)
  email                                          -- UNIQUE(project_id, email) per audit G3
  display_name
  discipline (analyst | dev | pm | designer | architect | null)   -- 5 values; null when access-level-only (admin, stakeholder)
  access_level (member | admin | stakeholder)                      -- 3 values; default member
  token_hash
  token_issued_at
  token_rotated_at
  status (active | suspended | removed)
```

**Discipline values:**
- `analyst` -- requirements + research authoring
- `dev` -- implementation
- `pm` -- product priority + scope
- `designer` -- design tokens + components
- `architect` -- methodology, architecture, decisions, traceability ownership (newly first-class per the architect drift discussion above)
- `null` -- composer has no work-discipline identity (e.g., a platform admin or a read-only stakeholder)

**Access_level values:**
- `member` -- standard work participant; default
- `admin` -- platform privileges (token rotation, composer suspension, observability)
- `stakeholder` -- read-only participant; comments flow through triage

A composer typically has both: `Sarah is a designer who is also an admin` becomes `discipline=designer, access_level=admin`. A platform-only admin without a discipline is `discipline=null, access_level=admin`.

**Authorization model unchanged conceptually.** RLS rules per ARCH 5.3 still scope reads to project membership and writes to session ownership. The role-check in ARCH 6.2.1 step 4 (territory authorship gate) now reads `discipline` rather than `default_role`. Admin operations (per ARCH 7.x) gate on `access_level=admin`.

**Lens model (ADR-017) update.** The five lenses (analyst, dev, pm, designer, stakeholder) are unchanged in count and naming. Lens routing logic clarifies:
- `analyst | dev | pm | designer` lenses route by `discipline` value.
- `stakeholder` lens routes by `access_level=stakeholder` OR by an explicit "view as stakeholder" toggle for any composer who wants the read-only framing temporarily.
- `admin` is not a lens (admins use whichever discipline lens fits their work plus the `/atelier/observability` admin sub-route).

ADR-017 itself is append-only and unchanged; this clarification lives in ARCH 5.1 schema commentary and in CLAUDE.md.

**Migration shape (for any pre-M1 fixtures or seed data).** Pre-M1 there are no live composer rows. If fixtures exist, the mapping is:
- `default_role=analyst` -> `discipline=analyst, access_level=member`
- `default_role=dev` -> `discipline=dev, access_level=member`
- `default_role=pm` -> `discipline=pm, access_level=member`
- `default_role=designer` -> `discipline=designer, access_level=member`
- `default_role=admin` -> `discipline=null, access_level=admin`
- `default_role=stakeholder` -> `discipline=null, access_level=stakeholder`

There is no migration path for `default_role=architect` because the value never existed in the old enum; new architect composers go in as `discipline=architect, access_level=member` from the start.

**`.atelier/territories.yaml` impact.** No value changes required -- territories.yaml already uses discipline values for `owner_role` and `review_role` (architect, analyst, dev, pm, designer). The territories.yaml `roles:` section at the bottom updates to clarify the discipline-vs-access-level distinction:

- `architect`, `analyst`, `dev`, `pm`, `designer` are disciplines (work-type)
- `admin`, `stakeholder` are access levels (participation type)

This was implicit; ADR-038 makes it explicit.

**Consequences.**

- ARCH 5.1 composers schema reshaped.
- ARCH 5.3 authorization commentary updated to reference `discipline` and `access_level` separately.
- ARCH 6.2.1 step 4 territory-authorship check reads `discipline`.
- BRD-OPEN-QUESTIONS section 20 RESOLVED (filed in same audit-cycle as ADR-033/034/035/036/037; resolution arrives same day per expert-review prompt).
- `.atelier/territories.yaml` `roles:` section clarified.
- `composers.default_role` enum removed; replaced by the two-column shape.
- BRD acceptance criteria referencing `default_role` updated to use `discipline` / `access_level` as appropriate.
- /atelier lens model gains the explicit clarification above (ADR-017 unchanged; clarification in ARCH).

**Trade-off considered and rejected.** Keep `default_role` as a fuzzy classifier; don't split. Rejected per F12 + expert review: the conflation propagates outward through every consumer of the field and becomes increasingly expensive to undo as more code reads `default_role`. The split is cheaper here than at v1.x.

**Trade-off considered and rejected.** Add `architect` as a value in the original conflated enum without splitting. Rejected: closes the drift but doesn't address the deeper conflation; just multiplies the discipline-axis values inside an enum that also carries access-level values.
