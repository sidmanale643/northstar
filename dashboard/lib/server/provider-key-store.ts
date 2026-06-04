import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { BackendProjectId } from '@/lib/projects'
import {
  PROVIDER_KEY_INFOS,
  parseProvider,
  providerInfo,
  requiredProviderForModel,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from '@/lib/provider-key-config'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DashboardEncryptedProviderKey,
  DashboardProviderKey,
} from '@/lib/supabase/types'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_KEY_BYTES = 32
const ENCRYPTION_IV_BYTES = 12
const MAX_API_KEY_LENGTH = 20_000

export class MissingProviderKeyError extends Error {
  constructor(
    readonly provider: ProviderKeyProvider,
    readonly envVar: string
  ) {
    super(`Missing ${provider} provider key`)
    this.name = 'MissingProviderKeyError'
  }
}

export class ProviderKeyStoreError extends Error {
  readonly code: string | null
  readonly details: string | null
  readonly hint: string | null

  constructor(operation: string, error: unknown) {
    const parsed = parseStoreError(error)
    super(`Provider key store ${operation} failed: ${parsed.message}`)
    this.name = 'ProviderKeyStoreError'
    this.code = parsed.code
    this.details = parsed.details
    this.hint = parsed.hint
  }
}

export function providerKeyMissingMessage(error: MissingProviderKeyError) {
  return {
    reason: `Provider key for ${providerInfo(error.provider).label} is not configured.`,
    feedback: (
      `Add ${error.envVar} in Settings > Provider keys, or set ${error.envVar} ` +
      'on the dashboard server, then rerun the eval.'
    ),
  }
}

export async function listProviderKeyStatuses(
  projectId: BackendProjectId
): Promise<ProviderKeyStatus[]> {
  const { data, error } = await createAdminClient().rpc('dashboard_list_provider_keys', {
    p_project_id: projectId,
  })

  if (error) throw new ProviderKeyStoreError('list', error)

  const rowsByProvider = new Map(
    data.map((row) => [row.provider, row])
  )

  return PROVIDER_KEY_INFOS.map((info) => {
    const row = rowsByProvider.get(info.provider)
    return {
      provider: info.provider,
      envVar: info.envVar,
      configured: Boolean(row),
      keyHint: row?.key_hint ?? null,
      updatedAt: row?.updated_at ?? null,
    }
  })
}

export async function upsertProviderKey(input: {
  projectId: BackendProjectId
  provider: ProviderKeyProvider
  apiKey: string
}): Promise<ProviderKeyStatus> {
  const apiKey = input.apiKey.trim()
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error('apiKey must be a non-empty string under 20000 characters.')
  }

  const encryptedApiKey = encryptProviderApiKey(apiKey)
  const keyHint = maskProviderApiKey(apiKey)

  const { data, error } = await createAdminClient()
    .rpc('dashboard_upsert_provider_key', {
      p_project_id: input.projectId,
      p_provider: input.provider,
      p_encrypted_api_key: encryptedApiKey,
      p_key_hint: keyHint,
    })
    .single()

  if (error) throw new ProviderKeyStoreError('save', error)
  return rowToStatus(data)
}

export async function deleteProviderKey(input: {
  projectId: BackendProjectId
  provider: ProviderKeyProvider
}): Promise<void> {
  const { error } = await createAdminClient().rpc('dashboard_delete_provider_key', {
    p_project_id: input.projectId,
    p_provider: input.provider,
  })

  if (error) throw new ProviderKeyStoreError('delete', error)
}

export async function providerKeyEnvForModels(
  projectId: BackendProjectId,
  models: string[],
  baseEnv: Record<string, string | undefined>
): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  const requiredInfos = new Map(
    models
      .map(requiredProviderForModel)
      .filter((info): info is Exclude<typeof info, null> => info !== null)
      .map((info) => [info.provider, info])
  )

  for (const info of Array.from(requiredInfos.values())) {
    const envApiKey = baseEnv[info.envVar]
    if (envApiKey && preferServerEnvProviderKeys()) {
      env[info.envVar] = envApiKey
      continue
    }

    let apiKey: string | null
    try {
      apiKey = await readProviderApiKey(projectId, info.provider)
    } catch (error) {
      if (envApiKey) continue
      throw error
    }
    if (apiKey) {
      env[info.envVar] = apiKey
      continue
    }
    if (envApiKey) continue
    throw new MissingProviderKeyError(info.provider, info.envVar)
  }

  return env
}

export function preferServerEnvProviderKeys(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function encryptProviderApiKey(apiKey: string): string {
  const key = readEncryptionKey()
  const iv = randomBytes(ENCRYPTION_IV_BYTES)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptProviderApiKey(payload: string): string {
  const [ivPart, authTagPart, ciphertextPart] = payload.split('.')
  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error('Provider key ciphertext is invalid.')
  }

  const key = readEncryptionKey()
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(ivPart, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function rowToStatus(row: DashboardProviderKey): ProviderKeyStatus {
  const parsedProvider = parseProvider(row.provider)
  if (!parsedProvider) throw new Error(`Unsupported provider: ${row.provider}`)
  const provider = providerInfo(parsedProvider)
  return {
    provider: provider.provider,
    envVar: provider.envVar,
    configured: true,
    keyHint: row.key_hint,
    updatedAt: row.updated_at,
  }
}

async function readProviderApiKey(
  projectId: BackendProjectId,
  provider: ProviderKeyProvider
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .rpc('dashboard_get_provider_key', {
      p_project_id: projectId,
      p_provider: provider,
    })
    .maybeSingle()

  if (error) throw new ProviderKeyStoreError('read', error)
  const row: DashboardEncryptedProviderKey | null = data
  return row ? decryptProviderApiKey(row.encrypted_api_key) : null
}

function readEncryptionKey(): Buffer {
  const rawKey = process.env.PROVIDER_KEYS_ENCRYPTION_KEY
  if (!rawKey) {
    throw new Error('Missing PROVIDER_KEYS_ENCRYPTION_KEY.')
  }

  const key = Buffer.from(rawKey, 'base64')
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error('PROVIDER_KEYS_ENCRYPTION_KEY must be a 32-byte base64 value.')
  }
  return key
}

function maskProviderApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '...' + apiKey.slice(-4)
  return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`
}

function parseStoreError(error: unknown): {
  message: string
  code: string | null
  details: string | null
  hint: string | null
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: null,
      details: null,
      hint: null,
    }
  }

  if (!isRecord(error)) {
    return {
      message: String(error),
      code: null,
      details: null,
      hint: null,
    }
  }

  return {
    message: readStringField(error, 'message') ?? JSON.stringify(error),
    code: readStringField(error, 'code'),
    details: readStringField(error, 'details'),
    hint: readStringField(error, 'hint'),
  }
}

function readStringField(
  value: Record<string, unknown>,
  field: string
): string | null {
  const fieldValue = value[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
