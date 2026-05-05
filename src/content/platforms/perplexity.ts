// ── platforms/perplexity.ts ───────────────────────────────────
// Ported verbatim from V1's provocations/platforms/perplexity.js.
// Last verified: 2026-04-30.

import { collectPriorTurns } from '../shared/dom-helpers'
import { setInputAndSend } from '../shared/send-input'
import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

// Perplexity's DOM ships through frequent CSS-module hashing renames,
// so this list is intentionally redundant. firstMatch() walks
// top-to-bottom; isResponseNode does a direct .matches() against any
// of them. If you find a new selector that lands cleanly, prepend it
// — order matters for getResponseText's "first selector descendant"
// path (it pulls innerText from the first matching descendant rather
// than the whole node, which avoids capturing sources/related tabs).
const SEL = {
  chatContainer: [
    'main [class*="ThreadContainer"]',
    'main [class*="thread"]',
    'main [data-testid*="thread"]',
    'main',
  ],
  responseNode: [
    '[class*="AnswerBody"]',
    '[class*="answerBody"]',
    '[data-testid*="answer"]',
    '[data-testid*="message-block-answer"]',
    'div[class*="MessageContent"]',
    'div[class*="markdown-body"]',
    '[class*="prose"]',
  ],
  promptNodeForResponse: [
    '[class*="UserQuery"]',
    '[class*="userQuery"]',
    '[data-testid*="user"]',
    '[data-testid*="message-block-query"]',
    '[class*="QueryText"]',
    // Perplexity 2026 typically renders the query as a heading
    // above the answer block. h1 is the most stable hit; the
    // font-display / text-3xl / text-2xl tailwind classes are
    // their query-styling fingerprint and survive renames.
    'main h1',
    '[role="heading"][aria-level="1"]',
    'div[class*="font-display"]',
    'div[class*="text-3xl"]',
    'div[class*="text-2xl"]',
    '[class*="QueryHeader"]',
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
  const m = location.pathname.match(/\/search\/([^/?#]+)/)
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
    'button[aria-label*="Stop" i], button[aria-label*="stop response" i]',
  )
}

const INPUT_SELECTORS = [
  'textarea[placeholder*="Ask" i]',
  'textarea[placeholder*="Follow" i]',
  'div[contenteditable="true"][role="textbox"]',
  'textarea',
] as const

const SEND_BUTTON_SELECTORS = [
  'button[aria-label*="Submit" i]',
  'button[aria-label*="Send" i]',
  'button[type="submit"]',
] as const

async function sendToInput(prompt: string): Promise<boolean> {
  return setInputAndSend(INPUT_SELECTORS, SEND_BUTTON_SELECTORS, prompt)
}

export const adapter: PlatformAdapter = {
  name: 'perplexity',
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
// Perplexity's class-module hashing breaks the response selectors
// roughly once a quarter. When the orchestrator boots but no
// analysis fires, the most likely cause is that none of the
// SEL.responseNode patterns match the current DOM.
//
// This dump runs 4 seconds after this module loads (giving the
// SPA time to hydrate), prints which selectors hit and which
// missed, and includes a couple of representative element class
// names so a user can paste the output back to update SEL.
//
// Removed under !DEBUG_DIAGNOSTIC to keep prod console clean
// when the platform is stable. Toggle on while iterating.
const DEBUG_DIAGNOSTIC = true

if (DEBUG_DIAGNOSTIC && typeof location !== 'undefined' && location.hostname.includes('perplexity.ai')) {
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
      // Sample the first 5 candidate "looks like an answer" classnames
      // we can find — large divs with markdown content. This helps
      // identify the new selector pattern after a redesign.
      const sample = Array.from(
        document.querySelectorAll('main div'),
      )
        .filter((el) => {
          const txt = el.textContent ?? ''
          return txt.length > 300 && el.children.length > 0
        })
        .slice(0, 5)
        .map((el) => ({
          tag: el.tagName,
          classes: (el.className || '').toString().slice(0, 200),
          dataTestid: el.getAttribute('data-testid'),
          textLen: (el.textContent ?? '').length,
        }))
      dump['answer-shaped div samples'] = sample

      // User-query candidates — short text blocks at the top of
      // the thread, often h1 or a styled heading div. We need this
      // because getPromptForResponse failing returns null which
      // drops the analyze fire entirely.
      const queryCandidates = [
        ...Array.from(document.querySelectorAll('main h1')),
        ...Array.from(document.querySelectorAll('main [role="heading"]')),
        ...Array.from(
          document.querySelectorAll('main [class*="query" i], main [data-testid*="query" i]'),
        ),
        ...Array.from(
          document.querySelectorAll('main [class*="font-display"], main [class*="text-3xl"], main [class*="text-2xl"]'),
        ),
      ]
        .filter((el, i, arr) => arr.indexOf(el) === i)
        .slice(0, 8)
        .map((el) => ({
          tag: el.tagName,
          classes: (el.className || '').toString().slice(0, 200),
          dataTestid: el.getAttribute('data-testid'),
          ariaLevel: el.getAttribute('aria-level'),
          text: (el.textContent ?? '').trim().slice(0, 80),
        }))
      dump['query-shaped candidates'] = queryCandidates

      console.log('[Crith V2 PROV][perplexity diag]', dump)
    } catch (err) {
      console.warn('[Crith V2 PROV][perplexity diag] dump failed', err)
    }
  }, 4000)
}
