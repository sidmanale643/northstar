import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  DATASET_CONTENT_TYPES,
  parseDatasetBytes,
  serializeDataset,
  SUPPORTED_DATASET_FORMATS,
  tableRowsToRecords,
  type EvalDatasetFileFormat,
  type EvalDatasetTableRow,
} from '@/lib/eval-datasets'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  deleteDashboardEvalDataset,
  EVAL_DATASET_BUCKET,
  getDashboardEvalDataset,
  getDashboardEvalRun,
  listDashboardEvalRuns,
  updateDashboardEvalDataset,
} from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; datasetId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.datasetId)) {
    return NextResponse.json({ error: 'Invalid dataset ID' }, { status: 400 })
  }

  const url = new URL(request.url)
  const rawParam = url.searchParams.get('raw')

  try {
    const dataset = await getDashboardEvalDataset(access.backendProjectId, params.datasetId)
    if (!dataset) {
      return NextResponse.json({ error: 'Eval dataset not found' }, { status: 404 })
    }

    if (rawParam !== null) {
      const rawContent = await loadDatasetRaw(dataset.storage_path)
      if (!rawContent.ok) {
        return NextResponse.json({ error: rawContent.error }, { status: 500 })
      }
      return new NextResponse(rawContent.text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Dataset-Name': dataset.name,
          'X-Dataset-Format': dataset.file_format,
          'Cache-Control': 'no-store',
        },
      })
    }

    const content = await loadDatasetRows(dataset.storage_path, dataset.file_format)
    if (!content.ok) {
      return NextResponse.json({ error: content.error }, { status: 500 })
    }

    const runs = await listDashboardEvalRuns(access.backendProjectId, params.datasetId)
    const latestRun = runs[0]
      ? await getDashboardEvalRun(access.backendProjectId, params.datasetId, runs[0].id)
      : null

    return NextResponse.json(
      {
        dataset: {
          id: dataset.id,
          name: dataset.name,
          fileName: dataset.file_name,
          fileFormat: dataset.file_format,
          byteSize: dataset.byte_size,
          caseCount: dataset.case_count,
          createdAt: dataset.created_at,
        },
        rows: content.rows,
        runs,
        latestRun,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_get_eval_dataset failed:', error)
    return NextResponse.json({ error: 'Unable to load eval dataset' }, { status: 500 })
  }
}

export async function PUT(
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
    return NextResponse.json({ error: 'Invalid dataset update JSON' }, { status: 400 })
  }

  if (!isRecord(body) || !Array.isArray(body.rows) || !body.rows.every(isDatasetTableRow)) {
    return NextResponse.json({ error: 'Dataset update requires table rows.' }, { status: 400 })
  }

  const records = tableRowsToRecords(body.rows)
  if (!records.ok) {
    return NextResponse.json({ error: records.error }, { status: 400 })
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

    const bytes = serializeDataset(fileFormat, records.records)
    const contentType = DATASET_CONTENT_TYPES[fileFormat]
    const { error: storageError } = await createAdminClient()
      .storage
      .from(EVAL_DATASET_BUCKET)
      .upload(dataset.storage_path, bytes, {
        contentType,
        upsert: true,
      })

    if (storageError) {
      console.error('eval dataset storage update failed:', storageError)
      return NextResponse.json({ error: 'Unable to update eval dataset file' }, { status: 500 })
    }

    const updated = await updateDashboardEvalDataset({
      projectId: access.backendProjectId,
      datasetId: dataset.id,
      fileFormat,
      contentType,
      byteSize: bytes.byteLength,
      caseCount: records.records.length,
    })

    return NextResponse.json(
      {
        dataset: updated,
        rows: records.records.length === body.rows.length ? body.rows : contentRows(records.records),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_update_eval_dataset failed:', error)
    return NextResponse.json({ error: 'Unable to update eval dataset' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; datasetId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.datasetId)) {
    return NextResponse.json({ error: 'Invalid dataset ID' }, { status: 400 })
  }

  try {
    const dataset = await getDashboardEvalDataset(access.backendProjectId, params.datasetId)
    if (!dataset) {
      return NextResponse.json({ error: 'Eval dataset not found' }, { status: 404 })
    }

    const { error: storageError } = await createAdminClient()
      .storage
      .from(EVAL_DATASET_BUCKET)
      .remove([dataset.storage_path])

    if (storageError) {
      console.error('eval dataset storage delete failed:', storageError)
      return NextResponse.json({ error: 'Unable to delete eval dataset file' }, { status: 500 })
    }

    await deleteDashboardEvalDataset(access.backendProjectId, params.datasetId)
    return NextResponse.json(
      { deleted: true },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_delete_eval_dataset failed:', error)
    return NextResponse.json({ error: 'Unable to delete eval dataset' }, { status: 500 })
  }
}

async function loadDatasetRaw(
  storagePath: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { data, error } = await createAdminClient()
    .storage
    .from(EVAL_DATASET_BUCKET)
    .download(storagePath)

  if (error) return { ok: false, error: `Unable to download eval dataset: ${error.message}` }

  return { ok: true, text: await data.text() }
}

async function loadDatasetRows(
  storagePath: string,
  fileFormatValue: string
): Promise<{ ok: true; rows: EvalDatasetTableRow[] } | { ok: false; error: string }> {
  const fileFormat = parseDatasetFileFormat(fileFormatValue)
  if (!fileFormat) {
    return { ok: false, error: 'Unsupported dataset format. Use JSON, JSONL, CSV, or XLSX.' }
  }

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

function contentRows(records: Record<string, unknown>[]): EvalDatasetTableRow[] {
  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    input: typeof record.input === 'string' ? record.input : '',
    messages: JSON.stringify(record.messages ?? [], null, 2),
    expected: JSON.stringify(record.expected ?? {}, null, 2),
    metrics: JSON.stringify(record.metrics ?? {}, null, 2),
    metadata: JSON.stringify(record.metadata ?? {}, null, 2),
  }))
}

function isDatasetTableRow(value: unknown): value is EvalDatasetTableRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.input === 'string' &&
    typeof value.messages === 'string' &&
    typeof value.expected === 'string' &&
    typeof value.metrics === 'string' &&
    typeof value.metadata === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
