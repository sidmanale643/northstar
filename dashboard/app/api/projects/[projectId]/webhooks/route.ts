import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  createDashboardWebhook,
  listDashboardWebhooks,
} from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    const webhooks = await listDashboardWebhooks(access.backendProjectId)
    return NextResponse.json({ webhooks }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_list_webhooks failed:', error)
    return NextResponse.json({ error: 'Unable to list webhooks' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isWebhookInput(body)) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const isHttps = body.url.startsWith('https://')
  const isLocalhostHttp =
    process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?\//.test(body.url)

  if (!isHttps && !isLocalhostHttp) {
    return NextResponse.json(
      { error: 'Webhook URL must start with https:// (http://localhost allowed in dev)' },
      { status: 400 }
    )
  }

  try {
    const webhook = await createDashboardWebhook({
      id: randomUUID(),
      projectId: access.backendProjectId,
      url: body.url,
    })
    return NextResponse.json({ webhook }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_create_webhook failed:', error)
    return NextResponse.json({ error: 'Unable to create webhook' }, { status: 500 })
  }
}

function isWebhookInput(value: unknown): value is { url: string } {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.url === 'string' && v.url.length > 0
}
