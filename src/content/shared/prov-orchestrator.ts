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
import type { Lens, PlatformAdapter, Provocation } from '../../shared/types'

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

// ── Mock provocation generator ───────────────────────────────
//
// Cycles through three states per response so we can verify all three
// render variants (no-dot / orange-dot / purple-dot) on successive AI
// responses. Replace with apiClient.analyzeResponse(...) when the real
// backend wires in.

type MockState = { question: string; lens: Lens }
const MOCK_STATES: readonly MockState[] = [
  {
    question: "What audience did the AI assume here? What changes if they're enterprise instead of solopreneurs?",
    lens: 'hidden_assumption',
  },
  {
    question: 'Where did the AI validate your framing without questioning it?',
    lens: 'sycophancy',
  },
  {
    question: 'The AI cited a specific statistic — can you verify this is real?',
    lens: 'hallucination',
  },
]

type MockResponse = {
  skip: false
  provocations: Array<{ question: string; lens: Lens; anchored_to: string; severity: 'medium' }>
  analysis_id: string
}

type MockBag = { __crithMockIdx?: number }

async function generateMockProvocation(_prompt: string, response: string): Promise<MockResponse> {
  const g = globalThis as unknown as MockBag
  g.__crithMockIdx = (g.__crithMockIdx ?? -1) + 1
  const stateIdx = g.__crithMockIdx % MOCK_STATES.length
  const state = MOCK_STATES[stateIdx]!

  // Pick a sentence near the middle of the response to anchor the
  // underline. Falls back to the first 100 chars when no long-enough
  // sentence is present (e.g. a one-liner answer).
  const sentences = response.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20)
  const anchoredTo = sentences.length > 0
    ? sentences[Math.floor(sentences.length / 2)]!
    : response.slice(0, 100)

  return {
    skip: false,
    provocations: [{
      question: state.question,
      lens: state.lens,
      anchored_to: anchoredTo,
      severity: 'medium',
    }],
    analysis_id: `mock-${Date.now()}`,
  }
}

// ── Response-complete handler ────────────────────────────────

async function handleResponseComplete(params: {
  node: Element
  prompt: string
  response: string
  sessionId: string
}): Promise<void> {
  const { node, prompt, response } = params
  const result = await generateMockProvocation(prompt, response)
  if (result.skip) return
  if (result.provocations.length === 0) return

  // Inject provocation_id from analysis_id + index. Real backend will
  // either supply provocation_id directly or this fallback continues.
  const provocations: Provocation[] = result.provocations.map((p, i) => ({
    ...p,
    provocation_id: `${result.analysis_id}-${i}`,
  }))

  log(
    'rendering',
    provocations.map((p) => ({ id: p.provocation_id, lens: p.lens, anchor_len: p.anchored_to.length })),
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
