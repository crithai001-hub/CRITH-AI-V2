// ── content/shared/observer.ts ────────────────────────────────
// Watches the platform's chat container for new completed AI responses.
// Text-stability polling: fires only when node.textContent length stops
// growing for STABILITY_WINDOW_MS and has reached MIN_TEXT_LENGTH chars,
// capped at MAX_WAIT_MS so a stalled stream doesn't pin a poller forever.
// Cap of MAX_INFLIGHT concurrent in-flight generations.
//
// ── Cache restoration intentionally omitted in V2 mock phase ─────────
// V1's observer.js (lines ~28-197) carried ~150 lines for restoring
// previously-rendered provocations from chrome.storage.local on page
// reload: loadCacheForCurrentSession, tryRestoreForNode, restoreFromCache,
// scanAndRestore, scheduleRetryScans (the 500/1500/3500/7500ms hydration
// backoff scans), migrateOrphanedHomeEntry, the restoredProvIds set,
// and the storage onChange listener that re-syncs cache cross-tab.
// All of that is gone here because mock data has no real provocation_id
// to persist or restore. Re-add when the real backend wires in — see
// /Users/huseyn/Documents/CRITH AI MVP/provocations/observer.js for the
// reference implementation.

import type { ConversationTurn, PlatformAdapter } from '../../shared/types'

const DEBUG = true
const LOG_PREFIX = '[Crith V2 PROV]'
function log(...args: unknown[]): void {
  if (DEBUG) console.log(LOG_PREFIX, ...args)
}

const STABILITY_WINDOW_MS = 1500
const MIN_TEXT_LENGTH = 50
// Bumped from 30s → 45s so genuinely long responses (~3000+ chars
// streamed slowly with reasoning) don't get abandoned before they
// stabilize. The poller still gives up if the text really never
// stops growing — just gives a wider window.
const MAX_WAIT_MS = 45000
const MAX_INFLIGHT = 2

export type ResponseCompleteParams = {
  node: Element
  prompt: string
  response: string
  sessionId: string
  /**
   * Prior turns of the conversation, oldest-first. Capped at 6 turns
   * and 1500 chars per turn by the adapter's getPriorTurns. Empty
   * array on first turn or when the DOM walk found nothing.
   */
  priorTurns: ConversationTurn[]
}
export type ResponseCompleteHandler = (params: ResponseCompleteParams) => Promise<void>

type InFlightEntry = { node: Element; sessionId: string; startedAt: number }
type PerNodeEntry = { cancel: () => void }

let adapter: PlatformAdapter | null = null
let onResponseComplete: ResponseCompleteHandler | null = null
let containerObserver: MutationObserver | null = null
let perNodeObservers = new WeakMap<Element, PerNodeEntry>()
let perNodeObserverSet = new Set<() => void>()
let inflight: InFlightEntry[] = []
let started = false
// Module-scoped reference to the container-retry interval so stop() can
// clear it. Without this, an SPA URL change firing during the retry
// window orphans the timer; its eventual fire would race with the
// fresh start() the orchestrator schedules right after.
let containerRetryTimer: ReturnType<typeof setInterval> | null = null

export function start(_adapter: PlatformAdapter, _handler: ResponseCompleteHandler): void {
  if (started) return
  // If we're already polling for the container, don't re-enter. (Defense
  // in depth — the orchestrator always stop()s before start()ing, but
  // this guards against any caller that doesn't.)
  if (containerRetryTimer != null) return
  adapter = _adapter
  onResponseComplete = _handler
  log('observer.start — adapter:', _adapter.name)

  const container = adapter.getChatContainer()
  if (container) {
    started = true
    attachContainer(container)
    return
  }

  // `started` stays false during the polling phase. It only flips when
  // attachContainer actually wires the MutationObserver up. This way
  // a stop() during retry leaves a clean slate for the next start().
  let attempts = 0
  containerRetryTimer = setInterval(() => {
    attempts++
    const c = adapter?.getChatContainer()
    if (c) {
      if (containerRetryTimer != null) {
        clearInterval(containerRetryTimer)
        containerRetryTimer = null
      }
      started = true
      attachContainer(c)
    } else if (attempts > 30) {
      if (containerRetryTimer != null) {
        clearInterval(containerRetryTimer)
        containerRetryTimer = null
      }
      log('observer.start — gave up waiting for container after 30 attempts')
    }
  }, 1000)
}

