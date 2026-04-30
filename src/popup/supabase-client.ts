import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '../shared/env'

let _client: SupabaseClient | null = null

/**
 * Lazy singleton Supabase client for the popup.
 * - persistSession: false — we manage storage in chrome.storage.local ourselves
 * - autoRefreshToken: false — service worker handles refresh (step 3)
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
