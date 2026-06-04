'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Check,
  Clock3,
  Copy,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  FileCode,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Server,
  ShieldAlert,
  Star,
  Trash2,
  Users,
  Webhook,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DeleteProjectDialog } from '@/components/delete-project-dialog'
import { useActiveProject, useProjectWorkspace } from '@/components/project-provider'
import { cn } from '@/lib/utils'
import { parseBackendProjectId, type BackendProjectId, type Project } from '@/lib/projects'
import {
  PROVIDER_KEY_INFOS,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from '@/lib/provider-key-config'

const _SUPABASE_PROJECT_REF_RE = /^https?:\/\/([a-z0-9]+)\.supabase\.co\/?$/i

function extractSupabaseProjectRef(supabaseUrl: string): string | null {
  const match = _SUPABASE_PROJECT_REF_RE.exec(supabaseUrl.trim())
  return match?.[1] ?? null
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseProjectRef = supabaseUrl ? extractSupabaseProjectRef(supabaseUrl) : null
const sdkProjectIdSetting = supabaseProjectRef
  ? `NORTHSTAR_PROJECT_ID=${supabaseProjectRef}`
  : null

const tabs = [
  { id: 'api', label: 'API key', icon: KeyRound },
  { id: 'providers', label: 'Provider keys', icon: Server },
  { id: 'ingestion', label: 'Ingestion', icon: Database },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle },
] as const

type SettingsTab = (typeof tabs)[number]['id']

export function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<SettingsTab>('api')
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const project = useActiveProject()
  const { deleteProject } = useProjectWorkspace()

  function confirmDelete(projectToRemove: Project) {
    deleteProject(projectToRemove.id)
    setProjectToDelete(null)
    router.replace('/projects')
  }

  return (
    <>
      <div className="ns-enter -m-5 grid min-h-[calc(100vh-48px)] grid-cols-[160px_1fr] md:-m-6">
        <nav className="border-r bg-white/60 py-4">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex h-8 w-full items-center gap-2 border-r-2 border-transparent px-3.5 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground',
                activeTab === id && 'border-r-primary bg-[var(--ns-green-pale)] font-medium text-[var(--ns-green-dark)]'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>

        <div className="max-w-4xl p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <div className="ns-label">Project configuration</div>
              <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Settings</h1>
            </div>
            <span className="ns-pill">{project.name}</span>
          </div>

          {activeTab === 'api' && <ApiSettings />}
          {activeTab === 'providers' && <ProviderKeysSettings />}
          {activeTab === 'ingestion' && <IngestionSettings />}
          {activeTab === 'alerts' && <AlertSettings />}
          {activeTab === 'team' && <TeamSettings />}
          {activeTab === 'billing' && <BillingSettings />}
          {activeTab === 'danger' && <DangerSettings onDelete={() => setProjectToDelete(project)} onManageApiKey={() => setActiveTab('api')} />}
        </div>
      </div>
      <DeleteProjectDialog project={projectToDelete} onCancel={() => setProjectToDelete(null)} onConfirm={confirmDelete} />
    </>
  )
}

