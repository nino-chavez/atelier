# Walk: Designer week-1 component-iteration scenario

**Companion to:** `analyst-week-1.md`, `dev-week-1.md`
**Status:** Authored 2026-04-27 with the latent-gaps re-examination discipline applied from the start.
**Owner:** Nino Chavez
**Last updated:** 2026-04-27
**Related:** ADR-019 (Figma is feedback surface, not design source), `../../strategic/NORTH-STAR.md`, `../ARCHITECTURE.md`, `../../../.atelier/territories.yaml`

---

## 1. Purpose

The analyst and dev walks validated web-surface research authoring and IDE-surface code implementation. This walk validates the designer path -- web-surface composer iterating on prototype components, with Figma as a one-way projection target and inbound comment source. Different workflow shape: designer's territory `prototype-design` overlaps with the dev's `prototype-app` on the components subtree (both list `prototype/src/components/**`), forcing cross-territory coordination through the lock substrate. Figma is explicitly NOT a design source per ADR-019 -- design components live in the repo.

---

## 2. Scenario

A designer composer (Maya) updates the Button component to add a new tertiary variant. Maya uses claude.ai with the Atelier connector. They:

1. Connect web-agent and register a session
2. Read context for the component update task
3. Run `find_similar` for prior button-related decisions and component variants
4. Atomic-create a design contribution for the work
5. Acquire locks on `prototype/src/components/Button.tsx` and `prototype/design-tokens/buttons.css`
6. Edit the component and tokens via the agent (writes via per-project endpoint committer per ADR-023)
7. Manually project the updated component to Figma (this is a designer workflow step, NOT an Atelier automation -- see Step 7 status)
8. Other team members leave Figma comments; triage routes comments back as proposal contributions
9. Address comments, iterate
10. Transition to review; designer-role reviewer approves; PR merges

Pre-conditions assumed in place:
- `projects` row exists.
- `composers` row for Maya exists with `default_role=designer`, valid token issued via `atelier invite`.
- `territories.yaml` defines `prototype-design` with `scope_kind=design_component`, `scope_pattern: ["prototype/src/components/**", "prototype/design-tokens/**"]`, `contracts_published: [design_tokens, component_variants]`.
- Maya has the Atelier endpoint URL configured in claude.ai's connector setup with bearer token per ARCH section 7.9.
- The project has `integrations.design_tool.kind: figma` configured in `.atelier/config.yaml` with valid Figma file_key.

---

## 3. Step-by-step walk

### Step 1 -- Register web-surface session

| Layer | Detail |
|---|---|
| **Tool** | `register(project_id, surface="web", composer_token, agent_client="claude.ai")` |
| **Schema** | INSERT `sessions` (project_id, composer_id, surface="web", agent_client="claude.ai", status="active"). Returns session_token. |
| **Prototype** | `/atelier` designer lens shows Maya under "active participants." |
| **Status** | Clean. Same flow as analyst walk Step 1; auth covered by ARCH section 7.9. |

### Step 2 -- Read context for the component update

| Layer | Detail |
|---|---|
| **Tool** | `get_context(lens="designer")` -- no specific trace_id since this is reactive design work, not a BRD-driven story. |
| **Schema** | Per ARCH section 6.7. With `lens="designer"` defaults (per the YAML in section 6.7), Maya gets weighted contributions_kind toward `design`, charter_excerpts off, traceability_entries_limit at 30. |
| **Prototype** | `/atelier` designer lens shows the relevant context including any open design-kind contributions from other composers. |
| **Status** | Clean. Lens defaults landed during dev-week-1 work. |

### Step 3 -- Run find_similar for prior button work

| Layer | Detail |
|---|---|
| **Tool** | `find_similar(description="button component tertiary variant token-driven styling")` -- no trace_id since this is exploratory. |
| **Schema** | Project-scoped per ARCH section 6.4.3. Returns design-kind merged contributions, decisions tagged design category, BRD/PRD sections that mention button or component. |
| **Prototype** | `/atelier` designer lens "before you start" panel shows matches. |
| **Status** | Clean. |

### Step 4 -- Atomic-create a design contribution

