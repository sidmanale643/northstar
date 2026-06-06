import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'NorthStar: trace the agent, not just the model call.'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: '#f4f0e5',
          color: '#142b25',
          fontFamily: 'monospace',
          padding: '58px 64px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: '-80px',
            top: '-90px',
            width: '430px',
            height: '430px',
            borderRadius: '50%',
            background: '#c9ff5d',
            opacity: 0.38,
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            border: '2px solid #142b25',
            padding: '42px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, gap: 14 }}>
            <div
              style={{
                display: 'flex',
                width: 38,
                height: 38,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                background: '#142b25',
                color: '#c9ff5d',
              }}
            >
              N
            </div>
            NORTHSTAR / FIELD NOTE 001
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-0.06em' }}>
              NorthStar: trace the agent,
            </div>
            <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-0.06em', color: '#168562' }}>
              not just the model call.
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20 }}>
            <span>OBSERVABILITY FOR AI AGENTS</span>
            <span>PYTHON / SUPABASE / NEXT.JS</span>
          </div>
        </div>
      </div>
    ),
    size,
  )
}
