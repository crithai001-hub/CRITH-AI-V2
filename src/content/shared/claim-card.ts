// ── content/shared/claim-card.ts ──────────────────────────────
// Card UI + state machine for verifiable claims (fact-check pipeline).
//
// View states (per-card, closure-scoped):
//   default   — claim_type chip + risk chip + claim text + why_verify;
//               buttons: [Useful] [Not useful] [Verify ↻]
//   loading   — "Verifying…" spinner; buttons disabled
//   verified  — verdict badge + evidence_summary + collapsible
//               "View N sources" <details> with source_urls;
//               Verify button is replaced by the verdict badge;
//               Useful/Not useful re-enabled
//   error     — transient inline error message for ~3s, then back
//               to default; user can retry by re-clicking Verify
//
// Verdict cache lives at module scope keyed on
// `${analysis_id}::${claim_index}` so a re-hovered card after the
// user already verified shows the verified state immediately
// without re-firing the network call.

import type {
  ApiError,
  PlatformAdapter,
  VerifiableClaim,
  Verdict,
  VerifyClaimResponse,
} from '../../shared/types'

const COLLAPSE_GRACE_MS = 200
const ERROR_DISPLAY_MS = 3000

const ERROR_KINDS: ReadonlySet<string> = new Set([
  'AUTH_REQUIRED',
  'NETWORK_ERROR',
  'QUOTA_EXCEEDED',
  'SERVER_ERROR',
  'PARSE_ERROR',
])

function isApiErrorLike(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string' &&
    ERROR_KINDS.has((value as { kind: string }).kind)
  )
}

type ClaimCardState = 'default' | 'loading' | 'verified' | 'error'

// ── Module-level adapter ref + verdict cache ─────────────────

let cardAdapter: PlatformAdapter | null = null
export function setClaimCardAdapter(adapter: PlatformAdapter | null): void {
  cardAdapter = adapter
}

const verdictCache = new Map<string, VerifyClaimResponse>()

function cacheKey(analysisId: string, claimIndex: number): string {
  return `${analysisId}::${claimIndex}`
}

// ── Visual mapping helpers ───────────────────────────────────

function verdictBadgeClass(verdict: Verdict): string {
  return `verdict-${verdict}`
}

