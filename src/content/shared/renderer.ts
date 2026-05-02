// ── content/shared/renderer.ts ────────────────────────────────
// Two distinct rendering paths:
//   1. Underline = plain DOM span inside the AI response (page CSS scope,
//      reads --crith-prov-color from <html>).
//   2. Floating logo + card = Shadow DOM host attached to document.body
//      (closed shadow root; reads --crith-prov-color via the same
//      custom property which inherits through the shadow boundary).
// All DOM nodes are built via createElement + textContent (no innerHTML).
//
// Ported from V1's provocations/renderer.js. V2 changes:
//   - Field names: provocation.text → .question, .underline_target →
//     .anchored_to, .type → .lens.
//   - Card markup: V1's three buttons (Dismiss/Useful/NotUseful) replaced
//     with V2's two (Ask this →, Dismiss). No in-card type label.
//   - Dot color: V1 hardcoded syc-dot/ver-dot classes → V2 single
//     .crith-prov-dot with inline color from getDotColor(lens).
//   - 'verification' renamed to 'hallucination'.

import { attach as attachCard } from './card'
import type { Lens, Provocation } from '../../shared/types'

const DEBUG = true
const LOG_PREFIX = '[Crith V2 PROV RENDER]'
function log(...args: unknown[]): void { if (DEBUG) console.log(LOG_PREFIX, ...args) }
function warn(...args: unknown[]): void { if (DEBUG) console.warn(LOG_PREFIX, ...args) }

const NARROW_VIEWPORT_PX = 768
const STACK_SPACING_PX = 28

const SHADOW_STYLES = `
  :host { all: initial; }
  .wrap {
    pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .crith-prov-logo {
    position: relative;
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--crith-prov-color, #4F46E5);
    cursor: pointer; transition: opacity 200ms ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    display: flex; align-items: center; justify-content: center;
  }
  .crith-prov-logo.pulse { animation: prov-pulse 1.6s ease-out 1; }
  .crith-prov-logo.handled { opacity: 0.4; }
  .crith-prov-mark { display: block; width: 11px; height: 16.5px; }

  .crith-prov-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  @keyframes prov-pulse {
    0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--crith-prov-color, #4F46E5) 50%, transparent); }
    80%  { box-shadow: 0 0 0 12px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  .card {
    position: absolute; top: 28px; right: 0;
    width: 320px; max-width: 90vw;
    background: #fff; color: #111;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 13px; line-height: 1.45;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    display: none;
  }
  .card.open { display: block; }
  .card .text {
    margin: 0 0 10px 0;
    transition: opacity 200ms ease;
  }
  .card .back-link {
    display: inline-block;
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--crith-prov-color, #4F46E5);
    text-decoration: none;
    cursor: pointer;
    transition: opacity 120ms ease;
  }
  .card .back-link:hover { opacity: 0.75; }
  .card .loader {
    margin: 0 0 10px 0;
    font-size: 13px;
    font-style: italic;
    color: rgba(0,0,0,0.55);
  }
  .card .error-msg {
    margin: 0 0 10px 0;
    font-size: 12px;
    color: #c1272d;
  }
  .card .controls {
    display: flex; gap: 8px; justify-content: flex-end;
  }
  .card .controls .btn-primary,
  .card .controls .btn-secondary {
    font: inherit; cursor: pointer;
    border-radius: 4px;
    font-weight: 500;
  }
  .card .controls .btn-primary {
    background: var(--crith-prov-color, #4F46E5);
    color: #fff;
    border: 1px solid transparent;
    padding: 4px 10px;
  }
  .card .controls .btn-primary:hover { filter: brightness(0.9); }
  .card .controls .btn-secondary {
    background: transparent;
    color: inherit;
    border: 1px solid rgba(0,0,0,0.12);
    padding: 4px 8px;
  }
  .card .controls .btn-secondary:hover { background: rgba(0,0,0,0.04); }

  @media (prefers-color-scheme: dark) {
    .card {
      background: #1f1f23; color: #f0f0f0;
      border-color: rgba(255,255,255,0.08);
    }
    .card .loader { color: rgba(255,255,255,0.55); }
    .card .error-msg { color: #ff6961; }
    .card .controls .btn-secondary {
      border-color: rgba(255,255,255,0.12);
    }
    .card .controls .btn-secondary:hover {
      background: rgba(255,255,255,0.06);
    }
  }
`

