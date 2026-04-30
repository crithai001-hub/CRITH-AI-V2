# Crith

Critical-thinking provocations for AI responses on ChatGPT, Claude, and Gemini.

A Chrome extension (Manifest V3). When the AI finishes responding, Crith surfaces gaps, assumptions, and quick validations you should push back on before accepting the answer.

---

## Project status

This is the Chrome-extension client. The backend (analysis + events) lives in a separate repo and is already deployed.

Current step: **1 — scaffolding only.** Popup is a stub; content scripts, service-worker logic, and login flow ship in subsequent steps.

---

## Setup

Requirements:
- Node 22 (use `nvm use` — `.nvmrc` is set to 22)
- npm
- openssl (for the stable-key generator; preinstalled on macOS / most Linux)

```bash
nvm use
npm install
cp .env.example .env.local   # then fill in real values
npm run build                # produces dist/
```

### Environment variables

`.env.local` (gitignored). Never commit real values.

| Var                       | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `VITE_BACKEND_URL`        | Vercel deployment of the analysis backend.             |
| `VITE_SUPABASE_URL`       | Supabase project URL (used by the popup login flow).   |
| `VITE_SUPABASE_ANON_KEY`  | Supabase anon key (safe to bundle, scoped by RLS).     |

All three are bundled into the build at `vite build` time. The service-role key is **never** in this repo.

---

## Loading the unpacked extension in Chrome

1. `npm run build` (or `npm run dev` for HMR; see below).
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `dist/` folder.
5. Pin the extension (puzzle-piece icon → pin) so the popup is reachable.

You should see "Crith" in your extensions list with no load errors. Click the icon — popup says "Not logged in".

> Heads-up: until you generate the stable key (next section), you'll see one warning on load: `Unrecognized manifest key '_NOTE_key'`. That warning is intentional — it's the reminder to generate and paste the key. It does not block the extension from running.

### Dev mode (HMR)

```bash
npm run dev
```

Vite watches files and rewrites `dist/` in place. Chrome auto-reloads content scripts and the service worker when files change. If the popup gets stuck, hit the reload arrow on the extension card in `chrome://extensions`.

---

## Generating the stable extension key

Out of the box, every "Load unpacked" install assigns a different extension ID, which makes CORS allow-lists and ID-pinning impossible. To make the ID stable across machines and reinstalls, generate an RSA keypair and put the public key in `manifest.json` under the top-level `key` field.

```bash
npm run generate-key
```

This script:
1. Creates `manifest-key-private.pem` at the repo root (gitignored — back this up somewhere safe).
2. Prints the **stable extension ID** and the base64-encoded **public key**.

Then, in `manifest.json`:
- **Remove** the `_NOTE_key` field at the top.
- **Add** the printed `"key": "..."` line in its place.
- Run `npm run build` and reload the extension. The ID printed by the script is now your real extension ID.

If you lose `manifest-key-private.pem`, the chain of trust breaks — anyone re-issuing the extension would generate a different ID. Treat it like a code-signing key.

---

## Per-platform testing checklist

Use these as smoke tests after building. Each platform has its own DOM quirks; if any of these fail on a real conversation, the platform's `observer.ts` / `selectors.ts` need attention.

### ChatGPT (`https://chatgpt.com/*`, `https://chat.openai.com/*`)
- [ ] Send a long-enough prompt (>80 words of expected response).
- [ ] After the response stops streaming, the Crith pill appears below it.
- [ ] Clicking the pill expands the card.
- [ ] "Ask this →" injects the question into the composer and submits.
- [ ] Engagement events fire (check service-worker console).

### Claude (`https://claude.ai/*`)
- [ ] Same five checks.

### Gemini (`https://gemini.google.com/*`)
- [ ] Same five checks.

(The above are step 7+ verifications — not relevant during step 1.)

---

## Debugging

**Popup**
- Right-click the extension icon → **Inspect popup**.

**Service worker**
- `chrome://extensions` → find Crith → **Service worker** link → opens DevTools attached to the worker.
- The worker shuts down after ~30s idle. Sending a message or reloading the extension wakes it.

**Content scripts**
- Open the host page (e.g. chatgpt.com), open DevTools, switch the **Top** dropdown in the Console tab to the content-script context.
- Or: `chrome://extensions` → Crith **Details** → **Inspect views** lists every active context.

**Build output**
- `dist/manifest.json` is the *built* manifest (paths are rewritten). Look here when debugging "why isn't this script loading."
- Source maps are enabled — TS stack traces should resolve to source files.

---

## Production build

```bash
npm run build
```

Then zip `dist/` for the Chrome Web Store:

```bash
cd dist
zip -r ../crith-v0.0.1.zip .
cd ..
```

Upload `crith-v0.0.1.zip` to the Chrome Web Store developer dashboard. The store re-signs the package with its own key, but the public key in `manifest.json` keeps the extension ID stable across the local-unpacked install and the store install.

---

## Project structure

```
manifest.json              ← MV3 manifest (key field added after generate-key)
vite.config.ts             ← crxjs + vite
tsconfig.json              ← strict TS
src/
  popup/                   ← extension popup (login, settings, quota)
  background/              ← service worker (auth, message routing, API)
  content/
    chatgpt/               ← ChatGPT observer + injector + send-back
    claude/                ← (same shape, step 10)
    gemini/                ← (same shape, step 11)
    shared/                ← cross-platform: api-client, ui, trigger-gate
  options/                 ← optional, deferred
public/icons/              ← 16/48/128 PNGs (TBD)
scripts/
  generate-key.sh          ← stable-key generator
```

---

## Known issues

### `npm audit` reports vulnerabilities in build-time deps

`npm install` currently flags a handful of moderate/high vulnerabilities. **All of them live in the dev-dependency tree under `@crxjs/vite-plugin` (which is still in beta) and are build-time only — none ship to end users in the production extension bundle.**

Do **not** run `npm audit fix --force`: it will downgrade `@crxjs/vite-plugin` past the MV3-compatible beta and break the build. These will resolve naturally when crxjs ships a stable release. Until then, audit warnings here are accepted noise.

---

## License

Private / unreleased.
