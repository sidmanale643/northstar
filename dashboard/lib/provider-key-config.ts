export type ProviderKeyProvider =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'gemini'
  | 'groq'
  | 'mistral'
  | 'cohere'
  | 'together'
  | 'deepseek'
  | 'fireworks'
  | 'perplexity'

export interface ProviderKeyInfo {
  provider: ProviderKeyProvider
  label: string
  envVar: string
  modelPrefixes: string[]
}

export const PROVIDER_KEY_INFOS: ProviderKeyInfo[] = [
  { provider: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', modelPrefixes: ['openai'] },
  { provider: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', modelPrefixes: ['anthropic'] },
  { provider: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY', modelPrefixes: ['openrouter'] },
  { provider: 'gemini', label: 'Google / Gemini', envVar: 'GEMINI_API_KEY', modelPrefixes: ['gemini', 'google'] },
  { provider: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY', modelPrefixes: ['groq'] },
  { provider: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY', modelPrefixes: ['mistral'] },
  { provider: 'cohere', label: 'Cohere', envVar: 'COHERE_API_KEY', modelPrefixes: ['cohere'] },
  { provider: 'together', label: 'Together', envVar: 'TOGETHER_API_KEY', modelPrefixes: ['together'] },
  { provider: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', modelPrefixes: ['deepseek'] },
  { provider: 'fireworks', label: 'Fireworks', envVar: 'FIREWORKS_API_KEY', modelPrefixes: ['fireworks'] },
  { provider: 'perplexity', label: 'Perplexity', envVar: 'PERPLEXITY_API_KEY', modelPrefixes: ['perplexity'] },
]

export interface ProviderKeyStatus {
  provider: ProviderKeyProvider
  envVar: string
  configured: boolean
  keyHint: string | null
  updatedAt: string | null
}

export function parseProvider(value: string): ProviderKeyProvider | null {
  return PROVIDER_KEY_INFOS.some((info) => info.provider === value)
    ? value as ProviderKeyProvider
    : null
}

export function providerInfo(provider: ProviderKeyProvider): ProviderKeyInfo {
  const info = PROVIDER_KEY_INFOS.find((entry) => entry.provider === provider)
  if (!info) throw new Error(`Unsupported provider: ${provider}`)
  return info
}

export function requiredProviderForModel(model: string): ProviderKeyInfo | null {
  const trimmed = model.trim()
  if (!trimmed) return null

  if (trimmed.includes('/')) {
    const prefix = trimmed.split('/', 1)[0].toLowerCase()
    return PROVIDER_KEY_INFOS.find((info) => info.modelPrefixes.includes(prefix)) ?? null
  }

  const lowered = trimmed.toLowerCase()
  if (lowered.startsWith('gpt-') || lowered.startsWith('o1-') || lowered.startsWith('o3-') || lowered.startsWith('o4-') || lowered.startsWith('text-embedding-') || lowered.startsWith('dall-e') || lowered.startsWith('whisper')) {
    return providerInfo('openai')
  }
  if (lowered.startsWith('claude')) return providerInfo('anthropic')
  if (lowered.startsWith('gemini')) return providerInfo('gemini')
  if (lowered.startsWith('command')) return providerInfo('cohere')
  if (lowered.startsWith('mixtral') || lowered.startsWith('mistral')) return providerInfo('mistral')
  return null
}
