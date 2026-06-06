import type {
  EvalGraderDraft,
  EvalGraderRunConfig,
  EvalRunRequest,
  PredefinedLlmGrader,
  RubricJudgeDraft,
} from '@/lib/eval-types'

type BuildEvalRunRequestResult =
  | { ok: true; request: EvalRunRequest }
  | { ok: false; error: string }

export function createPresetGrader({
  current,
  preset,
  id,
}: {
  current: EvalGraderDraft[]
  preset: PredefinedLlmGrader
  id: string
}): RubricJudgeDraft {
  return {
    id,
    type: 'rubric',
    name: nextGraderName(current, preset.defaultName, 1),
    model: preset.model,
    rubric: preset.rubric,
    scoringMode: preset.scoringMode,
    minScore: preset.minScore,
    maxScore: preset.maxScore,
    passingScore: preset.passingScore,
    temperature: preset.temperature,
  }
}

export function nextGraderName(
  current: EvalGraderDraft[],
  prefix: string,
  startAt: number
): string {
  const existingNames = new Set(current.map((grader) => grader.name.trim()))
  let nextNumber = startAt
  while (existingNames.has(`${prefix}_${nextNumber}`)) {
    nextNumber += 1
  }
  return `${prefix}_${nextNumber}`
}

export function buildEvalRunRequest(
  draftGraders: EvalGraderDraft[]
): BuildEvalRunRequestResult {
  if (draftGraders.length === 0) {
    return { ok: true, request: { graders: [] } }
  }

  const seenNames = new Set<string>()
  const graders: EvalGraderRunConfig[] = []
  for (let index = 0; index < draftGraders.length; index += 1) {
    const grader = draftGraders[index]
    const label = `Grader ${index + 1}`
    const name = grader.name.trim()

    if (!name) return { ok: false, error: `${label} name is required.` }
    if (seenNames.has(name)) {
      return { ok: false, error: `Grader name "${name}" is duplicated.` }
    }
    seenNames.add(name)

    if (grader.type === 'python' || grader.type === 'typescript') {
      const code = grader.code.trim()
      const timeoutMs = parseFiniteInteger(grader.timeoutMs)
      if (!code) return { ok: false, error: `${label} code is required.` }
      if (timeoutMs === null || timeoutMs <= 0 || timeoutMs > 5000) {
        return { ok: false, error: `${label} timeout must be between 1 and 5000ms.` }
      }
      graders.push({
        type: grader.type,
        name,
        code,
        timeout_ms: timeoutMs,
      })
      continue
    }

    if (grader.type === 'regex') {
      const pattern = grader.pattern.trim()
      const target = grader.target.trim() || 'final_response'
      if (!pattern) return { ok: false, error: `${label} regex pattern is required.` }
      graders.push({
        type: 'regex',
        name,
        pattern,
        target,
        flags: grader.flags,
      })
      continue
    }

    if (grader.type === 'trace') {
      const isLlmTraceJudge =
        grader.check === 'hallucinated_tool_result_judge' ||
        grader.check === 'planning_action_mismatch_judge'
      if (!isLlmTraceJudge) {
        graders.push({
          type: 'trace',
          name,
          check: grader.check,
        })
        continue
      }

      const model = grader.model.trim()
      const temperature = parseFiniteNumber(grader.temperature)
      if (!model) return { ok: false, error: `${label} model is required.` }
      if (temperature === null || temperature < 0 || temperature > 2) {
        return { ok: false, error: `${label} temperature must be between 0 and 2.` }
      }
      graders.push({
        type: 'trace',
        name,
        check: grader.check,
        model,
        temperature,
      })
      continue
    }

    const model = grader.model.trim()
    const rubric = grader.rubric.trim()
    const temperature = parseFiniteNumber(grader.temperature)

    if (!model) return { ok: false, error: `${label} model is required.` }
    if (!rubric) return { ok: false, error: `${label} rubric is required.` }
    if (temperature === null || temperature < 0 || temperature > 2) {
      return { ok: false, error: `${label} temperature must be between 0 and 2.` }
    }

    if (grader.scoringMode === 'binary') {
      graders.push({
        type: 'rubric',
        name,
        model,
        rubric,
        temperature,
        scoring: { mode: 'binary' },
      })
      continue
    }

    const minScore = parseFiniteNumber(grader.minScore)
    const maxScore = parseFiniteNumber(grader.maxScore)
    const passingScore = parseFiniteNumber(grader.passingScore)
    if (minScore === null || maxScore === null || passingScore === null) {
      return { ok: false, error: `${label} numeric scoring fields must be valid numbers.` }
    }
    if (maxScore <= minScore) {
      return { ok: false, error: `${label} max score must be greater than min score.` }
    }
    if (passingScore < minScore || passingScore > maxScore) {
      return { ok: false, error: `${label} passing score must be within the score range.` }
    }

    graders.push({
      type: 'rubric',
      name,
      model,
      rubric,
      temperature,
      scoring: {
        mode: 'numeric',
        min_score: minScore,
        max_score: maxScore,
        passing_score: passingScore,
      },
    })
  }

  return { ok: true, request: { graders } }
}

function parseFiniteNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseFiniteInteger(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}
