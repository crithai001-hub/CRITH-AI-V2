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
import { setCardAdapter } from './card'
import { getClaimVerdict, setClaimCardAdapter, setClaimVerdict } from './claim-card'
import { classifyVerifyResult, filterClaimsForVerify } from './claim-filter'
import { showQuotaBanner } from './quota-banner'
import {
  getStoredAnalysis,
  hashResponse,
  saveAnalysis,
  saveVerdict,
} from './analysis-cache'
import {
  mountChatStatusPill,
  recordResponseAnalyzed,
  recordVerdict,
  resetChatStatus,
} from './chat-status-pill'
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
  Validation,
  VerifiableClaim,
  VerifyClaimResponse,
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
  /**
   * Captured for human review on the dashboard. We keep `question` as
   * the field name for backward compat with prior log entries, but its
   * value now holds the v14+ `problem` text. `follow_up_prompt` is the
   * new Ask AI prompt; empty string for legacy provocations.
   */
  provocation: {
    question: string
    follow_up_prompt: string
    lens: Lens
    anchored_to: string
  }
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

  // Backend may return either `validations` (v14+) or legacy
  // `provocations`. Prefer validations; fall back to provocations and
  // normalize fields. If neither is present, treat as malformed.
  const rawValidations = (result as { validations?: Validation[] }).validations
  const rawProvocations = (result as { provocations?: Provocation[] }).provocations

  let validations: Validation[]
  if (Array.isArray(rawValidations)) {
    validations = rawValidations
  } else if (Array.isArray(rawProvocations)) {
    // Legacy: map question → problem, no follow_up_prompt available.
    // Ask AI will be disabled on these (empty follow_up_prompt).
    validations = rawProvocations.map((p) => ({
      provocation_id: p.provocation_id,
      analysis_id: p.analysis_id,
      provocation_index: p.provocation_index,
      problem: p.question,
      follow_up_prompt: '',
      lens: p.lens,
      anchored_to: p.anchored_to,
      severity: p.severity,
    }))
    log('ANALYZE: backend returned legacy `provocations` shape — normalized to validations (Ask AI disabled)')
  } else {
    log(
      'ANALYZE response missing both validations and provocations — skipping render',
      result,
    )
    return
  }

  if (validations.length === 0) {
    // Most likely cause: backend's anchored_to validator stripped every
    // candidate (LLM returned paraphrased anchors that didn't survive
    // the response.includes() check). Less likely: prompt's
    // high-quality path returned skip=false with no items. Either way,
    // nothing to render — log the full result + the response we sent
    // so we can debug from the page console.
    log(
      'ANALYZE returned skip=false but validations array is empty — likely backend dropped all candidates for failing the verbatim anchored_to check',
      { result, response_chars: response.length, response_head: response.slice(0, 200) },
    )
    return
  }

  // Inject provocation_id from analysis_id + index if the backend
  // didn't supply one. Renderer needs it for idempotency / dedup.
  // analysis_id and provocation_index are stamped onto each entry so
  // the card's Explain / Ask AI / LOG_EVENT handlers can use them
  // without re-deriving.
  const enriched: Validation[] = validations.map((v, i) => ({
    ...v,
    provocation_id: v.provocation_id ?? `${result.analysis_id}-${i}`,
    analysis_id: result.analysis_id,
    provocation_index: i,
  }))

  // Log every triple to storage for the review dashboard. Fire-and-
  // forget — never block render on the storage round-trip.
  for (const v of enriched) {
    void appendReviewLog({
      timestamp: Date.now(),
      platform: platformName,
      prompt,
      response,
      provocation: {
        question: v.problem,
        follow_up_prompt: v.follow_up_prompt,
        lens: v.lens,
        anchored_to: v.anchored_to,
      },
      sessionId,
    })
  }

  // Inline-stringified so the preview is readable in the console without
  // having to expand a collapsed Array(N).
  log(
    'rendering ' + JSON.stringify(enriched.map((v) => ({
      lens: v.lens,
      problem_len: v.problem.length,
      follow_up_len: v.follow_up_prompt.length,
      anchor_preview: v.anchored_to.slice(0, 80),
    }))),
  )

  // Verifiable claims (fact-check candidates) from /api/analyze-response.
  // Backend may omit the field entirely on older deployments; treat as
  // empty in that case. Each claim gets analysis_id + claim_index
  // stamped so claim-card.ts can fire VERIFY_CLAIM and LOG_EVENT.
  const rawClaims = (result as { verifiable_claims?: VerifiableClaim[] }).verifiable_claims
  const enrichedClaims: VerifiableClaim[] = Array.isArray(rawClaims)
    ? rawClaims.map((c, i) => ({
        ...c,
        analysis_id: result.analysis_id,
        claim_index: i,
      }))
    : []

  // Render validations synchronously — they're already finalized by
  // analyze and don't depend on any further round-trip.
  rendererShow(node, enriched)

  // Verifiable claims: gate by hallucination_signal, then auto-fire
  // VERIFY_CLAIM in parallel. Only `contradicted` verdicts produce UI.
  let candidates: VerifiableClaim[] = []
  if (enrichedClaims.length > 0) {
    const signalCounts: Record<string, number> = {}
    for (const c of enrichedClaims) {
      const s = c.hallucination_signal ?? 'none'
      signalCounts[s] = (signalCounts[s] ?? 0) + 1
    }
    candidates = filterClaimsForVerify(enrichedClaims)
    log(
      `claims=${enrichedClaims.length} signal=${JSON.stringify(signalCounts)} ` +
        `candidates_to_verify=${candidates.length}`,
    )
  }

  // Update the chat-level status pill with this response's totals
  // BEFORE firing verify — the pill should reflect "we found N
  // claims, sent K to verify" even before any verdicts come back.
  const highSignalCount = enrichedClaims.filter(
    (c) => c.hallucination_signal === 'high',
  ).length
  recordResponseAnalyzed({
    validationCount: enriched.length,
    claimCount: enrichedClaims.length,
    signalEligibleCount: candidates.length,
    highSignalCount,
  })

  // Persist the analyze result so a refresh can rehydrate the same
  // flags without re-burning analyze quota. Hash is over the full
  // response text; conv id + hash uniquely identify the response.
  const responseHash = hashResponse(response)
  void saveAnalysis(sessionId, responseHash, {
    analysis_id: result.analysis_id,
    validations: enriched,
    verifiable_claims: enrichedClaims,
    verdicts: {},
  })

  if (candidates.length > 0) {
    void verifyAndRenderContradicted(node, candidates, sessionId, responseHash)
  }
}

