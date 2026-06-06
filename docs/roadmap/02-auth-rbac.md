# NorthStar — Auth + Multi-Tenancy + RBAC Design

**Scope:** Closes SOTA gaps **#2** (auth bypassed) and **#10** (multi-tenancy, RBAC, audit). Defers SSO/SCIM to v2 (gap #10.2) but lays the schema foundation now.

**Target outcome:** A team can sign up, sign in, see only their projects, invite teammates with roles, and have an audit trail. The Python SDK keeps working unchanged on its existing project-scoped API key, and gains an optional org-scoped key.

---

## 0. Background — what exists today

| Concern | Current state | File |
|---|---|---|
| Auth middleware | **Bypassed** at `dashboard/middleware.ts:33-46` | `middleware.ts:33-46` |
| Login page | Magic-link OTP form, calls `supabase.auth.signInWithOtp` | `dashboard/app/login/page.tsx:21-26` |
| Auth callback | Exchanges code → session, redirects to `next` or `/` | `dashboard/app/auth/callback/route.ts:29-32` |
| Server client (normal) | `createServerClient` w/ anon key + cookies | `dashboard/lib/supabase/server.ts:24-48` |
| Server client (dev escape) | `x-api-key` header == `DASHBOARD_API_KEY` → returns service-role client (works in prod too — bug) | `dashboard/lib/supabase/server.ts:8-22` |
| Dashboard data | All read paths go through `createAdminClient()` (service-role) with `p_project_id` arg, then SECURITY DEFINER RPCs | `dashboard/lib/supabase/dashboard.ts:9, 102-107, etc.` |
| Project storage | `localStorage` blob `northstar.projects.v2` (client-only) | `dashboard/components/project-provider.tsx:14, 45-53` |
| Project switcher | Reads localStorage; no server concept | `dashboard/components/project-switcher.tsx:26-35` |
| Top nav | Just the logo link, no user/org menu | `dashboard/components/global-shell.tsx:6-14` |
| `private.projects` | UUID PK, no org | `migrations/001_initial_schema.sql:14-18` |
| `private.api_keys` | 1 row per project, hashed bearer; UNIQUE INDEX on `(project_id)` | `migrations/001_initial_schema.sql:21-28`, `migrations/008_one_api_key_per_project.sql:23-24` |
| `private.project_provider_keys` | Encrypted LLM provider keys per project (playground/evals) | `migrations/021_project_provider_keys.sql:3-26` |
| Ingest path (SDK) | `Authorization: Bearer <api_key>` → Edge function hashes → `private.resolve_api_key` → returns `(key_id, project_id)` → `private.ingest_batch(p_project_id, ...)` | `src/northstar/client.py:162`, `migrations/006_ingest_rpc.sql:162-173`, `migrations/007_ingest_hardening.sql:46-318` |
| JWT-claim RLS | `private.request_project_id()` reads `request.jwt.claims->>project_id`; policies check `id = private.request_project_id()` | `migrations/007_ingest_hardening.sql:7-40, 324-370` |
| Settings → Team | Static `<MemberCard>` rows + disabled "Invite" button | `dashboard/components/settings-page.tsx:605-616` |
| Settings → Billing | Static plan/usage/PM block, all buttons disabled | `dashboard/components/settings-page.tsx:618-655` |

**Key constraint:** Every dashboard RPC takes `p_project_id UUID` (`migrations/012_dashboard_read_model.sql` and the 11 functions in `migrations/013-022` follow the same pattern). The `projectId` URL slug (`proj_xxxxx`) is purely a UX layer; the server resolves slug → backend UUID. The RLS layer is the right place to gate access — we don't need to rewrite the RPC layer.

---

## 1. Quick win — re-enable middleware auth (≈ 1 hr)

**File:** `dashboard/middleware.ts`

**Behavior:**

- If `request.headers.get('x-api-key')` is present → `NextResponse.next()` unchanged (SDK ingest + dev dashboard bypass path). This is **also** how `dashboard/lib/supabase/server.ts:8-22` opts into a service-role client — both checks stay so the existing dev path keeps working.
- If `NORTHSTAR_AUTH_BYPASS=1` env flag is set → `NextResponse.next()` (escape hatch for local dev / preview environments without auth wired). Log a warning to `console.warn` once on cold start.
- If the path is `/login` or `/auth/callback` or `/auth/callback/*` → `NextResponse.next()` (must be reachable while signed-out).
- If any other path: call `supabase.auth.getUser()`; on `!user` redirect to `/login?next=<path>` preserving the original URL.
- Static assets are already excluded by the `matcher` at `middleware.ts:50`.

