import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  listDashboardAlertRules,
  upsertDashboardAlertRule,
} from '@/lib/supabase/dashboard'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  try {
    const rules = await listDashboardAlertRules(access.backendProjectId)
    return NextResponse.json({ rules }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_list_alert_rules failed:', error)
    return NextResponse.json({ error: 'Unable to list alert rules' }, { status: 500 })
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

  if (!isAlertRuleInput(body)) {
    return NextResponse.json({ error: 'kind and enabled are required' }, { status: 400 })
  }

  try {
    const rule = await upsertDashboardAlertRule({
      id: randomUUID(),
      projectId: access.backendProjectId,
      kind: body.kind,
      threshold: body.threshold ?? null,
      enabled: body.enabled,
    })
    return NextResponse.json({ rule }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dashboard_upsert_alert_rule failed:', error)
    return NextResponse.json({ error: 'Unable to save alert rule' }, { status: 500 })
  }
}

function isAlertRuleInput(value: unknown): value is {
  kind: 'error_rate' | 'latency_p95' | 'token_budget'
  threshold?: number | null
  enabled: boolean
} {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.kind !== 'error_rate' && v.kind !== 'latency_p95' && v.kind !== 'token_budget') return false
  if (typeof v.enabled !== 'boolean') return false
  if (v.threshold !== undefined && v.threshold !== null && typeof v.threshold !== 'number') return false
  return true
}