| Layer | Detail |
|---|---|
| **Tool** | `claim(contribution_id=null, kind="design", trace_ids=["US-3.3"], territory_id=<prototype-design-id>, content_stub=null, idempotency_key=<uuid>)` per ARCH section 6.2.1. The trace_id `US-3.3` (Design route) is illustrative -- design work for prototype components typically traces to the Design route or to specific component-related stories; teams may also introduce a dedicated NF-X (non-functional requirement) trace category by adding stories to BRD if their workflow benefits from a separate NF dimension. |
| **Schema** | INSERT contributions (state=open) + UPDATE to claimed in one transaction per section 6.2.1. Validation: kind=design is in enum; trace_ids non-empty; territory_id valid; designer role may author into prototype-design. |
| **Prototype** | `/atelier` designer lens shows new claimed contribution. similar_warnings panel surfaces the matches from Step 3 if any cross 0.80 threshold. |
| **Status** | Clean. Specified by section 6.2.1. |

### Step 5 -- Acquire locks on component + token files

| Layer | Detail |
|---|---|
| **Tool** | `acquire_lock(contribution_id, artifact_scope=["prototype/src/components/Button.tsx", "prototype/design-tokens/buttons.css"])` per ARCH section 7.4.1. |
| **Schema** | INSERT locks. Overlap detection per section 7.4.1: if a dev composer in the prototype-app territory currently holds a lock on `prototype/src/components/Button.tsx`, this acquire returns CONFLICT with the conflicting lock id. Maya must coordinate with the dev (out-of-band) or wait. The territories overlap on components by design (both prototype-design and prototype-app list `prototype/src/components/**`); the lock substrate is the runtime coordination point. |
| **Prototype** | `/atelier` designer lens shows the lock. PM/admin lens sees the cross-territory tension if any conflict surfaces. |
| **Status** | **Latent gap.** The territories.yaml has prototype-design with `scope_kind=design_component`, but section 7.4.1 (added during dev walk) treated all scope_kinds the same -- glob-pattern-based file matching. What does `design_component` add beyond `files`? Folded into ARCH section 7.4.1.1 in this commit clarifying that scope_kind shapes how the prototype renders the lock (component preview thumbnail vs. file path) but does not change lock-acquisition mechanics. |

### Step 6 -- Edit component and tokens via agent

| Layer | Detail |
|---|---|
| **Tool** | `update(contribution_id, state="in_progress", content_ref="prototype/src/components/Button.tsx", payload=<updated TSX>, payload_format="full", fencing_token=<from lock>)`. Web-surface composers go through the per-project endpoint committer per ADR-023 and section 7.8 -- the endpoint commits on Maya's behalf to a per-contribution branch (`design/US-3.3-<short-id>`). Multiple update calls produce multiple commits (Button.tsx commit, then buttons.css commit). |
| **Schema** | UPDATE contributions SET state, content_ref. Per-project committer commits + pushes to the contribution branch. Fencing token validated server-side per section 7.4.2 (web-surface = hard validation in endpoint write path). |
| **Prototype** | `/atelier` designer lens shows in-progress contribution + commit count. Components don't render in `/atelier` directly; designers preview via the prototype web app's `/design` route. |
| **Status** | Clean. Specified by sections 6.2.2 + 7.4.2 + 7.8. |

### Step 7 -- Project the updated component to Figma

| Layer | Detail |
|---|---|
| **Tool** | None (this is a designer workflow step outside Atelier). |
| **Schema** | No state change. Maya manually exports / re-renders the Button component into the configured Figma frame using whatever tooling they prefer (e.g., the project's existing storybook-to-figma pipeline, or manual screenshot + paste). The Figma frame carries a banner per the publish-pull asymmetry convention (NORTH-STAR section 8): "edit in repo, not here." |
| **Prototype** | None. |
| **Status** | **Latent gap clarified.** ADR-019 says "Figma receives projections of components" without specifying a mechanism, leading to a reasonable assumption that Atelier auto-projects. Per ADR-008 the v1 sync substrate has exactly 5 scripts and `publish-design` is not one of them. Resolution: Figma projection is **explicitly not an Atelier automation at v1** -- designers project manually using their team's existing tools. Atelier's responsibility on the Figma surface is one-way inbound only (comment triage, see Step 8). Folded into ARCH section 6.5.1 in this commit as an explicit non-feature with a v1.x extension hook. |

### Step 8 -- Receive Figma comments via triage

| Layer | Detail |
|---|---|
| **Tool** | None directly invoked by Maya. Triage script runs autonomously. |
| **Schema** | Figma webhook fires when a comment is posted on the projected frame. The triage script (per US-9.5/9.6/9.7) classifies the comment, drafts a `kind=proposal` contribution citing the source comment, sets `trace_ids` from the parent contribution's trace_ids (since Figma comments don't carry trace IDs natively, attribution is via the frame metadata that the manual projection step embedded). The proposal sits in `state=open` awaiting human review per ADR-018. |
| **Prototype** | `/atelier` designer lens "feedback to address" panel shows the new proposal. The proposal links back to Maya's original contribution and to the Figma comment. |
| **Status** | **Latent gap.** Triage flow per ADR-018 + Epic 9 was specified at high level (classifier + drafter + never auto-merges) but Figma-specific mechanics were not: how does triage map a Figma comment to a contribution (frame metadata? file_key + frame_id lookup?), what does the drafted proposal's content look like for a design comment (the comment text? a screenshot? both?), and what happens when a Figma comment can't be mapped to any contribution? Folded into ARCH section 6.5.2 in this commit. |

