-- Atelier baseline-extension: backfill atelier_schema_versions rows for
-- migrations 11/12/13.
--
-- The bootstrap migration 20260504000010_atelier_schema_versions.sql
-- hardcoded baseline tracking rows for migrations 1-9 (and itself with
-- the 'bootstrap' sentinel hash). The design intent was that subsequent
-- migrations get tracking rows via scripts/migration/runner.ts on
-- `atelier upgrade --apply`. CI runs `supabase start` which applies
-- migrations via the Supabase CLI; that path does not populate
-- atelier_schema_versions, so the schema-invariants smoke at
-- scripts/test/__smoke__/schema-invariants.smoke.ts:531 fails on every
-- post-merge run because the rows for migrations 11/12/13 are absent.
--
-- This migration backfills those rows with the actual SHA-256 hashes
-- (computed at authoring time; migrations are append-only artifacts per
-- ADR-005, so the hashes are stable). The self-row carries the
-- 'bootstrap' sentinel (matching migration 10's pattern) because the
-- file's own SHA includes its own INSERT statement (chicken-and-egg).
--
-- Production is already correct (the atelier runner inserted tracking
-- rows when applying 11/12/13 via `atelier upgrade --apply --remote`);
-- the ON CONFLICT (filename) DO NOTHING clause makes this migration a
-- no-op there. CI will populate the missing rows on the next
-- `supabase start` cycle.
--
-- Future migrations (15+) should self-track inline rather than relying
-- on subsequent extension migrations. The pattern is:
--
--   INSERT INTO atelier_schema_versions
--     (filename, content_sha256, applied_by, atelier_template_version)
--   VALUES ('<own-filename>', 'bootstrap', 'init', '1.0')
--   ON CONFLICT (filename) DO NOTHING;
--
-- (Self-tracking with the 'bootstrap' sentinel avoids the
-- self-referential SHA chicken-and-egg; the runner skips drift check
-- for sentinel rows. This is the same shape migration 10 uses.)
--
-- Trace:
--   Failure caught by `Substrate audit (merge)` workflow run
--   25378293884 (main @ 56d8d76, PR #78 merge).
--   docs/architecture/audits/v1-comprehensive-grounding-audit.md
--   (M8 grounding audit — final cleanup).

INSERT INTO atelier_schema_versions
  (filename, content_sha256, applied_by, atelier_template_version)
VALUES
  ('20260504000011_atelier_rpc_functions.sql',
   '0d2e07b2971ff4c39f4925a89ca65ddaad98e99017d1c3e270c0bf36966cce86',
   'init', '1.0'),
  ('20260505000012_atelier_pgvector_inner_product.sql',
   '6f98b5a8001f19fd8715419b7c6b4495d9c02e246f3014a8c55a85a60a11f5ca',
   'init', '1.0'),
  ('20260505000013_atelier_webhook_deliveries.sql',
   '7cbf95de325d385dbe2cfbfdcb1dbff02854aa5cff112ae79a16d48508cb4812',
   'init', '1.0'),
  ('20260505000014_atelier_baseline_extension.sql',
   'bootstrap',
   'init', '1.0')
ON CONFLICT (filename) DO NOTHING;
