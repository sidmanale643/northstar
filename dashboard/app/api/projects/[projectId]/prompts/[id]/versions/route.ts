import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  createDashboardPromptVersion,
  getDashboardPrompt,
} from '@/lib/supabase/dashboard'
import type { Json } from '@/lib/supabase/types'

const MAX_PROMPT_CONTENT_BYTES = 64 * 1024

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
      { versions: prompt.versions ?? [] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_get_prompt versions failed:', error)
    return NextResponse.json({ error: 'Unable to list prompt versions' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; id: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid prompt ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid prompt version JSON' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Prompt version body must be an object' }, { status: 400 })
  }

  const content = getTrimmedString(body.content)
  if (!content) {
    return NextResponse.json({ error: 'Prompt version content is required' }, { status: 400 })
  }

  if (new TextEncoder().encode(content).byteLength > MAX_PROMPT_CONTENT_BYTES) {
    return NextResponse.json({ error: 'Prompt content must be 64 KB or smaller' }, { status: 413 })
  }

  const variables = body.variables ?? []
  if (!Array.isArray(variables) || !variables.every(isJson)) {
    return NextResponse.json({ error: 'Prompt variables must be an array' }, { status: 400 })
  }

  const temperature = getNullableNumber(body.temperature)
  if (temperature !== null && (temperature < 0 || temperature > 2)) {
    return NextResponse.json({ error: 'Temperature must be between 0 and 2' }, { status: 400 })
  }

  const maxTokens = getNullableInteger(body.maxTokens)
  if (maxTokens !== null && maxTokens <= 0) {
    return NextResponse.json({ error: 'Max tokens must be positive' }, { status: 400 })
  }

  const parentVersionId = getNullableString(body.parentVersionId)
  if (parentVersionId && !isUuid(parentVersionId)) {
    return NextResponse.json({ error: 'Invalid parent version ID' }, { status: 400 })
  }

  try {
    const version = await createDashboardPromptVersion({
      projectId: access.backendProjectId,
      promptId: params.id,
      content,
      model: getNullableString(body.model),
      temperature,
      maxTokens,
      variables,
      parentVersionId,
      changeNote: getNullableString(body.changeNote),
      createdBy: getNullableString(body.createdBy),
    })

    return NextResponse.json(
      { version },
      {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch (error) {
    console.error('dashboard_create_prompt_version failed:', error)
    return NextResponse.json({ error: 'Unable to create prompt version' }, { status: 500 })
  }
}

function getTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getNullableInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }

  if (Array.isArray(value)) return value.every(isJson)

  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => entry === undefined || isJson(entry))
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
