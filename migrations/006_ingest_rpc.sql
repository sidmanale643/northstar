-- Migration 006: Transactional ingestion RPC and security configuration

-- ============================================================
-- Transactional Ingest RPC
-- ============================================================
-- Accepts one validated ingest batch and persists it atomically.
-- - Upserts entities by stable UUID (retries are idempotent).
-- - Rejects records whose project_id does not match the authenticated project.
-- - Rolls back the full batch on any failure.

CREATE OR REPLACE FUNCTION private.ingest_batch(
    p_project_id UUID,
    p_sessions   JSONB DEFAULT '[]'::jsonb,
    p_runs       JSONB DEFAULT '[]'::jsonb,
    p_spans      JSONB DEFAULT '[]'::jsonb,
    p_events     JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
DECLARE
    v_session  JSONB;
    v_run      JSONB;
    v_span     JSONB;
    v_event    JSONB;
    v_count    INT;
    v_sessions INT := 0;
    v_runs     INT := 0;
    v_spans    INT := 0;
    v_events   INT := 0;
BEGIN
    -- Sessions
    FOR v_session IN SELECT * FROM jsonb_array_elements(p_sessions)
    LOOP
        IF (v_session->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'session % belongs to a different project', v_session->>'id';
        END IF;

        INSERT INTO private.sessions (id, project_id, created_at, ended_at, metadata)
        VALUES (
            (v_session->>'id')::uuid,
            (v_session->>'project_id')::uuid,
            (v_session->>'created_at')::timestamptz,
            (v_session->>'ended_at')::timestamptz,
            COALESCE(v_session->'metadata', '{}'::jsonb)
        )
        ON CONFLICT (id) DO UPDATE SET
            ended_at  = COALESCE(EXCLUDED.ended_at, private.sessions.ended_at),
            metadata  = EXCLUDED.metadata;

        v_sessions := v_sessions + 1;
    END LOOP;

    -- Runs
    FOR v_run IN SELECT * FROM jsonb_array_elements(p_runs)
    LOOP
        IF (v_run->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'run % belongs to a different project', v_run->>'id';
        END IF;

        INSERT INTO private.runs (id, session_id, project_id, name, started_at, ended_at, status, error, metadata)
        VALUES (
            (v_run->>'id')::uuid,
            (v_run->>'session_id')::uuid,
            (v_run->>'project_id')::uuid,
            v_run->>'name',
            (v_run->>'started_at')::timestamptz,
            (v_run->>'ended_at')::timestamptz,
            v_run->>'status',
            v_run->'error',
            COALESCE(v_run->'metadata', '{}'::jsonb)
        )
        ON CONFLICT (id) DO UPDATE SET
            ended_at = COALESCE(EXCLUDED.ended_at, private.runs.ended_at),
            status   = EXCLUDED.status,
            error    = EXCLUDED.error,
            metadata = EXCLUDED.metadata;

        v_runs := v_runs + 1;
    END LOOP;

    -- Spans
    FOR v_span IN SELECT * FROM jsonb_array_elements(p_spans)
    LOOP
        IF (v_span->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'span % belongs to a different project', v_span->>'id';
        END IF;

        INSERT INTO private.spans (
            id, run_id, project_id, parent_span_id, kind, name,
            started_at, ended_at, status, error, iteration, attributes
        )
        VALUES (
            (v_span->>'id')::uuid,
            (v_span->>'run_id')::uuid,
            (v_span->>'project_id')::uuid,
            (v_span->>'parent_span_id')::uuid,
            v_span->>'kind',
            v_span->>'name',
            (v_span->>'started_at')::timestamptz,
            (v_span->>'ended_at')::timestamptz,
            v_span->>'status',
            v_span->'error',
            (v_span->>'iteration')::int,
            COALESCE(v_span->'attributes', '{}'::jsonb)
        )
        ON CONFLICT (id) DO UPDATE SET
            ended_at   = COALESCE(EXCLUDED.ended_at, private.spans.ended_at),
            status     = EXCLUDED.status,
            error      = EXCLUDED.error,
            attributes = EXCLUDED.attributes;

        v_spans := v_spans + 1;
    END LOOP;

    -- Events
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
    LOOP
        IF (v_event->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'event % belongs to a different project', v_event->>'id';
        END IF;

        INSERT INTO private.events (id, run_id, span_id, project_id, type, created_at, content, attributes)
        VALUES (
            (v_event->>'id')::uuid,
            (v_event->>'run_id')::uuid,
            (v_event->>'span_id')::uuid,
            (v_event->>'project_id')::uuid,
            v_event->>'type',
            (v_event->>'created_at')::timestamptz,
            v_event->'content',
            COALESCE(v_event->'attributes', '{}'::jsonb)
        )
        ON CONFLICT (id) DO UPDATE SET
            content    = EXCLUDED.content,
            attributes = EXCLUDED.attributes;

        v_events := v_events + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'accepted', true,
        'counts', jsonb_build_object(
            'sessions', v_sessions,
            'runs',     v_runs,
            'spans',    v_spans,
            'events',   v_events
        )
    );
END;
$$;

-- ============================================================
-- API key helpers
-- ============================================================

-- Resolve an API key by its SHA-256 hash. Returns the project_id if the key
-- is active (not revoked). The Edge Function hashes the bearer token and calls
-- this to authenticate requests without exposing raw keys.
CREATE OR REPLACE FUNCTION private.resolve_api_key(p_key_hash TEXT)
RETURNS TABLE (key_id UUID, project_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
    SELECT ak.id AS key_id, ak.project_id
    FROM private.api_keys ak
    WHERE ak.key_hash = p_key_hash
      AND ak.revoked_at IS NULL;
$$;

-- Revoke an API key. Scoped to a project so a compromised key in one project
-- cannot be used to revoke keys in another.
CREATE OR REPLACE FUNCTION private.revoke_api_key(p_key_id UUID, p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
BEGIN
    UPDATE private.api_keys
    SET revoked_at = now()
    WHERE id = p_key_id
      AND project_id = p_project_id
      AND revoked_at IS NULL;

    RETURN FOUND;
END;
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
-- Enable RLS on all private tables. These policies govern direct table access
-- (e.g., dashboard queries). The ingest RPC uses SECURITY DEFINER and bypasses
-- RLS for writes, but validates project_id programmatically.

ALTER TABLE private.projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.api_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.spans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.events    ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Grants
-- ============================================================
-- service_role: used by Edge Functions and server-side code.
-- anon/authenticated: Supabase Data API roles. No access to private tables.

GRANT USAGE ON SCHEMA private TO service_role;

GRANT SELECT, INSERT, UPDATE ON private.projects TO service_role;
GRANT SELECT, INSERT, UPDATE ON private.api_keys TO service_role;
GRANT SELECT, INSERT, UPDATE ON private.sessions TO service_role;
GRANT SELECT, INSERT, UPDATE ON private.runs     TO service_role;
GRANT SELECT, INSERT, UPDATE ON private.spans    TO service_role;
GRANT SELECT, INSERT, UPDATE ON private.events   TO service_role;

GRANT EXECUTE ON FUNCTION private.ingest_batch   TO service_role;
GRANT EXECUTE ON FUNCTION private.resolve_api_key TO service_role;
GRANT EXECUTE ON FUNCTION private.revoke_api_key  TO service_role;

-- Explicitly deny anon and authenticated roles access to private schema tables.
-- This ensures private ingest tables are unavailable through the public Data API.
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM authenticated;
