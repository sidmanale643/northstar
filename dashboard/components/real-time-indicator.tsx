'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function RealtimeIndicator() {
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected')
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const channel = supabase
      .channel('healthcheck')
      .subscribe((state) => {
        setStatus(state === 'SUBSCRIBED' ? 'connected' : 'disconnected')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const isConnected = status === 'connected'

  return (
    <span
      className={cn(
        'ns-pill',
        isConnected
          ? 'border-[#97c459] bg-[#eaf3de] text-[#3b6d11]'
          : 'border-red-200 bg-red-50 text-red-700'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isConnected ? 'ns-live-dot bg-[#639922]' : 'bg-red-500'
        )}
      />
      {isConnected ? 'live' : 'offline'}
    </span>
  )
}

function cn(...classes: Array<string | false>) {
  return classes.filter(Boolean).join(' ')
}
