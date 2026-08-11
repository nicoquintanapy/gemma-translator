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
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["**/ort/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Self-hosted onnxruntime-web binaries. Two locations matter: the
            // copies under /ort/ that `wasmPaths` points at, and the .wasm
            // Vite emits into /assets/ from transformers.js' own imports.
            urlPattern: ({ url }) =>
              url.pathname.includes("/ort/") ||
              url.pathname.endsWith(".wasm") ||
              url.pathname.endsWith(".mjs"),
            handler: "CacheFirst",
            options: {
              cacheName: "ort-runtime",
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
  // transformers.js is loaded lazily inside the workers; keeping it out of the
  // optimizer's eager scan avoids a large dev-server prebundle on boot.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
})