// Crith brand mark — same 12x18 path geometry as V1.
const SVG_NS = 'http://www.w3.org/2000/svg'
type SvgChild = readonly [tag: string, attrs: Record<string, string>]
const BRAND_MARK_ELEMENTS: readonly SvgChild[] = [
  ['path', { d: 'M 10 0 C 10 1.5 8 3 6 4.5',     'stroke-width': '2' }],
  ['path', { d: 'M 10 9 C 10 10.5 8 12 6 13.5',  'stroke-width': '2' }],
  ['line', { x1: '2.5', y1: '2',    x2: '9.5', y2: '2',    'stroke-width': '0.8', opacity: '0.85' }],
  ['line', { x1: '2.5', y1: '7.5',  x2: '9.5', y2: '7.5',  'stroke-width': '0.8', opacity: '0.85' }],
  ['line', { x1: '2.5', y1: '10.5', x2: '9.5', y2: '10.5', 'stroke-width': '0.8', opacity: '0.85' }],
  ['line', { x1: '2.5', y1: '16',   x2: '9.5', y2: '16',   'stroke-width': '0.8', opacity: '0.85' }],
  ['path', { d: 'M 2 0 C 2 1.5 4 3 6 4.5',       'stroke-width': '2' }],
  ['path', { d: 'M 6 4.5 C 8 6 10 7.5 10 9',     'stroke-width': '2' }],
  ['path', { d: 'M 6 4.5 C 4 6 2 7.5 2 9',       'stroke-width': '2' }],
  ['path', { d: 'M 2 9 C 2 10.5 4 12 6 13.5',    'stroke-width': '2' }],
  ['path', { d: 'M 6 13.5 C 4 15 2 16.5 2 18',   'stroke-width': '2' }],
  ['path', { d: 'M 6 13.5 C 8 15 10 16.5 10 18', 'stroke-width': '2' }],
]

function buildBrandMark(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'crith-prov-mark')
  svg.setAttribute('viewBox', '0 0 12 18')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', '#fff')
  svg.setAttribute('stroke-linecap', 'round')
  for (const [tag, attrs] of BRAND_MARK_ELEMENTS) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]!)
    svg.appendChild(el)
  }
  return svg
}

/**
 * V2 dot color logic.
 *   sycophancy    → orange #F59E0B
 *   hallucination → purple #A855F7
 *   anything else → null (no dot rendered)
 * Unknown future lens names safely fall through to null.
 */
function getDotColor(lens: Lens): string | null {
  if (lens === 'sycophancy') return '#F59E0B'
  if (lens === 'hallucination') return '#A855F7'
  return null
}

/** Lenses that should render a thicker underline. Mirrors V1's behavior. */
function isHighSignalLens(lens: Lens): boolean {
  return lens === 'sycophancy' || lens === 'hallucination'
}

/**
 * Render an array of provocations against a single response node. Each
 * gets its own underline + shadow-DOM host, stacked vertically.
 */
export function show(responseNode: Element, provocations: Provocation[]): void {
  if (!Array.isArray(provocations) || provocations.length === 0) return
  let stackIndex = 0
  for (const provocation of provocations) {
    if (!provocation) continue
    const provocationId = provocation.provocation_id
    if (!provocationId) continue

    // Idempotency: skip if a host for this provocation id already exists.
    try {
      const sel = `crith-prov-host[data-prov-id="${CSS.escape(provocationId)}"]`
      if (document.querySelector(sel)) { stackIndex++; continue }
    } catch { /* noop */ }

    const target = provocation.anchored_to || ''

    // Dedupe by anchored_to — replace any prior render that targets the
    // same phrase (handles outer/inner wrapper double-fire on ChatGPT).
    if (target) {
      document.querySelectorAll('crith-prov-host[data-target]').forEach((host) => {
        if (host.getAttribute('data-target') !== target) return
        try { host.remove() } catch { /* noop */ }
      })
      document.querySelectorAll('span.crith-prov-underline').forEach((span) => {
        if (span.textContent !== target) return
        const parent = span.parentNode
        if (!parent) return
        while (span.firstChild) parent.insertBefore(span.firstChild, span)
        parent.removeChild(span)
      })
    }

    const spans = wrapUnderline(responseNode, provocation.anchored_to, provocation.lens)
    if (spans.length === 0) continue
    const firstSpan = spans[0]
    if (!firstSpan) continue

    const host = createHost(provocationId, provocation, spans)
    if (target) host.setAttribute('data-target', target)
    host.setAttribute('data-stack-index', String(stackIndex))
    document.body.appendChild(host)
    positionHost(host, firstSpan, responseNode)
    attachReposition(host, firstSpan, responseNode)

    requestAnimationFrame(() => {
      try {
        const logo = host.shadowRootClosed?.querySelector?.('.crith-prov-logo')
        if (logo) logo.classList.add('pulse')
      } catch { /* noop */ }
    })

    stackIndex++
  }
}