function ApiSettings() {
  const project = useActiveProject()
  const { connectProject, renameProject } = useProjectWorkspace()
  const [name, setName] = useState(project.name)
  const [isEditingName, setIsEditingName] = useState(false)
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(() => readCreatedApiKey(project.id))
  const [isApiKeyCopied, setIsApiKeyCopied] = useState(false)
  const [isSdkProjectIdCopied, setIsSdkProjectIdCopied] = useState(false)
  const [isWorkspaceIdCopied, setIsWorkspaceIdCopied] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(project.name)
    setIsEditingName(false)
    setCreatedApiKey(readCreatedApiKey(project.id))
    setIsApiKeyCopied(false)
    setIsSdkProjectIdCopied(false)
    setIsWorkspaceIdCopied(false)
    setError(null)
  }, [project.id, project.name])

  useEffect(() => {
    persistCreatedApiKey(project.id, createdApiKey)
  }, [createdApiKey, project.id])

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return
    renameProject(project.id, name)
    setIsEditingName(false)
  }

  function handleCancelRename() {
    setName(project.name)
    setIsEditingName(false)
  }

  async function handleGenerateApiKey() {
    setIsGenerating(true)
    setError(null)

    try {
      const response = await fetch('/api/projects/api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName: project.name,
          backendProjectId: project.backendId,
        }),
      })
      const body: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(readError(body))
      }

      const apiKey = parseCreatedApiKey(body)
      if (!apiKey) {
        throw new Error('The server returned an invalid API key response.')
      }

      connectProject(project.id, apiKey.projectId)
      setCreatedApiKey(apiKey)
      setIsApiKeyCopied(false)
    } catch (apiKeyError) {
      setError(apiKeyError instanceof Error ? apiKeyError.message : 'Unable to create API key.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleCopyApiKey(input: HTMLInputElement | null) {
    if (!createdApiKey) return

    if (await copyText(createdApiKey.value, input)) {
      setIsApiKeyCopied(true)
      setError(null)
    } else {
      setError('Clipboard access is blocked. Press Ctrl+C, or Cmd+C on macOS, to copy the selected API key.')
    }
  }

  async function handleCopySdkProjectId(input: HTMLInputElement | null) {
    if (!sdkProjectIdSetting) return

    if (await copyText(sdkProjectIdSetting, input)) {
      setIsSdkProjectIdCopied(true)
      setError(null)
    } else {
      setError('Clipboard access is blocked. Press Ctrl+C, or Cmd+C on macOS, to copy the selected SDK project ID.')
    }
  }

  async function handleCopyWorkspaceId() {
    if (await copyText(project.id, null)) {
      setIsWorkspaceIdCopied(true)
      setError(null)
    } else {
      setError('Clipboard access is blocked. Press Ctrl+C, or Cmd+C on macOS, to copy the workspace ID.')
    }
  }

  const hasExistingKey = Boolean(project.backendId) && !createdApiKey

  return (
    <>
      <SettingsSection title="API key" icon={KeyRound}>
        {createdApiKey ? (
          <KeyCard
            name="Project key"
            value={createdApiKey.value}
            meta={[`Created ${formatTimestamp(createdApiKey.createdAt)}`]}
            isCopied={isApiKeyCopied}
            onCopy={handleCopyApiKey}
            ariaLabel="Project API key"
          />
        ) : (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-white px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {hasExistingKey
                ? 'An API key exists. Rotate it to reveal a new value.'
                : 'No API key yet — create one to start sending traces.'}
            </span>
            <button
              className="ns-button ns-button-primary"
              type="button"
              disabled={isGenerating}
              onClick={handleGenerateApiKey}
            >
              {hasExistingKey ? <RefreshCw /> : <Plus />}
              {isGenerating ? 'Generating...' : hasExistingKey ? 'Rotate key' : 'Create API key'}
            </button>
          </div>
        )}
        {createdApiKey && (
          <p className="ns-settings-help">
            Configure your SDK with <Code>NORTHSTAR_API_KEY</Code> and{' '}
            <Code>NORTHSTAR_PROJECT_ID</Code>. The Workspace ID below is for
            administrative operations only and should not be passed to the SDK.
          </p>
        )}
        {error && <p className="ns-settings-help text-red-700">{error}</p>}
      </SettingsSection>

      {sdkProjectIdSetting && (
        <SettingsSection title="SDK project ID" icon={Database}>
          <div className="ns-panel px-3.5 py-2.5">
            <div className="mb-1.5 flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="ns-button px-2"
                onClick={() => handleCopySdkProjectId(null)}
                aria-label="Copy SDK project ID as .env line"
              >
                <FileCode />
                Add to .env
              </button>
              <button
                type="button"
                className="ns-button px-2"
                onClick={() => handleCopySdkProjectId(null)}
                aria-label="Copy SDK project ID"
              >
                {isSdkProjectIdCopied ? <Check /> : <Copy />}
                {isSdkProjectIdCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{sdkProjectIdSetting}</p>
          </div>
          <p className="ns-settings-help">
            Pass this as <Code>NORTHSTAR_PROJECT_ID</Code> in your SDK config. The
            workspace ID below is for admin use only — do not pass it to the SDK.
          </p>
        </SettingsSection>
      )}

      <SettingsSection title="Project" icon={Server}>
        <Field label="Project name" htmlFor="project-name">
          {isEditingName ? (
            <form className="flex max-w-sm gap-2" onSubmit={handleRename}>
              <input
                id="project-name"
                className="ns-input"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    handleCancelRename()
                  }
                }}
              />
              <button className="ns-button ns-button-primary" type="submit" disabled={!name.trim()}><Check />Save</button>
              <button className="ns-button" type="button" onClick={handleCancelRename}><X />Cancel</button>
            </form>
          ) : (
            <div className="flex max-w-sm items-center gap-2">
              <span className="flex-1 truncate rounded-md border bg-secondary px-2.5 py-1.5 text-xs text-foreground">
                {project.name}
              </span>
              <button
                className="ns-button px-2"
                type="button"
                onClick={() => setIsEditingName(true)}
                aria-label={`Edit project name`}
              >
                <Pencil />Edit
              </button>
            </div>
          )}
        </Field>
        <div className="ns-settings-field">
          <div className="ns-settings-field-label">
            <span>Workspace ID</span>
            <span className="rounded-full border bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">read-only</span>
          </div>
          <div className="flex max-w-sm items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-secondary px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
              {project.id}
            </code>
            <button
              type="button"
              className="ns-button px-2"
              onClick={handleCopyWorkspaceId}
              aria-label="Copy workspace ID"
            >
              {isWorkspaceIdCopied ? <Check /> : <Copy />}
            </button>
          </div>
          <p className="ns-settings-help">
            Identifies this project in dashboard and admin operations. Use the
            SDK project ID above for traces.
          </p>
        </div>
      </SettingsSection>
    </>
  )
}

