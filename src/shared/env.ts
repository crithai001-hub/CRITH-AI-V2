type EnvOk = {
  ok: true
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  BACKEND_URL: string
}

type EnvMissing = {
  ok: false
  missing: string[]
}

export type EnvResult = EnvOk | EnvMissing

function isPlaceholder(value: string | undefined, marker: string): boolean {
  return !value || value.includes(marker)
}

export function getEnv(): EnvResult {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

  const missing: string[] = []
  if (isPlaceholder(SUPABASE_URL, 'YOUR-PROJECT')) missing.push('VITE_SUPABASE_URL')
  if (isPlaceholder(SUPABASE_ANON_KEY, 'YOUR-')) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!BACKEND_URL) missing.push('VITE_BACKEND_URL')

  if (missing.length > 0) {
    return { ok: false, missing }
  }

  return {
    ok: true,
    SUPABASE_URL: SUPABASE_URL as string,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY as string,
    BACKEND_URL: BACKEND_URL as string,
  }
}
