// ── platforms/gemini.ts ───────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/gemini.js.
// Last verified: 2026-04-30.

import type { PlatformAdapter } from '../../shared/types'

const SEL = {
  chatContainer: [
    'chat-window',
    'infinite-scroller',
    'main',
  ],
  responseNode: [
    'model-response',
    '[class*="model-response"]',
    '.response-container',
  ],
  promptNodeForResponse: [
    'user-query',
    '[class*="user-query"]',
    '.query-text',
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
  let cursor: Element | null = node
  while (cursor && cursor !== document.body) {
    let prev: Element | null = cursor.previousElementSibling
    while (prev) {
      const p = prev
      const matches = SEL.promptNodeForResponse.some((s) => p.matches(s) || !!p.querySelector(s))
      if (matches) {
        let userInner: Element | null = null
        for (const s of SEL.promptNodeForResponse) {
          const inner = p.querySelector(s)
          if (inner) { userInner = inner; break }
          if (p.matches(s)) { userInner = p; break }
        }
        return ((userInner ?? p).textContent ?? '').trim()
      }
      prev = prev.previousElementSibling
    }
    cursor = cursor.parentElement
  }
  return null
}

function getSessionId(): string {
  // Gemini: /app/<id> when inside a conversation, /app or / on home.
  const m = location.pathname.match(/\/app\/([^/?#]+)/)
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
  name: 'gemini',
  getChatContainer,
  isResponseNode,
  getResponseText,
  getPromptForResponse,
  getSessionId,
  getAllResponseNodes,
}
