// ── content/shared/card.ts ────────────────────────────────────
// Hover/tap state machine for the floating logo's expand-to-card UI.
// Lives entirely inside the host's closed Shadow DOM.
//
// V1 → V2: dropped the in-card type label injection (V2 shows lens
// solely via the colored dot on the logo). Replaced V1's three buttons
// (Dismiss/Useful/NotUseful → generator.react) with V2's two (Ask this/
// Dismiss → console.log placeholders). State machine itself is verbatim.

import type { Provocation } from '../../shared/types'

const COLLAPSE_GRACE_MS = 200

/**
 * Wire up hover/tap → open/close + button click handlers for one host.
 *
 * @param host  the <crith-prov-host> element (positioning anchor)
 * @param root  the closed shadow root that owns logo + card
 * @param provocation  the full provocation; question text is read by
 *                     the "Ask this →" button's click handler
 * @param extraTriggers  the wrapped underline spans — they extend the
 *                       hover surface to the underlined phrase itself
 *                       so the user can read the provocation by hovering
 *                       the text instead of hunting for the logo
 */
export function attach(
  host: HTMLElement,
  root: ShadowRoot,
  provocation: Provocation,
  extraTriggers: HTMLElement[],
): void {
  const logo = root.querySelector('.crith-prov-logo') as HTMLElement | null
  const card = root.querySelector('.card') as HTMLElement | null
  if (!logo || !card) return

  let collapseTimer: ReturnType<typeof setTimeout> | null = null
  let handled = false

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

  card.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      if (handled) return
      const action = btn.getAttribute('data-action')
      handled = true
      card.classList.remove('open')
      logo.classList.add('handled')

      // V2 placeholder handlers — real send-back behavior wires in a
      // later step.
      if (action === 'ask') {
        console.log('[Crith V2] ask this:', provocation.question)
      } else if (action === 'dismiss') {
        console.log('[Crith V2] dismissed:', provocation.provocation_id)
      }
    })
  })
}
