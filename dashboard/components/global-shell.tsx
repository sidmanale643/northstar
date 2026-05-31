import { Star } from 'lucide-react'
import Link from 'next/link'

export function GlobalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-12 items-center border-b bg-[var(--ns-panel)] px-4">
        <Link href="/projects" className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.03em] text-foreground">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-primary">
            <Star className="h-3 w-3 fill-white text-white" />
          </span>
          northstar
        </Link>
        <span className="ml-auto ns-pill">workspace</span>
      </header>
      <main className="mx-auto w-full max-w-[1240px] p-5 md:p-6">{children}</main>
    </div>
  )
}