/**
 * Once any verify call returns 429, halt all further verify fires
 * for the rest of the content-script lifetime. The session flag
 * survives URL changes within a tab; a full page reload resets it
 * (the content script reboots from scratch).
 */
let verifyQuotaHalted = false

const QUOTA_BANNER_TEXT =
  'Out of verifications this month — claim checking paused.'

/**
 * Fire VERIFY_CLAIM in parallel for the supplied (already-filtered)
 * candidates. Renders the underline + claim host iff the verdict is
 * `contradicted` — confirmed / inconclusive / error / network errors
 * all produce no UI.
 *
 * Cache short-circuit: any candidate whose verdict is already in
 * claim-card's verdictCache (e.g. from a prior visit to this same
 * conversation) renders immediately without firing the network call.
 *
 * Quota: a 429 from any verify call sets the session-wide halt flag
 * AND surfaces the one-time banner. In-flight calls already past the
 * fetch boundary still resolve normally — only NEW fires are skipped.
 */
async function verifyAndRenderContradicted(
  responseNode: Element,
  claims: VerifiableClaim[],
  conversationId: string,
  responseHash: string,
): Promise<void> {
  await Promise.all(
    claims.map(async (claim) => {
      const aid = claim.analysis_id
      const idx = claim.claim_index
      if (typeof aid !== 'string' || typeof idx !== 'number') {
        log('claim missing analysis_id or claim_index — skipping verify', claim)
        return
      }

      // Cache short-circuit. If we already have a verdict from this
      // session (SPA nav back to the same chat), reuse it and render
      // directly if it was contradicted. setClaimVerdict is a no-op
      // on cache identity here, but keep the call to be explicit
      // about render-time invariants.
      const cached = getClaimVerdict(aid, idx)
      if (cached) {
        log(
          `VERIFY_CLAIM cache-hit claim_index=${idx} verdict=${cached.verdict}`,
        )
        recordVerdict(cached.verdict, {
          ...(claim.hallucination_signal !== undefined
            ? { hallucinationSignal: claim.hallucination_signal }
            : {}),
        })
        void saveVerdict(conversationId, responseHash, idx, cached)
        if (cached.verdict === 'contradicted' && document.body.contains(responseNode)) {
          rendererShow(responseNode, [], [claim])
        }
        return
      }

      if (verifyQuotaHalted) {
        log(`VERIFY_CLAIM skipped (session quota halted) claim_index=${idx}`)
        return
      }

      let raw: unknown
      try {
        raw = await chrome.runtime.sendMessage({
          type: 'VERIFY_CLAIM',
          payload: { analysis_id: aid, claim_index: idx },
        })
      } catch (err) {
        log(`VERIFY_CLAIM sendMessage failed claim_index=${idx}:`, err)
        return
      }

      // Catch QUOTA_EXCEEDED before the generic classifier so we can
      // both halt + banner. Other ApiErrors fall through to noRender.
      if (isApiError(raw) && raw.kind === 'QUOTA_EXCEEDED') {
        verifyQuotaHalted = true
        showQuotaBanner(QUOTA_BANNER_TEXT)
        log(`VERIFY_CLAIM QUOTA_EXCEEDED — halting session verifies`)
        return
      }

      // Update the chat-status pill with whatever verdict came back,
      // not just contradicted ones — the pill rolls up confirmed and
      // inconclusive too. ApiError shapes lack a `verdict` field so
      // they're naturally skipped here.
      if (
        raw !== null &&
        typeof raw === 'object' &&
        typeof (raw as { verdict?: unknown }).verdict === 'string'
      ) {
        const v = raw as VerifyClaimResponse
        recordVerdict(v.verdict, {
          ...(claim.hallucination_signal !== undefined
            ? { hallucinationSignal: claim.hallucination_signal }
            : {}),
        })
        // Persist non-contradicted verdicts too so refresh re-counts
        // them on the pill without re-firing verify. The contradicted
        // path saves again below (idempotent) for the render branch.
        if (v.verdict !== 'contradicted' && Array.isArray(v.source_urls)) {
          void saveVerdict(conversationId, responseHash, idx, v)
        }
      }

      const outcome = classifyVerifyResult(raw)
      if (outcome.kind === 'noRender') {
        log(`VERIFY_CLAIM no-render claim_index=${idx} reason=${outcome.reason}`)
        return
      }

      const verdict = outcome.verdict
      log(
        `VERIFY_CLAIM contradicted claim_index=${idx} ` +
          `sources=${verdict.source_urls.length}`,
      )
      setClaimVerdict(aid, idx, verdict)
      // Persist the contradicted verdict so a refresh re-renders the
      // underline + card without re-firing verify. Confirmed and
      // inconclusive verdicts produce no UI but are also persisted
      // (in the cached fast path below) so the chat-status pill
      // counts them on rehydrate.
      void saveVerdict(conversationId, responseHash, idx, verdict)
      if (!document.body.contains(responseNode)) {
        log(`response node detached — skipping render claim_index=${idx}`)
        return
      }
      rendererShow(responseNode, [], [claim])
    }),
  )
}