function IngestionSettings() {
  return (
    <>
      <SettingsSection title="Ingestion" icon={Database}>
        <ToggleRow label="Capture tool call params" description="Store full input params for every tool call." checked />
        <ToggleRow label="Capture tool call output" description="Store the full output payload. May contain sensitive data." checked />
        <ToggleRow label="Capture LLM prompts" description="Log full prompts sent to the model. Disable for PII-sensitive workloads." />
        <ToggleRow label="Auto-flush on session end" description="Send buffered traces immediately when a session closes." checked />
      </SettingsSection>
      <SettingsSection title="Retention" icon={Clock3}>
        <Field label="Trace retention period" help="Traces older than this are purged automatically.">
          <select className="ns-input max-w-[150px]" defaultValue="30 days">
            <option>7 days</option>
            <option>30 days</option>
            <option>90 days</option>
            <option>1 year</option>
          </select>
        </Field>
        <Field label="Max traces per session">
          <div className="flex items-center gap-2">
            <input className="ns-input max-w-[100px]" defaultValue="500" type="number" />
            <span className="text-xs text-muted-foreground">traces / session</span>
          </div>
        </Field>
      </SettingsSection>
    </>
  )
}

function ProviderKeysSettings() {
  const project = useActiveProject()
  const [providerKeys, setProviderKeys] = useState<ProviderKeyStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [savingProvider, setSavingProvider] = useState<ProviderKeyProvider | null>(null)
  const [deletingProvider, setDeletingProvider] = useState<ProviderKeyProvider | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project.backendId) {
      setProviderKeys([])
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/projects/${project.id}/provider-keys`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(readError(body))
        const parsed = parseProviderKeyList(body)
        if (!parsed) throw new Error('The server returned invalid provider key data.')
        setProviderKeys(parsed)
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : 'Unable to load provider keys.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [project.backendId, project.id])

  async function handleSave(
    event: FormEvent<HTMLFormElement>,
    provider: ProviderKeyProvider
  ) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const apiKey = formData.get('apiKey')
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      setError('Enter a provider API key before saving.')
      return
    }

    setSavingProvider(provider)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch(`/api/projects/${project.id}/provider-keys/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readError(body))

      const providerKey = parseProviderKeyResponse(body)
      if (!providerKey) throw new Error('The server returned invalid provider key data.')

      setProviderKeys((current) => upsertProviderKeyStatus(current, providerKey))
      form.reset()
      setMessage(`${providerLabel(provider)} key saved.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save provider key.')
    } finally {
      setSavingProvider(null)
    }
  }

  async function handleDelete(provider: ProviderKeyProvider) {
    setDeletingProvider(provider)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch(`/api/projects/${project.id}/provider-keys/${provider}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        throw new Error(readError(body))
      }

      setProviderKeys((current) => removeProviderKeyStatus(current, provider))
      setMessage(`${providerLabel(provider)} key deleted.`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete provider key.')
    } finally {
      setDeletingProvider(null)
    }
  }

  if (!project.backendId) {
    return (
      <SettingsSection title="Provider keys" icon={Server}>
        <div className="ns-panel p-3.5 text-xs text-muted-foreground">
          Create a NorthStar project API key first. Provider keys are stored
          against the connected backend project and used by dashboard evals.
        </div>
      </SettingsSection>
    )
  }

  const statuses = providerStatuses(providerKeys)

  return (
    <SettingsSection title="Provider keys" icon={Server}>
      <p className="ns-settings-help mb-3">
        These keys are encrypted server-side and used only when dashboard rubric
        judges call third-party LLM providers.
      </p>
      {loading && (
        <div className="ns-panel mb-2 px-3 py-2 text-xs text-muted-foreground">
          Loading provider keys...
        </div>
      )}
      {error && <p className="ns-settings-help mb-2 text-red-700">{error}</p>}
      {message && <p className="ns-settings-help mb-2 text-[var(--ns-green-dark)]">{message}</p>}
      <div className="space-y-2">
        {PROVIDER_KEY_INFOS.map((info) => {
          const status = statuses.get(info.provider)
          const isSaving = savingProvider === info.provider
          const isDeleting = deletingProvider === info.provider
          return (
            <form
              key={info.provider}
              className="ns-panel grid grid-cols-[160px_1fr_auto] items-center gap-3 px-3 py-2.5"
              onSubmit={(event) => handleSave(event, info.provider)}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium">{info.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {info.envVar}
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5',
                      status?.configured
                        ? 'border-emerald-200 bg-[var(--ns-green-pale)] text-[var(--ns-green-dark)]'
                        : 'bg-secondary'
                    )}
                  >
                    {status?.configured ? 'configured' : 'not set'}
                  </span>
                  {status?.keyHint && <span className="font-mono">{status.keyHint}</span>}
                  {status?.updatedAt && <span>Updated {formatTimestamp(status.updatedAt)}</span>}
                </div>
                <input
                  className="ns-input"
                  name="apiKey"
                  type="password"
                  placeholder={status?.configured ? 'Paste a replacement key' : 'Paste provider API key'}
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button className="ns-button ns-button-primary" type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : status?.configured ? 'Replace' : 'Save'}
                </button>
                <button
                  className="ns-button"
                  type="button"
                  disabled={!status?.configured || isDeleting}
                  onClick={() => handleDelete(info.provider)}
                >
                  <Trash2 />
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </form>
          )
        })}
      </div>
    </SettingsSection>
  )
}

