-- Atelier M1 schema migration
--
-- Implements ARCH 5.1 entities with ADR-033 / ADR-034 / ADR-035 / ADR-036 /
-- ADR-037 / ADR-038 shapes folded in, plus the supplemental sweep audits
-- (G2 / G3 / G4 / G5 / G6 / G7) and pre-M1 audit fixes (F8 / F11 / F16 / F17).
--
-- Trace:
--   BRD: Epic-2 (M1 schema landing)
--   ADR-021, ADR-024, ADR-027, ADR-033, ADR-034, ADR-035, ADR-036, ADR-037, ADR-038
--   Audits: docs/architecture/audits/pre-M1-data-model-audit.md (F8, F11, F16, F17, G2-G7)
--
-- Scope (per .atelier/checkpoints/SESSION.md step 4.i):
--   Core tables:        contributions, decisions, contracts, locks
--   Supporting tables:  projects, composers, sessions, territories, telemetry
--
-- Out of scope (deferred to later migrations):
--   - Vector / embeddings index (ARCH 5.4) -- gates on D24 at M5 entry
--   - Detailed RLS policies tied to JWT claims -- M2 endpoint hardening
--     (M1 enables RLS with default-deny; service_role bypasses, which is
--      what M1 sync scripts use per SESSION.md step 4.ii-iii)
--
-- Doc drift fixed in the same commit batch:
--   - ARCH 5.1 territories block now lists review_role explicitly (was already
--     canonical via ADR-025 + ARCH 5.3 + .atelier/territories.yaml; the listing
--     was just missing). Self-documenting commit: schema migration + the doc
--     it implements ship together.

-- =========================================================================
-- Extensions
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- =========================================================================
-- Enum types
-- =========================================================================

-- ADR-038: discipline + access_level split
CREATE TYPE composer_discipline    AS ENUM ('analyst', 'dev', 'pm', 'designer', 'architect');
CREATE TYPE composer_access_level  AS ENUM ('member', 'admin', 'stakeholder');
CREATE TYPE composer_status        AS ENUM ('active', 'suspended', 'removed');

CREATE TYPE session_surface        AS ENUM ('ide', 'web', 'terminal', 'passive');
CREATE TYPE session_status         AS ENUM ('active', 'idle', 'dead');

CREATE TYPE territory_scope_kind   AS ENUM ('files', 'doc_region', 'research_artifact', 'design_component', 'slice_config');

-- ADR-034: state drops 'blocked'; blocked is orthogonal via blocked_by IS NOT NULL
CREATE TYPE contribution_state     AS ENUM ('open', 'claimed', 'in_progress', 'review', 'merged', 'rejected');

-- ADR-033: kind drops 'proposal' and 'decision' (cross-role surfaces via requires_owner_approval)
CREATE TYPE contribution_kind      AS ENUM ('implementation', 'research', 'design');

-- ADR-037: category drops vestigial 'convention'
CREATE TYPE decision_category      AS ENUM ('architecture', 'product', 'design', 'research');

CREATE TYPE lock_kind              AS ENUM ('exclusive', 'shared');

-- ADR-035: classifier + override decisions for contracts
CREATE TYPE contract_decision      AS ENUM ('breaking', 'additive');

-- =========================================================================
-- projects
-- =========================================================================

