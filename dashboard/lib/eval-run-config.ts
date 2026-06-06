import type { EvalGraderRunConfig, EvalRunRequest, TraceGraderCheck } from '@/lib/eval-types'

export function parseEvalRunConfigBody(
  body: unknown
): { ok: true; config: EvalRunRequest } | { ok: false; error: string } {
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

function parseGraderRunConfigs(value: unknown): EvalGraderRunConfig[] | null {
  if (!Array.isArray(value)) return null

  const seenNames = new Set<string>()
  const graders: EvalGraderRunConfig[] = []
  for (const entry of value) {
    const grader = parseGraderRunConfig(entry)
    if (!grader || seenNames.has(grader.name)) return null
    seenNames.add(grader.name)
    graders.push(grader)
  }
  return graders
}

function parseGraderRunConfig(value: unknown, fallbackName?: string): EvalGraderRunConfig | null {
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

  if (type === 'trace') {
    if (typeof value.check !== 'string' || !isTraceGraderCheck(value.check)) {
      return null
    }

    const isLlmTraceJudge =
      value.check === 'hallucinated_tool_result_judge' ||
      value.check === 'planning_action_mismatch_judge'
    const model = typeof value.model === 'string' ? value.model.trim() : ''

    if (value.temperature !== undefined && !isTemperature(value.temperature)) {
      return null
    }
    if (value.model !== undefined && !model) {
      return null
    }
    if (model && !isLlmTraceJudge) {
      return null
    }

    return {
      type: 'trace',
      name,
      check: value.check,
      ...(model ? { model } : {}),
      ...(value.temperature === undefined ? {} : { temperature: value.temperature }),
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTemperature(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 2
}

function isCodeGraderTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 5000
}

function isRegexFlag(value: unknown): value is string {
  return value === 'ignorecase' || value === 'multiline' || value === 'dotall'
}

function isTraceGraderCheck(value: unknown): value is TraceGraderCheck {
  return (
    value === 'bad_tool_failure_recovery' ||
    value === 'unnecessary_tool_loop' ||
    value === 'stale_context_usage' ||
    value === 'invalid_state_transition' ||
    value === 'retrieval_precision_recall' ||
    value === 'step_cost_attribution' ||
    value === 'failure_origin' ||
    value === 'hallucinated_tool_result_judge' ||
    value === 'planning_action_mismatch_judge'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
