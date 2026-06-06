import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  deleteDashboardAlertRule,
  upsertDashboardAlertRule,
} from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; ruleId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isPartialAlertRuleInput(body)) {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  try {
    const rule = await upsertDashboardAlertRule({
      id: params.ruleId,
      projectId: access.backendProjectId,
      kind: body.kind ?? 'error_rate',
      threshold: body.threshold ?? null,
      enabled: body.enabled,
    })
    return NextResponse.json({ rule }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_upsert_alert_rule failed:', error)
    return NextResponse.json({ error: 'Unable to update alert rule' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; ruleId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    await deleteDashboardAlertRule(access.backendProjectId, params.ruleId)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_delete_alert_rule failed:', error)
    return NextResponse.json({ error: 'Unable to delete alert rule' }, { status: 500 })
  }
}

function isPartialAlertRuleInput(value: unknown): value is {
  kind?: 'error_rate' | 'latency_p95' | 'token_budget'
  threshold?: number | null
  enabled: boolean
} {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.enabled !== 'boolean') return false
  if (v.kind !== undefined && v.kind !== 'error_rate' && v.kind !== 'latency_p95' && v.kind !== 'token_budget') return false
  if (v.threshold !== undefined && v.threshold !== null && typeof v.threshold !== 'number') return false
  return true
}