function attachContainer(container: Element): void {
  log(
    'attachContainer — element:', container.tagName,
    '| classes:', container.className?.slice?.(0, 60),
  )
  containerObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (added.nodeType !== 1) continue
        handleAddedNode(added as Element)
      }
    }
  })
  containerObserver.observe(container, { childList: true, subtree: true })
}

function handleAddedNode(node: Element): void {
  if (!adapter) return
  if (adapter.isResponseNode(node)) {
    log(
      'response node detected (direct) — tag:', node.tagName,
      '| classes:', node.className?.slice?.(0, 100),
      '| role:', node.getAttribute('data-message-author-role'),
      '| author:', node.getAttribute('data-author'),
    )
    attachToResponse(node)
  } else {
    const inner = node.querySelectorAll?.('*')
    if (inner) {
      for (const d of inner) {
        if (adapter.isResponseNode(d)) {
          log(
            'response node detected (descendant) — tag:', d.tagName,
            '| classes:', d.className?.slice?.(0, 100),
            '| role:', d.getAttribute('data-message-author-role'),
            '| author:', d.getAttribute('data-author'),
          )
          attachToResponse(d)
          break
        }
      }
    }
  }
}

function attachToResponse(node: Element): void {
  if (perNodeObservers.has(node)) return

  // ChatGPT and Claude both render each AI message as two nested elements
  // that pass isResponseNode (an outer wrapper + an inner content div).
  // The outer mounts first; when the inner streams in, it would attach a
  // second poller covering the same logical response, producing two fires
  // → two generations → two rendered provocations on the same phrase.
  // Walk ancestors and skip if one is already tracked — node.textContent
  // already covers this node's text via its descendants. Keep the
  // outermost so re-renders of inner content don't orphan tracking.
  let cursor: Element | null = node.parentElement
  while (cursor && cursor !== document.body) {
    if (perNodeObservers.has(cursor)) return
    cursor = cursor.parentElement
  }

  // Two-signal fire detection:
  //
  // (1) Streaming-class transition (preferred). Adapter's isStreaming()
  //     reads platform-specific signals — per-message classes, the
  //     global stop-button presence, etc. When that probe goes from
  //     true → false, generation is done. This is fast and reliable
  //     when the adapter implements it; ChatGPT does, others stub.
  //
  // (2) Text-stability fallback. Node.textContent length stops growing
  //     for one STABILITY_WINDOW_MS AND has reached MIN_TEXT_LENGTH.
  //     Used when the adapter's streaming probe never returns true
  //     (selector drift, never-streaming case, or stub).
  //
  // We deliberately suppress the stability fallback while streaming
  // class is currently active — mid-stream pauses (model computing
  // next tokens) look like stability, but firing then would clip the
  // response. Cap total wait at MAX_WAIT_MS so a never-ending stream
  // doesn't pin a poller forever.
  const startedAt = Date.now()
  let currentLength = (node.textContent ?? '').length
  let sawStreamingClass = false
  let aborted = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const fireNow = (newLength: number, trigger: 'streaming-done' | 'text-stable'): void => {
    if (!adapter) return
    const responseText = adapter.getResponseText(node)
    const promptText = adapter.getPromptForResponse(node)
    const sessionId = adapter.getSessionId()
    const priorTurns = adapter.getPriorTurns(node)
    const priorChars = priorTurns.reduce((sum, t) => sum + t.content.length, 0)
    log(
      `fire — trigger: ${trigger} | stable at len:`, newLength,
      '| promptText len:', promptText?.length ?? 0,
      '| responseText len:', responseText?.length ?? 0,
      '| sessionId:', sessionId,
      '| priorTurns:', priorTurns.length,
      '| priorChars:', priorChars,
    )
    cleanup(node)
    if (!responseText || !promptText) {
      log('fire dropped — empty prompt or response')
      return
    }
    enqueueGeneration(node, promptText, responseText, sessionId, priorTurns)
  }

  const tick = (): void => {
    if (aborted) return
    if (!adapter) return
    const newLength = (node.textContent ?? '').length
    const elapsedMs = Date.now() - startedAt

    const streamingNow = adapter.isStreaming(node)
    if (streamingNow) sawStreamingClass = true

    // Fire condition 1: streaming class transition (was true, now false).
    if (sawStreamingClass && !streamingNow && newLength >= MIN_TEXT_LENGTH) {
      fireNow(newLength, 'streaming-done')
      return
    }

    // Fire condition 2: text-stability fallback. Suppressed when the
    // streaming class is currently true — that's a mid-stream token
    // pause, not a real "done". Falls through when streaming class is
    // false (signal unsupported on this platform OR generation actually
    // ended without us catching the class transition).
    if (
      !streamingNow &&
      newLength === currentLength &&
      newLength >= MIN_TEXT_LENGTH
    ) {
      fireNow(newLength, 'text-stable')
      return
    }

    // Cap total wait. The +STABILITY_WINDOW_MS guards against scheduling
    // another tick that would land past the cap.
    if (elapsedMs + STABILITY_WINDOW_MS >= MAX_WAIT_MS) {
      log(
        'fire abandoned — text never stabilized within',
        MAX_WAIT_MS, 'ms | last len:', newLength,
        '| sawStreamingClass:', sawStreamingClass,
      )
      cleanup(node)
      return
    }

    if (newLength !== currentLength) {
      log('text changed — was:', currentLength, '→ now:', newLength)
      currentLength = newLength
    }
    timer = setTimeout(tick, STABILITY_WINDOW_MS)
  }

  // First check fires after one window — gives streaming a moment to
  // populate before we begin comparing.
  timer = setTimeout(tick, STABILITY_WINDOW_MS)

  const cancel = (): void => {
    aborted = true
    if (timer != null) {
      try { clearTimeout(timer) } catch { /* noop */ }
      timer = null
    }
  }
  perNodeObservers.set(node, { cancel })
  perNodeObserverSet.add(cancel)
}

