import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from './env'

let _client: SupabaseClient | null = null

/**
 * Lazy singleton Supabase client. Used by both the popup (for password
 * sign-in) and the service worker (for refreshSession). We manage tokens
 * ourselves in chrome.storage.local, so:
 *   - persistSession: false       — no localStorage
 *   - autoRefreshToken: false     — refresh runs in the SW on demand
 *   - detectSessionInUrl: false   — not an OAuth redirect target
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client
  const env = getEnv()
  if (!env.ok) {
    throw new Error(`Missing env: ${env.missing.join(', ')}`)
  }
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return _client
}
