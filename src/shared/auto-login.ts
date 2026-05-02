// ── shared/auto-login.ts ─────────────────────────────────────
// Dev convenience: auto-login with credentials from .env.local so the
// popup login form never has to be touched in development.
//
// Reads VITE_DEV_AUTO_LOGIN_EMAIL and VITE_DEV_AUTO_LOGIN_PASSWORD
// (both optional). If either is missing, returns null and the manual
// flow stays in charge.
//
// Vite inlines these env values into the build at compile time, so the
// credentials end up baked into dist/. Treat the build output as
// secret-equivalent — never share dist/ or commit .env.local.

import { getSupabaseClient } from './supabase-client'
import { setAuth, setUserEmail } from './storage'
import type { AuthTokens } from './types'

export async function tryAutoLogin(): Promise<AuthTokens | null> {
  const email = import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL as string | undefined
  const password = import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD as string | undefined
  if (!email || !password) return null

  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!data.session || !data.user) throw new Error('No session in auto-login response')

    const expires_at =
      data.session.expires_at ??
      Math.floor(Date.now() / 1000) + (data.session.expires_in ?? 3600)

    const tokens: AuthTokens = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at,
    }
    await setAuth(tokens)
    await setUserEmail(data.user.email ?? email)
    console.log('[Crith] auto-login: signed in as', email)
    return tokens
  } catch (err) {
    console.warn('[Crith] auto-login failed:', err)
    return null
  }
}
