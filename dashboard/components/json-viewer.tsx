'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Copy, Check } from 'lucide-react'

interface JsonViewerProps {
  data: unknown
  className?: string
}

export function JsonViewer({ data, className }: JsonViewerProps) {
  const [copied, setCopied] = useState(false)

  const jsonString = JSON.stringify(data, null, 2)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn("relative rounded-md bg-muted overflow-hidden", className)}>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-accent transition-colors"
        aria-label="Copy JSON"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="p-4 text-sm font-mono overflow-auto max-h-[400px]">
        <code>{jsonString}</code>
      </pre>
    </div>
  )
}
