// ── content/shared/prov-orchestrator.ts ───────────────────────
// Manifest content-script entry. Runs on every supported platform.
//
// Responsibilities (V2 mock phase):
//   1. Detect platform from hostname → pick the right adapter
//   2. Set --crith-prov-color on <html> (inherits through shadow DOM
//      to the logo, and through page DOM to the underline)
//   3. Boot the observer with a mock provocation generator that cycles
//      through three lens states (hidden_assumption / sycophancy /
//      hallucination) so all three render variants get exercised
//   4. Watch for SPA URL change → tear down + restart so messages
//      from the previous chat don't leak into the next one
//
// Auth/login/quota/feature-flag gates from V1 are intentionally absent
// in this phase. Just always run if a platform adapter matches.

import * as observer from './observer'
import { show as rendererShow } from './renderer'
import { adapter as chatgptAdapter } from '../platforms/chatgpt'
import { adapter as claudeAdapter } from '../platforms/claude'
import { adapter as geminiAdapter } from '../platforms/gemini'
import { adapter as perplexityAdapter } from '../platforms/perplexity'
import { adapter as grokAdapter } from '../platforms/grok'
import { adapter as deepseekAdapter } from '../platforms/deepseek'
import { isApiError } from '../../shared/api-client'
import type {
  AnalyzeResponse,
  ApiError,
  ConversationTurn,
  Lens,
  Platform,
  PlatformAdapter,
  Provocation,
} from '../../shared/types'

const DEBUG = true
const LOG_PREFIX = '[Crith V2 PROV]'
function log(...args: unknown[]): void {
  if (DEBUG) console.log(LOG_PREFIX, ...args)
}

/**
 * Per-platform brand color. Mirrors V1's PLATFORM_COLORS so the
 * underline + logo + pulse share the platform's accent. Set on
 * documentElement at boot; CSS custom properties pierce the shadow DOM
 * boundary so the closed shadow root reads it via `var()`.
 */
const PLATFORM_COLORS: Record<string, string> = {
  chatgpt:    '#10A37F',
  claude:     '#D97757',
  gemini:     '#4285F4',
  perplexity: '#20B8CD',
  grok:       '#E5E5E5',
  deepseek:   '#4D6BFE',
}

function detectAdapter(): PlatformAdapter | null {
  const host = location.hostname
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return chatgptAdapter
  if (host.includes('claude.ai')) return claudeAdapter
  if (host.includes('gemini.google.com')) return geminiAdapter
  if (host.includes('perplexity.ai')) return perplexityAdapter
  if (host.includes('grok.com')) return grokAdapter
  if (host.includes('deepseek.com')) return deepseekAdapter
  return null
}

// ── Review log (dev tooling — throwaway) ─────────────────────
//
// Captures every (prompt, response, provocation) triple to
// chrome.storage.local under REVIEW_LOG_KEY so the review dashboard
// (src/review/) can render them for human eyeballing. Capped at
// REVIEW_LOG_CAP entries (FIFO eviction). Strip this whole block when
// the real backend wires in.

const REVIEW_LOG_KEY = 'crith_v2_prov_log'
const REVIEW_LOG_CAP = 50

type ReviewEntry = {
  timestamp: number
  platform: string
  prompt: string
  response: string
  provocation: { question: string; lens: Lens; anchored_to: string }
  sessionId: string
}

async function appendReviewLog(entry: ReviewEntry): Promise<void> {
  try {
    const r = await chrome.storage.local.get(REVIEW_LOG_KEY)
    const existing = Array.isArray(r[REVIEW_LOG_KEY])
      ? (r[REVIEW_LOG_KEY] as ReviewEntry[])
      : []
    existing.push(entry)
    while (existing.length > REVIEW_LOG_CAP) existing.shift()
    await chrome.storage.local.set({ [REVIEW_LOG_KEY]: existing })
  } catch (err) {
    log('appendReviewLog failed:', err)
  }
}

// ── Response-complete handler ────────────────────────────────
//
// Sends an ANALYZE message to the service worker (which owns auth +
// the api-client). The SW returns either an AnalyzeResponse or an
// ApiError. The orchestrator never touches the backend or auth
// directly — that's by design (single token-refresh path, no race
// across N tabs).

