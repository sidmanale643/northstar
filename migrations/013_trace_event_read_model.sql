-- Migration 013: Expose ordered trace events and read typed tool payloads

CREATE OR REPLACE FUNCTION public.dashboard_list_session_tool_calls(
    p_project_id UUID,
    p_session_id UUID
)
RETURNS TABLE (
    id         UUID,
    trace_id   UUID,
    name       TEXT,
    params     JSONB,
    output     JSONB,
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
        tool_span.started_at AS created_at
    FROM private.spans tool_span
    JOIN private.runs r
      ON r.id = tool_span.run_id
     AND r.project_id = tool_span.project_id
    LEFT JOIN LATERAL (
        SELECT e.content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND e.type = 'tool_arguments'
        ORDER BY e.created_at
        LIMIT 1
    ) arguments ON TRUE
    LEFT JOIN LATERAL (
        SELECT e.content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND e.type = 'tool_result'
        ORDER BY e.created_at DESC
        LIMIT 1
    ) result ON TRUE
    WHERE tool_span.project_id = p_project_id
      AND tool_span.kind = 'tool'
      AND r.session_id = p_session_id
    ORDER BY tool_span.started_at;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_list_trace_tool_calls(
    p_project_id UUID,
    p_trace_id   UUID
)
RETURNS TABLE (
    id         UUID,
    trace_id   UUID,
    name       TEXT,
    params     JSONB,
    output     JSONB,
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
        tool_span.started_at AS created_at
    FROM private.spans tool_span
    LEFT JOIN LATERAL (
        SELECT e.content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND e.type = 'tool_arguments'
        ORDER BY e.created_at
        LIMIT 1
    ) arguments ON TRUE
    LEFT JOIN LATERAL (
        SELECT e.content
        FROM private.events e
        WHERE e.project_id = tool_span.project_id
          AND e.span_id = tool_span.id
          AND e.type = 'tool_result'
        ORDER BY e.created_at DESC
        LIMIT 1
    ) result ON TRUE
    WHERE tool_span.project_id = p_project_id
      AND tool_span.run_id = p_trace_id
      AND tool_span.kind = 'tool'
    ORDER BY tool_span.started_at;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_list_trace_events(
    p_project_id UUID,
    p_trace_id   UUID
)
RETURNS TABLE (
    id         UUID,
    trace_id   UUID,
    span_id    UUID,
    type       TEXT,
    content    JSONB,
    attributes JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        e.id,
        e.run_id AS trace_id,
        e.span_id,
        e.type,
        e.content,
        e.attributes,
        e.created_at
    FROM private.events e
    WHERE e.project_id = p_project_id
      AND e.run_id = p_trace_id
    ORDER BY e.created_at;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_trace_events(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_trace_events(UUID, UUID) TO service_role;