function AlertSettings() {
  return (
    <>
      <SettingsSection title="Alert rules" icon={Bell}>
        <ToggleRow label="Error rate spike" description="Alert when trace error rate exceeds 10% in a 5-minute window." checked />
        <ToggleRow label="Latency threshold" description="Alert when p95 trace duration exceeds 5 seconds." checked />
        <ToggleRow label="Token budget warning" description="Alert when session token usage exceeds 80% of plan quota." />
      </SettingsSection>
      <SettingsSection title="Webhooks" icon={Webhook}>
        <WebhookRow status="active" url="https://hooks.slack.com/services/T04X.../B07.../xK9..." />
        <WebhookRow status="paused" url="https://api.pagerduty.com/v2/enqueue" />
        <div className="mt-2.5 flex gap-2">
          <input className="ns-input" placeholder="https://..." />
          <DisabledButton primary><Plus />Add</DisabledButton>
        </div>
        <p className="ns-settings-help">NorthStar will POST a JSON payload to these URLs when an alert triggers.</p>
      </SettingsSection>
    </>
  )
}

function TeamSettings() {
  return (
    <SettingsSection title="Team members" icon={Users}>
      <MemberCard initials="AK" name="Arjun Kumar" email="arjun@startup.io" role="Owner" tag="you" />
      <MemberCard initials="PM" name="Priya Mehta" email="priya@startup.io" role="Member" lavender />
      <div className="mt-2.5 flex gap-2">
        <input className="ns-input" placeholder="teammate@company.com" type="email" />
        <DisabledButton primary><Mail />Invite</DisabledButton>
      </div>
    </SettingsSection>
  )
}