function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'confirmed': return '✓ Confirmed'
    case 'contradicted': return '✗ Contradicted'
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
  const _verifyBtn = card.querySelector(
    'button[data-action="verify"]',
  ) as HTMLButtonElement | null
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
  const _loader = card.querySelector('.loader') as HTMLParagraphElement | null
  const _errorMsg = card.querySelector('.error-msg') as HTMLParagraphElement | null

  if (
    !_claimText || !_whyVerify || !_claimTypeBadge || !_riskBadge ||
    !_verifyBtn || !_notUsefulBtn || !_usefulBtn ||
    !_verifyResult || !_verdictBadge || !_evidence ||
    !_sourcesDetails || !_sourcesSummary || !_sourcesList ||
    !_loader || !_errorMsg
  ) {
    return
  }

  const claimText = _claimText
  const whyVerify = _whyVerify
  const claimTypeBadge = _claimTypeBadge
  const riskBadge = _riskBadge
  const verifyBtn = _verifyBtn
  const notUsefulBtn = _notUsefulBtn
  const usefulBtn = _usefulBtn
  const verifyResult = _verifyResult
  const verdictBadge = _verdictBadge
  const evidence = _evidence
  const sourcesDetails = _sourcesDetails
  const sourcesSummary = _sourcesSummary
  const sourcesList = _sourcesList
  const loader = _loader
  const errorMsg = _errorMsg

  // Populate static fields up front. These never change.
  claimTypeBadge.textContent = claim.claim_type.replace(/_/g, ' ').toUpperCase()
  riskBadge.textContent = claim.risk.toUpperCase()
  riskBadge.dataset.risk = claim.risk
  claimText.textContent = claim.claim
  whyVerify.textContent = claim.why_verify

  const hasIds =
    typeof claim.analysis_id === 'string' &&
    typeof claim.claim_index === 'number'

  // ── Per-card state ─────────────────────────────────────────

  let cardState: ClaimCardState = 'default'
  let cachedVerdict: VerifyClaimResponse | null = hasIds
    ? verdictCache.get(cacheKey(claim.analysis_id!, claim.claim_index!)) ?? null
    : null
  let collapseTimer: ReturnType<typeof setTimeout> | null = null
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  let ratingChosen: 'useful' | 'not_useful' | null = null
  let verifyFired = false

  function applyRatingLock(): void {
    if (ratingChosen != null) {
      notUsefulBtn.disabled = true
      usefulBtn.disabled = true
    }
  }

  function renderVerdict(verdict: VerifyClaimResponse): void {
    verdictBadge.textContent = verdictLabel(verdict.verdict)
    verdictBadge.className = `verdict-badge ${verdictBadgeClass(verdict.verdict)}`
    evidence.textContent = verdict.evidence_summary
    sourcesList.replaceChildren()
    for (const url of verdict.source_urls.slice(0, 5)) {
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
      verdict.source_urls.length > 0
        ? `View ${verdict.source_urls.length} source${verdict.source_urls.length === 1 ? '' : 's'}`
        : 'No sources'
    sourcesDetails.hidden = verdict.source_urls.length === 0
    sourcesDetails.open = false
  }

  function setState(state: ClaimCardState): void {
    cardState = state
    card.dataset.state = state

    if (errorTimer != null) {
      clearTimeout(errorTimer)
      errorTimer = null
    }

    switch (state) {
      case 'default': {
        loader.hidden = true
        errorMsg.hidden = true
        verifyResult.hidden = true
        verifyBtn.hidden = false
        verifyBtn.disabled = !hasIds
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        break
      }
      case 'loading': {
        loader.hidden = false
        errorMsg.hidden = true
        verifyResult.hidden = true
        verifyBtn.disabled = true
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        break
      }
      case 'verified': {
        loader.hidden = true
        errorMsg.hidden = true
        verifyResult.hidden = false
        // Verify button hidden — verdict badge inside .verify-result
        // is now the source of truth for status.
        verifyBtn.hidden = true
        verifyBtn.disabled = true
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        if (cachedVerdict) renderVerdict(cachedVerdict)
        break
      }
      case 'error': {
        loader.hidden = true
        errorMsg.hidden = false
        verifyResult.hidden = true
        verifyBtn.hidden = false
        verifyBtn.disabled = !hasIds
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        errorTimer = setTimeout(() => {
          if (cardState === 'error') setState('default')
        }, ERROR_DISPLAY_MS)
        break
      }
    }
  }

  // Restore from cache on attach if previously verified.
  if (cachedVerdict) {
    setState('verified')
  } else {
    setState('default')
  }

  // ── Hover / open-close ─────────────────────────────────────

  const open = (source: string): void => {
    console.log('[Crith V2 CLAIM CARD] open() by', source)
    if (collapseTimer != null) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
    card.classList.add('open')
  }
  const closeSoon = (): void => {
    if (collapseTimer != null) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(
      () => card.classList.remove('open'),
      COLLAPSE_GRACE_MS,
    )
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

  // Defensive document-level delegation — same pattern as validation
  // card. Survives React re-renders that orphan per-element listeners.
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

  // ── Verify handler ─────────────────────────────────────────

  async function handleVerify(): Promise<void> {
    if (verifyFired) return
    if (cardState === 'loading' || cardState === 'verified') return
    if (!hasIds) {
      console.warn('[Crith V2] verify: claim missing analysis_id or claim_index', claim)
      setState('error')
      return
    }
    const k = cacheKey(claim.analysis_id!, claim.claim_index!)
    const fromCache = verdictCache.get(k)
    if (fromCache) {
      cachedVerdict = fromCache
      setState('verified')
      return
    }

    verifyFired = true

    // Engagement event — fire-and-forget
    void chrome.runtime.sendMessage({
      type: 'LOG_EVENT',
      payload: {
        analysis_id: claim.analysis_id!,
        provocation_index: claim.claim_index!,
        event_type: 'verified',
      },
    }).catch(() => { /* fire-and-forget */ })

    setState('loading')

    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'VERIFY_CLAIM',
        payload: {
          analysis_id: claim.analysis_id!,
          claim_index: claim.claim_index!,
        },
      })) as VerifyClaimResponse | ApiError

      if (isApiErrorLike(result)) {
        // Map error kind to user-visible message
        if (result.kind === 'QUOTA_EXCEEDED') {
          errorMsg.textContent = 'Out of verifications this month.'
        } else if (result.kind === 'AUTH_REQUIRED') {
          errorMsg.textContent = 'Sign in to verify claims.'
        } else if (result.kind === 'NETWORK_ERROR') {
          errorMsg.textContent = "Couldn't verify — try later."
        } else if (result.kind === 'SERVER_ERROR') {
          errorMsg.textContent = "Couldn't verify — try later."
        } else {
          errorMsg.textContent = "Couldn't verify — try later."
        }
        verifyFired = false  // allow retry
        setState('error')
        return
      }

      if (
        result &&
        typeof result.verdict === 'string' &&
        typeof result.evidence_summary === 'string' &&
        Array.isArray(result.source_urls)
      ) {
        cachedVerdict = result
        verdictCache.set(k, result)
        setState('verified')
      } else {
        console.warn('[Crith V2] verify: unexpected response shape', result)
        errorMsg.textContent = "Couldn't verify — try later."
        verifyFired = false
        setState('error')
      }
    } catch (err) {
      console.warn('[Crith V2] verify sendMessage threw:', err)
      errorMsg.textContent = "Couldn't verify — try later."
      verifyFired = false
      setState('error')
    }
  }

  // ── Button click handlers ──────────────────────────────────

  card.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      const action = btn.getAttribute('data-action')

      if (action === 'verify') {
        void handleVerify()
        return
      }

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
