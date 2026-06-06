-- Migration 007: Harden ingest ownership checks and add project-scoped RLS policies

-- ---------------------------------------------------------------------------
-- Request-scoped project helper for future authenticated reads
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.request_project_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = private, pg_temp
AS $$
DECLARE
    v_claims_text TEXT;
    v_claims JSONB;
    v_project_id TEXT;
BEGIN
    v_claims_text := NULLIF(current_setting('request.jwt.claims', true), '');
    IF v_claims_text IS NULL THEN
        RETURN NULL;
    END IF;

    v_claims := v_claims_text::jsonb;
    v_project_id := COALESCE(
        v_claims->>'project_id',
        v_claims->'app_metadata'->>'project_id'
    );

    IF v_project_id IS NULL OR v_project_id = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        RETURN v_project_id::uuid;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RETURN NULL;
    END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Transactional ingest hardening
-- ---------------------------------------------------------------------------

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
    v_session             JSONB;
    v_run                 JSONB;
    v_span                JSONB;
    v_event               JSONB;
    v_existing_project_id UUID;
    v_row_count           INT;
    v_sessions            INT := 0;
    v_runs                INT := 0;
    v_spans               INT := 0;
    v_events              INT := 0;
BEGIN
    -- Sessions
    FOR v_session IN SELECT * FROM jsonb_array_elements(p_sessions)
    LOOP
        IF (v_session->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'session % belongs to a different project', v_session->>'id';
        END IF;

        SELECT s.project_id
        INTO v_existing_project_id
        FROM private.sessions s
        WHERE s.id = (v_session->>'id')::uuid;

        IF FOUND AND v_existing_project_id IS DISTINCT FROM p_project_id THEN
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
            ended_at = COALESCE(EXCLUDED.ended_at, private.sessions.ended_at),
            metadata = EXCLUDED.metadata
        WHERE private.sessions.project_id = EXCLUDED.project_id;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count = 0 THEN
            RAISE EXCEPTION 'session % belongs to a different project', v_session->>'id';
        END IF;

        v_sessions := v_sessions + 1;
    END LOOP;

    -- Runs
    FOR v_run IN SELECT * FROM jsonb_array_elements(p_runs)
    LOOP
        IF (v_run->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'run % belongs to a different project', v_run->>'id';
        END IF;

        SELECT r.project_id
        INTO v_existing_project_id
        FROM private.runs r
        WHERE r.id = (v_run->>'id')::uuid;

        IF FOUND AND v_existing_project_id IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'run % belongs to a different project', v_run->>'id';
        END IF;

        SELECT s.project_id
        INTO v_existing_project_id
        FROM private.sessions s
        WHERE s.id = (v_run->>'session_id')::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'session % not found for project', v_run->>'session_id';
        END IF;

        IF v_existing_project_id IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'session % belongs to a different project', v_run->>'session_id';
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
            metadata = EXCLUDED.metadata
        WHERE private.runs.project_id = EXCLUDED.project_id;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count = 0 THEN
            RAISE EXCEPTION 'run % belongs to a different project', v_run->>'id';
        END IF;

        v_runs := v_runs + 1;
    END LOOP;

    -- Spans
    FOR v_span IN SELECT * FROM jsonb_array_elements(p_spans)
    LOOP
        IF (v_span->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'span % belongs to a different project', v_span->>'id';
        END IF;

        SELECT sp.project_id
        INTO v_existing_project_id
        FROM private.spans sp
        WHERE sp.id = (v_span->>'id')::uuid;

        IF FOUND AND v_existing_project_id IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'span % belongs to a different project', v_span->>'id';
        END IF;

        SELECT r.project_id
        INTO v_existing_project_id
        FROM private.runs r
        WHERE r.id = (v_span->>'run_id')::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'run % not found for project', v_span->>'run_id';
        END IF;

        IF v_existing_project_id IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'run % belongs to a different project', v_span->>'run_id';
        END IF;

        IF v_span->>'parent_span_id' IS NOT NULL THEN
            SELECT sp.project_id
            INTO v_existing_project_id
            FROM private.spans sp
            WHERE sp.id = (v_span->>'parent_span_id')::uuid;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'parent span % not found for project', v_span->>'parent_span_id';
            END IF;

            IF v_existing_project_id IS DISTINCT FROM p_project_id THEN
                RAISE EXCEPTION 'parent span % belongs to a different project', v_span->>'parent_span_id';
            END IF;
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
            attributes = EXCLUDED.attributes
        WHERE private.spans.project_id = EXCLUDED.project_id;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count = 0 THEN
            RAISE EXCEPTION 'span % belongs to a different project', v_span->>'id';
        END IF;

        v_spans := v_spans + 1;
    END LOOP;

    -- Events
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
    LOOP
        IF (v_event->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'event % belongs to a different project', v_event->>'id';
        END IF;

        SELECT e.project_id
        INTO v_existing_project_id
        FROM private.events e
        WHERE e.id = (v_event->>'id')::uuid;

        IF FOUND AND v_existing_project_id IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'event % belongs to a different project', v_event->>'id';
        END IF;

        SELECT r.project_id
        INTO v_existing_project_id
        FROM private.runs r
        WHERE r.id = (v_event->>'run_id')::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'run % not found for project', v_event->>'run_id';
        END IF;

        IF v_existing_project_id IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'run % belongs to a different project', v_event->>'run_id';
        END IF;

        IF v_event->>'span_id' IS NOT NULL THEN
            SELECT sp.project_id
            INTO v_existing_project_id
            FROM private.spans sp
            WHERE sp.id = (v_event->>'span_id')::uuid;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'span % not found for project', v_event->>'span_id';
            END IF;

            IF v_existing_project_id IS DISTINCT FROM p_project_id THEN
                RAISE EXCEPTION 'span % belongs to a different project', v_event->>'span_id';
            END IF;
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
            attributes = EXCLUDED.attributes
        WHERE private.events.project_id = EXCLUDED.project_id;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count = 0 THEN
            RAISE EXCEPTION 'event % belongs to a different project', v_event->>'id';
        END IF;

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

-- ---------------------------------------------------------------------------
-- Project-scoped RLS policies for future authenticated reads
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS projects_authenticated_by_project ON private.projects;
CREATE POLICY projects_authenticated_by_project
ON private.projects
FOR ALL
TO authenticated
USING (id = private.request_project_id())
WITH CHECK (id = private.request_project_id());

DROP POLICY IF EXISTS api_keys_authenticated_by_project ON private.api_keys;
CREATE POLICY api_keys_authenticated_by_project
ON private.api_keys
FOR ALL
TO authenticated
USING (project_id = private.request_project_id())
WITH CHECK (project_id = private.request_project_id());

DROP POLICY IF EXISTS sessions_authenticated_by_project ON private.sessions;
CREATE POLICY sessions_authenticated_by_project
ON private.sessions
FOR ALL
TO authenticated
USING (project_id = private.request_project_id())
WITH CHECK (project_id = private.request_project_id());

DROP POLICY IF EXISTS runs_authenticated_by_project ON private.runs;
CREATE POLICY runs_authenticated_by_project
ON private.runs
FOR ALL
TO authenticated
USING (project_id = private.request_project_id())
WITH CHECK (project_id = private.request_project_id());

DROP POLICY IF EXISTS spans_authenticated_by_project ON private.spans;
CREATE POLICY spans_authenticated_by_project
ON private.spans
FOR ALL
TO authenticated
USING (project_id = private.request_project_id())
WITH CHECK (project_id = private.request_project_id());

DROP POLICY IF EXISTS events_authenticated_by_project ON private.events;
CREATE POLICY events_authenticated_by_project
ON private.events
FOR ALL
TO authenticated
USING (project_id = private.request_project_id())
WITH CHECK (project_id = private.request_project_id());
