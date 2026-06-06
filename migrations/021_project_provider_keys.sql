-- Migration 021: Persist encrypted dashboard provider keys per project

CREATE TABLE private.project_provider_keys (
    project_id          UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL,
    encrypted_api_key   TEXT NOT NULL,
    key_hint            TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, provider),
    CONSTRAINT project_provider_keys_provider_check CHECK (
        provider IN (
            'openai',
            'anthropic',
            'openrouter',
            'gemini',
            'groq',
            'mistral',
            'cohere',
            'together',
            'deepseek',
            'fireworks',
            'perplexity'
        )
    )
);

ALTER TABLE private.project_provider_keys ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.project_provider_keys TO service_role;
REVOKE ALL ON private.project_provider_keys FROM anon;
REVOKE ALL ON private.project_provider_keys FROM authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_list_provider_keys(p_project_id UUID)
RETURNS TABLE (
    provider   TEXT,
    key_hint   TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
SET search_path = pg_temp
AS $$
    SELECT
        ppk.provider,
        ppk.key_hint,
        ppk.created_at,
        ppk.updated_at
    FROM private.project_provider_keys ppk
    WHERE ppk.project_id = p_project_id
    ORDER BY ppk.provider;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_upsert_provider_key(
    p_project_id         UUID,
    p_provider           TEXT,
    p_encrypted_api_key  TEXT,
    p_key_hint           TEXT
)
RETURNS TABLE (
    provider   TEXT,
    key_hint   TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
    INSERT INTO private.project_provider_keys (
        project_id,
        provider,
        encrypted_api_key,
        key_hint
    )
    VALUES (
        p_project_id,
        p_provider,
        p_encrypted_api_key,
        p_key_hint
    )
    ON CONFLICT (project_id, provider) DO UPDATE SET
        encrypted_api_key = EXCLUDED.encrypted_api_key,
        key_hint = EXCLUDED.key_hint,
        updated_at = now();

    RETURN QUERY
    SELECT
        ppk.provider,
        ppk.key_hint,
        ppk.created_at,
        ppk.updated_at
    FROM private.project_provider_keys ppk
    WHERE ppk.project_id = p_project_id
      AND ppk.provider = p_provider;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_delete_provider_key(
    p_project_id UUID,
    p_provider   TEXT
)
RETURNS void
LANGUAGE sql
SET search_path = pg_temp
AS $$
    DELETE FROM private.project_provider_keys ppk
    WHERE ppk.project_id = p_project_id
      AND ppk.provider = p_provider;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_get_provider_key(
    p_project_id UUID,
    p_provider   TEXT
)
RETURNS TABLE (encrypted_api_key TEXT)
LANGUAGE sql
SET search_path = pg_temp
AS $$
    SELECT ppk.encrypted_api_key
    FROM private.project_provider_keys ppk
    WHERE ppk.project_id = p_project_id
      AND ppk.provider = p_provider;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_provider_keys(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_upsert_provider_key(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_delete_provider_key(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_provider_key(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_provider_keys(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_upsert_provider_key(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_delete_provider_key(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_provider_key(UUID, TEXT) TO service_role;