### Step 9 -- Address comments, iterate

| Layer | Detail |
|---|---|
| **Tool** | `update(contribution_id, payload=<revised TSX>, fencing_token=<token>)` -- iterate as needed. Maya may also `release(proposal_contribution_id)` after addressing each Figma-sourced proposal so the proposal queue stays clean. |
| **Schema** | More commits on the contribution branch. Proposals may be marked merged (incorporated) or rejected (declined) per the standard contribution lifecycle. |
| **Prototype** | `/atelier` designer lens reflects iteration. |
| **Status** | Clean. Standard contribution-lifecycle iteration. |

### Step 10 -- Transition to review; PR merges

| Layer | Detail |
|---|---|
| **Tool** | `update(contribution_id, state="review")` -- web-surface composers go through the endpoint committer which opens the PR (per section 6.2.3). |
| **Schema** | UPDATE contributions SET state="review". Endpoint opens PR. Per `territories.review_role` for prototype-design (= designer), the PR routes to a designer reviewer. (This is peer review within the role rather than cross-role review; the PR opens, designer-role reviewer approves, merges.) |
| **Prototype** | `/atelier` designer-reviewer lens surfaces the PR. After merge, contribution transitions to merged via the merge webhook per section 6.2.3. |
| **Status** | Clean. |

### Cross-cutting -- design contracts published on merge

When the merged contribution touches files matching a contract's source patterns, the territory's published contracts (per `territories.yaml: prototype-design.contracts_published: [design_tokens, component_variants]`) may be re-versioned. The breaking-change classifier per ARCH section 6.6.1 evaluates whether the contract change is breaking; if so, downstream consumer territories (e.g., prototype-app which consumes component_library and design_tokens) get a proposal contribution to acknowledge the change.

| Layer | Status |
|---|---|
| **Status** | **Latent gap.** Contracts are well-specified at the contract-flow layer (section 6.6 + 6.6.1) but the design-specific schemas (`design_tokens`, `component_variants`) were never defined. Folded into ARCH section 6.6.2 in this commit specifying the v1 schema shapes. |

---

## 4. Latent gaps surfaced and folded in this commit

| Gap | ARCH section folded into |
|---|---|
| `scope_kind=design_component` semantics vs. `files` (Step 5) | section 7.4.1.1 (added) |
| Figma projection as v1 explicit non-automation (Step 7) | section 6.5.1 (added) |
| Figma-comment triage mechanics: frame-to-contribution mapping, proposal content shape, unmappable-comment handling (Step 8) | section 6.5.2 (added) |
| `design_tokens` and `component_variants` contract schemas (cross-cutting) | section 6.6.2 (added) |

---

## 5. Cross-references

- analyst-week-1.md, dev-week-1.md -- the sibling walks; together they cover the three primary composer surfaces
- ADR-019 -- Figma is feedback surface, not design source; this walk operationalizes that constraint
- ARCH section 6.2.x -- contribution lifecycle (claim, update, release, review)
- ARCH section 6.5.x -- sync substrate flows (publish-docs, publish-delivery, mirror-delivery, reconcile, triage; plus 6.5.1 Figma non-automation, 6.5.2 Figma triage mechanics)
- ARCH section 6.6.x -- territory contracts (flow, breaking-change classifier, design contract schemas)
- ARCH section 7.4.x -- locks + fencing (granularity, glob, surface-dependent semantics, scope_kind rendering)
- ARCH section 7.8 + 7.9 -- web-surface auth + remote-surface committer
