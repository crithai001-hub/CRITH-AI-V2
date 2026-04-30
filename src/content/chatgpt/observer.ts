import {
  ASSISTANT_MESSAGE_SELECTOR,
  USER_MESSAGE_SELECTOR,
  MESSAGE_CONTENT_SELECTORS,
  STREAMING_INDICATOR_SELECTORS,
} from './selectors'

const LOG_PREFIX = '[Crith CS]'

export type ResponseCompletePayload = {
  prompt: string
  response: string
  conversation_id: string | null
  message_id: string
}

export type OnResponseComplete = (payload: ResponseCompletePayload) => void

export type ObserverHandle = {
  /** Stop observing and disconnect. */
  stop: () => void
  /**
   * Re-snapshot all currently visible assistant messages as "already
   * reported". Used after SPA navigation so we don't fire for the messages
   * that load with the new conversation.
   */
  resync: () => void
}

// ── Pure helpers ─────────────────────────────────────────────

function getConversationId(): string | null {
  const match = window.location.pathname.match(/^\/c\/([a-zA-Z0-9-]+)/)
  return match ? (match[1] ?? null) : null
}

function isAssistantStreaming(assistantEl: Element): boolean {
  for (const selector of STREAMING_INDICATOR_SELECTORS) {
    if (assistantEl.querySelector(selector)) return true
  }
  return false
}

function extractContent(messageEl: Element): string {
  for (const selector of MESSAGE_CONTENT_SELECTORS) {
    const el = messageEl.querySelector(selector) as HTMLElement | null
    if (el) return el.innerText.trim()
  }
  return (messageEl as HTMLElement).innerText.trim()
}

function findPrecedingUserMessage(
  container: Element,
  assistantEl: Element,
): Element | null {
  const all = Array.from(
    container.querySelectorAll(
      `${USER_MESSAGE_SELECTOR}, ${ASSISTANT_MESSAGE_SELECTOR}`,
    ),
  )
  const idx = all.indexOf(assistantEl)
  if (idx === -1) return null
  for (let i = idx - 1; i >= 0; i--) {
    const m = all[i]
    if (m && m.matches(USER_MESSAGE_SELECTOR)) return m
  }
  return null
}

// ── Observer ─────────────────────────────────────────────────

type State = {
  container: Element
  callback: OnResponseComplete
  /** Message IDs we've already reported (or snapshotted on init). */
  reportedIds: Set<string>
  /** Message IDs we've actively observed mid-stream this session. */
  inFlightIds: Set<string>
}

function snapshotExisting(state: State): void {
  const messages = state.container.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR)
  let added = 0
  for (const el of messages) {
    const id = el.getAttribute('data-message-id')
    if (id && !state.reportedIds.has(id)) {
      state.reportedIds.add(id)
      added++
    }
  }
  console.log(
    `${LOG_PREFIX} snapshot: marked ${added} existing assistant messages as already-reported (total tracked: ${state.reportedIds.size})`,
  )
}

function fireCallback(state: State, assistantEl: Element, messageId: string): void {
  const userEl = findPrecedingUserMessage(state.container, assistantEl)
  if (!userEl) {
    console.warn(
      `${LOG_PREFIX} selector failure: no preceding user message found for assistant ${messageId}. Selectors:`,
      USER_MESSAGE_SELECTOR,
    )
    return
  }
  const prompt = extractContent(userEl)
  const response = extractContent(assistantEl)
  if (!prompt) {
    console.warn(
      `${LOG_PREFIX} selector failure: empty prompt extraction. Selectors:`,
      MESSAGE_CONTENT_SELECTORS,
    )
  }
  if (!response) {
    console.warn(
      `${LOG_PREFIX} selector failure: empty response extraction. Selectors:`,
      MESSAGE_CONTENT_SELECTORS,
    )
  }
  state.callback({
    prompt,
    response,
    conversation_id: getConversationId(),
    message_id: messageId,
  })
}

function processMutation(state: State): void {
  const assistantMessages = state.container.querySelectorAll(
    ASSISTANT_MESSAGE_SELECTOR,
  )
  for (const el of assistantMessages) {
    const id = el.getAttribute('data-message-id')
    if (!id) continue
    if (state.reportedIds.has(id)) continue

    const streaming = isAssistantStreaming(el)
    if (streaming) {
      state.inFlightIds.add(id)
      continue
    }

    if (state.inFlightIds.has(id)) {
      // Was streaming, now not → response complete.
      state.inFlightIds.delete(id)
      state.reportedIds.add(id)
      fireCallback(state, el, id)
    } else {
      // Never observed streaming. Either pre-existing on load (caught by
      // snapshotExisting) or we joined mid-stream and missed the indicator.
      // Either way, don't fire — but mark reported so we don't re-evaluate.
      state.reportedIds.add(id)
    }
  }
}

export function startObserver(
  container: Element,
  callback: OnResponseComplete,
): ObserverHandle {
  const state: State = {
    container,
    callback,
    reportedIds: new Set(),
    inFlightIds: new Set(),
  }

  snapshotExisting(state)

  const observer = new MutationObserver(() => processMutation(state))
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-message-streaming', 'data-message-id'],
  })

  return {
    stop: () => {
      observer.disconnect()
    },
    resync: () => {
      state.inFlightIds.clear()
      snapshotExisting(state)
    },
  }
}