function BillingSettings() {
  return (
    <>
      <SettingsSection title="Plan" icon={CreditCard}>
        <div className="ns-panel flex items-start justify-between gap-4 p-3.5">
          <div className="w-full max-w-xl">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-[var(--ns-green-pale)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ns-green-dark)]">
              <Star className="h-3 w-3" />Pro
            </span>
            <div className="mt-2 text-sm font-medium">Pro plan · $49 / month</div>
            <div className="mt-1 text-xs text-muted-foreground">10M traces/mo · 90-day retention · Webhooks · Team access</div>
            <Usage label="Traces this month" value="6.2M / 10M" percent="62%" warning />
            <Usage label="Storage used" value="3.1 GB / 20 GB" percent="15%" />
          </div>
          <DisabledButton primary>Upgrade</DisabledButton>
        </div>
      </SettingsSection>
      <SettingsSection title="Billing details" icon={Receipt}>
        <Field label="Billing email">
          <div className="flex max-w-sm gap-2">
            <input className="ns-input" defaultValue="billing@startup.io" type="email" />
            <DisabledButton primary>Save</DisabledButton>
          </div>
        </Field>
        <Field label="Payment method">
          <div className="ns-panel flex max-w-sm items-center gap-3 p-3">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs font-medium">Visa ending in 4242</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">Expires 08 / 2027</div>
            </div>
            <DisabledButton className="ml-auto">Update</DisabledButton>
          </div>
        </Field>
      </SettingsSection>
    </>
  )
}

function DangerSettings({ onDelete, onManageApiKey }: { onDelete: () => void; onManageApiKey: () => void }) {
  return (
    <SettingsSection title="Danger zone" icon={AlertTriangle}>
      <div className="rounded-md border border-red-200 bg-red-50/40 p-3.5">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <ShieldAlert className="h-4 w-4" />Irreversible actions
        </div>
        <DangerRow label="Purge all traces" description="Permanently deletes all trace and session data." button="Purge traces" icon={Trash2} />
        <DangerRow label="Rotate API key" description="Invalidates the current key immediately." button="Manage key" icon={RefreshCw} onClick={onManageApiKey} />
        <DangerRow label="Delete project" description="Removes this project from the browser-local workspace." button="Delete project" icon={Trash2} onClick={onDelete} />
      </div>
    </SettingsSection>
  )
}

