'use client'

import Link from 'next/link'
import { ArrowRight, Sparkles, Activity, Database, CheckCircle2 } from 'lucide-react'

const features = [
  {
    icon: <Activity className="w-5 h-5 text-[var(--ns-green)]" />,
    title: 'Deep Tracing',
    description: 'Visualize tool calls, prompts, and model responses in nested execution graphs.',
  },
  {
    icon: <Database className="w-5 h-5 text-[var(--ns-purple)]" />,
    title: 'Session Management',
    description: 'Group traces into sessions for a complete view of user interactions.',
  },
  {
    icon: <CheckCircle2 className="w-5 h-5 text-[var(--ns-amber)]" />,
    title: 'Evaluations',
    description: 'Grade outputs and compare runs against ground truth, right in the platform.',
  },
]

export function LoginLanding({ nextPath }: { nextPath: string }) {
  const signInHref = `/login?mode=signin&next=${encodeURIComponent(nextPath)}`
  const signUpHref = `/login?mode=signup&next=${encodeURIComponent(nextPath)}`

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="fixed top-0 w-full border-b border-border/40 bg-background/80 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight hover:opacity-80 transition">
            <Sparkles className="w-5 h-5 text-[var(--ns-green)]" />
            <span>NorthStar</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link href={signInHref} className="text-muted-foreground hover:text-foreground transition">
              Sign in
            </Link>
            <Link href={signUpHref} className="ns-button ns-button-primary">
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center pt-16">
        <section className="relative w-full py-20 md:py-32 overflow-hidden">
          <div className="container mx-auto px-4 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--ns-green)]/30 bg-[var(--ns-green-pale)]/50 text-[var(--ns-green-dark)] text-sm mb-8">
              <Sparkles className="w-4 h-4" />
              <span>Observability for AI Agents</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
              Debug, evaluate, and monitor
              <br className="hidden md:block" />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[var(--ns-green-dark)] to-[var(--ns-green)]">
                your AI agents
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Powerful tracing, session management, and visual analysis built for developers shipping AI in production.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href={signUpHref} className="ns-button ns-button-primary h-12 px-8 text-sm w-full sm:w-auto rounded-xl">
                Get Started Free <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
              <Link href={signInHref} className="h-12 px-8 text-sm w-full sm:w-auto rounded-xl border border-border/60 bg-white flex items-center justify-center shadow-sm hover:bg-accent transition-colors">
                Sign in
              </Link>
            </div>
          </div>

          {/* Background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--ns-green)]/8 blur-[100px] rounded-full pointer-events-none -z-10" />
        </section>
      </main>

      {/* Features strip */}
      <section className="border-t border-border/40 bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <div key={i} className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white border shadow-sm flex items-center justify-center shrink-0">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
