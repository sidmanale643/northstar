import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decryptProviderApiKey,
  encryptProviderApiKey,
  MissingProviderKeyError,
  ProviderKeyStoreError,
  preferServerEnvProviderKeys,
  providerKeyMissingMessage,
} from './provider-key-store'

test('provider key encryption round trips without storing plaintext', () => {
  process.env.PROVIDER_KEYS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64')

  const encrypted = encryptProviderApiKey('sk-test-secret')

  assert.equal(encrypted.includes('sk-test-secret'), false)
  assert.equal(decryptProviderApiKey(encrypted), 'sk-test-secret')
})

test('missing provider key message points to settings', () => {
  const error = new MissingProviderKeyError('openrouter', 'OPENROUTER_API_KEY')
  const message = providerKeyMissingMessage(error)

  assert.equal(message.reason.includes('OpenRouter'), true)
  assert.equal(message.feedback.includes('Settings > Provider keys'), true)
  assert.equal(message.feedback.includes('OPENROUTER_API_KEY'), true)
})

test('provider key store wraps Supabase errors as Error instances', () => {
  const error = new ProviderKeyStoreError('read', {
    code: 'PGRST202',
    message: 'Could not find the function dashboard_get_provider_key',
    details: 'Searched the schema cache.',
    hint: 'Reload the schema cache.',
  })

  assert.equal(error instanceof Error, true)
  assert.equal(error.name, 'ProviderKeyStoreError')
  assert.equal(error.code, 'PGRST202')
  assert.equal(error.message.includes('dashboard_get_provider_key'), true)
  assert.equal(error.details, 'Searched the schema cache.')
  assert.equal(error.hint, 'Reload the schema cache.')
})

test('server env provider keys are preferred outside production', () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    assert.equal(preferServerEnvProviderKeys(), true)
    process.env.NODE_ENV = 'production'
    assert.equal(preferServerEnvProviderKeys(), false)
  } finally {
    process.env.NODE_ENV = originalNodeEnv
  }
})
