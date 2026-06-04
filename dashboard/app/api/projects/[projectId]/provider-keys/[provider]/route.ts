import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import { parseProvider } from '@/lib/provider-key-config'
import { deleteProviderKey, upsertProviderKey } from '@/lib/server/provider-key-store'

export const runtime = 'nodejs'

export async function PUT(
  request: NextRequest,
  { params }: { params: { projectId: string; provider: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  const provider = parseProvider(params.provider)
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 404 })
  }

  const apiKey = await readApiKey(request)
  if (!apiKey.ok) {
    return NextResponse.json({ error: apiKey.error }, { status: 400 })
  }

  try {
    const providerKey = await upsertProviderKey({
      projectId: access.backendProjectId,
      provider,
      apiKey: apiKey.value,
    })
    return NextResponse.json(
      { providerKey },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('dashboard_upsert_provider_key failed:', error)
    return NextResponse.json({ error: 'Unable to save provider key' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; provider: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  const provider = parseProvider(params.provider)
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 404 })
  }

  try {
    await deleteProviderKey({
      projectId: access.backendProjectId,
      provider,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('dashboard_delete_provider_key failed:', error)
    return NextResponse.json({ error: 'Unable to delete provider key' }, { status: 500 })
  }
}

async function readApiKey(
  request: NextRequest
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, error: 'Invalid JSON body.' }
  }

  if (!isRecord(body) || typeof body.apiKey !== 'string') {
    return { ok: false, error: 'apiKey is required.' }
  }

  const apiKey = body.apiKey.trim()
  if (!apiKey || apiKey.length > 20_000) {
    return { ok: false, error: 'apiKey must be a non-empty string under 20000 characters.' }
  }

  return { ok: true, value: apiKey }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
