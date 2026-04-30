import { MESSAGE_CONTAINER_SELECTOR } from './selectors'
import {
  startObserver,
  type ObserverHandle,
  type ResponseCompletePayload,
} from './observer'

const LOG_PREFIX = '[Crith CS]'
const CONTAINER_TIMEOUT_MS = 30_000
const URL_POLL_MS = 500
const NAV_SETTLE_MS = 300

console.log(`${LOG_PREFIX} content script loaded on ${window.location.href}`)

/**
 * Resolve when a selector matches an element, or reject after timeoutMs.
 * Uses an observer on document.body so we don't poll.
 */
function waitForElement(selector: string, timeoutMs: number): Promise<Element> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector)
    if (existing) {
      resolve(existing)
      return
    }
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        obs.disconnect()
        resolve(el)
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      obs.disconnect()
      reject(new Error(`waitForElement timeout: ${selector}`))
    }, timeoutMs)
  })
}

/**
 * SPA URL-change watcher. ChatGPT navigates with the History API and
 * doesn't fire a page-load event. Polling every 500ms is cheap and
 * catches everything (pushState, replaceState, popstate).
 */
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

function onResponseComplete(payload: ResponseCompletePayload): void {
  console.log(`${LOG_PREFIX} response complete`, {
    ...payload,
    response_chars: payload.response.length,
    prompt_chars: payload.prompt.length,
    timestamp: new Date().toISOString(),
  })
}

let handle: ObserverHandle | null = null

async function init(): Promise<void> {
  try {
    const container = await waitForElement(
      MESSAGE_CONTAINER_SELECTOR,
      CONTAINER_TIMEOUT_MS,
    )
    handle = startObserver(container, onResponseComplete)
    console.log(
      `${LOG_PREFIX} observer attached to "${MESSAGE_CONTAINER_SELECTOR}"`,
    )
  } catch (err) {
    console.error(`${LOG_PREFIX} init failed:`, err)
  }
}

watchUrlChange((oldUrl, newUrl) => {
  console.log(`${LOG_PREFIX} url changed: ${oldUrl} → ${newUrl}`)
  // Wait briefly for the new conversation's DOM to settle, then
  // re-snapshot existing messages so we don't fire for them.
  setTimeout(() => {
    if (handle) {
      handle.resync()
    } else {
      void init()
    }
  }, NAV_SETTLE_MS)
})

void init()
