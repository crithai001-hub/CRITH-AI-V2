// ── content/shared/chat-status-pill.ts ────────────────────────
// Chat-level rollup pill. Sits fixed top-right of the viewport;
// shows an aggregated status of what's been flagged across every
// AI response in the current conversation.
//
// State model:
//   - responses_analyzed: incremented after each ANALYZE returns
//   - claims_detected:    sum of verifiable_claims across responses
//   - claims_signal_high_or_medium: subset that warranted verification
//   - claims_contradicted: subset that came back contradicted
//   - claims_confirmed:    subset that came back confirmed
//   - validations:        sum of post-v14 validations (gap-spotting)
//
// The compact pill visualizes the worst-case flag so a glance tells
// you whether anything is actively suspect. Hover expands to a panel
// with the full breakdown.
//
// Reset semantics: counts are wiped on SPA URL change (new chat) by
// resetChatStatus(); orchestrator calls it from the URL watcher.

const PILL_ID = 'crith-chat-status-pill'
const HOVER_GRACE_MS = 200

type ChatStatus = {
  responses_analyzed: number
  validations: number
  claims_detected: number
  claims_signal_eligible: number
  claims_contradicted: number
  claims_confirmed: number
  claims_inconclusive: number
}

const initial: ChatStatus = {
  responses_analyzed: 0,
  validations: 0,
  claims_detected: 0,
  claims_signal_eligible: 0,
  claims_contradicted: 0,
  claims_confirmed: 0,
  claims_inconclusive: 0,
}

let status: ChatStatus = { ...initial }
let pillEl: HTMLElement | null = null
let panelEl: HTMLElement | null = null
let collapseTimer: ReturnType<typeof setTimeout> | null = null

// ── State updates ────────────────────────────────────────────

/**
 * Called by the orchestrator after each ANALYZE returns successfully.
 * `validationCount` and `claimCount` are post-enrichment counts.
 * `signalEligibleCount` is the subset that will be sent to verify.
 */
export function recordResponseAnalyzed(params: {
  validationCount: number
  claimCount: number
  signalEligibleCount: number
}): void {
  status.responses_analyzed += 1
  status.validations += params.validationCount
  status.claims_detected += params.claimCount
  status.claims_signal_eligible += params.signalEligibleCount
  ensurePill()
  renderPill()
}

/** Called for each verify response, regardless of verdict. */
export function recordVerdict(verdict: string): void {
  if (verdict === 'contradicted') status.claims_contradicted += 1
  else if (verdict === 'confirmed') status.claims_confirmed += 1
  else if (verdict === 'inconclusive') status.claims_inconclusive += 1
  ensurePill()
  renderPill()
}

/** Called from the SPA URL watcher when a new chat is loaded. */
export function resetChatStatus(): void {
  status = { ...initial }
  if (pillEl) {
    try { pillEl.remove() } catch { /* noop */ }
  }
  pillEl = null
  panelEl = null
}

// ── Visual mapping ───────────────────────────────────────────

type StatusLevel = 'idle' | 'clean' | 'flagged' | 'critical'

function deriveLevel(s: ChatStatus): StatusLevel {
  if (s.responses_analyzed === 0) return 'idle'
  if (s.claims_contradicted >= 3) return 'critical'
  if (s.claims_contradicted >= 1) return 'flagged'
  return 'clean'
}

const LEVEL_COLORS: Record<StatusLevel, { bg: string; ring: string; fg: string }> = {
  idle:     { bg: 'rgba(120, 120, 130, 0.18)', ring: 'rgba(120, 120, 130, 0.35)', fg: '#52525b' },
  clean:    { bg: 'rgba(16, 163, 127, 0.18)',  ring: 'rgba(16, 163, 127, 0.45)',  fg: '#047857' },
  flagged:  { bg: 'rgba(245, 158, 11, 0.20)',  ring: 'rgba(245, 158, 11, 0.55)',  fg: '#b45309' },
  critical: { bg: 'rgba(193, 39, 45, 0.20)',   ring: 'rgba(193, 39, 45, 0.55)',   fg: '#c1272d' },
}

const LEVEL_LABEL: Record<StatusLevel, string> = {
  idle:     'No analysis yet',
  clean:    'Looks clean',
  flagged:  'Issues flagged',
  critical: 'Multiple flags',
}

// ── DOM ──────────────────────────────────────────────────────

function ensurePill(): void {
  if (pillEl && document.body.contains(pillEl)) return
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', ensurePill, { once: true })
    return
  }
  buildPill()
}

