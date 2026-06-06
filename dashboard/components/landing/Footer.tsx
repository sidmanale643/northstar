import { Sparkles } from 'lucide-react'

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-white py-12">
      <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2 font-bold tracking-tight text-muted-foreground">
          <Sparkles className="w-5 h-5 text-[var(--ns-green)]" />
          <span>NorthStar</span>
        </div>
        <p className="text-sm text-muted-foreground text-center md:text-left">
          &copy; {new Date().getFullYear()} NorthStar. Built for AI engineers.
        </p>
        <div className="flex gap-4">
          <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition">Terms</a>
          <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition">Privacy</a>
        </div>
      </div>
    </footer>
  )
}
