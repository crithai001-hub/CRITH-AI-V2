import { getSupabaseClient } from '../shared/supabase-client'
import {
  getAuth,
  setAuth,
  clearAuth,
  getUserEmail,
  setUserEmail,
} from '../shared/storage'
import { getEnv } from '../shared/env'
import type { AuthTokens } from '../shared/types'

const versionEl = document.getElementById('version')
const loadingView = document.getElementById('view-loading') as HTMLElement
const loggedOutView = document.getElementById('view-logged-out') as HTMLElement
const loggedInView = document.getElementById('view-logged-in') as HTMLElement
const loadingTextEl = document.getElementById('loading-text') as HTMLElement
const loginForm = document.getElementById('login-form') as HTMLFormElement
const emailInput = document.getElementById('email') as HTMLInputElement
const passwordInput = document.getElementById('password') as HTMLInputElement
const submitBtn = document.getElementById('login-submit') as HTMLButtonElement
const errorEl = document.getElementById('login-error') as HTMLElement
const userEmailEl = document.getElementById('user-email') as HTMLElement
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement

if (versionEl) {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`
}

type View = 'loading' | 'logged-out' | 'logged-in'

function setView(view: View, loadingText = 'Loading…'): void {
  loadingView.hidden = view !== 'loading'
  loggedOutView.hidden = view !== 'logged-out'
  loggedInView.hidden = view !== 'logged-in'
  if (view === 'loading') loadingTextEl.textContent = loadingText
}

function showLoggedIn(email: string): void {
  userEmailEl.textContent = email
  setView('logged-in')
}

function showLoggedOut(errorMessage = ''): void {
  errorEl.textContent = errorMessage
  setView('logged-out')
}

function showEnvError(missing: string[]): void {
  showLoggedOut(`Missing env: ${missing.join(', ')}. Add to .env.local and rebuild.`)
  emailInput.disabled = true
  passwordInput.disabled = true
  submitBtn.disabled = true
}

async function init(): Promise<void> {
  const env = getEnv()
  if (!env.ok) {
    showEnvError(env.missing)
    return
  }
  const [auth, email] = await Promise.all([getAuth(), getUserEmail()])
  const now = Math.floor(Date.now() / 1000)
  if (auth && email && auth.expires_at > now) {
    showLoggedIn(email)
  } else {
    showLoggedOut()
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = emailInput.value.trim()
  const password = passwordInput.value
  if (!email || !password) {
    errorEl.textContent = 'Email and password required.'
    return
  }

  setView('loading', 'Logging in…')

  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!data.session || !data.user) {
      throw new Error('No session returned from sign-in.')
    }

    const expires_at =
      data.session.expires_at ??
      Math.floor(Date.now() / 1000) + (data.session.expires_in ?? 3600)

    const tokens: AuthTokens = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at,
    }
    const userEmail = data.user.email ?? email

    await setAuth(tokens)
    await setUserEmail(userEmail)
    showLoggedIn(userEmail)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed.'
    showLoggedOut(message)
  }
})

const reviewBtn = document.getElementById('open-review') as HTMLButtonElement
reviewBtn.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage()
  } else {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/review/review.html') })
  }
})

logoutBtn.addEventListener('click', async () => {
  setView('loading', 'Logging out…')
  try {
    const auth = await getAuth()
    const supabase = getSupabaseClient()
    if (auth) {
      // Restore the session in-memory so signOut can invalidate the refresh
      // token server-side. setSession is local-only; signOut hits Supabase.
      await supabase.auth.setSession({
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
      })
    }
    try {
      await supabase.auth.signOut()
    } catch (err) {
      // Server-side invalidation can fail (network, expired token).
      // We still proceed with the local clear below.
      console.warn('[Crith] supabase.auth.signOut failed:', err)
    }
  } finally {
    await clearAuth()
    loginForm.reset()
    showLoggedOut()
  }
})

init().catch((err) => {
  console.error('[Crith] popup init failed:', err)
  showLoggedOut(err instanceof Error ? err.message : 'Failed to initialize.')
})
