import { notFound } from 'next/navigation'
import { ActiveProjectBreadcrumb } from '@/components/active-project-breadcrumb'
import { PromptDetail } from '@/components/prompts/prompt-detail'
import { getDashboardBackendProjectId, getDashboardPrompt } from '@/lib/supabase/dashboard'
import { parseProjectId } from '@/lib/projects'

export const dynamic = 'force-dynamic'

export default async function PromptDetailPage({ params }: { params: { projectId: string; promptId: string } }) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  const backendProjectId = getDashboardBackendProjectId(projectId)
  if (!backendProjectId) notFound()

  const prompt = await getDashboardPrompt(backendProjectId, params.promptId)
  if (!prompt) notFound()

  return (
    <div className="ns-enter flex-1 flex flex-col min-h-0">
      <div className="p-6 pb-4 space-y-4">
        <ActiveProjectBreadcrumb
          segments={[
            { label: 'Prompts', href: `/projects/${projectId}/prompts` },
            { label: prompt.slug },
          ]}
        />
      </div>
      <PromptDetail
        projectId={projectId}
        backendProjectId={backendProjectId}
        initialPrompt={prompt}
      />
    </div>
  )
}
