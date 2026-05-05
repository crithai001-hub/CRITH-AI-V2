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
import { attachClaim } from './claim-card'
import type { Lens, Risk, Validation, VerifiableClaim } from '../../shared/types'

const DEBUG = true
const LOG_PREFIX = '[Crith V2 PROV RENDER]'
function log(...args: unknown[]): void { if (DEBUG) console.log(LOG_PREFIX, ...args) }
function warn(...args: unknown[]): void { if (DEBUG) console.warn(LOG_PREFIX, ...args) }

const NARROW_VIEWPORT_PX = 768
// Vertical offset between stacked logos for one response carrying
// multiple provocations. Bumped from 28 to 36 for the larger 24px
// logo + the 8px hit-area extension so adjacent hosts don't overlap
// each other's hover zones.
const STACK_SPACING_PX = 36

const SHADOW_STYLES = `
  :host { all: initial; }
  .wrap {
    pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .crith-prov-logo {
    position: relative;
    width: 24px; height: 24px; border-radius: 50%;
    background: var(--crith-prov-color, #4F46E5);
    cursor: pointer; transition: opacity 200ms ease, box-shadow 120ms ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    display: flex; align-items: center; justify-content: center;
  }
  /* Invisible hit-area extension. Pseudo-elements bubble pointer events
     to their parent, so hovering anywhere within ~40x40 around the logo
     triggers the same mouseenter as hovering the visible 24x24 circle.
     Makes the logo MUCH easier to land on with the cursor. */
  .crith-prov-logo::before {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 50%;
  }
  .crith-prov-logo:hover {
    box-shadow: 0 2px 6px rgba(0,0,0,0.22);
  }
  .crith-prov-logo.pulse { animation: prov-pulse 1.6s ease-out 1; }
  .crith-prov-logo.handled { opacity: 0.55; }
  .crith-prov-mark { display: block; width: 13px; height: 19.5px; }

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
    position: absolute; top: 32px; right: 0;
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
  /* Override our own display:inline-block when [hidden] is set in JS.
     Without this, the back-link stays visible in the default state
     because (0,3,0) specificity beats the UA's (0,1,0) [hidden] rule. */
  .card .back-link[hidden] { display: none; }
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
  /* Single-row layout: ratings cluster on the left, Ask AI on the
     right (margin-left: auto pushes the primary to the edge). The
     "Why this matters" button was removed; the validation problem
     text already does what explain was for. */
  .card .controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .card .controls .btn-primary {
    margin-left: auto;
  }
  .card .controls button {
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    padding: 6px 12px;
    border: 1px solid transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 80ms ease,
      filter 120ms ease;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }
  .card .controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
    transform: none;
    box-shadow: none;
  }

  /* Primary — "Useful". Filled accent, the action we want most often. */
  .card .controls .btn-primary {
    background: var(--crith-prov-color, #4F46E5);
    color: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .card .controls .btn-primary:hover:not(:disabled) {
    filter: brightness(0.93);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
    transform: translateY(-0.5px);
  }
  .card .controls .btn-primary:active:not(:disabled) {
    transform: translateY(0);
    filter: brightness(0.88);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  /* Secondary — "Not useful". Subtle bg, neutral border. */
  .card .controls .btn-secondary {
    background: rgba(0, 0, 0, 0.035);
    color: rgba(0, 0, 0, 0.72);
    border-color: rgba(0, 0, 0, 0.09);
  }
  .card .controls .btn-secondary:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.07);
    border-color: rgba(0, 0, 0, 0.16);
  }
  .card .controls .btn-secondary:active:not(:disabled) {
    background: rgba(0, 0, 0, 0.11);
  }

  /* Tertiary style retained but no longer used — kept in case a
     future card variant needs it. */
  .card .controls .btn-tertiary {
    background: transparent;
    color: var(--crith-prov-color, #4F46E5);
    border-color: color-mix(in srgb, var(--crith-prov-color, #4F46E5) 28%, transparent);
    font-size: 11.5px;
    padding: 5px 10px;
  }

  /* Marker for the rating button the user chose. Shown as a leading
     check glyph on the chosen button. The button itself is also
     disabled in card.ts so the rating can't be re-tapped, but the
     card stays accessible — hovering reopens for review. */
  .card .controls button.is-chosen::before {
    content: '\\2713\\00a0';
    font-weight: 600;
  }

  /* Smaller secondary buttons (Useful / Not useful) — visually
     subordinate to the Ask AI primary. */
  .card .controls .btn-secondary {
    font-size: 11.5px;
    padding: 5px 10px;
  }

  @media (prefers-color-scheme: dark) {
    .card {
      background: #1f1f23; color: #f0f0f0;
      border-color: rgba(255,255,255,0.08);
    }
    .card .loader { color: rgba(255,255,255,0.55); }
    .card .error-msg { color: #ff6961; }
    .card .controls .btn-secondary {
      background: rgba(255, 255, 255, 0.04);
      color: rgba(255, 255, 255, 0.78);
      border-color: rgba(255, 255, 255, 0.10);
    }
    .card .controls .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.18);
    }
    .card .controls .btn-secondary:active:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }
  }

  /* ── Claim host overrides ─────────────────────────────────
     Selectors are scoped via :host([data-kind="claim"]) so they
     only apply to claim hosts; validation hosts (no data-kind
     or data-kind="validation") get the styles above unchanged. */

  :host([data-kind="claim"]) .crith-prov-logo {
    background: #F59E0B;
  }
  :host([data-kind="claim"]) .card {
    width: 360px;
  }
  :host([data-kind="claim"]) .claim-header {
    display: flex;
    gap: 6px;
    margin: 0 0 8px 0;
    align-items: center;
  }
  :host([data-kind="claim"]) .claim-type-badge,
  :host([data-kind="claim"]) .risk-badge {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  :host([data-kind="claim"]) .claim-type-badge {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.7);
  }
  :host([data-kind="claim"]) .risk-badge[data-risk="high"] {
    background: rgba(245, 158, 11, 0.18);
    color: #b45309;
  }
  :host([data-kind="claim"]) .risk-badge[data-risk="medium"] {
    background: rgba(245, 158, 11, 0.10);
    color: #92560b;
  }
  :host([data-kind="claim"]) .risk-badge[data-risk="low"] {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.55);
  }
  :host([data-kind="claim"]) .claim-text {
    margin: 0 0 6px 0;
    font-size: 13px;
    line-height: 1.45;
    font-weight: 500;
  }
  :host([data-kind="claim"]) .why-verify {
    margin: 0 0 10px 0;
    font-size: 12px;
    line-height: 1.4;
    color: rgba(0, 0, 0, 0.6);
    font-style: italic;
  }
  :host([data-kind="claim"]) .verify-result {
    margin: 0 0 10px 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.025);
    border-left: 3px solid rgba(0, 0, 0, 0.1);
    border-radius: 0 6px 6px 0;
  }
  :host([data-kind="claim"]) .verdict-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    padding: 3px 8px;
    border-radius: 4px;
    margin: 0 0 6px 0;
  }
  :host([data-kind="claim"]) .verdict-confirmed {
    background: rgba(16, 163, 127, 0.15);
    color: #047857;
    border: 1px solid rgba(16, 163, 127, 0.3);
  }
  :host([data-kind="claim"]) .verdict-contradicted {
    background: rgba(193, 39, 45, 0.15);
    color: #c1272d;
    border: 1px solid rgba(193, 39, 45, 0.3);
  }
  :host([data-kind="claim"]) .verdict-inconclusive {
    background: rgba(0, 0, 0, 0.06);
    color: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(0, 0, 0, 0.15);
  }
  :host([data-kind="claim"]) .verdict-error {
    background: rgba(245, 158, 11, 0.15);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
  :host([data-kind="claim"]) .evidence {
    margin: 4px 0 8px 0;
    font-size: 12px;
    line-height: 1.45;
  }
  :host([data-kind="claim"]) .sources-details {
    font-size: 11.5px;
  }
  :host([data-kind="claim"]) .sources-summary {
    cursor: pointer;
    color: #b45309;
    user-select: none;
    font-weight: 500;
    outline: none;
    list-style: none;
  }
  :host([data-kind="claim"]) .sources-summary::-webkit-details-marker {
    display: none;
  }
  :host([data-kind="claim"]) .sources-summary::before {
    content: '\\25b6\\00a0';
    display: inline-block;
    font-size: 9px;
    transition: transform 120ms ease;
  }
  :host([data-kind="claim"]) .sources-details[open] .sources-summary::before {
    transform: rotate(90deg);
  }
  :host([data-kind="claim"]) .sources-list {
    list-style: none;
    margin: 6px 0 0 0;
    padding: 0 0 0 14px;
  }
  :host([data-kind="claim"]) .sources-list li {
    margin: 4px 0;
    padding: 0;
  }
  :host([data-kind="claim"]) .sources-list a {
    color: #b45309;
    text-decoration: none;
    font-size: 11.5px;
    word-break: break-all;
  }
  :host([data-kind="claim"]) .sources-list a:hover {
    text-decoration: underline;
  }
  /* Verify primary button uses amber instead of platform color. */
  :host([data-kind="claim"]) .card .controls .btn-primary {
    background: #F59E0B;
    color: #fff;
  }
  :host([data-kind="claim"]) .card .controls .btn-primary:hover:not(:disabled) {
    filter: brightness(0.93);
  }

  /* ── Hallucination overrides (purple) ──────────────────────
   * When data-hallucination="high" is on the host, swap amber
   * accents for purple #A855F7 to mark "this is a probable
   * fabrication, not just a fact-check miss." Only applies to
   * claim hosts; validation hosts are unaffected. */
  :host([data-kind="claim"][data-hallucination="high"]) .crith-prov-logo {
    background: #A855F7;
  }
  :host([data-kind="claim"][data-hallucination="high"]) .verdict-contradicted {
    background: rgba(168, 85, 247, 0.18);
    color: #6b21a8;
    border: 1px solid rgba(168, 85, 247, 0.35);
  }
  :host([data-kind="claim"][data-hallucination="high"]) .risk-badge[data-risk="high"],
  :host([data-kind="claim"][data-hallucination="high"]) .risk-badge[data-risk="medium"] {
    background: rgba(168, 85, 247, 0.18);
    color: #6b21a8;
  }
  :host([data-kind="claim"][data-hallucination="high"]) .sources-summary,
  :host([data-kind="claim"][data-hallucination="high"]) .sources-list a {
    color: #6b21a8;
  }
  @media (prefers-color-scheme: dark) {
    :host([data-kind="claim"][data-hallucination="high"]) .verdict-contradicted {
      background: rgba(168, 85, 247, 0.22);
      color: #d8b4fe;
    }
    :host([data-kind="claim"][data-hallucination="high"]) .sources-summary,
    :host([data-kind="claim"][data-hallucination="high"]) .sources-list a {
      color: #d8b4fe;
    }
  }

  @media (prefers-color-scheme: dark) {
    :host([data-kind="claim"]) .claim-type-badge {
      background: rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.7);
    }
    :host([data-kind="claim"]) .risk-badge[data-risk="low"] {
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.6);
    }
    :host([data-kind="claim"]) .why-verify {
      color: rgba(255, 255, 255, 0.6);
    }
    :host([data-kind="claim"]) .verify-result {
      background: rgba(255, 255, 255, 0.04);
      border-left-color: rgba(255, 255, 255, 0.1);
    }
    :host([data-kind="claim"]) .verdict-confirmed {
      background: rgba(16, 163, 127, 0.2);
      color: #34d399;
    }
    :host([data-kind="claim"]) .verdict-contradicted {
      background: rgba(255, 105, 97, 0.2);
      color: #ff6961;
    }
    :host([data-kind="claim"]) .verdict-inconclusive {
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.6);
    }
    :host([data-kind="claim"]) .sources-summary,
    :host([data-kind="claim"]) .sources-list a {
      color: #fbbf24;
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
 * Per-responseNode logo stack counter. Render functions are now called
 * incrementally (validations sync at analyze time; claims async after
 * VERIFY_CLAIM resolves contradicted), so we can't pass a single
 * stackIndex through one show() call. The WeakMap lets each render
 * pull the next free slot for whichever responseNode it targets.
 */
const stackCounters = new WeakMap<Element, number>()

function nextStackIndex(node: Element): number {
  return stackCounters.get(node) ?? 0
}

function bumpStackIndex(node: Element): void {
  stackCounters.set(node, (stackCounters.get(node) ?? 0) + 1)
}

/**
 * Render validations + verifiable claims against a single response node.
 * May be called multiple times on the same responseNode — claims arrive
 * asynchronously after their VERIFY_CLAIM verdict is known to be
 * "contradicted" — so the stack counter is kept on a WeakMap rather
 * than re-derived from local state each call.
 *
 * @param claims - only contradicted-and-verified claims should be passed.
 *   The orchestrator pre-populates the verdict cache via
 *   setClaimVerdict() before this call so the card opens directly in
 *   the verified state.
 */
export function show(
  responseNode: Element,
  validations: Validation[],
  claims: VerifiableClaim[] = [],
): void {
  const safeValidations = Array.isArray(validations) ? validations : []
  const safeClaims = Array.isArray(claims) ? claims : []
  if (safeValidations.length === 0 && safeClaims.length === 0) return

  for (const validation of safeValidations) {
    renderValidationItem(responseNode, validation)
  }
  for (const claim of safeClaims) {
    renderClaimItem(responseNode, claim)
  }
}

/**
 * Render one validation. Returns true if a host was placed, false if
 * skipped (missing id, anchor not found in response, idempotent dupe).
 */
function renderValidationItem(
  responseNode: Element,
  validation: Validation,
): boolean {
  if (!validation) return false
  const provocationId = validation.provocation_id
  if (!provocationId) return false

  try {
    const sel = `crith-prov-host[data-prov-id="${CSS.escape(provocationId)}"]`
    if (document.querySelector(sel)) return true
  } catch { /* noop */ }

  const target = validation.anchored_to || ''
  if (target) {
    dedupePriorRender(target)
  }

  const spans = wrapUnderline(responseNode, validation.anchored_to, {
    kind: 'validation',
    lens: validation.lens,
  })
  if (spans.length === 0) return false
  const firstSpan = spans[0]
  if (!firstSpan) return false

  const stackIndex = nextStackIndex(responseNode)
  const host = createHost(provocationId, validation, spans)
  if (target) host.setAttribute('data-target', target)
  host.setAttribute('data-stack-index', String(stackIndex))
  document.body.appendChild(host)
  positionHost(host, firstSpan, responseNode)
  attachReposition(host, firstSpan, responseNode)
  bumpStackIndex(responseNode)

  logHostPlaced(host, firstSpan, 'validation')

  requestAnimationFrame(() => {
    try {
      const logo = host.shadowRoot?.querySelector?.('.crith-prov-logo')
      if (logo) logo.classList.add('pulse')
    } catch { /* noop */ }
  })

  return true
}

/**
 * Render one verifiable claim. Same lifecycle as a validation but uses
 * the amber color scheme + claim-specific card markup. Only called for
 * claims whose verdict has resolved to "contradicted" — the underline is
 * a "this part has been disproven" flag, not a "you might want to check
 * this" flag.
 */
function renderClaimItem(
  responseNode: Element,
  claim: VerifiableClaim,
): boolean {
  if (!claim) return false
  if (
    typeof claim.analysis_id !== 'string' ||
    typeof claim.claim_index !== 'number'
  ) {
    warn('claim missing analysis_id or claim_index — orchestrator should stamp', claim)
    return false
  }
  const claimDomId = `claim-${claim.analysis_id}-${claim.claim_index}`

  try {
    const sel = `crith-prov-host[data-prov-id="${CSS.escape(claimDomId)}"]`
    if (document.querySelector(sel)) return true
  } catch { /* noop */ }

  const target = claim.anchored_to || ''
  // Don't dedupe across kinds — a validation and claim CAN coexist on
  // the same anchor text. Only dedupe within the SAME kind (claim hosts
  // share the data-target attribute namespace with validation hosts but
  // we filter by the host's data-kind so we don't wipe a validation
  // when adding a claim).

  const isHallucination = claim.hallucination_signal === 'high'
  const spans = wrapUnderline(responseNode, claim.anchored_to, {
    kind: 'claim',
    risk: claim.risk,
    hallucination: isHallucination,
  })
  if (spans.length === 0) return false
  const firstSpan = spans[0]
  if (!firstSpan) return false

  const stackIndex = nextStackIndex(responseNode)
  const host = createClaimHost(claimDomId, claim, spans)
  if (target) host.setAttribute('data-target', target)
  host.setAttribute('data-stack-index', String(stackIndex))
  document.body.appendChild(host)
  positionHost(host, firstSpan, responseNode)
  attachReposition(host, firstSpan, responseNode)
  bumpStackIndex(responseNode)

  logHostPlaced(host, firstSpan, 'claim')

  requestAnimationFrame(() => {
    try {
      const logo = host.shadowRoot?.querySelector?.('.crith-prov-logo')
      if (logo) logo.classList.add('pulse')
    } catch { /* noop */ }
  })

  return true
}

/**
 * Remove any prior validation host + unwrap any prior validation span
 * targeting `target`. Called only by validation rendering — claims do
 * NOT dedupe across to validations (they can coexist on the same
 * anchor text by design, distinguished by host data-kind).
 */
function dedupePriorRender(target: string): void {
  document.querySelectorAll('crith-prov-host[data-target]').forEach((host) => {
    if (host.getAttribute('data-target') !== target) return
    if (host.getAttribute('data-kind') === 'claim') return
    try { host.remove() } catch { /* noop */ }
  })
  document
    .querySelectorAll('span.crith-prov-underline:not([data-crith-prov-kind="claim"])')
    .forEach((span) => {
      if (span.textContent !== target) return
      const parent = span.parentNode
      if (!parent) return
      while (span.firstChild) parent.insertBefore(span.firstChild, span)
      parent.removeChild(span)
    })
}

function logHostPlaced(
  host: HTMLElement,
  firstSpan: Element,
  kind: 'validation' | 'claim',
): void {
  const spanRect = firstSpan.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  log(
    `${kind} host placed | host_xy=(${Math.round(hostRect.left)},${Math.round(hostRect.top)}) ` +
      `host_size=${Math.round(hostRect.width)}x${Math.round(hostRect.height)} | ` +
      `span_xy=(${Math.round(spanRect.left)},${Math.round(spanRect.top)}) ` +
      `span_size=${Math.round(spanRect.width)}x${Math.round(spanRect.height)} | ` +
      `host_in_body=${document.body.contains(host)} | ` +
      `host_display=${getComputedStyle(host).display} ` +
      `host_visibility=${getComputedStyle(host).visibility}`,
  )
}

type UnderlineDecoration =
  | { kind: 'validation'; lens: Lens }
  | { kind: 'claim'; risk: Risk; hallucination: boolean }

function wrapUnderline(
  responseNode: Element,
  target: string,
  decoration: UnderlineDecoration,
): HTMLSpanElement[] {
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
    if (decoration.kind === 'validation') {
      if (isHighSignalLens(decoration.lens)) {
        span.setAttribute('data-crith-prov-type', decoration.lens)
      }
    } else {
      span.setAttribute('data-crith-prov-kind', 'claim')
      span.setAttribute('data-crith-risk', decoration.risk)
      // Stamp the hallucination flag so the page-DOM CSS can swap
      // the amber dotted underline for purple. The attribute is
      // only present when hallucination_signal === 'high' AND the
      // verify pipeline returned `contradicted` — the strongest
      // available "AI fabricated this" signal.
      if (decoration.hallucination) {
        span.setAttribute('data-crith-hallucination', 'true')
      }
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
  const tag = decoration.kind === 'validation'
    ? `lens=${decoration.lens}`
    : `kind=claim risk=${decoration.risk}`
  log(`wrapped ${spans.length} span(s) for "${target.slice(0, 60)}${target.length > 60 ? '…' : ''}" (${tag})`)
  return spans
}

// Open shadow root — accessible via the standard host.shadowRoot
// property. We previously used closed mode + a non-standard
// shadowRootClosed property, but that was failing in production for
// reasons not yet fully understood (possibly site scripts or browser
// extensions stripping non-standard JS props). Open mode trades a
// thin layer of "site scripts can see our shadow" isolation for
// reliable, debuggable access from DevTools and the rAF pulse step.
type HostWithShadow = HTMLElement

function createHost(
  provocationId: string,
  validation: Validation,
  underlineSpans: HTMLSpanElement[],
): HostWithShadow {
  const host = document.createElement('crith-prov-host') as HostWithShadow
  host.setAttribute('data-prov-id', provocationId)
  // position: fixed (viewport-anchored). ChatGPT's <body> doesn't scroll —
  // the conversation thread has its own inner scroll container — so an
  // absolutely-positioned host anchored to body would stay at a fixed
  // PAGE coordinate and become off-screen the moment the chat scrolls.
  host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;'
  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = SHADOW_STYLES
  root.appendChild(style)

  const wrap = document.createElement('div')
  wrap.className = 'wrap'

  const logo = document.createElement('div')
  logo.className = 'crith-prov-logo'
  logo.title = 'Crith provocation'
  logo.appendChild(buildBrandMark())

  const dotColor = getDotColor(validation.lens)
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

  // Main text — holds the validation's `problem` text by default
  // (1-2 sentence declarative statement of what the AI did wrong),
  // swapped to the explanation while in the explained state.
  const text = document.createElement('p')
  text.className = 'text'
  text.textContent = (validation.problem || '').slice(0, 320)
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

  // Single row: ratings on the left, Ask AI primary on the right.
  // "Why this matters" was removed — the validation's `problem` text
  // is the explanation. Ask AI is disabled at attach time in card.ts
  // when follow_up_prompt is empty (legacy responses) or the platform
  // adapter doesn't implement sendToInput.
  const buttons: Array<{ cls: string; action: string; label: string }> = [
    { cls: 'btn-secondary', action: 'useful',     label: 'Useful' },
    { cls: 'btn-secondary', action: 'not_useful', label: 'Not useful' },
    { cls: 'btn-primary',   action: 'ask_ai',     label: 'Ask AI →' },
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

  attachCard(host, root, validation, underlineSpans)
  return host
}

/**
 * Build a shadow-DOM host for a verifiable claim. Mirrors createHost() but
 * with the fact-check card markup: claim-type + risk badges, claim text,
 * why-verify rationale, hidden verify-result block (verdict badge +
 * evidence + collapsible sources), and a [Useful] [Not useful] [Verify ↻]
 * button row. The amber accent + claim-host styling is driven by the
 * data-kind="claim" attribute set on the host (matched by the
 * :host([data-kind="claim"]) rules in SHADOW_STYLES).
 */
function createClaimHost(
  claimDomId: string,
  claim: VerifiableClaim,
  underlineSpans: HTMLSpanElement[],
): HostWithShadow {
  const host = document.createElement('crith-prov-host') as HostWithShadow
  host.setAttribute('data-prov-id', claimDomId)
  host.setAttribute('data-kind', 'claim')
  // Stamp hallucination signal so SHADOW_STYLES can swap the amber
  // host accents for purple. We only set the attribute when the
  // claim is a high-signal hallucination — medium/none never
  // reach the render path (medium that came back contradicted is
  // a "fact-check failed" finding but not a fabrication tell).
  if (claim.hallucination_signal === 'high') {
    host.setAttribute('data-hallucination', 'high')
  }
  host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;'
  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = SHADOW_STYLES
  root.appendChild(style)

  const wrap = document.createElement('div')
  wrap.className = 'wrap'

  const logo = document.createElement('div')
  logo.className = 'crith-prov-logo'
  logo.title = 'Crith fact-check'
  logo.appendChild(buildBrandMark())
  // Claim hosts don't render a lens dot — the amber logo color (set
  // via :host([data-kind="claim"]) .crith-prov-logo) already signals
  // "this is a fact-check, not a critique".
  wrap.appendChild(logo)

  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.state = 'default'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'Verifiable claim')

  // Header: claim_type chip + risk chip on a single row.
  const header = document.createElement('div')
  header.className = 'claim-header'
  const claimTypeBadge = document.createElement('span')
  claimTypeBadge.className = 'claim-type-badge'
  const riskBadge = document.createElement('span')
  riskBadge.className = 'risk-badge'
  header.appendChild(claimTypeBadge)
  header.appendChild(riskBadge)
  card.appendChild(header)

  // Claim text — the exact statement being fact-checked.
  const claimText = document.createElement('p')
  claimText.className = 'claim-text'
  card.appendChild(claimText)

  // why_verify — short rationale for why this claim warrants checking.
  const whyVerify = document.createElement('p')
  whyVerify.className = 'why-verify'
  card.appendChild(whyVerify)

  // Verify result block — hidden by default; populated + revealed by
  // claim-card.ts after VERIFY_CLAIM resolves successfully.
  const verifyResult = document.createElement('div')
  verifyResult.className = 'verify-result'
  verifyResult.hidden = true

  const verdictBadge = document.createElement('span')
  verdictBadge.className = 'verdict-badge'
  verifyResult.appendChild(verdictBadge)

  const evidence = document.createElement('p')
  evidence.className = 'evidence'
  verifyResult.appendChild(evidence)

  // Collapsible sources via native <details>. The ▶ → ▼ rotation is
  // handled by the [open] CSS rule in SHADOW_STYLES.
  const sourcesDetails = document.createElement('details')
  sourcesDetails.className = 'sources-details'
  const sourcesSummary = document.createElement('summary')
  sourcesSummary.className = 'sources-summary'
  sourcesSummary.textContent = 'View sources'
  sourcesDetails.appendChild(sourcesSummary)
  const sourcesList = document.createElement('ul')
  sourcesList.className = 'sources-list'
  sourcesDetails.appendChild(sourcesList)
  verifyResult.appendChild(sourcesDetails)

  card.appendChild(verifyResult)

  // Single-row button cluster — only feedback ratings now. The
  // manual Verify button was removed when the orchestrator started
  // auto-verifying every high/medium-signal claim before render;
  // by the time this host attaches, the verdict is already cached.
  const controls = document.createElement('div')
  controls.className = 'controls'
  const buttons: Array<{ cls: string; action: string; label: string }> = [
    { cls: 'btn-secondary', action: 'useful',     label: 'Useful' },
    { cls: 'btn-secondary', action: 'not_useful', label: 'Not useful' },
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

  attachClaim(host, root, claim, underlineSpans)
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
