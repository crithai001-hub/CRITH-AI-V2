// ── Auth ─────────────────────────────────────────────────────

export type AuthTokens = {
  access_token: string
  refresh_token: string
  /** Unix timestamp in seconds. */
  expires_at: number
}

// ── Domain ───────────────────────────────────────────────────

export type Platform = 'chatgpt' | 'claude' | 'gemini'

/**
 * Lens label attached to a provocation. Backend-defined enum;
 * treat as opaque string for forward compatibility.
 * Examples expected today: 'logical-gap', 'unstated-assumption',
 * 'easy-validation'.
 */
export type Lens = string

/** Severity tier. Backend-defined. */
export type Severity = 'low' | 'medium' | 'high'

export type Provocation = {
  question: string
  lens: Lens
  severity?: Severity
}

// ── /api/analyze-response ────────────────────────────────────

export type AnalyzeRequest = {
  prompt: string
  response: string
  platform: Platform
  conversation_id: string
  message_id: string
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

export type EventRequest = {
  analysis_id: string
  provocation_index: number
  event_type: EventType
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
/** Removed before launch — manual end-to-end pipeline test. */
export type DebugTestBackendMessage = { type: 'DEBUG_TEST_BACKEND' }

export type IncomingMessage =
  | AnalyzeMessage
  | LogEventMessage
  | AuthStatusMessage
  | DebugTestBackendMessage

export type AuthStatusResponse =
  | { logged_in: true; email: string }
  | { logged_in: false }
