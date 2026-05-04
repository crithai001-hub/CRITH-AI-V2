// vite.config.ts
import { defineConfig } from "file:///Users/huseyn/Documents/CRITH%20AI%20V2/node_modules/vite/dist/node/index.js";
import { crx } from "file:///Users/huseyn/Documents/CRITH%20AI%20V2/node_modules/@crxjs/vite-plugin/dist/index.mjs";

// manifest.json
var manifest_default = {
  _NOTE_key: "TODO: paste public key here after running scripts/generate-key.sh \u2014 see README. Until then, the extension ID will be random per install. (JSON has no comments, so this underscore-prefixed field is the workaround. Chrome will print a single warning about it on load \u2014 that warning is the reminder.)",
  manifest_version: 3,
  name: "Crith",
  version: "0.0.1",
  description: "Stop AI from thinking for you. Crith surfaces the gaps, assumptions, and easy validations in every AI response so you can push back before you accept the answer.",
  action: {
    default_popup: "src/popup/popup.html",
    default_title: "Crith"
  },
  options_ui: {
    page: "src/review/review.html",
    open_in_tab: true
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module"
  },
  permissions: [
    "storage",
    "activeTab"
  ],
  host_permissions: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://crith-backend.vercel.app/*"
  ],
  content_scripts: [
    {
      matches: [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*",
        "https://gemini.google.com/*",
        "https://www.perplexity.ai/*",
        "https://perplexity.ai/*",
        "https://grok.com/*",
        "https://chat.deepseek.com/*",
        "https://deepseek.com/*"
      ],
      js: ["src/content/shared/prov-orchestrator.ts"],
      css: ["src/content/shared/underline.css"],
      run_at: "document_idle"
    }
  ]
};