**Pseudo-patch (replace lines 33-46):**

```
const AUTH_BYPASS = process.env.NORTHSTAR_AUTH_BYPASS === '1'
if (AUTH_BYPASS) { console.warn('[northstar] auth bypassed via NORTHSTAR_AUTH_BYPASS=1'); return response }
const PUBLIC_PREFIXES = ['/login', '/auth/callback']
if (PUBLIC_PREFIXES.some(p => request.nextUrl.pathname.startsWith(p))) return response
const { data: { user } } = await supabase.auth.getUser()
if (!user) {
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}
return response
```

**Edge cases to address in the patch (not in the quick win):**
- The `x-api-key` shortcut at `middleware.ts:5-7` is correct and stays. But `dashboard/lib/supabase/server.ts:8-22` short-circuits when `x-api-key === DASHBOARD_API_KEY` — that check **must also be gated by `NORTHSTAR_AUTH_BYPASS` in production**, otherwise the env var alone becomes a backdoor. Either move the bypass check to a single shared `lib/auth.ts` helper or document that `DASHBOARD_API_KEY` is dev-only and is rejected when `NODE_ENV=production`. (Tracking in §7.)

**Verification:**
1. Unauthenticated request to `/projects` → 307 to `/login?next=%2Fprojects`.
2. Authenticated request → 200.
3. SDK request with `x-api-key` → 200.
4. With `NORTHSTAR_AUTH_BYPASS=1` → 200 + warning in server logs.

**Stop point:** Ship this alone. The rest of the design is the multi-tenant rewrite. Do not bundle.

---

## 2. Schema — `migrations/023_auth_rbac.sql`

**Recommendation on `projects` vs `orgs`:** **Keep `projects` as the URL-facing leaf; introduce `orgs` as a new parent and add `org_id` to `projects`. Do not change URL paths.**

Rationale:
- Every dashboard RPC keys on `p_project_id UUID` (`migrations/012_dashboard_read_model.sql:3, 34, 53, 84, ...`). Rewriting these to take `p_org_id` (or both) is unnecessary — org context is enforcement-layer, not query-layer.
- The slug `proj_xxxxx` is the URL; the backend UUID is the join key. Users see `/projects/<slug>/sessions/...`; the server resolves slug → UUID → checks `project_members` → checks `org_members` via the project's `org_id`. No user-facing URL changes.
- Reorganising to `/[orgSlug]/[projectSlug]/...` is a later rewrite that does **not** require schema change if we add `orgs.slug` and `projects.slug` now.
- 4 tables reference `projects(id)`; moving them would require cascading FK changes plus RPC signature changes. Adding a nullable `org_id` column + backfill + RLS swap is one migration, not six.

### 2.1 Tables (all in `private` schema unless noted)

