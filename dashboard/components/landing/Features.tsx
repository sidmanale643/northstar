import { Activity, Database, CheckCircle2, MessageSquare, FileText, Layers, ArrowRight } from 'lucide-react'

export function Features() {
  return (
    <section id="features" className="py-24 md:py-32 relative">
      <div className="container mx-auto px-6">
        {/* Section header */}
        <div className="max-w-2xl mb-16">
          <div className="ns-label mb-3 text-[var(--ns-green-dark)]">Platform</div>
          <h2 className="text-[36px] md:text-[48px] leading-[1.05] font-semibold tracking-[-0.025em] text-foreground mb-4">
            Every primitive your{' '}
            <span className="text-muted-foreground/70">agent stack needs.</span>
          </h2>
          <p className="text-[16px] leading-relaxed text-muted-foreground">
            From the first trace to production evals — NorthStar covers the entire
            agent development loop. No glue code, no duct tape.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeatureCard
            icon={<Activity className="w-4 h-4" />}
            color="green"
            title="Deep Tracing"
            description="Nested DAG visualization of every tool call, LLM completion, and span. See exactly what your agent did — and why it took 2.4 seconds."
            tag="OpenTelemetry compatible"
            span={2}
            preview={<TracingPreview />}
          />
          <FeatureCard
            icon={<Layers className="w-4 h-4" />}
            color="purple"
            title="Sessions"
            description="Group related traces into user sessions for end-to-end visibility across multi-turn conversations."
            preview={<SessionsPreview />}
          />

          <FeatureCard
            icon={<Database className="w-4 h-4" />}
            color="blue"
            title="Datasets"
            description="Curate ground-truth examples from production traces. Version, slice, and reuse across runs."
            preview={<DatasetsPreview />}
          />
          <FeatureCard
            icon={<CheckCircle2 className="w-4 h-4" />}
            color="amber"
            title="Evaluations"
            description="Score outputs with built-in graders or your own. Compare runs against datasets. Catch regressions before deploy."
            preview={<EvalsPreview />}
          />
          <FeatureCard
            icon={<FileText className="w-4 h-4" />}
            color="red"
            title="Prompt Registry"
            description="Version-controlled prompts. Reference by name in code, edit in the dashboard, roll back instantly."
            preview={<PromptsPreview />}
          />

          <FeatureCard
            icon={<MessageSquare className="w-4 h-4" />}
            color="green"
            title="Playground"
            description="Iterate on prompts side-by-side across models. Diff outputs. Promote winners to your registry without leaving the browser."
            tag="GPT, Claude, Gemini, Llama, Mistral"
            span={3}
            preview={<PlaygroundPreview />}
          />
        </div>
      </div>
    </section>
  )
}

type ColorKey = 'green' | 'purple' | 'blue' | 'amber' | 'red'

const colorClasses: Record<ColorKey, { bg: string; text: string; border: string }> = {
  green: { bg: 'bg-[var(--ns-green-pale)]', text: 'text-[var(--ns-green-dark)]', border: 'border-[var(--ns-green)]/20' },
  purple: { bg: 'bg-[var(--ns-purple)]/10', text: 'text-[var(--ns-purple)]', border: 'border-[var(--ns-purple)]/20' },
  blue: { bg: 'bg-[var(--ns-blue)]/10', text: 'text-[var(--ns-blue)]', border: 'border-[var(--ns-blue)]/20' },
  amber: { bg: 'bg-[var(--ns-amber)]/10', text: 'text-[var(--ns-amber)]', border: 'border-[var(--ns-amber)]/20' },
  red: { bg: 'bg-[var(--ns-red)]/10', text: 'text-[var(--ns-red)]', border: 'border-[var(--ns-red)]/20' },
}