async function handleResponseComplete(params: {
  node: Element
  prompt: string
  response: string
  sessionId: string
  priorTurns: ConversationTurn[]
}): Promise<void> {
  const { node, prompt, response, sessionId, priorTurns } = params
  const platformName = adapter?.name ?? 'unknown'

  // Synthetic message_id. Platforms expose per-message IDs differently
  // (data-message-id on ChatGPT, render-count on Claude, etc.); the
  // adapter contract doesn't surface it, so we derive a stable-ish key
  // from sessionId + a short fingerprint of the response. The backend
  // uses message_id mostly for dedup — equivalent values will be
  // treated as the same message.
  const messageId = `${sessionId}-${response.length}-${Date.now().toString(36)}`

  let result: AnalyzeResponse | ApiError
  try {
    result = (await chrome.runtime.sendMessage({
      type: 'ANALYZE',
      payload: {
        prompt,
        response,
        platform: platformName as Platform,
        conversation_id: sessionId,
        message_id: messageId,
        // Adapter already capped at 6 turns × 1500 chars; mirror the
        // server's lib/validate-history.ts. Empty array on first turn.
        conversation_history: priorTurns,
      },
    })) as AnalyzeResponse | ApiError
  } catch (err) {
    // The SW listener might not be registered (extension reloaded
    // mid-conversation, or first response after install before the SW
    // wakes). Log and bail — never crash the page.
    log('ANALYZE sendMessage failed:', err)
    return
  }

  if (isApiError(result)) {
    if (result.kind === 'AUTH_REQUIRED') {
      log('ANALYZE → AUTH_REQUIRED — log in via the popup to enable provocations')
    } else {
      log(`ANALYZE error: ${result.kind}`, result)
    }
    return
  }

  // Defensive shape check. The TS type is a discriminated union, but
  // at runtime the backend can return anything — including JSON shapes
  // the api-client doesn't recognize as an ApiError (e.g. an HTTP 200
  // with `{error: "..."}` body, or a malformed v13 response missing
  // the provocations field). Without this guard the next branch would
  // throw "Cannot read properties of undefined (reading 'length')".
  if (typeof result !== 'object' || result === null) {
    log('ANALYZE returned non-object result, skipping render', result)
    return
  }

  if (result.skip) {
    log(`ANALYZE skip${'reason' in result && result.reason ? ` (${result.reason})` : ''}`)
    return
  }

  if (!Array.isArray(result.provocations)) {
    log(
      'ANALYZE response missing provocations array (skip not set, malformed shape) — skipping render',
      result,
    )
    return
  }

  if (result.provocations.length === 0) {
    log('ANALYZE returned skip=false but provocations array is empty')
    return
  }

  // Inject provocation_id from analysis_id + index if the backend
  // didn't supply one. Renderer needs it for idempotency / dedup.
  // analysis_id and provocation_index are stamped onto each provocation
  // so the card's Explain handler can call EXPLAIN_PROVOCATION /
  // LOG_EVENT without re-deriving them.
  const provocations: Provocation[] = result.provocations.map((p, i) => ({
    ...p,
    provocation_id: p.provocation_id ?? `${result.analysis_id}-${i}`,
    analysis_id: result.analysis_id,
    provocation_index: i,
  }))

  // Log every triple to storage for the review dashboard. Fire-and-
  // forget — never block render on the storage round-trip.
  for (const p of provocations) {
    void appendReviewLog({
      timestamp: Date.now(),
      platform: platformName,
      prompt,
      response,
      provocation: { question: p.question, lens: p.lens, anchored_to: p.anchored_to },
      sessionId,
    })
  }

  // Inline-stringified so the preview is readable in the console without
  // having to expand a collapsed Array(N).
  log(
    'rendering ' + JSON.stringify(provocations.map((p) => ({
      lens: p.lens,
      anchor_len: p.anchored_to.length,
      anchor_preview: p.anchored_to.slice(0, 80),
    }))),
  )
  rendererShow(node, provocations)
}

// ── SPA URL-change watcher ───────────────────────────────────

const URL_POLL_MS = 500
function watchUrlChange(callback: (oldUrl: string, newUrl: string) => void): void {
  let lastUrl = window.location.href
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      const oldUrl = lastUrl
      lastUrl = window.location.href
      callback(oldUrl, lastUrl)
    }
  }, URL_POLL_MS)
}

// ── Boot ─────────────────────────────────────────────────────

const adapter = detectAdapter()
if (adapter) {
  const color = PLATFORM_COLORS[adapter.name]
  if (color) {
    document.documentElement.style.setProperty('--crith-prov-color', color)
  }
  log(`booting on ${location.hostname} | adapter="${adapter.name}" | color=${color ?? '(default)'}`)

  observer.start(adapter, handleResponseComplete)

  watchUrlChange((oldUrl, newUrl) => {
    log(`url changed: ${oldUrl} → ${newUrl} — tearing down + restarting`)
    observer.tearDownUI()
    observer.stop()
    observer.start(adapter, handleResponseComplete)
  })
} else {
  log(`no adapter for hostname "${location.hostname}" — exiting`)
}
