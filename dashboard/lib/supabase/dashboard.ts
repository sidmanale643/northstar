import { cookies } from 'next/headers'
import {
  DEV_BACKEND_PROJECTS_COOKIE,
  DEMO_PROJECT_ID,
  parseBackendProjectId,
  type BackendProjectId,
  type ProjectId,
} from '@/lib/projects'
import { createAdminClient } from './admin'
import type {
  DashboardEvalDataset,
  DashboardEvalRun,
  DashboardEvalRunSummary,
  DashboardProjectCostSummary,
  DashboardSession,
  DashboardSessionCost,
  DashboardSessionDetail,
  DashboardToolCall,
  DashboardTrace,
  DashboardTraceEvent,
  DashboardTraceWithToolCalls,
  EvalDatasetSummary,
  EvalRunDetail,
  EvalRunStatus,
  EvalRunSummary,
  Json,
} from './types'

export const EVAL_DATASET_BUCKET = 'eval-datasets'

interface CreateEvalDatasetInput {
  id: string
  projectId: BackendProjectId
  name: string
  fileName: string
  fileFormat: string
  contentType: string
  byteSize: number
  storagePath: string
  caseCount: number | null
}

interface UpdateEvalDatasetInput {
  projectId: BackendProjectId
  datasetId: string
  fileFormat: string
  contentType: string
  byteSize: number
  caseCount: number | null
}

interface CreateEvalRunInput {
  id: string
  projectId: BackendProjectId
  datasetId: string
  status: EvalRunStatus
  totalCases: number
  evaluatedCases: number
  notEvaluatedCases: number
  passedCases: number
  failedCases: number
  passRate: number
  skippedGrades: number
  result: Json | null
  error: Json | null
}

function getDemoBackendProjectId(): BackendProjectId {
  const projectId = parseBackendProjectId(
    process.env.NORTHSTAR_DEMO_BACKEND_PROJECT_ID ?? ''
  )

  if (!projectId) {
    throw new Error('Missing or invalid NORTHSTAR_DEMO_BACKEND_PROJECT_ID.')
  }

  return projectId
}

export function getDashboardBackendProjectId(projectId: ProjectId): BackendProjectId | null {
  if (projectId === DEMO_PROJECT_ID) return getDemoBackendProjectId()
  if (process.env.NODE_ENV === 'production') return null

  const encodedProjects = cookies().get(DEV_BACKEND_PROJECTS_COOKIE)?.value
  if (!encodedProjects) return null

  try {
    const projects: unknown = JSON.parse(decodeURIComponent(encodedProjects))
    if (!isRecord(projects)) return null

    const backendProjectId = projects[projectId]
    return typeof backendProjectId === 'string'
      ? parseBackendProjectId(backendProjectId)
      : null
  } catch {
    return null
  }
}

export async function listDashboardSessions(projectId: BackendProjectId): Promise<DashboardSession[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_sessions', {
    p_project_id: projectId,
  })

  if (error) throw error
  return data
}

export async function getDashboardSession(projectId: BackendProjectId, id: string): Promise<DashboardSessionDetail | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_get_session', {
      p_project_id: projectId,
      p_session_id: id,
    })
    .maybeSingle()

  if (error) throw error
  return data
}

export async function listDashboardTraces(projectId: BackendProjectId, sessionId: string): Promise<DashboardTrace[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_traces', {
    p_project_id: projectId,
    p_session_id: sessionId,
  })

  if (error) throw error
  return data
}

export async function getDashboardTrace(projectId: BackendProjectId, id: string): Promise<DashboardTrace | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_get_trace', {
      p_project_id: projectId,
      p_trace_id: id,
    })
    .maybeSingle()

  if (error) throw error
  return data
}

export async function listSessionToolCalls(projectId: BackendProjectId, sessionId: string): Promise<DashboardToolCall[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_session_tool_calls', {
    p_project_id: projectId,
    p_session_id: sessionId,
  })

  if (error) throw error
  return data
}

export async function listTraceToolCalls(projectId: BackendProjectId, traceId: string): Promise<DashboardToolCall[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_trace_tool_calls', {
    p_project_id: projectId,
    p_trace_id: traceId,
  })

  if (error) throw error
  return data
}

export async function listTraceEvents(projectId: BackendProjectId, traceId: string): Promise<DashboardTraceEvent[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_trace_events', {
    p_project_id: projectId,
    p_trace_id: traceId,
  })

  if (error) throw error
  return data
}

export async function getDashboardSessionCost(
  projectId: BackendProjectId,
  sessionId: string
): Promise<DashboardSessionCost | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_session_cost', {
      p_project_id: projectId,
      p_session_id: sessionId,
    })
    .maybeSingle()

  if (error?.code === 'PGRST202') return null
  if (error) throw error
  return data
}

export async function getDashboardProjectCostSummary(
  projectId: BackendProjectId,
  since?: string
): Promise<DashboardProjectCostSummary | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_project_cost_summary', {
      p_project_id: projectId,
      p_since: since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .maybeSingle()

  if (error?.code === 'PGRST202') return null
  if (error) throw error
  return data
}