// ── Rehydrate cached analyses on boot + after SPA nav ───────
//
// Walks every visible AI response node, hashes its text, and looks
// up the cached analysis. If a hit is found, re-renders the
// validations + (post-verdict) contradicted claim hosts WITHOUT
// firing analyze or verify again — the user paid for the analysis
// last visit, no need to re-burn the quota.
//
// Hash collision risk: djb2 over per-conversation namespace. With
// realistic response counts per chat (<200), collision probability
// is negligible.
//
// Backoff scan: SPA frameworks hydrate the chat over multiple
// frames, so a single pass on boot misses responses that mount
// later. Schedule three scans with increasing delay; each scan is
// idempotent because rendererShow checks for an existing host
// keyed on provocation_id / claim_dom_id and returns early on dup.

const REHYDRATE_DELAYS_MS = [400, 1500, 3500]

const rehydratedNodes = new WeakSet<Element>()

async function rehydrateOneNode(
  responseNode: Element,
  platformAdapter: PlatformAdapter,
): Promise<boolean> {
  if (rehydratedNodes.has(responseNode)) return false
  const responseText = platformAdapter.getResponseText(responseNode)
  if (!responseText || responseText.length < 50) return false
  const sessionId = platformAdapter.getSessionId()
  const hash = hashResponse(responseText)
  const cached = await getStoredAnalysis(sessionId, hash)
  if (!cached) return false

  rehydratedNodes.add(responseNode)
  log(
    `rehydrate hit | conv=${sessionId} hash=${hash} ` +
      `validations=${cached.validations.length} ` +
      `claims=${cached.verifiable_claims.length} ` +
      `verdicts=${Object.keys(cached.verdicts).length}`,
  )

  // Validations render directly — they don't need verify.
  rendererShow(responseNode, cached.validations)

  // For each cached verdict: pre-populate the claim-card cache and
  // render the contradicted ones. This must happen BEFORE the host
  // attaches, so use the same setClaimVerdict path the live flow
  // uses.
  const contradictedClaims: VerifiableClaim[] = []
  for (const [idxStr, verdict] of Object.entries(cached.verdicts)) {
    const idx = parseInt(idxStr, 10)
    if (Number.isNaN(idx)) continue
    const claim = cached.verifiable_claims[idx]
    if (!claim) continue
    const aid = claim.analysis_id ?? cached.analysis_id
    if (typeof aid !== 'string') continue
    setClaimVerdict(aid, idx, verdict)
    if (verdict.verdict === 'contradicted') {
      contradictedClaims.push({ ...claim, analysis_id: aid, claim_index: idx })
    }
  }
  if (contradictedClaims.length > 0) {
    rendererShow(responseNode, [], contradictedClaims)
  }

  // Update the chat-status pill so the rolled-up counts include
  // rehydrated state, not just newly-analyzed responses.
  const signalEligibleCount = filterClaimsForVerify(
    cached.verifiable_claims,
  ).length
  const highSignalCount = cached.verifiable_claims.filter(
    (c) => c.hallucination_signal === 'high',
  ).length
  recordResponseAnalyzed({
    validationCount: cached.validations.length,
    claimCount: cached.verifiable_claims.length,
    signalEligibleCount,
    highSignalCount,
  })
  for (const [idxStr, verdict] of Object.entries(cached.verdicts)) {
    const idx = parseInt(idxStr, 10)
    const claim = cached.verifiable_claims[idx]
    recordVerdict(verdict.verdict, {
      ...(claim?.hallucination_signal !== undefined
        ? { hallucinationSignal: claim.hallucination_signal }
        : {}),
    })
  }
  return true
}

