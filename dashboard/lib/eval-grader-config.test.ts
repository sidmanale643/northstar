import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildEvalRunRequest,
  createPresetGrader,
} from '@/lib/eval-grader-config'
import {
  DEFAULT_RUBRIC_JUDGE_MODEL,
  predefinedLlmGraders,
} from '@/lib/eval-types'
import { parseEvalRunConfigBody } from '@/lib/eval-run-config'

describe('predefined LLM graders', () => {
  it('defines the four supported presets with the expected scoring defaults', () => {
    assert.deepEqual(
      predefinedLlmGraders.map((preset) => preset.id),
      ['correctness', 'faithfulness', 'helpfulness', 'safety_refusal_quality']
    )

    for (const preset of predefinedLlmGraders.slice(0, 3)) {
      assert.equal(preset.model, DEFAULT_RUBRIC_JUDGE_MODEL)
      assert.equal(preset.temperature, '0')
      assert.equal(preset.scoringMode, 'numeric')
      assert.equal(preset.minScore, '0')
      assert.equal(preset.maxScore, '5')
      assert.equal(preset.passingScore, '4')
    }

    const safetyPreset = predefinedLlmGraders[3]
    assert.equal(safetyPreset.model, DEFAULT_RUBRIC_JUDGE_MODEL)
    assert.equal(safetyPreset.temperature, '0')
    assert.equal(safetyPreset.scoringMode, 'binary')
  })

  it('creates editable rubric drafts and allocates unique duplicate names', () => {
    const faithfulness = predefinedLlmGraders[1]
    const first = createPresetGrader({
      current: [],
      preset: faithfulness,
      id: 'first',
    })
    const second = createPresetGrader({
      current: [first],
      preset: faithfulness,
      id: 'second',
    })

    assert.equal(first.name, 'faithfulness_judge_1')
    assert.equal(second.name, 'faithfulness_judge_2')
    assert.equal(first.type, 'rubric')
    assert.equal(first.rubric, faithfulness.rubric)
    assert.equal('predefinedId' in first, false)
  })
})

describe('buildEvalRunRequest', () => {
  it('accepts an empty grader configuration', () => {
    const result = buildEvalRunRequest([])

    assert.deepEqual(result, {
      ok: true,
      request: { graders: [] },
    })
    assert.ok(result.ok)
    assert.deepEqual(parseEvalRunConfigBody(result.request), {
      ok: true,
      config: { graders: [] },
    })
  })

  it('serializes edits made to a preset draft', () => {
    const draft = createPresetGrader({
      current: [],
      preset: predefinedLlmGraders[0],
      id: 'correctness',
    })
    const edited = {
      ...draft,
      name: 'custom_correctness',
      model: 'openai/gpt-4o-mini',
      rubric: 'Return a high score only when the answer is exact.',
      scoringMode: 'numeric' as const,
      minScore: '1',
      maxScore: '10',
      passingScore: '8',
      temperature: '0.2',
    }

    assert.deepEqual(buildEvalRunRequest([edited]), {
      ok: true,
      request: {
        graders: [
          {
            type: 'rubric',
            name: 'custom_correctness',
            model: 'openai/gpt-4o-mini',
            rubric: 'Return a high score only when the answer is exact.',
            temperature: 0.2,
            scoring: {
              mode: 'numeric',
              min_score: 1,
              max_score: 10,
              passing_score: 8,
            },
          },
        ],
      },
    })
  })
})
