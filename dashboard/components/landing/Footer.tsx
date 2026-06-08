import Link from 'next/link'
import { Github } from 'lucide-react'

const productLinks = [
  { label: 'Tracing', href: '#features' },
  { label: 'Sessions', href: '#features' },
  { label: 'Evaluations', href: '#features' },
  { label: 'Datasets', href: '#features' },
  { label: 'Playground', href: '#features' },
  { label: 'Prompts', href: '#features' },
]

const resourceLinks = [
  { label: 'Documentation', href: 'https://mintlify.wiki/sidmanale643/northstar', external: true },
  { label: 'Blog', href: '/blog' },
  { label: 'GitHub', href: 'https://github.com/sidmanale643/northstar', external: true },
  { label: 'Changelog', href: '/blog' },
]

const companyLinks = [
  { label: 'About', href: '#' },
  { label: 'Privacy', href: '#' },
  { label: 'Terms', href: '#' },
  { label: 'Contact', href: '#' },
]

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-[var(--ns-panel)]/30">
      <div className="container mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-8 md:gap-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-4">
            <Link href="/" className="inline-flex items-center gap-2 mb-4">
              <div className="relative w-6 h-6 rounded-md bg-[var(--ns-green)] flex items-center justify-center shadow-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L13.5 8.5L20 10L13.5 11.5L12 22L10.5 11.5L4 10L10.5 8.5L12 2Z"
                    fill="white"
                  />
                </svg>
              </div>
              <span className="font-semibold text-[15px] tracking-tight text-foreground">
                NorthStar
              </span>
            </Link>
            <p className="text-[13px] leading-relaxed text-muted-foreground max-w-xs mb-5">
              Observability, evaluation, and prompt management — purpose-built
              for AI agents.
            </p>
            <Link
              href="https://github.com/sidmanale643/northstar"
              target="_blank"
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border/60 bg-white text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              <Github className="w-3.5 h-3.5" />
              Star on GitHub
            </Link>
          </div>

          {/* Product */}
          <div className="col-span-1 md:col-span-2 md:col-start-6">
            <div className="ns-label mb-4">Product</div>
            <ul className="space-y-2.5">
              {productLinks.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div className="col-span-1 md:col-span-2">
            <div className="ns-label mb-4">Resources</div>
            <ul className="space-y-2.5">
              {resourceLinks.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    target={l.external ? '_blank' : undefined}
                    className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div className="col-span-1 md:col-span-2">
            <div className="ns-label mb-4">Company</div>
            <ul className="space-y-2.5">
              {companyLinks.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom strip */}
        <div className="mt-12 pt-6 border-t border-border/40 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="text-[12px] text-muted-foreground">
            © {new Date().getFullYear()} NorthStar. Apache 2.0 — built for AI engineers.
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ns-green)] ns-live-dot" />
            All systems operational
          </div>
        </div>
      </div>
    </footer>
  )
}