async function rehydrateAllNodes(platformAdapter: PlatformAdapter): Promise<void> {
  const nodes = platformAdapter.getAllResponseNodes()
  log(`rehydrate scan: ${nodes.length} response node(s)`)
  for (const node of nodes) {
    try {
      await rehydrateOneNode(node, platformAdapter)
    } catch (err) {
      log('rehydrate node failed:', err)
    }
  }
}

function scheduleRehydrationScans(platformAdapter: PlatformAdapter): void {
  for (const ms of REHYDRATE_DELAYS_MS) {
    setTimeout(() => {
      void rehydrateAllNodes(platformAdapter)
    }, ms)
  }
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

  // Hand the adapter to card.ts so its Ask AI button knows where to
  // route the follow-up prompt. Claim card uses the same adapter ref
  // (for symmetry — currently unused there, but reserved for a
  // future "ask AI to elaborate on the verdict" affordance).
  setCardAdapter(adapter)
  setClaimCardAdapter(adapter)

  // Mount the chat-status pill so it's visible from page load in
  // idle state, not just after the first analyze.
  mountChatStatusPill()

  observer.start(adapter, handleResponseComplete)

  // Rehydrate any persisted analyses for responses already on the
  // page. Backoff scan — SPA hydration is multi-frame.
  scheduleRehydrationScans(adapter)

  watchUrlChange((oldUrl, newUrl) => {
    log(`url changed: ${oldUrl} → ${newUrl} — tearing down + restarting`)
    observer.tearDownUI()
    observer.stop()
    resetChatStatus()
    observer.start(adapter, handleResponseComplete)
    scheduleRehydrationScans(adapter)
  })
} else {
  log(`no adapter for hostname "${location.hostname}" — exiting`)
}
