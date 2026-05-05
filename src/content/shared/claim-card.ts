// ── content/shared/claim-card.ts ──────────────────────────────
// Card UI for verifiable claims.
//
// Under the new auto-verify flow, hosts only attach AFTER the
// orchestrator has resolved a claim's verdict to "contradicted"
// and pre-stuffed the result into verdictCache via setClaimVerdict.
// The card therefore opens directly in the verified state — no
// loading, no error, no manual Verify button.
//
// What's in the card:
//   - claim_type chip + risk chip
//   - the claim text itself (so the user knows WHAT was disproven)
//   - "Verified false" verdict badge
//   - evidence_summary
//   - collapsible source URLs
//   - [Useful] [Not useful] for engagement metrics
//
// Cache: verdictCache lives at module scope keyed on
// `${analysis_id}::${claim_index}`. Same cache the orchestrator
// peeks via getClaimVerdict before deciding whether to fire
// VERIFY_CLAIM, so SPA navigation back into a chat is a no-op.

import type {
  PlatformAdapter,
  VerifiableClaim,
  Verdict,
  VerifyClaimResponse,
} from '../../shared/types'

const COLLAPSE_GRACE_MS = 200

// ── Module-level adapter ref + verdict cache ─────────────────

// Adapter ref kept for parity with card.ts and reserved for a future
// "elaborate on this verdict" Ask-AI affordance. Currently unused
// internally; setter exists so orchestrator wiring stays symmetric.
let _cardAdapter: PlatformAdapter | null = null
export function setClaimCardAdapter(adapter: PlatformAdapter | null): void {
  _cardAdapter = adapter
  void _cardAdapter
}

const verdictCache = new Map<string, VerifyClaimResponse>()

function cacheKey(analysisId: string, claimIndex: number): string {
  return `${analysisId}::${claimIndex}`
}

/**
 * Pre-populate the verdict cache from outside this module.
 *
 * The orchestrator auto-fires VERIFY_CLAIM for every detected
 * claim with hallucination_signal high|medium, then renders the
 * underline + host only for claims whose verdict came back
 * "contradicted". Stuffing the verdict into the cache before
 * render means the card opens directly in the verified state on
 * first hover — no second network round-trip.
 */
export function setClaimVerdict(
  analysisId: string,
  claimIndex: number,
  verdict: VerifyClaimResponse,
): void {
  verdictCache.set(cacheKey(analysisId, claimIndex), verdict)
}

/**
 * Read a previously-cached verdict, or undefined if none exists.
 *
 * The orchestrator peeks this before firing VERIFY_CLAIM so SPA
 * navigation back into a chat tab doesn't re-fire verify on claims
 * we've already resolved this session.
 */
export function getClaimVerdict(
  analysisId: string,
  claimIndex: number,
): VerifyClaimResponse | undefined {
  return verdictCache.get(cacheKey(analysisId, claimIndex))
}

// ── Visual mapping helpers ───────────────────────────────────

function verdictBadgeClass(verdict: Verdict): string {
  return `verdict-${verdict}`
}

function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'confirmed': return '✓ Confirmed'
    // Single user-facing label for any AI mistake — verified-false
    // facts AND generation_artifact glitches both surface here. The
    // user's mental model is "this is a hallucination," regardless
    // of which of the two backend paths produced it.
    case 'contradicted': return 'Hallucination'
    case 'inconclusive': return '? Inconclusive'
    case 'error': return '! Error'
  }
}

function shortHostname(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.length > 30
      ? u.pathname.slice(0, 30) + '…'
      : u.pathname
    return path && path !== '/' ? `${host}${path}` : host
  } catch {
    return url.length > 60 ? url.slice(0, 60) + '…' : url
  }
}

// ── attach() ─────────────────────────────────────────────────