function wrapUnderline(responseNode: Element, target: string, lens: Lens): HTMLSpanElement[] {
  if (!target || target.length < 3) {
    warn(`empty/short anchored_to (len ${target?.length ?? 0}) — skipping`)
    return []
  }
  const walker = document.createTreeWalker(responseNode, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)

  const full = textNodes.map((t) => t.nodeValue ?? '').join('')
  const offset = full.indexOf(target)
  if (offset < 0) {
    warn(
      `anchored_to NOT FOUND verbatim in response — backend likely paraphrased instead of quoting exactly`,
      `\n  target (${target.length} chars): "${target.slice(0, 140)}${target.length > 140 ? '…' : ''}"`,
      `\n  response head (${full.length} total): "${full.slice(0, 200)}…"`,
    )
    return []
  }
  const endOffset = offset + target.length

  let cursor = 0
  const wraps: { node: Text; start: number; end: number }[] = []
  for (const tn of textNodes) {
    const len = (tn.nodeValue ?? '').length
    const tnStart = cursor
    const tnEnd = cursor + len
    cursor = tnEnd
    if (tnEnd <= offset || tnStart >= endOffset) continue
    const sliceStart = Math.max(0, offset - tnStart)
    const sliceEnd = Math.min(len, endOffset - tnStart)
    wraps.push({ node: tn, start: sliceStart, end: sliceEnd })
  }
  if (wraps.length === 0) return []

  const spans: HTMLSpanElement[] = []
  for (const w of wraps) {
    const value = w.node.nodeValue ?? ''
    const before = value.slice(0, w.start)
    const middle = value.slice(w.start, w.end)
    const after = value.slice(w.end)
    const span = document.createElement('span')
    span.className = 'crith-prov-underline'
    // Attribute boosts CSS specificity to (0,2,1) — beats site rules
    // like `.markdown-body p span` (0,1,3) that would otherwise hide
    // the underline while the logo still anchors correctly.
    span.setAttribute('data-crith-prov', 'underline')
    if (isHighSignalLens(lens)) {
      span.setAttribute('data-crith-prov-type', lens)
    }
    span.textContent = middle
    const parent = w.node.parentNode
    if (!parent) continue
    if (before) parent.insertBefore(document.createTextNode(before), w.node)
    parent.insertBefore(span, w.node)
    if (after) parent.insertBefore(document.createTextNode(after), w.node)
    parent.removeChild(w.node)
    spans.push(span)
  }
  log(`wrapped ${spans.length} span(s) for "${target.slice(0, 60)}${target.length > 60 ? '…' : ''}" (lens=${lens})`)
  return spans
}

// Closed shadow roots aren't readable via host.shadowRoot. We stash the
// root on the host element with a non-standard property so the rAF pulse
// step can find the logo. Type augmentation on HTMLElement is local.
type HostWithShadow = HTMLElement & { shadowRootClosed?: ShadowRoot }

