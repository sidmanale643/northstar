'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEMO_PROJECT,
  parseBackendProjectId,
  parseProjectId,
  type BackendProjectId,
  type Project,
  type ProjectId,
} from '@/lib/projects'

const STORAGE_KEY = 'northstar.projects.v2'

interface ProjectState {
  projects: Project[]
  selectedProjectId: ProjectId | null
}

interface ProjectWorkspace {
  projects: Project[]
  selectedProjectId: ProjectId | null
  isHydrated: boolean
  connectProject: (id: ProjectId, backendId: BackendProjectId) => void
  createProject: (name: string) => Project | null
  renameProject: (id: ProjectId, name: string) => void
  deleteProject: (id: ProjectId) => void
  selectProject: (id: ProjectId) => void
  findProject: (id: string) => Project | null
}

const defaultState: ProjectState = {
  projects: [DEMO_PROJECT],
  selectedProjectId: DEMO_PROJECT.id,
}

const ProjectContext = createContext<ProjectWorkspace | null>(null)
const ActiveProjectContext = createContext<Project | null>(null)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProjectState>(defaultState)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    const storedState = parseStoredState(window.localStorage.getItem(STORAGE_KEY))
    if (storedState) {
      setState(storedState)
    } else {
      persistState(defaultState)
    }
    setIsHydrated(true)
  }, [])

  const workspace = useMemo<ProjectWorkspace>(
    () => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      isHydrated,
      connectProject(id, backendId) {
        setState((current) => persistState({
          ...current,
          projects: current.projects.map((project) =>
            project.id === id ? { ...project, backendId } : project
          ),
        }))
      },
      createProject(name) {
        const trimmedName = name.trim()
        if (!trimmedName) return null

        const project: Project = {
          id: createProjectId(),
          backendId: null,
          name: trimmedName,
          createdAt: new Date().toISOString(),
        }

        setState((current) => persistState({
          projects: [...current.projects, project],
          selectedProjectId: project.id,
        }))
        return project
      },
      renameProject(id, name) {
        const trimmedName = name.trim()
        if (!trimmedName) return

        setState((current) => persistState({
          ...current,
          projects: current.projects.map((project) =>
            project.id === id ? { ...project, name: trimmedName } : project
          ),
        }))
      },
      deleteProject(id) {
        setState((current) => {
          const projects = current.projects.filter((project) => project.id !== id)
          const selectedProjectId = current.selectedProjectId === id
            ? projects[0]?.id ?? null
            : current.selectedProjectId
          return persistState({ projects, selectedProjectId })
        })
      },
      selectProject(id) {
        setState((current) => {
          if (!current.projects.some((project) => project.id === id)) return current
          if (current.selectedProjectId === id) return current
          return persistState({ ...current, selectedProjectId: id })
        })
      },
      findProject(id) {
        return state.projects.find((project) => project.id === id) ?? null
      },
    }),
    [isHydrated, state.projects, state.selectedProjectId]
  )

  return <ProjectContext.Provider value={workspace}>{children}</ProjectContext.Provider>
}

export function ActiveProjectProvider({ project, children }: { project: Project; children: React.ReactNode }) {
  return <ActiveProjectContext.Provider value={project}>{children}</ActiveProjectContext.Provider>
}

export function useProjectWorkspace() {
  const workspace = useContext(ProjectContext)
  if (!workspace) throw new Error('useProjectWorkspace must be used inside ProjectProvider')
  return workspace
}

export function useActiveProject() {
  const project = useContext(ActiveProjectContext)
  if (!project) throw new Error('useActiveProject must be used inside ActiveProjectProvider')
  return project
}

function createProjectId() {
  const id = parseProjectId(`proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`)
  if (!id) throw new Error('Generated project ID is invalid')
  return id
}

function persistState(state: ProjectState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  return state
}

function parseStoredState(value: string | null): ProjectState | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || !Array.isArray(parsed.projects)) return null
    if (parsed.selectedProjectId !== null && typeof parsed.selectedProjectId !== 'string') return null

    const projects = parsed.projects.map(parseProject)
    if (projects.some((project) => !project)) return null

    const validProjects = projects.filter((project): project is Project => project !== null)
    if (new Set(validProjects.map((project) => project.id)).size !== validProjects.length) return null

    const selectedProjectId = parsed.selectedProjectId === null
      ? null
      : parseProjectId(parsed.selectedProjectId)

    if (validProjects.length === 0) {
      return selectedProjectId === null ? { projects: [], selectedProjectId: null } : null
    }

    if (!selectedProjectId || !validProjects.some((project) => project.id === selectedProjectId)) return null
    return { projects: validProjects, selectedProjectId }
  } catch {
    return null
  }
}

function parseProject(value: unknown): Project | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' ||
    (value.backendId !== undefined && value.backendId !== null && typeof value.backendId !== 'string')
  ) {
    return null
  }

  const id = parseProjectId(value.id)
  const backendId = value.backendId == null ? null : parseBackendProjectId(value.backendId)
  if (!id || (value.backendId != null && !backendId) || !value.name.trim() || Number.isNaN(Date.parse(value.createdAt))) return null
  return { id, backendId, name: value.name, createdAt: value.createdAt }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