```
-- 2.1.1 Public.users (mirror of auth.users; profile fields)
--      Lives in `public` so PostgREST can read it from the browser through RLS.
--      Do NOT duplicate the Supabase auth.users row; mirror columns we control.
CREATE TABLE public.users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           CITEXT NOT NULL UNIQUE,
    full_name       TEXT,
    avatar_url      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 2.1.2 private.orgs
CREATE TYPE private.org_role AS ENUM ('owner', 'admin', 'developer', 'viewer');
CREATE TYPE private.org_plan AS ENUM ('free', 'pro', 'team', 'enterprise');

CREATE TABLE private.orgs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            private.org_plan NOT NULL DEFAULT 'free',
    -- SSO/SCIM fields (nullable today; populated in v2 — see §5)
    sso_provider        TEXT,        -- 'workos' | 'okta' | 'azure-ad' | null
    sso_domain          TEXT,
    sso_entity_id       TEXT,
    sso_metadata_url    TEXT,
    sso_role_mapping    JSONB,       -- { "Owner": "owner", "Admin": "admin", ... }
    scim_token_hash     TEXT,        -- SHA-256 of the bearer token for SCIM endpoint
    scim_last_synced_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_orgs_slug ON private.orgs(slug) WHERE deleted_at IS NULL;
ALTER TABLE private.orgs ENABLE ROW LEVEL SECURITY;

-- 2.1.3 private.org_members
CREATE TABLE private.org_members (
    org_id          UUID NOT NULL REFERENCES private.orgs(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role            private.org_role NOT NULL,
    invited_by      UUID REFERENCES public.users(id),
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at     TIMESTAMPTZ,
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON private.org_members(user_id);
ALTER TABLE private.org_members ENABLE ROW LEVEL SECURITY;

-- 2.1.4 private.project_members (finer-grained; one user can have different roles per project)
CREATE TABLE private.project_members (
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role            private.org_role NOT NULL,
    granted_by      UUID REFERENCES public.users(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON private.project_members(user_id);
ALTER TABLE private.project_members ENABLE ROW LEVEL SECURITY;

-- 2.1.5 private.org_invites (pending email invites)
CREATE TABLE private.org_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES private.orgs(id) ON DELETE CASCADE,
    email           CITEXT NOT NULL,
    role            private.org_role NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,    -- SHA-256 of the invite token
    invited_by      UUID NOT NULL REFERENCES public.users(id),
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    accepted_at     TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX idx_org_invites_email ON private.org_invites(org_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE private.org_invites ENABLE ROW LEVEL SECURITY;

-- 2.1.6 private.api_keys — extend, do not replace (see §3 for ingest impact)
ALTER TABLE private.api_keys
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'project',
    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES private.orgs(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_used_ip INET,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id);
DROP INDEX IF EXISTS private.idx_api_keys_project_id;
ALTER TABLE private.api_keys ADD CONSTRAINT api_keys_scope_check
    CHECK ( (scope = 'project' AND project_id IS NOT NULL AND org_id IS NULL)
         OR (scope = 'org'     AND org_id IS NOT NULL     AND project_id IS NULL) );
CREATE INDEX idx_api_keys_org ON private.api_keys(org_id) WHERE scope = 'org';
CREATE INDEX idx_api_keys_project ON private.api_keys(project_id) WHERE scope = 'project';
ALTER TABLE private.api_keys ENABLE ROW LEVEL SECURITY;

-- 2.1.7 private.audit_logs
CREATE TABLE private.audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id   UUID REFERENCES public.users(id),    -- null for system/SDK
    actor_api_key_id UUID REFERENCES private.api_keys(id),
    actor_ip        INET,
    actor_user_agent TEXT,
    org_id          UUID REFERENCES private.orgs(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES private.projects(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_audit_logs_org_time ON private.audit_logs(org_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_project_time ON private.audit_logs(project_id, occurred_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX idx_audit_logs_actor ON private.audit_logs(actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
ALTER TABLE private.audit_logs ENABLE ROW LEVEL SECURITY;
-- RLS: only service_role inserts; org admins/owners can SELECT for their org.
```

### 2.2 Helper SQL functions (in `private`)

```
CREATE FUNCTION private.request_user_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
$$;

CREATE FUNCTION private.user_has_org_role(p_org_id UUID, p_min_role private.org_role)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.org_members m
    WHERE m.org_id = p_org_id
      AND m.user_id = private.request_user_id()
      AND m.accepted_at IS NOT NULL
      AND private.role_rank(m.role) >= private.role_rank(p_min_role)
  )
$$;

CREATE FUNCTION private.user_has_project_role(p_project_id UUID, p_min_role private.org_role)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH p AS (
    SELECT org_id FROM private.projects WHERE id = p_project_id
  ),
  direct AS (
    SELECT 1
    FROM private.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = private.request_user_id()
      AND private.role_rank(pm.role) >= private.role_rank(p_min_role)
  ),
  inherited AS (
    SELECT 1
    FROM private.org_members m, p
    WHERE m.org_id = p.org_id
      AND m.user_id = private.request_user_id()
      AND m.accepted_at IS NOT NULL
      AND private.role_rank(m.role) >= private.role_rank(p_min_role)
  )
  SELECT EXISTS (SELECT 1 FROM direct) OR EXISTS (SELECT 1 FROM inherited)
$$;

CREATE FUNCTION private.role_rank(r private.org_role) RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'developer' THEN 2 WHEN 'viewer' THEN 1 END
$$;

CREATE FUNCTION private.project_org_id(p_project_id UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT org_id FROM private.projects WHERE id = p_project_id
$$;
```

