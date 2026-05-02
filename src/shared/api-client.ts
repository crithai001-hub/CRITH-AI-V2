import { getEnv } from './env'
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ApiError,
  EventRequest,
  ExplainRequest,
  ExplainResponse,
} from './types'

const MOCK_EXPLANATION =
  'This is a placeholder explanation while the backend is wired up. ' +
  'In production, this text comes from a separate Claude call that ' +
  'unpacks the provocation in 2-3 plain sentences.'

export type GetAccessToken = () => Promise<string | null>

const ERROR_KINDS: ReadonlySet<string> = new Set([
  'AUTH_REQUIRED',
  'NETWORK_ERROR',
  'QUOTA_EXCEEDED',
  'SERVER_ERROR',
  'PARSE_ERROR',
])

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string' &&
    ERROR_KINDS.has((value as { kind: string }).kind)
  )
}

function getBackendUrl(): string {
  const env = getEnv()
  if (!env.ok) {
    throw new Error(`Missing env: ${env.missing.join(', ')}`)
  }
  return env.BACKEND_URL
}

/**
 * Single-shot POST to the backend with bearer auth. Returns either the parsed
 * JSON body (typed as TResp) or a typed ApiError. Never throws on expected
 * failures — only throws if env is missing (programmer error).
 */
async function callBackend<TResp>(
  endpoint: string,
  body: unknown,
  getAccessToken: GetAccessToken,
): Promise<TResp | ApiError> {
  const token = await getAccessToken()
  if (!token) {
    return { kind: 'AUTH_REQUIRED' }
  }

  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      kind: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Network error',
    }
  }

  if (response.status === 401) {
    return { kind: 'AUTH_REQUIRED' }
  }

  if (response.status === 429) {
    let parsed: { limit?: number; used?: number; message?: string } = {}
    try {
      parsed = (await response.json()) as typeof parsed
    } catch {
      // Body might not be JSON — fall back to defaults below.
    }
    return {
      kind: 'QUOTA_EXCEEDED',
      limit: parsed.limit ?? null,
      used: parsed.used ?? null,
      message: parsed.message ?? 'Quota exceeded',
    }
  }

  if (response.status >= 500 || !response.ok) {
    return { kind: 'SERVER_ERROR', status: response.status }
  }

  try {
    return (await response.json()) as TResp
  } catch (err) {
    return {
      kind: 'PARSE_ERROR',
      message: err instanceof Error ? err.message : 'Parse error',
    }
  }
}

export async function analyzeResponse(
  payload: AnalyzeRequest,
  getAccessToken: GetAccessToken,
): Promise<AnalyzeResponse | ApiError> {
  return callBackend<AnalyzeResponse>(
    '/api/analyze-response',
    payload,
    getAccessToken,
  )
}

export async function logEvent(
  payload: EventRequest,
  getAccessToken: GetAccessToken,
): Promise<{ ok: true } | ApiError> {
  const result = await callBackend<unknown>(
    '/api/events',
    payload,
    getAccessToken,
  )
  if (isApiError(result)) return result
  return { ok: true }
}

/**
 * Explain a single provocation in plain sentences.
 *
 * Mock support: if `analysis_id` starts with "mock-", returns the
 * hardcoded MOCK_EXPLANATION synchronously without hitting the backend.
 * The orchestrator currently produces only real backend analysis_ids
 * (UUIDs), so this branch is dormant in production — but kept so the
 * UI flow can be tested without auth or a deployed /api/explain
 * endpoint.
 */
export async function explainProvocation(
  payload: ExplainRequest,
  getAccessToken: GetAccessToken,
): Promise<ExplainResponse | ApiError> {
  if (payload.analysis_id.startsWith('mock-')) {
    return { explanation: MOCK_EXPLANATION }
  }
  return callBackend<ExplainResponse>(
    '/api/explain-provocation',
    payload,
    getAccessToken,
  )
}
