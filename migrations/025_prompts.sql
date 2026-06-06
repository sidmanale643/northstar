-- Migration 025: Prompt registry, versions, labels, and trace links

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE private.prompts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    slug                 TEXT NOT NULL,
    description          TEXT,
    current_version_id   UUID,
    labels               JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT prompts_slug_per_project UNIQUE (project_id, slug),
    CONSTRAINT prompts_name_nonempty CHECK (length(name) > 0),
    CONSTRAINT prompts_slug_nonempty CHECK (length(slug) > 0),
    CONSTRAINT prompts_labels_is_object CHECK (jsonb_typeof(labels) = 'object')
);

CREATE INDEX idx_prompts_project_name ON private.prompts (project_id, lower(name));

CREATE TABLE private.prompt_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id           UUID NOT NULL REFERENCES private.prompts(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,
    content             TEXT NOT NULL,
    model               TEXT,
    temperature         NUMERIC(4,3),
    max_tokens          INTEGER,
    variables           JSONB NOT NULL DEFAULT '[]'::jsonb,
    parent_version_id   UUID REFERENCES private.prompt_versions(id) ON DELETE SET NULL,
    change_note         TEXT,
    content_hash        TEXT NOT NULL,
    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT prompt_versions_unique_number UNIQUE (prompt_id, version_number),
    CONSTRAINT prompt_versions_content_size CHECK (length(content) <= 65536),
    CONSTRAINT prompt_versions_temperature_range CHECK (
        temperature IS NULL OR (temperature >= 0 AND temperature <= 2)
    ),
    CONSTRAINT prompt_versions_max_tokens_positive CHECK (
        max_tokens IS NULL OR max_tokens > 0
    ),
    CONSTRAINT prompt_versions_variables_is_array CHECK (jsonb_typeof(variables) = 'array')
);

CREATE INDEX idx_prompt_versions_prompt_created
    ON private.prompt_versions (prompt_id, created_at DESC);

ALTER TABLE private.prompts
    ADD CONSTRAINT prompts_current_version_fk
    FOREIGN KEY (current_version_id)
    REFERENCES private.prompt_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_prompts_current_version
    ON private.prompts (current_version_id)
    WHERE current_version_id IS NOT NULL;