CREATE TABLE projects (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  repo_url          text        NOT NULL,
  default_branch    text        NOT NULL DEFAULT 'main',
  datastore_url     text,
  deploy_url        text,
  template_version  text        NOT NULL,                                   -- audit G7 (validated by atelier upgrade per ARCH 9.7)
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- composers (ADR-038 + audit G3 / G6)
-- =========================================================================

CREATE TABLE composers (
  id                uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid                   NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email             text                   NOT NULL,
  display_name      text                   NOT NULL,
  discipline        composer_discipline,                                                            -- ADR-038 (nullable when access-level-only)
  access_level      composer_access_level  NOT NULL DEFAULT 'member',                               -- ADR-038
  token_hash        text,
  token_issued_at   timestamptz,
  token_rotated_at  timestamptz,                                                                    -- audit G6 (single-timestamp; granular log deferred)
  status            composer_status        NOT NULL DEFAULT 'active',
  created_at        timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT composers_project_email_uniq UNIQUE (project_id, email),                               -- audit G3
  CONSTRAINT composers_role_present CHECK (
    discipline IS NOT NULL OR access_level IN ('admin', 'stakeholder')
  )                                                                                                 -- ADR-038
);

-- =========================================================================
-- sessions (ADR-036 + audit G4 / G5)
-- =========================================================================

CREATE TABLE sessions (
  id            uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid             NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  composer_id   uuid             NOT NULL REFERENCES composers(id) ON DELETE CASCADE,
  surface       session_surface  NOT NULL,
  agent_client  text,                                                                               -- audit G5 (opaque; not validated)
  status        session_status   NOT NULL DEFAULT 'active',                                         -- audit G4 (active|idle|dead transitions per reaper policy)
  heartbeat_at  timestamptz      NOT NULL DEFAULT now(),
  created_at    timestamptz      NOT NULL DEFAULT now()
);

-- =========================================================================
-- territories (ADR-025 + ADR-038 + ADR-003)
-- =========================================================================

CREATE TABLE territories (
  id              uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid                 NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text                 NOT NULL,
  owner_role      composer_discipline  NOT NULL,                                                    -- ADR-038 (typed against discipline enum)
  review_role     composer_discipline,                                                              -- ADR-025 (nullable when same as owner_role)
  scope_kind      territory_scope_kind NOT NULL,                                                    -- ADR-003
  scope_pattern   text[]               NOT NULL,
  created_at      timestamptz          NOT NULL DEFAULT now(),
  CONSTRAINT territories_project_name_uniq UNIQUE (project_id, name),
  CONSTRAINT territories_scope_pattern_nonempty CHECK (cardinality(scope_pattern) > 0)
);

-- =========================================================================
-- contributions (ADR-021, ADR-033, ADR-034, ADR-036; audits F8 / F11 / G2)
-- =========================================================================

CREATE TABLE contributions (
  id                        uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid                 NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_composer_id        uuid                 REFERENCES composers(id),                          -- ADR-036 (NOT NULL when state > 'open' via CHECK below)
  author_session_id         uuid                 REFERENCES sessions(id) ON DELETE SET NULL,        -- ADR-036 (operational; may dangle)
  trace_ids                 text[]               NOT NULL,                                          -- ADR-021
  territory_id              uuid                 NOT NULL REFERENCES territories(id),
  artifact_scope            text[]               NOT NULL,
  state                     contribution_state   NOT NULL DEFAULT 'open',                           -- ADR-034
  kind                      contribution_kind    NOT NULL,                                          -- ADR-033
  requires_owner_approval   boolean              NOT NULL DEFAULT false,                            -- ADR-033 (cross-role authoring gate)
  blocked_by                uuid                 REFERENCES contributions(id),                      -- ADR-034 (orthogonal to lifecycle state)
  blocked_reason            text,                                                                   -- ADR-034
  approved_by_composer_id   uuid                 REFERENCES composers(id),                          -- audit G2
  approved_at               timestamptz,                                                            -- audit G2
  content_ref               text                 NOT NULL,
  transcript_ref            text,                                                                   -- ADR-024 + audit F8
  fencing_token             bigint,
  repo_branch               text,                                                                   -- audit F11
  commit_count              integer              NOT NULL DEFAULT 0,                                -- audit F11
  last_observed_commit_sha  text,                                                                   -- audit F11
  created_at                timestamptz          NOT NULL DEFAULT now(),
  updated_at                timestamptz          NOT NULL DEFAULT now(),

  CONSTRAINT contributions_trace_ids_nonempty CHECK (cardinality(trace_ids) > 0),                   -- ADR-021
  CONSTRAINT contributions_artifact_scope_nonempty CHECK (cardinality(artifact_scope) > 0),
  CONSTRAINT contributions_transcript_ref_shape CHECK (
    transcript_ref IS NULL
    OR transcript_ref LIKE 'transcripts/%'
    OR transcript_ref ~ '^https?://'
  ),                                                                                                -- ADR-024 + audit F8
  CONSTRAINT contributions_author_when_claimed CHECK (
    state = 'open' OR author_composer_id IS NOT NULL
  ),                                                                                                -- ADR-036
  CONSTRAINT contributions_approval_pair CHECK (
    (approved_by_composer_id IS NULL  AND approved_at IS NULL)
    OR (approved_by_composer_id IS NOT NULL AND approved_at IS NOT NULL)
  ),                                                                                                -- audit G2
  CONSTRAINT contributions_no_self_approval CHECK (
    approved_by_composer_id IS NULL
    OR approved_by_composer_id <> author_composer_id
  ),                                                                                                -- ARCH 5.3
  CONSTRAINT contributions_no_self_block CHECK (
    blocked_by IS NULL OR blocked_by <> id
  ),
  CONSTRAINT contributions_blocked_reason_pair CHECK (
    blocked_reason IS NULL OR blocked_by IS NOT NULL
  )                                                                                                 -- ADR-034 (reason only when actually blocked)
);

-- =========================================================================
-- decisions (ADR-005 / ADR-021 / ADR-036 / ADR-037; append-only)
-- =========================================================================

CREATE TABLE decisions (
  id                            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                    uuid                NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_composer_id            uuid                NOT NULL REFERENCES composers(id),              -- ADR-036
  session_id                    uuid                REFERENCES sessions(id) ON DELETE SET NULL,     -- ADR-036
  trace_ids                     text[]              NOT NULL,                                       -- ADR-021 + audit F16
  category                      decision_category   NOT NULL,                                       -- ADR-037
  triggered_by_contribution_id  uuid                REFERENCES contributions(id),                   -- ADR-037
  summary                       text                NOT NULL,
  rationale                     text                NOT NULL,
  reverses                      uuid                REFERENCES decisions(id),
  repo_commit_sha               text                NOT NULL,
  created_at                    timestamptz         NOT NULL DEFAULT now(),
  CONSTRAINT decisions_trace_ids_nonempty CHECK (cardinality(trace_ids) > 0),                       -- ADR-021
  CONSTRAINT decisions_no_self_reverse CHECK (reverses IS NULL OR reverses <> id)
);

-- ADR-005 + ARCH 7.6: append-only enforced via trigger so the rule applies
-- even to service_role (which bypasses RLS).
CREATE OR REPLACE FUNCTION decisions_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'decisions table is append-only (ADR-005, ARCH 7.6); % rejected', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decisions_block_update
  BEFORE UPDATE ON decisions
  FOR EACH ROW EXECUTE FUNCTION decisions_block_mutation();

CREATE TRIGGER decisions_block_delete
  BEFORE DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION decisions_block_mutation();

-- =========================================================================
-- locks (ADR-036; audits F11 / F17)
-- =========================================================================

CREATE TABLE locks (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  holder_composer_id  uuid         NOT NULL REFERENCES composers(id),                               -- ADR-036
  session_id          uuid         REFERENCES sessions(id) ON DELETE SET NULL,                      -- ADR-036 (reaper releases first per ARCH 6.1)
  contribution_id     uuid         NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,         -- audit F11 (multiple locks per contribution permitted)
  artifact_scope      text[]       NOT NULL,
  fencing_token       bigint       NOT NULL,                                                        -- monotonic per project; write-lib enforces (M1 step 4.ii)
  lock_type           lock_kind    NOT NULL DEFAULT 'exclusive',
  acquired_at         timestamptz  NOT NULL DEFAULT now(),
  expires_at          timestamptz,                                                                  -- audit F17 (soft hint)
  CONSTRAINT locks_artifact_scope_nonempty CHECK (cardinality(artifact_scope) > 0),
  CONSTRAINT locks_fencing_token_positive  CHECK (fencing_token > 0)
);

-- =========================================================================
-- contracts (ADR-035)
-- =========================================================================

CREATE TABLE contracts (
  id                       uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid                NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  territory_id             uuid                NOT NULL REFERENCES territories(id),
  name                     text                NOT NULL,
  schema                   jsonb               NOT NULL,
  version                  integer             NOT NULL,                                            -- semver-encoded major*1000+minor per ARCH 6.6.1
  published_at             timestamptz         NOT NULL DEFAULT now(),
  classifier_decision      contract_decision   NOT NULL,                                            -- ADR-035
  classifier_reasons       jsonb               NOT NULL DEFAULT '[]'::jsonb,                       -- ADR-035
  override_decision        contract_decision,                                                       -- ADR-035 (nullable when no override)
  override_justification   text,                                                                    -- ADR-035 (required when override present)
  effective_decision       contract_decision   GENERATED ALWAYS AS (
    COALESCE(override_decision, classifier_decision)
  ) STORED,                                                                                         -- ADR-035
  CONSTRAINT contracts_override_justification_present CHECK (
    override_decision IS NULL
    OR (override_justification IS NOT NULL AND length(trim(override_justification)) > 0)
  ),                                                                                                -- ADR-035
  CONSTRAINT contracts_version_positive CHECK (version > 0),
  CONSTRAINT contracts_project_name_version_uniq UNIQUE (project_id, name, version)
);

-- =========================================================================
-- telemetry (ADR-036)
-- =========================================================================

CREATE TABLE telemetry (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  composer_id  uuid         REFERENCES composers(id),                                               -- ADR-036 (nullable: system-emitted events)
  session_id   uuid         REFERENCES sessions(id) ON DELETE SET NULL,                             -- ADR-036
  action       text         NOT NULL,
  outcome      text,
  duration_ms  integer,
  metadata     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

-- =========================================================================
-- updated_at trigger (contributions only -- decisions/locks/contracts/telemetry
-- have no updated_at by design)
-- =========================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contributions_set_updated_at
  BEFORE UPDATE ON contributions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- Indexes (per ARCH 5.2)
-- =========================================================================

-- contributions
CREATE INDEX contributions_project_state_idx       ON contributions (project_id, state);
CREATE INDEX contributions_territory_state_idx     ON contributions (territory_id, state);
CREATE INDEX contributions_owned_active_idx        ON contributions (author_session_id)
  WHERE state IN ('claimed', 'in_progress');                                                        -- session-reap reclaim path
CREATE INDEX contributions_trace_ids_gin           ON contributions USING GIN (trace_ids);          -- ADR-021

-- sessions
CREATE INDEX sessions_project_status_idx           ON sessions (project_id, status);
CREATE INDEX sessions_stale_active_idx             ON sessions (heartbeat_at) WHERE status = 'active';

-- locks
CREATE INDEX locks_project_scope_gin               ON locks USING GIN (artifact_scope);             -- conflict check
CREATE INDEX locks_contribution_idx                ON locks (contribution_id);                       -- per-contribution release path
CREATE INDEX locks_session_idx                     ON locks (session_id) WHERE session_id IS NOT NULL;

-- decisions
CREATE INDEX decisions_project_recent_idx          ON decisions (project_id, created_at DESC);
CREATE INDEX decisions_trace_ids_gin               ON decisions USING GIN (trace_ids);              -- ADR-021

-- telemetry
CREATE INDEX telemetry_project_action_recent_idx   ON telemetry (project_id, action, created_at DESC);

-- =========================================================================
-- Row-level security (M1 scaffold; M2 endpoint hardens)
-- =========================================================================
--
-- Per ARCH 5.3, every table is project_id-scoped and the immortal
-- composer_id is the authorization key (per ADR-036). M1 enables RLS with
-- default-deny: no policies are defined, so non-bypass roles cannot read or
-- write. The M1 sync scripts run under service_role (which bypasses RLS).
--
-- M2 endpoint hardening adds composer-scoped policies that map JWT claims
-- (sub / email) to composers.id. Splitting RLS detail across two milestones
-- keeps M1 from blocking on auth integration that does not exist yet.

ALTER TABLE projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE composers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE territories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry     ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- Migration verification helpers (no-op in production; consumed by round-trip
-- integrity test at M1 exit per scripts/README.md)
-- =========================================================================

COMMENT ON TABLE projects      IS 'ARCH 5.1 / ADR-027';
COMMENT ON TABLE composers     IS 'ARCH 5.1 / ADR-036 / ADR-038';
COMMENT ON TABLE sessions      IS 'ARCH 5.1 / ADR-036; status transitions per audit G4';
COMMENT ON TABLE territories   IS 'ARCH 5.1 / ADR-003 / ADR-025';
COMMENT ON TABLE contributions IS 'ARCH 5.1 / ADR-021 / ADR-033 / ADR-034 / ADR-036; audits F8/F11/G2';
COMMENT ON TABLE decisions     IS 'ARCH 5.1 / ADR-005 / ADR-021 / ADR-036 / ADR-037; append-only via trigger';
COMMENT ON TABLE locks         IS 'ARCH 5.1 / ADR-036; audits F11/F17';
COMMENT ON TABLE contracts     IS 'ARCH 5.1 / ADR-035; effective_decision is GENERATED';
COMMENT ON TABLE telemetry     IS 'ARCH 5.1 / ADR-036';
