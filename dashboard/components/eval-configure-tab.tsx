'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Code2,
  FileCode2,
  Gauge,
  GitBranch,
  HeartHandshake,
  Loader2,
  Plus,
  Regex,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type {
  EvalGraderDraft,
  EvalGraderKind,
  LiteLlmModelSearchResult,
  PredefinedLlmGrader,
  PredefinedLlmGraderId,
  TraceGraderCheck,
} from '@/lib/eval-types'
import {
  DEFAULT_RUBRIC_JUDGE_MODEL,
  deterministicGraders,
  predefinedLlmGraders,
  traceGraderChecks,
} from '@/lib/eval-types'
import {
  createPresetGrader,
  nextGraderName,
} from '@/lib/eval-grader-config'

interface EvalConfigureTabProps {
  graders: EvalGraderDraft[]
  setGraders: React.Dispatch<React.SetStateAction<EvalGraderDraft[]>>
  isRunning: boolean
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
  check?: TraceGraderCheck
}

const graderTypeMeta: Record<EvalGraderKind, {
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
}> = {
  rubric: { label: 'Rubric judge', icon: Sparkles, color: 'text-[#534AB7]', bg: 'bg-[#534AB7]/10' },
  python: { label: 'Python grader', icon: FileCode2, color: 'text-[#0C447C]', bg: 'bg-[#E6F1FB]' },
  typescript: { label: 'TypeScript grader', icon: Code2, color: 'text-[#0C447C]', bg: 'bg-[#E6F1FB]' },
  regex: { label: 'Regex grader', icon: Regex, color: 'text-[#27500A]', bg: 'bg-[#EAF3DE]' },
  trace: { label: 'Trace-aware grader', icon: GitBranch, color: 'text-[#0C447C]', bg: 'bg-[#E6F1FB]' },
}

const graderTypeDescriptions: Record<EvalGraderKind, string> = {
  rubric: 'LLM judges the output against a rubric',
  python: 'Run a Python validate function',
  typescript: 'Run a TypeScript validate function',
  regex: 'Match a pattern against the output',
  trace: 'Grade trace DAG evidence',
}

const deterministicDescriptions: Record<string, string> = {
  'Tool usage': 'Validates that the agent used the right tools.',
  'Output': 'Checks the final response text.',
  'Limits': 'Enforces latency and cost budgets.',
}

const deterministicIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck,
  ClipboardList,
  Gauge,
}

const presetIconMap: Record<PredefinedLlmGraderId, React.ComponentType<{ className?: string }>> = {
  correctness: CheckCircle2,
  faithfulness: ShieldCheck,
  helpfulness: HeartHandshake,
  safety_refusal_quality: Sparkles,
}

