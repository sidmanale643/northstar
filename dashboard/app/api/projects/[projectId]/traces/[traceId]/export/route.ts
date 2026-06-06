import { type NextRequest } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { exportDashboardTraceAsCsv } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; traceId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    const csv = await exportDashboardTraceAsCsv(access.backendProjectId, params.traceId)
    const filename = `trace_${params.traceId.slice(0, 8)}.csv`
    return new Response(`﻿${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Trace not found') {
      return new Response('Not found', { status: 404 })
    }
    console.error('export trace csv failed:', error)
    return new Response('Unable to export trace', { status: 500 })
  }
}
