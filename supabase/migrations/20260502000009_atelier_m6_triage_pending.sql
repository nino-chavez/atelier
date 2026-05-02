-- Atelier M6 triage_pending table
--
-- Per ADR-018 (triage never auto-merges) + ARCH 6.5.2 (triage flow). The
-- existing route-proposal.ts created a contribution when the classifier
-- confidence was above threshold and returned a `routed_to_human_queue`
-- shape (without persistence) when below threshold. M6 lights up the UI
-- surface (FeedbackQueuePanel); the panel needs durable rows to render.
--
-- Trace:
--   BRD: Epic-10 (external integrations), Epic-13 (security/triage)
--   ADR-018 (triage never auto-merges; every external-sourced item
--            requires human approval before becoming a contribution)
--   ADR-033 (contribution.kind = implementation | research | design;
--            requires_owner_approval=true on cross-role authoring)
--   ADR-036 (immortal composer_id alongside operational session_id)
--   ARCH 6.5.2 (Figma comment + design-doc triage flow)
--
-- What this migration adds:
--   - triage_pending table: durable record of below-threshold drafts
--     awaiting human classification. Above-threshold drafts continue
--     to flow into the contributions table directly via claim().
--   - Idempotency on (project_id, comment_source, external_comment_id)
--     so re-polling the same external surface doesn't double-insert.
--   - GIN index on `comment_context` for territory-scoped queries.
--   - Partial index on the "still-pending" subset (no decision yet)
--     so the FeedbackQueuePanel query stays cheap as the rejected
--     archive grows.
--
-- Append-only invariants preserved:
--   triage_pending is mutable in three documented ways:
--     1. routed_to_contribution_id set when human approves + a
--        contribution is created
--     2. rejected_at + decided_by_composer_id set when human rejects
--     3. UPDATE on classification when an LlmClassifier reclassifies
--        a row (preserves the row id; downstream UI shows the most
--        recent classification)
--   No DELETE path at runtime; archival/cleanup is operator-driven
--   per the lifecycle conventions in ARCH §8.x.

-- =========================================================================
-- triage_pending
-- =========================================================================

CREATE TABLE triage_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- External-source identity: what arrived from where, who said it.
  -- The (project_id, comment_source, external_comment_id) tuple is the
  -- idempotency key -- re-polling the same surface MUST NOT re-create
  -- a row.
  comment_source text NOT NULL CHECK (
    comment_source IN ('github', 'jira', 'linear', 'figma', 'confluence', 'notion', 'manual')
  ),
  external_comment_id text NOT NULL,
  external_author text NOT NULL,
  comment_text text NOT NULL,
  comment_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamp with time zone NOT NULL,

  -- Classifier output (latest). Re-classification UPDATEs this column
  -- in place rather than creating a new row.
  classification jsonb NOT NULL,

  -- Drafted proposal body (markdown + suggested action + discipline).
  -- Stored as jsonb because the shape is structured (DraftedProposal
  -- type from scripts/sync/triage/drafter.ts).
  drafted_proposal jsonb NOT NULL,

  -- Routing target: which territory the proposal would belong to if
  -- approved (claim() requires territory_id). Captured at draft time
  -- so the human approver doesn't have to re-pick.
  territory_id uuid NOT NULL REFERENCES territories(id) ON DELETE CASCADE,

  -- Triage system session (per ADR-036 the session_id is operational;
  -- ON DELETE SET NULL preserves the row when the session expires).
  triage_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,

  created_at timestamp with time zone NOT NULL DEFAULT now(),

  -- Decision state (NULL = still-pending). Exactly one of
  -- routed_to_contribution_id / rejected_at is set when decided.
  routed_to_contribution_id uuid REFERENCES contributions(id) ON DELETE SET NULL,
  rejected_at timestamp with time zone,
  rejection_reason text,

  -- Decider identity (immortal per ADR-036; ON DELETE SET NULL).
  decided_by_composer_id uuid REFERENCES composers(id) ON DELETE SET NULL,

  -- Pair invariant: routed and rejected are mutually exclusive.
  CONSTRAINT triage_pending_decision_pair CHECK (
    NOT (routed_to_contribution_id IS NOT NULL AND rejected_at IS NOT NULL)
  ),
  -- When decided (either way), decider must be present.
  CONSTRAINT triage_pending_decided_has_composer CHECK (
    (routed_to_contribution_id IS NULL AND rejected_at IS NULL)
    OR decided_by_composer_id IS NOT NULL
  ),

  -- Idempotency: same external comment cannot land twice in the same
  -- project's pending queue.
  CONSTRAINT triage_pending_external_uniq
    UNIQUE (project_id, comment_source, external_comment_id)
);

-- Project-scoped queue queries (FeedbackQueuePanel default view).
CREATE INDEX triage_pending_project_pending_idx
  ON triage_pending (project_id, created_at DESC)
  WHERE routed_to_contribution_id IS NULL AND rejected_at IS NULL;

-- Project-scoped archive queries (audit trail of past decisions).
CREATE INDEX triage_pending_project_decided_idx
  ON triage_pending (project_id, created_at DESC)
  WHERE routed_to_contribution_id IS NOT NULL OR rejected_at IS NOT NULL;

-- Territory-scoped routing for the review_role lens (ADR-025).
CREATE INDEX triage_pending_territory_idx
  ON triage_pending (territory_id)
  WHERE routed_to_contribution_id IS NULL AND rejected_at IS NULL;

-- Context jsonb queries (e.g., scope_kind=design_component for designer lens).
CREATE INDEX triage_pending_context_gin
  ON triage_pending USING gin (comment_context);

COMMENT ON TABLE triage_pending IS
  'Below-threshold triage drafts awaiting human classification per ADR-018. Above-threshold drafts flow into contributions directly via claim().';

COMMENT ON COLUMN triage_pending.classification IS
  'Latest Classification record from scripts/sync/triage/classifier.ts: { category, confidence, signals }. Re-classification UPDATEs in place.';

COMMENT ON COLUMN triage_pending.drafted_proposal IS
  'DraftedProposal record from scripts/sync/triage/drafter.ts: { category, confidence, bodyMarkdown, suggestedAction, discipline }.';

COMMENT ON COLUMN triage_pending.routed_to_contribution_id IS
  'Set when a human approves and a contribution is created via claim(). Mutually exclusive with rejected_at.';

COMMENT ON COLUMN triage_pending.rejected_at IS
  'Set when a human rejects the draft. Mutually exclusive with routed_to_contribution_id.';

COMMENT ON COLUMN triage_pending.decided_by_composer_id IS
  'Immortal composer who decided (approve or reject). Required when either routed_to_contribution_id or rejected_at is set.';
