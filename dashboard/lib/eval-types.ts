import type { EvalRunStatus, Json } from '@/lib/supabase/types'

export type GradeStatus = 'passed' | 'failed' | 'skipped'
export type CaseStatus = 'passed' | 'failed' | 'not_evaluated'
export type JudgeScoringMode = 'binary' | 'numeric'
export const DEFAULT_RUBRIC_JUDGE_MODEL = 'openrouter/deepseek/deepseek-v4-flash'

export interface GradePayload {
  name: string
  status: GradeStatus
  reason: string
  feedback: string | null
  score: number | null
  threshold: number | null
  label: string | null
  confidence: number | null
  evidence: string[]
  metadata: Json
}

export interface CasePayload {
  caseId: string
  status: CaseStatus
  grades: GradePayload[]
}

export interface EvalResultPayload {
  caseResults: CasePayload[]
}

export interface LiteLlmModelSearchResult {
  id: string
  provider: string
  mode: string
  maxInputTokens: number | null
  maxOutputTokens: number | null
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  supportsFunctionCalling: boolean | null
  supportsResponseSchema: boolean | null
  supportsSystemMessages: boolean | null
  supportsVision: boolean | null
}

export type RubricJudgeScoringConfig =
  | { mode: 'binary' }
  | {
      mode: 'numeric'
      min_score: number
      max_score: number
      passing_score: number
    }

export interface RubricJudgeRunConfig {
  type: 'rubric'
  name: string
  model: string
  rubric: string
  temperature: number
  scoring: RubricJudgeScoringConfig
}

export interface PythonCodeGraderRunConfig {
  type: 'python'
  name: string
  code: string
  timeout_ms: number
}

export interface TypeScriptCodeGraderRunConfig {
  type: 'typescript'
  name: string
  code: string
  timeout_ms: number
}

export interface RegexGraderRunConfig {
  type: 'regex'
  name: string
  pattern: string
  target: string
  flags: string[]
}

export type EvalGraderRunConfig =
  | RubricJudgeRunConfig
  | PythonCodeGraderRunConfig
  | TypeScriptCodeGraderRunConfig
  | RegexGraderRunConfig

export type EvalRunRequest = {
  graders: EvalGraderRunConfig[]
}

export type EvalGraderKind = 'rubric' | 'python' | 'typescript' | 'regex'

export interface BaseGraderDraft {
  id: string
  type: EvalGraderKind
  name: string
}

export interface RubricJudgeDraft extends BaseGraderDraft {
  type: 'rubric'
  model: string
  rubric: string
  scoringMode: JudgeScoringMode
  minScore: string
  maxScore: string
  passingScore: string
  temperature: string
}

export interface PythonCodeGraderDraft extends BaseGraderDraft {
  type: 'python'
  code: string
  timeoutMs: string
}

export interface TypeScriptCodeGraderDraft extends BaseGraderDraft {
  type: 'typescript'
  code: string
  timeoutMs: string
}

export interface RegexGraderDraft extends BaseGraderDraft {
  type: 'regex'
  pattern: string
  target: string
  flags: string[]
}

export type EvalGraderDraft =
  | RubricJudgeDraft
  | PythonCodeGraderDraft
  | TypeScriptCodeGraderDraft
  | RegexGraderDraft

export interface EvalDatasetWithLatestRun {
  id: string
  name: string
  fileName: string
  fileFormat: string
  byteSize: number
  caseCount: number | null
  createdAt: string
  latestRun: {
    status: EvalRunStatus
    passRate: number
    createdAt: string
  } | null
}

export const deterministicGraders = [
  {
    title: 'Tool usage',
    icon: 'ShieldCheck' as const,
    color: 'text-[#633806]',
    bg: 'bg-[#FAEEDA]',
    items: ['max_tool_calls', 'required_tools', 'forbidden_tools', 'tool_arguments'],
  },
  {
    title: 'Output',
    icon: 'ClipboardList' as const,
    color: 'text-[#0C447C]',
    bg: 'bg-[#E6F1FB]',
    items: ['contains', 'not_contains', 'ground_truth'],
  },
  {
    title: 'Limits',
    icon: 'Gauge' as const,
    color: 'text-[#27500A]',
    bg: 'bg-[#EAF3DE]',
    items: ['max_latency_ms', 'max_cost_usd'],
  },
]