export function EvalConfigureTab({
  graders,
  setGraders,
  isRunning,
}: EvalConfigureTabProps) {
  const [activeGraderId, setActiveGraderId] = useState<string | null>(graders[0]?.id ?? null)

  useEffect(() => {
    if (graders.length === 0) {
      if (activeGraderId !== null) setActiveGraderId(null)
      return
    }
    if (!graders.some((g) => g.id === activeGraderId)) {
      setActiveGraderId(graders[0].id)
    }
  }, [graders, activeGraderId])

  function addGrader(type: EvalGraderKind) {
    setGraders((current) => {
      const grader = createDefaultGrader(current, type)
      setActiveGraderId(grader.id)
      return [...current, grader]
    })
  }

  function addPresetGrader(preset: PredefinedLlmGrader) {
    setGraders((current) => {
      const grader = createPresetGrader({
        current,
        preset,
        id: crypto.randomUUID(),
      })
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

  function updateGrader(id: string, update: GraderDraftUpdate) {
    setGraders((current) => (
      current.map((grader) => (grader.id === id ? mergeGraderDraft(grader, update) : grader))
    ))
  }

  return (
    <div className="space-y-6 px-5 py-4">
      <div className="rounded-md border border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-[#534AB7]" />
          Judges and graders
        </div>

        <div className="space-y-3 p-4">
          {graders.length === 0 ? (
            <EmptyState onAdd={addGrader} onAddPreset={addPresetGrader} disabled={isRunning} />
          ) : (
            graders.map((grader) => (
              <GraderCard
                key={grader.id}
                grader={grader}
                isActive={grader.id === activeGraderId}
                isRunning={isRunning}
                onActivate={() => setActiveGraderId(grader.id)}
                onUpdate={(update) => updateGrader(grader.id, update)}
                onRemove={() => removeGrader(grader.id)}
              />
            ))
          )}

          {graders.length > 0 && (
            <AddGraderButton onAdd={addGrader} onAddPreset={addPresetGrader} disabled={isRunning} />
          )}
        </div>
      </div>

      <DeterministicGradersReference />
    </div>
  )
}

function GraderCard({
  grader,
  isActive,
  isRunning,
  onActivate,
  onUpdate,
  onRemove,
}: {
  grader: EvalGraderDraft
  isActive: boolean
  isRunning: boolean
  onActivate: () => void
  onUpdate: (update: GraderDraftUpdate) => void
  onRemove: () => void
}) {
  const meta = graderTypeMeta[grader.type]
  const Icon = meta.icon
  const summary = getGraderSummary(grader)

  return (
    <div
      onFocus={onActivate}
      onClick={onActivate}
      className={`relative rounded-md border bg-background transition-colors ${
        isActive
          ? 'border-l-2 border-l-[#534AB7] border-border'
          : 'border-border hover:bg-secondary/30'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.bg} ${meta.color}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={grader.name}
            onChange={(event) => onUpdate({ name: event.currentTarget.value })}
            onFocus={onActivate}
            disabled={isRunning}
            spellCheck={false}
            className="w-full bg-transparent font-mono text-[13px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="grader_name"
          />
          <div className="truncate text-[11px] text-muted-foreground">
            {meta.label}
            {summary ? <> · {summary}</> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          disabled={isRunning}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#FCEBEB] hover:text-[#791F1F] disabled:cursor-not-allowed disabled:opacity-50"
          title="Remove grader"
          aria-label="Remove grader"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="border-t border-border px-4 py-4">
        {grader.type === 'rubric' && (
          <RubricEditor
            grader={grader}
            isRunning={isRunning}
            updateActiveGrader={onUpdate}
          />
        )}
        {(grader.type === 'python' || grader.type === 'typescript') && (
          <CodeEditor
            language={grader.type}
            code={grader.code}
            timeoutMs={grader.timeoutMs}
            isRunning={isRunning}
            onCodeChange={(code) => onUpdate({ code })}
            onTimeoutChange={(timeoutMs) => onUpdate({ timeoutMs })}
          />
        )}
        {grader.type === 'regex' && (
          <RegexEditor
            grader={grader}
            isRunning={isRunning}
            updateActiveGrader={onUpdate}
          />
        )}
        {grader.type === 'trace' && (
          <TraceEditor
            grader={grader}
            isRunning={isRunning}
            updateActiveGrader={onUpdate}
          />
        )}
      </div>
    </div>
  )
}

function getGraderSummary(grader: EvalGraderDraft): string {
  if (grader.type === 'rubric') {
    const parts: string[] = []
    if (grader.model) {
      const segments = grader.model.split('/')
      parts.push(segments[segments.length - 1] || grader.model)
    }
    parts.push(
      grader.scoringMode === 'numeric'
        ? `0-5 score · pass ≥ ${grader.passingScore}`
        : 'pass/fail'
    )
    return parts.join(' · ')
  }
  if (grader.type === 'python' || grader.type === 'typescript') {
    return `${grader.timeoutMs}ms timeout`
  }
  if (grader.type === 'trace') {
    const check = traceGraderChecks.find((item) => item.id === grader.check)
    const segments = grader.model.split('/')
    const modelName = segments[segments.length - 1] || grader.model
    const model = check?.llm && grader.model ? ` · ${modelName}` : ''
    return `${check?.label ?? grader.check}${model}`
  }
  const flagLabels: string[] = []
  if (grader.flags.includes('ignorecase')) flagLabels.push('i')
  if (grader.flags.includes('multiline')) flagLabels.push('m')
  if (grader.flags.includes('dotall')) flagLabels.push('s')
  const target = grader.target || 'final_response'
  return flagLabels.length > 0 ? `${target} · /${flagLabels.join('')}/g` : target
}

function AddGraderButton({
  onAdd,
  onAddPreset,
  disabled,
}: {
  onAdd: (type: EvalGraderKind) => void
  onAddPreset: (preset: PredefinedLlmGrader) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const order: EvalGraderKind[] = ['trace', 'rubric', 'python', 'typescript', 'regex']

  return (
    <div ref={containerRef} className="relative pt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" />
        Add grader
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-80 rounded-md border border-border bg-background p-1 shadow-md">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Predefined LLM graders
          </div>
          {predefinedLlmGraders.map((preset) => {
            const Icon = presetIconMap[preset.id]
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onAddPreset(preset)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2.5 rounded px-2 py-2 text-left transition-colors hover:bg-secondary"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#534AB7]/10 text-[#534AB7]">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">{preset.label}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{preset.description}</div>
                </div>
              </button>
            )
          })}
          <div className="my-1 border-t border-border" />
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Custom graders
          </div>
          {order.map((kind) => {
            const meta = graderTypeMeta[kind]
            const Icon = meta.icon
            return (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAdd(kind)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2.5 rounded px-2 py-2 text-left transition-colors hover:bg-secondary"
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded ${meta.bg} ${meta.color}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">{meta.label}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{graderTypeDescriptions[kind]}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  onAdd,
  onAddPreset,
  disabled,
}: {
  onAdd: (type: EvalGraderKind) => void
  onAddPreset: (preset: PredefinedLlmGrader) => void
  disabled: boolean
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-secondary/30 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background text-[#534AB7]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">Choose an LLM grader</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Start from a predefined rubric or add a custom grader. Deterministic graders run either way.
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {predefinedLlmGraders.map((preset) => {
          const Icon = presetIconMap[preset.id]
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onAddPreset(preset)}
              disabled={disabled}
              className="flex items-start gap-3 rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-[#534AB7]/50 hover:bg-[#534AB7]/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#534AB7]/10 text-[#534AB7]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{preset.label}</span>
                <span className="mt-1 block text-[10.5px] leading-relaxed text-muted-foreground">
                  {preset.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-[10.5px] text-muted-foreground">Need a different check?</span>
        <AddGraderButton onAdd={onAdd} onAddPreset={onAddPreset} disabled={disabled} />
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
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
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
      </div>

      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Rubric
        </span>
        <textarea
          className="ns-input min-h-[260px] w-full resize-y text-[12px] leading-relaxed"
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
  const langBadge = language === 'python' ? 'PY' : 'TS'
  const signature = language === 'python'
    ? 'def validate(output, case, run) -> bool:'
    : 'export function validate(output, evalCase, run): boolean'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <NumberField
          label="Timeout (ms)"
          value={timeoutMs}
          onChange={onTimeoutChange}
          disabled={isRunning}
          className="w-32"
        />
        <span className="inline-flex h-6 items-center rounded bg-[#E6F1FB] px-1.5 font-mono text-[10px] font-semibold text-[#0C447C]">
          {langBadge}
        </span>
      </div>
      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {language === 'python' ? 'Python validate function' : 'TypeScript validate function'}
        </span>
        <textarea
          className="ns-input min-h-[320px] w-full resize-y font-mono text-[12px] leading-relaxed"
          value={code}
          onChange={(event) => onCodeChange(event.currentTarget.value)}
          spellCheck={false}
          disabled={isRunning}
        />
        <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">{signature}</p>
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
  const flags: { value: 'ignorecase' | 'multiline' | 'dotall'; label: string; full: string }[] = [
    { value: 'ignorecase', label: 'i', full: 'ignorecase' },
    { value: 'multiline', label: 'm', full: 'multiline' },
    { value: 'dotall', label: 's', full: 'dotall' },
  ]

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_220px]">
      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Pattern
        </span>
        <textarea
          className="ns-input min-h-[200px] w-full resize-y font-mono text-[12px] leading-relaxed"
          value={grader.pattern}
          onChange={(event) => updateActiveGrader({ pattern: event.currentTarget.value })}
          spellCheck={false}
          placeholder={'^\\s*\\d+([.]\\d+)?\\s*$'}
          disabled={isRunning}
        />
      </label>
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
            placeholder="final_response"
          />
        </label>
        <div>
          <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Flags
          </span>
          <div className="flex flex-wrap gap-1.5">
            {flags.map((flag) => {
              const active = grader.flags.includes(flag.value)
              return (
                <button
                  key={flag.value}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? grader.flags.filter((f) => f !== flag.value)
                      : [...grader.flags, flag.value]
                    updateActiveGrader({ flags: next })
                  }}
                  disabled={isRunning}
                  className={`inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md border px-2 font-mono text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]'
                      : 'border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                  title={flag.full}
                  aria-pressed={active}
                >
                  /{flag.label}/
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function TraceEditor({
  grader,
  isRunning,
  updateActiveGrader,
}: {
  grader: Extract<EvalGraderDraft, { type: 'trace' }>
  isRunning: boolean
  updateActiveGrader: (update: GraderDraftUpdate) => void
}) {
  const selected = traceGraderChecks.find((check) => check.id === grader.check) ?? traceGraderChecks[0]
  const isLlmJudge = selected.llm

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <label className="block">
        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Trace check
        </span>
        <select
          className="ns-input h-9 w-full text-[12px]"
          value={grader.check}
          disabled={isRunning}
          onChange={(event) => {
            const selectedCheck = traceGraderChecks.find((item) => item.id === event.currentTarget.value)
            if (!selectedCheck) return
            updateActiveGrader({
              check: selectedCheck.id,
              model: selectedCheck.llm ? grader.model || DEFAULT_RUBRIC_JUDGE_MODEL : '',
              temperature: selectedCheck.llm ? grader.temperature || '0' : '0',
            })
          }}
        >
          {traceGraderChecks.map((check) => (
            <option key={check.id} value={check.id}>
              {check.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {selected.description}
        </p>
      </label>

      {isLlmJudge ? (
        <div className="space-y-3">
          <ModelCombobox
            value={grader.model}
            disabled={isRunning}
            onChange={(model) => updateActiveGrader({ model })}
          />
        </div>
      ) : (
        <div className="rounded-md bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
          Deterministic trace checks use only captured span, event, retrieval, state, and cost fields.
        </div>
      )}
    </div>
  )
}

function DeterministicGradersReference() {
  return (
    <div className="rounded-md bg-secondary/40 px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-[#1D9E75]" />
        Deterministic graders
        <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
          always applied
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {deterministicGraders.map((group) => {
          const Icon = deterministicIconMap[group.icon]
          return (
            <div key={group.title} className="rounded-md border border-border bg-background p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded ${group.bg} ${group.color}`}>
                  <Icon className="h-3 w-3" />
                </span>
                <div className="text-xs font-medium text-foreground">{group.title}</div>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {group.items.length} checks
                </span>
              </div>
              <p className="mb-2 text-[10.5px] leading-relaxed text-muted-foreground">
                {deterministicDescriptions[group.title] ?? ''}
              </p>
              <div className="flex flex-wrap gap-1">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
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
  )
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  className = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
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
  const isUsingDefault = value === DEFAULT_RUBRIC_JUDGE_MODEL

  return (
    <div ref={containerRef} className="relative">
      <label className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Judge model
          </span>
          {!isUsingDefault && value && !disabled && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onChange(DEFAULT_RUBRIC_JUDGE_MODEL)}
              title={`Reset to default (${DEFAULT_RUBRIC_JUDGE_MODEL})`}
            >
              reset
            </button>
          )}
        </div>
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

function ModelMetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
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

  if (grader.type === 'trace') {
    return {
      ...grader,
      name: update.name ?? grader.name,
      check: update.check ?? grader.check,
      model: update.model ?? grader.model,
      temperature: update.temperature ?? grader.temperature,
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
  const base = {
    id: crypto.randomUUID(),
    name: nextGraderName(current, prefix, current.length + 1),
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
  if (type === 'trace') {
    return {
      ...base,
      type,
      check: 'bad_tool_failure_recovery',
      model: '',
      temperature: '0',
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
