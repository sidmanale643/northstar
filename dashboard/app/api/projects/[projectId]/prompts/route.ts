import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  createDashboardPrompt,
  listDashboardPrompts,
} from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    const prompts = await listDashboardPrompts(access.backendProjectId)
    return NextResponse.json(
      { prompts },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_list_prompts failed:', error)
    return NextResponse.json({ error: 'Unable to list prompts' }, { status: 500 })
  }
}

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
    return NextResponse.json({ error: 'Invalid prompt JSON' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Prompt body must be an object' }, { status: 400 })
  }

  const name = getTrimmedString(body.name)
  if (!name) {
    return NextResponse.json({ error: 'Prompt name is required' }, { status: 400 })
  }

  const slug = getTrimmedString(body.slug) ?? slugify(name)
  if (!slug) {
    return NextResponse.json({ error: 'Prompt slug is required' }, { status: 400 })
  }

  try {
    const prompt = await createDashboardPrompt({
      projectId: access.backendProjectId,
      name,
      slug,
      description: getNullableString(body.description),
      createdBy: getNullableString(body.createdBy),
    })

    return NextResponse.json(
      { prompt },
      {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch (error) {
    console.error('dashboard_create_prompt failed:', error)
    return NextResponse.json({ error: 'Unable to create prompt' }, { status: 500 })
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