CREATE TABLE private.prompt_label_history (
    id              BIGSERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    prompt_id       UUID NOT NULL REFERENCES private.prompts(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    version_id      UUID NOT NULL REFERENCES private.prompt_versions(id) ON DELETE RESTRICT,
    deployed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deployed_by     TEXT,
    change_note     TEXT,
    CONSTRAINT prompt_label_history_label_nonempty CHECK (length(label) > 0)
);

CREATE INDEX idx_prompt_label_history_prompt_time
    ON private.prompt_label_history (prompt_id, deployed_at DESC);

CREATE TABLE private.prompt_trace_links (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    trace_id            UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE,
    span_id             UUID NOT NULL REFERENCES private.spans(id) ON DELETE CASCADE,
    prompt_version_id   UUID NOT NULL REFERENCES private.prompt_versions(id) ON DELETE CASCADE,
    variable_values     JSONB NOT NULL DEFAULT '{}'::jsonb,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT prompt_trace_links_unique UNIQUE (span_id, prompt_version_id),
    CONSTRAINT prompt_trace_links_variables_is_object CHECK (jsonb_typeof(variable_values) = 'object')
);

CREATE INDEX idx_prompt_trace_links_trace ON private.prompt_trace_links (trace_id);
CREATE INDEX idx_prompt_trace_links_version ON private.prompt_trace_links (prompt_version_id);

ALTER TABLE private.prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prompt_label_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prompt_trace_links ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON private.prompts,
       private.prompt_versions,
       private.prompt_label_history,
       private.prompt_trace_links
    TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.prompt_label_history_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.prompt_trace_links_id_seq TO service_role;

REVOKE ALL ON private.prompts FROM anon, authenticated;
REVOKE ALL ON private.prompt_versions FROM anon, authenticated;
REVOKE ALL ON private.prompt_label_history FROM anon, authenticated;
REVOKE ALL ON private.prompt_trace_links FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_list_prompts(p_project_id UUID)
RETURNS TABLE (
    id UUID,
    project_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    current_version_id UUID,
    labels JSONB,
    created_by TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        p.id,
        p.project_id,
        p.name,
        p.slug,
        p.description,
        p.current_version_id,
        p.labels,
        p.created_by,
        p.created_at,
        p.updated_at
    FROM private.prompts p
    WHERE p.project_id = p_project_id
    ORDER BY p.updated_at DESC, p.name;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_get_prompt(
    p_project_id UUID,
    p_prompt_id UUID
)
RETURNS TABLE (
    id UUID,
    project_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    current_version_id UUID,
    labels JSONB,
    created_by TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    versions JSONB,
    label_history JSONB
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        p.id,
        p.project_id,
        p.name,
        p.slug,
        p.description,
        p.current_version_id,
        p.labels,
        p.created_by,
        p.created_at,
        p.updated_at,
        COALESCE((
            SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version_number DESC)
            FROM private.prompt_versions v
            WHERE v.prompt_id = p.id
        ), '[]'::jsonb) AS versions,
        COALESCE((
            SELECT jsonb_agg(to_jsonb(h) ORDER BY h.deployed_at DESC)
            FROM private.prompt_label_history h
            WHERE h.prompt_id = p.id
        ), '[]'::jsonb) AS label_history
    FROM private.prompts p
    WHERE p.project_id = p_project_id
      AND p.id = p_prompt_id;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_create_prompt(
    p_project_id UUID,
    p_name TEXT,
    p_slug TEXT,
    p_description TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL
)
RETURNS private.prompts
LANGUAGE sql
SET search_path = ''
AS $$
    INSERT INTO private.prompts (project_id, name, slug, description, created_by)
    VALUES (p_project_id, p_name, p_slug, p_description, p_created_by)
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_create_prompt_version(
    p_project_id UUID,
    p_prompt_id UUID,
    p_content TEXT,
    p_model TEXT DEFAULT NULL,
    p_temperature NUMERIC DEFAULT NULL,
    p_max_tokens INTEGER DEFAULT NULL,
    p_variables JSONB DEFAULT '[]'::jsonb,
    p_parent_version_id UUID DEFAULT NULL,
    p_change_note TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL
)
RETURNS private.prompt_versions
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_next_version INTEGER;
    v_version private.prompt_versions;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM private.prompts p
        WHERE p.id = p_prompt_id AND p.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'prompt % not found for project', p_prompt_id;
    END IF;

    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM private.prompt_versions
    WHERE prompt_id = p_prompt_id;

    INSERT INTO private.prompt_versions (
        prompt_id,
        project_id,
        version_number,
        content,
        model,
        temperature,
        max_tokens,
        variables,
        parent_version_id,
        change_note,
        content_hash,
        created_by
    )
    VALUES (
        p_prompt_id,
        p_project_id,
        v_next_version,
        p_content,
        p_model,
        p_temperature,
        p_max_tokens,
        p_variables,
        p_parent_version_id,
        p_change_note,
        encode(extensions.digest(p_content, 'sha256'), 'hex'),
        p_created_by
    )
    RETURNING * INTO v_version;

    UPDATE private.prompts
    SET current_version_id = v_version.id,
        updated_at = now()
    WHERE id = p_prompt_id
      AND project_id = p_project_id;

    RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_set_prompt_label(
    p_project_id UUID,
    p_prompt_id UUID,
    p_label TEXT,
    p_version_id UUID,
    p_change_note TEXT DEFAULT NULL,
    p_deployed_by TEXT DEFAULT NULL
)
RETURNS private.prompts
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_prompt private.prompts;
BEGIN
    IF length(p_label) = 0 THEN
        RAISE EXCEPTION 'label is required';
    END IF;
    IF p_label = 'prod' AND NULLIF(trim(COALESCE(p_change_note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'change_note is required for prod labels';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM private.prompt_versions v
        WHERE v.id = p_version_id
          AND v.prompt_id = p_prompt_id
          AND v.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'prompt version % not found for project', p_version_id;
    END IF;

    INSERT INTO private.prompt_label_history (
        project_id,
        prompt_id,
        label,
        version_id,
        deployed_by,
        change_note
    )
    VALUES (
        p_project_id,
        p_prompt_id,
        p_label,
        p_version_id,
        p_deployed_by,
        p_change_note
    );

    UPDATE private.prompts p
    SET labels = jsonb_set(p.labels, ARRAY[p_label], to_jsonb(p_version_id::text), true),
        updated_at = now()
    WHERE p.project_id = p_project_id
      AND p.id = p_prompt_id
    RETURNING p.* INTO v_prompt;

    RETURN v_prompt;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_resolve_prompt_label(
    p_project_id UUID,
    p_slug TEXT,
    p_label TEXT
)
RETURNS TABLE (
    prompt_id UUID,
    prompt_version_id UUID,
    version_number INTEGER,
    content TEXT,
    model TEXT,
    temperature NUMERIC,
    max_tokens INTEGER,
    variables JSONB,
    content_hash TEXT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        p.id AS prompt_id,
        v.id AS prompt_version_id,
        v.version_number,
        v.content,
        v.model,
        v.temperature,
        v.max_tokens,
        v.variables,
        v.content_hash
    FROM private.prompts p
    JOIN private.prompt_versions v
      ON v.id = (p.labels ->> p_label)::uuid
    WHERE p.project_id = p_project_id
      AND (p.slug = p_slug OR lower(p.name) = lower(p_slug));
$$;

CREATE OR REPLACE FUNCTION public.dashboard_resolve_prompt(
    p_project_id UUID,
    p_slug TEXT,
    p_label TEXT DEFAULT 'prod',
    p_version INTEGER DEFAULT NULL
)
RETURNS TABLE (
    prompt_id UUID,
    prompt_version_id UUID,
    version_number INTEGER,
    content TEXT,
    model TEXT,
    temperature NUMERIC,
    max_tokens INTEGER,
    variables JSONB,
    content_hash TEXT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        p.id AS prompt_id,
        v.id AS prompt_version_id,
        v.version_number,
        v.content,
        v.model,
        v.temperature,
        v.max_tokens,
        v.variables,
        v.content_hash
    FROM private.prompts p
    JOIN private.prompt_versions v
      ON v.prompt_id = p.id
     AND (
        (p_version IS NOT NULL AND v.version_number = p_version)
        OR (p_version IS NULL AND v.id = (p.labels ->> p_label)::uuid)
     )
    WHERE p.project_id = p_project_id
      AND (p.slug = p_slug OR lower(p.name) = lower(p_slug));
$$;

CREATE OR REPLACE FUNCTION public.dashboard_link_span_to_prompt(
    p_project_id UUID,
    p_trace_id UUID,
    p_span_id UUID,
    p_prompt_version_id UUID,
    p_variable_values JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_trace_id UUID;
BEGIN
    SELECT s.run_id
    INTO v_trace_id
    FROM private.spans s
    WHERE s.id = p_span_id
      AND s.project_id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'span % not found for project', p_span_id;
    END IF;
    IF v_trace_id IS DISTINCT FROM p_trace_id THEN
        RAISE EXCEPTION 'span % is not part of trace %', p_span_id, p_trace_id;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM private.prompt_versions v
        WHERE v.id = p_prompt_version_id
          AND v.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'prompt version % not found for project', p_prompt_version_id;
    END IF;

    INSERT INTO private.prompt_trace_links (
        project_id,
        trace_id,
        span_id,
        prompt_version_id,
        variable_values
    )
    SELECT
        p_project_id,
        p_trace_id,
        p_span_id,
        p_prompt_version_id,
        COALESCE(p_variable_values, '{}'::jsonb)
    ON CONFLICT (span_id, prompt_version_id) DO UPDATE SET
        variable_values = EXCLUDED.variable_values,
        linked_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION private.link_trace_prompt_links(
    p_project_id UUID,
    p_prompt_links JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_link JSONB;
    v_trace_id UUID;
    v_link_count INTEGER := 0;
BEGIN
    FOR v_link IN SELECT * FROM jsonb_array_elements(p_prompt_links)
    LOOP
        IF (v_link->>'project_id')::uuid IS DISTINCT FROM p_project_id THEN
            RAISE EXCEPTION 'prompt link for span % belongs to a different project', v_link->>'span_id';
        END IF;

        SELECT s.run_id
        INTO v_trace_id
        FROM private.spans s
        WHERE s.id = (v_link->>'span_id')::uuid
          AND s.project_id = p_project_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'span % not found for project', v_link->>'span_id';
        END IF;
        IF v_link->>'trace_id' IS NOT NULL
           AND (v_link->>'trace_id')::uuid IS DISTINCT FROM v_trace_id THEN
            RAISE EXCEPTION 'span % is not part of trace %', v_link->>'span_id', v_link->>'trace_id';
        END IF;

        PERFORM public.dashboard_link_span_to_prompt(
            p_project_id,
            v_trace_id,
            (v_link->>'span_id')::uuid,
            (v_link->>'prompt_version_id')::uuid,
            COALESCE(v_link->'variable_values', '{}'::jsonb)
        );
        v_link_count := v_link_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'accepted', true,
        'counts', jsonb_build_object('prompt_links', v_link_count)
    );
END;
$$;

CREATE OR REPLACE FUNCTION private.ingest_batch_with_prompt_links(
    p_project_id UUID,
    p_sessions JSONB DEFAULT '[]'::jsonb,
    p_runs JSONB DEFAULT '[]'::jsonb,
    p_spans JSONB DEFAULT '[]'::jsonb,
    p_events JSONB DEFAULT '[]'::jsonb,
    p_prompt_links JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ingest_result JSONB;
    v_link_result JSONB;
BEGIN
    v_ingest_result := private.ingest_batch(
        p_project_id,
        p_sessions,
        p_runs,
        p_spans,
        p_events
    );
    v_link_result := private.link_trace_prompt_links(p_project_id, p_prompt_links);

    RETURN jsonb_build_object(
        'accepted', true,
        'ingest', v_ingest_result,
        'prompt_links', v_link_result
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_list_trace_prompt_links(
    p_project_id UUID,
    p_trace_id UUID
)
RETURNS TABLE (
    id BIGINT,
    project_id UUID,
    trace_id UUID,
    span_id UUID,
    prompt_id UUID,
    prompt_name TEXT,
    prompt_slug TEXT,
    prompt_version_id UUID,
    version_number INTEGER,
    content_hash TEXT,
    labels JSONB,
    variable_values JSONB,
    linked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        l.id,
        l.project_id,
        l.trace_id,
        l.span_id,
        p.id AS prompt_id,
        p.name AS prompt_name,
        p.slug AS prompt_slug,
        v.id AS prompt_version_id,
        v.version_number,
        v.content_hash,
        p.labels,
        l.variable_values,
        l.linked_at
    FROM private.prompt_trace_links l
    JOIN private.prompt_versions v ON v.id = l.prompt_version_id
    JOIN private.prompts p ON p.id = v.prompt_id
    WHERE l.project_id = p_project_id
      AND l.trace_id = p_trace_id
    ORDER BY l.linked_at DESC;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_prompts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_get_prompt(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_create_prompt(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_create_prompt_version(UUID, UUID, TEXT, TEXT, NUMERIC, INTEGER, JSONB, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_set_prompt_label(UUID, UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_resolve_prompt_label(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_resolve_prompt(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_link_span_to_prompt(UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_list_trace_prompt_links(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.link_trace_prompt_links(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ingest_batch_with_prompt_links(UUID, JSONB, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_prompts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_get_prompt(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_create_prompt(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_create_prompt_version(UUID, UUID, TEXT, TEXT, NUMERIC, INTEGER, JSONB, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_set_prompt_label(UUID, UUID, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_resolve_prompt_label(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_resolve_prompt(UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_link_span_to_prompt(UUID, UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_list_trace_prompt_links(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.link_trace_prompt_links(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION private.ingest_batch_with_prompt_links(UUID, JSONB, JSONB, JSONB, JSONB, JSONB) TO service_role;
