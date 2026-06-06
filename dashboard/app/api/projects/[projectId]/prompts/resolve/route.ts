import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { resolveDashboardPrompt } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid prompt resolve JSON' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Prompt resolve body must be an object' }, { status: 400 })
  }

  const slug = getTrimmedString(body.slug) ?? getTrimmedString(body.name)
  if (!slug) {
    return NextResponse.json({ error: 'Prompt slug is required' }, { status: 400 })
  }

  const label = getTrimmedString(body.label) ?? 'prod'
  const version = getNullableInteger(body.version)
  if (body.version !== undefined && version === null) {
    return NextResponse.json({ error: 'Prompt version must be an integer' }, { status: 400 })
  }

  try {
    const prompt = await resolveDashboardPrompt({
      projectId: access.backendProjectId,
      slug,
      label,
      version,
    })

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt label not found' }, { status: 404 })
    }

    return NextResponse.json(
      { prompt },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_resolve_prompt failed:', error)
    return NextResponse.json({ error: 'Unable to resolve prompt' }, { status: 500 })
  }
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getNullableInteger(value: unknown) {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
