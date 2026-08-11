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

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
// transformers.js ships the exact onnxruntime build it expects in its own
// dist, and its default wasmPaths point at that package on a CDN. Copying from
// there — rather than from onnxruntime-web — guarantees the binaries match the
// library version, and only the files it actually asks for get copied.
const primary = join(root, "node_modules", "@huggingface", "transformers", "dist")
const secondary = join(root, "node_modules", "onnxruntime-web", "dist")
const dest = join(root, "public", "ort")

// Every onnxruntime artefact either package ships. The set differs between
// library versions — v3 uses only the jsep build, which serves both the CPU and
// WebGPU paths — so the list is discovered rather than hardcoded.
const ORT_FILE = /^ort-wasm.*\.(wasm|mjs)$/

if (!existsSync(primary) && !existsSync(secondary)) {
  console.error(
    "[copy-ort] no onnxruntime build found. Run `npm install` first.",
  )
  process.exit(1)
}

// Later sources do not overwrite earlier ones: the library's own copy wins.
const sources = [primary, secondary].filter(existsSync)
const FILES = []
for (const dir of sources) {
  for (const name of readdirSync(dir)) {
    if (ORT_FILE.test(name) && !FILES.some(([n]) => n === name)) {
      FILES.push([name, dir])
    }
  }
}

// Wipe first. Different library versions ship different onnxruntime variants,
// and `wasmPaths` points at this directory as a whole — leaving a binary from a
// previous version behind risks the loader picking up a mismatched build.
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

let copied = 0
let bytes = 0
for (const [name, dir] of FILES) {
  const from = join(dir, name)
  copyFileSync(from, join(dest, name))
  copied++
  bytes += statSync(from).size
}

// Whatever the variant, at least one .wasm must have landed or nothing can run.
if (!FILES.some(([name]) => name.endsWith(".wasm"))) {
  console.error("[copy-ort] no wasm runtime was copied — the app cannot run.")
  process.exit(1)
}

console.log(
  `[copy-ort] copied ${copied} files (${(bytes / 1024 / 1024).toFixed(1)} MB) to public/ort/`,
)