function FeatureCard({
  icon,
  color,
  title,
  description,
  tag,
  span = 1,
  preview,
}: {
  icon: React.ReactNode
  color: ColorKey
  title: string
  description: string
  tag?: string
  span?: 1 | 2 | 3
  preview?: React.ReactNode
}) {
  const c = colorClasses[color]
  const spanClass = span === 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : ''

  return (
    <div
      className={`group relative rounded-2xl border border-border/60 bg-white overflow-hidden hover:border-border transition-colors ${spanClass}`}
    >
      {/* Preview area */}
      {preview && (
        <div className="relative h-[200px] border-b border-border/40 bg-[var(--ns-panel)]/30 overflow-hidden">
          {preview}
        </div>
      )}

      {/* Content */}
      <div className="p-6">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-8 h-8 rounded-lg ${c.bg} ${c.text} border ${c.border} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[16px] font-semibold text-foreground tracking-tight">{title}</h3>
              {tag && (
                <span className="ns-pill !text-[10px]">{tag}</span>
              )}
            </div>
          </div>
        </div>
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

/* ============================== PREVIEWS ============================== */

function TracingPreview() {
  const rows: Array<{ label: string; depth: number; width: number; offset: number; color: string }> = [
    { label: 'agent.run', depth: 0, width: 100, offset: 0, color: 'var(--ns-green)' },
    { label: 'llm.complete', depth: 1, width: 28, offset: 0, color: 'var(--ns-purple)' },
    { label: 'tool: fetch_user', depth: 1, width: 14, offset: 28, color: 'var(--ns-blue)' },
    { label: 'http.request', depth: 2, width: 9, offset: 30, color: 'var(--ns-amber)' },
    { label: 'tool: send_email', depth: 1, width: 19, offset: 42, color: 'var(--ns-blue)' },
    { label: 'llm.complete', depth: 1, width: 33, offset: 61, color: 'var(--ns-purple)' },
    { label: 'cache.write', depth: 2, width: 6, offset: 88, color: 'var(--ns-amber)' },
  ]
  return (
    <div className="p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">trace_8f3a2b</span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <span className="text-[10px] font-mono text-muted-foreground">2.41s</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ns-green)]" />
          <span className="text-[10px] text-muted-foreground">success</span>
        </div>
      </div>
      <div className="space-y-1 flex-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2" style={{ paddingLeft: `${r.depth * 12}px` }}>
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.color }} />
            <div className="text-[10px] font-mono text-foreground/80 w-28 shrink-0 truncate">{r.label}</div>
            <div className="flex-1 h-3 bg-secondary/40 rounded-sm relative overflow-hidden">
              <div
                className="absolute h-full rounded-sm"
                style={{
                  width: `${r.width}%`,
                  left: `${r.offset}%`,
                  background: r.color,
                  opacity: 0.7,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionsPreview() {
  return (
    <div className="p-4 h-full flex flex-col gap-2 justify-center">
      {[
        { user: 'user_a4f', traces: 12, status: 'active' },
        { user: 'user_92c', traces: 5, status: 'idle' },
        { user: 'user_71b', traces: 8, status: 'idle' },
      ].map((s, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-white p-2.5 flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[var(--ns-purple)]/30 to-[var(--ns-purple)]/10 border border-[var(--ns-purple)]/20 flex items-center justify-center text-[10px] font-mono font-semibold text-[var(--ns-purple)]">
            {s.user.slice(-2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono text-foreground truncate">{s.user}</div>
            <div className="text-[10px] text-muted-foreground">{s.traces} traces</div>
          </div>
          <div className={`text-[9px] font-medium uppercase tracking-wider ${s.status === 'active' ? 'text-[var(--ns-green)]' : 'text-muted-foreground/60'}`}>
            {s.status === 'active' && <span className="inline-block w-1 h-1 rounded-full bg-[var(--ns-green)] mr-1 align-middle ns-live-dot" />}
            {s.status}
          </div>
        </div>
      ))}
    </div>
  )
}

function DatasetsPreview() {
  return (
    <div className="p-4 h-full">
      <div className="rounded-lg border border-border/60 bg-white overflow-hidden h-full">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-secondary/30">
          <span className="text-[10px] font-mono text-foreground">support_qa_v3</span>
          <span className="ns-pill">847 rows</span>
        </div>
        <div className="divide-y divide-border/30">
          {[
            { input: 'How do I cancel my plan?', tag: 'billing' },
            { input: 'Reset my password please', tag: 'auth' },
            { input: "Order #4827 hasn't shipped", tag: 'shipping' },
            { input: 'Refund request — damaged', tag: 'returns' },
          ].map((row, i) => (
            <div key={i} className="px-3 py-1.5 flex items-center gap-2">
              <div className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">{i + 1}</div>
              <div className="text-[10px] text-foreground/80 truncate flex-1">{row.input}</div>
              <div className="text-[9px] uppercase tracking-wider text-[var(--ns-blue)] bg-[var(--ns-blue)]/10 border border-[var(--ns-blue)]/20 px-1.5 py-0.5 rounded">
                {row.tag}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EvalsPreview() {
  const scores = [
    { label: 'Faithfulness', value: 0.94 },
    { label: 'Relevance', value: 0.88 },
    { label: 'Helpfulness', value: 0.91 },
    { label: 'Tone match', value: 0.62 },
  ]
  return (
    <div className="p-4 h-full flex flex-col justify-center gap-2.5">
      {scores.map((s, i) => (
        <div key={i}>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[11px] text-foreground/80">{s.label}</span>
            <span className="text-[11px] font-mono font-medium text-foreground">
              {s.value.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${s.value * 100}%`,
                background: s.value < 0.7 ? 'var(--ns-amber)' : 'var(--ns-green)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function PromptsPreview() {
  const versions = [
    { v: '2.1.0', date: '2d ago', active: true },
    { v: '2.0.4', date: '5d ago', active: false },
    { v: '2.0.3', date: '1w ago', active: false },
  ]
  return (
    <div className="p-4 h-full flex flex-col gap-2 justify-center">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-mono text-foreground">support-v3</span>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
      </div>
      {versions.map((v, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
            v.active
              ? 'border-[var(--ns-red)]/20 bg-[var(--ns-red)]/5'
              : 'border-border/40 bg-white'
          }`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              v.active ? 'bg-[var(--ns-red)]' : 'bg-muted-foreground/30'
            }`}
          />
          <span className="text-[11px] font-mono text-foreground flex-1">@{v.v}</span>
          <span className="text-[10px] text-muted-foreground">{v.date}</span>
          {v.active && (
            <span className="text-[9px] uppercase tracking-wider font-semibold text-[var(--ns-red)]">
              Live
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function PlaygroundPreview() {
  const models = [
    { name: 'gpt-4o', latency: '0.84s', tokens: 287, output: 'Sure — to cancel your subscription, head to Settings → Billing and click "Cancel plan". You\'ll keep access until your next billing date.' },
    { name: 'claude-3-5-sonnet', latency: '1.12s', tokens: 312, output: 'I can help with that. Open Settings, then Billing, and select "Cancel plan". Your access continues through the end of the current period.' },
    { name: 'gemini-2.0-flash', latency: '0.47s', tokens: 245, output: 'To cancel: Settings > Billing > Cancel plan. You keep access until the billing cycle ends. Need help finding it?' },
  ]
  return (
    <div className="p-5 h-full">
      <div className="flex items-center gap-2 mb-3">
        <span className="ns-label">Prompt</span>
        <code className="text-[11px] font-mono text-foreground bg-secondary/60 px-2 py-0.5 rounded">
          How do I cancel my plan?
        </code>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {models.map((m, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-white p-2.5 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono font-semibold text-foreground">{m.name}</span>
              <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
                <span>{m.latency}</span>
                <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/40" />
                <span>{m.tokens}t</span>
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-foreground/75 line-clamp-3">
              {m.output}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