function cleanup(node: Element): void {
  const entry = perNodeObservers.get(node)
  if (entry) {
    try { entry.cancel() } catch { /* noop */ }
    perNodeObserverSet.delete(entry.cancel)
    perNodeObservers.delete(node)
  }
}

function enqueueGeneration(
  node: Element,
  prompt: string,
  response: string,
  sessionId: string,
  priorTurns: ConversationTurn[],
): void {
  if (inflight.length >= MAX_INFLIGHT) {
    const dropped = inflight.shift()
    log(
      'inflight cap hit — dropped oldest, age:',
      dropped ? Date.now() - dropped.startedAt : 0, 'ms',
    )
  }
  const entry: InFlightEntry = { node, sessionId, startedAt: Date.now() }
  inflight.push(entry)

  const handler = onResponseComplete
  if (!handler) {
    const i = inflight.indexOf(entry)
    if (i >= 0) inflight.splice(i, 1)
    return
  }

  void handler({ node, prompt, response, sessionId, priorTurns })
    .catch((err) => log('onResponseComplete handler threw:', err))
    .finally(() => {
      const i = inflight.indexOf(entry)
      if (i >= 0) inflight.splice(i, 1)
    })
}

export function stop(): void {
  if (containerRetryTimer != null) {
    try { clearInterval(containerRetryTimer) } catch { /* noop */ }
    containerRetryTimer = null
  }
  if (containerObserver) {
    try { containerObserver.disconnect() } catch { /* noop */ }
    containerObserver = null
  }
  for (const cancel of perNodeObserverSet) {
    try { cancel() } catch { /* noop */ }
  }
  perNodeObserverSet.clear()
  perNodeObservers = new WeakMap()
  inflight = []
  started = false
}

export function tearDownUI(): void {
  document.querySelectorAll('crith-prov-host').forEach((el) => el.remove())
  document.querySelectorAll('span.crith-prov-underline').forEach((span) => {
    const parent = span.parentNode
    if (!parent) return
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
  })
}
