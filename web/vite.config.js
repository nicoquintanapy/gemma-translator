import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"

// Cross-origin isolation unlocks SharedArrayBuffer, which is what lets
// onnxruntime-web run multi-threaded WASM — the difference between a
// translation taking ~2s and ~10s on CPU.
//
// `credentialless` rather than `require-corp`: require-corp would reject the
// cross-origin model downloads from huggingface.co unless HF served CORP
// headers, which it does not guarantee. Browsers that don't understand
// `credentialless` simply ignore it and fall back to single-threaded WASM,
// which still works.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
}

// GitHub Pages serves project sites from a subpath (/<repo>/), so every asset
// URL — including the service worker scope and the self-hosted WASM runtime —
// has to be built relative to it. Defaults to "/" for local dev and for hosts
// that serve from the root.
const base = process.env.VITE_BASE || "/"

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // The ORT runtime is tens of megabytes; precaching it would stall the
      // service worker install on first visit. It is cached on demand instead
      // (see runtimeCaching below), during the explicit model download step.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2,json}"],
        // Models are cached on demand by the app, not precached: bundling
        // hundreds of megabytes into the install step would stall first load.
        globIgnores: ["**/models/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Model files. Same cache name the app writes to directly, so a
            // file fetched by either path satisfies the other.
            urlPattern: ({ url }) => url.pathname.includes("/models/"),
            handler: "CacheFirst",
            options: {
              cacheName: "bergamot-models",
              expiration: { maxEntries: 200 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The WASM engine and its worker glue.
            urlPattern: ({ url }) => url.pathname.includes("/bergamot/"),
            handler: "CacheFirst",
            options: {
              cacheName: "bergamot-engine",
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "Traductor Offline",
        short_name: "Traductor",
        description:
          "Traductor de voz y texto que descarga los modelos y los ejecuta enteramente en el navegador.",
        theme_color: "#0b0f14",
        background_color: "#0b0f14",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: "es" },
  server: { host: "0.0.0.0", port: 5174, headers: isolationHeaders },
  preview: { host: "0.0.0.0", port: 4174, headers: isolationHeaders },

})