export async function listDashboardEvalDatasets(projectId: BackendProjectId): Promise<EvalDatasetSummary[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_eval_datasets', {
    p_project_id: projectId,
  })

  if (error) throw error
  return data.map(toEvalDatasetSummary)
}

export async function getDashboardEvalDataset(
  projectId: BackendProjectId,
  datasetId: string
): Promise<DashboardEvalDataset | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_get_eval_dataset', {
      p_project_id: projectId,
      p_dataset_id: datasetId,
    })
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createDashboardEvalDataset(input: CreateEvalDatasetInput): Promise<EvalDatasetSummary> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_create_eval_dataset', {
      p_id: input.id,
      p_project_id: input.projectId,
      p_name: input.name,
      p_file_name: input.fileName,
      p_file_format: input.fileFormat,
      p_content_type: input.contentType,
      p_byte_size: input.byteSize,
      p_storage_path: input.storagePath,
      p_case_count: input.caseCount,
    })
    .single()

  if (error) throw error
  return toEvalDatasetSummary(data)
}

export async function deleteDashboardEvalDataset(
  projectId: BackendProjectId,
  datasetId: string
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_delete_eval_dataset', {
      p_project_id: projectId,
      p_dataset_id: datasetId,
    })
    .maybeSingle()

  if (error) throw error
  return data?.storage_path ?? null
}

export async function updateDashboardEvalDataset(input: UpdateEvalDatasetInput): Promise<EvalDatasetSummary> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_update_eval_dataset', {
      p_project_id: input.projectId,
      p_dataset_id: input.datasetId,
      p_file_format: input.fileFormat,
      p_content_type: input.contentType,
      p_byte_size: input.byteSize,
      p_case_count: input.caseCount,
    })
    .single()

  if (error) throw error
  return toEvalDatasetSummary(data)
}

export async function createDashboardEvalRun(input: CreateEvalRunInput): Promise<EvalRunDetail> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_create_eval_run', {
      p_id: input.id,
      p_project_id: input.projectId,
      p_dataset_id: input.datasetId,
      p_status: input.status,
      p_total_cases: input.totalCases,
      p_evaluated_cases: input.evaluatedCases,
      p_not_evaluated_cases: input.notEvaluatedCases,
      p_passed_cases: input.passedCases,
      p_failed_cases: input.failedCases,
      p_pass_rate: input.passRate,
      p_skipped_grades: input.skippedGrades,
      p_result: input.result,
      p_error: input.error,
    })
    .single()

  if (error) throw error
  return toEvalRunDetail(data)
}

export async function listDashboardEvalRuns(
  projectId: BackendProjectId,
  datasetId: string
): Promise<EvalRunSummary[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_eval_runs', {
    p_project_id: projectId,
    p_dataset_id: datasetId,
  })

  if (error) throw error
  return data.map(toEvalRunSummary)
}

export async function getDashboardEvalRun(
  projectId: BackendProjectId,
  datasetId: string,
  runId: string
): Promise<EvalRunDetail | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_get_eval_run', {
      p_project_id: projectId,
      p_dataset_id: datasetId,
      p_run_id: runId,
    })
    .maybeSingle()

  if (error) throw error
  return data ? toEvalRunDetail(data) : null
}

export function attachToolCalls(
  traces: DashboardTrace[],
  toolCalls: DashboardToolCall[]
): DashboardTraceWithToolCalls[] {
  const callsByTraceId = new Map<string, DashboardToolCall[]>()

  for (const toolCall of toolCalls) {
    const calls = callsByTraceId.get(toolCall.trace_id) ?? []
    calls.push(toolCall)
    callsByTraceId.set(toolCall.trace_id, calls)
  }

  return traces.map((trace) => ({
    ...trace,
    tool_calls: callsByTraceId.get(trace.id) ?? [],
  }))
}

function toEvalDatasetSummary(dataset: DashboardEvalDataset): EvalDatasetSummary {
  return {
    id: dataset.id,
    name: dataset.name,
    fileName: dataset.file_name,
    fileFormat: dataset.file_format,
    byteSize: dataset.byte_size,
    caseCount: dataset.case_count,
    createdAt: dataset.created_at,
  }
}

function toEvalRunSummary(run: DashboardEvalRunSummary): EvalRunSummary {
  return {
    id: run.id,
    datasetId: run.dataset_id,
    status: run.status,
    totalCases: run.total_cases,
    evaluatedCases: run.evaluated_cases,
    notEvaluatedCases: run.not_evaluated_cases,
    passedCases: run.passed_cases,
    failedCases: run.failed_cases,
    passRate: run.pass_rate,
    skippedGrades: run.skipped_grades,
    createdAt: run.created_at,
  }
}

function toEvalRunDetail(run: DashboardEvalRun): EvalRunDetail {
  return {
    ...toEvalRunSummary(run),
    result: run.result,
    error: run.error,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
