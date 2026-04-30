import type { AuthTokens } from './types'

const AUTH_KEY = 'crith_auth'
const USER_EMAIL_KEY = 'crith_user_email'

export async function getAuth(): Promise<AuthTokens | null> {
  const result = await chrome.storage.local.get(AUTH_KEY)
  const value = result[AUTH_KEY] as AuthTokens | undefined
  return value ?? null
}

export async function setAuth(auth: AuthTokens): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: auth })
}

/**
 * Clear all auth-related state (tokens + user email).
 * Logout calls this once to wipe both keys atomically.
 */
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([AUTH_KEY, USER_EMAIL_KEY])
}

export async function getUserEmail(): Promise<string | null> {
  const result = await chrome.storage.local.get(USER_EMAIL_KEY)
  const value = result[USER_EMAIL_KEY] as string | undefined
  return value ?? null
}

export async function setUserEmail(email: string): Promise<void> {
  await chrome.storage.local.set({ [USER_EMAIL_KEY]: email })
}
