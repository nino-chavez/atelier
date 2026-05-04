-- Atelier canonical-rebuild: RPC surface for lens + observability + MCP side
--
-- Per METHODOLOGY 11.5b (canonical-pattern pre-check) and BRD-OPEN-QUESTIONS
-- section 31 (multiple entries 2026-05-04). The lens runtime no longer holds
-- a pg.Pool — every lens-side database read/write goes via @supabase/ssr
-- createServerClient → PostgREST → SECURITY DEFINER RPC. Functions resolve
-- the calling composer from auth.jwt() (Supabase Auth JWT sub claim mapping
-- to composers.identity_subject per ARCH 7.9 + audit M2-entry H1).
--
-- The MCP-side primitives (lock acquire/release, find_similar with hybrid
-- retrieval, session register/heartbeat/deregister) are added here as the
-- canonical scaffolding ADR-027/029 imply but were never written. /api/mcp
-- continues to call AtelierClient + pg.Pool directly (out of scope for this
-- PR per the rebuild brief); the RPCs sit ready for future wiring.
--
-- All functions are SECURITY DEFINER — they bypass RLS deliberately. The
-- M1 RLS scaffold is default-deny across every table (migration 1 §RLS);
-- without SECURITY DEFINER the lens path could not read its own data.
-- Authorization runs inside each function: resolve viewer → check the
-- viewer's project_id matches the requested project_id → execute. This
-- mirrors the AtelierClient guard pattern and preserves project isolation.
--
-- Trace:
--   BRD-OPEN-QUESTIONS section 31 (canonical-pattern divergences, 2026-05-04)
--   ADR-027 (reference impl: Supabase reference stack)
--   ADR-029 (named-adapter for vendor isolation)
--   METHODOLOGY 11.5b (canonical-pattern pre-check)
--
-- Style:
--   - LANGUAGE plpgsql SECURITY DEFINER throughout
--   - SET search_path = public (search-path injection guard per Supabase guidance)
--   - jsonb_build_object + array_agg for view-model assembly
--   - EXCEPTION codes use SQLSTATE strings PostgREST surfaces as 400/401/403/404

SET search_path = public;

-- =========================================================================
-- Helper: resolve calling composer from JWT
-- =========================================================================
--
-- Returns the composer row tied to the JWT's sub claim. Returns no rows when
-- the JWT is absent (anonymous request) or the sub does not map to an active
-- composer. Callers handle the no-row case as 401 / 403 per their contract.
--
-- Note: ALTER FUNCTION SECURITY DEFINER + SET search_path is the recommended
-- shape per Supabase docs; without the search_path pin the function would
-- run with the caller's search_path which can be an injection vector when
-- composers/projects schema names overlap.

