// Speech-to-text worker: Whisper on onnxruntime-web.
//
// The reference kiosk this project grew out of used Moonshine for STT, which
// is English-only. A translator whose microphone only understands English is
// not a translator, so this replaces it with multilingual Whisper — the source
// language is passed explicitly (we always know which lane is talking), which
// is both faster and more accurate than letting it auto-detect.

import { pipeline } from "@huggingface/transformers"
import { STT_MODELS } from "../lib/engineConfig.js"
import { buildWithFallback, makeDownloadReporter, serve } from "./runtime.js"

let transcriber = null
let activeKey = null
let activeDevice = null
let loading = null

async function load({ device, size }, report) {
  const model = STT_MODELS[size] ?? STT_MODELS.base
  const key = `${model.id}@${device}`
  if (transcriber && activeKey === key) {
    return { device: activeDevice, model: model.id, cached: true }
  }
  if (loading) return loading

  loading = (async () => {
    const onProgress = makeDownloadReporter(report)
    const { instance, device: resolved } = await buildWithFallback(
      (target, sessionOptions) =>
        pipeline("automatic-speech-recognition", model.id, {
          device: target,
          dtype: model.dtype,
          session_options: sessionOptions,
          progress_callback: onProgress,
        }),
      device,
      (message) => report({ kind: "notice", text: `Voz: ${message}` }),
    )
    transcriber = instance
    activeDevice = resolved
    activeKey = `${model.id}@${resolved}`
    return { device: resolved, model: model.id, cached: false }
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

async function transcribe({ audio, language }) {
  if (!transcriber) throw new Error("El modelo de voz no está cargado")

  const started = performance.now()
  const output = await transcriber(audio, {
    language: language ?? undefined,
    task: "transcribe",
    // Whisper's receptive field is 30s; chunking keeps longer clips from being
    // silently truncated.
    chunk_length_s: 30,
    stride_length_s: 5,
  })
  const ms = Math.round(performance.now() - started)

  return { text: (output?.text ?? "").trim(), ms }
}

async function unload() {
  await transcriber?.dispose?.()
  transcriber = null
  activeKey = null
  activeDevice = null
  return { ok: true }
}

serve({ load, transcribe, unload })
