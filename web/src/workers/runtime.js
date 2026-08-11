// Shared worker-side setup: configures transformers.js for a fully offline,
// same-origin runtime and provides the request/response plumbing both workers
// use to talk to the main thread.

import { env } from "@huggingface/transformers"
import { MODEL_CACHE_KEY } from "../lib/engineConfig.js"

// No filesystem in a browser; every model comes from the Hub and is then
// served out of Cache Storage.
env.allowLocalModels = false
env.useBrowserCache = true
env.cacheKey = MODEL_CACHE_KEY

// Point onnxruntime-web at the self-hosted binaries copied by
// scripts/copy-ort.mjs. Without this it fetches them from a CDN on every cold
// start, which would make the app fail the moment the user is actually offline.
const ortWasm = env.backends?.onnx?.wasm
if (ortWasm) {
  // BASE_URL, not a leading slash: on GitHub Pages the app lives under
  // /<repo>/, so an absolute "/ort/" would 404.
  ortWasm.wasmPaths = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.href).href
  // Threads need SharedArrayBuffer, which needs cross-origin isolation. When
  // the host doesn't send COOP/COEP we must stay single-threaded or ORT throws.
  ortWasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1
}

export async function hasWebGPU() {
  if (!("gpu" in navigator)) return false
  try {
    return Boolean(await navigator.gpu.requestAdapter())
  } catch {
    return false
  }
}

/**
 * Builds a pipeline on `preferred`, falling back to WASM if that device can't
 * run the model. Returns the pipeline plus the device actually used, so the UI
 * can tell the truth about what is running.
 */
export async function buildWithFallback(create, preferred, onFallback) {
  const ladder = preferred === "webgpu" ? ["webgpu", "wasm"] : ["wasm"]
  let lastError
  for (const device of ladder) {
    if (device === "webgpu" && !(await hasWebGPU())) {
      lastError = new Error("WebGPU no disponible en este navegador")
      onFallback?.(device, lastError)
      continue
    }
    try {
      const instance = await create(device)
      return { instance, device }
    } catch (error) {
      lastError = error
      onFallback?.(device, error)
    }
  }
  throw lastError ?? new Error("No se pudo inicializar ningún backend")
}

/**
 * Wires a worker's message handler to a table of async handlers.
 *
 * Each incoming `{ id, type, payload }` produces exactly one terminal message
 * (`complete` or `error`) plus any number of interim `progress` messages the
 * handler emits through the `report` callback it is given.
 */
export function serve(handlers) {
  self.addEventListener("message", async (event) => {
    const { id, type, payload } = event.data ?? {}
    const handler = handlers[type]
    if (!handler) {
      self.postMessage({ id, status: "error", error: `Acción desconocida: ${type}` })
      return
    }
    const report = (data) => self.postMessage({ id, status: "progress", data })
    try {
      const result = await handler(payload, report)
      self.postMessage({ id, status: "complete", data: result })
    } catch (error) {
      self.postMessage({
        id,
        status: "error",
        error: error?.message ?? String(error),
      })
    }
  })
}

/**
 * Normalises transformers.js download callbacks into a stable per-file record.
 * The library emits `initiate` / `download` / `progress` / `done` events with
 * inconsistent shapes; the UI only ever sees `{ file, loaded, total }`.
 */
export function makeDownloadReporter(report) {
  const files = new Map()
  return (event) => {
    if (!event?.file) return
    if (event.status === "done") {
      const known = files.get(event.file)
      if (known) known.loaded = known.total
    } else if (event.status === "progress") {
      files.set(event.file, {
        file: event.file,
        loaded: event.loaded ?? 0,
        total: event.total ?? 0,
      })
    } else if (event.status === "initiate") {
      files.set(event.file, { file: event.file, loaded: 0, total: event.total ?? 0 })
    } else {
      return
    }
    report({ kind: "download", files: [...files.values()] })
  }
}
