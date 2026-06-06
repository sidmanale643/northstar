import Link from 'next/link'
import { ArrowRight, Code2, Sparkles } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
      <div className="container mx-auto px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--ns-green)]/30 bg-[var(--ns-green-pale)]/50 text-[var(--ns-green-dark)] text-sm mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Sparkles className="w-4 h-4" />
          <span>Introducing NorthStar v1.0</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted-foreground animate-in fade-in slide-in-from-bottom-8 duration-1000">
          Observability for <br className="hidden md:block" /> AI Agents
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150 fill-mode-both">
          Debug, evaluate, and monitor your AI agents in production. Powerful tracing, session management, and visual analysis built for developers.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300 fill-mode-both">
          <Link href="/projects" className="ns-button ns-button-primary h-12 px-8 text-sm w-full sm:w-auto rounded-xl">
            Get Started <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
          <div className="flex items-center gap-3 px-4 h-12 border border-border/60 bg-white rounded-xl w-full sm:w-auto shadow-sm">
            <Code2 className="w-4 h-4 text-muted-foreground" />
            <code className="text-sm font-mono text-foreground">uv add northstar-ai</code>
          </div>
        </div>
      </div>
      
      {/* Background glow effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[var(--ns-green)]/10 blur-[120px] rounded-full pointer-events-none -z-10" />
    </section>
  )
}
