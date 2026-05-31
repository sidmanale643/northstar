import { ProjectWorkspaceShell } from '@/components/app-shell'

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { projectId: string }
}) {
  return <ProjectWorkspaceShell projectId={params.projectId}>{children}</ProjectWorkspaceShell>
}
