// ── platforms/claude.ts ───────────────────────────────────────
// Ported verbatim from V1's provocations/platforms/claude.js.
// Last verified: 2026-04-30.

import { collectPriorTurns } from '../shared/dom-helpers'
import { setInputAndSend } from '../shared/send-input'
import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

// Claude's DOM is more stable than Grok/Perplexity but still
// hashes structural class fragments occasionally. Diagnostic at
// the bottom dumps which selectors hit — paste it back if
// detection breaks again. Body is the final-fallback container so
// the observer always attaches.
const SEL = {
  chatContainer: [
    'div[class*="ChatScreen"]',
    'main div[class*="conversation"]',
    'main [data-testid*="conversation"]',
    'main',
    // Fallbacks for layouts without a <main> wrapper (Claude has
    // shipped variants without one in some A/B states).
    'div[data-testid="conversation"]',
    '[class*="ChatScreen"]',
    '[class*="conversation-thread"]',
    'body',
  ],
  // CRITICAL: every selector in this list MUST be assistant-only.
  // If a user-message wrapper matches, the orchestrator will run
  // analyze on the user's prompt as if it were an AI response,
  // produce flag anchors against prompt text, and underline parts
  // of what the user typed. That breaks the entire UX premise.
  // When in doubt, prefer narrow + specific over broad + fallback.
  responseNode: [
    'div[data-test-render-count] div[class*="font-claude-message"]',
    'div[class*="font-claude-message"]',
    'div[class*="claude-message"]',
    'div[data-testid="claude-message"]',
    'div[data-testid*="assistant-message"]',
    'div[role="article"][data-test-render-count]',
    '[data-message-author-role="assistant"]',
    // NOTE: bare div[data-test-render-count] was here as a fallback
    // — REMOVED because data-test-render-count exists on the USER's
    // bubble too, causing isResponseNode to match prompts. If the
    // current claude bundle drops font-claude-message AND
    // claude-message AND the testids/role, the diagnostic will
    // print empty hit counts and we'll add a properly assistant-
    // only anchor instead of resurrecting the bare attribute.
  ],
  promptNodeForResponse: [
    'div[data-testid="user-message"]',
    'div[class*="font-user-message"]',
    'div[class*="user-message"]',
    '[data-message-author-role="user"]',
    '[data-testid*="human-message"]',
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

// Generic streaming-done detection: any global "Stop" button on the
// page indicates some message is currently generating. Combined with
// the observer's per-node text-growth check, fires when streaming
// flips back to a Send-style state.
function isStreaming(_messageNode: Element): boolean {
  return !!document.querySelector(
    'button[aria-label*="Stop" i], button[aria-label*="stop response" i]',
  )
}

const INPUT_SELECTORS = [
  // Claude's composer is a ProseMirror contenteditable div.
  'div.ProseMirror[contenteditable="true"]',
  'fieldset div[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-label*="message" i]',
] as const

const SEND_BUTTON_SELECTORS = [
  'button[aria-label="Send Message"]',
  'button[aria-label*="Send" i]',
  'fieldset button[type="button"][aria-disabled="false"]',
] as const

async function sendToInput(prompt: string): Promise<boolean> {
  return setInputAndSend(INPUT_SELECTORS, SEND_BUTTON_SELECTORS, prompt)
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
  isStreaming,
  sendToInput,
}

// ── One-shot boot diagnostic ─────────────────────────────────
//
// Same pattern as the other platform adapters. Fires 4s after
// module load on claude.ai, prints per-selector hit counts plus
// answer-shaped + query-shaped element samples. If detection
// breaks after a Claude redesign, expand the dumped Object in
// DevTools and paste the response/query samples — that pinpoints
// the new class names.
const DEBUG_DIAGNOSTIC = true

if (
  DEBUG_DIAGNOSTIC &&
  typeof location !== 'undefined' &&
  location.hostname.includes('claude.ai')
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

      const answerSamples = Array.from(document.querySelectorAll('div'))
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
          renderCount: el.getAttribute('data-test-render-count'),
          textLen: (el.textContent ?? '').length,
        }))
      dump['response-shaped div samples'] = answerSamples

      const querySamples = [
        ...Array.from(document.querySelectorAll('[data-testid*="user" i]')),
        ...Array.from(document.querySelectorAll('[data-message-author-role="user"]')),
        ...Array.from(document.querySelectorAll('[class*="user-message" i]')),
        ...Array.from(document.querySelectorAll('[class*="font-user" i]')),
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

      // Print as a JSON string so the full contents are visible in
      // the log line itself — Chrome's console truncates inline
      // Object representations and the user has to expand them
      // manually otherwise. JSON output is copy-pasteable in one shot.
      console.log(
        '[Crith V2 PROV][claude diag]\n' + JSON.stringify(dump, null, 2),
      )
    } catch (err) {
      console.warn('[Crith V2 PROV][claude diag] dump failed', err)
    }
  }, 4000)
}
