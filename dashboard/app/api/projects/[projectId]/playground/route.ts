import { type NextRequest } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { getDashboardPrompt } from '@/lib/supabase/dashboard'
import {
  MissingProviderKeyError,
  providerKeyEnvForModels,
} from '@/lib/server/provider-key-store'
import { requiredProviderForModel } from '@/lib/provider-key-config'
import type { DashboardPromptVersion } from '@/lib/supabase/types'

export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlaygroundRequestBody {
  promptId: string
  versionId: string
  variables: Record<string, string>
  model?: string
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function buildSseStream(
  generator: (controller: ReadableStreamDefaultController) => Promise<void>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(payload)))
      }

      try {
        await generator({ ...controller, enqueue: send } as unknown as ReadableStreamDefaultController)
      } finally {
        controller.close()
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

function renderPrompt(content: string, variables: Record<string, string>): string {
  let rendered = content
  for (const [key, value] of Object.entries(variables)) {
    // Replace both {{varName}} and {varName} patterns
    rendered = rendered.replaceAll(`{{${key}}}`, value)
    rendered = rendered.replaceAll(`{${key}}`, value)
  }
  return rendered
}

// ---------------------------------------------------------------------------
// OpenAI streaming
// ---------------------------------------------------------------------------

interface OpenAIDeltaChunk {
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: {
    total_tokens?: number
    completion_tokens?: number
  } | null
}

async function* streamOpenAI(
  model: string,
  prompt: string,
  apiKey: string,
  version: DashboardPromptVersion
): AsyncGenerator<{ text?: string; tokens?: number; done: boolean }> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    stream_options: { include_usage: true },
  }
  if (version.temperature !== null) body.temperature = version.temperature
  if (version.max_tokens !== null) body.max_tokens = version.max_tokens

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => response.statusText)
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
  }

  let totalTokens = 0
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (payload === '[DONE]') {
        yield { done: true, tokens: totalTokens }
        return
      }

      let parsed: OpenAIDeltaChunk
      try {
        parsed = JSON.parse(payload) as OpenAIDeltaChunk
      } catch {
        continue
      }

      if (parsed.usage?.total_tokens) {
        totalTokens = parsed.usage.total_tokens
      }

      const content = parsed.choices?.[0]?.delta?.content
      if (content) {
        yield { text: content, done: false }
      }
    }
  }

  yield { done: true, tokens: totalTokens }
}

// ---------------------------------------------------------------------------
// Anthropic streaming
// ---------------------------------------------------------------------------

