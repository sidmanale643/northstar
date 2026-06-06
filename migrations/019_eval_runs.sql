-- Migration 019: Persist dashboard eval runs per dataset

CREATE TABLE private.eval_runs (
    id                    UUID PRIMARY KEY,
    project_id            UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    dataset_id            UUID NOT NULL REFERENCES private.eval_datasets(id) ON DELETE CASCADE,
    status                TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'not_evaluated', 'error')),
    total_cases           INTEGER NOT NULL CHECK (total_cases >= 0),
    evaluated_cases       INTEGER NOT NULL CHECK (evaluated_cases >= 0),
    not_evaluated_cases   INTEGER NOT NULL CHECK (not_evaluated_cases >= 0),
    passed_cases          INTEGER NOT NULL CHECK (passed_cases >= 0),
    failed_cases          INTEGER NOT NULL CHECK (failed_cases >= 0),
    pass_rate             DOUBLE PRECISION NOT NULL CHECK (pass_rate >= 0 AND pass_rate <= 1),
    skipped_grades        INTEGER NOT NULL CHECK (skipped_grades >= 0),
    result                JSONB,
    error                 JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status = 'error' AND error IS NOT NULL)
        OR (status <> 'error' AND result IS NOT NULL)
    )
);

CREATE INDEX idx_eval_runs_dataset_created_at
    ON private.eval_runs (project_id, dataset_id, created_at DESC);

ALTER TABLE private.eval_runs ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, DELETE ON private.eval_runs TO service_role;

REVOKE ALL ON TABLE private.eval_runs FROM anon;
REVOKE ALL ON TABLE private.eval_runs FROM authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_create_eval_run(
    p_id                  UUID,
    p_project_id          UUID,
    p_dataset_id          UUID,
    p_status              TEXT,
    p_total_cases         INTEGER,
    p_evaluated_cases     INTEGER,
    p_not_evaluated_cases INTEGER,
    p_passed_cases        INTEGER,
    p_failed_cases        INTEGER,
    p_pass_rate           DOUBLE PRECISION,
    p_skipped_grades      INTEGER,
    p_result              JSONB DEFAULT NULL,
    p_error               JSONB DEFAULT NULL
)
RETURNS TABLE (
    id                    UUID,
    project_id            UUID,
    dataset_id            UUID,
    status                TEXT,
    total_cases           INTEGER,
    evaluated_cases       INTEGER,
    not_evaluated_cases   INTEGER,
    passed_cases          INTEGER,
    failed_cases          INTEGER,
    pass_rate             DOUBLE PRECISION,
    skipped_grades        INTEGER,
    result                JSONB,
    error                 JSONB,
    created_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM private.eval_datasets d
        WHERE d.id = p_dataset_id
          AND d.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'Eval dataset not found';
    END IF;

    INSERT INTO private.eval_runs (
        id,
        project_id,
        dataset_id,
        status,
        total_cases,
        evaluated_cases,
        not_evaluated_cases,
        passed_cases,
        failed_cases,
        pass_rate,
        skipped_grades,
        result,
        error
    )
    VALUES (
        p_id,
        p_project_id,
        p_dataset_id,
        p_status,
        p_total_cases,
        p_evaluated_cases,
        p_not_evaluated_cases,
        p_passed_cases,
        p_failed_cases,
        p_pass_rate,
        p_skipped_grades,
        p_result,
        p_error
    );

    RETURN QUERY
    SELECT
        r.id,
        r.project_id,
        r.dataset_id,
        r.status,
        r.total_cases,
        r.evaluated_cases,
        r.not_evaluated_cases,
        r.passed_cases,
        r.failed_cases,
        r.pass_rate,
        r.skipped_grades,
        r.result,
        r.error,
        r.created_at
    FROM private.eval_runs r
    WHERE r.id = p_id
      AND r.project_id = p_project_id
      AND r.dataset_id = p_dataset_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_list_eval_runs(
    p_project_id UUID,
    p_dataset_id UUID
)
RETURNS TABLE (
    id                    UUID,
    project_id            UUID,
    dataset_id            UUID,
    status                TEXT,
    total_cases           INTEGER,
    evaluated_cases       INTEGER,
    not_evaluated_cases   INTEGER,
    passed_cases          INTEGER,
    failed_cases          INTEGER,
    pass_rate             DOUBLE PRECISION,
    skipped_grades        INTEGER,
    created_at            TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        r.id,
        r.project_id,
        r.dataset_id,
        r.status,
        r.total_cases,
        r.evaluated_cases,
        r.not_evaluated_cases,
        r.passed_cases,
        r.failed_cases,
        r.pass_rate,
        r.skipped_grades,
        r.created_at
    FROM private.eval_runs r
    JOIN private.eval_datasets d
      ON d.id = r.dataset_id
     AND d.project_id = r.project_id
    WHERE r.project_id = p_project_id
      AND r.dataset_id = p_dataset_id
    ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_get_eval_run(
    p_project_id UUID,
    p_dataset_id UUID,
    p_run_id     UUID
)
RETURNS TABLE (
    id                    UUID,
    project_id            UUID,
    dataset_id            UUID,
    status                TEXT,
    total_cases           INTEGER,
    evaluated_cases       INTEGER,
    not_evaluated_cases   INTEGER,
    passed_cases          INTEGER,
    failed_cases          INTEGER,
    pass_rate             DOUBLE PRECISION,
    skipped_grades        INTEGER,
    result                JSONB,
    error                 JSONB,
    created_at            TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        r.id,
        r.project_id,
        r.dataset_id,
        r.status,
        r.total_cases,
        r.evaluated_cases,
        r.not_evaluated_cases,
        r.passed_cases,
        r.failed_cases,
        r.pass_rate,
        r.skipped_grades,
        r.result,
        r.error,
        r.created_at
    FROM private.eval_runs r
    JOIN private.eval_datasets d
      ON d.id = r.dataset_id
     AND d.project_id = r.project_id
    WHERE r.project_id = p_project_id
      AND r.dataset_id = p_dataset_id
      AND r.id = p_run_id;
$$;

REVOKE ALL ON FUNCTION public.dashboard_create_eval_run(UUID, UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, DOUBLE PRECISION, INTEGER, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_list_eval_runs(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_eval_run(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_create_eval_run(UUID, UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, DOUBLE PRECISION, INTEGER, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_list_eval_runs(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_eval_run(UUID, UUID, UUID) TO service_role;
