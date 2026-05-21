import { defineConfig } from 'vitest/config'

// Standalone test config — kept separate from vite.config.ts so the
// crxjs build plugin doesn't try to inspect the test files (it only
// understands extension entry points). `define` injects values for
// `import.meta.env.VITE_*` reads inside src/shared/env.ts, which the
// api-client calls before each request.
export default defineConfig({
  define: {
    'import.meta.env.VITE_BACKEND_URL': JSON.stringify('https://test.crith.local'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