export function attachClaim(
  host: HTMLElement,
  root: ShadowRoot,
  claim: VerifiableClaim,
  extraTriggers: HTMLElement[],
): void {
  const _logo = root.querySelector('.crith-prov-logo') as HTMLElement | null
  const _card = root.querySelector('.card') as HTMLElement | null
  if (!_logo || !_card) return
  const logo = _logo
  const card = _card

  const _claimText = card.querySelector('.claim-text') as HTMLParagraphElement | null
  const _whyVerify = card.querySelector('.why-verify') as HTMLParagraphElement | null
  const _claimTypeBadge = card.querySelector('.claim-type-badge') as HTMLElement | null
  const _riskBadge = card.querySelector('.risk-badge') as HTMLElement | null
  const _notUsefulBtn = card.querySelector(
    'button[data-action="not_useful"]',
  ) as HTMLButtonElement | null
  const _usefulBtn = card.querySelector(
    'button[data-action="useful"]',
  ) as HTMLButtonElement | null
  const _verifyResult = card.querySelector('.verify-result') as HTMLElement | null
  const _verdictBadge = card.querySelector('.verdict-badge') as HTMLElement | null
  const _evidence = card.querySelector('.evidence') as HTMLParagraphElement | null
  const _sourcesDetails = card.querySelector('.sources-details') as HTMLDetailsElement | null
  const _sourcesSummary = card.querySelector('.sources-summary') as HTMLElement | null
  const _sourcesList = card.querySelector('.sources-list') as HTMLUListElement | null

  if (
    !_claimText || !_whyVerify || !_claimTypeBadge || !_riskBadge ||
    !_notUsefulBtn || !_usefulBtn ||
    !_verifyResult || !_verdictBadge || !_evidence ||
    !_sourcesDetails || !_sourcesSummary || !_sourcesList
  ) {
    return
  }

  const claimText = _claimText
  const whyVerify = _whyVerify
  const claimTypeBadge = _claimTypeBadge
  const riskBadge = _riskBadge
  const notUsefulBtn = _notUsefulBtn
  const usefulBtn = _usefulBtn
  const verifyResult = _verifyResult
  const verdictBadge = _verdictBadge
  const evidence = _evidence
  const sourcesDetails = _sourcesDetails
  const sourcesSummary = _sourcesSummary
  const sourcesList = _sourcesList

  // Static fields up front. These never change after attach.
  claimTypeBadge.textContent = claim.claim_type.replace(/_/g, ' ').toUpperCase()
  riskBadge.textContent = claim.risk.toUpperCase()
  riskBadge.dataset.risk = claim.risk
  claimText.textContent = claim.claim
  whyVerify.textContent = claim.why_verify

  const hasIds =
    typeof claim.analysis_id === 'string' &&
    typeof claim.claim_index === 'number'

  // Cache lookup. Under the new flow the orchestrator pre-populates
  // this before render, so we expect a hit. If the cache is empty
  // (defensive: rendered with no verdict, e.g. an upstream code path
  // hasn't been updated), bail without showing the card content —
  // a card that says "Verified false" with no evidence is worse
  // than no card at all.
  const cachedVerdict =
    hasIds &&
    verdictCache.get(cacheKey(claim.analysis_id!, claim.claim_index!))
  if (!cachedVerdict) {
    console.warn(
      '[Crith V2 CLAIM] attachClaim: no cached verdict — card will not render',
      claim,
    )
    return
  }

  renderVerdictInto(cachedVerdict)
  card.dataset.state = 'verified'
  verifyResult.hidden = false

  function renderVerdictInto(v: VerifyClaimResponse): void {
    verdictBadge.textContent = verdictLabel(v.verdict)
    verdictBadge.className = `verdict-badge ${verdictBadgeClass(v.verdict)}`
    evidence.textContent = v.evidence_summary
    sourcesList.replaceChildren()
    for (const url of v.source_urls.slice(0, 5)) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = shortHostname(url)
      li.appendChild(a)
      sourcesList.appendChild(li)
    }
    sourcesSummary.textContent =
      v.source_urls.length > 0
        ? `View ${v.source_urls.length} source${v.source_urls.length === 1 ? '' : 's'}`
        : 'No sources'
    sourcesDetails.hidden = v.source_urls.length === 0
    sourcesDetails.open = false
  }

  // ── Useful / Not useful state ──────────────────────────────

  let ratingChosen: 'useful' | 'not_useful' | null = null

  function applyRatingLock(): void {
    if (ratingChosen != null) {
      notUsefulBtn.disabled = true
      usefulBtn.disabled = true
    }
  }
  applyRatingLock()

  // ── Hover / open-close ─────────────────────────────────────

  let collapseTimer: ReturnType<typeof setTimeout> | null = null

  const open = (source: string): void => {
    console.log('[Crith V2 CLAIM CARD] open() by', source)
    if (collapseTimer != null) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
    // Raise the host above its siblings so the expanded card draws
    // on top when adjacent stacked hosts would otherwise occlude it.
    host.style.zIndex = '2147483647'
    card.classList.add('open')
  }
  const closeSoon = (): void => {
    if (collapseTimer != null) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      card.classList.remove('open')
      host.style.zIndex = '2147483640'
    }, COLLAPSE_GRACE_MS)
  }
  const cancelClose = (): void => {
    if (collapseTimer != null) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
  }

  const triggers: HTMLElement[] = [logo, ...extraTriggers]
  for (const t of triggers) {
    t.addEventListener('mouseenter', () => open('mouseenter'))
    t.addEventListener('touchstart', (e: Event) => {
      open('touchstart')
      e.stopPropagation()
    }, { passive: true })
    t.addEventListener('mouseleave', closeSoon)
  }
  card.addEventListener('mouseenter', cancelClose)
  card.addEventListener('mouseleave', closeSoon)

  // Defensive document-level delegation — survives React re-renders
  // that orphan per-element listeners.
  const handleDocMouseOver = (e: MouseEvent): void => {
    const target = e.target as Element | null
    if (!target) return
    if (target === host || host.contains(target)) {
      open('host-delegated')
      return
    }
    if (target instanceof HTMLElement && target.matches('span.crith-prov-underline[data-crith-prov-kind="claim"]')) {
      if (target.textContent && extraTriggers.some((t) => t.textContent === target.textContent)) {
        open('span-delegated')
      }
    }
  }
  const handleDocMouseOut = (e: MouseEvent): void => {
    const target = e.target as Element | null
    const related = e.relatedTarget as Element | null
    if (!target) return
    if (target === host || host.contains(target) ||
        (target instanceof HTMLElement && target.matches('span.crith-prov-underline'))) {
      if (related && (related === host || host.contains(related) ||
          (related instanceof HTMLElement && related.matches('span.crith-prov-underline')))) {
        return
      }
      closeSoon()
    }
  }
  document.addEventListener('mouseover', handleDocMouseOver, true)
  document.addEventListener('mouseout', handleDocMouseOut, true)

  // ── Button click handlers ──────────────────────────────────

  card.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      const action = btn.getAttribute('data-action')

      if (action !== 'useful' && action !== 'not_useful') return
      if (ratingChosen != null) return

      ratingChosen = action
      btn.classList.add('is-chosen')
      applyRatingLock()

      if (hasIds) {
        void chrome.runtime
          .sendMessage({
            type: 'LOG_EVENT',
            payload: {
              analysis_id: claim.analysis_id!,
              provocation_index: claim.claim_index!,
              event_type: action,
            },
          })
          .catch(() => { /* fire-and-forget */ })
      }

      console.log('[Crith V2] claim marked', action)
    })
  })
}
