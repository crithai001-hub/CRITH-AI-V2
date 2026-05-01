// ── platforms/grok.ts ─────────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/grok.js.
// Grok URL is always /chat (no per-conversation slug) — getSessionId
// returns 'home' and underline-target text matching prevents
// cross-conversation logo restores. Last verified: 2026-04-30.

import type { PlatformAdapter } from '../../shared/types'

const SEL = {
  chatContainer: [
    'main [class*="ChatContainer"]',
    'main [class*="ConversationContainer"]',
    'main [class*="Conversation"]',
    'main',
  ],
  responseNode: [
    '[class*="BotMessage"]',
    '[class*="AssistantMessage"]',
    '[data-message-author="assistant"]',
    '[class*="response-bubble"]',
  ],
  promptNodeForResponse: [
    '[class*="UserMessage"]',
    '[class*="HumanMessage"]',
    '[data-message-author="user"]',
    '[class*="human"]',
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
  return 'home'
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
  name: 'grok',
  getChatContainer,
  isResponseNode,
  getResponseText,
  getPromptForResponse,
  getSessionId,
  getAllResponseNodes,
}
