/**
 * Prepares everything the app serves from its own origin:
 *
 *   public/bergamot/worker/  the Marian WASM engine
 *   public/models/           translation models, plus a registry pointing at them
 *
 * Both are downloaded/copied at build time rather than committed, so the repo
 * stays small while the deployed site stays entirely self-contained.
 *
 * Self-hosting the models is not an optimisation, it is a requirement: the
 * Google Cloud Storage buckets that publish them send no CORS headers, so a
 * browser on another origin simply cannot fetch them. Serving them ourselves
 * sidesteps that and removes the runtime dependency on someone else's bucket.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const publicDir = join(root, "public")

const REGISTRY_URL =
  "https://storage.googleapis.com/bergamot-models-sandbox/0.3.3/registry.json"
const MODEL_BASE = "https://storage.googleapis.com/bergamot-models-sandbox/0.3.3"

// Which language pairs to bundle. Every Bergamot pair goes through English, so
// this list is "which languages", doubled. Callers can override to trim a
// deployment or widen it; the upstream registry publishes 29 pairs in total.
const LANGUAGES = (process.env.TRANSLATION_LANGUAGES ?? "es,en,pt,fr,de,it")
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean)

function pairsFor(languages) {
  const pairs = new Set()
  for (const code of languages) {
    if (code === "en") continue
    pairs.add(`${code}en`)
    pairs.add(`en${code}`)
  }
  return [...pairs]
}

// --- engine -----------------------------------------------------------------

function copyEngine() {
  const pkg = join(root, "node_modules", "@browsermt", "bergamot-translator")
  const to = join(publicDir, "bergamot")
  if (!existsSync(pkg)) {
    console.error("[assets] bergamot-translator not installed. Run `npm install` first.")
    process.exit(1)
  }

  // The whole engine is copied out and loaded from here at runtime rather than
  // imported through the bundler. Its worker does
  // `importScripts("bergamot-translator-worker.js")` and resolves its .wasm
  // against its own location, so bundling it moves the worker to /assets/ and
  // breaks both lookups. Served as a unit from one directory, every relative
  // path inside it resolves the way the package expects.
  rmSync(to, { recursive: true, force: true })
  mkdirSync(join(to, "worker"), { recursive: true })

  let bytes = 0
  const copy = (relative) => {
    const from = join(pkg, relative)
    copyFileSync(from, join(to, relative))
    bytes += statSync(from).size
  }
  copy("translator.js")
  for (const name of readdirSync(join(pkg, "worker"))) copy(join("worker", name))

  console.log(`[assets] engine: ${(bytes / 1024 / 1024).toFixed(1)} MB -> public/bergamot/`)
}

// --- models -----------------------------------------------------------------

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} for ${url}`)
  // The bucket stores these gzip-encoded; fetch transparently decodes, so what
  // lands on disk is the plain binary the engine expects.
  return Buffer.from(await response.arrayBuffer())
}

async function fetchModels() {
  const pairs = pairsFor(LANGUAGES)
  console.log(`[assets] languages: ${LANGUAGES.join(", ")} -> ${pairs.length} pairs`)

  const upstream = await (await fetch(REGISTRY_URL)).json()
  const modelsDir = join(publicDir, "models")
  mkdirSync(modelsDir, { recursive: true })

  const registry = {}
  let total = 0

  for (const pair of pairs) {
    const entry = upstream[pair]
    if (!entry) {
      console.warn(`[assets] no upstream model for ${pair}, skipping`)
      continue
    }

    const dir = join(modelsDir, pair)
    mkdirSync(dir, { recursive: true })
    const local = {}

    for (const [part, file] of Object.entries(entry)) {
      const target = join(dir, file.name)
      let data
      if (existsSync(target)) {
        data = null // already present from a previous run or a CI cache
      } else {
        data = await download(`${MODEL_BASE}/${pair}/${file.name}`)
        await writeFile(target, data)
      }
      const size = statSync(target).size
      total += size
      local[part] = {
        // Relative on purpose: the app is served from "/" locally and from
        // "/<repo>/" on GitHub Pages, and a relative name resolves correctly
        // against the document in both without baking the base path in.
        name: `models/${pair}/${file.name}`,
        size,
        expectedSha256Hash: file.expectedSha256Hash,
        modelType: file.modelType,
      }
    }
    registry[pair] = local
  }

  writeFileSync(join(modelsDir, "registry.json"), JSON.stringify(registry, null, 1))
  console.log(
    `[assets] models: ${Object.keys(registry).length} pairs, ${(total / 1024 / 1024).toFixed(0)} MB -> public/models/`,
  )
}

// The upstream registry ships sha256 hashes, but they describe the *compressed*
// objects, while what we store (and what the engine loads) is decompressed.
// Recomputing keeps the integrity check meaningful instead of guaranteed-wrong.
function rehash() {
  const modelsDir = join(publicDir, "models")
  const path = join(modelsDir, "registry.json")
  const registry = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  for (const files of Object.values(registry)) {
    for (const file of Object.values(files)) {
      const bytes = readFileSync(join(publicDir, file.name))
      file.expectedSha256Hash = createHash("sha256").update(bytes).digest("hex")
      file.size = bytes.length
    }
  }
  writeFileSync(path, JSON.stringify(registry, null, 1))
  console.log("[assets] registry hashes recomputed for the decompressed files")
}

copyEngine()
await fetchModels()
rehash()
