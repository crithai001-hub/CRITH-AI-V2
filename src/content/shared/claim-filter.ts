// ── content/shared/claim-filter.ts ────────────────────────────
// Pure helpers around the verifiable-claim verify gate. Extracted
// from the orchestrator so the gating logic is unit-testable
// without spinning up the full content-script lifecycle.

import type { VerifiableClaim, VerifyClaimResponse } from '../../shared/types'

/**
 * Return only the claims that warrant a Brave + Claude verify call.
 *
 * Gating rule: claim.hallucination_signal must be 'high' or 'medium'.
 * Anything else (including `none`, `undefined`, or unrecognized values
 * shipped by a future backend) is dropped silently.
 *
 * `risk` is intentionally NOT consulted — risk encodes "how bad if this
 * is false" while hallucination_signal encodes "does this look like a
 * fabrication." Verifying a high-risk-but-low-fabrication-signal claim
 * (e.g. a basic arithmetic statement) wastes a Brave call.
 */
export function filterClaimsForVerify(
  claims: VerifiableClaim[] | undefined,
): VerifiableClaim[] {
  if (!Array.isArray(claims)) return []
  return claims.filter(
    (c) =>
      c &&
      (c.hallucination_signal === 'high' ||
        c.hallucination_signal === 'medium'),
  )
}

/**
 * Split candidates into artifact-claims (rendered immediately with a
 * synthesized verdict) and factual-claims (sent through VERIFY_CLAIM).
 *
 * Artifacts are non-factual generation glitches — language switches,
 * repetition, malformed output. Brave can't corroborate or refute a
 * glitch, so the verify call is wasted quota. Backend ships them
 * with hallucination_signal: "high" already, so they pass the
 * filterClaimsForVerify gate; this partition runs after that.
 */
export function partitionCandidates(
  candidates: VerifiableClaim[],
): { artifacts: VerifiableClaim[]; factual: VerifiableClaim[] } {
  const artifacts: VerifiableClaim[] = []
  const factual: VerifiableClaim[] = []
  for (const c of candidates) {
    if (c?.claim_type === 'generation_artifact') {
      artifacts.push(c)
    } else if (c) {
      factual.push(c)
    }
  }
  return { artifacts, factual }
}

/**
 * Build a verdict-shaped payload for a generation artifact so the
 * existing render path treats it identically to a verified-
 * contradicted factual claim. evidence_summary is sourced from
 * hallucination_reason; source_urls is empty (no Brave call); the
 * verification_id is a deterministic synth tag so analytics can
 * tell artifacts apart from real verifications later.
 *
 * Returns null when the claim doesn't have the IDs needed to be
 * render-eligible — caller should skip in that case.
 */
export function synthesizeArtifactVerdict(
  claim: VerifiableClaim,
): VerifyClaimResponse | null {
  if (claim.claim_type !== 'generation_artifact') return null
  if (
    typeof claim.analysis_id !== 'string' ||
    typeof claim.claim_index !== 'number'
  ) {
    return null
  }
  return {
    verdict: 'contradicted',
    evidence_summary: claim.hallucination_reason ?? '',
    source_urls: [],
    verification_id: `artifact-${claim.analysis_id}-${claim.claim_index}`,
  }
}

/**
 * Decide whether a verify response should produce visible UI.
 *
 * Only `verdict === 'contradicted'` renders. Everything else (other
 * verdicts, ApiError shapes, malformed payloads, null/undefined) is
 * a `noRender` outcome — the orchestrator logs and moves on without
 * touching the DOM.
 */
export type VerifyOutcome =
  | { kind: 'render'; verdict: VerifyClaimResponse }
  | { kind: 'noRender'; reason: string }

export function classifyVerifyResult(result: unknown): VerifyOutcome {
  if (result === null || typeof result !== 'object') {
    return { kind: 'noRender', reason: 'non-object' }
  }
  const r = result as Record<string, unknown>

  // ApiError shape — discriminate on `kind` field.
  if (
    typeof r.kind === 'string' &&
    [
      'AUTH_REQUIRED',
      'NETWORK_ERROR',
      'QUOTA_EXCEEDED',
      'SERVER_ERROR',
      'PARSE_ERROR',
    ].includes(r.kind)
  ) {
    return { kind: 'noRender', reason: `api-error:${r.kind}` }
  }

  if (typeof r.verdict !== 'string' || !Array.isArray(r.source_urls)) {
    return { kind: 'noRender', reason: 'malformed' }
  }
  if (r.verdict !== 'contradicted') {
    return { kind: 'noRender', reason: `verdict:${r.verdict}` }
  }
  return {
    kind: 'render',
    verdict: result as VerifyClaimResponse,
  }
}
