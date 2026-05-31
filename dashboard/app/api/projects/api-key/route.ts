import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

interface ApiKeyRequest {
  projectName: string
  backendProjectId: string | null
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseRequest(body)
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid API-key request' }, { status: 400 })
  }

  const apiKey = `ns_${randomBytes(24).toString('base64url')}`
  const keyHash = createHash('sha256').update(apiKey).digest('hex')
  const projectId = parsed.backendProjectId ?? randomUUID()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .rpc('create_or_rotate_project_api_key', {
      p_project_id: projectId,
      p_project_name: parsed.projectName,
      p_key_id: randomUUID(),
      p_key_hash: keyHash,
    })
    .single()

  if (error) {
    console.error('create_or_rotate_project_api_key failed:', error)
    return NextResponse.json({ error: 'Unable to create API key' }, { status: 500 })
  }

  return NextResponse.json(
    {
      apiKey,
      projectId: data.result_project_id,
      createdAt: data.result_created_at,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}

async function isAuthorized(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return true

  const dashboardApiKey = process.env.DASHBOARD_API_KEY
  if (dashboardApiKey && request.headers.get('x-api-key') === dashboardApiKey) {
    return true
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user !== null
}

function parseRequest(value: unknown): ApiKeyRequest | null {
  if (!isRecord(value) || typeof value.projectName !== 'string') return null

  const projectName = value.projectName.trim()
  if (!projectName || projectName.length > 200) return null

  const backendProjectId = value.backendProjectId
  if (backendProjectId !== null && !isUuid(backendProjectId)) return null

  return { projectName, backendProjectId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
