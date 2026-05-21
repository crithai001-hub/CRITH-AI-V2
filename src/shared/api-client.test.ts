import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError, verifyClaim } from './api-client'
import type { ApiError, VerifyClaimRequest, VerifyClaimResponse } from './types'

const TOKEN_OK = async (): Promise<string> => 'fake-jwt-token'
const TOKEN_NULL = async (): Promise<null> => null

const SAMPLE_PAYLOAD: VerifyClaimRequest = {
  analysis_id: 'an-1234',
  claim_index: 0,
}

const SAMPLE_OK_RESPONSE: VerifyClaimResponse = {
  verdict: 'confirmed',
  evidence_summary: 'Multiple sources corroborate this claim.',
  source_urls: ['https://example.com/a', 'https://example.com/b'],
  verification_id: 'ver-9876',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('verifyClaim', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns AUTH_REQUIRED when no token is available', async () => {
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_NULL)
    expect(isApiError(result)).toBe(true)
    expect((result as ApiError).kind).toBe('AUTH_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns parsed VerifyClaimResponse on 200 OK', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, SAMPLE_OK_RESPONSE))
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(false)
    expect(result).toEqual(SAMPLE_OK_RESPONSE)
  })

  it('POSTs to /api/verify-claim with bearer auth + JSON body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, SAMPLE_OK_RESPONSE))
    await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://test.crith.local/api/verify-claim')
    const reqInit = init as RequestInit
    expect(reqInit.method).toBe('POST')
    expect((reqInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer fake-jwt-token',
    )
    expect((reqInit.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
    expect(JSON.parse(reqInit.body as string)).toEqual(SAMPLE_PAYLOAD)
  })

  it('returns AUTH_REQUIRED on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    expect((result as ApiError).kind).toBe('AUTH_REQUIRED')
  })

  it('returns QUOTA_EXCEEDED with limit/used parsed on HTTP 429', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { limit: 50, used: 50, message: 'Out of verifications' }),
    )
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    expect(result).toEqual({
      kind: 'QUOTA_EXCEEDED',
      limit: 50,
      used: 50,
      message: 'Out of verifications',
    })
  })

  it('returns QUOTA_EXCEEDED with null limits when 429 body is malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 429 }),
    )
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    const err = result as Extract<ApiError, { kind: 'QUOTA_EXCEEDED' }>
    expect(err.kind).toBe('QUOTA_EXCEEDED')
    expect(err.limit).toBeNull()
    expect(err.used).toBeNull()
    expect(err.message).toBe('Quota exceeded')
  })

  it('returns SERVER_ERROR on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    expect(result).toEqual({ kind: 'SERVER_ERROR', status: 500 })
  })

  it('returns SERVER_ERROR for non-OK statuses below 500 (e.g. 503-style 4xx)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(418, { error: 'teapot' }))
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    expect((result as ApiError).kind).toBe('SERVER_ERROR')
  })

  it('returns NETWORK_ERROR when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    expect(result).toEqual({
      kind: 'NETWORK_ERROR',
      message: 'Failed to fetch',
    })
  })

  it('returns PARSE_ERROR when 200 body is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<<not json>>', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await verifyClaim(SAMPLE_PAYLOAD, TOKEN_OK)
    expect(isApiError(result)).toBe(true)
    expect((result as ApiError).kind).toBe('PARSE_ERROR')
  })
})

describe('isApiError type guard', () => {
  it('recognizes valid ApiError shapes', () => {
    expect(isApiError({ kind: 'AUTH_REQUIRED' })).toBe(true)
    expect(isApiError({ kind: 'NETWORK_ERROR', message: 'x' })).toBe(true)
    expect(isApiError({ kind: 'SERVER_ERROR', status: 500 })).toBe(true)
    expect(
      isApiError({ kind: 'QUOTA_EXCEEDED', limit: 50, used: 50, message: 'x' }),
    ).toBe(true)
    expect(isApiError({ kind: 'PARSE_ERROR', message: 'x' })).toBe(true)
  })

  it('rejects non-error values', () => {
    expect(isApiError(null)).toBe(false)
    expect(isApiError(undefined)).toBe(false)
    expect(isApiError({})).toBe(false)
    expect(isApiError({ kind: 'NOT_A_REAL_KIND' })).toBe(false)
    expect(isApiError({ verdict: 'confirmed' })).toBe(false)
    expect(isApiError('AUTH_REQUIRED')).toBe(false)
  })
})
