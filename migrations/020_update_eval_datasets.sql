-- Migration 020: Allow dashboard dataset content replacement

GRANT UPDATE ON private.eval_datasets TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_update_eval_dataset(
    p_project_id   UUID,
    p_dataset_id   UUID,
    p_file_format  TEXT,
    p_content_type TEXT,
    p_byte_size    BIGINT,
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
    UPDATE private.eval_datasets d
    SET
        file_format = lower(btrim(p_file_format)),
        content_type = btrim(p_content_type),
        byte_size = p_byte_size,
        case_count = p_case_count
    WHERE d.project_id = p_project_id
      AND d.id = p_dataset_id;

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
    WHERE d.id = p_dataset_id
      AND d.project_id = p_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_update_eval_dataset(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_update_eval_dataset(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER)
    TO service_role;
