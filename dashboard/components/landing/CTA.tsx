import Link from 'next/link'
import { ArrowRight, Github } from 'lucide-react'

export function CTA() {
  return (
    <section className="py-24 md:py-32">
      <div className="container mx-auto px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-[#0f6e56] via-[#0a4f3e] to-[#072a23] p-10 md:p-16">
          {/* Decorative grid */}
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          {/* Glow */}
          <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-[var(--ns-green)]/30 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute -bottom-40 -left-32 w-[400px] h-[400px] bg-[var(--ns-purple)]/20 blur-[120px] rounded-full pointer-events-none" />

          {/* Star pattern */}
          <svg
            className="absolute top-8 right-8 opacity-10"
            width="120"
            height="120"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M12 2L13.5 8.5L20 10L13.5 11.5L12 22L10.5 11.5L4 10L10.5 8.5L12 2Z"
              fill="white"
            />
          </svg>

          <div className="relative max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/15 bg-white/5 backdrop-blur text-[11px] text-white/70 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ns-green)] ns-live-dot" />
              Free during beta
            </div>

            <h2 className="text-[36px] md:text-[56px] leading-[1.05] font-semibold tracking-[-0.025em] text-white mb-5">
              Ship agents you{' '}
              <span className="italic font-normal text-white/70">actually trust.</span>
            </h2>

            <p className="text-[16px] md:text-[18px] leading-relaxed text-white/70 mb-8 max-w-xl">
              Stop guessing what your agent did. Start every prompt iteration
              with data, not vibes. Get your first trace flowing in under five minutes.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Link
                href="/projects"
                className="group inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg bg-white text-[#0f6e56] text-[14px] font-medium hover:bg-white/90 active:scale-[0.98] transition-all shadow-sm"
              >
                Start tracing — it&apos;s free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="https://github.com/sidmanale643/northstar"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg border border-white/20 bg-white/5 backdrop-blur text-white text-[14px] font-medium hover:bg-white/10 transition-colors"
              >
                <Github className="w-4 h-4" />
                Star on GitHub
              </Link>
            </div>

            <div className="mt-8 flex items-center gap-5 text-[12px] text-white/50">
              <span>No credit card required</span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span>5-minute setup</span>
              <span className="w-1 h-1 rounded-full bg-white/30 hidden sm:block" />
              <span className="hidden sm:inline">Cancel anytime</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
