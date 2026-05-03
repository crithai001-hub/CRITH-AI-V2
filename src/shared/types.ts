// ── Auth ─────────────────────────────────────────────────────

export type AuthTokens = {
  access_token: string
  refresh_token: string
  /** Unix timestamp in seconds. */
  expires_at: number
}

// ── Domain ───────────────────────────────────────────────────

export type Platform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'grok'
  | 'deepseek'

/**
 * Lens label attached to a provocation. Backend-defined; treated as opaque
 * string for forward-compatibility — the backend can ship new lens names
 * without breaking the extension's TS build. Unknown lens values are safe
 * to render: getDotColor returns null and the dot simply isn't drawn.
 *
 * Current values (system prompt v2):
 *   'sycophancy', 'hallucination', 'hidden_assumption',
 *   'missing_angle', 'confidence_evidence_gap', 'question_mismatch'.
 */
export type Lens = string

/** Severity tier — fixed by the system prompt; not forward-compat. */
export type Severity = 'low' | 'medium' | 'high'

export type Provocation = {
  /**
   * Stable per-provocation id. Backend may return it; if absent the
   * orchestrator injects `${analysis_id}-${index}` before passing to the
   * renderer. Renderer uses it for idempotency keys and dedup.
   */
  provocation_id?: string
  /**
   * Analysis-level id this provocation belongs to. Set by the
   * orchestrator from AnalyzeResponseSuccess.analysis_id when mapping
   * the response. Used by EXPLAIN_PROVOCATION + LOG_EVENT calls.
   */
  analysis_id?: string
  /**
   * Index of this provocation within the analysis_id's provocations
   * array. Set by the orchestrator. Used as the second key for
   * EXPLAIN_PROVOCATION + LOG_EVENT calls.
   */
  provocation_index?: number
  /** The provocation text shown in the card. */
  question: string
  /** Verbatim substring of the AI response to wrap with the underline. */
  anchored_to: string
  lens: Lens
  severity?: Severity
}

// ── /api/analyze-response ────────────────────────────────────

/**
 * One prior message in the conversation that led up to the message
 * being analyzed. Sent as `conversation_history` so the analyzer can
 * stop falsely flagging things the user already specified earlier.
 */
export type ConversationTurn = {
  role: 'user' | 'assistant'
  content: string
}

export type AnalyzeRequest = {
  prompt: string
  response: string
  platform: Platform
  conversation_id: string
  message_id: string
  /**
   * Last 6 prior turns in oldest-first order. Each `content` is capped
   * at 1500 chars (truncated with a `[...]` suffix). Empty array OR
   * field omitted are equivalent — backend treats both as
   * single-turn analysis.
   */
  conversation_history?: ConversationTurn[]
}

export type AnalyzeResponseSuccess = {
  skip: false
  provocations: Provocation[]
  analysis_id: string
}

export type AnalyzeResponseSkip = {
  skip: true
  reason?: string
}

export type AnalyzeResponse = AnalyzeResponseSuccess | AnalyzeResponseSkip

// ── /api/events ──────────────────────────────────────────────

export type EventType =
  | 'shown'
  | 'expanded'
  | 'sent_to_ai'
  | 'dismissed'
  | 'copied'
  | 'explained'
  | 'useful'
  | 'not_useful'

export type EventRequest = {
  analysis_id: string
  provocation_index: number
  event_type: EventType
}

// ── /api/explain-provocation ─────────────────────────────────

export type ExplainRequest = {
  analysis_id: string
  provocation_index: number
}

export type ExplainResponse = {
  explanation: string
}

// ── API errors ───────────────────────────────────────────────

export type ApiError =
  | { kind: 'AUTH_REQUIRED' }
  | { kind: 'NETWORK_ERROR'; message: string }
  | {
      kind: 'QUOTA_EXCEEDED'
      limit: number | null
      used: number | null
      message: string
    }
  | { kind: 'SERVER_ERROR'; status: number }
  | { kind: 'PARSE_ERROR'; message: string }

// ── Extension-internal messages ──────────────────────────────

export type AnalyzeMessage = { type: 'ANALYZE'; payload: AnalyzeRequest }
export type LogEventMessage = { type: 'LOG_EVENT'; payload: EventRequest }
export type AuthStatusMessage = { type: 'AUTH_STATUS' }
export type ExplainProvocationMessage = {
  type: 'EXPLAIN_PROVOCATION'
  payload: ExplainRequest
}
/** Removed before launch — manual end-to-end pipeline test. */
export type DebugTestBackendMessage = { type: 'DEBUG_TEST_BACKEND' }

export type IncomingMessage =
  | AnalyzeMessage
  | LogEventMessage
  | AuthStatusMessage
  | ExplainProvocationMessage
  | DebugTestBackendMessage

export type AuthStatusResponse =
  | { logged_in: true; email: string }
  | { logged_in: false }

// ── Content-script platform adapter ──────────────────────────

/**
 * 7-method contract every platform adapter must satisfy. Ported verbatim
 * from V1. Each adapter file in src/content/platforms/ exports a single
 * `adapter: PlatformAdapter` matching this shape.
 */
export type PlatformAdapter = {
  name: string
  /** Returns the chat-thread root the MutationObserver will attach to. */
  getChatContainer: () => Element | null
  /** True if `node` is (or contains) an AI-response message element. */
  isResponseNode: (node: Element) => boolean
  /** Extract the AI response text from a response node. */
  getResponseText: (node: Element) => string
  /** Find the user prompt that preceded a given response node. */
  getPromptForResponse: (node: Element) => string | null
  /** Conversation/session id from the URL — `'home'` if no path slug. */
  getSessionId: () => string
  /** Every AI-response Element currently in the DOM, deduped. */
  getAllResponseNodes: () => Element[]
  /**
   * Walk the DOM backward from `currentResponseNode` to collect prior
   * turns of the conversation. Returns oldest-first, last 6 max,
   * each turn's content capped at 1500 chars. Empty array on first
   * turn or when DOM walk can't locate any priors.
   */
  getPriorTurns: (currentResponseNode: Element) => ConversationTurn[]
}
