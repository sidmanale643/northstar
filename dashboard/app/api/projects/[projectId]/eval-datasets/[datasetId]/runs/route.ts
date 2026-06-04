import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  parseDatasetBytes,
  serializeDataset,
  SUPPORTED_DATASET_FORMATS,
  type EvalDatasetFileFormat,
} from '@/lib/eval-datasets'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createDashboardEvalRun,
  EVAL_DATASET_BUCKET,
  getDashboardEvalDataset,
} from '@/lib/supabase/dashboard'
import {
  MissingProviderKeyError,
  providerKeyEnvForModels,
  providerKeyMissingMessage,
} from '@/lib/server/provider-key-store'
import type { EvalRunStatus, Json } from '@/lib/supabase/types'
import type { BackendProjectId } from '@/lib/projects'

export const runtime = 'nodejs'

const PYTHON_EVAL_CODE = `
import json
import sys
from northstar.evals import (
    Dataset,
    EvalSuite,
    JudgeScoringConfig,
    PythonCodeGrader,
    RegexGrader,
    RubricJudge,
    TypeScriptCodeGrader,
    grader_plan,
)

dataset = Dataset.from_path(sys.argv[1])
config = json.loads(sys.argv[2])
configured_graders = config.get("graders", config.get("judges", []))

if not configured_graders:
    suite = EvalSuite(metadata={"dashboard_run_config": config})
else:
    graders = []
    for grader in configured_graders:
        grader_type = grader.get("type", "rubric")
        if grader_type == "rubric":
            graders.append(
                RubricJudge(
                    grader["name"],
                    model=grader["model"],
                    rubric=grader["rubric"],
                    temperature=grader["temperature"],
                    scoring=JudgeScoringConfig(**grader["scoring"]),
                )
            )
        elif grader_type == "python":
            graders.append(
                PythonCodeGrader(
                    grader["name"],
                    grader["code"],
                    timeout_ms=grader["timeout_ms"],
                )
            )
        elif grader_type == "typescript":
            graders.append(
                TypeScriptCodeGrader(
                    grader["name"],
                    grader["code"],
                    timeout_ms=grader["timeout_ms"],
                )
            )
        elif grader_type == "regex":
            graders.append(
                RegexGrader(
                    grader["name"],
                    grader["pattern"],
                    target=grader["target"],
                    flags=grader["flags"],
                )
            )
        else:
            raise ValueError(f"Unsupported grader type: {grader_type}")

    suite = EvalSuite(
        graders=[
            *grader_plan("deterministic"),
            *graders,
        ],
        plan="quality",
        metadata={"dashboard_run_config": config},
    )

result = suite.run(dataset)
sys.stdout.write(result.model_dump_json())
`

type EvalGradeStatus = 'passed' | 'failed' | 'skipped'
type EvalCaseStatus = 'passed' | 'failed' | 'not_evaluated'
type GraderRunConfig =
  | BinaryJudgeRunConfig
  | NumericJudgeRunConfig
  | PythonCodeGraderRunConfig
  | TypeScriptCodeGraderRunConfig
  | RegexGraderRunConfig

interface BinaryJudgeRunConfig {
  type: 'rubric'
  name: string
  model: string
  rubric: string
  temperature: number
  scoring: {
    mode: 'binary'
  }
}

interface NumericJudgeRunConfig {
  type: 'rubric'
  name: string
  model: string
  rubric: string
  temperature: number
  scoring: {
    mode: 'numeric'
    min_score: number
    max_score: number
    passing_score: number
  }
}

interface PythonCodeGraderRunConfig {
  type: 'python'
  name: string
  code: string
  timeout_ms: number
}

interface TypeScriptCodeGraderRunConfig {
  type: 'typescript'
  name: string
  code: string
  timeout_ms: number
}

interface RegexGraderRunConfig {
  type: 'regex'
  name: string
  pattern: string
  target: string
  flags: string[]
}

interface EvalRunConfig {
  graders: GraderRunConfig[]
}

interface EvalGradePayload {
  name: string
  status: EvalGradeStatus
  reason: string
  feedback: string | null
  score?: number | null
  threshold?: number | null
  label?: string | null
  confidence?: number | null
  evidence?: string[]
  metadata: Json
}

interface EvalCasePayload {
  case_id: string
  status: EvalCaseStatus
  grades: EvalGradePayload[]
}

interface EvalResultPayload {
  metadata?: Json
  total_cases: number
  evaluated_cases: number
  not_evaluated_cases: number
  passed_cases: number
  failed_cases: number
  pass_rate: number
  skipped_grades: number
  case_results: EvalCasePayload[]
}

