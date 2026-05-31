import { redirect } from 'next/navigation'
import { parseProjectId, projectHref } from '@/lib/projects'

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  const projectId = parseProjectId(params.projectId)
  redirect(projectId ? projectHref(projectId) : '/projects')
}
