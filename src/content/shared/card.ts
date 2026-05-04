// ── content/shared/card.ts ────────────────────────────────────
// Hover/tap state machine for the floating logo's expand-to-card UI.
// Lives entirely inside the host's closed Shadow DOM.
//
// Card view states (per-card, closure-scoped):
//   default   — question + 3 buttons (Dismiss / Explain / Ask this →)
//   loading   — "Thinking…" indicator while EXPLAIN_PROVOCATION is in flight;
//               Explain disabled, Dismiss + Ask remain clickable
//   explained — explanation text + "← Back to question" link;
//               Explain hidden (it's already been shown);
//               Dismiss + Ask still active
//   error     — transient: question text re-shown with a 3s
//               "Couldn't explain — try again." line; all buttons re-enabled
//
// The explanation is cached on the card's local state. A second tap of
// Explain after the user navigates back does NOT re-call the backend.

import type { ApiError, ExplainResponse, PlatformAdapter, Validation } from '../../shared/types'

const COLLAPSE_GRACE_MS = 200
const ERROR_DISPLAY_MS = 3000

const ERROR_KINDS = new Set([
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

type CardState = 'default' | 'loading' | 'explained' | 'error'

/**
 * Adapter reference is optional. Card looks it up at attach time so
 * the Ask AI button knows which platform to send to. When null (e.g.
 * orchestrator hasn't found a matching adapter), the Ask AI button
 * stays disabled and clicks console.warn.
 */
let cardAdapter: PlatformAdapter | null = null
export function setCardAdapter(adapter: PlatformAdapter | null): void {
  cardAdapter = adapter
}

export function attach(
  host: HTMLElement,
  root: ShadowRoot,
  validation: Validation,
  extraTriggers: HTMLElement[],
): void {
  const _logo = root.querySelector('.crith-prov-logo') as HTMLElement | null
  const _card = root.querySelector('.card') as HTMLElement | null
  if (!_logo || !_card) return
  const logo = _logo
  const card = _card

  // Required for every card. If any of these is missing the markup is
  // broken upstream in renderer.ts — bail rather than render a partial
  // card.
  const _text = card.querySelector('.text') as HTMLParagraphElement | null
  const _notUsefulBtn = card.querySelector(
    'button[data-action="not_useful"]',
  ) as HTMLButtonElement | null
  const _usefulBtn = card.querySelector(
    'button[data-action="useful"]',
  ) as HTMLButtonElement | null
  const _askAiBtn = card.querySelector(
    'button[data-action="ask_ai"]',
  ) as HTMLButtonElement | null

  if (!_text || !_notUsefulBtn || !_usefulBtn || !_askAiBtn) {
    return
  }

  // Optional — left over from the now-removed Explain feature. The
  // renderer still creates these elements (back-link, loader,
  // error-msg) but no code path activates them. Kept as nullable
  // refs so future re-introduction of an Explain affordance doesn't
  // require re-querying.
  const _backLink = card.querySelector('.back-link') as HTMLAnchorElement | null
  const _loader = card.querySelector('.loader') as HTMLParagraphElement | null
  const _errorMsg = card.querySelector('.error-msg') as HTMLParagraphElement | null

  // Re-bind to fresh consts so the closures defined below capture the
  // narrowed (non-null) types. TS doesn't preserve narrowing across
  // closures via the original variables alone.
  const text = _text
  const notUsefulBtn = _notUsefulBtn
  const usefulBtn = _usefulBtn
  const askAiBtn = _askAiBtn
  const loader = _loader
  const errorMsg = _errorMsg
  const backLink = _backLink

  const problemText = (validation.problem || '').slice(0, 320)
  const followUpPrompt = validation.follow_up_prompt || ''
  const hasIds =
    typeof validation.analysis_id === 'string' &&
    typeof validation.provocation_index === 'number'

  // Ask AI is disabled when:
  //   - the validation is from a legacy provocations response (no
  //     follow_up_prompt) — empty string check
  //   - the active platform adapter doesn't implement sendToInput
  //     (every adapter except chatgpt currently)
  // Either case: no useful click target. Surface as a disabled button
  // rather than a click that no-ops silently.
  const askAiAvailable =
    followUpPrompt.length > 0 &&
    cardAdapter != null &&
    typeof cardAdapter.sendToInput === 'function'

  // ── Per-card state (closure-scoped — each card is independent) ──

  let cardState: CardState = 'default'
  let cachedExplanation: string | null = null
  let collapseTimer: ReturnType<typeof setTimeout> | null = null
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Locks the rating buttons after the user picks one. The card stays
   * accessible via hover after rating — only the rating buttons get
   * disabled. We no longer set a global "handled" flag that blocks
   * the card from opening again, so the user can re-read the
   * provocation any time.
   */
  let ratingChosen: 'useful' | 'not_useful' | null = null

  function applyRatingLock(): void {
    if (ratingChosen != null) {
      notUsefulBtn.disabled = true
      usefulBtn.disabled = true
    }
  }

  /**
   * The Ask AI flag works like a one-shot terminal action. After the
   * user clicks Ask AI we never want them to re-click it (that would
   * fire the same prompt to the chat twice). We also disable it when
   * the platform doesn't support input targeting OR the validation has
   * no follow_up_prompt.
   */
  let askAiFired = false
  function applyAskAiState(): void {
    askAiBtn.disabled = !askAiAvailable || askAiFired
    if (!askAiAvailable && !followUpPrompt) {
      askAiBtn.title = 'No follow-up prompt available for this validation'
    } else if (!askAiAvailable) {
      askAiBtn.title = `Ask AI not yet supported on ${cardAdapter?.name ?? 'this platform'}`
    }
  }

  function setState(state: CardState): void {
    cardState = state
    card.dataset.state = state

    if (errorTimer != null) {
      clearTimeout(errorTimer)
      errorTimer = null
    }

    // The 'loading' / 'explained' / 'error' states only fire from the
    // Explain flow which is no longer wired (button removed). They're
    // kept here for re-introduction; in practice only 'default' runs.
    switch (state) {
      case 'default': {
        text.textContent = problemText
        text.hidden = false
        if (loader) loader.hidden = true
        if (errorMsg) errorMsg.hidden = true
        if (backLink) backLink.hidden = true
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        applyAskAiState()
        break
      }
      case 'loading': {
        text.hidden = true
        if (loader) loader.hidden = false
        if (errorMsg) errorMsg.hidden = true
        if (backLink) backLink.hidden = true
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        applyAskAiState()
        break
      }
      case 'explained': {
        text.textContent = cachedExplanation ?? ''
        text.hidden = false
        if (loader) loader.hidden = true
        if (errorMsg) errorMsg.hidden = true
        if (backLink) backLink.hidden = false
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        applyAskAiState()
        break
      }
      case 'error': {
        text.textContent = problemText
        text.hidden = false
        if (loader) loader.hidden = true
        if (errorMsg) errorMsg.hidden = false
        if (backLink) backLink.hidden = true
        notUsefulBtn.disabled = false
        usefulBtn.disabled = false
        applyRatingLock()
        applyAskAiState()
        errorTimer = setTimeout(() => {
          if (cardState === 'error') setState('default')
        }, ERROR_DISPLAY_MS)
        break
      }
    }
  }

  setState('default')

  // ── Hover/tap → open/close ──────────────────────────────────

  const open = (source: string): void => {
    console.log('[Crith V2 CARD] open() called by', source)
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

  // ── Defensive fallback: document-level event delegation ─────
  //
  // Per-element listeners above are the primary path, but they break
  // when ChatGPT's React re-renders the assistant message and replaces
  // our underline span DOM. The capturing document-level handler
  // catches mouseover events that bubble up from any descendant of
  // the host (covers the logo) OR any element whose textContent
  // matches one of our underline targets (covers re-rendered spans
  // even with new identity). Cheap and idempotent — calling
  // open('delegated') when the card is already open is a no-op.
  const handleDocMouseOver = (e: MouseEvent): void => {
    const target = e.target as Element | null
    if (!target) return
    // Hover within the host itself (logo, card, etc.)?
    if (target === host || host.contains(target)) {
      open('host-delegated')
      return
    }
    // Hover on one of the underline spans we created (or React's
    // replacement that has the same data attribute + text)?
    if (target instanceof HTMLElement && target.matches('span.crith-prov-underline[data-crith-prov="underline"]')) {
      // Match by anchored_to text — we can't trust span identity across
      // re-renders, but ChatGPT can't replace the text content without
      // breaking the visible underline.
      if (target.textContent && extraTriggers.some((t) => t.textContent === target.textContent)) {
        open('span-delegated')
      }
    }
  }
  const handleDocMouseOut = (e: MouseEvent): void => {
    const target = e.target as Element | null
    const related = e.relatedTarget as Element | null
    if (!target) return
    // Leaving the host or an underline span, AND not entering another
    // related trigger? Schedule a close.
    if (target === host || host.contains(target) ||
        (target instanceof HTMLElement && target.matches('span.crith-prov-underline'))) {
      // Don't close if we're moving into another relevant element
      if (related && (related === host || host.contains(related) ||
          (related instanceof HTMLElement && related.matches('span.crith-prov-underline')))) {
        return
      }
      closeSoon()
    }
  }
  document.addEventListener('mouseover', handleDocMouseOver, true)
  document.addEventListener('mouseout', handleDocMouseOut, true)

  // ── Explain handler ─────────────────────────────────────────

  async function handleExplain(): Promise<void> {
    if (cardState === 'loading') return
    if (!hasIds) {
      console.warn(
        '[Crith V2] explain: validation missing analysis_id or provocation_index',
        validation,
      )
      setState('error')
      return
    }

    // Cache hit — don't re-call the backend.
    if (cachedExplanation !== null) {
      setState('explained')
      return
    }

    // Engagement event (fire-and-forget). Only fired the first time
    // Explain is tapped per provocation per session — subsequent taps
    // hit the cache branch above.
    void chrome.runtime
      .sendMessage({
        type: 'LOG_EVENT',
        payload: {
          analysis_id: validation.analysis_id as string,
          provocation_index: validation.provocation_index as number,
          event_type: 'explained',
        },
      })
      .catch(() => { /* fire-and-forget */ })

    setState('loading')

    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'EXPLAIN_PROVOCATION',
        payload: {
          analysis_id: validation.analysis_id as string,
          provocation_index: validation.provocation_index as number,
        },
      })) as ExplainResponse | ApiError

      if (isApiErrorLike(result)) {
        // v14+ analyses: backend's /api/explain-provocation returns 404
        // because it still reads the legacy `provocations` column. The
        // problem field on the validation already does most of what
        // explain was for, so 404 is treated as "no extra detail" — we
        // surface that as the cached explanation instead of an error.
        if (result.kind === 'SERVER_ERROR' && (result as { status?: number }).status === 404) {
          cachedExplanation =
            'No extra detail available for this validation. The card text above is the full ' +
            'description of what to push back on.'
          setState('explained')
          return
        }
        console.warn('[Crith V2] explain failed:', result)
        setState('error')
        return
      }
      if (typeof result?.explanation === 'string' && result.explanation.length > 0) {
        cachedExplanation = result.explanation
        setState('explained')
      } else {
        console.warn('[Crith V2] explain returned unexpected shape:', result)
        setState('error')
      }
    } catch (err) {
      console.warn('[Crith V2] explain sendMessage threw:', err)
      setState('error')
    }
  }

  // ── Ask AI handler ──────────────────────────────────────────

  async function handleAskAi(): Promise<void> {
    if (askAiFired) return
    if (!askAiAvailable) {
      console.warn(
        '[Crith V2] ask_ai unavailable',
        { followUpPromptLen: followUpPrompt.length, platform: cardAdapter?.name },
      )
      return
    }

    askAiFired = true
    applyAskAiState()

    // Engagement event — fire-and-forget. Backend (v14+) accepts
    // 'asked_ai'; older deploys 400 the request, which the SW logs and
    // moves on. Either way the user-visible flow continues.
    if (hasIds) {
      void chrome.runtime
        .sendMessage({
          type: 'LOG_EVENT',
          payload: {
            analysis_id: validation.analysis_id as string,
            provocation_index: validation.provocation_index as number,
            event_type: 'asked_ai',
          },
        })
        .catch(() => { /* fire-and-forget */ })
    }

    console.log(
      '[Crith V2] ask AI:',
      JSON.stringify({
        prov_id: validation.provocation_id,
        prompt_chars: followUpPrompt.length,
      }),
    )

    // Close the card before triggering — feels snappier and matches the
    // user's mental model that they've now "sent" the question.
    card.classList.remove('open')
    logo.classList.add('handled')

    const ok = await cardAdapter!.sendToInput(followUpPrompt)
    if (!ok) {
      console.warn('[Crith V2] ask_ai: sendToInput returned false — input/send-button selector likely drifted')
    }
  }

  // ── Back-to-question handler ────────────────────────────────
  // Only wires up if the back-link element exists (it does, the
  // renderer still creates it) but tolerates a future markup change
  // that might drop it.

  if (backLink) {
    backLink.addEventListener('click', (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      setState('default')
    })
  }

  // ── Button click handlers ───────────────────────────────────

  card.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      const action = btn.getAttribute('data-action')

      if (action === 'explain') {
        void handleExplain()
        return
      }

      if (action === 'ask_ai') {
        void handleAskAi()
        return
      }

      // Useful / Not useful — rating actions. Once chosen the rating is
      // locked (both buttons disabled, chosen button gets a check
      // glyph) but the card itself stays accessible: hovering the logo
      // reopens it so the user can re-read the validation at any time.
      if (action !== 'useful' && action !== 'not_useful') return
      if (ratingChosen != null) return

      ratingChosen = action
      btn.classList.add('is-chosen')
      applyRatingLock()

      // Fire engagement event (fire-and-forget). Backend's /api/events
      // must accept event_type='useful' and 'not_useful'.
      if (hasIds) {
        void chrome.runtime
          .sendMessage({
            type: 'LOG_EVENT',
            payload: {
              analysis_id: validation.analysis_id as string,
              provocation_index: validation.provocation_index as number,
              event_type: action,
            },
          })
          .catch(() => { /* fire-and-forget */ })
      }

      if (action === 'useful') {
        console.log('[Crith V2] marked useful:', validation.provocation_id)
      } else {
        console.log('[Crith V2] marked not useful:', validation.provocation_id)
      }
    })
  })
}
