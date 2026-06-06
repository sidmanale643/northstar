import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { deleteDashboardWebhook, listDashboardWebhooks } from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; webhookId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    await deleteDashboardWebhook(access.backendProjectId, params.webhookId)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_delete_webhook failed:', error)
    return NextResponse.json({ error: 'Unable to delete webhook' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; webhookId: string } }
) {
  // POST here = "Test fire" — log to console (per SOTA spec)
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const webhooks = await listDashboardWebhooks(access.backendProjectId)
  const webhook = webhooks.find((w) => w.id === params.webhookId)
  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  const payload = {
    rule_id: null,
    rule_kind: 'manual_test',
    webhook_id: webhook.id,
    fired_at: new Date().toISOString(),
    project_id: access.backendProjectId,
    payload: body ?? {},
  }
  // SOTA spec: "log to console is enough"
  console.log(`[NorthStar webhook ${webhook.id}] POST ${webhook.url}`, JSON.stringify(payload))

  return NextResponse.json(
    { ok: true, log: `Logged POST to ${webhook.url}` },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
