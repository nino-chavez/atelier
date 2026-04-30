-- Atelier M2-entry schema additions
--
-- Per `docs/architecture/audits/M2-entry-data-model-audit.md` (2026-04-30) and
-- ADR-039 (plan-review state). Lands the M2 endpoint surface columns + the
-- ADR-039 lifecycle gate in a single additive migration.
--
-- Trace:
--   BRD: Epic-2 (M2 endpoint surface), Epic-4 (lifecycle states)
--   ADR-013 / ADR-040 (12-tool surface; ADR-040 consolidates the contracts tool name)
--   ADR-038 (composer discipline + access_level; identity_subject lands here)
--   ADR-039 (plan-review state)
--   Audits: docs/architecture/audits/M2-entry-data-model-audit.md
--
-- Findings landed by this migration:
--   H1: composers.identity_subject (OAuth JWT sub claim mapping per ARCH 7.9)
--   L1: composers.active-composer-has-auth-path CHECK
--   M3: drop locks.lock_type (dead 'shared' enum value; only 'exclusive' was used)
--   M4: territories.contracts_consumed (ARCH 6.7.3, ARCH 6.7 ContextResponse)
--   ADR-039: contribution_state += 'plan_review'; contributions plan-review columns;
--            territories.requires_plan_review; pair CHECK + self-approval CHECK
--
-- NOT landed by this migration (per audit):
--   H2 (12-tool surface drift) -> ADR-040 (spec-level; no DDL)
--   H3 (release clears plan_review_approved_*) -> M2 write library extension
--   M1, M2 (CHECKs) -> included below alongside ADR-039 columns
--   M5, M6 (ARCH text drift) -> ARCH text edits in same commit batch
--
-- Append-only invariants preserved:
--   - decisions table append-only triggers from migration 1 are not touched
--   - All changes in this migration are ADD COLUMN / ADD CONSTRAINT / ADD VALUE
--     or DROP a dead column. No existing data migration required.

-- =========================================================================
-- H1 + L1: composers.identity_subject for OAuth JWT mapping (ARCH 7.9)
-- =========================================================================
--
-- The JWT `sub` claim resolves to composers.id via this column. UNIQUE per
-- project (matching the email constraint pattern from audit G3) so that a
-- composer in two projects has two separate composers rows per ADR-015.
--
-- An active composer must have at least one auth path: token_hash (static
-- API token, ARCH 7.9 fallback) or identity_subject (OAuth/dynamic). Suspended
-- or removed composers may have neither (legitimate invite-lifecycle state).

ALTER TABLE composers
  ADD COLUMN identity_subject text;

ALTER TABLE composers
  ADD CONSTRAINT composers_project_identity_subject_uniq
    UNIQUE (project_id, identity_subject);

ALTER TABLE composers
  ADD CONSTRAINT composers_active_has_auth_path CHECK (
    status <> 'active'
    OR token_hash IS NOT NULL
    OR identity_subject IS NOT NULL
  );

COMMENT ON COLUMN composers.identity_subject IS 'ARCH 7.9: JWT sub claim from identity provider; UNIQUE per project per ADR-015. Audit M2-entry H1';

-- =========================================================================
-- M3: drop locks.lock_type entirely (dead enum value 'shared')
-- =========================================================================
--
-- Per audit M2-entry M3 finding: 'shared' was in the lock_kind enum but no
-- ARCH 7.4 / 7.4.1 prose specifies shared-lock semantics. The write library's
-- conflict detection (overlap via Postgres array intersection) treats every
-- lock identically. Dropping the column entirely removes the dead surface;
-- if a shared-lock use case is later identified, the additive path back is
-- straightforward (CREATE TYPE + ALTER TABLE).

ALTER TABLE locks DROP COLUMN lock_type;
DROP TYPE lock_kind;

-- =========================================================================
-- M4: territories.contracts_consumed (ARCH 6.7.3, ARCH 6.7 ContextResponse)
-- =========================================================================
--
-- Per audit M2-entry M4 finding: ARCH 6.7.3 + the ContextResponse shape
-- reference territories.contracts_consumed but the column was missing from
-- migration 1. The get_context implementation (M2) joins this column against
-- contracts.name within project_id to populate the consumed-contracts surface.

ALTER TABLE territories
  ADD COLUMN contracts_consumed text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN territories.contracts_consumed IS 'ARCH 6.7.3: contract names this territory subscribes to; joined against contracts.name within project_id at get_context time. Audit M2-entry M4';

-- =========================================================================
-- ADR-039: plan-review state (per-territory opt-in, default off)
-- =========================================================================
--
-- contribution_state gains 'plan_review' value between 'claimed' and
-- 'in_progress'. Activation per-territory via territories.requires_plan_review
-- (default false). Author-only entry into plan_review; reviewer-with-self-block
-- exit out of plan_review. See ARCH 6.2.1.7 for full lifecycle semantics.
--
-- ALTER TYPE ... ADD VALUE is a non-transactional operation in PostgreSQL.
-- It runs at top-level (not inside a CREATE/ALTER block), and the new value
-- is immediately usable in subsequent statements within this migration.

ALTER TYPE contribution_state ADD VALUE IF NOT EXISTS 'plan_review' BEFORE 'in_progress';

ALTER TABLE contributions
  ADD COLUMN plan_review_approved_by_composer_id uuid REFERENCES composers(id),
  ADD COLUMN plan_review_approved_at             timestamptz;

-- Audit M2-entry M1: pair CHECK -- both populated together or both NULL
-- (matching the existing G2 contributions_approval_pair pattern)
ALTER TABLE contributions
  ADD CONSTRAINT contributions_plan_review_approval_pair CHECK (
    (plan_review_approved_by_composer_id IS NULL  AND plan_review_approved_at IS NULL)
    OR (plan_review_approved_by_composer_id IS NOT NULL AND plan_review_approved_at IS NOT NULL)
  );

-- Audit M2-entry M2: self-approval blocked CHECK
-- (matching the existing contributions_no_self_approval pattern for owner-approval)
ALTER TABLE contributions
  ADD CONSTRAINT contributions_no_plan_review_self_approval CHECK (
    plan_review_approved_by_composer_id IS NULL
    OR plan_review_approved_by_composer_id <> author_composer_id
  );

ALTER TABLE territories
  ADD COLUMN requires_plan_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contributions.plan_review_approved_by_composer_id IS 'ADR-039: immortal identity of the plan-reviewer; populated only when plan was approved (NOT on rejection); cleared on release back to state=open per ARCH 6.2.4 + ADR-039 lifecycle invariant (audit M2-entry H3, enforced at write library)';
COMMENT ON COLUMN contributions.plan_review_approved_at IS 'ADR-039: timestamp of plan approval';
COMMENT ON COLUMN territories.requires_plan_review IS 'ADR-039: per-territory opt-in for plan-review gate; default false. When true, contributions in this territory must transition through state=plan_review before in_progress';
