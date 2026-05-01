// ── review/review.ts ──────────────────────────────────────────
// Dev-tooling dashboard. Reads chrome.storage.local crith_v2_prov_log
// and renders every (prompt, response, provocation) triple captured by
// the orchestrator. Throwaway — strip when the real backend wires in.

const REVIEW_LOG_KEY = 'crith_v2_prov_log'

type ReviewEntry = {
  timestamp: number
  platform: string
  prompt: string
  response: string
  provocation: { question: string; lens: string; anchored_to: string }
  sessionId: string
}

const entriesEl = document.getElementById('entries') as HTMLElement
const countEl = document.getElementById('count') as HTMLElement
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement
const clearBtn = document.getElementById('clear') as HTMLButtonElement
const template = document.getElementById('entry-template') as HTMLTemplateElement

function fmtTimestamp(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function setText(node: ParentNode, selector: string, value: string): void {
  const el = node.querySelector(selector)
  if (el) el.textContent = value
}

function renderEntry(entry: ReviewEntry): DocumentFragment {
  const fragment = template.content.cloneNode(true) as DocumentFragment
  const lensEl = fragment.querySelector('.lens-badge')
  if (lensEl) {
    lensEl.textContent = entry.provocation.lens
    lensEl.setAttribute('data-lens', entry.provocation.lens)
  }
  setText(fragment, '.meta-platform', entry.platform)
  setText(fragment, '.meta-timestamp', fmtTimestamp(entry.timestamp))
  setText(fragment, '.question', entry.provocation.question)
  setText(fragment, '.anchor-text', entry.provocation.anchored_to)
  setText(fragment, '.prompt-text', entry.prompt)
  setText(fragment, '.response-text', entry.response)
  return fragment
}

async function loadAndRender(): Promise<void> {
  const result = await chrome.storage.local.get(REVIEW_LOG_KEY)
  const raw = result[REVIEW_LOG_KEY]
  const entries: ReviewEntry[] = Array.isArray(raw) ? (raw as ReviewEntry[]) : []
  countEl.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
  entriesEl.replaceChildren()
  if (entries.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent =
      'No entries yet. Trigger a provocation on a supported chat platform — it will appear here.'
    entriesEl.appendChild(empty)
    return
  }
  // Newest first.
  for (const entry of [...entries].reverse()) {
    entriesEl.appendChild(renderEntry(entry))
  }
}

refreshBtn.addEventListener('click', () => {
  void loadAndRender()
})

clearBtn.addEventListener('click', async () => {
  if (!window.confirm('Clear all entries from the review log?')) return
  await chrome.storage.local.remove(REVIEW_LOG_KEY)
  await loadAndRender()
})

// Live update: re-render whenever the log changes (e.g. a new provocation
// fires while this tab is open in another window).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (REVIEW_LOG_KEY in changes) void loadAndRender()
})

void loadAndRender()
