import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { getDashboardEvalRun } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; datasetId: string; runId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.datasetId) || !isUuid(params.runId)) {
    return NextResponse.json({ error: 'Invalid eval run ID' }, { status: 400 })
  }

  try {
    const run = await getDashboardEvalRun(
      access.backendProjectId,
      params.datasetId,
      params.runId
    )

    if (!run) {
      return NextResponse.json({ error: 'Eval run not found' }, { status: 404 })
    }

    return NextResponse.json(
      { run },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_get_eval_run failed:', error)
    return NextResponse.json({ error: 'Unable to load eval run' }, { status: 500 })
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