interface AnthropicDeltaChunk {
  type?: string
  delta?: { type?: string; text?: string }
  usage?: { output_tokens?: number }
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

async function* streamAnthropic(
  model: string,
  prompt: string,
  apiKey: string,
  version: DashboardPromptVersion
): AsyncGenerator<{ text?: string; tokens?: number; done: boolean }> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: version.max_tokens ?? 1024,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  }
  if (version.temperature !== null) body.temperature = version.temperature

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => response.statusText)
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`)
  }

  let totalTokens = 0
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()

      let parsed: AnthropicDeltaChunk
      try {
        parsed = JSON.parse(payload) as AnthropicDeltaChunk
      } catch {
        continue
      }

      if (parsed.type === 'message_start' && parsed.message?.usage) {
        totalTokens += parsed.message.usage.input_tokens ?? 0
        totalTokens += parsed.message.usage.output_tokens ?? 0
      }

      if (parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
        totalTokens += parsed.usage.output_tokens
      }

      if (
        parsed.type === 'content_block_delta' &&
        parsed.delta?.type === 'text_delta' &&
        parsed.delta.text
      ) {
        yield { text: parsed.delta.text, done: false }
      }

      if (parsed.type === 'message_stop') {
        yield { done: true, tokens: totalTokens }
        return
      }
    }
  }

  yield { done: true, tokens: totalTokens }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  // 1. Auth
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  // 2. Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  if (!isRecord(body)) {
    return new Response(JSON.stringify({ error: 'Request body must be an object' }), { status: 400 })
  }

  const promptId = getNonEmptyString(body.promptId)
  const versionId = getNonEmptyString(body.versionId)

  if (!promptId) {
    return new Response(JSON.stringify({ error: 'promptId is required' }), { status: 400 })
  }
  if (!versionId) {
    return new Response(JSON.stringify({ error: 'versionId is required' }), { status: 400 })
  }

  const variables: Record<string, string> =
    isRecord(body.variables)
      ? Object.fromEntries(
          Object.entries(body.variables).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)])
        )
      : {}

  const bodyModel = getNonEmptyString(body.model)

  // 3. Resolve prompt version
  let version: DashboardPromptVersion | null = null
  try {
    const promptDetail = await getDashboardPrompt(access.backendProjectId, promptId)
    if (!promptDetail) {
      return new Response(JSON.stringify({ error: 'Prompt not found' }), { status: 404 })
    }
    version = (promptDetail.versions ?? []).find((v) => v.id === versionId) ?? null
  } catch (error) {
    console.error('playground: failed to fetch prompt', error)
    return new Response(JSON.stringify({ error: 'Failed to load prompt version' }), { status: 500 })
  }

  if (!version) {
    return new Response(JSON.stringify({ error: 'Prompt version not found' }), { status: 404 })
  }

  // 4. Determine model - prefer body model, then version model, then fallback
  const model = bodyModel ?? version.model ?? 'gpt-4o-mini'

  // 5. Resolve provider API key
  let providerEnv: Record<string, string>
  try {
    providerEnv = await providerKeyEnvForModels(
      access.backendProjectId,
      [model],
      process.env as Record<string, string | undefined>
    )
  } catch (error) {
    if (error instanceof MissingProviderKeyError) {
      return new Response(
        JSON.stringify({
          error: `Missing provider key for ${error.provider}. Configure ${error.envVar} in Settings > Provider keys.`,
        }),
        { status: 400 }
      )
    }
    console.error('playground: failed to resolve provider key', error)
    return new Response(JSON.stringify({ error: 'Failed to resolve provider key' }), { status: 500 })
  }

  // 6. Determine provider
  const providerInfo = requiredProviderForModel(model)
  const provider = providerInfo?.provider ?? 'openai'

  // 7. Render prompt
  const renderedPrompt = renderPrompt(version.content, variables)

  // 8. Build SSE stream
  const startedAt = Date.now()

  const stream = buildSseStream(async (controller) => {
    const send = (payload: unknown) => {
      controller.enqueue(payload)
    }

    try {
      let totalTokens = 0

      if (provider === 'openai') {
        const apiKey = providerEnv['OPENAI_API_KEY'] ?? ''
        for await (const chunk of streamOpenAI(model, renderedPrompt, apiKey, version!)) {
          if (chunk.done) {
            totalTokens = chunk.tokens ?? totalTokens
          } else if (chunk.text) {
            send({ type: 'chunk', text: chunk.text })
          }
        }
      } else if (provider === 'anthropic') {
        const apiKey = providerEnv['ANTHROPIC_API_KEY'] ?? ''
        for await (const chunk of streamAnthropic(model, renderedPrompt, apiKey, version!)) {
          if (chunk.done) {
            totalTokens = chunk.tokens ?? totalTokens
          } else if (chunk.text) {
            send({ type: 'chunk', text: chunk.text })
          }
        }
      } else {
        // Attempt OpenAI-compatible endpoint for known providers, otherwise error
        const openAiCompatProviders = ['openrouter', 'groq', 'mistral', 'together', 'deepseek', 'fireworks', 'perplexity']
        if (openAiCompatProviders.includes(provider)) {
          const providerBaseUrls: Record<string, string> = {
            openrouter: 'https://openrouter.ai/api/v1/chat/completions',
            groq: 'https://api.groq.com/openai/v1/chat/completions',
            mistral: 'https://api.mistral.ai/v1/chat/completions',
            together: 'https://api.together.xyz/v1/chat/completions',
            deepseek: 'https://api.deepseek.com/v1/chat/completions',
            fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
            perplexity: 'https://api.perplexity.ai/chat/completions',
          }
          const baseUrl = providerBaseUrls[provider]
          const envVarKey = providerInfo?.envVar ?? ''
          const apiKey = providerEnv[envVarKey] ?? ''

          const reqBody: Record<string, unknown> = {
            model,
            messages: [{ role: 'user', content: renderedPrompt }],
            stream: true,
          }
          if (version!.temperature !== null) reqBody.temperature = version!.temperature
          if (version!.max_tokens !== null) reqBody.max_tokens = version!.max_tokens

          const resp = await fetch(baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(reqBody),
          })

          if (!resp.ok || !resp.body) {
            const errText = await resp.text().catch(() => resp.statusText)
            throw new Error(`${provider} API error ${resp.status}: ${errText}`)
          }

          const reader = resp.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data:')) continue
              const payload = trimmed.slice('data:'.length).trim()
              if (payload === '[DONE]') break

              let parsed: OpenAIDeltaChunk
              try {
                parsed = JSON.parse(payload) as OpenAIDeltaChunk
              } catch {
                continue
              }

              if (parsed.usage?.total_tokens) {
                totalTokens = parsed.usage.total_tokens
              }

              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                send({ type: 'chunk', text: content })
              }
            }
          }
        } else {
          send({ type: 'error', message: `Provider "${provider}" is not supported for playground` })
          return
        }
      }

      const latency = Date.now() - startedAt
      send({ type: 'done', tokens: totalTokens, latency, cost: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown streaming error'
      console.error('playground: streaming error', error)
      send({ type: 'error', message })
    }
  })

  // 9. Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
