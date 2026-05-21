// ── content/shared/card-position.ts ───────────────────────────
// Keep the hover card on-screen no matter where the underline /
// logo lands. Called from card.ts and claim-card.ts open() right
// after the .open class is applied.
//
// Three correction passes:
//   1. Vertical: if the card's bottom would extend past the
//      viewport, flip from top:32px to bottom:32px so the card
//      opens above the logo instead of below.
//   2. Horizontal: if the card's left/right edge ends up off-
//      screen, translateX to nudge it back in.
//   3. (CSS handles overflow) max-height: 80vh + overflow-y:
//      auto on .card prevents very tall cards from exceeding
//      viewport height, so even a corrected vertical flip can't
//      run past either edge.
//
// All adjustments are written to inline style on the card so a
// subsequent close() doesn't need to undo them — the next open()
// resets the styles before re-measuring.

const SAFE_MARGIN_PX = 8

/**
 * Mutate the card's inline style so its bounding rect fits inside
 * the viewport. Idempotent: clears prior overrides each call.
 */
export function clampCardToViewport(card: HTMLElement): void {
  // Clear prior overrides so the natural CSS position kicks in for
  // measurement. Without this, a flipped card from the previous
  // open() would still measure as flipped and we'd never restore
  // top-anchored when there's room.
  card.style.top = ''
  card.style.bottom = ''
  card.style.transform = ''

  // Force layout flush, then measure.
  const rect = card.getBoundingClientRect()
  const vh = window.innerHeight
  const vw = window.innerWidth

  // Pass 1: vertical flip if bottom overflows.
  if (rect.bottom > vh - SAFE_MARGIN_PX) {
    // Only flip if there's actually more room above than below.
    // Otherwise the flip just trades one overflow for another and
    // the max-height + scroll on .card handles it.
    const spaceAbove = rect.top
    const spaceBelow = vh - rect.top
    if (spaceAbove > spaceBelow) {
      card.style.top = 'auto'
      card.style.bottom = '32px'
    }
  }

  // Re-measure after the vertical change. (Width doesn't change
  // from a top/bottom flip, but a re-measure keeps the values fresh
  // in case the flip altered scroll position briefly.)
  const rect2 = card.getBoundingClientRect()

  // Pass 2: horizontal nudge.
  let dx = 0
  if (rect2.left < SAFE_MARGIN_PX) {
    dx = SAFE_MARGIN_PX - rect2.left
  } else if (rect2.right > vw - SAFE_MARGIN_PX) {
    dx = vw - SAFE_MARGIN_PX - rect2.right
  }
  if (dx !== 0) {
    card.style.transform = `translateX(${dx}px)`
  }
}
