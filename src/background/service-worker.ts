import { getAccessTokenWithRefresh } from './auth'
import {
  analyzeResponse,
  explainProvocation,
  logEvent,
  isApiError,
} from '../shared/api-client'
import { getAuth, getUserEmail } from '../shared/storage'
import type {
  AnalyzeRequest,
  AuthStatusResponse,
  IncomingMessage,
} from '../shared/types'

const LOG_PREFIX = '[Crith SW]'

// ── Lifecycle ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${LOG_PREFIX} installed:`, details.reason)
})

chrome.runtime.onStartup.addListener(() => {
  console.log(`${LOG_PREFIX} startup`)
})

// ── Helpers ──────────────────────────────────────────────────

async function getAuthStatus(): Promise<AuthStatusResponse> {
  const auth = await getAuth()
  const email = await getUserEmail()
  const now = Math.floor(Date.now() / 1000)
  if (auth && email && auth.expires_at > now) {
    return { logged_in: true, email }
  }
  return { logged_in: false }
}

// ── DEBUG ─ remove this whole block before launch ────────────
// Hits /api/analyze-response with a fixed payload so we can verify the full
// pipeline (auth refresh → fetch → typed response) end-to-end before any
// content script exists. Trigger from popup or SW DevTools console:
//   chrome.runtime.sendMessage({ type: 'DEBUG_TEST_BACKEND' })
// ─────────────────────────────────────────────────────────────
const DEBUG_TEST_PAYLOAD: AnalyzeRequest = {
  prompt:
    "I'm launching a SaaS product targeting small e-commerce businesses. Should I price by transaction volume, monthly subscription, or hybrid?",
  response:
    'Pricing for SaaS targeting small e-commerce businesses depends on several factors. Transaction-volume pricing aligns your revenue with customer growth and lowers the barrier to entry, but it can scare away customers as their volume grows. Monthly subscriptions provide predictable revenue and simpler customer budgeting, but may price out smaller customers. Hybrid models combine a low base subscription with usage-based components, capturing both predictability and growth scaling. Most successful SaaS companies in this space use hybrid: a small base fee plus per-transaction or per-feature charges. Start with subscription tiers based on revenue brackets, then layer transaction fees for premium features.',
  platform: 'chatgpt',
  conversation_id: 'debug-conv-001',
  message_id: 'debug-msg-001',
}

// ── Message router ───────────────────────────────────────────

async function handleMessage(message: IncomingMessage): Promise<unknown> {
  switch (message.type) {
    case 'ANALYZE': {
      console.log(
        `${LOG_PREFIX} ANALYZE platform=${message.payload.platform} ` +
          `conv=${message.payload.conversation_id} msg=${message.payload.message_id}`,
      )
      const result = await analyzeResponse(
        message.payload,
        getAccessTokenWithRefresh,
      )
      if (isApiError(result)) {
        if (result.kind === 'AUTH_REQUIRED' || result.kind === 'QUOTA_EXCEEDED') {
          console.warn(`${LOG_PREFIX} ANALYZE error:`, result)
        } else {
          console.error(`${LOG_PREFIX} ANALYZE error:`, result)
        }
      } else if (result.skip) {
        console.log(`${LOG_PREFIX} ANALYZE skip reason="${result.reason ?? ''}"`)
      } else {
        console.log(
          `${LOG_PREFIX} ANALYZE ok provocations=${result.provocations.length} ` +
            `analysis_id=${result.analysis_id}`,
        )
      }
      return result
    }

    case 'LOG_EVENT': {
      const result = await logEvent(message.payload, getAccessTokenWithRefresh)
      if (isApiError(result)) {
        if (result.kind === 'AUTH_REQUIRED' || result.kind === 'QUOTA_EXCEEDED') {
          console.warn(
            `${LOG_PREFIX} LOG_EVENT error:`,
            result,
            'payload:',
            message.payload,
          )
        } else {
          console.error(
            `${LOG_PREFIX} LOG_EVENT error:`,
            result,
            'payload:',
            message.payload,
          )
        }
      } else {
        console.log(
          `${LOG_PREFIX} LOG_EVENT ok event=${message.payload.event_type} ` +
            `analysis_id=${message.payload.analysis_id}`,
        )
      }
      // Fire-and-forget semantics: caller doesn't get the error.
      return { ok: true }
    }

    case 'AUTH_STATUS': {
      const status = await getAuthStatus()
      console.log(`${LOG_PREFIX} AUTH_STATUS logged_in=${status.logged_in}`)
      return status
    }

    case 'EXPLAIN_PROVOCATION': {
      console.log(
        `${LOG_PREFIX} EXPLAIN_PROVOCATION analysis_id=${message.payload.analysis_id} idx=${message.payload.provocation_index}`,
      )
      const result = await explainProvocation(
        message.payload,
        getAccessTokenWithRefresh,
      )
      if (isApiError(result)) {
        if (result.kind === 'AUTH_REQUIRED' || result.kind === 'QUOTA_EXCEEDED') {
          console.warn(`${LOG_PREFIX} EXPLAIN_PROVOCATION error:`, result)
        } else {
          console.error(`${LOG_PREFIX} EXPLAIN_PROVOCATION error:`, result)
        }
      } else {
        console.log(
          `${LOG_PREFIX} EXPLAIN_PROVOCATION ok len=${result.explanation.length}`,
        )
      }
      return result
    }

    case 'DEBUG_TEST_BACKEND': {
      console.log(`${LOG_PREFIX} DEBUG_TEST_BACKEND firing test payload`)
      const result = await analyzeResponse(
        DEBUG_TEST_PAYLOAD,
        getAccessTokenWithRefresh,
      )
      console.log(`${LOG_PREFIX} DEBUG_TEST_BACKEND result:`, result)
      return result
    }

    default: {
      const _exhaustive: never = message
      console.error(`${LOG_PREFIX} unknown message:`, _exhaustive)
      return { kind: 'UNKNOWN_MESSAGE' as const }
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  handleMessage(message as IncomingMessage)
    .then(sendResponse)
    .catch((err) => {
      console.error(`${LOG_PREFIX} handler error:`, err)
      sendResponse({ kind: 'INTERNAL_ERROR' as const })
    })
  // Keep the message channel open for the async response. Required for MV3.
  return true
})
