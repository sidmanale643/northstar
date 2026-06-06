import Link from 'next/link'
import { Sparkles } from 'lucide-react'

export function Header() {
  return (
    <header className="fixed top-0 w-full border-b border-border/40 bg-background/80 backdrop-blur-md z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight hover:opacity-80 transition">
          <Sparkles className="w-5 h-5 text-[var(--ns-green)]" />
          <span>NorthStar</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
          <Link href="#features" className="hover:text-foreground transition">Features</Link>
          <Link href="/blog/introducing-northstar" className="hover:text-foreground transition">Blog</Link>
          <Link href="https://github.com/sidmanale643/northstar" target="_blank" className="hover:text-foreground transition">GitHub</Link>
          <Link href="/projects" className="ns-button ns-button-primary">
            Go to Dashboard
          </Link>
        </nav>
      </div>
    </header>
  )
}
