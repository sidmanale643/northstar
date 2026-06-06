'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BookText,
  ChevronDown,
  History,
  Loader2,
  Play,
  Sparkles,
  X,
} from 'lucide-react'
import { DiffPane, type DiffPaneVersion } from '@/components/playground/diff-pane'
import { SaveToDatasetButton } from '@/components/playground/save-to-dataset-button'
import type { ProjectId } from '@/lib/projects'
import type {
  DashboardPrompt,
  DashboardPromptVersion,
  Json,
} from '@/lib/supabase/types'
import { requiredProviderForModel } from '@/lib/provider-key-config'
import { cn } from '@/lib/utils'

interface PlaygroundPageProps {
  projectId: ProjectId
  initialPromptId?: string
  initialVersionId?: string
}

interface PromptListResponse {
  prompts: DashboardPrompt[]
}

interface PromptDetailResponse {
  prompt?: DashboardPrompt & {
    versions?: DashboardPromptVersion[] | null
  }
}

interface ProviderKeyStatus {
  provider: string
  envVar: string
  configured: boolean
}

interface ProviderKeyListResponse {
  providerKeys?: ProviderKeyStatus[]
}

interface PromptVariable {
  name: string
  type?: string
  required?: boolean
  default?: Json | null
}

export function PlaygroundPage({
  projectId,
  initialPromptId,
  initialVersionId,
}: PlaygroundPageProps) {
  const [prompts, setPrompts] = useState<DashboardPrompt[]>([])
  const [promptsError, setPromptsError] = useState<string | null>(null)
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false)
  const [selectedPromptId, setSelectedPromptId] = useState<string>(initialPromptId ?? '')
  const [selectedVersionId, setSelectedVersionId] = useState<string>(initialVersionId ?? '')
  const [selectedLabel, setSelectedLabel] = useState<string>('')
  const [versions, setVersions] = useState<DashboardPromptVersion[]>([])
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [model, setModel] = useState<string>('')
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [streamedOutput, setStreamedOutput] = useState<string>('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamMetrics, setStreamMetrics] = useState<{ tokens: number | null; latency: number | null }>({
    tokens: null,
    latency: null,
  })
  const [providerKeys, setProviderKeys] = useState<ProviderKeyStatus[]>([])
  const [providerKeysLoaded, setProviderKeysLoaded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showDiff, setShowDiff] = useState(true)
  const [promptMenuOpen, setPromptMenuOpen] = useState(false)
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const promptMenuRef = useRef<HTMLDivElement>(null)
  const versionMenuRef = useRef<HTMLDivElement>(null)

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId) ?? null,
    [prompts, selectedPromptId]
  )
  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? versions[0] ?? null,
    [versions, selectedVersionId]
  )

  const labelEntries = useMemo(() => readLabelEntries(selectedPrompt?.labels), [selectedPrompt])
  const labelToVersionId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const { label, versionId } of labelEntries) {
      map[label] = versionId
    }
    return map
  }, [labelEntries])
  const versionIdToLabels = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const { label, versionId } of labelEntries) {
      if (!map[versionId]) map[versionId] = []
      map[versionId].push(label)
    }
    return map
  }, [labelEntries])
  const variablesList = useMemo<PromptVariable[]>(
    () => readVariables(selectedVersion?.variables),
    [selectedVersion]
  )

  const effectiveModel = (model.trim() || selectedVersion?.model || '').trim()
  const requiredProvider = effectiveModel ? requiredProviderForModel(effectiveModel) : null
  const providerConfigured =
    !requiredProvider ||
    providerKeys.some(
      (key) => key.provider === requiredProvider.provider && key.configured
    )
  const canRun =
    Boolean(selectedPrompt) &&
    Boolean(selectedVersion) &&
    Boolean(effectiveModel) &&
    providerConfigured &&
    !isStreaming

  useEffect(() => {
    let isCurrent = true
    async function loadPrompts() {
      setIsLoadingPrompts(true)
      setPromptsError(null)
      try {
        const response = await fetch(`/api/projects/${projectId}/prompts`, { cache: 'no-store' })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(readApiError(body))
        const parsed = parsePromptList(body)
        if (!parsed) throw new Error('The server returned an invalid prompt list.')
        if (!isCurrent) return
        setPrompts(parsed.prompts)
      } catch (error) {
        if (isCurrent) {
          setPrompts([])
          setPromptsError(error instanceof Error ? error.message : 'Unable to load prompts.')
        }
      } finally {
        if (isCurrent) setIsLoadingPrompts(false)
      }
    }
    void loadPrompts()
    return () => {
      isCurrent = false
    }
  }, [projectId])

  useEffect(() => {
    let isCurrent = true
    async function loadProviderKeys() {
      try {
        const response = await fetch(`/api/projects/${projectId}/provider-keys`, {
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) return
        const parsed = parseProviderKeyList(body)
        if (!isCurrent) return
        setProviderKeys(parsed?.providerKeys ?? [])
      } finally {
        if (isCurrent) setProviderKeysLoaded(true)
      }
    }
    void loadProviderKeys()
    return () => {
      isCurrent = false
    }
  }, [projectId])

  const loadVersions = useCallback(
    async (promptId: string) => {
      if (!promptId) {
        setVersions([])
        return
      }
      setIsLoadingVersions(true)
      setVersionsError(null)
      try {
        const response = await fetch(`/api/projects/${projectId}/prompts/${promptId}`, {
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(readApiError(body))
        const parsed = parsePromptDetail(body)
        const next = parsed?.prompt?.versions ?? []
        setVersions(next)
      } catch (error) {
        setVersions([])
        setVersionsError(error instanceof Error ? error.message : 'Unable to load versions.')
      } finally {
        setIsLoadingVersions(false)
      }
    },
    [projectId]
  )

  useEffect(() => {
    void loadVersions(selectedPromptId)
  }, [loadVersions, selectedPromptId])

  useEffect(() => {
    if (versions.length === 0) {
      setSelectedVersionId('')
      setSelectedLabel('')
      return
    }
    const hasCurrent = versions.some((v) => v.id === selectedVersionId)
    if (initialVersionId && versions.some((v) => v.id === initialVersionId)) {
      setSelectedVersionId(initialVersionId)
      return
    }
    if (!hasCurrent) {
      const prodVersionId = labelToVersionId['prod']
      const fallback = prodVersionId
        ? versions.find((v) => v.id === prodVersionId)
        : versions[0]
      if (fallback) {
        setSelectedVersionId(fallback.id)
        if (fallback.id === prodVersionId) setSelectedLabel('prod')
        else setSelectedLabel('')
      }
    }
  }, [versions, selectedVersionId, initialVersionId, labelToVersionId])

  useEffect(() => {
    if (!selectedVersion) return
    if (model.trim() && model.trim() === selectedVersion.model) return
    setModel(selectedVersion.model ?? '')
  }, [selectedVersion, model])

  useEffect(() => {
    if (variablesList.length === 0) {
      setVariableValues({})
      return
    }
    setVariableValues((current) => {
      const next: Record<string, string> = {}
      for (const variable of variablesList) {
        const key = variable.name
        if (!key) continue
        next[key] = current[key] ?? stringFromDefault(variable.default)
      }
      return next
    })
  }, [variablesList])

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node
      if (promptMenuRef.current && !promptMenuRef.current.contains(target)) {
        setPromptMenuOpen(false)
      }
      if (versionMenuRef.current && !versionMenuRef.current.contains(target)) {
        setVersionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function pickPrompt(promptId: string) {
    setSelectedPromptId(promptId)
    setSelectedVersionId('')
    setSelectedLabel('')
    setStreamedOutput('')
    setStreamError(null)
    setStreamMetrics({ tokens: null, latency: null })
    setPromptMenuOpen(false)
  }

  function pickVersion(versionId: string) {
    setSelectedVersionId(versionId)
    setSelectedLabel('')
    setVersionMenuOpen(false)
  }

  function pickLabel(label: string) {
    const versionId = labelToVersionId[label]
    if (!versionId) return
    setSelectedLabel(label)
    setSelectedVersionId(versionId)
  }

  async function handleRun() {
    if (!selectedPrompt || !selectedVersion) return
    if (!effectiveModel) {
      setStreamError('Pick a model before running.')
      return
    }
    if (!providerConfigured) {
      setStreamError(
        `Add your ${requiredProvider?.label ?? 'provider'} API key in Settings → Provider keys before running.`
      )
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsStreaming(true)
    setStreamError(null)
    setStreamedOutput('')
    setStreamMetrics({ tokens: null, latency: null })

    const variablesPayload: Record<string, string> = {}
    for (const variable of variablesList) {
      variablesPayload[variable.name] = variableValues[variable.name] ?? ''
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptId: selectedPrompt.id,
          versionId: selectedVersion.id,
          variables: variablesPayload,
          model: effectiveModel,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `Playground request failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let splitAt: number
        while ((splitAt = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, splitAt)
          buffer = buffer.slice(splitAt + 2)
          const payload = rawEvent.replace(/^data:\s*/, '').trim()
          if (!payload) continue
          let parsed: PlaygroundSsePayload
          try {
            parsed = JSON.parse(payload) as PlaygroundSsePayload
          } catch {
            continue
          }
          if (parsed.type === 'chunk' && typeof parsed.text === 'string') {
            setStreamedOutput((current) => current + parsed.text)
          } else if (parsed.type === 'done') {
            setStreamMetrics({
              tokens: typeof parsed.tokens === 'number' ? parsed.tokens : null,
              latency: typeof parsed.latency === 'number' ? parsed.latency : null,
            })
          } else if (parsed.type === 'error') {
            setStreamError(parsed.message ?? 'Stream error.')
          }
        }
      }
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        return
      }
      setStreamError(error instanceof Error ? error.message : 'Unable to run prompt.')
    } finally {
      setIsStreaming(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  const prodVersion = useMemo(() => {
    const prodVersionId = labelToVersionId['prod']
    return prodVersionId ? versions.find((v) => v.id === prodVersionId) ?? null : null
  }, [labelToVersionId, versions])

  const baseVersionForDiff: DiffPaneVersion | null = selectedVersion
    ? {
        content: selectedVersion.content,
        model: selectedVersion.model,
        temperature: selectedVersion.temperature,
        max_tokens: selectedVersion.max_tokens,
        variables: selectedVersion.variables,
      }
    : null
  const prodVersionForDiff: DiffPaneVersion | null = prodVersion
    ? {
        content: prodVersion.content,
        model: prodVersion.model,
        temperature: prodVersion.temperature,
        max_tokens: prodVersion.max_tokens,
        variables: prodVersion.variables,
      }
    : null

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 bg-white px-6 py-3">
        <div className="relative" ref={promptMenuRef}>
          <button
            type="button"
            onClick={() => setPromptMenuOpen((v) => !v)}
            disabled={isLoadingPrompts && prompts.length === 0}
            className="ns-button !h-8"
          >
            <BookText className="w-3.5 h-3.5" />
            {selectedPrompt ? selectedPrompt.name : 'Select a prompt'}
            <ChevronDown className="w-3 h-3 opacity-70" />
          </button>
          {promptMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1.5 w-80 rounded-md border border-border bg-background p-1 shadow-lg">
              {prompts.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No prompts available.</div>
              ) : (
                prompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => pickPrompt(prompt.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12px] hover:bg-secondary',
                      prompt.id === selectedPromptId && 'bg-secondary'
                    )}
                  >
                    <BookText className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">{prompt.name}</div>
                      <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                        {prompt.slug}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={versionMenuRef}>
          <button
            type="button"
            onClick={() => setVersionMenuOpen((v) => !v)}
            disabled={!selectedPrompt || versions.length === 0}
            className="ns-button !h-8"
          >
            v{selectedVersion?.version_number ?? '—'}
            {selectedLabel ? (
              <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase text-emerald-700">
                {selectedLabel}
              </span>
            ) : null}
            <ChevronDown className="w-3 h-3 opacity-70" />
          </button>
          {versionMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1.5 w-80 rounded-md border border-border bg-background p-1 shadow-lg">
              {versions.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No versions yet.</div>
              ) : (
                versions.map((version) => {
                  const labels = versionIdToLabels[version.id] ?? []
                  return (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => pickVersion(version.id)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12px] hover:bg-secondary',
                        version.id === selectedVersionId && 'bg-secondary'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-medium text-foreground">
                            v{version.version_number}
                          </span>
                          {labels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase text-emerald-700"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                        {version.change_note ? (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {version.change_note}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        {Object.keys(labelToVersionId).length > 0 && (
          <div className="flex items-center gap-1">
            {Object.keys(labelToVersionId).map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => pickLabel(label)}
                className={cn(
                  'rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors',
                  selectedLabel === label
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-border bg-white text-muted-foreground hover:text-foreground'
                )}
                title={`Jump to ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className={cn('ns-button !h-8', showHistory && 'bg-secondary')}
          title="Version history"
        >
          <History className="w-3.5 h-3.5" />
          History
        </button>
      </div>

      {promptsError && (
        <div className="border-b border-[#F09595] bg-[#FCEBEB] px-6 py-2 text-[12px] text-[#791F1F]">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            {promptsError}
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <section className="flex w-[440px] shrink-0 flex-col border-r border-border/60 bg-white">
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <div>
              <div className="ns-label mb-1.5">Model</div>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="ns-input h-8 w-full"
                placeholder={selectedVersion?.model ?? 'gpt-4o, claude-3-5-sonnet, …'}
                spellCheck={false}
              />
              {effectiveModel && requiredProvider ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Uses {requiredProvider.label} ·{' '}
                  {providerConfigured ? (
                    <span className="text-emerald-700">key configured</span>
                  ) : (
                    <span className="text-[#791F1F]">add {requiredProvider.envVar} in Settings</span>
                  )}
                </div>
              ) : null}
            </div>

            {variablesList.length > 0 && (
              <div>
                <div className="ns-label mb-1.5">Variables</div>
                <div className="space-y-2">
                  {variablesList.map((variable) => (
                    <div key={variable.name}>
                      <label className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                        <span className="font-mono">{variable.name}</span>
                        {variable.required ? (
                          <span className="text-[#791F1F]">*</span>
                        ) : (
                          <span className="text-[10px] uppercase text-muted-foreground">optional</span>
                        )}
                        {variable.type && variable.type !== 'string' ? (
                          <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                            {variable.type}
                          </span>
                        ) : null}
                      </label>
                      <input
                        value={variableValues[variable.name] ?? ''}
                        onChange={(event) =>
                          setVariableValues((current) => ({
                            ...current,
                            [variable.name]: event.target.value,
                          }))
                        }
                        className="ns-input h-8 w-full"
                        spellCheck={false}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="ns-label mb-1.5">Rendered prompt</div>
              <pre className="max-h-72 overflow-auto rounded-md border border-border/60 bg-secondary/30 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
                {selectedVersion ? renderPreview(selectedVersion.content, variableValues) : 'No version selected.'}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2">
              {isStreaming ? (
                <button type="button" onClick={handleStop} className="ns-button !h-8">
                  <X className="w-3.5 h-3.5" />
                  Stop
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleRun}
                disabled={!canRun}
                className="ns-button ns-button-primary !h-8"
                title={
                  !selectedPrompt
                    ? 'Pick a prompt first'
                    : !selectedVersion
                    ? 'Pick a version first'
                    : !effectiveModel
                    ? 'Provide a model'
                    : !providerConfigured
                    ? `Add your ${requiredProvider?.label ?? 'provider'} API key in Settings → Provider keys`
                    : undefined
                }
              >
                {isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {isStreaming ? 'Running…' : 'Run'}
              </button>
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col bg-secondary/20">
          <div className="flex items-center justify-between border-b border-border/60 bg-white px-5 py-2.5">
            <div className="flex items-center gap-2 text-[12px] text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-[#1D9E75]" />
              Output
              {isStreaming && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  streaming
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {streamMetrics.tokens !== null && <span>{streamMetrics.tokens} tokens</span>}
              {streamMetrics.latency !== null && <span>{streamMetrics.latency} ms</span>}
              {streamedOutput && !isStreaming && (
                <SaveToDatasetButton
                  projectId={projectId}
                  userInput={
                    selectedVersion
                      ? renderPreview(selectedVersion.content, variableValues)
                      : ''
                  }
                  assistantOutput={streamedOutput}
                  disabled={isStreaming}
                />
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {streamError ? (
              <div className="rounded-md border border-[#F09595] bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#791F1F]">
                <span className="inline-flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
                  {streamError}
                </span>
              </div>
            ) : streamedOutput ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-foreground">
                {streamedOutput}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                {selectedVersion
                  ? 'Press Run to stream the model output.'
                  : 'Select a prompt and version to begin.'}
              </div>
            )}
          </div>
        </section>

        {showHistory && (
          <aside className="flex w-[320px] shrink-0 flex-col border-l border-border/60 bg-white">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
              <div className="text-[12px] font-semibold text-foreground">Version history</div>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Close version history"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {isLoadingVersions ? (
                <div className="px-4 py-3 text-[12px] text-muted-foreground">Loading…</div>
              ) : versionsError ? (
                <div className="px-4 py-3 text-[12px] text-[#791F1F]">{versionsError}</div>
              ) : versions.length === 0 ? (
                <div className="px-4 py-3 text-[12px] text-muted-foreground">No versions yet.</div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {versions.map((version) => {
                    const labels = versionIdToLabels[version.id] ?? []
                    const isActive = version.id === selectedVersion?.id
                    return (
                      <li key={version.id}>
                        <button
                          type="button"
                          onClick={() => pickVersion(version.id)}
                          className={cn(
                            'flex w-full flex-col items-start gap-1 px-4 py-2.5 text-left transition-colors hover:bg-secondary/60',
                            isActive && 'bg-secondary'
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="font-mono text-[12px] font-semibold text-foreground">
                              v{version.version_number}
                            </span>
                            {labels.map((label) => (
                              <span
                                key={label}
                                className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase text-emerald-700"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          {version.change_note ? (
                            <div className="line-clamp-2 text-[11px] text-muted-foreground">
                              {version.change_note}
                            </div>
                          ) : null}
                          <div className="font-mono text-[10.5px] text-muted-foreground">
                            {version.model ?? 'no model'} · {formatDate(version.created_at)}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {showDiff && selectedVersion && (
        <section className="flex h-[320px] shrink-0 flex-col border-t border-border/60 bg-white">
          <div className="flex items-center justify-between border-b border-border/60 bg-white px-5 py-2.5">
            <div className="text-[12px] font-semibold text-foreground">
              Diff {prodVersionForDiff ? 'vs prod' : '· no prod version'}
            </div>
            <button
              type="button"
              onClick={() => setShowDiff(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Hide diff"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <DiffPane
              baseVersion={prodVersionForDiff}
              targetVersion={baseVersionForDiff ?? prodVersionForDiff!}
              baseLabel={prodVersionForDiff ? `prod v${prodVersionForDiff ? prodVersion?.version_number : '?'}` : 'base'}
              targetLabel={selectedVersion ? `v${selectedVersion.version_number}` : 'target'}
            />
          </div>
        </section>
      )}

      {!showDiff && (
        <div className="flex h-8 shrink-0 items-center justify-end border-t border-border/60 bg-white px-4">
          <button
            type="button"
            onClick={() => setShowDiff(true)}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Show diff
          </button>
        </div>
      )}

      {providerKeysLoaded && providerKeys.length === 0 && (
        <div className="border-t border-[#F09595] bg-[#FCEBEB] px-6 py-2 text-[12px] text-[#791F1F]">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            No provider keys configured for this project. Add one in Settings → Provider keys to run prompts.
          </span>
        </div>
      )}
    </div>
  )
}

interface PlaygroundSsePayload {
  type?: string
  text?: string
  tokens?: number
  latency?: number
  message?: string
}

function parsePromptList(value: unknown): PromptListResponse | null {
  if (!value || typeof value !== 'object') return null
  const prompts = (value as { prompts?: unknown }).prompts
  if (!Array.isArray(prompts)) return null
  return { prompts: prompts as DashboardPrompt[] }
}

function parsePromptDetail(value: unknown): PromptDetailResponse | null {
  if (!value || typeof value !== 'object') return null
  const prompt = (value as { prompt?: unknown }).prompt
  if (!prompt || typeof prompt !== 'object') return null
  return { prompt: prompt as PromptDetailResponse['prompt'] }
}

function parseProviderKeyList(value: unknown): ProviderKeyListResponse | null {
  if (!value || typeof value !== 'object') return null
  const providerKeys = (value as { providerKeys?: unknown }).providerKeys
  if (!Array.isArray(providerKeys)) return null
  return {
    providerKeys: providerKeys.filter(
      (entry): entry is ProviderKeyStatus =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as ProviderKeyStatus).provider === 'string' &&
        typeof (entry as ProviderKeyStatus).configured === 'boolean'
    ),
  }
}

function readApiError(value: unknown): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const candidate = (value as { error: unknown }).error
    if (typeof candidate === 'string') return candidate
  }
  return 'Unexpected server response.'
}

function readLabelEntries(
  labels: Json | undefined
): { label: string; versionId: string }[] {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return []
  const entries: { label: string; versionId: string }[] = []
  for (const [label, value] of Object.entries(labels as Record<string, unknown>)) {
    if (typeof value === 'string') {
      entries.push({ label, versionId: value })
    }
  }
  return entries
}

function readVariables(value: Json | null | undefined): PromptVariable[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: PromptVariable[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const name = record.name
    if (typeof name !== 'string' || !name || seen.has(name)) continue
    seen.add(name)
    out.push({ name, type: typeof record.type === 'string' ? record.type : undefined, required: Boolean(record.required), default: record.default as Json | null | undefined })
  }
  return out
}

function stringFromDefault(value: Json | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function renderPreview(content: string, values: Record<string, string>): string {
  let rendered = content
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value)
    rendered = rendered.replaceAll(`{${key}}}`, value)
    rendered = rendered.replaceAll(`{${key}}`, value)
  }
  return rendered
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
