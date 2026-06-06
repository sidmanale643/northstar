import { notFound } from 'next/navigation'
import { ActiveProjectBreadcrumb } from '@/components/active-project-breadcrumb'
import { PlaygroundPage } from '@/components/playground/playground-page'
import { parseProjectId } from '@/lib/projects'

export const dynamic = 'force-dynamic'

export default function PlaygroundRoute({
  params,
  searchParams,
}: {
  params: { projectId: string }
  searchParams: { promptId?: string; versionId?: string }
}) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  return (
    <div className="ns-enter flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-6 pb-4">
        <ActiveProjectBreadcrumb
          segments={[{ label: 'Playground' }]}
        />
      </div>
      <PlaygroundPage
        projectId={projectId}
        initialPromptId={searchParams.promptId}
        initialVersionId={searchParams.versionId}
      />
    </div>
  )
}
