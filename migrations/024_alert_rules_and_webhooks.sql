-- Migration 024: Alert rules and webhooks

-- =========================================================================
-- Tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.alert_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('error_rate', 'latency_p95', 'token_budget')),
    threshold   NUMERIC,
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_project_id_idx ON public.alert_rules(project_id);

CREATE TABLE IF NOT EXISTS public.webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL,
    url         TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhooks_project_id_idx ON public.webhooks(project_id);

-- =========================================================================
-- alert_rules RPCs
-- =========================================================================

DROP FUNCTION IF EXISTS public.dashboard_list_alert_rules(UUID);
CREATE FUNCTION public.dashboard_list_alert_rules(p_project_id UUID)
RETURNS TABLE (
    id          UUID,
    project_id  UUID,
    kind        TEXT,
    threshold   NUMERIC,
    enabled     BOOLEAN,
    created_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT id, project_id, kind, threshold, enabled, created_at, updated_at
    FROM public.alert_rules
    WHERE project_id = p_project_id
    ORDER BY kind;
$$;

DROP FUNCTION IF EXISTS public.dashboard_upsert_alert_rule(UUID, UUID, TEXT, NUMERIC, BOOLEAN);
CREATE FUNCTION public.dashboard_upsert_alert_rule(
    p_id          UUID,
    p_project_id  UUID,
    p_kind        TEXT,
    p_threshold   NUMERIC,
    p_enabled     BOOLEAN
)
RETURNS TABLE (
    id          UUID,
    project_id  UUID,
    kind        TEXT,
    threshold   NUMERIC,
    enabled     BOOLEAN,
    created_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ
)
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
BEGIN
    INSERT INTO public.alert_rules (id, project_id, kind, threshold, enabled, updated_at)
    VALUES (p_id, p_project_id, p_kind, p_threshold, p_enabled, now())
    ON CONFLICT (id) DO UPDATE
      SET threshold = EXCLUDED.threshold,
          enabled   = EXCLUDED.enabled,
          updated_at = now();

    RETURN QUERY
    SELECT r.id, r.project_id, r.kind, r.threshold, r.enabled, r.created_at, r.updated_at
    FROM public.alert_rules r
    WHERE r.id = p_id;
END;
$$;

DROP FUNCTION IF EXISTS public.dashboard_delete_alert_rule(UUID, UUID);
CREATE FUNCTION public.dashboard_delete_alert_rule(p_project_id UUID, p_id UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SET search_path = '' AS $$
    DELETE FROM public.alert_rules
    WHERE project_id = p_project_id AND id = p_id;
$$;

-- =========================================================================
-- webhooks RPCs
-- =========================================================================

DROP FUNCTION IF EXISTS public.dashboard_list_webhooks(UUID);
CREATE FUNCTION public.dashboard_list_webhooks(p_project_id UUID)
RETURNS TABLE (
    id          UUID,
    project_id  UUID,
    url         TEXT,
    status      TEXT,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT id, project_id, url, status, created_at
    FROM public.webhooks
    WHERE project_id = p_project_id
    ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.dashboard_create_webhook(UUID, UUID, TEXT);
CREATE FUNCTION public.dashboard_create_webhook(
    p_id          UUID,
    p_project_id  UUID,
    p_url         TEXT
)
RETURNS TABLE (
    id          UUID,
    project_id  UUID,
    url         TEXT,
    status      TEXT,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql VOLATILE SET search_path = '' AS $$
    INSERT INTO public.webhooks (id, project_id, url)
    VALUES (p_id, p_project_id, p_url)
    RETURNING id, project_id, url, status, created_at;
$$;

DROP FUNCTION IF EXISTS public.dashboard_delete_webhook(UUID, UUID);
CREATE FUNCTION public.dashboard_delete_webhook(p_project_id UUID, p_id UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SET search_path = '' AS $$
    DELETE FROM public.webhooks
    WHERE project_id = p_project_id AND id = p_id;
$$;

-- =========================================================================
-- Privileges
-- =========================================================================

REVOKE ALL ON TABLE public.alert_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.webhooks FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.dashboard_list_alert_rules(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_upsert_alert_rule(UUID, UUID, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_delete_alert_rule(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_list_webhooks(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_create_webhook(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_delete_webhook(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_list_alert_rules(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_upsert_alert_rule(UUID, UUID, TEXT, NUMERIC, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_delete_alert_rule(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_list_webhooks(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_create_webhook(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_delete_webhook(UUID, UUID) TO service_role;