// vite.config.ts
var vite_config_default = defineConfig({
  plugins: [
    crx({ manifest: manifest_default })
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext"
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAibWFuaWZlc3QuanNvbiJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9odXNleW4vRG9jdW1lbnRzL0NSSVRIIEFJIFYyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvaHVzZXluL0RvY3VtZW50cy9DUklUSCBBSSBWMi92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvaHVzZXluL0RvY3VtZW50cy9DUklUSCUyMEFJJTIwVjIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHsgY3J4IH0gZnJvbSAnQGNyeGpzL3ZpdGUtcGx1Z2luJ1xuaW1wb3J0IG1hbmlmZXN0IGZyb20gJy4vbWFuaWZlc3QuanNvbidcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIGNyeCh7IG1hbmlmZXN0OiBtYW5pZmVzdCBhcyBuZXZlciB9KVxuICBdLFxuICBidWlsZDoge1xuICAgIG91dERpcjogJ2Rpc3QnLFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICB0YXJnZXQ6ICdlc25leHQnXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgICBobXI6IHsgcG9ydDogNTE3MyB9XG4gIH1cbn0pXG4iLCAie1xuICBcIl9OT1RFX2tleVwiOiBcIlRPRE86IHBhc3RlIHB1YmxpYyBrZXkgaGVyZSBhZnRlciBydW5uaW5nIHNjcmlwdHMvZ2VuZXJhdGUta2V5LnNoIFx1MjAxNCBzZWUgUkVBRE1FLiBVbnRpbCB0aGVuLCB0aGUgZXh0ZW5zaW9uIElEIHdpbGwgYmUgcmFuZG9tIHBlciBpbnN0YWxsLiAoSlNPTiBoYXMgbm8gY29tbWVudHMsIHNvIHRoaXMgdW5kZXJzY29yZS1wcmVmaXhlZCBmaWVsZCBpcyB0aGUgd29ya2Fyb3VuZC4gQ2hyb21lIHdpbGwgcHJpbnQgYSBzaW5nbGUgd2FybmluZyBhYm91dCBpdCBvbiBsb2FkIFx1MjAxNCB0aGF0IHdhcm5pbmcgaXMgdGhlIHJlbWluZGVyLilcIixcblxuICBcIm1hbmlmZXN0X3ZlcnNpb25cIjogMyxcbiAgXCJuYW1lXCI6IFwiQ3JpdGhcIixcbiAgXCJ2ZXJzaW9uXCI6IFwiMC4wLjFcIixcbiAgXCJkZXNjcmlwdGlvblwiOiBcIlN0b3AgQUkgZnJvbSB0aGlua2luZyBmb3IgeW91LiBDcml0aCBzdXJmYWNlcyB0aGUgZ2FwcywgYXNzdW1wdGlvbnMsIGFuZCBlYXN5IHZhbGlkYXRpb25zIGluIGV2ZXJ5IEFJIHJlc3BvbnNlIHNvIHlvdSBjYW4gcHVzaCBiYWNrIGJlZm9yZSB5b3UgYWNjZXB0IHRoZSBhbnN3ZXIuXCIsXG5cbiAgXCJhY3Rpb25cIjoge1xuICAgIFwiZGVmYXVsdF9wb3B1cFwiOiBcInNyYy9wb3B1cC9wb3B1cC5odG1sXCIsXG4gICAgXCJkZWZhdWx0X3RpdGxlXCI6IFwiQ3JpdGhcIlxuICB9LFxuXG4gIFwib3B0aW9uc191aVwiOiB7XG4gICAgXCJwYWdlXCI6IFwic3JjL3Jldmlldy9yZXZpZXcuaHRtbFwiLFxuICAgIFwib3Blbl9pbl90YWJcIjogdHJ1ZVxuICB9LFxuXG4gIFwiYmFja2dyb3VuZFwiOiB7XG4gICAgXCJzZXJ2aWNlX3dvcmtlclwiOiBcInNyYy9iYWNrZ3JvdW5kL3NlcnZpY2Utd29ya2VyLnRzXCIsXG4gICAgXCJ0eXBlXCI6IFwibW9kdWxlXCJcbiAgfSxcblxuICBcInBlcm1pc3Npb25zXCI6IFtcbiAgICBcInN0b3JhZ2VcIixcbiAgICBcImFjdGl2ZVRhYlwiXG4gIF0sXG5cbiAgXCJob3N0X3Blcm1pc3Npb25zXCI6IFtcbiAgICBcImh0dHBzOi8vY2hhdGdwdC5jb20vKlwiLFxuICAgIFwiaHR0cHM6Ly9jaGF0Lm9wZW5haS5jb20vKlwiLFxuICAgIFwiaHR0cHM6Ly9jbGF1ZGUuYWkvKlwiLFxuICAgIFwiaHR0cHM6Ly9nZW1pbmkuZ29vZ2xlLmNvbS8qXCIsXG4gICAgXCJodHRwczovL2NyaXRoLWJhY2tlbmQudmVyY2VsLmFwcC8qXCJcbiAgXSxcblxuICBcImNvbnRlbnRfc2NyaXB0c1wiOiBbXG4gICAge1xuICAgICAgXCJtYXRjaGVzXCI6IFtcbiAgICAgICAgXCJodHRwczovL2NoYXRncHQuY29tLypcIixcbiAgICAgICAgXCJodHRwczovL2NoYXQub3BlbmFpLmNvbS8qXCIsXG4gICAgICAgIFwiaHR0cHM6Ly9jbGF1ZGUuYWkvKlwiLFxuICAgICAgICBcImh0dHBzOi8vZ2VtaW5pLmdvb2dsZS5jb20vKlwiLFxuICAgICAgICBcImh0dHBzOi8vd3d3LnBlcnBsZXhpdHkuYWkvKlwiLFxuICAgICAgICBcImh0dHBzOi8vcGVycGxleGl0eS5haS8qXCIsXG4gICAgICAgIFwiaHR0cHM6Ly9ncm9rLmNvbS8qXCIsXG4gICAgICAgIFwiaHR0cHM6Ly9jaGF0LmRlZXBzZWVrLmNvbS8qXCIsXG4gICAgICAgIFwiaHR0cHM6Ly9kZWVwc2Vlay5jb20vKlwiXG4gICAgICBdLFxuICAgICAgXCJqc1wiOiBbXCJzcmMvY29udGVudC9zaGFyZWQvcHJvdi1vcmNoZXN0cmF0b3IudHNcIl0sXG4gICAgICBcImNzc1wiOiBbXCJzcmMvY29udGVudC9zaGFyZWQvdW5kZXJsaW5lLmNzc1wiXSxcbiAgICAgIFwicnVuX2F0XCI6IFwiZG9jdW1lbnRfaWRsZVwiXG4gICAgfVxuICBdXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStSLFNBQVMsb0JBQW9CO0FBQzVULFNBQVMsV0FBVzs7O0FDRHBCO0FBQUEsRUFDRSxXQUFhO0FBQUEsRUFFYixrQkFBb0I7QUFBQSxFQUNwQixNQUFRO0FBQUEsRUFDUixTQUFXO0FBQUEsRUFDWCxhQUFlO0FBQUEsRUFFZixRQUFVO0FBQUEsSUFDUixlQUFpQjtBQUFBLElBQ2pCLGVBQWlCO0FBQUEsRUFDbkI7QUFBQSxFQUVBLFlBQWM7QUFBQSxJQUNaLE1BQVE7QUFBQSxJQUNSLGFBQWU7QUFBQSxFQUNqQjtBQUFBLEVBRUEsWUFBYztBQUFBLElBQ1osZ0JBQWtCO0FBQUEsSUFDbEIsTUFBUTtBQUFBLEVBQ1Y7QUFBQSxFQUVBLGFBQWU7QUFBQSxJQUNiO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFBQSxFQUVBLGtCQUFvQjtBQUFBLElBQ2xCO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFBQSxFQUVBLGlCQUFtQjtBQUFBLElBQ2pCO0FBQUEsTUFDRSxTQUFXO0FBQUEsUUFDVDtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUFBLE1BQ0EsSUFBTSxDQUFDLHlDQUF5QztBQUFBLE1BQ2hELEtBQU8sQ0FBQyxrQ0FBa0M7QUFBQSxNQUMxQyxRQUFVO0FBQUEsSUFDWjtBQUFBLEVBQ0Y7QUFDRjs7O0FEbERBLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLElBQUksRUFBRSxVQUFVLGlCQUFrQixDQUFDO0FBQUEsRUFDckM7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLGFBQWE7QUFBQSxJQUNiLFdBQVc7QUFBQSxJQUNYLFFBQVE7QUFBQSxFQUNWO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixLQUFLLEVBQUUsTUFBTSxLQUFLO0FBQUEsRUFDcEI7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
