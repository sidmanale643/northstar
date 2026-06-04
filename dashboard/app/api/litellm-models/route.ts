import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const LITELLM_MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const MAX_MODEL_RESULTS = 20

interface LiteLlmModelSearchResult {
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

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? ''

  try {
    const response = await fetch(LITELLM_MODEL_CATALOG_URL, {
      next: { revalidate: 60 * 60 },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Unable to search LiteLLM models.' }, { status: 502 })
    }

    const payload: unknown = await response.json()
    const models = parseModelCatalog(payload)
    if (!models) {
      return NextResponse.json({ error: 'LiteLLM returned an invalid model catalog.' }, { status: 502 })
    }

    return NextResponse.json(
      { models: filterModels(models, query) },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
    )
  } catch (error) {
    console.error('litellm_model_search failed:', error)
    return NextResponse.json({ error: 'Unable to search LiteLLM models.' }, { status: 502 })
  }
}

function parseModelCatalog(value: unknown): LiteLlmModelSearchResult[] | null {
  if (!isRecord(value)) return null

  const models: LiteLlmModelSearchResult[] = []

  if (Array.isArray(value.data)) {
    for (const entry of value.data) {
      const model = parseModelEntry(entry, null)
      if (model) models.push(model)
    }
    return models
  }

  for (const [id, entry] of Object.entries(value)) {
    const model = parseModelEntry(entry, id)
    if (model) models.push(model)
  }

  return models
}

function parseModelEntry(value: unknown, fallbackId: string | null): LiteLlmModelSearchResult | null {
  if (!isRecord(value)) return null

  const id = readString(value.id) ?? fallbackId
  if (!id || id === 'sample_spec') return null

  const mode = readString(value.mode) ?? 'unknown'
  if (mode !== 'chat' && mode !== 'completion') return null

  return {
    id,
    provider: readString(value.provider) ?? readString(value.litellm_provider) ?? 'unknown',
    mode,
    maxInputTokens: readNumber(value.max_input_tokens),
    maxOutputTokens: readNumber(value.max_output_tokens),
    inputCostPerMillion: costPerMillion(value.input_cost_per_token),
    outputCostPerMillion: costPerMillion(value.output_cost_per_token),
    supportsFunctionCalling: readBoolean(value.supports_function_calling),
    supportsResponseSchema: readBoolean(value.supports_response_schema),
    supportsSystemMessages: readBoolean(value.supports_system_messages),
    supportsVision: readBoolean(value.supports_vision),
  }
}

function filterModels(models: LiteLlmModelSearchResult[], query: string) {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? models.filter((model) => `${model.id} ${model.provider} ${model.mode}`.toLowerCase().includes(needle))
    : models

  return filtered
    .sort((left, right) => modelRank(right) - modelRank(left) || left.id.localeCompare(right.id))
    .slice(0, MAX_MODEL_RESULTS)
}

function modelRank(model: LiteLlmModelSearchResult) {
  let rank = 0
  if (model.mode === 'chat') rank += 4
  if (model.supportsSystemMessages) rank += 2
  if (model.supportsFunctionCalling) rank += 1
  if (model.supportsResponseSchema) rank += 1
  return rank
}

function costPerMillion(value: unknown) {
  const cost = readNumber(value)
  return cost === null ? null : cost * 1_000_000
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
