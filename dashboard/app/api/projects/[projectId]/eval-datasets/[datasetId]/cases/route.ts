import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  DATASET_CONTENT_TYPES,
  freeFormRowsToRecords,
  parseDatasetBytes,
  serializeDataset,
  SUPPORTED_DATASET_FORMATS,
  type EvalDatasetFileFormat,
  type FreeFormRow,
} from '@/lib/eval-datasets'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EVAL_DATASET_BUCKET,
  getDashboardEvalDataset,
  updateDashboardEvalDataset,
} from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; datasetId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.datasetId)) {
    return NextResponse.json({ error: 'Invalid dataset ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isRecord(body) || !isRecord(body.case)) {
    return NextResponse.json({ error: 'Request body must include a `case` object.' }, { status: 400 })
  }

  const incoming = sanitizeCase(body.case)
  if (!incoming.ok) {
    return NextResponse.json({ error: incoming.error }, { status: 400 })
  }

  try {
    const dataset = await getDashboardEvalDataset(access.backendProjectId, params.datasetId)
    if (!dataset) {
      return NextResponse.json({ error: 'Eval dataset not found' }, { status: 404 })
    }

    const fileFormat = parseDatasetFileFormat(dataset.file_format)
    if (!fileFormat) {
      return NextResponse.json(
        { error: 'Unsupported dataset format. Use JSON, JSONL, CSV, or XLSX.' },
        { status: 400 }
      )
    }

    const existing = await loadDatasetRows(dataset.storage_path, fileFormat)
    if (!existing.ok) {
      return NextResponse.json({ error: existing.error }, { status: 500 })
    }

    if (existing.rows.some((row) => row.id === incoming.case.id)) {
      return NextResponse.json(
        { error: `A case with id "${incoming.case.id}" already exists in this dataset.` },
        { status: 409 }
      )
    }

    const nextRows: FreeFormRow[] = [...existing.rows, incoming.case]
    const validated = freeFormRowsToRecords(nextRows)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const bytes = serializeDataset(fileFormat, validated.records)
    const contentType = DATASET_CONTENT_TYPES[fileFormat]
    const { error: storageError } = await createAdminClient()
      .storage
      .from(EVAL_DATASET_BUCKET)
      .upload(dataset.storage_path, bytes, {
        contentType,
        upsert: true,
      })

    if (storageError) {
      console.error('eval dataset case storage update failed:', storageError)
      return NextResponse.json({ error: 'Unable to update eval dataset file' }, { status: 500 })
    }

    const updated = await updateDashboardEvalDataset({
      projectId: access.backendProjectId,
      datasetId: dataset.id,
      fileFormat,
      contentType,
      byteSize: bytes.byteLength,
      caseCount: validated.records.length,
    })

    return NextResponse.json(
      {
        dataset: updated,
        case: incoming.case,
        caseCount: validated.records.length,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_add_eval_dataset_case failed:', error)
    return NextResponse.json({ error: 'Unable to add case to eval dataset' }, { status: 500 })
  }
}

async function loadDatasetRows(
  storagePath: string,
  fileFormat: EvalDatasetFileFormat
): Promise<{ ok: true; rows: FreeFormRow[] } | { ok: false; error: string }> {
  const { data, error } = await createAdminClient()
    .storage
    .from(EVAL_DATASET_BUCKET)
    .download(storagePath)

  if (error) return { ok: false, error: `Unable to download eval dataset: ${error.message}` }

  const parsed = parseDatasetBytes(fileFormat, await data.arrayBuffer())
  if (!parsed.ok) return parsed
  return { ok: true, rows: parsed.parsed.rows }
}

function parseDatasetFileFormat(value: string): EvalDatasetFileFormat | null {
  return SUPPORTED_DATASET_FORMATS.find((format) => format === value) ?? null
}

function sanitizeCase(value: Record<string, unknown>):
  | { ok: true; case: FreeFormRow }
  | { ok: false; error: string } {
  const id = value.id
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, error: 'Case `id` is required and must be a non-empty string.' }
  }

  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) {
      out[key] = null
      continue
    }
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      out[key] = raw
      continue
    }
    if (Array.isArray(raw) || typeof raw === 'object') {
      out[key] = raw
      continue
    }
    out[key] = String(raw)
  }
  out.id = id.trim()

  return { ok: true, case: out as FreeFormRow }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
