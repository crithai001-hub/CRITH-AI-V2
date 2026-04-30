import { getSupabaseClient } from '../shared/supabase-client'
import { getAuth, setAuth, clearAuth } from '../shared/storage'
import type { AuthTokens } from '../shared/types'

const REFRESH_BUFFER_SECONDS = 60
const LOG_PREFIX = '[Crith SW]'

/**
 * Returns a usable access token, refreshing if necessary.
 *
 * - If no auth in storage → returns null.
 * - If access_token has more than REFRESH_BUFFER_SECONDS until expiry → return it.
 * - Otherwise, call supabase.auth.refreshSession; on success persist new tokens
 *   and return the new access_token.
 * - On refresh failure (refresh token expired/revoked, network), clear auth
 *   from storage and return null. The caller maps null → AUTH_REQUIRED.
 *
 * Designed to be passed as the GetAccessToken dependency into the API client.
 */
export async function getAccessTokenWithRefresh(): Promise<string | null> {
  const auth = await getAuth()
  if (!auth) return null

  const now = Math.floor(Date.now() / 1000)
  if (auth.expires_at > now + REFRESH_BUFFER_SECONDS) {
    return auth.access_token
  }

  console.log(
    `${LOG_PREFIX} access token within ${REFRESH_BUFFER_SECONDS}s of expiry, refreshing...`,
  )

  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: auth.refresh_token,
    })
    if (error) throw error
    if (!data.session) throw new Error('No session in refresh response')

    const expires_at =
      data.session.expires_at ??
      Math.floor(Date.now() / 1000) + (data.session.expires_in ?? 3600)

    const refreshed: AuthTokens = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at,
    }
    await setAuth(refreshed)
    console.log(
      `${LOG_PREFIX} token refreshed; new expiry: ${refreshed.expires_at}`,
    )
    return refreshed.access_token
  } catch (err) {
    console.warn(`${LOG_PREFIX} refresh failed, clearing auth:`, err)
    await clearAuth()
    return null
  }
}
