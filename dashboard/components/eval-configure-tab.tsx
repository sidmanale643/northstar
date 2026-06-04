'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  Code2,
  FileCode2,
  Gauge,
  Loader2,
  Plus,
  Regex,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { EvalGraderDraft, EvalGraderKind, LiteLlmModelSearchResult } from '@/lib/eval-types'
import { DEFAULT_RUBRIC_JUDGE_MODEL, deterministicGraders } from '@/lib/eval-types'

interface EvalConfigureTabProps {
  graders: EvalGraderDraft[]
  setGraders: React.Dispatch<React.SetStateAction<EvalGraderDraft[]>>
  isRunning: boolean
}

const graderIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck,
  ClipboardList,
  Gauge,
  Code2,
}

const typeLabels: Record<EvalGraderKind, string> = {
  rubric: 'Rubric judge',
  python: 'Python grader',
  typescript: 'TypeScript grader',
  regex: 'Regex grader',
}

interface GraderDraftUpdate {
  name?: string
  model?: string
  rubric?: string
  scoringMode?: 'binary' | 'numeric'
  minScore?: string
  maxScore?: string
  passingScore?: string
  temperature?: string
  code?: string
  timeoutMs?: string
  pattern?: string
  target?: string
  flags?: string[]
}

export function EvalConfigureTab({
  graders,
  setGraders,
  isRunning,
}: EvalConfigureTabProps) {
  const [activeGraderId, setActiveGraderId] = useState<string | null>(graders[0]?.id ?? null)
  const activeGrader = graders.find((grader) => grader.id === activeGraderId) ?? graders[0] ?? null
  const activeRubric = activeGrader?.type === 'rubric' ? activeGrader : null

  useEffect(() => {
    if (activeGrader && activeGrader.id !== activeGraderId) {
      setActiveGraderId(activeGrader.id)
    }
    if (!activeGrader && activeGraderId !== null) {
      setActiveGraderId(null)
    }
  }, [activeGrader, activeGraderId])

  function addGrader(type: EvalGraderKind) {
    setGraders((current) => {
      const grader = createDefaultGrader(current, type)
      setActiveGraderId(grader.id)
      return [...current, grader]
    })
  }

  function removeGrader(id: string) {
    setGraders((current) => {
      const next = current.filter((grader) => grader.id !== id)
      if (activeGraderId === id) {
        setActiveGraderId(next[0]?.id ?? null)
      }
      return next
    })
  }

  function updateActiveGrader(update: GraderDraftUpdate) {
    if (!activeGrader) return
    setGraders((current) => (
      current.map((grader) => (
        grader.id === activeGrader.id ? mergeGraderDraft(grader, update) : grader
      ))
    ))
  }

  return (
    <div className="space-y-6 px-5 py-4">
      <div className="rounded-md border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-[#534AB7]" />
              Judges and graders
            </div>
            <div className="flex flex-wrap gap-1.5">
              <AddButton disabled={isRunning} onClick={() => addGrader('rubric')} icon={Sparkles}>
                Rubric
              </AddButton>
              <AddButton disabled={isRunning} onClick={() => addGrader('python')} icon={FileCode2}>
                Python
              </AddButton>
              <AddButton disabled={isRunning} onClick={() => addGrader('typescript')} icon={Code2}>
                TypeScript
              </AddButton>
              <AddButton disabled={isRunning} onClick={() => addGrader('regex')} icon={Regex}>
                Regex
              </AddButton>
            </div>
          </div>
        </div>

        <div className="p-4">
          {activeGrader ? (
            <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
              <div className="space-y-2">
                {graders.map((grader) => (
                  <button
                    key={grader.id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      activeGrader.id === grader.id
                        ? 'border-[#534AB7] bg-secondary'
                        : 'border-border bg-background hover:bg-secondary'
                    }`}
                    onClick={() => setActiveGraderId(grader.id)}
                  >
                    <div className="truncate font-mono text-[11px] font-medium text-foreground" title={grader.name}>
                      {grader.name || 'Unnamed'}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {typeLabels[grader.type]}
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-5">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="block">
                    <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      Result name
                    </span>
                    <input
                      className="ns-input h-8 w-full font-mono text-[11px]"
                      value={activeGrader.name}
                      onChange={(event) => updateActiveGrader({ name: event.currentTarget.value })}
                      disabled={isRunning}
                    />
                  </label>
                  <button
                    type="button"
                    className="mt-5 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#F09595] bg-background px-2.5 text-[11px] font-medium text-[#791F1F] transition-colors hover:bg-[#FCEBEB] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => removeGrader(activeGrader.id)}
                    disabled={isRunning}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>

                {activeGrader.type === 'rubric' && (
                  <RubricEditor
                    grader={activeGrader}
                    isRunning={isRunning}
                    updateActiveGrader={updateActiveGrader}
                  />
                )}

                {(activeGrader.type === 'python' || activeGrader.type === 'typescript') && (
                  <CodeEditor
                    language={activeGrader.type}
                    code={activeGrader.code}
                    timeoutMs={activeGrader.timeoutMs}
                    isRunning={isRunning}
                    onCodeChange={(code) => updateActiveGrader({ code })}
                    onTimeoutChange={(timeoutMs) => updateActiveGrader({ timeoutMs })}
                  />
                )}

                {activeGrader.type === 'regex' && (
                  <RegexEditor
                    grader={activeGrader}
                    isRunning={isRunning}
                    updateActiveGrader={updateActiveGrader}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-secondary px-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-background text-[#534AB7]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">No custom graders configured</div>
                <div className="mt-1 max-w-[360px] text-xs leading-relaxed text-muted-foreground">
                  Deterministic graders will still run.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-[#1D9E75]" />
            Deterministic graders
          </div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          {deterministicGraders.map((group) => {
            const Icon = graderIcons[group.icon]
            return (
              <div key={group.title} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                  <span className={`flex h-5 w-5 items-center justify-center rounded ${group.bg} ${group.color}`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  {group.title}
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RubricEditor({
  grader,
  isRunning,
  updateActiveGrader,
}: {
  grader: Extract<EvalGraderDraft, { type: 'rubric' }>
  isRunning: boolean
  updateActiveGrader: (update: GraderDraftUpdate) => void
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-3">
        <ModelCombobox
          value={grader.model}
          disabled={isRunning}
          onChange={(model) => updateActiveGrader({ model })}
        />

        <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-secondary p-1">
          <button
            type="button"
            className={`h-7 rounded text-[11px] font-medium transition-colors ${
              grader.scoringMode === 'numeric'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => updateActiveGrader({ scoringMode: 'numeric' })}
            disabled={isRunning}
          >
            0-5 score
          </button>
          <button
            type="button"
            className={`h-7 rounded text-[11px] font-medium transition-colors ${
              grader.scoringMode === 'binary'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => updateActiveGrader({ scoringMode: 'binary' })}
            disabled={isRunning}
          >
            pass/fail
          </button>
        </div>

        {grader.scoringMode === 'numeric' && (
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Min" value={grader.minScore} onChange={(value) => updateActiveGrader({ minScore: value })} disabled={isRunning} />
            <NumberField label="Max" value={grader.maxScore} onChange={(value) => updateActiveGrader({ maxScore: value })} disabled={isRunning} />
            <NumberField label="Pass" value={grader.passingScore} onChange={(value) => updateActiveGrader({ passingScore: value })} disabled={isRunning} />
          </div>
        )}

        <NumberField label="Temperature" value={grader.temperature} onChange={(value) => updateActiveGrader({ temperature: value })} disabled={isRunning} />
      </div>

      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Rubric
        </span>
        <textarea
          className="ns-input min-h-[240px] w-full resize-none text-[11px] leading-relaxed"
          value={grader.rubric}
          onChange={(event) => updateActiveGrader({ rubric: event.currentTarget.value })}
          placeholder="Grade correctness, faithfulness, and clarity."
          disabled={isRunning}
        />
      </label>
    </div>
  )
}

function CodeEditor({
  language,
  code,
  timeoutMs,
  isRunning,
  onCodeChange,
  onTimeoutChange,
}: {
  language: 'python' | 'typescript'
  code: string
  timeoutMs: string
  isRunning: boolean
  onCodeChange: (value: string) => void
  onTimeoutChange: (value: string) => void
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)]">
      <NumberField label="Timeout ms" value={timeoutMs} onChange={onTimeoutChange} disabled={isRunning} />
      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {language === 'python' ? 'Python validate function' : 'TypeScript validate function'}
        </span>
        <textarea
          className="ns-input min-h-[280px] w-full resize-y font-mono text-[11px] leading-relaxed"
          value={code}
          onChange={(event) => onCodeChange(event.currentTarget.value)}
          spellCheck={false}
          disabled={isRunning}
        />
      </label>
    </div>
  )
}

function RegexEditor({
  grader,
  isRunning,
  updateActiveGrader,
}: {
  grader: Extract<EvalGraderDraft, { type: 'regex' }>
  isRunning: boolean
  updateActiveGrader: (update: GraderDraftUpdate) => void
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Target
          </span>
          <input
            className="ns-input h-8 w-full font-mono text-[11px]"
            value={grader.target}
            onChange={(event) => updateActiveGrader({ target: event.currentTarget.value })}
            disabled={isRunning}
          />
        </label>
        <div>
          <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Flags
          </span>
          <div className="space-y-1.5">
            {['ignorecase', 'multiline', 'dotall'].map((flag) => (
              <label key={flag} className="flex items-center gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  checked={grader.flags.includes(flag)}
                  onChange={(event) => {
                    const flags = event.currentTarget.checked
                      ? [...grader.flags, flag]
                      : grader.flags.filter((item) => item !== flag)
                    updateActiveGrader({ flags })
                  }}
                  disabled={isRunning}
                />
                {flag}
              </label>
            ))}
          </div>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Pattern
        </span>
        <textarea
          className="ns-input min-h-[180px] w-full resize-y font-mono text-[11px] leading-relaxed"
          value={grader.pattern}
          onChange={(event) => updateActiveGrader({ pattern: event.currentTarget.value })}
          spellCheck={false}
          disabled={isRunning}
        />
      </label>
    </div>
  )
}

function AddButton({
  disabled,
  onClick,
  icon: Icon,
  children,
}: {
  disabled: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  )
}

function mergeGraderDraft(grader: EvalGraderDraft, update: GraderDraftUpdate): EvalGraderDraft {
  if (grader.type === 'rubric') {
    return {
      ...grader,
      name: update.name ?? grader.name,
      model: update.model ?? grader.model,
      rubric: update.rubric ?? grader.rubric,
      scoringMode: update.scoringMode ?? grader.scoringMode,
      minScore: update.minScore ?? grader.minScore,
      maxScore: update.maxScore ?? grader.maxScore,
      passingScore: update.passingScore ?? grader.passingScore,
      temperature: update.temperature ?? grader.temperature,
    }
  }

  if (grader.type === 'python' || grader.type === 'typescript') {
    return {
      ...grader,
      name: update.name ?? grader.name,
      code: update.code ?? grader.code,
      timeoutMs: update.timeoutMs ?? grader.timeoutMs,
    }
  }

  return {
    ...grader,
    name: update.name ?? grader.name,
    pattern: update.pattern ?? grader.pattern,
    target: update.target ?? grader.target,
    flags: update.flags ?? grader.flags,
  }
}

function createDefaultGrader(current: EvalGraderDraft[], type: EvalGraderKind): EvalGraderDraft {
  const prefix = type === 'rubric' ? 'rubric_judge' : `${type}_grader`
  const existingNames = new Set(current.map((grader) => grader.name.trim()))
  let nextNumber = current.length + 1
  while (existingNames.has(`${prefix}_${nextNumber}`)) {
    nextNumber += 1
  }
  const base = {
    id: crypto.randomUUID(),
    name: `${prefix}_${nextNumber}`,
  }

  if (type === 'python') {
    return {
      ...base,
      type,
      timeoutMs: '1000',
      code: 'def validate(output, case, run):\n    return bool(output and output.strip())',
    }
  }
  if (type === 'typescript') {
    return {
      ...base,
      type,
      timeoutMs: '1000',
      code: 'export function validate(output, evalCase, run) {\n  return Boolean(output && output.trim())\n}',
    }
  }
  if (type === 'regex') {
    return {
      ...base,
      type,
      pattern: '',
      target: 'final_response',
      flags: ['ignorecase'],
    }
  }

  return {
    ...base,
    type,
    model: DEFAULT_RUBRIC_JUDGE_MODEL,
    rubric: '',
    scoringMode: 'numeric',
    minScore: '0',
    maxScore: '5',
    passingScore: '4',
    temperature: '0',
  }
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      <input
        className="ns-input h-8 w-full font-mono text-[11px]"
        type="number"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={disabled}
      />
    </label>
  )
}

function ModelMetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}

interface ModelComboboxProps {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

function ModelCombobox({ value, disabled = false, onChange }: ModelComboboxProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [results, setResults] = useState<LiteLlmModelSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isFocused) setQuery('')
  }, [isFocused])

  useEffect(() => {
    if (!isFocused) return

    const controller = new AbortController()
    const searchQuery = query.trim()
    const timeout = window.setTimeout(() => {
      setIsSearching(true)
      setError(null)

      fetch(`/api/litellm-models?q=${encodeURIComponent(searchQuery)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => null)
          if (!response.ok) throw new Error(readApiError(body))

          const parsedModels = parseModelSearchResponse(body)
          if (parsedModels) {
            setResults(parsedModels)
          } else {
            throw new Error('LiteLLM returned an invalid model list.')
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setResults([])
          setError(err instanceof Error ? err.message : 'Unable to search LiteLLM models.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false)
        })
    }, 200)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [isFocused, query])

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
        setIsFocused(false)
        inputRef.current?.blur()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  const trimmedQuery = query.trim()
  const exactMatch = useMemo(
    () => results.find((model) => model.id === trimmedQuery),
    [results, trimmedQuery]
  )
  const showCustomOption = trimmedQuery.length > 0 && !exactMatch
  const totalOptions = results.length + (showCustomOption ? 1 : 0)

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1)
      return
    }
    setHighlightedIndex((current) => {
      if (totalOptions === 0) return -1
      if (current < 0 || current >= totalOptions) return 0
      return current
    })
  }, [isOpen, totalOptions])

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-option-index="${highlightedIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, isOpen])

  function commitModel(modelId: string) {
    onChange(modelId)
    setQuery('')
    setIsOpen(false)
    setIsFocused(false)
    inputRef.current?.blur()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) setIsOpen(true)
      if (totalOptions > 0) {
        setHighlightedIndex((current) => (current + 1) % totalOptions)
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) setIsOpen(true)
      if (totalOptions > 0) {
        setHighlightedIndex((current) => (current <= 0 ? totalOptions - 1 : current - 1))
      }
      return
    }
    if (event.key === 'Enter') {
      if (!isOpen) return
      event.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < results.length) {
        commitModel(results[highlightedIndex].id)
      } else if (showCustomOption && highlightedIndex === results.length) {
        commitModel(trimmedQuery)
      } else if (trimmedQuery.length > 0) {
        commitModel(trimmedQuery)
      }
      return
    }
    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault()
        setIsOpen(false)
      } else {
        setQuery('')
      }
      return
    }
  }

  const showResults = isOpen && isFocused

  return (
    <div ref={containerRef} className="relative">
      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Judge model
        </span>
        <div
          className={`flex h-9 w-full items-center gap-1.5 rounded-md border bg-background pl-8 pr-2 transition-colors ${
            isOpen ? 'border-[#534AB7]' : 'border-input'
          }`}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            className="h-full w-full bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
            value={isFocused ? query : value}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              if (!isOpen) setIsOpen(true)
            }}
            onFocus={() => {
              setIsFocused(true)
              setIsOpen(true)
              setQuery('')
            }}
            onKeyDown={handleKeyDown}
            placeholder={value ? value : 'Search models or type a custom model id'}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
          />
          {isSearching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          {isFocused && query.length > 0 && !isSearching && (
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </label>

      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="uppercase tracking-[0.06em]">Selected</span>
        <span className="truncate rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-foreground" title={value}>
          {value || 'none'}
        </span>
        {value && !disabled && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => {
              onChange(DEFAULT_RUBRIC_JUDGE_MODEL)
            }}
            title={`Reset to default (${DEFAULT_RUBRIC_JUDGE_MODEL})`}
          >
            reset to default
          </button>
        )}
      </div>

      {showResults && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 z-20 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-border bg-background shadow-md"
        >
          {error ? (
            <div className="px-3 py-2.5 text-[11px] leading-relaxed text-[#791F1F]">{error}</div>
          ) : (
            <>
              {results.length === 0 && !showCustomOption && !isSearching ? (
                <div className="px-3 py-3 text-[11px] text-muted-foreground">
                  {trimmedQuery.length === 0
                    ? 'Start typing to search the LiteLLM catalog.'
                    : 'No catalog matches. Press Enter to use this model id.'}
                </div>
              ) : (
                <div className="p-1">
                  {showCustomOption && (
                    <button
                      type="button"
                      data-option-index={results.length}
                      onMouseEnter={() => setHighlightedIndex(results.length)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commitModel(trimmedQuery)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left transition-colors ${
                        highlightedIndex === results.length ? 'bg-secondary' : 'hover:bg-secondary'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Plus className="h-3.5 w-3.5 shrink-0 text-[#534AB7]" />
                        <span className="truncate font-mono text-[11px] text-foreground" title={trimmedQuery}>
                          Use custom model
                        </span>
                        <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={trimmedQuery}>
                          {trimmedQuery}
                        </span>
                      </div>
                    </button>
                  )}
                  {results.length > 0 && (
                    <div className={showCustomOption ? 'mt-1 border-t border-border pt-1' : ''}>
                      {results.map((model, index) => {
                        const isHighlighted = highlightedIndex === index
                        const isSelected = value === model.id
                        return (
                          <button
                            key={model.id}
                            type="button"
                            data-option-index={index}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => commitModel(model.id)}
                            className={`flex w-full items-center justify-between gap-2 rounded border px-2.5 py-2 text-left transition-colors ${
                              isHighlighted
                                ? 'border-[#534AB7] bg-secondary'
                                : 'border-transparent hover:border-border hover:bg-secondary'
                            }`}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-mono text-[11px] text-foreground" title={model.id}>
                                  {model.id}
                                </span>
                                {isSelected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#534AB7]" />}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <ModelMetaPill>{model.provider}</ModelMetaPill>
                                <ModelMetaPill>{formatModelTokens(model.maxInputTokens)}</ModelMetaPill>
                                <ModelMetaPill>{formatModelCost(model.inputCostPerMillion)}</ModelMetaPill>
                                {model.supportsFunctionCalling && <ModelMetaPill>fn call</ModelMetaPill>}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              {isSearching && results.length === 0 && !error && (
                <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching the LiteLLM catalog…
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatModelTokens(tokens: number | null) {
  if (tokens === null) return 'context unknown'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`
  return `${tokens} ctx`
}

function formatModelCost(costPerMillion: number | null) {
  if (costPerMillion === null) return 'cost unknown'
  return `$${costPerMillion.toFixed(costPerMillion < 1 ? 2 : 1)}/M in`
}

function readApiError(value: unknown) {
  if (isRecord(value) && typeof value.error === 'string') {
    return value.error
  }
  return 'Unexpected server response.'
}

function parseModelSearchResponse(value: unknown): LiteLlmModelSearchResult[] | null {
  if (!isRecord(value) || !Array.isArray(value.models)) return null
  return value.models.every(isLiteLlmModelSearchResult) ? value.models : null
}

function isLiteLlmModelSearchResult(value: unknown): value is LiteLlmModelSearchResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.mode === 'string' &&
    isNullableNumber(value.maxInputTokens) &&
    isNullableNumber(value.maxOutputTokens) &&
    isNullableNumber(value.inputCostPerMillion) &&
    isNullableNumber(value.outputCostPerMillion) &&
    isNullableBoolean(value.supportsFunctionCalling) &&
    isNullableBoolean(value.supportsResponseSchema) &&
    isNullableBoolean(value.supportsSystemMessages) &&
    isNullableBoolean(value.supportsVision)
  )
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