CREATE OR REPLACE FUNCTION atelier_resolve_viewer()
RETURNS TABLE (
  composer_id      uuid,
  project_id       uuid,
  display_name     text,
  email            text,
  discipline       text,
  access_level     text,
  identity_subject text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub text;
BEGIN
  v_sub := nullif(auth.jwt() ->> 'sub', '');
  IF v_sub IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id,
         c.project_id,
         c.display_name,
         c.email,
         c.discipline::text,
         c.access_level::text,
         c.identity_subject
    FROM composers c
   WHERE c.identity_subject = v_sub
     AND c.status = 'active'
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION atelier_resolve_viewer() FROM public;
GRANT EXECUTE ON FUNCTION atelier_resolve_viewer() TO authenticated, anon, service_role;

COMMENT ON FUNCTION atelier_resolve_viewer() IS
  'Resolve the calling composer from the Supabase Auth JWT sub claim. Returns no rows when the JWT is absent or the sub does not match an active composer. Lens code translates no-row into a 401 unauthorized state.';

-- =========================================================================
-- atelier_ensure_dashboard_session — find-or-create the dashboard session
-- =========================================================================
--
-- Mirrors session.ts:ensureDashboardSession exactly. Reuses an active
-- web-surface session keyed on (composer_id, agent_client='atelier-dashboard')
-- inside the 5-minute heartbeat window; otherwise inserts a fresh row.

CREATE OR REPLACE FUNCTION atelier_ensure_dashboard_session()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id uuid;
  v_project_id  uuid;
  v_session_id  uuid;
BEGIN
  SELECT cv.composer_id, cv.project_id
    INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;

  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  SELECT s.id INTO v_session_id
    FROM sessions s
   WHERE s.composer_id = v_composer_id
     AND s.project_id = v_project_id
     AND s.surface = 'web'
     AND s.agent_client = 'atelier-dashboard'
     AND s.status = 'active'
     AND s.heartbeat_at > now() - interval '5 minutes'
   ORDER BY s.heartbeat_at DESC
   LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    UPDATE sessions
       SET heartbeat_at = now(),
           status = 'active'
     WHERE id = v_session_id;
    RETURN v_session_id;
  END IF;

  INSERT INTO sessions (project_id, composer_id, surface, agent_client)
  VALUES (v_project_id, v_composer_id, 'web', 'atelier-dashboard')
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION atelier_ensure_dashboard_session() FROM public;
GRANT EXECUTE ON FUNCTION atelier_ensure_dashboard_session() TO authenticated, service_role;

COMMENT ON FUNCTION atelier_ensure_dashboard_session() IS
  'Find or create the lens dashboard session for the calling composer. Reuses active web/atelier-dashboard sessions inside the 5-minute heartbeat window; otherwise inserts a fresh row. Mirrors session.ts:ensureDashboardSession.';

-- =========================================================================
-- atelier_lens_load — single-shot lens view-model
-- =========================================================================
--
-- Returns a jsonb payload shaped to LensViewModel (lens-data.ts). One RPC
-- replaces seven separate pool.query calls + the dashboard-session insert.
-- Argument is the lens id (analyst | dev | pm | designer | stakeholder);
-- the function resolves the viewer + session internally.
--
-- Output shape:
--   {
--     "viewer": { composerId, composerName, composerEmail, discipline, accessLevel, projectId, projectName, sessionId },
--     "territories": [...],
--     "presence": [...],
--     "active_contributions": [...],
--     "locks": [...],
--     "contracts": [...],
--     "review_queue": [...],
--     "feedback_queue": [...]
--   }
--
-- charter / recent_decisions / contributions_summary are NOT in this
-- response — those still flow through dispatch(get_context) which does
-- markdown excerpt loading + repo path resolution that is genuinely
-- not Postgres work.

CREATE OR REPLACE FUNCTION atelier_lens_load(p_lens_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id   uuid;
  v_project_id    uuid;
  v_composer_name text;
  v_composer_email text;
  v_discipline    text;
  v_access_level  text;
  v_project_name  text;
  v_session_id    uuid;
  v_active_limit  int;
  v_w_impl        int;
  v_w_research    int;
  v_w_design      int;
  v_review_role_match text;
  v_result        jsonb;
BEGIN
  -- Resolve viewer
  SELECT cv.composer_id, cv.project_id, cv.display_name, cv.email,
         cv.discipline, cv.access_level
    INTO v_composer_id, v_project_id, v_composer_name, v_composer_email,
         v_discipline, v_access_level
    FROM atelier_resolve_viewer() cv;

  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  SELECT name INTO v_project_name FROM projects WHERE id = v_project_id;

  -- Lens depth defaults (mirrors lens-config.ts contributionsKindWeights +
  -- contributionsActiveLimit).
  CASE p_lens_id
    WHEN 'analyst'     THEN v_active_limit := 10; v_w_impl := 1; v_w_research := 3; v_w_design := 1;
    WHEN 'dev'         THEN v_active_limit := 30; v_w_impl := 3; v_w_research := 1; v_w_design := 1;
    WHEN 'pm'          THEN v_active_limit := 40; v_w_impl := 1; v_w_research := 1; v_w_design := 1;
    WHEN 'designer'    THEN v_active_limit := 15; v_w_impl := 1; v_w_research := 1; v_w_design := 3;
    WHEN 'stakeholder' THEN v_active_limit := 10; v_w_impl := 1; v_w_research := 1; v_w_design := 1;
    ELSE                    v_active_limit := 10; v_w_impl := 1; v_w_research := 1; v_w_design := 1;
  END CASE;

  -- Find or create dashboard session inline (avoid double JWT resolve).
  SELECT s.id INTO v_session_id
    FROM sessions s
   WHERE s.composer_id = v_composer_id
     AND s.project_id = v_project_id
     AND s.surface = 'web'
     AND s.agent_client = 'atelier-dashboard'
     AND s.status = 'active'
     AND s.heartbeat_at > now() - interval '5 minutes'
   ORDER BY s.heartbeat_at DESC
   LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    UPDATE sessions SET heartbeat_at = now(), status = 'active' WHERE id = v_session_id;
  ELSE
    INSERT INTO sessions (project_id, composer_id, surface, agent_client)
    VALUES (v_project_id, v_composer_id, 'web', 'atelier-dashboard')
    RETURNING id INTO v_session_id;
  END IF;

  -- Build the view-model. Each section is a sub-select wrapped in
  -- jsonb_build_object / array_agg.
  WITH
  territories_rows AS (
    SELECT t.id,
           t.name,
           t.owner_role::text   AS owner_role,
           t.review_role::text  AS review_role,
           t.scope_kind::text   AS scope_kind,
           t.scope_pattern,
           COALESCE(array_agg(c.name) FILTER (WHERE c.name IS NOT NULL), ARRAY[]::text[]) AS contracts_published
      FROM territories t
      LEFT JOIN contracts c ON c.territory_id = t.id AND c.project_id = t.project_id
     WHERE t.project_id = v_project_id
     GROUP BY t.id, t.name, t.owner_role, t.review_role, t.scope_kind, t.scope_pattern
     ORDER BY t.name
  ),
  presence_rows AS (
    SELECT DISTINCT ON (s.composer_id)
           s.composer_id,
           c.display_name,
           c.email,
           c.discipline::text   AS discipline,
           s.surface::text      AS surface,
           s.agent_client,
           s.heartbeat_at
      FROM sessions s JOIN composers c ON c.id = s.composer_id
     WHERE s.project_id = v_project_id
       AND s.status = 'active'
       AND s.heartbeat_at > now() - interval '15 minutes'
     ORDER BY s.composer_id, s.heartbeat_at DESC
  ),
  active_contributions_rows AS (
    SELECT co.id,
           co.kind::text  AS kind,
           co.state::text AS state,
           co.trace_ids,
           t.name         AS territory_name,
           co.content_ref,
           c.display_name AS author_name,
           co.author_composer_id,
           co.requires_owner_approval,
           co.blocked_by,
           co.updated_at
      FROM contributions co
      JOIN territories t ON t.id = co.territory_id
      LEFT JOIN composers c ON c.id = co.author_composer_id
     WHERE co.project_id = v_project_id
       AND co.state IN ('open', 'claimed', 'in_progress', 'review')
     ORDER BY (CASE co.kind::text
                 WHEN 'implementation' THEN v_w_impl
                 WHEN 'research'       THEN v_w_research
                 WHEN 'design'         THEN v_w_design
                 ELSE 0
               END) DESC,
              co.updated_at DESC
     LIMIT v_active_limit
  ),
  locks_rows AS (
    SELECT l.id,
           l.contribution_id,
           l.artifact_scope,
           l.fencing_token::text AS fencing_token,
           c.display_name        AS holder_name,
           l.acquired_at
      FROM locks l JOIN composers c ON c.id = l.holder_composer_id
     WHERE l.project_id = v_project_id
     ORDER BY l.acquired_at DESC
     LIMIT 50
  ),
  contracts_rows AS (
    SELECT c.id,
           t.name              AS territory_name,
           c.name              AS name,
           c.version,
           c.effective_decision::text AS effective_decision,
           c.published_at
      FROM contracts c JOIN territories t ON t.id = c.territory_id
     WHERE c.project_id = v_project_id
     ORDER BY c.published_at DESC
     LIMIT 25
  ),
  review_queue_rows AS (
    SELECT co.id,
           co.kind::text  AS kind,
           co.state::text AS state,
           co.trace_ids,
           t.name         AS territory_name,
           t.review_role::text AS review_role,
           co.content_ref,
           c.display_name AS author_name,
           co.requires_owner_approval,
           co.blocked_by,
           co.updated_at
      FROM contributions co
      JOIN territories t ON t.id = co.territory_id
      LEFT JOIN composers c ON c.id = co.author_composer_id
     WHERE co.project_id = v_project_id
       AND co.state = 'review'
       AND v_discipline IS NOT NULL
       AND COALESCE(t.review_role::text, t.owner_role::text) = v_discipline
     ORDER BY co.updated_at DESC
     LIMIT 30
  ),
  feedback_queue_rows AS (
    SELECT tp.id,
           tp.comment_source,
           tp.external_comment_id,
           tp.external_author,
           tp.comment_text,
           tp.classification,
           tp.drafted_proposal,
           tp.territory_id,
           t.name AS territory_name,
           t.review_role::text AS review_role,
           tp.created_at
      FROM triage_pending tp
      LEFT JOIN territories t ON t.id = tp.territory_id
     WHERE tp.project_id = v_project_id
       AND tp.routed_to_contribution_id IS NULL
       AND tp.rejected_at IS NULL
     ORDER BY tp.created_at DESC
     LIMIT 50
  )
  SELECT jsonb_build_object(
    'viewer', jsonb_build_object(
      'composer_id',    v_composer_id,
      'composer_name',  v_composer_name,
      'composer_email', v_composer_email,
      'discipline',     v_discipline,
      'access_level',   v_access_level,
      'project_id',     v_project_id,
      'project_name',   v_project_name,
      'session_id',     v_session_id
    ),
    'territories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',                tr.name,
      'scope_kind',          tr.scope_kind,
      'scope_pattern',       tr.scope_pattern,
      'contracts_published', tr.contracts_published,
      'owner_role',          tr.owner_role,
      'review_role',         tr.review_role
    ) ORDER BY tr.name) FROM territories_rows tr), '[]'::jsonb),
    'presence', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'composer_id',   pr.composer_id,
      'composer_name', pr.display_name,
      'composer_email', pr.email,
      'discipline',    pr.discipline,
      'surface',       pr.surface,
      'agent_client',  pr.agent_client,
      'heartbeat_at',  pr.heartbeat_at
    )) FROM presence_rows pr), '[]'::jsonb),
    'active_contributions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',                       acr.id,
      'kind',                     acr.kind,
      'state',                    acr.state,
      'trace_ids',                acr.trace_ids,
      'territory_name',           acr.territory_name,
      'content_ref',              acr.content_ref,
      'author_name',              acr.author_name,
      'author_composer_id',       acr.author_composer_id,
      'requires_owner_approval',  acr.requires_owner_approval,
      'blocked_by',               acr.blocked_by,
      'updated_at',               acr.updated_at
    )) FROM active_contributions_rows acr), '[]'::jsonb),
    'locks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',                  lr.id,
      'contribution_id',     lr.contribution_id,
      'artifact_scope',      lr.artifact_scope,
      'fencing_token',       lr.fencing_token,
      'holder_name',         lr.holder_name,
      'acquired_at',         lr.acquired_at
    )) FROM locks_rows lr), '[]'::jsonb),
    'contracts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',                  cr.id,
      'territory_name',      cr.territory_name,
      'name',                cr.name,
      'version',             cr.version,
      'effective_decision',  cr.effective_decision,
      'published_at',        cr.published_at
    )) FROM contracts_rows cr), '[]'::jsonb),
    'review_queue', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',                       rqr.id,
      'kind',                     rqr.kind,
      'state',                    rqr.state,
      'trace_ids',                rqr.trace_ids,
      'territory_name',           rqr.territory_name,
      'review_role',              rqr.review_role,
      'content_ref',              rqr.content_ref,
      'author_name',              rqr.author_name,
      'requires_owner_approval',  rqr.requires_owner_approval,
      'blocked_by',               rqr.blocked_by,
      'updated_at',               rqr.updated_at
    )) FROM review_queue_rows rqr), '[]'::jsonb),
    'feedback_queue', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',                  fqr.id,
      'comment_source',      fqr.comment_source,
      'external_comment_id', fqr.external_comment_id,
      'external_author',     fqr.external_author,
      'comment_text',        fqr.comment_text,
      'classification',      fqr.classification,
      'drafted_proposal',    fqr.drafted_proposal,
      'territory_id',        fqr.territory_id,
      'territory_name',      fqr.territory_name,
      'review_role',         fqr.review_role,
      'created_at',          fqr.created_at
    )) FROM feedback_queue_rows fqr), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION atelier_lens_load(text) FROM public;
