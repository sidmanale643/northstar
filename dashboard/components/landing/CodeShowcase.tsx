import { Check, Terminal, ArrowRight } from 'lucide-react'

export function CodeShowcase() {
  return (
    <section id="how" className="py-24 md:py-32 border-y border-border/40 bg-[var(--ns-panel)]/40 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-50 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(29, 158, 117, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(29, 158, 117, 0.04) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      <div className="container mx-auto px-6">
        <div className="max-w-2xl mb-16">
          <div className="ns-label mb-3 text-[var(--ns-green-dark)]">Integration</div>
          <h2 className="text-[36px] md:text-[48px] leading-[1.05] font-semibold tracking-[-0.025em] text-foreground mb-4">
            Three lines of Python.{' '}
            <span className="text-muted-foreground/70">Full visibility.</span>
          </h2>
          <p className="text-[16px] leading-relaxed text-muted-foreground">
            Wrap any function or LLM call with <code className="text-foreground bg-white px-1.5 py-0.5 rounded border border-border/40 text-[14px] font-mono">@northstar.trace</code>.
            Sessions, tool calls, costs, and tokens flow to the dashboard automatically.
          </p>
        </div>

        <div className="grid md:grid-cols-5 gap-6 items-stretch">
          {/* Code panel — spans 3 cols */}
          <div className="md:col-span-3 rounded-2xl border border-border/60 bg-[#0d1117] overflow-hidden shadow-[0_24px_60px_-12px_rgba(13,17,23,0.4)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 h-10 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-white/40" />
                <span className="text-[12px] font-mono text-white/60">agent.py</span>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">python</span>
            </div>
            <CodeBlock />
          </div>

          {/* Steps panel — spans 2 cols */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <Step
              num="01"
              title="Install the SDK"
              code="uv add northstar-ai"
              detail="Python 3.11+. Async-first, zero blocking calls."
            />
            <Step
              num="02"
              title="Set your API key"
              code="export NORTHSTAR_API_KEY=ns_..."
              detail="Scoped per-project. Generate in 1 click."
            />
            <Step
              num="03"
              title="Decorate and ship"
              code="@northstar.trace"
              detail="Every call streams to the dashboard in real time."
            />

            <a
              href="https://mintlify.wiki/sidmanale643/northstar"
              target="_blank"
              rel="noreferrer"
              className="mt-2 group inline-flex items-center justify-between rounded-xl border border-border/60 bg-white px-4 py-3 hover:border-[var(--ns-green)]/30 transition-colors"
            >
              <div>
                <div className="text-[13px] font-medium text-foreground">Read the full quickstart</div>
                <div className="text-[11px] text-muted-foreground">Models, sessions, evals — 5 min read</div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-[var(--ns-green)] group-hover:translate-x-0.5 transition-all" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function Step({
  num,
  title,
  code,
  detail,
}: {
  num: string
  title: string
  code: string
  detail: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="text-[11px] font-mono font-semibold text-[var(--ns-green-dark)] bg-[var(--ns-green-pale)] border border-[var(--ns-green)]/20 rounded-md px-1.5 py-0.5">
          {num}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-foreground mb-1">{title}</div>
          <div className="font-mono text-[11px] text-foreground/80 bg-[var(--ns-panel)]/60 border border-border/40 rounded px-2 py-1 mb-2 truncate">
            {code}
          </div>
          <div className="text-[12px] text-muted-foreground leading-relaxed">{detail}</div>
        </div>
      </div>
    </div>
  )
}

function CodeBlock() {
  return (
    <div className="p-5 font-mono text-[13px] leading-[1.65] overflow-x-auto">
      <pre className="text-white/85">
        <Line n={1}><span className="text-[#ff7b72]">import</span> <span className="text-white">northstar</span></Line>
        <Line n={2}><span className="text-[#ff7b72]">from</span> <span className="text-white">openai</span> <span className="text-[#ff7b72]">import</span> <span className="text-white">OpenAI</span></Line>
        <Line n={3} blank />
        <Line n={4}><span className="text-white">northstar</span>.<span className="text-[#d2a8ff]">init</span>(<span className="text-[#a5d6ff]">project</span>=<span className="text-[#a5d6ff]">{'"acme-support"'}</span>)</Line>
        <Line n={5}><span className="text-white">client</span> = <span className="text-[#d2a8ff]">OpenAI</span>()</Line>
        <Line n={6} blank />
        <Line n={7}><span className="text-[#8b949e] italic"># Wrap any function — sessions, costs, traces flow automatically.</span></Line>
        <Line n={8}><span className="text-[#d2a8ff]">@northstar.trace</span>(<span className="text-[#a5d6ff]">name</span>=<span className="text-[#a5d6ff]">{'"support_agent"'}</span>)</Line>
        <Line n={9}><span className="text-[#ff7b72]">def</span> <span className="text-[#d2a8ff]">answer</span>(<span className="text-white">question</span>: <span className="text-[#7ee787]">str</span>) <span className="text-[#ff7b72]">-&gt;</span> <span className="text-[#7ee787]">str</span>:</Line>
        <Line n={10}>    <span className="text-white">prompt</span> = <span className="text-white">northstar</span>.<span className="text-[#d2a8ff]">get_prompt</span>(<span className="text-[#a5d6ff]">{'"support-v3"'}</span>)</Line>
        <Line n={11} blank />
        <Line n={12}>    <span className="text-white">response</span> = <span className="text-white">client</span>.<span className="text-white">chat</span>.<span className="text-white">completions</span>.<span className="text-[#d2a8ff]">create</span>(</Line>
        <Line n={13}>        <span className="text-[#a5d6ff]">model</span>=<span className="text-[#a5d6ff]">{'"gpt-4o"'}</span>,</Line>
        <Line n={14}>        <span className="text-[#a5d6ff]">messages</span>=[</Line>
        <Line n={15}>            {'{'}<span className="text-[#a5d6ff]">{'"role"'}</span>: <span className="text-[#a5d6ff]">{'"system"'}</span>, <span className="text-[#a5d6ff]">{'"content"'}</span>: <span className="text-white">prompt</span>{'}'},</Line>
        <Line n={16}>            {'{'}<span className="text-[#a5d6ff]">{'"role"'}</span>: <span className="text-[#a5d6ff]">{'"user"'}</span>, <span className="text-[#a5d6ff]">{'"content"'}</span>: <span className="text-white">question</span>{'}'},</Line>
        <Line n={17}>        ],</Line>
        <Line n={18}>    )</Line>
        <Line n={19}>    <span className="text-[#ff7b72]">return</span> <span className="text-white">response</span>.<span className="text-white">choices</span>[<span className="text-[#79c0ff]">0</span>].<span className="text-white">message</span>.<span className="text-white">content</span></Line>
      </pre>

      {/* Result chip */}
      <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-mono">Result</span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--ns-green)]/15 border border-[var(--ns-green)]/30 text-[11px] font-mono text-[#7ee2b8]">
          <Check className="w-3 h-3" /> trace_8f3a2b
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-white/70">
          1.24s
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-white/70">
          287 tok
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-white/70">
          $0.0021
        </span>
      </div>
    </div>
  )
}

function Line({ n, children, blank = false }: { n: number; children?: React.ReactNode; blank?: boolean }) {
  return (
    <div className="flex">
      <span className="text-white/25 select-none w-7 text-right pr-3 shrink-0">{n}</span>
      <span className="flex-1">{blank ? '\u00A0' : children}</span>
    </div>
  )
}
