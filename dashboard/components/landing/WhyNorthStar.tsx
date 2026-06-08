import { Lock, GitBranch, Zap, Globe } from 'lucide-react'

const points = [
  {
    icon: <Zap className="w-4 h-4" />,
    title: 'Sub-millisecond overhead',
    description:
      'Non-blocking async transport. Trace 100k+ requests per minute without touching your hot path.',
  },
  {
    icon: <GitBranch className="w-4 h-4" />,
    title: 'Open-source SDK',
    description:
      'No vendor lock-in. Self-host the dashboard or use ours — your data, your call. Apache 2.0.',
  },
  {
    icon: <Globe className="w-4 h-4" />,
    title: 'Framework agnostic',
    description:
      'LangChain, LlamaIndex, CrewAI, vanilla OpenAI — anything that runs in Python works out of the box.',
  },
  {
    icon: <Lock className="w-4 h-4" />,
    title: 'Built on Supabase',
    description:
      'Row-level security on every trace. SOC 2-ready primitives. Your prompts and outputs stay yours.',
  },
]

export function WhyNorthStar() {
  return (
    <section className="py-24 md:py-32">
      <div className="container mx-auto px-6">
        <div className="grid md:grid-cols-12 gap-10 items-start">
          {/* Left column — heading */}
          <div className="md:col-span-5 md:sticky md:top-24">
            <div className="ns-label mb-3 text-[var(--ns-green-dark)]">Why NorthStar</div>
            <h2 className="text-[36px] md:text-[48px] leading-[1.05] font-semibold tracking-[-0.025em] text-foreground mb-5">
              The opinionated stack{' '}
              <span className="text-muted-foreground/70">
                for shipping reliable agents.
              </span>
            </h2>
            <p className="text-[16px] leading-relaxed text-muted-foreground mb-6">
              Most observability tools were built for HTTP. NorthStar is designed
              from the ground up around the way agents actually run — non-linear,
              tool-heavy, and stochastic.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {['#1d9e75', '#7f77dd', '#378add', '#ef9f27'].map((c, i) => (
                  <div
                    key={i}
                    className="w-7 h-7 rounded-full border-2 border-white shadow-sm"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="text-[12px] text-muted-foreground">
                Trusted by teams shipping agents at <span className="text-foreground">Y Combinator startups</span>
              </div>
            </div>
          </div>

          {/* Right column — value props */}
          <div className="md:col-span-7 grid sm:grid-cols-2 gap-3">
            {points.map((p, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border/60 bg-white p-5 hover:border-border transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[var(--ns-green-pale)] text-[var(--ns-green-dark)] border border-[var(--ns-green)]/20 flex items-center justify-center mb-4">
                  {p.icon}
                </div>
                <div className="text-[15px] font-semibold text-foreground mb-1.5 tracking-tight">
                  {p.title}
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {p.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-16 pt-10 border-t border-border/40 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: '<1ms', label: 'SDK overhead' },
            { value: '100k+', label: 'Traces/minute' },
            { value: '7', label: 'Core primitives' },
            { value: 'OSS', label: 'Apache 2.0' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-[32px] md:text-[40px] font-semibold tracking-[-0.02em] text-foreground leading-none mb-2">
                {s.value}
              </div>
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
