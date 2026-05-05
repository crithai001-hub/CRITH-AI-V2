// ── content/shared/analysis-cache.ts ──────────────────────────
// Persists analyzer + verifier results to chrome.storage.local so a
// page refresh doesn't lose them. Keyed on
// `${conversation_id}::${response_hash}` — the hash makes the entry
// stable across reloads even though the synthesized message_id is not.
//
// Storage shape:
//   crith_v2_analysis_cache: {
//     "conv-1::abc123": {
//       analysis_id: "...",
//       validations: [...],
//       verifiable_claims: [...],
//       verdicts: { "0": VerifyClaimResponse, "2": ... },  // by claim_index
//       saved_at: <unix ms>
//     },
//     ...
//   }
//
// FIFO cap: 200 entries. When over cap, evict by oldest saved_at first.

import type {
  Validation,
  VerifiableClaim,
  VerifyClaimResponse,
} from '../../shared/types'

const STORAGE_KEY = 'crith_v2_analysis_cache'
const ENTRY_CAP = 200

export type CachedAnalysis = {
  analysis_id: string
  validations: Validation[]
  verifiable_claims: VerifiableClaim[]
  /** Verdicts keyed on claim_index as string (JSON-friendly). */
  verdicts: Record<string, VerifyClaimResponse>
  saved_at: number
}

type CacheMap = Record<string, CachedAnalysis>

/**
 * Stable, fast string hash (djb2). NOT cryptographic — only used to
 * derive a deterministic key from response text. Uniqueness within
 * a single conversation is sufficient; collisions across
 * conversations are scoped out by the conv_id prefix.
 */
export function hashResponse(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

function makeKey(convId: string, hash: string): string {
  return `${convId}::${hash}`
}

async function readAll(): Promise<CacheMap> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY)
    const v = r[STORAGE_KEY]
    if (!v || typeof v !== 'object') return {}
    return v as CacheMap
  } catch (err) {
    console.warn('[Crith V2 CACHE] readAll failed:', err)
    return {}
  }
}

async function writeAll(cache: CacheMap): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: cache })
  } catch (err) {
    console.warn('[Crith V2 CACHE] writeAll failed:', err)
  }
}

function evictIfOverCap(cache: CacheMap): void {
  const keys = Object.keys(cache)
  if (keys.length <= ENTRY_CAP) return
  const sorted = keys.sort(
    (a, b) => (cache[a]?.saved_at ?? 0) - (cache[b]?.saved_at ?? 0),
  )
  const removeCount = sorted.length - ENTRY_CAP
  for (let i = 0; i < removeCount; i++) {
    const k = sorted[i]
    if (k != null) delete cache[k]
  }
}

export async function getStoredAnalysis(
  convId: string,
  hash: string,
): Promise<CachedAnalysis | null> {
  const all = await readAll()
  return all[makeKey(convId, hash)] ?? null
}

export async function saveAnalysis(
  convId: string,
  hash: string,
  payload: Omit<CachedAnalysis, 'saved_at'>,
): Promise<void> {
  const all = await readAll()
  const existing = all[makeKey(convId, hash)]
  // Preserve any verdicts already saved against this entry — a fresh
  // analyze call on the same response shouldn't wipe verdicts the
  // user has already paid to verify.
  const mergedVerdicts = {
    ...(existing?.verdicts ?? {}),
    ...payload.verdicts,
  }
  all[makeKey(convId, hash)] = {
    ...payload,
    verdicts: mergedVerdicts,
    saved_at: Date.now(),
  }
  evictIfOverCap(all)
  await writeAll(all)
}

export async function saveVerdict(
  convId: string,
  hash: string,
  claimIndex: number,
  verdict: VerifyClaimResponse,
): Promise<void> {
  const all = await readAll()
  const k = makeKey(convId, hash)
  const entry = all[k]
  if (!entry) return
  entry.verdicts[String(claimIndex)] = verdict
  entry.saved_at = Date.now()
  await writeAll(all)
}

/** Test-only escape hatch. */
export async function _clearAnalysisCacheForTest(): Promise<void> {
  await writeAll({})
}
