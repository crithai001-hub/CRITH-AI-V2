import { describe, expect, it } from 'vitest'
import { classifyVerifyResult, filterClaimsForVerify } from './claim-filter'
import type { VerifiableClaim, VerifyClaimResponse } from '../../shared/types'

const baseClaim = (overrides: Partial<VerifiableClaim>): VerifiableClaim => ({
  claim: 'Some claim',
  anchored_to: 'a 30-80 char anchor that should be fine here',
  claim_type: 'statistic',
  why_verify: 'because',
  risk: 'medium',
  ...overrides,
})

const baseVerdict = (
  overrides: Partial<VerifyClaimResponse>,
): VerifyClaimResponse => ({
  verdict: 'contradicted',
  evidence_summary: 'Evidence here.',
  source_urls: ['https://example.com/a'],
  verification_id: 'ver-1',
  ...overrides,
})

describe('filterClaimsForVerify (hallucination_signal gate)', () => {
  it('keeps high and medium signal claims, drops none', () => {
    const claims: VerifiableClaim[] = [
      baseClaim({ hallucination_signal: 'high', claim: 'A' }),
      baseClaim({ hallucination_signal: 'medium', claim: 'B' }),
      baseClaim({ hallucination_signal: 'none', claim: 'C' }),
    ]
    const passed = filterClaimsForVerify(claims)
    expect(passed).toHaveLength(2)
    expect(passed.map((c) => c.claim)).toEqual(['A', 'B'])
  })

  it('drops claims with missing hallucination_signal (old backend)', () => {
    const claims: VerifiableClaim[] = [
      baseClaim({ claim: 'no signal field' }),
      baseClaim({ hallucination_signal: 'high', claim: 'has signal' }),
    ]
    const passed = filterClaimsForVerify(claims)
    expect(passed.map((c) => c.claim)).toEqual(['has signal'])
  })

  it('drops claims whose hallucination_signal is unrecognized', () => {
    const claims: VerifiableClaim[] = [
      baseClaim({
        hallucination_signal: 'unknown' as unknown as 'high',
        claim: 'bogus',
      }),
      baseClaim({ hallucination_signal: 'high', claim: 'good' }),
    ]
    expect(filterClaimsForVerify(claims).map((c) => c.claim)).toEqual(['good'])
  })

  it('does NOT consult risk — high-risk + signal=none is dropped', () => {
    const claims: VerifiableClaim[] = [
      baseClaim({ risk: 'high', hallucination_signal: 'none', claim: 'consequential but plausible' }),
    ]
    expect(filterClaimsForVerify(claims)).toHaveLength(0)
  })

  it('returns empty array on undefined / non-array input', () => {
    expect(filterClaimsForVerify(undefined)).toEqual([])
    expect(filterClaimsForVerify(null as unknown as VerifiableClaim[])).toEqual([])
    expect(
      filterClaimsForVerify({ length: 0 } as unknown as VerifiableClaim[]),
    ).toEqual([])
  })

  it('survives a null entry inside the array', () => {
    const claims = [
      null as unknown as VerifiableClaim,
      baseClaim({ hallucination_signal: 'high', claim: 'kept' }),
    ]
    expect(filterClaimsForVerify(claims).map((c) => c.claim)).toEqual(['kept'])
  })
})

describe('classifyVerifyResult (render gate)', () => {
  it('returns render for contradicted verdict', () => {
    const out = classifyVerifyResult(baseVerdict({ verdict: 'contradicted' }))
    expect(out.kind).toBe('render')
    if (out.kind === 'render') {
      expect(out.verdict.verdict).toBe('contradicted')
      expect(out.verdict.source_urls).toEqual(['https://example.com/a'])
    }
  })

  it('returns noRender for confirmed verdict', () => {
    const out = classifyVerifyResult(baseVerdict({ verdict: 'confirmed' }))
    expect(out.kind).toBe('noRender')
    if (out.kind === 'noRender') {
      expect(out.reason).toBe('verdict:confirmed')
    }
  })

  it('returns noRender for inconclusive verdict', () => {
    const out = classifyVerifyResult(baseVerdict({ verdict: 'inconclusive' }))
    expect(out.kind).toBe('noRender')
  })

  it('returns noRender for error verdict', () => {
    const out = classifyVerifyResult(baseVerdict({ verdict: 'error' }))
    expect(out.kind).toBe('noRender')
  })

  it('returns noRender for ApiError shapes (any kind)', () => {
    expect(classifyVerifyResult({ kind: 'AUTH_REQUIRED' }).kind).toBe('noRender')
    expect(classifyVerifyResult({ kind: 'QUOTA_EXCEEDED', limit: 50, used: 50, message: 'x' }).kind).toBe('noRender')
    expect(classifyVerifyResult({ kind: 'NETWORK_ERROR', message: 'x' }).kind).toBe('noRender')
    expect(classifyVerifyResult({ kind: 'SERVER_ERROR', status: 500 }).kind).toBe('noRender')
    expect(classifyVerifyResult({ kind: 'PARSE_ERROR', message: 'x' }).kind).toBe('noRender')
  })

  it('reports api-error reason on ApiError input', () => {
    const out = classifyVerifyResult({ kind: 'QUOTA_EXCEEDED', limit: 50, used: 50, message: 'x' })
    if (out.kind === 'noRender') {
      expect(out.reason).toBe('api-error:QUOTA_EXCEEDED')
    } else {
      throw new Error('expected noRender')
    }
  })

  it('returns noRender for null / non-object input', () => {
    expect(classifyVerifyResult(null).kind).toBe('noRender')
    expect(classifyVerifyResult(undefined).kind).toBe('noRender')
    expect(classifyVerifyResult('contradicted').kind).toBe('noRender')
    expect(classifyVerifyResult(42).kind).toBe('noRender')
  })

  it('returns noRender when source_urls is missing or wrong shape', () => {
    expect(
      classifyVerifyResult({
        verdict: 'contradicted',
        evidence_summary: 'x',
        verification_id: 'v',
      }).kind,
    ).toBe('noRender')
    expect(
      classifyVerifyResult({
        verdict: 'contradicted',
        evidence_summary: 'x',
        source_urls: 'not-an-array',
        verification_id: 'v',
      }).kind,
    ).toBe('noRender')
  })

  it('returns noRender when verdict field is missing', () => {
    expect(
      classifyVerifyResult({
        evidence_summary: 'x',
        source_urls: [],
        verification_id: 'v',
      }).kind,
    ).toBe('noRender')
  })
})
