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

import type { ApiError, ExplainResponse, Provocation } from '../../shared/types'

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

export function attach(
  host: HTMLElement,
  root: ShadowRoot,
  provocation: Provocation,
  extraTriggers: HTMLElement[],
): void {
  const _logo = root.querySelector('.crith-prov-logo') as HTMLElement | null
  const _card = root.querySelector('.card') as HTMLElement | null
  if (!_logo || !_card) return
  const logo = _logo
  const card = _card

  const _text = card.querySelector('.text') as HTMLParagraphElement | null
  const _loader = card.querySelector('.loader') as HTMLParagraphElement | null
  const _errorMsg = card.querySelector('.error-msg') as HTMLParagraphElement | null
  const _backLink = card.querySelector('.back-link') as HTMLAnchorElement | null
  const _explainBtn = card.querySelector(
    'button[data-action="explain"]',
  ) as HTMLButtonElement | null
  const _dismissBtn = card.querySelector(
    'button[data-action="dismiss"]',
  ) as HTMLButtonElement | null
  const _askBtn = card.querySelector(
    'button[data-action="ask"]',
  ) as HTMLButtonElement | null

  if (!_text || !_loader || !_errorMsg || !_backLink || !_explainBtn || !_dismissBtn || !_askBtn) {
    return
  }

  // Re-bind to fresh consts so the closures defined below capture the
  // narrowed (non-null) types. TS doesn't preserve narrowing across
  // closures via the original variables alone.
  const text = _text
  const loader = _loader
  const errorMsg = _errorMsg
  const backLink = _backLink
  const explainBtn = _explainBtn
  const dismissBtn = _dismissBtn
  const askBtn = _askBtn

  const questionText = (provocation.question || '').slice(0, 220)
  const hasIds =
    typeof provocation.analysis_id === 'string' &&
    typeof provocation.provocation_index === 'number'

  // ── Per-card state (closure-scoped — each card is independent) ──

  let cardState: CardState = 'default'
  let cachedExplanation: string | null = null
  let collapseTimer: ReturnType<typeof setTimeout> | null = null
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  let handled = false

  function setState(state: CardState): void {
    cardState = state
    card.dataset.state = state

    if (errorTimer != null) {
      clearTimeout(errorTimer)
      errorTimer = null
    }

    switch (state) {
      case 'default': {
        text.textContent = questionText
        text.hidden = false
        loader.hidden = true
        errorMsg.hidden = true
        backLink.hidden = true
        explainBtn.hidden = false
        explainBtn.disabled = !hasIds
        dismissBtn.disabled = false
        askBtn.disabled = false
        break
      }
      case 'loading': {
        // Hide question; show "Thinking…". Dismiss + Ask remain
        // clickable so the user can bail out at any time.
        text.hidden = true
        loader.hidden = false
        errorMsg.hidden = true
        backLink.hidden = true
        explainBtn.disabled = true
        dismissBtn.disabled = false
        askBtn.disabled = false
        break
      }
      case 'explained': {
        text.textContent = cachedExplanation ?? ''
        text.hidden = false
        loader.hidden = true
        errorMsg.hidden = true
        backLink.hidden = false
        explainBtn.hidden = true
        explainBtn.disabled = true
        dismissBtn.disabled = false
        askBtn.disabled = false
        break
      }
      case 'error': {
        // Functionally the same UI as 'default' plus a transient
        // error line. Auto-revert after ERROR_DISPLAY_MS so the line
        // doesn't persist if the user tries again immediately.
        text.textContent = questionText
        text.hidden = false
        loader.hidden = true
        errorMsg.hidden = false
        backLink.hidden = true
        explainBtn.hidden = false
        explainBtn.disabled = !hasIds
        dismissBtn.disabled = false
        askBtn.disabled = false
        errorTimer = setTimeout(() => {
          if (cardState === 'error') setState('default')
        }, ERROR_DISPLAY_MS)
        break
      }
    }
  }

  setState('default')

  // ── Hover/tap → open/close (unchanged from prior impl) ──────

  const open = (): void => {
    if (handled) return
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
    t.addEventListener('mouseenter', open)
    t.addEventListener('touchstart', (e: Event) => {
      open()
      e.stopPropagation()
    }, { passive: true })
    t.addEventListener('mouseleave', closeSoon)
  }
  card.addEventListener('mouseenter', cancelClose)
  card.addEventListener('mouseleave', closeSoon)

  // ── Explain handler ─────────────────────────────────────────

  async function handleExplain(): Promise<void> {
    if (cardState === 'loading') return
    if (!hasIds) {
      console.warn(
        '[Crith V2] explain: provocation missing analysis_id or provocation_index',
        provocation,
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
          analysis_id: provocation.analysis_id as string,
          provocation_index: provocation.provocation_index as number,
          event_type: 'explained',
        },
      })
      .catch(() => { /* fire-and-forget */ })

    setState('loading')

    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'EXPLAIN_PROVOCATION',
        payload: {
          analysis_id: provocation.analysis_id as string,
          provocation_index: provocation.provocation_index as number,
        },
      })) as ExplainResponse | ApiError

      if (isApiErrorLike(result)) {
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

  // ── Back-to-question handler ────────────────────────────────

  backLink.addEventListener('click', (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    setState('default')
  })

  // ── Button click handlers ───────────────────────────────────

  card.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      const action = btn.getAttribute('data-action')

      if (action === 'explain') {
        void handleExplain()
        return
      }

      // Dismiss / Ask — terminal actions for this card.
      if (handled) return
      handled = true
      card.classList.remove('open')
      logo.classList.add('handled')

      if (action === 'ask') {
        console.log('[Crith V2] ask this:', provocation.question)
      } else if (action === 'dismiss') {
        console.log('[Crith V2] dismissed:', provocation.provocation_id)
      }
    })
  })
}