function createHost(
  provocationId: string,
  provocation: Provocation,
  underlineSpans: HTMLSpanElement[],
): HostWithShadow {
  const host = document.createElement('crith-prov-host') as HostWithShadow
  host.setAttribute('data-prov-id', provocationId)
  // position: fixed (viewport-anchored). ChatGPT's <body> doesn't scroll —
  // the conversation thread has its own inner scroll container — so an
  // absolutely-positioned host anchored to body would stay at a fixed
  // PAGE coordinate and become off-screen the moment the chat scrolls.
  host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;'
  const root = host.attachShadow({ mode: 'closed' })
  host.shadowRootClosed = root

  const style = document.createElement('style')
  style.textContent = SHADOW_STYLES
  root.appendChild(style)

  const wrap = document.createElement('div')
  wrap.className = 'wrap'

  const logo = document.createElement('div')
  logo.className = 'crith-prov-logo'
  logo.title = 'Crith provocation'
  logo.appendChild(buildBrandMark())

  const dotColor = getDotColor(provocation.lens)
  if (dotColor) {
    const dot = document.createElement('div')
    dot.className = 'crith-prov-dot'
    dot.style.background = dotColor
    logo.appendChild(dot)
  }
  wrap.appendChild(logo)

  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.state = 'default'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'Provocation')

  // "← Back to question" link, hidden until the card enters the
  // explained state. Click reverts to the question text without
  // re-fetching the explanation (cached on card.ts state).
  const backLink = document.createElement('a')
  backLink.className = 'back-link'
  backLink.setAttribute('data-action', 'back')
  backLink.setAttribute('href', '#')
  backLink.textContent = '← Back to question'
  backLink.hidden = true
  card.appendChild(backLink)

  // Main text — holds question text by default, swapped to the
  // explanation while in the explained state.
  const text = document.createElement('p')
  text.className = 'text'
  text.textContent = (provocation.question || '').slice(0, 220)
  card.appendChild(text)

  // Loading indicator while EXPLAIN_PROVOCATION is in flight.
  const loader = document.createElement('p')
  loader.className = 'loader'
  loader.textContent = 'Thinking…'
  loader.hidden = true
  card.appendChild(loader)

  // Transient error message — shown for 3s after a failed explain call.
  const errorMsg = document.createElement('p')
  errorMsg.className = 'error-msg'
  errorMsg.textContent = "Couldn't explain — try again."
  errorMsg.hidden = true
  card.appendChild(errorMsg)

  const controls = document.createElement('div')
  controls.className = 'controls'

  // V2 buttons. Order: Not useful, Explain, Useful (rightmost = primary).
  const buttons: Array<{ cls: string; action: string; label: string }> = [
    { cls: 'btn-secondary', action: 'not_useful', label: 'Not useful' },
    { cls: 'btn-secondary', action: 'explain',    label: 'Explain' },
    { cls: 'btn-primary',   action: 'useful',     label: 'Useful' },
  ]
  for (const b of buttons) {
    const btn = document.createElement('button')
    btn.className = b.cls
    btn.setAttribute('data-action', b.action)
    btn.setAttribute('aria-label', b.label)
    btn.textContent = b.label
    controls.appendChild(btn)
  }

  card.appendChild(controls)
  wrap.appendChild(card)
  root.appendChild(wrap)

  attachCard(host, root, provocation, underlineSpans)
  return host
}

function positionHost(host: HTMLElement, span: Element, responseNode: Element): void {
  const r = span.getBoundingClientRect()
  const stackIndex = parseInt(host.getAttribute('data-stack-index') ?? '0', 10) || 0
  const stackY = stackIndex * STACK_SPACING_PX
  if (window.innerWidth < NARROW_VIEWPORT_PX) {
    host.style.transform = `translate(${Math.max(8, r.left)}px, ${r.bottom + 6 + stackY}px)`
  } else {
    const responseRight = responseNode.getBoundingClientRect().right
    const x = Math.min(responseRight + 6, window.innerWidth - 28)
    host.style.transform = `translate(${x}px, ${r.top + stackY}px)`
  }
}

function attachReposition(host: HTMLElement, span: Element, responseNode: Element): void {
  // Three signal sources track the underline's viewport rect:
  //   1. window scroll (capture:true) — catches inner-container scrolls
  //      that don't bubble (ChatGPT's chat scroller doesn't bubble).
  //   2. window resize — viewport changes (zoom, devtools, window).
  //   3. ResizeObserver on responseNode + documentElement — content
  //      reflow above the underline (image hydration, code block
  //      expansion, font swap, side panel toggle) moves the rect
  //      without firing scroll. This is the dominant cause per V1 audit.
  let pending = false
  let resizeObs: ResizeObserver | null = null
  const cleanup = (): void => {
    try { window.removeEventListener('scroll', schedule, true) } catch { /* noop */ }
    try { window.removeEventListener('resize', schedule) } catch { /* noop */ }
    try { resizeObs?.disconnect() } catch { /* noop */ }
  }
  const reposition = (): void => {
    pending = false
    if (!document.body.contains(host) || !document.body.contains(span)) {
      cleanup()
      return
    }
    positionHost(host, span, responseNode)
  }
  const schedule = (): void => {
    if (pending) return
    pending = true
    requestAnimationFrame(reposition)
  }
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  window.addEventListener('resize', schedule)
  try {
    resizeObs = new ResizeObserver(schedule)
    resizeObs.observe(responseNode)
    resizeObs.observe(document.documentElement)
  } catch { /* noop */ }
}
