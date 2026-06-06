-- Migration 010: Server-only RPC for project API-key creation and rotation

CREATE OR REPLACE FUNCTION public.create_or_rotate_project_api_key(
    p_project_id   UUID,
    p_project_name TEXT,
    p_key_id       UUID,
    p_key_hash     TEXT
)
RETURNS TABLE (project_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
DECLARE
    v_created_at TIMESTAMPTZ := now();
BEGIN
    IF btrim(p_project_name) = '' THEN
        RAISE EXCEPTION 'project name must not be empty';
    END IF;

    INSERT INTO private.projects (id, name)
    VALUES (p_project_id, btrim(p_project_name))
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name;

    INSERT INTO private.api_keys (id, project_id, name, key_hash, created_at, revoked_at)
    VALUES (p_key_id, p_project_id, 'Project key', p_key_hash, v_created_at, NULL)
    ON CONFLICT (project_id) DO UPDATE SET
        id         = EXCLUDED.id,
        key_hash   = EXCLUDED.key_hash,
        created_at = EXCLUDED.created_at,
        revoked_at = NULL;

    RETURN QUERY SELECT p_project_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_rotate_project_api_key(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_or_rotate_project_api_key(UUID, TEXT, UUID, TEXT) TO service_role;
