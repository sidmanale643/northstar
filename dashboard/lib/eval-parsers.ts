import type { Json } from '@/lib/supabase/types'
import type { CasePayload, EvalResultPayload, GradePayload, GradeStatus, CaseStatus } from '@/lib/eval-types'

export function parseEvalResult(value: Json): EvalResultPayload | null {
  if (!isRecord(value) || !Array.isArray(value.case_results)) return null

  const caseResults = value.case_results.map(parseCaseResult)
  if (caseResults.some((caseResult) => caseResult === null)) return null

  return {
    caseResults: caseResults.filter((caseResult): caseResult is CasePayload => caseResult !== null),
  }
}

function parseCaseResult(value: unknown): CasePayload | null {
  if (
    !isRecord(value) ||
    typeof value.case_id !== 'string' ||
    !isCaseStatus(value.status) ||
    !Array.isArray(value.grades)
  ) {
    return null
  }

  const grades = value.grades.map(parseGradeResult)
  if (grades.some((grade) => grade === null)) return null

  return {
    caseId: value.case_id,
    status: value.status,
    grades: grades.filter((grade): grade is GradePayload => grade !== null),
  }
}

function parseGradeResult(value: unknown): GradePayload | null {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !isGradeStatus(value.status) ||
    typeof value.reason !== 'string' ||
    (value.feedback !== null && typeof value.feedback !== 'string') ||
    !optionalJsonNumber(value.score) ||
    !optionalJsonNumber(value.threshold) ||
    (value.label !== undefined && value.label !== null && typeof value.label !== 'string') ||
    !optionalJsonNumber(value.confidence) ||
    (value.evidence !== undefined && !Array.isArray(value.evidence)) ||
    (Array.isArray(value.evidence) &&
      !value.evidence.every((item) => typeof item === 'string')) ||
    (value.metadata !== undefined && !isJson(value.metadata))
  ) {
    return null
  }

  const evidence = value.evidence ?? []
  if (
    !Array.isArray(evidence) ||
    !evidence.every((item) => typeof item === 'string') ||
    (value.metadata !== undefined && !isJson(value.metadata))
  ) {
    return null
  }

  const score = typeof value.score === 'number' ? value.score : null
  const threshold = typeof value.threshold === 'number' ? value.threshold : null
  const label = typeof value.label === 'string' ? value.label : null
  const confidence = typeof value.confidence === 'number' ? value.confidence : null
  const feedback = typeof value.feedback === 'string' ? value.feedback : null
  const metadata = value.metadata === undefined ? {} : value.metadata

  return {
    name: value.name,
    status: value.status,
    reason: value.reason,
    feedback,
    score,
    threshold,
    label,
    confidence,
    evidence,
    metadata,
  }
}

function isCaseStatus(value: unknown): value is CaseStatus {
  return value === 'passed' || value === 'failed' || value === 'not_evaluated'
}

function isGradeStatus(value: unknown): value is GradeStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped'
}

function optionalJsonNumber(value: unknown) {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
