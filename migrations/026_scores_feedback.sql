-- Migration 026: Scores and human feedback MVP

CREATE TYPE private.score_data_type AS ENUM ('numeric', 'categorical', 'boolean');
CREATE TYPE private.score_source AS ENUM ('human', 'api', 'auto');

CREATE TABLE private.scores (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    trace_id     UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE,
    span_id      UUID REFERENCES private.spans(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (btrim(name) <> ''),
    value        DOUBLE PRECISION NOT NULL,
    data_type    private.score_data_type NOT NULL DEFAULT 'numeric',
    string_value TEXT,
    source       private.score_source NOT NULL,
    comment      TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT scores_categorical_value_check CHECK (
        (data_type = 'categorical' AND string_value IS NOT NULL AND btrim(string_value) <> '')
        OR (data_type <> 'categorical' AND string_value IS NULL)
    ),
    CONSTRAINT scores_boolean_value_check CHECK (
        data_type <> 'boolean' OR value IN (0, 1)
    )
);

CREATE INDEX idx_scores_trace_created
    ON private.scores (project_id, trace_id, created_at DESC);
CREATE INDEX idx_scores_name_created
    ON private.scores (project_id, name, created_at DESC)
    INCLUDE (value, data_type);
CREATE INDEX idx_scores_span
    ON private.scores (span_id)
    WHERE span_id IS NOT NULL;

ALTER TABLE private.scores ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON private.scores TO service_role;

REVOKE ALL ON TABLE private.scores FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_list_scores(
    p_project_id UUID,
    p_trace_id UUID
)
RETURNS TABLE (
    id UUID,
    project_id UUID,
    trace_id UUID,
    span_id UUID,
    name TEXT,
    value DOUBLE PRECISION,
    data_type private.score_data_type,
    string_value TEXT,
    source private.score_source,
    comment TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        s.id,
        s.project_id,
        s.trace_id,
        s.span_id,
        s.name,
        s.value,
        s.data_type,
        s.string_value,
        s.source,
        s.comment,
        s.created_by,
        s.created_at
    FROM private.scores s
    JOIN private.runs r
      ON r.id = s.trace_id
     AND r.project_id = s.project_id
    WHERE s.project_id = p_project_id
      AND s.trace_id = p_trace_id
    ORDER BY s.created_at DESC, s.id;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_create_score(
    p_project_id UUID,
    p_trace_id UUID,
    p_name TEXT,
    p_value DOUBLE PRECISION,
    p_data_type private.score_data_type DEFAULT 'numeric',
    p_string_value TEXT DEFAULT NULL,
    p_source private.score_source DEFAULT 'human',
    p_span_id UUID DEFAULT NULL,
    p_comment TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL,
    p_id UUID DEFAULT gen_random_uuid()
)
RETURNS private.scores
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_score private.scores;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM private.runs r
        WHERE r.id = p_trace_id
          AND r.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'trace % not found for project', p_trace_id;
    END IF;

    IF p_span_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM private.spans s
        WHERE s.id = p_span_id
          AND s.run_id = p_trace_id
          AND s.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'span % not found for trace', p_span_id;
    END IF;

    INSERT INTO private.scores (
        id,
        project_id,
        trace_id,
        span_id,
        name,
        value,
        data_type,
        string_value,
        source,
        comment,
        created_by
    )
    VALUES (
        p_id,
        p_project_id,
        p_trace_id,
        p_span_id,
        btrim(p_name),
        p_value,
        p_data_type,
        CASE
            WHEN p_data_type = 'categorical' THEN btrim(p_string_value)
            ELSE p_string_value
        END,
        p_source,
        p_comment,
        p_created_by
    )
    RETURNING * INTO v_score;

    RETURN v_score;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_bulk_create_scores(
    p_project_id UUID,
    p_scores JSONB
)
RETURNS SETOF private.scores
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_score JSONB;
    v_score_id UUID;
    v_trace_id UUID;
    v_span_id UUID;
    v_data_type private.score_data_type;
    v_source private.score_source;
    v_inserted private.scores;
BEGIN
    IF jsonb_typeof(p_scores) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'scores must be a JSON array';
    END IF;

    IF jsonb_array_length(p_scores) > 500 THEN
        RAISE EXCEPTION 'score batch exceeds maximum of 500';
    END IF;

    FOR v_score IN
        SELECT value
        FROM jsonb_array_elements(p_scores)
    LOOP
        IF jsonb_typeof(v_score) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'each score must be a JSON object';
        END IF;

        IF v_score ? 'project_id'
           AND (v_score->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'score project_id does not match authenticated project';
        END IF;

        v_score_id := COALESCE((v_score->>'id')::uuid, gen_random_uuid());
        v_trace_id := (v_score->>'trace_id')::uuid;
        v_span_id := (v_score->>'span_id')::uuid;
        v_data_type := COALESCE(
            (v_score->>'data_type')::private.score_data_type,
            'numeric'::private.score_data_type
        );
        v_source := COALESCE(
            (v_score->>'source')::private.score_source,
            'api'::private.score_source
        );

        IF NOT EXISTS (
            SELECT 1
            FROM private.runs r
            WHERE r.id = v_trace_id
              AND r.project_id = p_project_id
        ) THEN
            RAISE EXCEPTION 'trace % not found for project', v_trace_id;
        END IF;

        IF v_span_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM private.spans s
            WHERE s.id = v_span_id
              AND s.run_id = v_trace_id
              AND s.project_id = p_project_id
        ) THEN
            RAISE EXCEPTION 'span % not found for trace', v_span_id;
        END IF;

        INSERT INTO private.scores (
            id,
            project_id,
            trace_id,
            span_id,
            name,
            value,
            data_type,
            string_value,
            source,
            comment,
            created_by,
            created_at
        )
        VALUES (
            v_score_id,
            p_project_id,
            v_trace_id,
            v_span_id,
            btrim(v_score->>'name'),
            (v_score->>'value')::double precision,
            v_data_type,
            CASE
                WHEN v_data_type = 'categorical' THEN btrim(v_score->>'string_value')
                ELSE v_score->>'string_value'
            END,
            v_source,
            v_score->>'comment',
            v_score->>'created_by',
            COALESCE((v_score->>'created_at')::timestamptz, now())
        )
        ON CONFLICT (id) DO UPDATE
        SET
            trace_id = EXCLUDED.trace_id,
            span_id = EXCLUDED.span_id,
            name = EXCLUDED.name,
            value = EXCLUDED.value,
            data_type = EXCLUDED.data_type,
            string_value = EXCLUDED.string_value,
            source = EXCLUDED.source,
            comment = EXCLUDED.comment,
            created_by = EXCLUDED.created_by,
            created_at = EXCLUDED.created_at
        WHERE private.scores.project_id = EXCLUDED.project_id
        RETURNING * INTO v_inserted;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'score % belongs to a different project', v_score_id;
        END IF;

        RETURN NEXT v_inserted;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_scores(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_create_score(
    UUID,
    UUID,
    TEXT,
    DOUBLE PRECISION,
    private.score_data_type,
    TEXT,
    private.score_source,
    UUID,
    TEXT,
    TEXT,
    UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_bulk_create_scores(UUID, JSONB)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_scores(UUID, UUID)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_create_score(
    UUID,
    UUID,
    TEXT,
    DOUBLE PRECISION,
    private.score_data_type,
    TEXT,
    private.score_source,
    UUID,
    TEXT,
    TEXT,
    UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_bulk_create_scores(UUID, JSONB)
    TO service_role;
