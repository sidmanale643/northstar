-- Migration 015: Expose structured run and tool errors in dashboard reads

DROP FUNCTION IF EXISTS public.dashboard_list_traces(UUID, UUID);

CREATE FUNCTION public.dashboard_list_traces(
    p_project_id UUID,
    p_session_id UUID
)
RETURNS TABLE (
    id         UUID,
    session_id UUID,
    run_id     UUID,
    created_at TIMESTAMPTZ,
    ended_at   TIMESTAMPTZ,
    name       TEXT,
    status     TEXT,
    error      JSONB
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        r.id,
        r.session_id,
        r.id AS run_id,
        r.started_at AS created_at,
        r.ended_at,
        r.name,
        r.status,
        r.error
    FROM private.runs r
    WHERE r.project_id = p_project_id
      AND r.session_id = p_session_id
    ORDER BY r.started_at;
$$;

DROP FUNCTION IF EXISTS public.dashboard_get_trace(UUID, UUID);

CREATE FUNCTION public.dashboard_get_trace(
    p_project_id UUID,
    p_trace_id   UUID
)
RETURNS TABLE (
    id         UUID,
    session_id UUID,
    run_id     UUID,
    created_at TIMESTAMPTZ,
    ended_at   TIMESTAMPTZ,
    name       TEXT,
    status     TEXT,
    error      JSONB
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        r.id,
        r.session_id,
        r.id AS run_id,
        r.started_at AS created_at,
        r.ended_at,
        r.name,
        r.status,
        r.error
    FROM private.runs r
    WHERE r.project_id = p_project_id
      AND r.id = p_trace_id;
$$;

DROP FUNCTION IF EXISTS public.dashboard_list_session_tool_calls(UUID, UUID);

CREATE FUNCTION public.dashboard_list_session_tool_calls(
    p_project_id UUID,
    p_session_id UUID
)
RETURNS TABLE (
    id         UUID,
    trace_id   UUID,
    name       TEXT,
    params     JSONB,
    output     JSONB,
    error      JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        tool_span.id,
        tool_span.run_id AS trace_id,
        tool_span.name,
        COALESCE(arguments.content, '{}'::jsonb) AS params,
        result.content AS output,
        tool_span.error,
        tool_span.started_at AS created_at
    FROM private.spans tool_span
    JOIN private.runs r
      ON r.id = tool_span.run_id
     AND r.project_id = tool_span.project_id
    LEFT JOIN LATERAL (
        SELECT CASE
            WHEN e.type = 'tool_arguments' THEN e.content
            ELSE e.content->'data'
        END AS content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND (
              e.type = 'tool_arguments'
              OR (e.type = 'custom' AND e.content->>'name' = 'tool_arguments')
          )
        ORDER BY (e.type = 'tool_arguments') DESC, e.created_at
        LIMIT 1
    ) arguments ON TRUE
    LEFT JOIN LATERAL (
        SELECT CASE
            WHEN e.type = 'tool_result' THEN e.content
            ELSE e.content->'data'
        END AS content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND (
              e.type = 'tool_result'
              OR (e.type = 'custom' AND e.content->>'name' = 'tool_result')
          )
        ORDER BY (e.type = 'tool_result') DESC, e.created_at DESC
        LIMIT 1
    ) result ON TRUE
    WHERE tool_span.project_id = p_project_id
      AND tool_span.kind = 'tool'
      AND r.session_id = p_session_id
    ORDER BY tool_span.started_at;
$$;

DROP FUNCTION IF EXISTS public.dashboard_list_trace_tool_calls(UUID, UUID);

CREATE FUNCTION public.dashboard_list_trace_tool_calls(
    p_project_id UUID,
    p_trace_id   UUID
)
RETURNS TABLE (
    id         UUID,
    trace_id   UUID,
    name       TEXT,
    params     JSONB,
    output     JSONB,
    error      JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        tool_span.id,
        tool_span.run_id AS trace_id,
        tool_span.name,
        COALESCE(arguments.content, '{}'::jsonb) AS params,
        result.content AS output,
        tool_span.error,
        tool_span.started_at AS created_at
    FROM private.spans tool_span
    LEFT JOIN LATERAL (
        SELECT CASE
            WHEN e.type = 'tool_arguments' THEN e.content
            ELSE e.content->'data'
        END AS content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND (
              e.type = 'tool_arguments'
              OR (e.type = 'custom' AND e.content->>'name' = 'tool_arguments')
          )
        ORDER BY (e.type = 'tool_arguments') DESC, e.created_at
        LIMIT 1
    ) arguments ON TRUE
    LEFT JOIN LATERAL (
        SELECT CASE
            WHEN e.type = 'tool_result' THEN e.content
            ELSE e.content->'data'
        END AS content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND (
              e.type = 'tool_result'
              OR (e.type = 'custom' AND e.content->>'name' = 'tool_result')
          )
        ORDER BY (e.type = 'tool_result') DESC, e.created_at DESC
        LIMIT 1
    ) result ON TRUE
    WHERE tool_span.project_id = p_project_id
      AND tool_span.run_id = p_trace_id
      AND tool_span.kind = 'tool'
    ORDER BY tool_span.started_at;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_traces(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_trace(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_list_session_tool_calls(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_list_trace_tool_calls(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_traces(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_trace(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_list_session_tool_calls(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_list_trace_tool_calls(UUID, UUID) TO service_role;
