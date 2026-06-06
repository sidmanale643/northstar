-- Migration 022: Expose trace spans for dashboard DAG visualization

CREATE OR REPLACE FUNCTION public.dashboard_list_trace_spans(
    p_project_id UUID,
    p_trace_id   UUID
)
RETURNS TABLE (
    id             UUID,
    trace_id       UUID,
    parent_span_id UUID,
    kind           TEXT,
    name           TEXT,
    started_at     TIMESTAMPTZ,
    ended_at       TIMESTAMPTZ,
    status         TEXT,
    error          JSONB,
    iteration      INTEGER,
    attributes     JSONB
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        s.id,
        s.run_id AS trace_id,
        s.parent_span_id,
        s.kind,
        s.name,
        s.started_at,
        s.ended_at,
        s.status,
        s.error,
        s.iteration,
        s.attributes
    FROM private.spans s
    WHERE s.project_id = p_project_id
      AND s.run_id = p_trace_id
    ORDER BY s.started_at;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_trace_spans(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_trace_spans(UUID, UUID) TO service_role;
