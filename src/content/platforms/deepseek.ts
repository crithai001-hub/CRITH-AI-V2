// ── platforms/deepseek.ts ─────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/deepseek.js.
// Last verified: 2026-04-30.

import { collectPriorTurns } from '../shared/dom-helpers'
import { setInputAndSend } from '../shared/send-input'
import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

// DeepSeek's design system prefixes most stable class names with `ds-`,
// but they hash structural fragments (chat layout, message wrappers)
// the same as every other platform. List is over-inclusive on
// purpose; firstMatch / direct .matches() picks the first hit.
// Diagnostic at the bottom of this file dumps which selector
// landed — paste the output if responses stop being detected.
const SEL = {
  chatContainer: [
    'main [class*="ChatBody"]',
    'main [class*="chat-body"]',
    'main [class*="conversation"]',
    'main [class*="dialog"]',
    'main',
  ],
  responseNode: [
    // ds-markdown is DeepSeek's stable class for assistant-rendered
    // markdown bodies; it's been in their bundle since 2024 and
    // survived two redesigns. Keep this first.
    '[class*="ds-markdown"]',
    '[class*="assistant-bubble"]',
    '[class*="bot-message"]',
    '[class*="ai-message"]',
    '[class*="dialog-bubble-assistant"]',
    '[data-message-author-role="assistant"]',
    '[data-message-author="assistant"]',
    '[data-testid*="assistant-message"]',
    '[data-testid*="ai-message"]',
    'div[class*="markdown-body"]',
  ],
  promptNodeForResponse: [
    '[class*="user-message"]',
    '[class*="human-bubble"]',
    '[class*="user-bubble"]',
    '[class*="dialog-bubble-user"]',
    '[class*="user-input-bubble"]',
    '[data-message-author-role="user"]',
    '[data-message-author="user"]',
    '[data-testid*="user-message"]',
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
  const m = location.pathname.match(/\/chat\/s\/([^/?#]+)/) ||
            location.pathname.match(/\/c\/([^/?#]+)/)
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

function isStreaming(_messageNode: Element): boolean {
  return !!document.querySelector(
    'button[aria-label*="Stop" i], button[aria-label*="stop" i], div[role="button"][aria-label*="Stop" i]',
  )
}

const INPUT_SELECTORS = [
  '#chat-input',
  'textarea[placeholder*="Send" i]',
  'textarea[placeholder*="message" i]',
  'div[contenteditable="true"][role="textbox"]',
  'textarea',
] as const

const SEND_BUTTON_SELECTORS = [
  // DeepSeek often uses a div[role="button"] for send instead of <button>.
  'div[role="button"][aria-label*="Send" i]',
  'button[aria-label*="Send" i]',
  'button[type="submit"]',
  '.send-button',
] as const

async function sendToInput(prompt: string): Promise<boolean> {
  return setInputAndSend(INPUT_SELECTORS, SEND_BUTTON_SELECTORS, prompt)
}

export const adapter: PlatformAdapter = {
  name: 'deepseek',
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
// Same pattern as the Perplexity + Grok adapters. Runs 4s after
// module load on chat.deepseek.com / deepseek.com. Prints which
// SEL.responseNode + SEL.promptNodeForResponse selectors hit and
// includes a few "answer-shaped" / "user-query-shaped" element
// samples so the user can paste classes back when DeepSeek's
// next bundle hashes break detection.
//
// Toggle DEBUG_DIAGNOSTIC=false once the platform is stable to
// keep prod console clean.
const DEBUG_DIAGNOSTIC = true

if (
  DEBUG_DIAGNOSTIC &&
  typeof location !== 'undefined' &&
  location.hostname.includes('deepseek.com')
) {
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
          dataAuthor:
            el.getAttribute('data-message-author') ||
            el.getAttribute('data-message-author-role'),
          textLen: (el.textContent ?? '').length,
        }))
      dump['response-shaped div samples'] = answerSamples

      const querySamples = [
        ...Array.from(document.querySelectorAll('main [data-message-author-role="user"]')),
        ...Array.from(document.querySelectorAll('main [data-message-author="user"]')),
        ...Array.from(document.querySelectorAll('main [class*="user" i]')),
        ...Array.from(document.querySelectorAll('main [class*="human" i]')),
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

      console.log('[Crith V2 PROV][deepseek diag]', dump)
    } catch (err) {
      console.warn('[Crith V2 PROV][deepseek diag] dump failed', err)
    }
  }, 4000)
}
