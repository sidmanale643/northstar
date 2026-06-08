import Link from 'next/link'
import { ArrowRight, Copy, Check, Wrench, Brain, Zap } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative pt-32 pb-16 md:pt-40 md:pb-24 overflow-hidden">
      {/* Decorative grid + glow */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-[var(--ns-green)]/12 blur-[140px] rounded-full" />
        <div className="absolute top-40 left-1/4 w-[400px] h-[400px] bg-[var(--ns-purple)]/8 blur-[120px] rounded-full" />
        <div className="absolute top-20 right-1/4 w-[400px] h-[400px] bg-[var(--ns-amber)]/8 blur-[120px] rounded-full" />
      </div>

      <div className="container mx-auto px-6">
        {/* Top tag */}
        <div className="flex justify-center mb-8 ns-enter">
          <Link
            href="/blog/introducing-northstar"
            className="group inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-border/60 bg-white/80 backdrop-blur text-[12px] text-muted-foreground hover:border-[var(--ns-green)]/40 hover:text-foreground transition-all shadow-sm"
          >
            <span className="px-2 py-0.5 rounded-full bg-[var(--ns-green)] text-white text-[10px] font-semibold uppercase tracking-wider">
              New
            </span>
            <span>Introducing NorthStar 1.0 — open-source AI observability</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Headline */}
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-[44px] md:text-[68px] leading-[1.04] font-semibold tracking-[-0.03em] text-foreground mb-6 ns-enter" style={{ animationDelay: '60ms' }}>
            Observability,{' '}
            <span className="relative inline-block">
              <span className="bg-clip-text text-transparent bg-gradient-to-br from-[var(--ns-green)] to-[var(--ns-green-dark)]">
                purpose-built
              </span>
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none" preserveAspectRatio="none">
                <path d="M2 9C50 3 100 3 150 6C200 9 250 3 298 6" stroke="var(--ns-green)" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
              </svg>
            </span>
            <br />
            for AI agents.
          </h1>

          <p className="text-[17px] md:text-[19px] leading-relaxed text-muted-foreground max-w-2xl mx-auto mb-10 ns-enter" style={{ animationDelay: '120ms' }}>
            Trace every tool call, evaluate outputs against ground truth, and ship agents
            that actually work. One Python SDK. Zero infrastructure.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12 ns-enter" style={{ animationDelay: '180ms' }}>
            <Link
              href="/projects"
              className="group inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-[var(--ns-green)] text-white text-[14px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(29,158,117,0.25)] hover:bg-[var(--ns-green-dark)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.1),0_8px_24px_rgba(29,158,117,0.35)] active:scale-[0.98] transition-all w-full sm:w-auto"
            >
              Start tracing free
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <InstallCommand />
          </div>

          {/* Tiny meta */}
          <div className="flex items-center justify-center gap-6 text-[12px] text-muted-foreground ns-enter" style={{ animationDelay: '240ms' }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ns-green)] ns-live-dot" />
              No credit card required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" />
              Works with any LLM
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Async, &lt;1ms overhead
            </span>
          </div>
        </div>

        {/* Hero preview — mock trace dashboard */}
        <div className="relative mt-20 max-w-6xl mx-auto ns-enter" style={{ animationDelay: '320ms' }}>
          <div className="absolute -inset-x-12 -top-8 -bottom-8 bg-gradient-to-b from-[var(--ns-green)]/10 via-transparent to-transparent blur-3xl -z-10" />
          <DashboardPreview />
        </div>
      </div>
    </section>
  )
}

