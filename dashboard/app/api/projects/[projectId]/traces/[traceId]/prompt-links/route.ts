import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { listTracePromptLinks } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; traceId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.traceId)) {
    return NextResponse.json({ error: 'Invalid trace ID' }, { status: 400 })
  }

  try {
    const links = await listTracePromptLinks({
      projectId: access.backendProjectId,
      traceId: params.traceId,
    })

    return NextResponse.json(
      { links },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_list_trace_prompt_links failed:', error)
    return NextResponse.json({ error: 'Unable to list trace prompt links' }, { status: 500 })
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
