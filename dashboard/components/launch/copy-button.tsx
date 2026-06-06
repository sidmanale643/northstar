'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import styles from './launch.module.css'

export function CopyButton({
  value,
  label = 'Copy',
  compact = false,
}: {
  value: string
  label?: string
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      className={compact ? styles.copyButtonCompact : styles.copyButton}
      onClick={copyValue}
      aria-label={copied ? 'Copied to clipboard' : label}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}