### 2.3 RLS policy rewrites

For each existing table, drop the `*_authenticated_by_project` policy from `migrations/007_ingest_hardening.sql:324-370` and replace with a membership-based one. The `service_role` path (used by ingest RPCs and dashboard server calls) bypasses RLS by virtue of being `SECURITY DEFINER` / `GRANT`ed, so ingest is unaffected.

```
-- private.projects
DROP POLICY IF EXISTS projects_authenticated_by_project ON private.projects;
CREATE POLICY projects_read ON private.projects FOR SELECT TO authenticated
USING (private.user_has_project_role(id, 'viewer'));
CREATE POLICY projects_admin ON private.projects FOR ALL TO authenticated
USING (private.user_has_project_role(id, 'admin'))
WITH CHECK (private.user_has_project_role(id, 'admin'));

-- private.api_keys
DROP POLICY IF EXISTS api_keys_authenticated_by_project ON private.api_keys;
CREATE POLICY api_keys_org_read ON private.api_keys FOR SELECT TO authenticated
USING (
  (scope = 'project' AND private.user_has_project_role(project_id, 'developer'))
  OR (scope = 'org' AND private.user_has_org_role(org_id, 'admin'))
);
CREATE POLICY api_keys_org_write ON private.api_keys FOR ALL TO authenticated
USING (
  (scope = 'project' AND private.user_has_project_role(project_id, 'admin'))
  OR (scope = 'org' AND private.user_has_org_role(org_id, 'admin'))
)
WITH CHECK (
  (scope = 'project' AND private.user_has_project_role(project_id, 'admin'))
  OR (scope = 'org' AND private.user_has_org_role(org_id, 'admin'))
);

-- private.orgs, org_members, project_members, org_invites
CREATE POLICY orgs_read ON private.orgs FOR SELECT TO authenticated
USING (private.user_has_org_role(id, 'viewer'));
CREATE POLICY orgs_admin ON private.orgs FOR ALL TO authenticated
USING (private.user_has_org_role(id, 'admin')) WITH CHECK (private.user_has_org_role(id, 'admin'));

CREATE POLICY org_members_read ON private.org_members FOR SELECT TO authenticated
USING (private.user_has_org_role(org_id, 'viewer'));
CREATE POLICY org_members_admin ON private.org_members FOR ALL TO authenticated
USING (private.user_has_org_role(org_id, 'admin')) WITH CHECK (private.user_has_org_role(org_id, 'admin'));

CREATE POLICY project_members_read ON private.project_members FOR SELECT TO authenticated
USING (private.user_has_project_role(project_id, 'viewer'));
CREATE POLICY project_members_admin ON private.project_members FOR ALL TO authenticated
USING (private.user_has_project_role(project_id, 'admin')) WITH CHECK (private.user_has_project_role(project_id, 'admin'));

CREATE POLICY org_invites_read ON private.org_invites FOR SELECT TO authenticated
USING (private.user_has_org_role(org_id, 'admin'));
CREATE POLICY org_invites_admin ON private.org_invites FOR ALL TO authenticated
USING (private.user_has_org_role(org_id, 'admin')) WITH CHECK (private.user_has_org_role(org_id, 'admin'));

-- public.users
CREATE POLICY users_self_read ON public.users FOR SELECT TO authenticated
USING (id = auth.uid() OR EXISTS (
  SELECT 1 FROM private.org_members m
  WHERE m.user_id = public.users.id AND m.accepted_at IS NOT NULL
    AND private.user_has_org_role(m.org_id, 'viewer')
));
CREATE POLICY users_self_update ON public.users FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- private.sessions, runs, spans, events (drop and replace)
DROP POLICY IF EXISTS sessions_authenticated_by_project ON private.sessions;
CREATE POLICY sessions_read ON private.sessions FOR SELECT TO authenticated
USING (private.user_has_project_role(project_id, 'viewer'));
CREATE POLICY sessions_write ON private.sessions FOR ALL TO authenticated
USING (private.user_has_project_role(project_id, 'developer'))
WITH CHECK (private.user_has_project_role(project_id, 'developer'));
-- (mirror for runs, spans, events)

-- private.audit_logs
CREATE POLICY audit_logs_read ON private.audit_logs FOR SELECT TO authenticated
USING (private.user_has_org_role(org_id, 'admin'));
-- INSERT only via service_role. No UPDATE/DELETE policy = denied.
```

