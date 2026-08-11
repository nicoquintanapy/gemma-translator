/**
 * Copies the onnxruntime-web WASM runtime into `public/ort/`.
 *
 * By default transformers.js fetches these binaries from cdn.jsdelivr.net at
 * engine-init time. That silently breaks the core promise of this app: a user
 * who downloaded the models and then went offline would still hit the network
 * on the next page load and fail. Self-hosting them (and pointing
 * `env.backends.onnx.wasm.wasmPaths` at `/ort/`) keeps every byte same-origin
 * and cacheable by the service worker.
 *
 * Run automatically via the `predev` / `prebuild` npm scripts.
 */

import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const src = join(root, "node_modules", "onnxruntime-web", "dist")
const dest = join(root, "public", "ort")

// The filenames transformers.js resolves against `wasmPaths`. The plain build
// serves the CPU/WASM backend; the asyncify build is what the WebGPU path
// falls back onto for async kernels.
const FILES = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]

if (!existsSync(src)) {
  console.error(
    "[copy-ort] onnxruntime-web not found. Run `npm install` first.",
  )
  process.exit(1)
}

mkdirSync(dest, { recursive: true })

let copied = 0
let bytes = 0
for (const file of FILES) {
  const from = join(src, file)
  if (!existsSync(from)) {
    // Not every ORT release ships every variant; the ones that matter for the
    // default CPU path are checked below.
    console.warn(`[copy-ort] skipping missing ${file}`)
    continue
  }
  copyFileSync(from, join(dest, file))
  copied++
  bytes += statSync(from).size
}

if (!existsSync(join(dest, "ort-wasm-simd-threaded.wasm"))) {
  console.error("[copy-ort] the CPU runtime is missing — the app cannot run.")
  process.exit(1)
}

console.log(
  `[copy-ort] copied ${copied} files (${(bytes / 1024 / 1024).toFixed(1)} MB) to public/ort/`,
)
