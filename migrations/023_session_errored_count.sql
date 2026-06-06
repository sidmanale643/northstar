-- Migration 023: Expose session errored count

DROP FUNCTION IF EXISTS public.dashboard_list_sessions(UUID);

CREATE FUNCTION public.dashboard_list_sessions(p_project_id UUID)
RETURNS TABLE (
    id                  UUID,
    created_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    trace_count         BIGINT,
    tool_call_count     BIGINT,
    errored_count       BIGINT,
    total_cost_usd      NUMERIC,
    total_input_tokens  BIGINT,
    total_output_tokens BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH run_summary AS (
        SELECT
            r.session_id,
            COUNT(*) AS trace_count,
            COUNT(*) FILTER (WHERE r.status IN ('error','failed')) AS errored_count,
            COALESCE(SUM((r.metadata->>'cost_usd')::numeric), 0) AS total_cost_usd,
            COALESCE(SUM((r.metadata->>'total_input_tokens')::bigint), 0)::bigint AS total_input_tokens,
            COALESCE(SUM((r.metadata->>'total_output_tokens')::bigint), 0)::bigint AS total_output_tokens
        FROM private.runs r
        WHERE r.project_id = p_project_id
        GROUP BY r.session_id
    ),
    tool_summary AS (
        SELECT
            r.session_id,
            COUNT(*) AS tool_call_count
        FROM private.spans tool_span
        JOIN private.runs r
          ON r.id = tool_span.run_id
         AND r.project_id = tool_span.project_id
        WHERE tool_span.project_id = p_project_id
          AND tool_span.kind = 'tool'
        GROUP BY r.session_id
    )
    SELECT
        s.id,
        s.created_at,
        s.ended_at,
        COALESCE(run_summary.trace_count, 0) AS trace_count,
        COALESCE(tool_summary.tool_call_count, 0) AS tool_call_count,
        COALESCE(run_summary.errored_count, 0) AS errored_count,
        COALESCE(run_summary.total_cost_usd, 0) AS total_cost_usd,
        COALESCE(run_summary.total_input_tokens, 0) AS total_input_tokens,
        COALESCE(run_summary.total_output_tokens, 0) AS total_output_tokens
    FROM private.sessions s
    LEFT JOIN run_summary ON run_summary.session_id = s.id
    LEFT JOIN tool_summary ON tool_summary.session_id = s.id
    WHERE s.project_id = p_project_id
    ORDER BY s.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_list_sessions(UUID) TO service_role;