### 2.4 Backfill

```
-- 2.4.1 Create a "Default Workspace" org for any pre-migration projects.
INSERT INTO private.orgs (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Workspace', 'default', 'free')
ON CONFLICT (slug) DO NOTHING;

-- 2.4.2 Add nullable org_id to projects, backfill from auth metadata if present.
ALTER TABLE private.projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES private.orgs(id);
UPDATE private.projects SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
ALTER TABLE private.projects ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX idx_projects_org ON private.projects(org_id) WHERE deleted_at IS NULL;

-- 2.4.3 Promote the oldest existing user to owner of the default org on first sign-in.
--      (Done at runtime in §3.1 of the user-sync trigger / first-login flow.)
```

### 2.5 Auto-provisioning trigger (post-auth)

```
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  INSERT INTO public.users (id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```

---

## 3. SDK ingest auth changes

**Current path** (`src/northstar/client.py:42-49, 162` + `migrations/006_ingest_rpc.sql:162-173`):
- SDK sends `Authorization: Bearer <api_key>` to the Edge function.
- Edge function hashes → calls `private.resolve_api_key(p_key_hash)` → returns `(key_id, project_id)` if active.
- `private.ingest_batch(p_project_id, ...)` validates ownership.

**Backwards compatibility is non-negotiable** — every existing customer has a project API key in `private.api_keys` and an SDK with `NORTHSTAR_API_KEY=...` baked in.

### 3.1 Resolver changes

Replace `private.resolve_api_key` with a version that returns a `scope` column so the Edge function knows whether to feed `project_id` or `org_id` into ingest.

```
DROP FUNCTION private.resolve_api_key(TEXT);
CREATE FUNCTION private.resolve_api_key(p_key_hash TEXT)
RETURNS TABLE (key_id UUID, scope TEXT, project_id UUID, org_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private AS $$
  SELECT id, scope, project_id, org_id
  FROM private.api_keys
  WHERE key_hash = p_key_hash
    AND revoked_at IS NULL
$$;
```

### 3.2 Ingest flow for org-scoped keys

- The Edge function's project-id extraction becomes:
  - If `scope = 'project'`, pass `project_id` to `ingest_batch` (unchanged).
  - If `scope = 'org'`, derive the project by hashing the SDK's `project_id` claim. The SDK already has `project_id` on the URL `https://<project_id>.supabase.co/...` and the request body sends `project_id` UUIDs per-record. **Therefore**: org-scoped keys must include a `default_project_id` to anchor the ingest; we add that as a column.
  - Update `private.api_keys` to add `default_project_id UUID REFERENCES private.projects(id)`, populated at org-key creation time.
  - The Edge function uses `default_project_id` to call `ingest_batch`. Records within the batch that include a different `project_id` UUID are **rejected** by the existing `migrations/007_ingest_hardening.sql:73-105` checks (project ownership guard). So org-scoped keys are effectively pinned to a single project unless the user rotates `default_project_id`.

### 3.3 SDK side

**No changes required to the Python SDK.** `client.py:34-49` already takes `api_key` and `project_id`; the only difference is which `api_keys` row the server resolves. New docs: "Generate an org-scoped key in Settings → API keys; any project in the org can be specified via `project_id`."

### 3.4 Key lifecycle RPCs (new, server-only)

Replace `public.create_or_rotate_project_api_key` with a generalized version that takes a `scope` arg:

```
CREATE FUNCTION public.create_api_key(
    p_scope            TEXT,
    p_project_id       UUID,
    p_org_id           UUID,
    p_default_project_id UUID,
    p_name             TEXT,
    p_key_id           UUID,
    p_key_hash         TEXT,
    p_actor_user_id    UUID
) RETURNS TABLE (key_id UUID, plain_key TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = private AS $$ ... $$;
GRANT EXECUTE TO service_role;

CREATE FUNCTION public.revoke_api_key(p_key_id UUID, p_actor_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = private AS $$ ... $$;
GRANT EXECUTE TO service_role;
```

---

## 4. UI changes

### 4.1 Login page

