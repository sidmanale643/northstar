import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { getDashboardPrompt } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; id: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid prompt ID' }, { status: 400 })
  }

  try {
    const prompt = await getDashboardPrompt(access.backendProjectId, params.id)
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    }

    return NextResponse.json(
      { prompt },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_get_prompt failed:', error)
    return NextResponse.json({ error: 'Unable to load prompt' }, { status: 500 })
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
