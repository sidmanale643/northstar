import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardBackendProject } from '@/lib/api/project-access'
import {
  answerPolarisQuestion,
  parsePolarisRequest,
  PolarisNotFoundError,
  polarisProviderKeyError,
} from '@/lib/server/polaris'
import { MissingProviderKeyError } from '@/lib/server/provider-key-store'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const access = await requireDashboardBackendProject(request, params.projectId)
  if (!access.ok) return access.response

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const input = parsePolarisRequest(payload)
  if (!input) {
    return NextResponse.json(
      { error: 'Invalid assistant request' },
      { status: 400 }
    )
  }

  try {
    const answer = await answerPolarisQuestion(access.backendProjectId, input)
    return NextResponse.json(
      { answer },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof PolarisNotFoundError) {
      return NextResponse.json(
        { error: `${error.scope === 'session' ? 'Session' : 'Trace'} not found` },
        { status: 404 }
      )
    }

    if (error instanceof MissingProviderKeyError) {
      return NextResponse.json(
        { error: polarisProviderKeyError(error) },
        { status: 409 }
      )
    }

    console.error('polaris_assistant failed:', error)
    return NextResponse.json(
      { error: 'Unable to run Polaris' },
      { status: 502 }
    )
  }
}