class EvalExecutionError extends Error {
  constructor(
    message: string,
    readonly details: {
      exitCode: number | null
      stderr: string
      stdout: string
    }
  ) {
    super(message)
    this.name = 'EvalExecutionError'
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; datasetId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  if (!isUuid(params.datasetId)) {
    return NextResponse.json({ error: 'Invalid dataset ID' }, { status: 400 })
  }

  const runConfig = await readRunConfig(request)
  if (!runConfig.ok) {
    return NextResponse.json({ error: runConfig.error }, { status: 400 })
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

    try {
      const result = await runSdkEval(
        access.backendProjectId,
        dataset.storage_path,
        fileFormat,
        runConfig.config
      )
      const run = await createDashboardEvalRun({
        id: randomUUID(),
        projectId: access.backendProjectId,
        datasetId: dataset.id,
        status: statusForResult(result),
        totalCases: result.total_cases,
        evaluatedCases: result.evaluated_cases,
        notEvaluatedCases: result.not_evaluated_cases,
        passedCases: result.passed_cases,
        failedCases: result.failed_cases,
        passRate: result.pass_rate,
        skippedGrades: result.skipped_grades,
        result: evalResultToJson(result),
        error: null,
      })

      return NextResponse.json(
        { run },
        {
          status: 201,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    } catch (error) {
      const errorPayload = errorToJson(error)
      const run = await createDashboardEvalRun({
        id: randomUUID(),
        projectId: access.backendProjectId,
        datasetId: dataset.id,
        status: 'error',
        totalCases: 0,
        evaluatedCases: 0,
        notEvaluatedCases: 0,
        passedCases: 0,
        failedCases: 0,
        passRate: 0,
        skippedGrades: 0,
        result: null,
        error: errorPayload,
      })

      return NextResponse.json(
        { run },
        {
          status: 201,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }
  } catch (error) {
    console.error('dashboard_run_eval_dataset failed:', error)
    return NextResponse.json({ error: 'Unable to run eval dataset' }, { status: 500 })
  }
}

async function readRunConfig(
  request: NextRequest
): Promise<{ ok: true; config: EvalRunConfig } | { ok: false; error: string }> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return { ok: true, config: { graders: [] } }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, error: 'Invalid eval run configuration JSON.' }
  }

  if (!isRecord(body)) {
    return { ok: false, error: 'Eval run configuration must be an object.' }
  }

  if ('graders' in body) {
    const graders = parseGraderRunConfigs(body.graders)
    if (!graders) {
      return { ok: false, error: 'Invalid grader configuration.' }
    }
    return { ok: true, config: { graders } }
  }

  if ('judges' in body) {
    const graders = parseGraderRunConfigs(body.judges)
    if (!graders) {
      return { ok: false, error: 'Invalid LLM judge configuration.' }
    }
    return { ok: true, config: { graders } }
  }

  if (!('judge' in body) || body.judge === null) {
    return { ok: true, config: { graders: [] } }
  }

  const judge = parseGraderRunConfig(body.judge, 'rubric_judge')
  if (!judge || judge.type !== 'rubric') {
    return { ok: false, error: 'Invalid LLM judge configuration.' }
  }

  return { ok: true, config: { graders: [judge] } }
}

function parseGraderRunConfigs(value: unknown): GraderRunConfig[] | null {
  if (!Array.isArray(value)) return null

  const seenNames = new Set<string>()
  const graders: GraderRunConfig[] = []
  for (const entry of value) {
    const grader = parseGraderRunConfig(entry)
    if (!grader || seenNames.has(grader.name)) return null
    seenNames.add(grader.name)
    graders.push(grader)
  }
  return graders
}

function parseGraderRunConfig(value: unknown, fallbackName?: string): GraderRunConfig | null {
  if (!isRecord(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : fallbackName
  if (typeof name !== 'string' || !name) return null

  const type = typeof value.type === 'string' ? value.type : 'rubric'
  if (type === 'python' || type === 'typescript') {
    if (
      typeof value.code !== 'string' ||
      !value.code.trim() ||
      !isCodeGraderTimeout(value.timeout_ms)
    ) {
      return null
    }
    return {
      type,
      name,
      code: value.code.trim(),
      timeout_ms: value.timeout_ms,
    }
  }

  if (type === 'regex') {
    if (
      typeof value.pattern !== 'string' ||
      !value.pattern.trim() ||
      typeof value.target !== 'string' ||
      !value.target.trim() ||
      !Array.isArray(value.flags) ||
      !value.flags.every(isRegexFlag)
    ) {
      return null
    }
    return {
      type,
      name,
      pattern: value.pattern.trim(),
      target: value.target.trim(),
      flags: value.flags,
    }
  }

  if (type !== 'rubric') return null
  if (
    typeof value.model !== 'string' ||
    !value.model.trim() ||
    typeof value.rubric !== 'string' ||
    !value.rubric.trim() ||
    !isTemperature(value.temperature) ||
    !isRecord(value.scoring) ||
    typeof value.scoring.mode !== 'string'
  ) {
    return null
  }

  const model = value.model.trim()
  const rubric = value.rubric.trim()
  const temperature = value.temperature

  if (value.scoring.mode === 'binary') {
    return {
      type: 'rubric',
      name,
      model,
      rubric,
      temperature,
      scoring: {
        mode: 'binary',
      },
    }
  }

  if (value.scoring.mode !== 'numeric') return null
  if (
    !isFiniteNumber(value.scoring.min_score) ||
    !isFiniteNumber(value.scoring.max_score) ||
    !isFiniteNumber(value.scoring.passing_score) ||
    value.scoring.max_score <= value.scoring.min_score ||
    value.scoring.passing_score < value.scoring.min_score ||
    value.scoring.passing_score > value.scoring.max_score
  ) {
    return null
  }

  return {
    type: 'rubric',
    name,
    model,
    rubric,
    temperature,
    scoring: {
      mode: 'numeric',
      min_score: value.scoring.min_score,
      max_score: value.scoring.max_score,
      passing_score: value.scoring.passing_score,
    },
  }
}

async function runSdkEval(
  projectId: BackendProjectId,
  storagePath: string,
  fileFormat: EvalDatasetFileFormat,
  config: EvalRunConfig
) {
  const { data, error } = await createAdminClient()
    .storage
    .from(EVAL_DATASET_BUCKET)
    .download(storagePath)

  if (error) {
    throw new Error(`Unable to download eval dataset: ${error.message}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'northstar-eval-'))
  const datasetPath = join(tempDir, fileFormat === 'jsonl' ? 'dataset.jsonl' : 'dataset.json')

  try {
    const bytes = await data.arrayBuffer()
    if (fileFormat === 'json' || fileFormat === 'jsonl') {
      await writeFile(datasetPath, Buffer.from(bytes))
    } else {
      const parsed = parseDatasetBytes(fileFormat, bytes)
      if (!parsed.ok) throw new Error(parsed.error)
      await writeFile(datasetPath, serializeDataset('json', parsed.parsed.records))
    }
    const output = await runUvPython(projectId, datasetPath, config)
    const parsed: unknown = JSON.parse(output.stdout)

    if (!isEvalResultPayload(parsed)) {
      throw new Error('Python eval runner returned an invalid EvalResult payload.')
    }

    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Python eval runner returned invalid JSON: ${error.message}`)
    }
    throw error
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runUvPython(
  projectId: BackendProjectId,
  datasetPath: string,
  config: EvalRunConfig
): Promise<{ stdout: string; stderr: string }> {
  const repoRoot = findRepoRoot()
  const baseEnv = {
    ...process.env,
    ...await readRepoEnv(repoRoot),
  }
  const env = {
    ...baseEnv,
    ...await providerKeyEnvForModels(projectId, rubricJudgeModels(config), baseEnv),
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      'uv',
      ['run', 'python', '-c', PYTHON_EVAL_CODE, datasetPath, JSON.stringify(config)],
      {
        cwd: repoRoot,
        env,
      }
    )
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      rejectRun(error)
    })
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolveRun({ stdout, stderr })
        return
      }

      rejectRun(
        new EvalExecutionError('Python eval runner failed.', {
          exitCode,
          stderr,
          stdout,
        })
      )
    })
  })
}