Already exists. Review + small adjustments:
- Read `?next=` from `useSearchParams()`; pass it into `emailRedirectTo` as `${origin}/auth/callback?next=${next}` so the callback returns the user to their original URL.
- Add a "Sign in with Google" button alongside the email OTP once Supabase OAuth providers are configured. (Defer the actual OAuth wiring; the button is stubbed.)
- Show a clear error if `?error=...` is in the URL (e.g., invite token expired).

### 4.2 Top-nav — user menu and org switcher

Replace the header in `global-shell.tsx:6-14` with a new `TopNav` component.
- Layout: `[logo] [org-switcher] ............... [docs] [user-menu]`.
- **Org switcher** (`<OrgSwitcher>`): `Organization[]` fetched server-side from `lib/orgs.ts::listMyOrgs()`. On change, set a `northstar.active_org` cookie (UUID) so server components can resolve the active org; redirect to `/<orgSlug>`.
- **User menu** (`<UserMenu>`): `auth.getUser()` (server) → `signOut()` button calling a new `app/auth/signout/route.ts` that calls `supabase.auth.signOut()` and redirects to `/login`.
- Server-side: a new `lib/orgs.ts` exports `getActiveOrgId()`, `listMyOrgs()`, `listMyProjects(orgId)`.

### 4.3 Settings → Team tab

Replace the static `TeamSettings()` with a real, server-fetched component.

Data: `lib/orgs.ts::listOrgMembers(orgId)` returns `OrgMember[]`. `listOrgInvites(orgId)` returns pending invites.

Form: a single `<form>` for invite. Submit posts to `app/api/orgs/[orgId]/invites/route.ts`:
- POST: server validates actor is `admin` or `owner`; inserts into `private.org_invites`; sends an email via Supabase Auth; inserts `audit_logs` row.
- DELETE: revoke (sets `revoked_at`); audit `invite.revoked`.
- PATCH: change role; audit `member.role_changed`. Refuse to demote the last `owner`.
- DELETE: remove; audit `member.removed`. Refuse to remove self if last owner.

UI: members list + pending invites list + invite form.

### 4.4 Settings → Billing tab

Stub the persistence layer for v1, but wire the form to a real RPC. Concretely:
- New `lib/billing.ts` exports `getOrgBillingSummary(orgId)` → reads `orgs.plan`, computes usage via a new SQL function `public.dashboard_org_usage(p_org_id UUID, p_since TIMESTAMPTZ)`.
- "Upgrade" button: links to a Stripe checkout URL (TBD; for v1 it can `console.log("TODO")` + audit `billing.upgrade_clicked`).
- Audit `billing.email_changed` on save.

### 4.5 Audit log viewer

New file: `dashboard/app/(workspace)/admin/audit/page.tsx`. Path: `/admin/audit`. Server-rendered list of `audit_logs` rows for the active org.
- Page is a Server Component that calls `lib/audit.ts::listAuditLogs(orgId, { since, actor, action })`.
- Server enforces: `private.user_has_org_role(org_id, 'admin')`. Non-admin → 404 (not 403, to avoid leaking org existence).
- Filters in the querystring; server uses them in the SQL `WHERE` clause.

### 4.6 Sidebar / shell

After the org-switcher rewrite, the sidebar's project list (currently from localStorage at `project-provider.tsx:46`) needs to fetch from the server. New `lib/orgs.ts::listMyProjects(orgId)` → `Project[]` with `{ id, name, org_id, slug, created_at }`.

`localStorage` and the `northstar.dev-backend-projects` cookie (`projects.ts:4`) are **deleted** in this migration. The dev cookie was a workaround for the missing auth layer; once auth is real, all project resolution is server-side.

---

## 5. SSO / SCIM (gap #10.2) — schema-only for v1

Implementation deferred. The schema fields below are added in `migrations/023_auth_rbac.sql` so v2 implementation does not require a destructive migration:

- `orgs.sso_provider` (`'workos' | 'okta' | 'azure-ad' | null`) — chosen identity provider
- `orgs.sso_domain` (`text`) — verified email domain for auto-provisioning
- `orgs.sso_entity_id`, `orgs.sso_metadata_url` — SAML SP metadata
- `orgs.sso_role_mapping` (`jsonb`) — IdP group → role mapping
- `orgs.scim_token_hash` (`text`) — SHA-256 of the bearer token for SCIM
- `orgs.scim_last_synced_at` (`timestamptz`) — updated on every successful SCIM sync