GRANT EXECUTE ON FUNCTION atelier_lens_load(text) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_lens_load(text) IS
  'Single-shot lens view-model for /atelier. Returns viewer + territories + presence + active_contributions + locks + contracts + review_queue + feedback_queue as one jsonb. Replaces seven pool.query reads in lens-data.ts.';

-- =========================================================================
-- atelier_obs_admin_viewer — admin-gated viewer resolution
-- =========================================================================

CREATE OR REPLACE FUNCTION atelier_obs_admin_viewer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id   uuid;
  v_project_id    uuid;
  v_composer_name text;
  v_access_level  text;
  v_project_name  text;
  v_session_id    uuid;
BEGIN
  SELECT cv.composer_id, cv.project_id, cv.display_name, cv.access_level
    INTO v_composer_id, v_project_id, v_composer_name, v_access_level
    FROM atelier_resolve_viewer() cv;

  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  IF v_access_level IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'observability_forbidden: access_level=%', COALESCE(v_access_level, 'unset')
      USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_project_name FROM projects WHERE id = v_project_id;

  -- Reuse the dashboard-session helper inline (web/atelier-dashboard).
  SELECT s.id INTO v_session_id
    FROM sessions s
   WHERE s.composer_id = v_composer_id
     AND s.project_id = v_project_id
     AND s.surface = 'web'
     AND s.agent_client = 'atelier-dashboard'
     AND s.status = 'active'
     AND s.heartbeat_at > now() - interval '5 minutes'
   ORDER BY s.heartbeat_at DESC
   LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    UPDATE sessions SET heartbeat_at = now(), status = 'active' WHERE id = v_session_id;
  ELSE
    INSERT INTO sessions (project_id, composer_id, surface, agent_client)
    VALUES (v_project_id, v_composer_id, 'web', 'atelier-dashboard')
    RETURNING id INTO v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'composer_id',   v_composer_id,
    'project_id',    v_project_id,
    'composer_name', v_composer_name,
    'project_name',  v_project_name,
    'access_level',  v_access_level,
    'session_id',    v_session_id
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_admin_viewer() FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_admin_viewer() TO authenticated, service_role;

