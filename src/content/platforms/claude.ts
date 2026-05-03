// ── platforms/claude.ts ───────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/claude.js.
// Last verified: 2026-04-30.

import { collectPriorTurns } from '../shared/dom-helpers'
import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

const SEL = {
  chatContainer: [
    'div[class*="ChatScreen"]',
    'main div[class*="conversation"]',
    'main',
  ],
  responseNode: [
    'div[data-test-render-count] div[class*="font-claude-message"]',
    'div[class*="font-claude-message"]',
    'div[class*="claude-message"]',
  ],
  promptNodeForResponse: [
    'div[data-testid="user-message"]',
    'div[class*="font-user-message"]',
    'div[class*="user-message"]',
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
  // Direct match only — see chatgpt.ts for why. The else-branch in
  // observer.handleAddedNode still finds canonical via descendant scan.
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
  let assistantEl: Element | null = null
  for (const s of SEL.responseNode) {
    if (node.matches(s)) { assistantEl = node; break }
    const found = node.querySelector(s)
    if (found) { assistantEl = found; break }
  }
  if (!assistantEl) return null

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
  const m = location.pathname.match(/\/chat\/([0-9a-f-]+)/i)
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

export const adapter: PlatformAdapter = {
  name: 'claude',
  getChatContainer,
  isResponseNode,
  getResponseText,
  getPromptForResponse,
  getSessionId,
  getAllResponseNodes,
  getPriorTurns,
}