**v1 work:** none, just the columns.

---

## 6. Sequencing — dependency-ordered implementation steps

### Step 1 — Re-enable middleware auth (Quick win, ≈ 1 hr)
- Edit `dashboard/middleware.ts:33-46` (see §1).
- Ship gate: unauthenticated `/projects` redirects to `/login`; magic-link sign-in works; SDK ingest still works.

### Step 2 — Migration `023_auth_rbac.sql` (≈ 1 day)
- All DDL in §2.1, functions in §2.2, policies in §2.3, backfill in §2.4.

### Step 3 — Wire user-mirror trigger + bootstrap (≈ ½ day)
- `public.handle_new_auth_user` trigger.
- New Edge Function `bootstrap_new_user` that adds the first sign-up to the default org as `owner`.

### Step 4 — Server-side project resolution (≈ 1 day)
- New `lib/orgs.ts` (`getActiveOrgId`, `listMyOrgs`, `listMyProjects`, `getActiveProject`).
- New `lib/auth.ts` (`requireUser`, `requireOrgRole`, `requireProjectRole`).
- Replace `dashboard/components/project-provider.tsx:45-53` (localStorage) with server-driven fetch.
- Delete `DEV_BACKEND_PROJECTS_COOKIE` from `lib/projects.ts:4`.

### Step 5 — Update ingest resolver (≈ ½ day)
- Apply §3.1 + §3.2 SQL changes.
- Update the Edge function `ingest-traces` to call the new `resolve_api_key` signature.

### Step 6 — ⭐ **Smallest shippable increment** ⭐
After step 5, the product is functionally shippable to a team:
- A user can sign up (magic link), land on `/projects`, see exactly the projects in orgs they belong to.
- The default workspace backfill means existing traces are visible to the first signup.
- The SDK's `NORTHSTAR_API_KEY` works as before.
- The middleware blocks anonymous access.

### Step 7 — Team tab + invite flow (≈ 1 day)
- `lib/orgs.ts::listOrgMembers`, `listOrgInvites`.
- API routes `app/api/orgs/[orgId]/invites/...`.
- Replace `settings-page.tsx:605-616` (TeamSettings).

### Step 8 — Top-nav org switcher + user menu (≈ 1 day)
- New `dashboard/components/top-nav.tsx`.
- New `app/auth/signout/route.ts`.
- Modify `dashboard/components/global-shell.tsx:6-14`.

### Step 9 — Billing tab wiring (≈ 1 day)
- New `lib/billing.ts`.
- New `public.dashboard_org_usage` SQL function.
- Wire `settings-page.tsx:618-655`.

### Step 10 — Audit log viewer (≈ ½ day)
- New `app/(workspace)/admin/audit/page.tsx` + `lib/audit.ts::listAuditLogs`.
- Audit emissions in steps 3, 4, 5, 7, 9.

### Step 11 — `lib/supabase/server.ts:8-22` cleanup (≈ 1 hr)
- Gate the `x-api-key === DASHBOARD_API_KEY` shortcut behind `process.env.NODE_ENV !== 'production'`.

### Step 12 — Dev-mode escape hatch (≈ 1 hr)
- `NORTHSTAR_AUTH_BYPASS=1` env flag.

### Step 13 — Documentation (≈ ½ day)
- Update `AGENTS.md` "Architecture & Goals" with the org/project model.
- Add `docs/auth.md`.

---

## 7. Risks and open questions

