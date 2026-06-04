import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { listProviderKeyStatuses } from '@/lib/server/provider-key-store'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    const providerKeys = await listProviderKeyStatuses(access.backendProjectId)
    return NextResponse.json(
      { providerKeys },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_list_provider_keys failed:', error)
    return NextResponse.json({ error: 'Unable to load provider keys' }, { status: 500 })
  }
}
