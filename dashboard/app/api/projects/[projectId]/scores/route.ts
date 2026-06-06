import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { createClient } from '@/lib/supabase/server'
import {
  createDashboardScore,
} from '@/lib/supabase/dashboard'
import type { ScoreDataType } from '@/lib/supabase/types'

export const runtime = 'nodejs'

interface ScoreInput {
  traceId: string
  spanId: string | null
  name: string
  value: number
  dataType: ScoreDataType
  stringValue: string | null
  comment: string | null
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseScoreInput(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const createdBy = await resolveCreatedBy()
    const score = await createDashboardScore({
      id: randomUUID(),
      projectId: access.backendProjectId,
      ...parsed.input,
      source: 'human',
      createdBy,
    })

    return NextResponse.json(
      { score },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (isScoreReferenceError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('dashboard_create_score failed:', error)
    return NextResponse.json({ error: 'Unable to create score' }, { status: 500 })
  }
}

function parseScoreInput(
  value: unknown
): { ok: true; input: ScoreInput } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'Invalid score payload' }

  const traceId = readUuid(value.traceId)
  if (!traceId) return { ok: false, error: 'traceId must be a valid UUID' }

  const spanId = readNullableUuid(value.spanId)
  if (spanId === undefined) return { ok: false, error: 'spanId must be a valid UUID or null' }

  const name = readTrimmedString(value.name, 200)
  if (!name) return { ok: false, error: 'name is required' }

  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    return { ok: false, error: 'value must be a finite number' }
  }

  const dataType = value.dataType === undefined
    ? 'numeric'
    : readScoreDataType(value.dataType)
  if (!dataType) {
    return { ok: false, error: 'dataType must be numeric, categorical, or boolean' }
  }

  if (dataType === 'boolean' && value.value !== 0 && value.value !== 1) {
    return { ok: false, error: 'boolean scores must use value 0 or 1' }
  }

  const stringValue = readNullableTrimmedString(value.stringValue, 500)
  if (stringValue === undefined) {
    return { ok: false, error: 'stringValue must be a string or null' }
  }
  if (dataType === 'categorical' && stringValue === null) {
    return { ok: false, error: 'categorical scores require stringValue' }
  }
  if (dataType !== 'categorical' && stringValue !== null) {
    return { ok: false, error: 'stringValue is only valid for categorical scores' }
  }

  const comment = readNullableTrimmedString(value.comment, 4000)
  if (comment === undefined) {
    return { ok: false, error: 'comment must be a string or null' }
  }

  return {
    ok: true,
    input: {
      traceId,
      spanId,
      name,
      value: value.value,
      dataType,
      stringValue,
      comment,
    },
  }
}

async function resolveCreatedBy(): Promise<string | null> {
  if (process.env.NODE_ENV !== 'production') return null

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.email ?? user?.id ?? null
}

function isScoreReferenceError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message.includes('not found for project') ||
    error.message.includes('not found for trace')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readUuid(value: unknown): string | null {
  return typeof value === 'string' && isUuid(value) ? value : null
}

function readNullableUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return readUuid(value) ?? undefined
}

function readTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function readNullableTrimmedString(
  value: unknown,
  maxLength: number
): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length <= maxLength ? trimmed || null : undefined
}

function readScoreDataType(value: unknown): ScoreDataType | null {
  return value === 'numeric' || value === 'categorical' || value === 'boolean'
    ? value
    : null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
