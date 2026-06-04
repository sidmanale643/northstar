import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProvider, requiredProviderForModel } from './provider-key-config'

test('parseProvider rejects unsupported providers', () => {
  assert.equal(parseProvider('openai')?.toString(), 'openai')
  assert.equal(parseProvider('unsupported'), null)
})

test('requiredProviderForModel maps common judge model providers', () => {
  assert.equal(requiredProviderForModel('openai/gpt-4o')?.envVar, 'OPENAI_API_KEY')
  assert.equal(
    requiredProviderForModel('anthropic/claude-3-5-sonnet')?.envVar,
    'ANTHROPIC_API_KEY'
  )
  assert.equal(
    requiredProviderForModel('openrouter/openai/gpt-oss-120b:free')?.envVar,
    'OPENROUTER_API_KEY'
  )
  assert.equal(
    requiredProviderForModel('deepseek/deepseek-v4-flash')?.envVar,
    'DEEPSEEK_API_KEY'
  )
  assert.equal(
    requiredProviderForModel('openrouter/deepseek/deepseek-v4-flash')?.envVar,
    'OPENROUTER_API_KEY'
  )
})