function findRepoRoot(): string {
  const candidates = [
    resolve(process.cwd()),
    resolve(process.cwd(), '..'),
  ]

  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, 'pyproject.toml')) &&
      existsSync(join(candidate, 'src', 'northstar'))
    ) {
      return candidate
    }
  }

  return resolve(process.cwd(), '..')
}

async function readRepoEnv(repoRoot: string): Promise<Record<string, string>> {
  try {
    return parseDotEnv(await readFile(join(repoRoot, '.env'), 'utf8'))
  } catch {
    return {}
  }
}

function parseDotEnv(contents: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator <= 0) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function statusForResult(result: EvalResultPayload): EvalRunStatus {
  if (result.failed_cases > 0) return 'failed'
  if (result.evaluated_cases === 0) return 'not_evaluated'
  return 'passed'
}

function evalResultToJson(result: EvalResultPayload): Json {
  return {
    metadata: result.metadata ?? {},
    total_cases: result.total_cases,
    evaluated_cases: result.evaluated_cases,
    not_evaluated_cases: result.not_evaluated_cases,
    passed_cases: result.passed_cases,
    failed_cases: result.failed_cases,
    pass_rate: result.pass_rate,
    skipped_grades: result.skipped_grades,
    case_results: result.case_results.map((caseResult) => ({
      case_id: caseResult.case_id,
      status: caseResult.status,
      grades: caseResult.grades.map((grade) => ({
        name: grade.name,
        status: grade.status,
        reason: grade.reason,
        feedback: grade.feedback,
        score: grade.score ?? null,
        threshold: grade.threshold ?? null,
        label: grade.label ?? null,
        confidence: grade.confidence ?? null,
        evidence: grade.evidence ?? [],
        metadata: grade.metadata,
      })),
    })),
  }
}