function buildPill(): void {
  const host = document.createElement('div')
  host.id = PILL_ID
  host.style.cssText = [
    'position: fixed',
    'top: 72px',
    'right: 16px',
    'z-index: 2147483646',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'pointer-events: auto',
  ].join('; ')

  const pill = document.createElement('div')
  pill.setAttribute('role', 'button')
  pill.setAttribute('tabindex', '0')
  pill.setAttribute('aria-label', 'Crith chat status')
  pill.style.cssText = [
    'display: flex',
    'align-items: center',
    'gap: 6px',
    'padding: 6px 10px',
    'border-radius: 999px',
    'font-size: 12px',
    'font-weight: 600',
    'cursor: default',
    'user-select: none',
    'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10)',
    'transition: transform 120ms ease, box-shadow 120ms ease',
  ].join('; ')

  const dot = document.createElement('span')
  dot.className = 'crith-pill-dot'
  dot.style.cssText = [
    'width: 8px',
    'height: 8px',
    'border-radius: 50%',
  ].join('; ')

  const label = document.createElement('span')
  label.className = 'crith-pill-label'

  pill.appendChild(dot)
  pill.appendChild(label)

  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute',
    'top: calc(100% + 8px)',
    'right: 0',
    'min-width: 240px',
    'max-width: 320px',
    'background: #fff',
    'color: #111',
    'border: 1px solid rgba(0, 0, 0, 0.08)',
    'border-radius: 10px',
    'padding: 12px 14px',
    'box-shadow: 0 12px 28px rgba(0, 0, 0, 0.16)',
    'font-size: 12.5px',
    'line-height: 1.5',
    'display: none',
  ].join('; ')

  host.appendChild(pill)
  host.appendChild(panel)

  // Hover open / close (mouseenter/leave on the host so moving from
  // pill to panel is a single zone — no flicker between them).
  const open = (): void => {
    if (collapseTimer != null) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
    panel.style.display = 'block'
  }
  const closeSoon = (): void => {
    if (collapseTimer != null) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      panel.style.display = 'none'
    }, HOVER_GRACE_MS)
  }
  host.addEventListener('mouseenter', open)
  host.addEventListener('mouseleave', closeSoon)
  pill.addEventListener('focus', open)
  pill.addEventListener('blur', closeSoon)

  document.body.appendChild(host)
  pillEl = host
  panelEl = panel
}

function renderPill(): void {
  if (!pillEl || !panelEl) return
  const level = deriveLevel(status)
  const colors = LEVEL_COLORS[level]

  const pill = pillEl.querySelector('[role="button"]') as HTMLElement | null
  const dot = pillEl.querySelector('.crith-pill-dot') as HTMLElement | null
  const label = pillEl.querySelector('.crith-pill-label') as HTMLElement | null
  if (!pill || !dot || !label) return

  pill.style.background = colors.bg
  pill.style.color = colors.fg
  pill.style.border = `1px solid ${colors.ring}`
  dot.style.background = colors.fg

  // Compact label: most informative single number.
  const compact =
    status.claims_contradicted > 0
      ? `${status.claims_contradicted} false`
      : status.responses_analyzed === 0
        ? 'Crith'
        : `${status.validations + status.claims_signal_eligible} flag${
            status.validations + status.claims_signal_eligible === 1 ? '' : 's'
          }`
  label.textContent = compact

  renderPanel(level)
}

function renderPanel(level: StatusLevel): void {
  if (!panelEl) return
  panelEl.replaceChildren()

  const header = document.createElement('div')
  header.style.cssText = [
    'display: flex',
    'align-items: center',
    'justify-content: space-between',
    'gap: 8px',
    'margin: 0 0 8px 0',
    'font-weight: 600',
    'font-size: 13px',
  ].join('; ')
  const headerLabel = document.createElement('span')
  headerLabel.textContent = 'Chat status'
  const headerLevel = document.createElement('span')
  headerLevel.textContent = LEVEL_LABEL[level]
  headerLevel.style.cssText = [
    'font-size: 11px',
    'font-weight: 500',
    'color: ' + LEVEL_COLORS[level].fg,
    'background: ' + LEVEL_COLORS[level].bg,
    'border: 1px solid ' + LEVEL_COLORS[level].ring,
    'padding: 1px 8px',
    'border-radius: 999px',
  ].join('; ')
  header.appendChild(headerLabel)
  header.appendChild(headerLevel)
  panelEl.appendChild(header)

  const rows: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: 'Responses analyzed', value: String(status.responses_analyzed) },
    { label: 'Critical-thinking flags', value: String(status.validations) },
    { label: 'Claims detected', value: String(status.claims_detected) },
    {
      label: 'Sent for fact-check',
      value: String(status.claims_signal_eligible),
    },
    {
      label: 'Verified false',
      value: String(status.claims_contradicted),
      emphasis: status.claims_contradicted > 0,
    },
    {
      label: 'Verified true',
      value: String(status.claims_confirmed),
    },
  ]
  if (status.claims_inconclusive > 0) {
    rows.push({
      label: 'Inconclusive',
      value: String(status.claims_inconclusive),
    })
  }

  const list = document.createElement('div')
  list.style.cssText = [
    'display: grid',
    'grid-template-columns: 1fr auto',
    'row-gap: 4px',
    'column-gap: 12px',
  ].join('; ')

  for (const row of rows) {
    const k = document.createElement('span')
    k.textContent = row.label
    k.style.cssText = 'color: rgba(0, 0, 0, 0.6);'
    const v = document.createElement('span')
    v.textContent = row.value
    v.style.cssText = [
      'font-variant-numeric: tabular-nums',
      'font-weight: ' + (row.emphasis ? '700' : '500'),
      'color: ' + (row.emphasis ? '#c1272d' : '#111'),
      'text-align: right',
    ].join('; ')
    list.appendChild(k)
    list.appendChild(v)
  }
  panelEl.appendChild(list)

  if (status.responses_analyzed === 0) {
    const hint = document.createElement('p')
    hint.textContent = 'Send a message to start checking responses.'
    hint.style.cssText = [
      'margin: 8px 0 0 0',
      'font-size: 11.5px',
      'color: rgba(0, 0, 0, 0.55)',
    ].join('; ')
    panelEl.appendChild(hint)
  }
}

// Test-only reset (mirror quota-banner's escape hatch).
export function _resetChatStatusPillForTest(): void {
  resetChatStatus()
}
