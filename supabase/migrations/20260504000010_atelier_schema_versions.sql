-- Atelier schema-version tracking (E1 substrate; precondition for E2 atelier upgrade)
--
-- Per BRD-OPEN-QUESTIONS section 29 (atelier upgrade scope-deferral). This is the
-- substrate the runner under scripts/migration/ uses to track which migration
-- files have been applied to a given Atelier datastore. Operationalizes
-- ADR-005 (append-only discipline -- migrations are append-only too) and
-- ADR-027 (Supabase Postgres reference -- the table lives in the same
-- coordination datastore the rest of the substrate writes to).
--
-- Trace:
--   BRD-OPEN-QUESTIONS section 29 (atelier upgrade flow; this PR partial-resolves
--                                  by landing the substrate; E2 completes via CLI)
--   ADR-005, ADR-027, ADR-029
--   ARCH 9.7 (template-upgrade flow; this is the migration-tracking primitive)
--
-- What this migration adds:
--   - atelier_schema_versions table. One row per applied migration; PRIMARY KEY
--     on filename so re-application is a no-op.
--   - Baseline INSERT for the 9 existing migrations (M1 through M6 schema work)
--     with their canonical content_sha256 values hard-coded. The hashes are
--     stable (these files are append-only artifacts per ADR-005).
--   - Self-row for THIS migration with content_sha256='bootstrap'. The runner
--     treats 'bootstrap' as a sentinel (skip hash comparison) since the file's
--     own hash includes its own INSERT statement (chicken-and-egg). Adopters
--     who modify the bootstrap row's hash recompute on first runner-side apply.
--
-- Idempotency contract (the brief is explicit):
--   - CREATE TABLE IF NOT EXISTS so re-running supabase db reset --local
--     repeatedly is safe.
--   - INSERT ... ON CONFLICT (filename) DO NOTHING so the baseline rows can
--     be re-applied without erroring.
--   - This migration MUST stay idempotent forever; do not add operations
--     that fail on second run.
--
-- Append-only discipline (per ADR-005):
--   - The runner inserts rows on apply. UPDATE / DELETE on this table is
--     allowed at v1 (operators may need to manually fix corrupt entries
--     post-incident). When E2 lands, an append-only trigger may follow if
--     adopter signal warrants. v1 does NOT enforce trigger-level append-only
--     because the column semantics are strictly informational (not
--     load-bearing for any decision flow at runtime).

CREATE TABLE IF NOT EXISTS atelier_schema_versions (
  filename                  text        PRIMARY KEY,
  applied_at                timestamptz NOT NULL DEFAULT now(),
  content_sha256            text        NOT NULL,
  applied_by                text        NOT NULL DEFAULT 'init',
  atelier_template_version  text        NOT NULL
);

COMMENT ON TABLE atelier_schema_versions IS
  'Per-migration apply tracking for the Atelier datastore. Populated by '
  'scripts/migration/runner.ts on apply, and bootstrapped here for '
  'migrations applied via the Supabase CLI before the runner exists. '
  'See docs/architecture/schema/migration-system.md for the full contract.';

COMMENT ON COLUMN atelier_schema_versions.content_sha256 IS
  'SHA-256 of the migration file content at apply time. The runner '
  'compares against the on-disk file in computeStatus() to flag '
  'adopter-modified files. Sentinel value "bootstrap" means the row was '
  'inserted by this migration itself (the file hash is self-referential '
  'so we cannot record it inline; the runner backfills on first apply '
  'of a subsequent migration).';

COMMENT ON COLUMN atelier_schema_versions.applied_by IS
  'Operational metadata: composer email when applied via atelier upgrade, '
  '"init" when applied via supabase db reset / supabase db push, "manual" '
  'when applied directly via psql. Informational only.';

COMMENT ON COLUMN atelier_schema_versions.atelier_template_version IS
  'The .atelier/config.yaml: project.template_version at apply time. '
  'Lets adopters trace which Atelier release each migration came from.';

-- Baseline rows for the 9 migrations applied via supabase CLI before this
-- table existed. Hashes are SHA-256 of each file's content, computed once
-- at authoring time. These migrations are canonical append-only artifacts
-- (per ADR-005); their content does not change. If a hash mismatch occurs,
-- the adopter has modified the migration file -- a defensible deviation
-- the runner reports via computeStatus().modified.

INSERT INTO atelier_schema_versions (filename, content_sha256, applied_by, atelier_template_version)
VALUES
  ('20260428000001_atelier_m1_schema.sql',          'd716cb4b0f9169efc1865a1a8e36e2847101fc7b00d72affc3b29206a3194a74', 'init', '1.0'),
  ('20260428000002_atelier_m1_counters.sql',        'be01f8b57c2546a836c92bd2187edfae4e58d4c1b98fd5c11ebd0c6ea3300913', 'init', '1.0'),
  ('20260428000003_atelier_delivery_sync_state.sql','62af8cb6e4939b71b3e4d198d813ada288c1cd419865e6a19e3bdb1b1f7a3812', 'init', '1.0'),
  ('20260430000004_atelier_m2_entry_schema.sql',    '51cc6e2d125233c094658b3cd998e65c76d51fce246643718e0d2666eb6313dc', 'init', '1.0'),
  ('20260430000005_atelier_m4_broadcast_seq.sql',   '193bff7125bfbd27b3cff65e0cc1098847fead28de87759acd3eeeba30b50721', 'init', '1.0'),
  ('20260501000006_atelier_m5_embeddings.sql',      '24bae47db47a608d21b3d3f5881fb2a24790e7b88aedeed5d15a22541e59967b', 'init', '1.0'),
  ('20260501000007_atelier_m5_embeddings_dim_3072.sql', '3e392978979ae9cfe5eb203d302308fd04df7e314660c16c460b89b501caaf84', 'init', '1.0'),
  ('20260501000008_atelier_m5_embeddings_dim_1536.sql', '156adddce00eba6bed17407b111655caa2cc8077db20e6b49736dfc4b3381fe0', 'init', '1.0'),
  ('20260502000009_atelier_m6_triage_pending.sql',  'da7d40567551e731fb0ea55073dbe0cd407e093931d35402104d837a1ed4db10', 'init', '1.0'),
  ('20260504000010_atelier_schema_versions.sql',    'bootstrap',                                                       'init', '1.0')
ON CONFLICT (filename) DO NOTHING;