function errorToJson(error: unknown): Json {
  if (error instanceof MissingProviderKeyError) {
    const message = providerKeyMissingMessage(error)
    return {
      type: error.name,
      message: message.reason,
      feedback: message.feedback,
      provider: error.provider,
      env_var: error.envVar,
    }
  }

  if (error instanceof EvalExecutionError) {
    return {
      type: error.name,
      message: error.message,
      exit_code: error.details.exitCode,
      stderr: error.details.stderr.slice(0, 12000),
      stdout: error.details.stdout.slice(0, 12000),
    }
  }

  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
    }
  }

  if (isRecord(error)) {
    return errorRecordToJson(error)
  }

  return {
    type: 'UnknownError',
    message: 'Unknown eval execution error.',
  }
}

function errorRecordToJson(error: Record<string, unknown>): Json {
  const message =
    readStringField(error, 'message') ??
    readStringField(error, 'error_description') ??
    JSON.stringify(error)
  return {
    type: readStringField(error, 'name') ?? readStringField(error, 'code') ?? 'UnknownError',
    message,
    code: readStringField(error, 'code'),
    details: readStringField(error, 'details'),
    hint: readStringField(error, 'hint'),
  }
}

function readStringField(value: Record<string, unknown>, field: string): string | null {
  const fieldValue = value[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function rubricJudgeModels(config: EvalRunConfig): string[] {
  return config.graders
    .filter((grader): grader is BinaryJudgeRunConfig | NumericJudgeRunConfig =>
      grader.type === 'rubric'
    )
    .map((grader) => grader.model)
}

function isEvalResultPayload(value: unknown): value is EvalResultPayload {
  if (!isRecord(value)) return false
  return (
    isNonNegativeInteger(value.total_cases) &&
    isNonNegativeInteger(value.evaluated_cases) &&
    isNonNegativeInteger(value.not_evaluated_cases) &&
    isNonNegativeInteger(value.passed_cases) &&
    isNonNegativeInteger(value.failed_cases) &&
    typeof value.pass_rate === 'number' &&
    Number.isFinite(value.pass_rate) &&
    value.pass_rate >= 0 &&
    value.pass_rate <= 1 &&
    (value.metadata === undefined || isJson(value.metadata)) &&
    isNonNegativeInteger(value.skipped_grades) &&
    Array.isArray(value.case_results) &&
    value.case_results.every(isEvalCasePayload)
  )
}

function isEvalCasePayload(value: unknown): value is EvalCasePayload {
  if (!isRecord(value)) return false
  return (
    typeof value.case_id === 'string' &&
    isEvalCaseStatus(value.status) &&
    Array.isArray(value.grades) &&
    value.grades.every(isEvalGradePayload)
  )
}

function isEvalGradePayload(value: unknown): value is EvalGradePayload {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    isEvalGradeStatus(value.status) &&
    typeof value.reason === 'string' &&
    (value.feedback === null || typeof value.feedback === 'string') &&
    optionalJsonNumber(value.score) &&
    optionalJsonNumber(value.threshold) &&
    (value.label === undefined || value.label === null || typeof value.label === 'string') &&
    optionalJsonNumber(value.confidence) &&
    (
      value.evidence === undefined ||
      (Array.isArray(value.evidence) && value.evidence.every((item) => typeof item === 'string'))
    ) &&
    isJson(value.metadata)
  )
}

function optionalJsonNumber(value: unknown) {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTemperature(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 2
}

function isCodeGraderTimeout(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 && value <= 5000
}

function isRegexFlag(value: unknown): value is string {
  return value === 'ignorecase' || value === 'multiline' || value === 'dotall'
}

function isEvalCaseStatus(value: unknown): value is EvalCaseStatus {
  return value === 'passed' || value === 'failed' || value === 'not_evaluated'
}

function isEvalGradeStatus(value: unknown): value is EvalGradeStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped'
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
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

function parseDatasetFileFormat(value: string): EvalDatasetFileFormat | null {
  return SUPPORTED_DATASET_FORMATS.find((format) => format === value) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
