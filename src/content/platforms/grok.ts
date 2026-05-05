// ── platforms/grok.ts ─────────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/grok.js.
// Grok URL is always /chat (no per-conversation slug) — getSessionId
// returns 'home' and underline-target text matching prevents
// cross-conversation logo restores. Last verified: 2026-04-30.

import { collectPriorTurns } from '../shared/dom-helpers'
import { setInputAndSend } from '../shared/send-input'
import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

// Grok ships with heavy Tailwind class usage and changes structural
// class fragments without notice. This list errs on the side of
// over-inclusion — firstMatch / direct .matches() picks the first
// hit, the rest are fallbacks for a future redesign. Boot diagnostic
// at the bottom of this file dumps which selector landed; share it
// when responses stop being detected.
const SEL = {
  chatContainer: [
    'main [class*="ChatContainer"]',
    'main [class*="ConversationContainer"]',
    'main [class*="Conversation"]',
    'main [data-testid*="conversation"]',
    'main',
  ],
  responseNode: [
    // Verified live (2026-05): both user and assistant bubbles use
    // .message-bubble, but assistant bubbles render markdown so
    // they also carry .prose. User bubbles are plain text, no
    // prose. The combined selector picks the AI side specifically
    // and doesn't trigger on user messages.
    'div[class*="message-bubble"][class*="prose"]',
    // Future-proof attribute-based selectors. xAI may add these
    // later; if they do, isResponseNode picks them up first.
    '[data-message-author-role="assistant"]',
    '[data-message-author="assistant"]',
    '[data-testid*="grok-message"]',
    '[data-testid*="assistant-message"]',
    // Legacy class fragments — kept as fallback for any older
    // build paths that still ship through.
    '[class*="BotMessage"]',
    '[class*="AssistantMessage"]',
    '[class*="response-bubble"]',
    'article[class*="response"]',
    // Removed [class*="prose"]: it substring-matches "ProseMirror"
    // (the tiptap input editor's class) AND every "prose-*"
    // tailwind utility on every styled child block, producing many
    // false-positive response nodes per real reply.
  ],
  promptNodeForResponse: [
    // Same .message-bubble wrapper used for both sides. The
    // getPromptForResponse walker takes the previous bubble in
    // sibling/ancestor order — that's the user prompt.
    'div[class*="message-bubble"]',
    '[class*="UserMessage"]',
    '[class*="HumanMessage"]',
    '[data-message-author="user"]',
    '[data-message-author-role="user"]',
    '[data-testid*="user-message"]',
    '[class*="human"]',
    'div[class*="user-message"]',
    'div[class*="UserBubble"]',
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
  // Direct match only — see chatgpt.ts for why.
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

function getPriorTurns(currentResponseNode: Element): ConversationTurn[] {
  return collectPriorTurns(
    SEL.responseNode,
    SEL.promptNodeForResponse,
    currentResponseNode,
  )
}

function isStreaming(_messageNode: Element): boolean {
  return !!document.querySelector(
    'button[aria-label*="Stop" i], button[aria-label*="stop response" i]',
  )
}

const INPUT_SELECTORS = [
  'textarea[placeholder*="Ask Grok" i]',
  'textarea[placeholder*="Ask" i]',
  'textarea[aria-label*="message" i]',
  'div[contenteditable="true"][role="textbox"]',
  'textarea',
] as const

const SEND_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'button[aria-label*="Submit" i]',
  'button[aria-label*="Send" i]',
] as const

async function sendToInput(prompt: string): Promise<boolean> {
  return setInputAndSend(INPUT_SELECTORS, SEND_BUTTON_SELECTORS, prompt)
}

export const adapter: PlatformAdapter = {
  name: 'grok',
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

// ── One-shot boot diagnostic ─────────────────────────────────
//
// Same pattern as the Perplexity adapter. Runs 4 seconds after
// module load and prints which selectors hit / missed plus
// samples of "response-shaped" and "user-query-shaped" elements
// in <main>. Paste the output back if responses stop being
// detected and we'll patch SEL with the actual class names.
const DEBUG_DIAGNOSTIC = true

if (DEBUG_DIAGNOSTIC && typeof location !== 'undefined' && location.hostname.includes('grok.com')) {
  setTimeout(() => {
    try {
      const dump: Record<string, unknown> = {
        url: location.href,
        chatContainer: !!getChatContainer(),
        responseNodes: getAllResponseNodes().length,
      }
      for (const sel of SEL.responseNode) {
        dump[`responseSel:${sel}`] = document.querySelectorAll(sel).length
      }
      for (const sel of SEL.chatContainer) {
        dump[`chatSel:${sel}`] = document.querySelectorAll(sel).length
      }
      for (const sel of SEL.promptNodeForResponse) {
        dump[`promptSel:${sel}`] = document.querySelectorAll(sel).length
      }

      // Sample answer-shaped divs: long text + nested children. The
      // first 5 ranked by text length usually surface the assistant
      // message containers regardless of class hashing.
      const answerSamples = Array.from(document.querySelectorAll('main div'))
        .filter((el) => {
          const txt = el.textContent ?? ''
          return txt.length > 200 && el.children.length > 0
        })
        .slice(0, 5)
        .map((el) => ({
          tag: el.tagName,
          classes: (el.className || '').toString().slice(0, 220),
          dataTestid: el.getAttribute('data-testid'),
          dataAuthor: el.getAttribute('data-message-author') ||
                      el.getAttribute('data-message-author-role'),
          textLen: (el.textContent ?? '').length,
        }))
      dump['response-shaped div samples'] = answerSamples

      // Sample user-query-shaped elements: short, often right-
      // aligned, with author-role data attribute or "user" in class.
      const querySamples = [
        ...Array.from(document.querySelectorAll('main [data-message-author-role="user"]')),
        ...Array.from(document.querySelectorAll('main [data-message-author="user"]')),
        ...Array.from(document.querySelectorAll('main [class*="user" i]')),
        ...Array.from(document.querySelectorAll('main [data-testid*="user" i]')),
      ]
        .filter((el, i, arr) => arr.indexOf(el) === i)
        .slice(0, 8)
        .map((el) => ({
          tag: el.tagName,
          classes: (el.className || '').toString().slice(0, 220),
          dataTestid: el.getAttribute('data-testid'),
          text: (el.textContent ?? '').trim().slice(0, 80),
        }))
      dump['query-shaped candidates'] = querySamples

      console.log('[Crith V2 PROV][grok diag]', dump)
    } catch (err) {
      console.warn('[Crith V2 PROV][grok diag] dump failed', err)
    }
  }, 4000)
}