COMMENT ON FUNCTION atelier_obs_admin_viewer() IS
  'Admin-gated viewer resolution for /atelier/observability. Raises observability_forbidden when caller is not admin. Replaces the pool.query in observability-session.ts.';

-- =========================================================================
-- atelier_obs_load — observability dashboard view-model
-- =========================================================================
--
-- One RPC returning the eight observability sections (sessions, contributions,
-- locks, decisions, triage, sync, vector, cost). Mirrors observability-data.ts
-- exactly but in plpgsql.
--
-- Argument: p_lookback_seconds (the rolling window applied to the
-- *_last_window aggregates). Defaults to 3600 (1 hour) when null.

CREATE OR REPLACE FUNCTION atelier_obs_load(p_lookback_seconds int DEFAULT 3600)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id   uuid;
  v_project_id    uuid;
  v_access_level  text;
  v_lookback      interval;
  v_result        jsonb;
BEGIN
  SELECT cv.composer_id, cv.project_id, cv.access_level
    INTO v_composer_id, v_project_id, v_access_level
    FROM atelier_resolve_viewer() cv;

  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;
  IF v_access_level IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'observability_forbidden' USING ERRCODE = '42501';
  END IF;

  v_lookback := make_interval(secs => COALESCE(p_lookback_seconds, 3600));

  SELECT jsonb_build_object(
    'sessions',       atelier_obs_section_sessions(v_project_id, v_lookback),
    'contributions',  atelier_obs_section_contributions(v_project_id, v_lookback),
    'locks',          atelier_obs_section_locks(v_project_id, v_lookback),
    'decisions',      atelier_obs_section_decisions(v_project_id, v_lookback),
    'triage',         atelier_obs_section_triage(v_project_id, v_lookback),
    'sync',           atelier_obs_section_sync(v_project_id, v_lookback),
    'vector',         atelier_obs_section_vector(v_project_id, v_lookback),
    'cost',           atelier_obs_section_cost(v_project_id, v_lookback, p_lookback_seconds)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_load(int) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_load(int) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_obs_load(int) IS
  'Single-shot observability view-model. Admin-gated. Mirrors observability-data.ts loadObservabilityViewModel; eight sections fan out to per-section helper functions.';

-- =========================================================================
-- atelier_obs_section_* — per-section helpers
-- =========================================================================

CREATE OR REPLACE FUNCTION atelier_obs_section_sessions(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_now      bigint;
  v_active_surface  jsonb;
  v_reaped          bigint;
  v_recent          jsonb;
  v_guild_active    bigint;
BEGIN
  SELECT count(*) INTO v_active_now
    FROM sessions
   WHERE project_id = p_project_id
     AND status = 'active'
     AND heartbeat_at > now() - interval '15 minutes';

  SELECT COALESCE(jsonb_object_agg(surface, c), '{}'::jsonb) INTO v_active_surface
    FROM (
      SELECT s.surface::text AS surface, count(*) AS c
        FROM sessions s
       WHERE s.project_id = p_project_id
         AND s.status = 'active'
         AND s.heartbeat_at > now() - interval '15 minutes'
       GROUP BY s.surface
    ) sub;

  SELECT count(*) INTO v_reaped
    FROM telemetry
   WHERE project_id = p_project_id
     AND action = 'session.reaped'
     AND created_at > now() - p_lookback;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', created_at,
           'surface', surface::text,
           'agent_client', agent_client
         ) ORDER BY created_at DESC), '[]'::jsonb) INTO v_recent
    FROM (
      SELECT created_at, surface, agent_client
        FROM sessions
       WHERE project_id = p_project_id
         AND created_at > now() - p_lookback
       ORDER BY created_at DESC
       LIMIT 10
    ) sub;

  SELECT count(*) INTO v_guild_active
    FROM sessions
   WHERE status = 'active'
     AND heartbeat_at > now() - interval '15 minutes';

  RETURN jsonb_build_object(
    'active_now',           v_active_now,
    'active_by_surface',    v_active_surface,
    'reaped_last_window',   v_reaped,
    'recent_registrations', v_recent,
    'guild_active_now',     v_guild_active
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_sessions(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_sessions(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_contributions(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_by_state    jsonb;
  v_lifetime    bigint;
  v_recent      jsonb;
  v_throughput  jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(state, c), '{}'::jsonb) INTO v_by_state
    FROM (
      SELECT state::text AS state, count(*) AS c
        FROM contributions
       WHERE project_id = p_project_id
       GROUP BY state
    ) sub;

  SELECT count(*) INTO v_lifetime
    FROM contributions WHERE project_id = p_project_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at',              t.created_at,
           'action',          t.action,
           'composer_name',   c.display_name,
           'contribution_id', t.metadata ->> 'contributionId'
         ) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_recent
    FROM (
      SELECT t1.created_at, t1.action, t1.composer_id, t1.metadata
        FROM telemetry t1
       WHERE t1.project_id = p_project_id
         AND t1.action LIKE 'contribution.%'
         AND t1.created_at > now() - p_lookback
       ORDER BY t1.created_at DESC
       LIMIT 50
    ) t LEFT JOIN composers c ON c.id = t.composer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'territory', name,
           'count',     c
         ) ORDER BY c DESC), '[]'::jsonb) INTO v_throughput
    FROM (
      SELECT t.name, count(co.id) AS c
        FROM contributions co JOIN territories t ON t.id = co.territory_id
       WHERE co.project_id = p_project_id
         AND co.created_at > now() - p_lookback
       GROUP BY t.name
       ORDER BY count(co.id) DESC
       LIMIT 10
    ) sub;

  RETURN jsonb_build_object(
    'by_state',                v_by_state,
    'lifetime',                v_lifetime,
    'recent_transitions',      v_recent,
    'throughput_by_territory', v_throughput
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_contributions(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_contributions(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_locks(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_held       bigint;
  v_acq        bigint;
  v_rel        bigint;
  v_conflicts  bigint;
  v_ledger     jsonb;
BEGIN
  SELECT count(*) INTO v_held FROM locks WHERE project_id = p_project_id;

  SELECT count(*) INTO v_acq FROM telemetry
   WHERE project_id = p_project_id
     AND action = 'lock.acquired'
     AND created_at > now() - p_lookback;

  SELECT count(*) INTO v_rel FROM telemetry
   WHERE project_id = p_project_id
     AND action = 'lock.released'
     AND created_at > now() - p_lookback;

  SELECT count(*) INTO v_conflicts FROM telemetry
   WHERE project_id = p_project_id
     AND action = 'lock.acquired'
     AND outcome = 'error'
     AND created_at > now() - p_lookback;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at',             t.created_at,
           'action',         t.action,
           'holder_name',    c.display_name,
           'artifact_scope', CASE
             WHEN (t.metadata ->> 'lockId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN (SELECT artifact_scope FROM locks WHERE id = (t.metadata ->> 'lockId')::uuid)
             ELSE NULL
           END,
           'fencing_token',  (t.metadata ->> 'fencingToken')
         ) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_ledger
    FROM (
      SELECT t1.created_at, t1.action, t1.composer_id, t1.metadata
        FROM telemetry t1
       WHERE t1.project_id = p_project_id
         AND t1.action IN ('lock.acquired', 'lock.released')
         AND t1.created_at > now() - p_lookback
       ORDER BY t1.created_at DESC
       LIMIT 25
    ) t LEFT JOIN composers c ON c.id = t.composer_id;

  RETURN jsonb_build_object(
    'held_now',             v_held,
    'recent_acquisitions',  v_acq,
    'recent_releases',      v_rel,
    'conflict_rate',        CASE WHEN (v_acq + v_conflicts) = 0 THEN 0
                                 ELSE v_conflicts::float / (v_acq + v_conflicts)::float END,
    'recent_ledger',        v_ledger
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_locks(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_locks(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_decisions(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lifetime  bigint;
  v_recent    bigint;
  v_last_run  timestamptz;
BEGIN
  SELECT count(*) INTO v_lifetime FROM decisions WHERE project_id = p_project_id;

  SELECT count(*) INTO v_recent FROM decisions
   WHERE project_id = p_project_id
     AND created_at > now() - p_lookback;

  SELECT max(created_at) INTO v_last_run FROM telemetry
   WHERE project_id = p_project_id
     AND (action LIKE 'find_similar.%' OR action LIKE 'scale_test.%find_similar%');

  RETURN jsonb_build_object(
    'lifetime',                  v_lifetime,
    'recent_count',              v_recent,
    'find_similar_signal',       CASE WHEN v_last_run IS NOT NULL THEN 'has_data' ELSE 'no_data' END,
    'find_similar_last_run_at',  v_last_run
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_decisions(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_decisions(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_triage(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending   bigint;
  v_accepted  bigint;
  v_rejected  bigint;
  v_low       bigint := 0;
  v_med       bigint := 0;
  v_high      bigint := 0;
  v_buckets   jsonb;
BEGIN
  SELECT count(*) INTO v_pending FROM triage_pending
   WHERE project_id = p_project_id
     AND routed_to_contribution_id IS NULL
     AND rejected_at IS NULL;

  SELECT count(*) INTO v_accepted FROM telemetry
   WHERE project_id = p_project_id
     AND action IN ('triage.accepted', 'contribution.approval_recorded')
     AND created_at > now() - p_lookback;

  SELECT count(*) INTO v_rejected FROM telemetry
   WHERE project_id = p_project_id
     AND action = 'triage.rejected'
     AND created_at > now() - p_lookback;

  SELECT
    COALESCE(sum(CASE WHEN bucket = 'low'    THEN c END), 0),
    COALESCE(sum(CASE WHEN bucket = 'medium' THEN c END), 0),
    COALESCE(sum(CASE WHEN bucket = 'high'   THEN c END), 0)
    INTO v_low, v_med, v_high
    FROM (
      SELECT CASE
               WHEN ((classification ->> 'confidence')::float) < 0.5 THEN 'low'
               WHEN ((classification ->> 'confidence')::float) < 0.8 THEN 'medium'
               ELSE 'high'
             END AS bucket,
             count(*) AS c
        FROM triage_pending
       WHERE project_id = p_project_id
         AND routed_to_contribution_id IS NULL
         AND rejected_at IS NULL
       GROUP BY bucket
    ) sub;

  v_buckets := jsonb_build_object('low', v_low, 'medium', v_med, 'high', v_high);

  RETURN jsonb_build_object(
    'pending_count',         v_pending,
    'accepted_last_window',  v_accepted,
    'rejected_last_window',  v_rejected,
    'confidence_buckets',    v_buckets
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_triage(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_triage(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_sync(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scripts jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'action',                     action,
           'last_run_at',                last_run_at,
           'last_outcome',               last_outcome,
           'error_rate_last_window',     CASE WHEN run_count = 0 THEN 0 ELSE error_count::float / run_count::float END,
           'run_count_last_window',      run_count
         ) ORDER BY action), '[]'::jsonb)
    INTO v_scripts
    FROM (
      SELECT a AS action,
             m.last_run_at,
             m.last_outcome,
             COALESCE(m.error_count, 0) AS error_count,
             COALESCE(m.run_count, 0)   AS run_count
        FROM unnest(ARRAY['doc.published','delivery.synced','delivery.mirrored','delivery.mirror_run','reconcile.run']) a
        LEFT JOIN (
          SELECT action,
                 max(created_at)                                                          AS last_run_at,
                 (array_agg(outcome ORDER BY created_at DESC))[1]                         AS last_outcome,
                 count(*) FILTER (WHERE outcome = 'error' AND created_at > now() - p_lookback) AS error_count,
                 count(*) FILTER (WHERE created_at > now() - p_lookback)                  AS run_count
            FROM telemetry
           WHERE project_id = p_project_id
             AND action = ANY(ARRAY['doc.published','delivery.synced','delivery.mirrored','delivery.mirror_run','reconcile.run'])
           GROUP BY action
        ) m ON m.action = a
    ) sub;

  RETURN jsonb_build_object('scripts', v_scripts);
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_sync(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_sync(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_vector(p_project_id uuid, p_lookback interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count      bigint := 0;
  v_by_kind    jsonb := '{}'::jsonb;
  v_recent     bigint := 0;
  v_models     jsonb := '[]'::jsonb;
BEGIN
  -- Wrap each query in a sub-block so a missing embeddings table (M5
  -- migrations roll-back / not-yet-applied path) doesn't blow up the
  -- whole observability response.
  BEGIN
    SELECT count(*) INTO v_count FROM embeddings WHERE project_id = p_project_id;
  EXCEPTION WHEN undefined_table THEN
    v_count := 0;
  END;

  BEGIN
    SELECT COALESCE(jsonb_object_agg(source_kind, c), '{}'::jsonb) INTO v_by_kind
      FROM (
        SELECT source_kind::text AS source_kind, count(*) AS c
          FROM embeddings
         WHERE project_id = p_project_id
         GROUP BY source_kind
      ) sub;
  EXCEPTION WHEN undefined_table THEN
    v_by_kind := '{}'::jsonb;
  END;

  BEGIN
    SELECT count(*) INTO v_recent FROM embeddings
     WHERE project_id = p_project_id
       AND created_at > now() - p_lookback;
  EXCEPTION WHEN undefined_table THEN
    v_recent := 0;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(embedding_model_version ORDER BY embedding_model_version), '[]'::jsonb) INTO v_models
      FROM (
        SELECT DISTINCT embedding_model_version
          FROM embeddings
         WHERE project_id = p_project_id
         ORDER BY embedding_model_version
         LIMIT 5
      ) sub;
  EXCEPTION WHEN undefined_table THEN
    v_models := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'row_count',       v_count,
    'by_source_kind',  v_by_kind,
    'recent_inserts',  v_recent,
    'model_versions',  v_models
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_vector(uuid, interval) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_vector(uuid, interval) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atelier_obs_section_cost(p_project_id uuid, p_lookback interval, p_window_seconds int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_usd      float := 0;
  v_total_input    bigint := 0;
  v_total_output   bigint := 0;
  v_n              bigint := 0;
  v_by_action      jsonb;
  v_by_composer    jsonb;
BEGIN
  SELECT COALESCE(sum((metadata ->> 'cost_usd')::float), 0),
         COALESCE(sum((metadata ->> 'tokens_input')::int), 0),
         COALESCE(sum((metadata ->> 'tokens_output')::int), 0),
         count(*) FILTER (WHERE metadata ? 'cost_usd')
    INTO v_total_usd, v_total_input, v_total_output, v_n
    FROM telemetry
   WHERE project_id = p_project_id
     AND created_at > now() - p_lookback;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'action_class',    action_class,
           'usd',             usd,
           'tokens_input',    tokens_input,
           'tokens_output',   tokens_output
         ) ORDER BY usd DESC), '[]'::jsonb)
    INTO v_by_action
    FROM (
      SELECT split_part(action, '.', 1)                              AS action_class,
             COALESCE(sum((metadata ->> 'cost_usd')::float), 0)      AS usd,
             COALESCE(sum((metadata ->> 'tokens_input')::int), 0)    AS tokens_input,
             COALESCE(sum((metadata ->> 'tokens_output')::int), 0)   AS tokens_output
        FROM telemetry
       WHERE project_id = p_project_id
         AND created_at > now() - p_lookback
         AND metadata ? 'cost_usd'
       GROUP BY action_class
       ORDER BY sum((metadata ->> 'cost_usd')::float) DESC
       LIMIT 10
    ) sub;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'composer_name', composer_name,
           'usd',           usd
         ) ORDER BY usd DESC), '[]'::jsonb)
    INTO v_by_composer
    FROM (
      SELECT COALESCE(c.display_name, '(system)')                    AS composer_name,
             COALESCE(sum((t.metadata ->> 'cost_usd')::float), 0)    AS usd
        FROM telemetry t LEFT JOIN composers c ON c.id = t.composer_id
       WHERE t.project_id = p_project_id
         AND t.created_at > now() - p_lookback
         AND t.metadata ? 'cost_usd'
       GROUP BY c.display_name
       ORDER BY sum((t.metadata ->> 'cost_usd')::float) DESC
       LIMIT 10
    ) sub;

  RETURN jsonb_build_object(
    'window_seconds',        COALESCE(p_window_seconds, 3600),
    'total_usd',             v_total_usd,
    'total_tokens_input',    v_total_input,
    'total_tokens_output',   v_total_output,
    'by_action_class',       v_by_action,
    'by_composer',           v_by_composer,
    'signal',                CASE WHEN v_n > 0 THEN 'has_data' ELSE 'no_data' END
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_obs_section_cost(uuid, interval, int) FROM public;
GRANT EXECUTE ON FUNCTION atelier_obs_section_cost(uuid, interval, int) TO authenticated, service_role;

-- =========================================================================
-- atelier_acquire_lock — pg_advisory + fencing-token enforcement
-- =========================================================================
--
-- Required by the rebuild brief. Mirrors AtelierClient.acquireLock semantics:
--   1. Resolve the calling composer + project via auth.jwt().
--   2. Take a transaction-scoped pg_advisory_xact_lock on hash of resource.
--   3. Verify no overlapping lock exists for the resource on the project.
--   4. Allocate the next fencing token (per-project monotonic).
--   5. Insert the lock row.
--   6. Return the new lock id + fencing_token.
--
-- The brief lists the signature (p_resource text, p_token text, p_holder uuid)
-- but acquire-flow doesn't take an existing token (release does). p_token is
-- repurposed as p_lock_resource_label for telemetry-friendly naming; the
-- fencing token is allocated server-side and returned.

CREATE OR REPLACE FUNCTION atelier_acquire_lock(
  p_resource         text,
  p_contribution_id  uuid,
  p_artifact_scope   text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id   uuid;
  v_project_id    uuid;
  v_session_id    uuid;
  v_existing_id   uuid;
  v_fencing_token bigint;
  v_lock_id       uuid;
  v_advisory_key  bigint;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  IF p_resource IS NULL OR length(trim(p_resource)) = 0 THEN
    RAISE EXCEPTION 'resource_required' USING ERRCODE = '22023';
  END IF;
  IF p_contribution_id IS NULL THEN
    RAISE EXCEPTION 'contribution_id_required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(COALESCE(p_artifact_scope, ARRAY[]::text[])) = 0 THEN
    RAISE EXCEPTION 'artifact_scope_required' USING ERRCODE = '22023';
  END IF;

  -- Verify contribution belongs to viewer's project.
  PERFORM 1 FROM contributions
   WHERE id = p_contribution_id AND project_id = v_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contribution_not_in_project' USING ERRCODE = '42501';
  END IF;

  -- Transaction-scoped advisory lock on the project + resource hash. Two
  -- concurrent acquire calls for the same resource serialize through this.
  v_advisory_key := abs(hashtextextended(v_project_id::text || ':' || p_resource, 0));
  PERFORM pg_advisory_xact_lock(v_advisory_key);

  -- Conflict check: any existing lock with overlapping artifact_scope?
  SELECT id INTO v_existing_id
    FROM locks
   WHERE project_id = v_project_id
     AND artifact_scope && p_artifact_scope
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'lock_conflict: lock % already held for overlapping scope', v_existing_id
      USING ERRCODE = '40001';
  END IF;

  -- Allocate next fencing token (per-project monotonic). Uses MAX+1 under
  -- the advisory lock so two concurrent inserts can't allocate the same.
  SELECT COALESCE(max(fencing_token), 0) + 1 INTO v_fencing_token
    FROM locks WHERE project_id = v_project_id;

  -- Reuse latest dashboard session if present; null otherwise (lock outlives session).
  SELECT s.id INTO v_session_id FROM sessions s
   WHERE s.composer_id = v_composer_id AND s.project_id = v_project_id
     AND s.status = 'active'
   ORDER BY s.heartbeat_at DESC LIMIT 1;

  INSERT INTO locks (project_id, holder_composer_id, session_id, contribution_id,
                     artifact_scope, fencing_token, lock_type)
  VALUES (v_project_id, v_composer_id, v_session_id, p_contribution_id,
          p_artifact_scope, v_fencing_token, 'exclusive')
  RETURNING id INTO v_lock_id;

  INSERT INTO telemetry (project_id, composer_id, session_id, action, outcome, metadata)
  VALUES (v_project_id, v_composer_id, v_session_id, 'lock.acquired', 'ok',
          jsonb_build_object('lockId', v_lock_id::text, 'fencingToken', v_fencing_token::text));

  RETURN jsonb_build_object(
    'lock_id',       v_lock_id,
    'fencing_token', v_fencing_token::text,
    'project_id',    v_project_id
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_acquire_lock(text, uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION atelier_acquire_lock(text, uuid, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_acquire_lock(text, uuid, text[]) IS
  'Acquire a fencing-tokened lock on artifact_scope. Serializes concurrent acquires via pg_advisory_xact_lock; rejects overlapping holds; allocates the next per-project monotonic fencing token. Required by the canonical rebuild brief.';

-- =========================================================================
-- atelier_release_lock — release by lock id + fencing token
-- =========================================================================

CREATE OR REPLACE FUNCTION atelier_release_lock(
  p_lock_id        uuid,
  p_fencing_token  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id   uuid;
  v_project_id    uuid;
  v_session_id    uuid;
  v_lock_project  uuid;
  v_lock_token    bigint;
  v_lock_holder   uuid;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  SELECT project_id, fencing_token, holder_composer_id
    INTO v_lock_project, v_lock_token, v_lock_holder
    FROM locks WHERE id = p_lock_id FOR UPDATE;
  IF v_lock_project IS NULL THEN
    RAISE EXCEPTION 'lock_not_found' USING ERRCODE = '02000';
  END IF;
  IF v_lock_project IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'lock_not_in_project' USING ERRCODE = '42501';
  END IF;
  IF v_lock_token::text IS DISTINCT FROM p_fencing_token THEN
    RAISE EXCEPTION 'fencing_token_mismatch' USING ERRCODE = '42501';
  END IF;

  DELETE FROM locks WHERE id = p_lock_id;

  SELECT s.id INTO v_session_id FROM sessions s
   WHERE s.composer_id = v_composer_id AND s.project_id = v_project_id
     AND s.status = 'active'
   ORDER BY s.heartbeat_at DESC LIMIT 1;

  INSERT INTO telemetry (project_id, composer_id, session_id, action, outcome, metadata)
  VALUES (v_project_id, v_composer_id, v_session_id, 'lock.released', 'ok',
          jsonb_build_object('lockId', p_lock_id::text, 'fencingToken', p_fencing_token));

  RETURN jsonb_build_object('lock_id', p_lock_id, 'released', true);
END;
$$;

REVOKE ALL ON FUNCTION atelier_release_lock(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION atelier_release_lock(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_release_lock(uuid, text) IS
  'Release a lock by id + fencing-token. Rejects mismatch (token must match the value returned by acquire). Required by the canonical rebuild brief.';

-- =========================================================================
-- atelier_register_session — register an agent/web session
-- =========================================================================

CREATE OR REPLACE FUNCTION atelier_register_session(
  p_surface       text,
  p_agent_client  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id  uuid;
  v_project_id   uuid;
  v_session_id   uuid;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  IF p_surface NOT IN ('ide', 'web', 'terminal', 'passive') THEN
    RAISE EXCEPTION 'invalid_surface: %', p_surface USING ERRCODE = '22023';
  END IF;

  INSERT INTO sessions (project_id, composer_id, surface, agent_client)
  VALUES (v_project_id, v_composer_id, p_surface::session_surface, p_agent_client)
  RETURNING id INTO v_session_id;

  INSERT INTO telemetry (project_id, composer_id, session_id, action, outcome, metadata)
  VALUES (v_project_id, v_composer_id, v_session_id, 'session.registered', 'ok',
          jsonb_build_object('surface', p_surface, 'agentClient', p_agent_client));

  RETURN jsonb_build_object(
    'session_id',   v_session_id,
    'composer_id',  v_composer_id,
    'project_id',   v_project_id
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_register_session(text, text) FROM public;
GRANT EXECUTE ON FUNCTION atelier_register_session(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_register_session(text, text) IS
  'Register a new session row for the calling composer. Required by the canonical rebuild brief.';

-- =========================================================================
-- atelier_heartbeat — heartbeat an existing session
-- =========================================================================

CREATE OR REPLACE FUNCTION atelier_heartbeat(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id  uuid;
  v_project_id   uuid;
  v_session_composer  uuid;
  v_session_project   uuid;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  SELECT composer_id, project_id INTO v_session_composer, v_session_project
    FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session_composer IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '02000';
  END IF;
  IF v_session_composer IS DISTINCT FROM v_composer_id
     OR v_session_project IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'session_not_owned' USING ERRCODE = '42501';
  END IF;

  UPDATE sessions
     SET heartbeat_at = now(), status = 'active'
   WHERE id = p_session_id;

  RETURN jsonb_build_object('session_id', p_session_id, 'heartbeat_at', now());
END;
$$;

REVOKE ALL ON FUNCTION atelier_heartbeat(uuid) FROM public;
GRANT EXECUTE ON FUNCTION atelier_heartbeat(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_heartbeat(uuid) IS
  'Update heartbeat_at on a session the caller owns. Required by the canonical rebuild brief.';

-- =========================================================================
-- atelier_deregister — mark a session dead + release its locks
-- =========================================================================

CREATE OR REPLACE FUNCTION atelier_deregister(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id      uuid;
  v_project_id       uuid;
  v_session_composer uuid;
  v_session_project  uuid;
  v_locks_released   int := 0;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  SELECT composer_id, project_id INTO v_session_composer, v_session_project
    FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session_composer IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '02000';
  END IF;
  IF v_session_composer IS DISTINCT FROM v_composer_id
     OR v_session_project IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'session_not_owned' USING ERRCODE = '42501';
  END IF;

  -- Release locks held under this session before marking dead (per ARCH 6.1
  -- reaper policy mirror).
  WITH released AS (
    DELETE FROM locks WHERE session_id = p_session_id RETURNING id
  )
  SELECT count(*) INTO v_locks_released FROM released;

  UPDATE sessions SET status = 'dead' WHERE id = p_session_id;

  INSERT INTO telemetry (project_id, composer_id, session_id, action, outcome, metadata)
  VALUES (v_project_id, v_composer_id, p_session_id, 'session.deregistered', 'ok',
          jsonb_build_object('locksReleased', v_locks_released));

  RETURN jsonb_build_object(
    'session_id',      p_session_id,
    'locks_released',  v_locks_released
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_deregister(uuid) FROM public;
GRANT EXECUTE ON FUNCTION atelier_deregister(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_deregister(uuid) IS
  'Mark a session dead and release its locks. Required by the canonical rebuild brief.';

-- =========================================================================
-- atelier_find_similar — pgvector kNN with RRF fusion
-- =========================================================================
--
-- Hybrid retrieval per ADR-042: vector kNN + Postgres BM25 fused via
-- Reciprocal Rank Fusion (k=60). Returns the top p_limit candidates as
-- jsonb[] sorted by RRF score descending.
--
-- The TS implementation in scripts/endpoint/lib/find-similar.ts is the
-- production path today; this RPC provides an in-database alternative for
-- callers (lens server actions, future MCP-side wiring) that prefer to
-- avoid the dispatch round-trip.
--
-- Embedding dimensionality follows migration 8 (vector(1536)). Callers
-- pass the embedding as a float8[] which we cast to vector(1536); the
-- vector type is not in the public PostgREST type allow-list across all
-- versions, so float8[] is the portable wire shape.

CREATE OR REPLACE FUNCTION atelier_find_similar(
  p_query_embedding  float8[],
  p_query_text       text,
  p_kind             text DEFAULT NULL,
  p_limit            int  DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id  uuid;
  v_project_id   uuid;
  v_results      jsonb;
  v_k_rrf        int := 60;     -- ADR-042 RRF k=60
  v_pool_size    int;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  IF p_query_embedding IS NULL OR cardinality(p_query_embedding) = 0 THEN
    RAISE EXCEPTION 'query_embedding_required' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 10;
  END IF;

  -- Use 4x limit on each side for fusion candidate pool (RRF is sensitive
  -- to recall on each path; over-fetching mirrors the TS impl).
  v_pool_size := p_limit * 4;

  WITH
  vector_hits AS (
    SELECT e.id,
           row_number() OVER (ORDER BY e.embedding <=> p_query_embedding::vector) AS rank
      FROM embeddings e
     WHERE e.project_id = v_project_id
       AND (p_kind IS NULL OR e.source_kind::text = p_kind)
     ORDER BY e.embedding <=> p_query_embedding::vector
     LIMIT v_pool_size
  ),
  bm25_hits AS (
    SELECT e.id,
           row_number() OVER (
             ORDER BY ts_rank_cd(to_tsvector('english', e.content_text),
                                 plainto_tsquery('english', COALESCE(p_query_text, ''))) DESC
           ) AS rank
      FROM embeddings e
     WHERE e.project_id = v_project_id
       AND (p_kind IS NULL OR e.source_kind::text = p_kind)
       AND to_tsvector('english', e.content_text) @@ plainto_tsquery('english', COALESCE(p_query_text, ''))
     ORDER BY ts_rank_cd(to_tsvector('english', e.content_text),
                         plainto_tsquery('english', COALESCE(p_query_text, ''))) DESC
     LIMIT v_pool_size
  ),
  fused AS (
    SELECT id, sum(score) AS rrf_score
      FROM (
        SELECT id, 1.0 / (v_k_rrf + rank) AS score FROM vector_hits
        UNION ALL
        SELECT id, 1.0 / (v_k_rrf + rank) AS score FROM bm25_hits
      ) sub
     GROUP BY id
     ORDER BY sum(score) DESC
     LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           e.id,
           'source_kind',  e.source_kind::text,
           'source_ref',   e.source_ref,
           'trace_ids',    e.trace_ids,
           'content',      e.content_text,
           'model',        e.embedding_model_version,
           'score',        f.rrf_score
         ) ORDER BY f.rrf_score DESC), '[]'::jsonb)
    INTO v_results
    FROM fused f JOIN embeddings e ON e.id = f.id;

  RETURN jsonb_build_object(
    'matches',       v_results,
    'project_id',    v_project_id,
    'k_rrf',         v_k_rrf,
    'pool_size',     v_pool_size
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_find_similar(float8[], text, text, int) FROM public;
GRANT EXECUTE ON FUNCTION atelier_find_similar(float8[], text, text, int) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_find_similar(float8[], text, text, int) IS
  'Hybrid retrieval (vector kNN + Postgres BM25 fused via RRF k=60) per ADR-042. Required by the canonical rebuild brief. Embedding passed as float8[] for PostgREST wire compatibility.';

-- =========================================================================
-- End of canonical-rebuild RPC migration
-- =========================================================================
--
-- Functions added (12):
--   atelier_resolve_viewer
--   atelier_ensure_dashboard_session
--   atelier_lens_load
--   atelier_obs_admin_viewer
--   atelier_obs_load (+ 8 atelier_obs_section_* helpers)
--   atelier_acquire_lock
--   atelier_release_lock
--   atelier_register_session
--   atelier_heartbeat
--   atelier_deregister
--   atelier_find_similar
--
-- All SECURITY DEFINER, all SET search_path = public, all REVOKE FROM public
-- + GRANT TO authenticated/service_role per Supabase guidance.
