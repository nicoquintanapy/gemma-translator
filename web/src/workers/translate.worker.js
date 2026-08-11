// Translation worker. Two interchangeable engines:
//
//   nllb — one 350 MB model covering 200 languages. Source and target are
//          passed as FLORES-200 tags; any pair works with nothing else to
//          download, ever.
//   opus — a small dedicated model per direction (~90 MB). Only the pairs the
//          user actually selects get downloaded, at the cost of one download
//          per new pair and an English pivot for combinations Helsinki-NLP
//          never published.
//
// Neither is a chat LLM, so in both cases there is no prompt to write and no
// JSON envelope to parse back out — the decoder emits the translation itself.

import { pipeline, TextStreamer } from "@huggingface/transformers"
import { TRANSLATION_MODEL } from "../lib/engineConfig.js"
import { buildWithFallback, makeDownloadReporter, serve } from "./runtime.js"

// --- NLLB -------------------------------------------------------------------

let nllb = null
let nllbProfile = null
let nllbLoading = null

async function loadNllb(device, report, dtypeOverride) {
  if (nllb) return nllb
  if (nllbLoading) return nllbLoading

  nllbLoading = (async () => {
    const onProgress = makeDownloadReporter(report)
    const { instance, profile } = await buildWithFallback(
      (target, sessionOptions) =>
        pipeline("translation", TRANSLATION_MODEL.id, {
          device: target,
          dtype: dtypeOverride ?? TRANSLATION_MODEL.dtype,
          session_options: sessionOptions,
          progress_callback: onProgress,
        }),
      device,
      (message) => report({ kind: "notice", text: `Traductor: ${message}` }),
    )
    nllb = instance
    nllbProfile = profile
    return nllb
  })()

  try {
    return await nllbLoading
  } finally {
    nllbLoading = null
  }
}

// --- Opus-MT packs ----------------------------------------------------------

// Keeping every pack the user has ever selected resident would defeat the point
// of the light engine, so packs are held in a small LRU. Two is the minimum
// that lets a pivot route (xx→en→yy) run without thrashing; three leaves room
// to swap direction without an immediate reload.
const MAX_RESIDENT_PACKS = 3

const packs = new Map() // repo -> pipeline, in insertion order (oldest first)
const packLoads = new Map() // repo -> in-flight promise

async function evictOldestPack() {
  const oldest = packs.keys().next().value
  if (oldest === undefined) return
  const victim = packs.get(oldest)
  packs.delete(oldest)
  await victim?.dispose?.()
}

async function loadPack(repo, device, report, dtypeOverride) {
  const resident = packs.get(repo)
  if (resident) {
    // Refresh recency.
    packs.delete(repo)
    packs.set(repo, resident)
    return resident
  }
  if (packLoads.has(repo)) return packLoads.get(repo)

  const loading = (async () => {
    const onProgress = makeDownloadReporter(report)
    const { instance } = await buildWithFallback(
      (target, sessionOptions) =>
        pipeline("translation", repo, {
          device: target,
          dtype: dtypeOverride ?? "q8",
          session_options: sessionOptions,
          progress_callback: onProgress,
        }),
      device,
      (message) => report({ kind: "notice", text: `${repo}: ${message}` }),
    )
    while (packs.size >= MAX_RESIDENT_PACKS) await evictOldestPack()
    packs.set(repo, instance)
    return instance
  })()

  packLoads.set(repo, loading)
  try {
    return await loading
  } finally {
    packLoads.delete(repo)
  }
}

// --- RPC surface ------------------------------------------------------------

let activeEngine = "nllb"
let activeDevice = null
let activeDtype = null

async function load({ device, engine, route, dtypeOverride }, report) {
  activeEngine = engine ?? "nllb"
  activeDevice = device
  activeDtype = dtypeOverride ?? null

  if (activeEngine === "opus") {
    for (const step of route?.steps ?? []) {
      await loadPack(step.repo, device, report, activeDtype)
    }
    return { device, engine: activeEngine, packs: [...packs.keys()] }
  }

  await loadNllb(device, report, activeDtype)
  return { device, engine: activeEngine, profile: nllbProfile }
}

/** Loads any packs a route needs that are not already resident. */
async function loadRoute({ route }, report) {
  if (activeEngine !== "opus") return { packs: [] }
  for (const step of route?.steps ?? []) {
    await loadPack(step.repo, activeDevice, report, activeDtype)
  }
  return { packs: [...packs.keys()] }
}

function makeStreamer(instance, report) {
  return new TextStreamer(instance.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => report({ kind: "partial", text: chunk }),
  })
}

async function translate({ text, srcLang, tgtLang, route }, report) {
  const source = text.trim()
  if (!source) return { text: "", ms: 0 }

  const started = performance.now()
  let result

  if (activeEngine === "opus") {
    const steps = route?.steps ?? []
    if (steps.length === 0) throw new Error("No hay ruta de traducción cargada")

    let current = source
    for (const [index, step] of steps.entries()) {
      const instance = packs.get(step.repo)
      if (!instance) throw new Error(`El paquete ${step.repo} no está cargado`)
      const isLast = index === steps.length - 1
      // Only stream the final hop; the intermediate English text is plumbing,
      // not something the user asked to watch appear.
      const output = await instance(current, {
        max_new_tokens: 512,
        ...(isLast ? { streamer: makeStreamer(instance, report) } : {}),
      })
      current = output?.[0]?.translation_text?.trim() ?? ""
      if (!current) break
    }
    result = current
  } else {
    if (!nllb) throw new Error("El modelo de traducción no está cargado")
    const output = await nllb(source, {
      src_lang: srcLang,
      tgt_lang: tgtLang,
      max_new_tokens: 512,
      streamer: makeStreamer(nllb, report),
    })
    result = output?.[0]?.translation_text?.trim() ?? ""
  }

  return { text: result, ms: Math.round(performance.now() - started) }
}

async function unload() {
  await nllb?.dispose?.()
  nllb = null
  while (packs.size > 0) await evictOldestPack()
  return { ok: true }
}

serve({ load, loadRoute, translate, unload })
