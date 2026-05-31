import { GlobalShell } from '@/components/global-shell'

export default function GlobalLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>
}
