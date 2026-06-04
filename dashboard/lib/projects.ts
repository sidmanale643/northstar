export type ProjectId = string & { readonly __brand: 'ProjectId' }
export type BackendProjectId = string & { readonly __brand: 'BackendProjectId' }

export const DEV_BACKEND_PROJECTS_COOKIE = 'northstar.dev-backend-projects'

export interface Project {
  id: ProjectId
  backendId: BackendProjectId | null
  name: string
  createdAt: string
}

const demoProjectId = parseProjectId('proj_a3f9c1d8e27b')

if (!demoProjectId) {
  throw new Error('Demo project ID is invalid')
}

export const DEMO_PROJECT_ID = demoProjectId

export const DEMO_PROJECT: Project = {
  id: DEMO_PROJECT_ID,
  backendId: null,
  name: 'research-agent',
  createdAt: '2025-03-12T00:00:00.000Z',
}

export function parseProjectId(value: string): ProjectId | null {
  return /^proj_[a-z0-9]{6,32}$/i.test(value) ? (value as ProjectId) : null
}

export function parseBackendProjectId(value: string): BackendProjectId | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? (value as BackendProjectId)
    : null
}

export function projectHref(projectId: ProjectId, section: 'traces' | 'sessions' | 'settings' | 'evals' | 'datasets' = 'traces') {
  return `/projects/${projectId}/${section}`
}

export function sessionHref(projectId: ProjectId, sessionId: string) {
  return `${projectHref(projectId, 'sessions')}/${sessionId}`
}

export function traceHref(projectId: ProjectId, traceId: string) {
  return `${projectHref(projectId, 'traces')}/${traceId}`
}

export function projectSwitchHref(pathname: string, projectId: ProjectId) {
  const match = pathname.match(/^\/projects\/[^/]+\/(traces|sessions|settings|evals|datasets)(\/.*)?$/)
  const section = match?.[1]
  const isDetailPage = Boolean(match?.[2])

  if (isDetailPage || !section) return projectHref(projectId)
  if (section === 'sessions' || section === 'settings' || section === 'evals' || section === 'datasets') {
    return projectHref(projectId, section)
  }
  return projectHref(projectId)
}
