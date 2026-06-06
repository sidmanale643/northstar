-- Migration 016: Expose run cost totals and project cost summaries

DROP FUNCTION IF EXISTS public.dashboard_list_sessions(UUID);

CREATE FUNCTION public.dashboard_list_sessions(p_project_id UUID)
RETURNS TABLE (
    id                  UUID,
    created_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    trace_count         BIGINT,
    tool_call_count     BIGINT,
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
        COALESCE(run_summary.total_cost_usd, 0) AS total_cost_usd,
        COALESCE(run_summary.total_input_tokens, 0) AS total_input_tokens,
        COALESCE(run_summary.total_output_tokens, 0) AS total_output_tokens
    FROM private.sessions s
    LEFT JOIN run_summary ON run_summary.session_id = s.id
    LEFT JOIN tool_summary ON tool_summary.session_id = s.id
    WHERE s.project_id = p_project_id
    ORDER BY s.created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.dashboard_get_session(UUID, UUID);

CREATE FUNCTION public.dashboard_get_session(
    p_project_id UUID,
    p_session_id UUID
)
RETURNS TABLE (
    id                  UUID,
    created_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    total_cost_usd      NUMERIC,
    total_input_tokens  BIGINT,
    total_output_tokens BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        s.id,
        s.created_at,
        s.ended_at,
        COALESCE(SUM((r.metadata->>'cost_usd')::numeric), 0) AS total_cost_usd,
        COALESCE(SUM((r.metadata->>'total_input_tokens')::bigint), 0)::bigint AS total_input_tokens,
        COALESCE(SUM((r.metadata->>'total_output_tokens')::bigint), 0)::bigint AS total_output_tokens
    FROM private.sessions s
    LEFT JOIN private.runs r
      ON r.session_id = s.id
     AND r.project_id = s.project_id
    WHERE s.project_id = p_project_id
      AND s.id = p_session_id
    GROUP BY s.id;
$$;

DROP FUNCTION IF EXISTS public.dashboard_list_traces(UUID, UUID);

CREATE FUNCTION public.dashboard_list_traces(
    p_project_id UUID,
    p_session_id UUID
)
RETURNS TABLE (
    id            UUID,
    session_id    UUID,
    run_id        UUID,
    created_at    TIMESTAMPTZ,
    ended_at      TIMESTAMPTZ,
    name          TEXT,
    status        TEXT,
    error         JSONB,
    cost_usd      NUMERIC,
    input_tokens  BIGINT,
    output_tokens BIGINT,
    model         TEXT
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
        r.error,
        COALESCE((r.metadata->>'cost_usd')::numeric, 0) AS cost_usd,
        COALESCE((r.metadata->>'total_input_tokens')::bigint, 0) AS input_tokens,
        COALESCE((r.metadata->>'total_output_tokens')::bigint, 0) AS output_tokens,
        (
            SELECT CASE
                WHEN COUNT(DISTINCT model_span.attributes->>'model') = 1
                    THEN MIN(model_span.attributes->>'model')
                ELSE NULL
            END
            FROM private.spans model_span
            WHERE model_span.project_id = r.project_id
              AND model_span.run_id = r.id
              AND model_span.kind = 'model'
              AND model_span.attributes ? 'model'
        ) AS model
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
    id            UUID,
    session_id    UUID,
    run_id        UUID,
    created_at    TIMESTAMPTZ,
    ended_at      TIMESTAMPTZ,
    name          TEXT,
    status        TEXT,
    error         JSONB,
    cost_usd      NUMERIC,
    input_tokens  BIGINT,
    output_tokens BIGINT,
    model         TEXT
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
        r.error,
        COALESCE((r.metadata->>'cost_usd')::numeric, 0) AS cost_usd,
        COALESCE((r.metadata->>'total_input_tokens')::bigint, 0) AS input_tokens,
        COALESCE((r.metadata->>'total_output_tokens')::bigint, 0) AS output_tokens,
        (
            SELECT CASE
                WHEN COUNT(DISTINCT model_span.attributes->>'model') = 1
                    THEN MIN(model_span.attributes->>'model')
                ELSE NULL
            END
            FROM private.spans model_span
            WHERE model_span.project_id = r.project_id
              AND model_span.run_id = r.id
              AND model_span.kind = 'model'
              AND model_span.attributes ? 'model'
        ) AS model
    FROM private.runs r
    WHERE r.project_id = p_project_id
      AND r.id = p_trace_id;
$$;

DROP FUNCTION IF EXISTS public.dashboard_session_cost(UUID, UUID);

CREATE FUNCTION public.dashboard_session_cost(
    p_project_id UUID,
    p_session_id UUID
)
RETURNS TABLE (
    cost_usd         NUMERIC,
    input_tokens     BIGINT,
    output_tokens    BIGINT,
    model_call_count BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        COALESCE(run_summary.cost_usd, 0) AS cost_usd,
        COALESCE(run_summary.input_tokens, 0) AS input_tokens,
        COALESCE(run_summary.output_tokens, 0) AS output_tokens,
        COALESCE(model_summary.model_call_count, 0) AS model_call_count
    FROM (
        SELECT
            COALESCE(SUM((r.metadata->>'cost_usd')::numeric), 0) AS cost_usd,
            COALESCE(SUM((r.metadata->>'total_input_tokens')::bigint), 0)::bigint AS input_tokens,
            COALESCE(SUM((r.metadata->>'total_output_tokens')::bigint), 0)::bigint AS output_tokens
        FROM private.runs r
        WHERE r.project_id = p_project_id
          AND r.session_id = p_session_id
    ) run_summary
    CROSS JOIN (
        SELECT COUNT(*) AS model_call_count
        FROM private.spans model_span
        JOIN private.runs r
          ON r.id = model_span.run_id
         AND r.project_id = model_span.project_id
        WHERE model_span.project_id = p_project_id
          AND model_span.kind = 'model'
          AND r.session_id = p_session_id
    ) model_summary;
$$;

DROP FUNCTION IF EXISTS public.dashboard_project_cost_summary(UUID, TIMESTAMPTZ);

CREATE FUNCTION public.dashboard_project_cost_summary(
    p_project_id UUID,
    p_since      TIMESTAMPTZ DEFAULT now() - interval '30 days'
)
RETURNS TABLE (
    cost_usd      NUMERIC,
    input_tokens  BIGINT,
    output_tokens BIGINT,
    run_count     BIGINT,
    by_model      JSONB
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH model_call_spans AS (
        SELECT
            model_span.run_id,
            COALESCE(model_span.attributes->>'model', 'unknown') AS model,
            COALESCE((model_span.attributes->>'cost_usd')::numeric, 0) AS cost_usd,
            COALESCE((model_span.attributes->>'input_tokens')::bigint, 0) AS input_tokens,
            COALESCE((model_span.attributes->>'output_tokens')::bigint, 0) AS output_tokens
        FROM private.spans model_span
        WHERE model_span.project_id = p_project_id
          AND model_span.kind = 'model'
          AND model_span.started_at >= p_since
    ),
    model_summary AS (
        SELECT
            model,
            COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM model_call_spans
        GROUP BY model
    )
    SELECT
        COALESCE(SUM(model_call_spans.cost_usd), 0) AS cost_usd,
        COALESCE(SUM(model_call_spans.input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(model_call_spans.output_tokens), 0)::bigint AS output_tokens,
        COUNT(DISTINCT model_call_spans.run_id) AS run_count,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'model', model_summary.model,
                        'cost_usd', model_summary.cost_usd
                    )
                    ORDER BY model_summary.cost_usd DESC, model_summary.model
                )
                FROM model_summary
            ),
            '[]'::jsonb
        ) AS by_model
    FROM model_call_spans;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_sessions(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_session(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_list_traces(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_trace(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_session_cost(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_project_cost_summary(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_sessions(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_session(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_list_traces(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_trace(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_session_cost(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_project_cost_summary(UUID, TIMESTAMPTZ) TO service_role;
