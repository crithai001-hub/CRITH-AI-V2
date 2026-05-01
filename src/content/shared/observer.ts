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

import type { PlatformAdapter } from '../../shared/types'

const DEBUG = true
const LOG_PREFIX = '[Crith V2 PROV]'
function log(...args: unknown[]): void {
  if (DEBUG) console.log(LOG_PREFIX, ...args)
}

const STABILITY_WINDOW_MS = 1500
const MIN_TEXT_LENGTH = 50
const MAX_WAIT_MS = 30000
const MAX_INFLIGHT = 2

export type ResponseCompleteParams = {
  node: Element
  prompt: string
  response: string
  sessionId: string
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

export function start(_adapter: PlatformAdapter, _handler: ResponseCompleteHandler): void {
  if (started) return
  started = true
  adapter = _adapter
  onResponseComplete = _handler
  log('observer.start — adapter:', _adapter.name)

  const container = adapter.getChatContainer()
  if (!container) {
    let attempts = 0
    const retry = setInterval(() => {
      attempts++
      const c = adapter?.getChatContainer()
      if (c) {
        clearInterval(retry)
        attachContainer(c)
      } else if (attempts > 30) {
        clearInterval(retry)
        started = false
        log('observer.start — gave up waiting for container after 30 attempts')
      }
    }, 1000)
    return
  }
  attachContainer(container)
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
      'response node detected — tag:', node.tagName,
      '| classes:', node.className?.slice?.(0, 80),
    )
    attachToResponse(node)
  } else {
    const inner = node.querySelectorAll?.('*')
    if (inner) {
      for (const d of inner) {
        if (adapter.isResponseNode(d)) {
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

  // Text-stability polling. Streaming UIs across the six target platforms
  // expose neither a uniform nor reliable "still generating" signal, so
  // we fire only when node.textContent length stops growing for one
  // STABILITY_WINDOW_MS AND has reached MIN_TEXT_LENGTH chars (filters
  // out the brief pre-content stub render before streaming begins). Cap
  // total wait at MAX_WAIT_MS so a stalled stream doesn't pin a poller
  // forever.
  const startedAt = Date.now()
  let currentLength = (node.textContent ?? '').length
  let aborted = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = (): void => {
    if (aborted) return
    if (!adapter) return
    const newLength = (node.textContent ?? '').length
    const elapsedMs = Date.now() - startedAt

    if (newLength === currentLength && newLength >= MIN_TEXT_LENGTH) {
      // Stable AND long enough — fire.
      const responseText = adapter.getResponseText(node)
      const promptText = adapter.getPromptForResponse(node)
      const sessionId = adapter.getSessionId()
      log(
        'fire — stable at len:', newLength,
        '| promptText len:', promptText?.length ?? 0,
        '| responseText len:', responseText?.length ?? 0,
        '| sessionId:', sessionId,
      )
      cleanup(node)
      if (!responseText || !promptText) {
        log('fire dropped — empty prompt or response')
        return
      }
      enqueueGeneration(node, promptText, responseText, sessionId)
      return
    }

    // Cap total wait. The +STABILITY_WINDOW_MS guards against scheduling
    // another tick that would land past the cap.
    if (elapsedMs + STABILITY_WINDOW_MS >= MAX_WAIT_MS) {
      log(
        'fire abandoned — text never stabilized within',
        MAX_WAIT_MS, 'ms | last len:', newLength,
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

  void handler({ node, prompt, response, sessionId })
    .catch((err) => log('onResponseComplete handler threw:', err))
    .finally(() => {
      const i = inflight.indexOf(entry)
      if (i >= 0) inflight.splice(i, 1)
    })
}

export function stop(): void {
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