function SettingsSection({ title, icon: Icon, children }: { title: string; icon: typeof KeyRound; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="ns-settings-title"><Icon />{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, htmlFor, tag, help, children }: { label: string; htmlFor?: string; tag?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="ns-settings-field">
      <label className="ns-settings-field-label" htmlFor={htmlFor}>
        {label}
        {tag && <span className="rounded-full border bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{tag}</span>}
      </label>
      {children}
      {help && <p className="ns-settings-help">{help}</p>}
    </div>
  )
}

function DisabledButton({ primary = false, className, children }: { primary?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={cn('ns-button', primary && 'ns-button-primary', className)} disabled title="Persistence API not connected">
      {children}
    </button>
  )
}

function KeyCard({ name, value, meta, isCopied, onCopy, ariaLabel }: { name: string; value: string; meta: string[]; isCopied: boolean; onCopy: (input: HTMLInputElement | null) => void; ariaLabel: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isHidden, setIsHidden] = useState(true)
  const displayValue = isHidden ? '•'.repeat(value.length) : value

  return (
    <div className="ns-panel mb-2 flex items-center gap-2.5 px-3 py-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{name}</div>
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          className="mt-0.5 w-full bg-transparent font-mono text-[10px] text-muted-foreground outline-none"
          value={displayValue}
          onFocus={(event) => event.currentTarget.select()}
          readOnly
        />
      </div>
      <div className="text-right text-[10px] leading-4 text-muted-foreground">{meta.map((line) => <div key={line}>{line}</div>)}</div>
      <button
        type="button"
        className="ns-button px-2"
        onClick={() => setIsHidden((prev) => !prev)}
        aria-label={isHidden ? `Reveal ${ariaLabel}` : `Hide ${ariaLabel}`}
        aria-pressed={!isHidden}
        title={isHidden ? 'Reveal' : 'Hide'}
      >
        {isHidden ? <Eye /> : <EyeOff />}
        <span className="sr-only">{isHidden ? 'Reveal' : 'Hide'}</span>
      </button>
      <button type="button" className="ns-button px-2" onClick={() => onCopy(inputRef.current)}>
        {isCopied ? <Check /> : <Copy />}
        <span className="sr-only">{isCopied ? 'Copied' : `Copy ${ariaLabel}`}</span>
      </button>
    </div>
  )
}

function ToggleRow({ label, description, checked = false }: { label: string; description: string; checked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-b py-2.5 last:border-b-0">
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>
      </span>
      <span className="relative mt-0.5 h-5 w-[34px] shrink-0">
        <input className="peer sr-only" type="checkbox" defaultChecked={checked} />
        <span className="absolute inset-0 rounded-full bg-[var(--ns-line)] transition-colors peer-checked:bg-primary" />
        <span className="absolute left-[3px] top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-transform peer-checked:translate-x-3.5" />
      </span>
    </label>
  )
}

function WebhookRow({ status, url }: { status: 'active' | 'paused'; url: string }) {
  return (
    <div className="ns-panel mb-1.5 flex items-center gap-2 px-3 py-2">
      <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px]', status === 'active' ? 'border-emerald-200 bg-[var(--ns-green-pale)] text-[var(--ns-green-dark)]' : 'bg-secondary text-muted-foreground')}>{status}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{url}</span>
      <DisabledButton className="h-7 px-2"><Trash2 /></DisabledButton>
    </div>
  )
}

function MemberCard({ initials, name, email, role, tag, lavender = false }: { initials: string; name: string; email: string; role: string; tag?: string; lavender?: boolean }) {
  return (
    <div className="ns-panel mb-2 flex items-center gap-2.5 p-2.5">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold', lavender ? 'bg-[#eeedfe] text-[#3c3489]' : 'bg-[var(--ns-green-pale)] text-[var(--ns-green-dark)]')}>{initials}</span>
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-xs font-medium">{name}{tag && <span className="rounded-full border bg-secondary px-1.5 font-mono text-[9px] text-muted-foreground">{tag}</span>}</div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{email}</div>
      </div>
      <select className="ns-input max-w-[88px]" defaultValue={role}><option>{role}</option></select>
    </div>
  )
}

function Usage({ label, value, percent, warning = false }: { label: string; value: string; percent: string; warning?: boolean }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{label}</span><span>{value}</span></div>
      <div className="h-1 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${warning ? 'bg-[var(--ns-amber)]' : 'bg-primary'}`} style={{ width: percent }} /></div>
    </div>
  )
}

function DangerRow({ label, description, button, icon: Icon, onClick }: { label: string; description: string; button: string; icon: typeof Trash2; onClick?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-red-200 py-2.5 last:border-b-0 last:pb-0">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>
      </div>
      {onClick ? (
        <button type="button" className="ns-button ns-button-danger" onClick={onClick}><Icon />{button}</button>
      ) : (
        <DisabledButton className="ns-button-danger"><Icon />{button}</DisabledButton>
      )}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">{children}</code>
}

interface CreatedApiKey {
  value: string
  projectId: BackendProjectId
  createdAt: string
}

function parseCreatedApiKey(value: unknown): CreatedApiKey | null {
  if (
    !isRecord(value) ||
    typeof value.apiKey !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null
  }

  const projectId = parseBackendProjectId(value.projectId)
  if (!/^ns_[A-Za-z0-9_-]{32}$/.test(value.apiKey) || !projectId || Number.isNaN(Date.parse(value.createdAt))) {
    return null
  }

  return {
    value: value.apiKey,
    projectId,
    createdAt: value.createdAt,
  }
}

function parseProviderKeyList(value: unknown): ProviderKeyStatus[] | null {
  if (!isRecord(value) || !Array.isArray(value.providerKeys)) return null
  return value.providerKeys.every(isProviderKeyStatus) ? value.providerKeys : null
}

function parseProviderKeyResponse(value: unknown): ProviderKeyStatus | null {
  if (!isRecord(value)) return null
  return isProviderKeyStatus(value.providerKey) ? value.providerKey : null
}

function isProviderKeyStatus(value: unknown): value is ProviderKeyStatus {
  return (
    isRecord(value) &&
    isProvider(value.provider) &&
    typeof value.envVar === 'string' &&
    typeof value.configured === 'boolean' &&
    (value.keyHint === null || typeof value.keyHint === 'string') &&
    (value.updatedAt === null || typeof value.updatedAt === 'string')
  )
}

function isProvider(value: unknown): value is ProviderKeyProvider {
  return typeof value === 'string' &&
    PROVIDER_KEY_INFOS.some((info) => info.provider === value)
}

function providerStatuses(providerKeys: ProviderKeyStatus[]) {
  return new Map(providerKeys.map((providerKey) => [providerKey.provider, providerKey]))
}

function upsertProviderKeyStatus(
  providerKeys: ProviderKeyStatus[],
  providerKey: ProviderKeyStatus
) {
  const next = providerKeys.filter((existing) => existing.provider !== providerKey.provider)
  next.push(providerKey)
  return next
}

function removeProviderKeyStatus(
  providerKeys: ProviderKeyStatus[],
  provider: ProviderKeyProvider
) {
  return providerKeys.map((providerKey) =>
    providerKey.provider === provider
      ? {
          ...providerKey,
          configured: false,
          keyHint: null,
          updatedAt: null,
        }
      : providerKey
  )
}

function providerLabel(provider: ProviderKeyProvider) {
  return PROVIDER_KEY_INFOS.find((info) => info.provider === provider)?.label ?? provider
}

function createdApiKeyStorageKey(projectId: string) {
  return `northstar.created-api-key.${projectId}`
}

function readCreatedApiKey(projectId: string): CreatedApiKey | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(createdApiKeyStorageKey(projectId))
    if (!stored) return null
    return parseCreatedApiKey(JSON.parse(stored))
  } catch {
    return null
  }
}

function persistCreatedApiKey(projectId: string, apiKey: CreatedApiKey | null) {
  if (typeof window === 'undefined') return
  const key = createdApiKeyStorageKey(projectId)
  if (apiKey) {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        apiKey: apiKey.value,
        projectId: apiKey.projectId,
        createdAt: apiKey.createdAt,
      }),
    )
  } else {
    window.sessionStorage.removeItem(key)
  }
}

function readError(value: unknown) {
  return isRecord(value) && typeof value.error === 'string'
    ? value.error
    : 'Unable to create API key.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function copyText(value: string, input: HTMLInputElement | null) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    input?.focus()
    input?.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
}