1. **Bootstrap policy for the default workspace.** Three options for new signups: (a) every new user added to default org as `viewer`; (b) new users land in a "personal" org; (c) explicit "create or join org" choice. **Recommend (a) for step 6, plan a deprecation of the default org in v2.**
2. **Self-removal of last owner.** Block via DB constraint or trigger; allow self-transfer flow in v2.
3. **Project URL slug uniqueness.** Add unique partial index `(org_id, slug)` on `private.projects` so the slug is unique within an org.
4. **Org-scoped ingest keys and cross-project spans.** v1 org-scoped keys are pinned to `default_project_id`; v2 adds a "multi-project org key".
5. **`request.jwt.claims->>project_id` is now dead code.** Replace with `request_user_id()` + `user_has_*` functions. Leave old helper for one release.
6. **Performance of membership-based RLS.** At 1k traces/page and 5-member teams this is fine. At 100k traces/page, denormalise `org_id` onto `sessions/runs/spans/events`.
7. **Service-role blast radius.** Every dashboard read uses `createAdminClient()` (`dashboard/lib/supabase/dashboard.ts:9`). Service-role bypasses RLS. **In step 4, replace `createAdminClient()` in `dashboard.ts` with `createClient()` (anon + cookies) for read paths.** Failing to do this means the RLS work is decorative.
8. **The `x-api-key` bypass at `lib/supabase/server.ts:8-22` is currently a production-time backdoor.** Addressed in step 11.
9. **Audit log retention.** No TTL/partitioning in v1. Recommend `pg_partman` monthly partitions in a follow-up.
10. **Email delivery for invites.** Supabase Auth's `inviteUserByEmail` is rate-limited; redirect URL must be allow-listed.
11. **Open question: SDK auto-resolve of `project_id` slug → UUID on the server side.** Defer to v2.
12. **Demo project.** `lib/projects.ts:13-19` hard-codes `DEMO_PROJECT`. Backfill in §2.4 attaches it to the default org. Step 6 must verify the demo project is visible to the bootstrap owner.

---

## Appendix A — File-touch summary

| File | Change | Step |
|---|---|---|
| `dashboard/middleware.ts` | Replace lines 33-46 | 1 |
| `migrations/023_auth_rbac.sql` | New (DDL, functions, RLS, backfill) | 2 |
| `migrations/006_ingest_rpc.sql` | Replace `resolve_api_key` signature | 5 |
| `migrations/010_create_project_api_key_rpc.sql` | Add new generalized `create_api_key` RPC; deprecate old | 5 |
| `dashboard/lib/supabase/server.ts` | Gate `x-api-key` shortcut to dev | 11 |
| `dashboard/lib/orgs.ts` | New | 4 |
| `dashboard/lib/auth.ts` | New | 4 |
| `dashboard/lib/billing.ts` | New | 9 |
| `dashboard/lib/audit.ts` | New | 10 |
| `dashboard/lib/projects.ts` | Remove `DEV_BACKEND_PROJECTS_COOKIE` | 4 |
| `dashboard/components/global-shell.tsx` | Use new `TopNav` | 8 |
| `dashboard/components/top-nav.tsx` | New | 8 |
| `dashboard/components/org-switcher.tsx` | New | 8 |
| `dashboard/components/user-menu.tsx` | New | 8 |
| `dashboard/components/project-provider.tsx` | Replace localStorage with server fetch | 4 |
| `dashboard/app/auth/signout/route.ts` | New | 8 |
| `dashboard/app/auth/callback/route.ts` | Verify `?next=` handling | 1 |
| `dashboard/app/login/page.tsx` | Read `?next=`; add error display | 1 |
| `dashboard/app/(workspace)/projects/[projectId]/page.tsx` | Add `requireProjectRole` | 4 |
| `dashboard/app/(workspace)/admin/audit/page.tsx` | New | 10 |
| `dashboard/app/api/orgs/[orgId]/invites/route.ts` | New (POST) | 7 |
| `dashboard/app/api/orgs/[orgId]/invites/[inviteId]/route.ts` | New (DELETE) | 7 |
| `dashboard/app/api/orgs/[orgId]/members/[userId]/route.ts` | New (PATCH, DELETE) | 7 |
| `dashboard/components/settings-page.tsx` | Replace `TeamSettings` and `BillingSettings` | 7, 9 |
| `AGENTS.md` | Document org/project model + roles | 13 |
| `docs/auth.md` | New | 13 |

---

## Appendix B — Migration impact on existing functions

- `migrations/006_ingest_rpc.sql:11-153` (`private.ingest_batch`): **no schema change**; the arg signature is unchanged.
- `migrations/007_ingest_hardening.sql:7-40` (`private.request_project_id`): **superseded** by `request_user_id()` + `user_has_project_role()`. Leave in place for one release.
- `migrations/010_create_project_api_key_rpc.sql:3-35`: **superseded** by new `public.create_api_key`. Keep the old function for back-compat.
- `migrations/012-022` (dashboard read RPCs): **no change** to signatures.
- `migrations/021_project_provider_keys.sql:3-26`: **no change**; these are dashboard eval LLM keys, scoped to project, not org.
