import { type NextRequest, NextResponse } from 'next/server'
import { parseProjectId, type BackendProjectId } from '@/lib/projects'
import { createClient } from '@/lib/supabase/server'
import { getDashboardBackendProjectId } from '@/lib/supabase/dashboard'

type ProjectAccess =
  | { ok: true; backendProjectId: BackendProjectId }
  | { ok: false; response: NextResponse }

export async function requireDashboardBackendProject(
  request: NextRequest,
  projectIdParam: string
): Promise<ProjectAccess> {
  if (!(await isAuthorized(request))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const projectId = parseProjectId(projectIdParam)
  if (!projectId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid project ID' }, { status: 400 }),
    }
  }

  let backendProjectId: BackendProjectId | null = null
  try {
    backendProjectId = getDashboardBackendProjectId(projectId)
  } catch {
    backendProjectId = null
  }

  if (!backendProjectId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Connect this project to a backend before uploading eval datasets.' },
        { status: 409 }
      ),
    }
  }

  return { ok: true, backendProjectId }
}

async function isAuthorized(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return true

  const dashboardApiKey = process.env.DASHBOARD_API_KEY
  if (dashboardApiKey && request.headers.get('x-api-key') === dashboardApiKey) {
    return true
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user !== null
}
