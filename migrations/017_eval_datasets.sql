-- Migration 017: Persist eval datasets per project

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('eval-datasets', 'eval-datasets', false, 10485760)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760;

CREATE TABLE private.eval_datasets (
    id            UUID PRIMARY KEY,
    project_id    UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name          TEXT NOT NULL CHECK (btrim(name) <> ''),
    file_name     TEXT NOT NULL CHECK (btrim(file_name) <> ''),
    file_format   TEXT NOT NULL CHECK (file_format IN ('json', 'jsonl', 'csv', 'xlsx', 'xls')),
    content_type  TEXT NOT NULL CHECK (btrim(content_type) <> ''),
    byte_size     BIGINT NOT NULL CHECK (byte_size >= 0),
    storage_path  TEXT NOT NULL CHECK (btrim(storage_path) <> ''),
    case_count    INTEGER CHECK (case_count IS NULL OR case_count >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, storage_path)
);

CREATE INDEX idx_eval_datasets_project_created_at
    ON private.eval_datasets (project_id, created_at DESC);

ALTER TABLE private.eval_datasets ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, DELETE ON private.eval_datasets TO service_role;

REVOKE ALL ON TABLE private.eval_datasets FROM anon;
REVOKE ALL ON TABLE private.eval_datasets FROM authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_list_eval_datasets(p_project_id UUID)
RETURNS TABLE (
    id           UUID,
    project_id   UUID,
    name         TEXT,
    file_name    TEXT,
    file_format  TEXT,
    content_type TEXT,
    byte_size    BIGINT,
    storage_path TEXT,
    case_count   INTEGER,
    created_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        d.id,
        d.project_id,
        d.name,
        d.file_name,
        d.file_format,
        d.content_type,
        d.byte_size,
        d.storage_path,
        d.case_count,
        d.created_at
    FROM private.eval_datasets d
    WHERE d.project_id = p_project_id
    ORDER BY d.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_get_eval_dataset(
    p_project_id UUID,
    p_dataset_id UUID
)
RETURNS TABLE (
    id           UUID,
    project_id   UUID,
    name         TEXT,
    file_name    TEXT,
    file_format  TEXT,
    content_type TEXT,
    byte_size    BIGINT,
    storage_path TEXT,
    case_count   INTEGER,
    created_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        d.id,
        d.project_id,
        d.name,
        d.file_name,
        d.file_format,
        d.content_type,
        d.byte_size,
        d.storage_path,
        d.case_count,
        d.created_at
    FROM private.eval_datasets d
    WHERE d.project_id = p_project_id
      AND d.id = p_dataset_id;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_create_eval_dataset(
    p_id           UUID,
    p_project_id   UUID,
    p_name         TEXT,
    p_file_name    TEXT,
    p_file_format  TEXT,
    p_content_type TEXT,
    p_byte_size    BIGINT,
    p_storage_path TEXT,
    p_case_count   INTEGER
)
RETURNS TABLE (
    id           UUID,
    project_id   UUID,
    name         TEXT,
    file_name    TEXT,
    file_format  TEXT,
    content_type TEXT,
    byte_size    BIGINT,
    storage_path TEXT,
    case_count   INTEGER,
    created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    INSERT INTO private.eval_datasets (
        id,
        project_id,
        name,
        file_name,
        file_format,
        content_type,
        byte_size,
        storage_path,
        case_count
    )
    VALUES (
        p_id,
        p_project_id,
        btrim(p_name),
        btrim(p_file_name),
        lower(btrim(p_file_format)),
        btrim(p_content_type),
        p_byte_size,
        btrim(p_storage_path),
        p_case_count
    );

    RETURN QUERY
    SELECT
        d.id,
        d.project_id,
        d.name,
        d.file_name,
        d.file_format,
        d.content_type,
        d.byte_size,
        d.storage_path,
        d.case_count,
        d.created_at
    FROM private.eval_datasets d
    WHERE d.id = p_id
      AND d.project_id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_delete_eval_dataset(
    p_project_id UUID,
    p_dataset_id UUID
)
RETURNS TABLE (storage_path TEXT)
LANGUAGE sql
SET search_path = ''
AS $$
    DELETE FROM private.eval_datasets d
    WHERE d.project_id = p_project_id
      AND d.id = p_dataset_id
    RETURNING d.storage_path;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_eval_datasets(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_eval_dataset(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_create_eval_dataset(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_delete_eval_dataset(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_eval_datasets(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_eval_dataset(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_create_eval_dataset(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_delete_eval_dataset(UUID, UUID) TO service_role;
