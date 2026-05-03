// ── platforms/chatgpt.ts ──────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/chatgpt.js.
// Selectors use ARRAYS of fallbacks so a single UI change does not
// silently disable the feature. Last verified: 2026-04-30.

import { collectPriorTurns } from '../shared/dom-helpers'
import { setInputAndSend } from '../shared/send-input'
import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

const SEL = {
  chatContainer: [
    'main div[class*="conversation"]',
    'main',
    '#__next main',
  ],
  // Canonical selector only. The previous fallbacks (testid +
  // [class*="agent-turn"]) were causing false positives — matching
  // user-message wrappers that happened to share class fragments,
  // which tied the per-node poller to text that never streams. The
  // data-message-author-role attribute has been stable on ChatGPT
  // for years and is the single most reliable signal.
  responseNode: [
    '[data-message-author-role="assistant"]',
  ],
  promptNodeForResponse: [
    // Current ChatGPT (~2026): user message text lives inside this testid
    // and its textContent excludes the "Show more"/"Show less" toggle
    // siblings, so it's the cleanest extraction point.
    '[data-testid="collapsible-user-message-content"]',
    // Wrapper fallback — picked up if the testid is renamed but the
    // semantic class survives.
    '[class*="user-message-bubble-color"]',
    // Legacy attributes — kept so older / A-B'd ChatGPT builds and any
    // chat.openai.com surface still ships the old DOM.
    '[data-message-author-role="user"]',
    'div[data-testid^="conversation-turn-"][data-author="user"]',
    'div[class*="user-turn"]',
  ],
} as const

function firstMatch(selectors: readonly string[], root: ParentNode = document): Element | null {
  for (const s of selectors) {
    const el = root.querySelector(s)
    if (el) return el
  }
  return null
}

function getChatContainer(): Element | null {
  return firstMatch(SEL.chatContainer)
}

function isResponseNode(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false
  // Direct match only. The previous `|| !!node.querySelector(s)` half
  // returned true for outer wrappers that CONTAIN an assistant message,
  // and the observer would attach to the wrapper. textContent on the
  // wrapper includes UI siblings (action buttons, reasoning panels,
  // "Continue generating") that keep mutating after the response itself
  // stabilizes — so the text-stability poller never fired and we hit
  // MAX_WAIT_MS abandonment. The else-branch in observer.handleAddedNode
  // still descends into wrapper subtrees to find the canonical
  // assistant element, so we don't lose detection.
  return SEL.responseNode.some((s) => node.matches(s))
}

function getResponseText(node: Element): string {
  let target: Element = node
  const firstSel = SEL.responseNode[0]
  if (firstSel && !node.matches(firstSel)) {
    target = firstMatch(SEL.responseNode, node) ?? node
  }
  return (target.textContent ?? '').trim()
}

function getPromptForResponse(node: Element): string | null {
  // Resolve to the actual assistant element — `node` may be a wrapper
  // matched via querySelector rather than the assistant itself.
  let assistantEl: Element | null = null
  for (const s of SEL.responseNode) {
    if (node.matches(s)) { assistantEl = node; break }
    const found = node.querySelector(s)
    if (found) { assistantEl = found; break }
  }
  if (!assistantEl) return null

  // Document-order search. The previous algorithm walked back via
  // previousElementSibling, which broke when ChatGPT changed their DOM
  // to nest user + assistant in a shared wrapper.
  const all: Element[] = []
  const seen = new Set<Element>()
  for (const s of SEL.promptNodeForResponse) {
    document.querySelectorAll(s).forEach((el) => {
      if (!seen.has(el)) { seen.add(el); all.push(el) }
    })
  }
  if (all.length === 0) return null
  const innermost = all.filter(
    (el) => !all.some((o) => o !== el && el.contains(o)),
  )

  let best: Element | null = null
  for (const userEl of innermost) {
    const pos = assistantEl.compareDocumentPosition(userEl)
    if (!(pos & Node.DOCUMENT_POSITION_PRECEDING)) continue
    if (pos & Node.DOCUMENT_POSITION_CONTAINS) continue
    if (!best) { best = userEl; continue }
    const bestVsUser = best.compareDocumentPosition(userEl)
    if (bestVsUser & Node.DOCUMENT_POSITION_FOLLOWING) best = userEl
  }
  if (!best) return null
  return (best.textContent ?? '').trim()
}

function getSessionId(): string {
  const m = location.pathname.match(/\/c\/([0-9a-f-]+)/i)
  return m && m[1] ? m[1] : 'home'
}

function getAllResponseNodes(): Element[] {
  const out: Element[] = []
  const seen = new WeakSet<Element>()
  for (const sel of SEL.responseNode) {
    document.querySelectorAll(sel).forEach((m) => {
      if (seen.has(m)) return
      seen.add(m)
      out.push(m)
    })
  }
  return out
}

function getPriorTurns(currentResponseNode: Element): ConversationTurn[] {
  return collectPriorTurns(
    SEL.responseNode,
    SEL.promptNodeForResponse,
    currentResponseNode,
  )
}

/**
 * True while ChatGPT is generating into `messageNode`. Multiple signals
 * checked in order of specificity:
 *   1. Per-message `.result-streaming` class (legacy + most specific)
 *   2. Per-message `[data-streaming="true"]` attribute (newer pattern)
 *   3. Global stop-button presence — proxy for "some message on the
 *      page is streaming". Loose, but combined with the observer's
 *      per-node text-growth check, good enough to catch ChatGPT's
 *      current DOM.
 */
function isStreaming(messageNode: Element): boolean {
  if (messageNode.matches('.result-streaming')) return true
  if (messageNode.querySelector('.result-streaming')) return true
  if (messageNode.matches('[data-streaming="true"]')) return true
  if (messageNode.querySelector('[data-streaming="true"]')) return true

  // Global stop-button. Present from streaming-start through
  // streaming-end; flips back to "send" button afterward. Multiple
  // selector forms cover ChatGPT's UI variants.
  const stopButton = document.querySelector(
    '[data-testid="stop-button"], button[aria-label*="Stop generating" i], button[aria-label*="Stop streaming" i]',
  )
  return !!stopButton
}

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'textarea[data-id="root"]',
  'textarea[placeholder*="Message" i]',
  'div[contenteditable="true"]#prompt-textarea',
  'div[contenteditable="true"][role="textbox"]',
] as const

const SEND_BUTTON_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label*="Send message" i]',
  'button[aria-label*="Send prompt" i]',
] as const

async function sendToInput(prompt: string): Promise<boolean> {
  return setInputAndSend(INPUT_SELECTORS, SEND_BUTTON_SELECTORS, prompt)
}

export const adapter: PlatformAdapter = {
  name: 'chatgpt',
  getChatContainer,
  isResponseNode,
  getResponseText,
  getPromptForResponse,
  getSessionId,
  getAllResponseNodes,
  getPriorTurns,
  isStreaming,
  sendToInput,
}
