// ── content/shared/quota-banner.ts ────────────────────────────
// One-time toast for verify-quota exhaustion. Appears in the
// page (NOT the shadow DOM — we want the user to see it the same
// way they see other in-page chrome). Auto-dismisses after 8s; user
// can click to dismiss sooner.

const BANNER_ID = 'crith-quota-banner'
const AUTO_DISMISS_MS = 8000

let bannerShown = false

/**
 * Show the verify-quota banner once per session. Subsequent calls are
 * no-ops. The orchestrator pairs this with a session-level halt flag
 * so we both inform the user AND stop firing verify calls that would
 * just 429 again.
 */
export function showQuotaBanner(message: string): void {
  if (bannerShown) return
  bannerShown = true

  // Don't try to render before the document is ready. If the script
  // runs at document_start (currently it doesn't, but defend anyway)
  // body is null and appendChild throws.
  if (!document.body) {
    document.addEventListener(
      'DOMContentLoaded',
      () => showQuotaBanner(message),
      { once: true },
    )
    bannerShown = false
    return
  }

  if (document.getElementById(BANNER_ID)) return

  const banner = document.createElement('div')
  banner.id = BANNER_ID
  banner.setAttribute('role', 'status')
  banner.setAttribute('aria-live', 'polite')
  banner.style.cssText = [
    'position: fixed',
    'top: 16px',
    'right: 16px',
    'z-index: 2147483647',
    'max-width: 360px',
    'padding: 10px 14px',
    'border-radius: 8px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'font-size: 13px',
    'line-height: 1.4',
    'color: #92400e',
    'background: #fef3c7',
    'border: 1px solid #fbbf24',
    'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12)',
    'cursor: pointer',
    'user-select: none',
  ].join('; ')
  banner.textContent = message
  banner.title = 'Click to dismiss'

  const dismiss = (): void => {
    try { banner.remove() } catch { /* noop */ }
  }
  banner.addEventListener('click', dismiss)
  setTimeout(dismiss, AUTO_DISMISS_MS)

  document.body.appendChild(banner)
}

/** Test-only reset. Vitest can call this between tests. */
export function _resetQuotaBannerForTest(): void {
  bannerShown = false
  try { document.getElementById(BANNER_ID)?.remove() } catch { /* noop */ }
}
