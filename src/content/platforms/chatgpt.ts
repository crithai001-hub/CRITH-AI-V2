// ── platforms/chatgpt.ts ──────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/chatgpt.js.
// Selectors use ARRAYS of fallbacks so a single UI change does not
// silently disable the feature. Last verified: 2026-04-30.

import type { PlatformAdapter } from '../../shared/types'

const SEL = {
  chatContainer: [
    'main div[class*="conversation"]',
    'main',
    '#__next main',
  ],
  responseNode: [
    '[data-message-author-role="assistant"]',
    'div[data-testid^="conversation-turn-"][data-author="assistant"]',
    'div[class*="agent-turn"]',
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
  return SEL.responseNode.some((s) => node.matches(s) || !!node.querySelector(s))
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

export const adapter: PlatformAdapter = {
  name: 'chatgpt',
  getChatContainer,
  isResponseNode,
  getResponseText,
  getPromptForResponse,
  getSessionId,
  getAllResponseNodes,
}
