'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type YamlEditorFormat = 'yaml' | 'json'

interface YamlEditorProps {
  value: unknown
  onChange: (value: unknown, error: string | null) => void
  format?: YamlEditorFormat
  minHeight?: number
  placeholder?: string
  disabled?: boolean
}

export function YamlEditor({
  value,
  onChange,
  format = 'yaml',
  minHeight = 160,
  placeholder,
  disabled = false,
}: YamlEditorProps) {
  const initialText = useMemo(() => stringify(value, format), [value, format])
  const [text, setText] = useState(initialText)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const lastEmittedRef = useRef(initialText)
  const isInternalUpdateRef = useRef(false)

  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false
      return
    }
    const next = stringify(value, format)
    if (next !== lastEmittedRef.current) {
      setText(next)
      lastEmittedRef.current = next
      setError(null)
    }
  }, [value, format])

  const handleTextChange = (next: string) => {
    setText(next)
    const parsed = parse(next, format)
    if (parsed.ok) {
      setError(null)
      lastEmittedRef.current = next
      isInternalUpdateRef.current = true
      onChange(parsed.value, null)
    } else {
      setError(parsed.error)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative">
      <textarea
        value={text}
        onChange={(event) => handleTextChange(event.target.value)}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        style={{ minHeight }}
        className={cn(
          'w-full resize-y rounded-md border bg-secondary/30 px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors',
          'focus:border-primary focus:ring-2 focus:ring-emerald-100',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-border'
        )}
      />

      <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5">
        {error ? (
          <span className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
            <AlertCircle className="h-3 w-3" />
            Invalid
          </span>
        ) : text.trim() ? (
          <span className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
            <Check className="h-3 w-3" />
            Valid
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleCopy}
          className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Copy"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>

      {error && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-red-600">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  )
}

export function YamlEditorLoading() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading…
    </div>
  )
}

function stringify(value: unknown, format: YamlEditorFormat): string {
  if (value === undefined) return ''
  if (value === null) return format === 'json' ? 'null' : 'null\n'
  try {
    if (format === 'json') return JSON.stringify(value, null, 2)
    return yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true })
  } catch {
    return ''
  }
}

function parse(
  text: string,
  format: YamlEditorFormat
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  try {
    const value = format === 'json' ? JSON.parse(text) : yaml.load(text)
    if (value === undefined) return { ok: false, error: 'Parsed value is undefined.' }
    return { ok: true, value }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse input.',
    }
  }
}
