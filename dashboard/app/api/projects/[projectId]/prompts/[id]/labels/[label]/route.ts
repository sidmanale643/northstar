import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { setDashboardPromptLabel } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function PUT(
  request: NextRequest,
  { params }: { params: { projectId: string; id: string; label: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid prompt ID' }, { status: 400 })
  }

  const label = decodeURIComponent(params.label).trim()
  if (!label) {
    return NextResponse.json({ error: 'Prompt label is required' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid prompt label JSON' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Prompt label body must be an object' }, { status: 400 })
  }

  const versionId = getTrimmedString(body.versionId)
  if (!versionId || !isUuid(versionId)) {
    return NextResponse.json({ error: 'Valid versionId is required' }, { status: 400 })
  }

  const changeNote = getNullableString(body.changeNote)
  if (label === 'prod' && !changeNote) {
    return NextResponse.json({ error: 'changeNote is required for prod labels' }, { status: 400 })
  }

  try {
    const prompt = await setDashboardPromptLabel({
      projectId: access.backendProjectId,
      promptId: params.id,
      label,
      versionId,
      changeNote,
      deployedBy: getNullableString(body.deployedBy),
    })

    return NextResponse.json(
      { prompt },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_set_prompt_label failed:', error)
    return NextResponse.json({ error: 'Unable to set prompt label' }, { status: 500 })
  }
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getNullableString(value: unknown) {
  if (value === undefined || value === null) return null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
