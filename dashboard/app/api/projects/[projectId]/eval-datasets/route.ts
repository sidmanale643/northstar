import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  DATASET_CONTENT_TYPES,
  getDatasetFileFormat,
  MAX_DATASET_BYTES,
  validateDatasetBytes,
} from '@/lib/eval-datasets'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createDashboardEvalDataset,
  EVAL_DATASET_BUCKET,
  listDashboardEvalDatasets,
  listDashboardEvalRuns,
} from '@/lib/supabase/dashboard'
import type { BackendProjectId } from '@/lib/projects'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    const datasets = await listDashboardEvalDatasets(access.backendProjectId)
    const datasetsWithLatestRun = await attachLatestRuns(access.backendProjectId, datasets)
    return NextResponse.json(
      { datasets: datasetsWithLatestRun },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_list_eval_datasets failed:', error)
    return NextResponse.json({ error: 'Unable to list eval datasets' }, { status: 500 })
  }
}

async function attachLatestRuns(projectId: BackendProjectId, datasets: Awaited<ReturnType<typeof listDashboardEvalDatasets>>) {
  const runPromises = datasets.map(async (dataset) => {
    try {
      const runs = await listDashboardEvalRuns(projectId, dataset.id)
      const latest = runs[0] ?? null
      return {
        ...dataset,
        latestRun: latest
          ? { status: latest.status, passRate: latest.passRate, createdAt: latest.createdAt }
          : null,
      }
    } catch {
      return { ...dataset, latestRun: null }
    }
  })
  return Promise.all(runPromises)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const upload = formData.get('file')
  if (!isUploadFile(upload)) {
    return NextResponse.json({ error: 'Dataset file is required' }, { status: 400 })
  }

  const fileFormat = getDatasetFileFormat(upload.name)
  if (!fileFormat) {
    return NextResponse.json(
      { error: 'Unsupported dataset format. Use JSON, JSONL, CSV, or XLSX.' },
      { status: 400 }
    )
  }

  if (upload.size <= 0) {
    return NextResponse.json({ error: 'Dataset file is empty' }, { status: 400 })
  }

  if (upload.size > MAX_DATASET_BYTES) {
    return NextResponse.json(
      { error: 'Dataset file must be 10 MB or smaller' },
      { status: 413 }
    )
  }

  const bytes = await upload.arrayBuffer()
  const validation = validateDatasetBytes(fileFormat, bytes)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const datasetId = randomUUID()
  const safeFileName = sanitizeFileName(upload.name)
  const storagePath = `${access.backendProjectId}/${datasetId}/${safeFileName}`
  const contentType = upload.type || DATASET_CONTENT_TYPES[fileFormat]
  const name = getDatasetName(formData, upload.name)
  const caseCount = validation.parsed.records.length
  const supabase = createAdminClient()

  const { error: uploadError } = await supabase.storage
    .from(EVAL_DATASET_BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      upsert: false,
    })

  if (uploadError) {
    console.error('eval dataset storage upload failed:', uploadError)
    return NextResponse.json({ error: 'Unable to store eval dataset file' }, { status: 500 })
  }

  try {
    const dataset = await createDashboardEvalDataset({
      id: datasetId,
      projectId: access.backendProjectId,
      name,
      fileName: upload.name,
      fileFormat,
      contentType,
      byteSize: bytes.byteLength,
      storagePath,
      caseCount,
    })

    return NextResponse.json(
      { dataset },
      {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch (error) {
    await supabase.storage.from(EVAL_DATASET_BUCKET).remove([storagePath])
    console.error('dashboard_create_eval_dataset failed:', error)
    return NextResponse.json({ error: 'Unable to save eval dataset metadata' }, { status: 500 })
  }
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  if (typeof value !== 'object' || value === null) return false
  return (
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

function getDatasetName(formData: FormData, fileName: string) {
  const submittedName = formData.get('name')
  if (typeof submittedName === 'string' && submittedName.trim()) {
    return submittedName.trim().slice(0, 200)
  }

  const baseName = fileName.replace(/\.[^.]+$/, '').trim()
  return (baseName || fileName).slice(0, 200)
}

function sanitizeFileName(fileName: string) {
  const leafName = fileName.split(/[\\/]/).pop() ?? 'dataset'
  const cleaned = leafName
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'dataset'
}
