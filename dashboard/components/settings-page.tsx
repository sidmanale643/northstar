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
  KeyRound,
  Mail,
  Plus,
  Receipt,
  RefreshCw,
  Server,
  ShieldAlert,
  Star,
  Trash2,
  Users,
  Webhook,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DeleteProjectDialog } from '@/components/delete-project-dialog'
import { useActiveProject, useProjectWorkspace } from '@/components/project-provider'
import { cn } from '@/lib/utils'
import { parseBackendProjectId, type BackendProjectId, type Project } from '@/lib/projects'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const sdkEndpointSetting = supabaseUrl
  ? `NORTHSTAR_ENDPOINT=${supabaseUrl.replace(/\/$/, '')}/functions/v1/ingest-traces`
  : null

const tabs = [
  { id: 'api', label: 'API key', icon: KeyRound },
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
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isEndpointCopied, setIsEndpointCopied] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(project.name)
    setCreatedApiKey(null)
    setIsCopied(false)
    setIsEndpointCopied(false)
    setError(null)
  }, [project.id, project.name])

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    renameProject(project.id, name)
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
      setIsCopied(false)
    } catch (apiKeyError) {
      setError(apiKeyError instanceof Error ? apiKeyError.message : 'Unable to create API key.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleCopyApiKey(input: HTMLInputElement | null) {
    if (!createdApiKey) return

    if (await copyText(createdApiKey.value, input)) {
      setIsCopied(true)
      setError(null)
    } else {
      setError('Clipboard access is blocked. Press Ctrl+C, or Cmd+C on macOS, to copy the selected API key.')
    }
  }

  async function handleCopySdkEndpoint(input: HTMLInputElement | null) {
    if (!sdkEndpointSetting) return

    if (await copyText(sdkEndpointSetting, input)) {
      setIsEndpointCopied(true)
      setError(null)
    } else {
      setError('Clipboard access is blocked. Press Ctrl+C, or Cmd+C on macOS, to copy the selected SDK endpoint.')
    }
  }

  return (
    <>
      <SettingsSection title="API key" icon={KeyRound}>
        {createdApiKey ? (
          <KeyCard
            name="Project key"
            value={createdApiKey.value}
            meta={[`Created ${formatTimestamp(createdApiKey.createdAt)}`]}
            isCopied={isCopied}
            onCopy={handleCopyApiKey}
            ariaLabel="Project API key"
          />
        ) : project.backendId ? (
          <div className="ns-panel mb-2 px-3 py-2.5 text-xs text-muted-foreground">
            This project has an API key. Rotate it to reveal a new value.
          </div>
        ) : (
          <div className="ns-panel mb-2 px-3 py-2.5 text-xs text-muted-foreground">
            Create an API key to send traces from the NorthStar SDK.
          </div>
        )}
        <button className="ns-button ns-button-primary mt-2.5" type="button" disabled={isGenerating} onClick={handleGenerateApiKey}>
          <RefreshCw />{isGenerating ? 'Generating...' : project.backendId ? 'Rotate key' : 'Create API key'}
        </button>
        {createdApiKey && (
          <p className="ns-settings-help text-amber-700">
            Copy this key now. NorthStar stores only its hash and cannot show it again.
          </p>
        )}
        {error && <p className="ns-settings-help text-red-700">{error}</p>}
        <p className="ns-settings-help">
          Configure your SDK with <Code>NORTHSTAR_API_KEY</Code> and the endpoint below. The dashboard Project ID is not an SDK setting.
        </p>
        {sdkEndpointSetting && (
          <KeyCard
            name="SDK endpoint"
            value={sdkEndpointSetting}
            meta={['Add to .env']}
            isCopied={isEndpointCopied}
            onCopy={handleCopySdkEndpoint}
            ariaLabel="SDK endpoint setting"
          />
        )}
      </SettingsSection>

      <SettingsSection title="Project" icon={Server}>
        <Field label="Project name" htmlFor="project-name">
          <form className="flex max-w-sm gap-2" onSubmit={handleRename}>
            <input id="project-name" className="ns-input" value={name} onChange={(event) => setName(event.target.value)} />
            <button className="ns-button ns-button-primary" type="submit" disabled={!name.trim()}><Check />Save</button>
          </form>
        </Field>
        <Field label="Project ID" htmlFor="project-id" tag="read-only" help="Identifies this project in dashboard and administrative operations. Do not pass this value to the SDK.">
          <input id="project-id" className="ns-input max-w-[260px] tracking-[0.08em] text-muted-foreground" value={project.id} readOnly />
        </Field>
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

  return (
    <div className="ns-panel mb-2 flex items-center gap-2.5 px-3 py-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{name}</div>
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          className="mt-0.5 w-full bg-transparent font-mono text-[10px] text-muted-foreground outline-none"
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          readOnly
        />
      </div>
      <div className="text-right text-[10px] leading-4 text-muted-foreground">{meta.map((line) => <div key={line}>{line}</div>)}</div>
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
