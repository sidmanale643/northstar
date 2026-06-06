import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { listDashboardScores } from '@/lib/supabase/dashboard'

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
    const scores = await listDashboardScores(
      access.backendProjectId,
      params.traceId
    )
    return NextResponse.json(
      { scores },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_list_scores failed:', error)
    return NextResponse.json({ error: 'Unable to list scores' }, { status: 500 })
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