function InstallCommand() {
  return (
    <div className="group flex items-center gap-2 h-11 pl-4 pr-2 rounded-lg border border-border/60 bg-white/90 backdrop-blur text-[13px] font-mono w-full sm:w-auto shadow-sm">
      <span className="text-[var(--ns-faint)] select-none">$</span>
      <code className="text-foreground">uv add northstar-ai</code>
      <button
        aria-label="Copy install command"
        className="ml-2 h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function DashboardPreview() {
  return (
    <div className="relative rounded-2xl border border-border/60 bg-white shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_60px_-12px_rgba(24,53,45,0.18)] overflow-hidden">
      {/* Window chrome */}
      <div className="h-9 border-b border-border/40 bg-secondary/40 flex items-center px-4 gap-2">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="px-3 py-0.5 rounded-md bg-white border border-border/40 text-[11px] font-mono text-muted-foreground">
            northstar.ai / acme / traces / trace_8f3a2b
          </div>
        </div>
      </div>

      {/* Dashboard body */}
      <div className="grid grid-cols-12 min-h-[460px]">
        {/* Sidebar */}
        <div className="col-span-2 border-r border-border/40 bg-[var(--ns-panel)]/40 py-3 px-2">
          <div className="space-y-0.5">
            <SidebarItem label="Traces" active />
            <SidebarItem label="Sessions" />
            <SidebarItem label="Evals" />
            <SidebarItem label="Datasets" />
            <SidebarItem label="Playground" />
            <SidebarItem label="Prompts" />
          </div>
          <div className="mt-6 pt-3 border-t border-border/40">
            <div className="ns-label px-2 mb-2">Recent</div>
            <div className="px-2 py-1 text-[11px] font-mono text-muted-foreground truncate">trace_8f3a2b</div>
            <div className="px-2 py-1 text-[11px] font-mono text-muted-foreground/60 truncate">trace_7c1d49</div>
            <div className="px-2 py-1 text-[11px] font-mono text-muted-foreground/60 truncate">trace_5e9a82</div>
          </div>
        </div>

        {/* Main content */}
        <div className="col-span-7 border-r border-border/40 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded-md bg-[var(--ns-green-pale)] text-[var(--ns-green-dark)] text-[10px] font-mono font-semibold uppercase tracking-wider">
                  Run
                </span>
                <h3 className="text-[15px] font-semibold text-foreground">customer_support_agent</h3>
                <span className="px-1.5 py-0.5 rounded-md bg-[var(--ns-green)]/10 text-[var(--ns-green-dark)] text-[10px] font-medium border border-[var(--ns-green)]/20">
                  Success
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                Duration <span className="text-foreground">2.41s</span> · Tokens <span className="text-foreground">1,847</span> · Cost <span className="text-foreground">$0.012</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="h-7 w-7 rounded-md border border-border/60 bg-white flex items-center justify-center text-muted-foreground">
                <Wrench className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Trace timeline */}
          <div className="space-y-1.5">
            <TraceNode label="agent.run" type="agent" duration="2.41s" depth={0} color="green" />
            <TraceNode label="llm.complete" type="llm" duration="0.82s" depth={1} color="purple" />
            <TraceNode label="tool: search_orders" type="tool" duration="0.31s" depth={1} color="blue" />
            <TraceNode label="db.query" type="span" duration="0.18s" depth={2} color="amber" />
            <TraceNode label="tool: send_email" type="tool" duration="0.49s" depth={1} color="blue" />
            <TraceNode label="llm.complete" type="llm" duration="0.74s" depth={1} color="purple" />
          </div>

          {/* Latency chart */}
          <div className="mt-6 pt-4 border-t border-border/40">
            <div className="flex items-center justify-between mb-2">
              <div className="ns-label">P95 latency · last 24h</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                <span className="text-[var(--ns-green)]">▼ 12%</span>
              </div>
            </div>
            <Sparkline />
          </div>
        </div>

        {/* Right panel — eval scores */}
        <div className="col-span-3 p-4 bg-[var(--ns-panel)]/30">
          <div className="ns-label mb-3">Eval scores</div>
          <div className="space-y-3">
            <ScoreRow label="Faithfulness" value={0.94} color="green" />
            <ScoreRow label="Relevance" value={0.88} color="green" />
            <ScoreRow label="Helpfulness" value={0.91} color="green" />
            <ScoreRow label="Safety" value={1.0} color="green" />
            <ScoreRow label="Tone match" value={0.62} color="amber" />
          </div>

          <div className="mt-5 pt-4 border-t border-border/40">
            <div className="ns-label mb-2">Active prompt</div>
            <div className="rounded-md border border-border/60 bg-white p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-medium text-foreground">support-v3</span>
                <span className="text-[10px] font-mono text-muted-foreground">@2.1.0</span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed font-mono line-clamp-2">
                You are a helpful customer support agent for...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={`px-2 py-1.5 rounded-md text-[12px] font-medium ${
        active
          ? 'bg-white text-foreground shadow-sm border border-border/40'
          : 'text-muted-foreground'
      }`}
    >
      {label}
    </div>
  )
}

function TraceNode({
  label,
  type,
  duration,
  depth,
  color,
}: {
  label: string
  type: string
  duration: string
  depth: number
  color: 'green' | 'purple' | 'blue' | 'amber'
}) {
  const colorMap = {
    green: 'bg-[var(--ns-green)]',
    purple: 'bg-[var(--ns-purple)]',
    blue: 'bg-[var(--ns-blue)]',
    amber: 'bg-[var(--ns-amber)]',
  }
  const widths = ['100%', '34%', '13%', '7%', '20%', '31%']
  const width = widths[Math.min(depth * 2 + (label.length % 3), widths.length - 1)]

  return (
    <div className="flex items-center gap-2 group" style={{ paddingLeft: `${depth * 16}px` }}>
      <div className={`w-1.5 h-1.5 rounded-full ${colorMap[color]} shrink-0`} />
      <div className="text-[11px] font-mono text-foreground w-40 shrink-0 truncate">{label}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 w-10 shrink-0">{type}</div>
      <div className="flex-1 h-4 bg-secondary/40 rounded-sm overflow-hidden relative">
        <div
          className={`h-full ${colorMap[color]} opacity-70 rounded-sm`}
          style={{ width, marginLeft: `${depth * 5}%` }}
        />
      </div>
      <div className="text-[10px] font-mono text-muted-foreground w-12 text-right shrink-0">{duration}</div>
    </div>
  )
}

function ScoreRow({ label, value, color }: { label: string; value: number; color: 'green' | 'amber' }) {
  const colorMap = {
    green: 'bg-[var(--ns-green)]',
    amber: 'bg-[var(--ns-amber)]',
  }
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-foreground">{label}</span>
        <span className="text-[11px] font-mono font-medium text-foreground">{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorMap[color]}`} style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  )
}

function Sparkline() {
  const points = [40, 35, 42, 38, 30, 33, 28, 32, 26, 24, 28, 22, 20, 24, 18]
  const max = Math.max(...points)
  const width = 100
  const height = 32
  const stepX = width / (points.length - 1)
  const path = points
    .map((p, i) => {
      const x = i * stepX
      const y = height - (p / max) * height
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const fill = `${path} L${width},${height} L0,${height} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ns-green)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--ns-green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#sparkfill)" />
      <path d={path} fill="none" stroke="var(--ns-green)" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
