import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

export function Header() {
  return (
    <header className="fixed top-0 w-full z-50">
      <div className="border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="relative w-6 h-6 rounded-md bg-[var(--ns-green)] flex items-center justify-center shadow-sm">
              <div className="absolute inset-0 rounded-md bg-gradient-to-br from-white/20 to-transparent" />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="relative">
                <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 22L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="white" />
              </svg>
            </div>
            <span className="font-semibold text-[15px] tracking-tight text-foreground">NorthStar</span>
            <span className="ml-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border/60 rounded px-1.5 py-0.5 bg-secondary/50">
              v1.0
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 text-[13px] font-medium text-muted-foreground">
            <Link href="#features" className="px-3 py-1.5 rounded-md hover:text-foreground hover:bg-secondary/60 transition-colors">
              Features
            </Link>
            <Link href="#how" className="px-3 py-1.5 rounded-md hover:text-foreground hover:bg-secondary/60 transition-colors">
              How it works
            </Link>
            <Link href="/blog/introducing-northstar" className="px-3 py-1.5 rounded-md hover:text-foreground hover:bg-secondary/60 transition-colors">
              Blog
            </Link>
            <Link
              href="https://mintlify.wiki/sidmanale643/northstar"
              target="_blank"
              className="px-3 py-1.5 rounded-md hover:text-foreground hover:bg-secondary/60 transition-colors inline-flex items-center gap-1"
            >
              Docs
              <ArrowUpRight className="w-3 h-3 opacity-50" />
            </Link>
            <Link
              href="https://github.com/sidmanale643/northstar"
              target="_blank"
              className="px-3 py-1.5 rounded-md hover:text-foreground hover:bg-secondary/60 transition-colors inline-flex items-center gap-1"
            >
              GitHub
              <ArrowUpRight className="w-3 h-3 opacity-50" />
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex h-8 items-center px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/projects"
              className="ns-button ns-button-primary h-8 px-3.5 text-[13px]"
            >
              Get started
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
