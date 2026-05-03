// ── content/shared/dom-helpers.ts ─────────────────────────────
// Shared DOM utilities used across platform adapters.

import type { ConversationTurn } from '../../shared/types'

const DEFAULT_MAX_TURNS = 6
const DEFAULT_MAX_CHARS_PER_TURN = 1500

/**
 * Walk the page DOM and extract prior turns of the conversation that
 * led up to `currentResponseNode`. Returns the turns in oldest-first
 * order.
 *
 * Caps mirror the backend's `lib/validate-history.ts` exactly so the
 * extension's `priorTurns` / `priorChars` log values match what the
 * server records on `response_analyses`:
 *   - last `maxTurns` turns (default 6)
 *   - each `content` capped at `maxCharsPerTurn` chars (default 1500),
 *     truncated with a trailing `[...]` marker
 *   - turns with empty content (after `.trim()`) are dropped
 *
 * Robust to:
 *   - outer/inner wrapper duplication (innermost-only filter — same
 *     pattern as `getPromptForResponse` in each adapter)
 *   - currentResponseNode being a wrapper around the actual message
 *     div (matched via `contains` in either direction)
 *   - currentResponseNode not being found at all (returns last
 *     `maxTurns` candidates as a best-effort fallback)
 */
export function collectPriorTurns(
  assistantSelectors: readonly string[],
  userSelectors: readonly string[],
  currentResponseNode: Element,
  options: { maxTurns?: number; maxCharsPerTurn?: number } = {},
): ConversationTurn[] {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
  const maxCharsPerTurn = options.maxCharsPerTurn ?? DEFAULT_MAX_CHARS_PER_TURN

  const candidates: Array<{ el: Element; role: 'user' | 'assistant' }> = []
  const seen = new Set<Element>()

  for (const sel of assistantSelectors) {
    document.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return
      seen.add(el)
      candidates.push({ el, role: 'assistant' })
    })
  }
  for (const sel of userSelectors) {
    document.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return
      seen.add(el)
      candidates.push({ el, role: 'user' })
    })
  }

  // Drop wrappers that contain another candidate. Keeps the innermost
  // message div and discards the outer turn-wrapper that would
  // otherwise produce a duplicate (and the same fix the existing
  // getPromptForResponse logic uses for ChatGPT's nested DOM).
  const innermost = candidates.filter(
    ({ el }) => !candidates.some(({ el: o }) => o !== el && el.contains(o)),
  )

  // Sort by document order — oldest-first reading order.
  innermost.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el)
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })

  // Find currentResponseNode's position in the sorted list. It might
  // BE one of the candidates, contain one, or be contained by one.
  let cutoffIdx = innermost.length
  for (let i = 0; i < innermost.length; i++) {
    const { el } = innermost[i]!
    if (
      el === currentResponseNode ||
      currentResponseNode.contains(el) ||
      el.contains(currentResponseNode)
    ) {
      cutoffIdx = i
      break
    }
  }

  return innermost
    .slice(0, cutoffIdx)
    .slice(-maxTurns)
    .map(({ el, role }) => {
      let content = ((el as HTMLElement).textContent ?? '').trim()
      if (content.length > maxCharsPerTurn) {
        content = content.slice(0, maxCharsPerTurn) + '[...]'
      }
      return { role, content }
    })
    .filter((t) => t.content.length > 0)
}
