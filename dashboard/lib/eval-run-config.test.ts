import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseEvalRunConfigBody } from '@/lib/eval-run-config'

describe('parseEvalRunConfigBody', () => {
  it('accepts trace grader configs', () => {
    const minimal = parseEvalRunConfigBody({
      graders: [
        {
          type: 'trace',
          name: 'failure_origin_check',
          check: 'failure_origin',
        },
      ],
    })
    assert.ok(minimal.ok)
    assert.deepEqual(minimal.config.graders[0], {
      type: 'trace',
      name: 'failure_origin_check',
      check: 'failure_origin',
    })

    const llm = parseEvalRunConfigBody({
      graders: [
        {
          type: 'trace',
          name: 'hallucination_check',
          check: 'hallucinated_tool_result_judge',
          model: 'openai/gpt-4o-mini',
          temperature: 0,
        },
      ],
    })
    assert.ok(llm.ok)
    assert.deepEqual(llm.config.graders[0], {
      type: 'trace',
      name: 'hallucination_check',
      check: 'hallucinated_tool_result_judge',
      model: 'openai/gpt-4o-mini',
      temperature: 0,
    })
  })

  it('rejects malformed trace grader configs', () => {
    const malformed = [
      { type: 'trace', name: 'missing_check' },
      { type: 'trace', name: '', check: 'failure_origin' },
      { type: 'trace', name: 'bad_temperature', check: 'hallucinated_tool_result_judge', temperature: 3 },
      { type: 'trace', name: 'bad_model', check: 'failure_origin', model: 'openai/gpt-4o-mini' },
      { type: 'trace', name: 'unknown_check', check: 'not_a_check' },
    ]

    for (const grader of malformed) {
      assert.equal(parseEvalRunConfigBody({ graders: [grader] }).ok, false)
    }
  })

  it('rejects duplicate grader names', () => {
    const result = parseEvalRunConfigBody({
      graders: [
        { type: 'trace', name: 'same', check: 'failure_origin' },
        { type: 'trace', name: 'same', check: 'step_cost_attribution' },
      ],
    })

    assert.equal(result.ok, false)
  })
})
