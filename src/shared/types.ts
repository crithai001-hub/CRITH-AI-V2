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

/**
 * Canonical post-v14 shape (sent by the backend as `validations`).
 * `problem` is a 1-2 sentence declarative statement of what the AI did
 * wrong (≤300 chars). `follow_up_prompt` is the first-person prompt
 * the user can fire back at the AI on Ask AI (≤450 chars).
 */
export type Validation = {
  provocation_id?: string | undefined
  analysis_id?: string | undefined
  provocation_index?: number | undefined
  /** 1-2 sentence statement, declarative. Shown in the card body. */
  problem: string
  /** Ready-to-fire prompt for Ask AI. Empty string disables the button. */
  follow_up_prompt: string
  lens: Lens
  /** Verbatim substring of the AI response. Renderer wraps it with an underline. */
  anchored_to: string
  severity?: Severity | undefined
}

/**
 * Legacy pre-v14 shape (was sent as `provocations`). The orchestrator
 * normalizes any incoming `provocations` array into Validation by
 * mapping question → problem and follow_up_prompt = ''. Kept in the
 * type system only for the response-shape fallback during rollout.
 */
export type Provocation = {
  provocation_id?: string
  analysis_id?: string
  provocation_index?: number
  question: string
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
  /** Canonical post-v14 array. Preferred when present. */
  validations?: Validation[]
  /** Legacy pre-v14 array. Used as a fallback for older deploys. */
  provocations?: Provocation[]
  /** Fact-check candidates surfaced by the claim-extractor. */
  verifiable_claims?: VerifiableClaim[]
  /** Provenance for the system prompts that produced this response. */
  prompt_versions?: PromptVersions
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
  | 'asked_ai'
  | 'verified'

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

// ── Verifiable claims (fact-check pipeline) ──────────────────

export type ClaimType =
  | 'statistic'
  | 'citation'
  | 'person_or_role'
  | 'date'
  | 'product_or_pricing'
  | 'current_state'
  | 'quote'
  | 'technical_fact'

export type Risk = 'high' | 'medium' | 'low'

export type Verdict = 'confirmed' | 'contradicted' | 'inconclusive' | 'error'

export type VerifiableClaim = {
  /** Searchable, display-ready form of the claim. */
  claim: string
  /** Verbatim 30-80 char substring of the AI response (renderer underlines this). */
  anchored_to: string
  claim_type: ClaimType
  /** One sentence — shown in the card body. */
  why_verify: string
  risk: Risk
  /** Stamped by the orchestrator from AnalyzeResponseSuccess.analysis_id. */
  analysis_id?: string
  /** Index within verifiable_claims[]. Stamped by orchestrator. */
  claim_index?: number
}

export type PromptVersions = {
  validator: string
  claim_extractor: string
}

export type VerifyClaimRequest = {
  analysis_id: string
  claim_index: number
}

export type VerifyClaimResponse = {
  verdict: Verdict
  evidence_summary: string
  source_urls: string[]
  verification_id: string
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
export type VerifyClaimMessage = {
  type: 'VERIFY_CLAIM'
  payload: VerifyClaimRequest
}
/** Removed before launch — manual end-to-end pipeline test. */
export type DebugTestBackendMessage = { type: 'DEBUG_TEST_BACKEND' }

export type IncomingMessage =
  | AnalyzeMessage
  | LogEventMessage
  | AuthStatusMessage
  | ExplainProvocationMessage
  | VerifyClaimMessage
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
  /**
   * Per-message streaming-state probe. Returns true while the AI is
   * still generating into `messageNode` and false when generation has
   * completed. Treated as the PRIMARY fire signal — when isStreaming
   * was true and is now false, the observer fires immediately. Adapters
   * that can't reliably detect streaming should return false at all
   * times; the observer falls back to text-stability detection.
   */
  isStreaming: (messageNode: Element) => boolean
  /**
   * Programmatically set the platform's input field to `prompt` and
   * submit it (the same effect as the user typing + clicking send).
   * Returns true on success, false if the input or send button can't
   * be found / can't be triggered. Used by the card's "Ask AI" button.
   */
  sendToInput: (prompt: string) => Promise<boolean>
}
