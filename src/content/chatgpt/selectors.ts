// ChatGPT selectors — last verified working: 2026-04-30
//
// If the observer stops firing or extraction returns wrong text, this is the
// FIRST file to update. Prefer stable attributes (data-*, ARIA roles) over
// CSS classes — ChatGPT minifies and rotates classes frequently.
//
// All selectors are scoped to the conversation container so we never query
// the entire document and never accidentally match the sidebar/header.

/**
 * Top-level conversation container. The conversation pane in ChatGPT is the
 * `<main>` element. This has been the conversation root since at least 2024
 * across both chatgpt.com and chat.openai.com layouts.
 *
 * The MutationObserver attaches here.
 */
export const MESSAGE_CONTAINER_SELECTOR = 'main'

/**
 * User message turn. The `data-message-author-role` attribute is the
 * canonical message-type identifier and has been stable since the original
 * ChatGPT release.
 */
export const USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]'

/**
 * Assistant (AI) message turn. Same attribute pattern as the user selector.
 * The element matching this selector is also the one carrying
 * `data-message-id` — the per-message UUID we report upstream.
 */
export const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]'

/**
 * Inner text container within a message element. We try these in order:
 *   1. `.markdown`           — rendered markdown wrapper (assistant messages)
 *   2. `.whitespace-pre-wrap`— plaintext wrapper (user messages, code blocks)
 * If neither matches we fall back to the message element's `innerText`.
 */
export const MESSAGE_CONTENT_SELECTORS = [
  '.markdown',
  '.whitespace-pre-wrap',
] as const

/**
 * Streaming indicator — present (as a descendant of the assistant message)
 * while tokens are being generated and removed when generation completes.
 *
 * Multiple known indicators across ChatGPT versions are listed; the observer
 * treats a message as "streaming" if ANY of these match. The `result-streaming`
 * class has been the most consistent over time, but ChatGPT has shipped both
 * attribute- and class-based variants.
 */
export const STREAMING_INDICATOR_SELECTORS = [
  '.result-streaming',
  '[data-message-streaming="true"]',
] as const
