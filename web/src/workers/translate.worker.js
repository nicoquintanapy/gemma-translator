// Translation worker: NLLB-200 distilled 600M running on onnxruntime-web.
//
// NLLB is a dedicated many-to-many translation model, not a chat LLM, so there
// is no prompt to write and no JSON envelope to parse back out — the source
// and target languages are passed as FLORES-200 tags and the decoder emits the
// translation directly. That is why it beats a general-purpose LLM at ~1/8th
// the download size.

import { pipeline, TextStreamer } from "@huggingface/transformers"
import { TRANSLATION_MODEL } from "../lib/engineConfig.js"
import { buildWithFallback, makeDownloadReporter, serve } from "./runtime.js"

let translator = null
let activeDevice = null
let loading = null

async function load({ device }, report) {
  if (translator && activeDevice === device) {
    return { device: activeDevice, cached: true }
  }
  // Concurrent load requests (e.g. React StrictMode double-invoke) must share
  // one download rather than racing two multi-hundred-megabyte fetches.
  if (loading) return loading

  loading = (async () => {
    const onProgress = makeDownloadReporter(report)
    const { instance, device: resolved } = await buildWithFallback(
      (target) =>
        pipeline("translation", TRANSLATION_MODEL.id, {
          device: target,
          dtype: TRANSLATION_MODEL.dtype,
          progress_callback: onProgress,
        }),
      device,
      (failed, error) =>
        report({ kind: "fallback", from: failed, reason: error?.message }),
    )
    translator = instance
    activeDevice = resolved
    return { device: resolved, cached: false }
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

async function translate({ text, srcLang, tgtLang }, report) {
  if (!translator) throw new Error("El modelo de traducción no está cargado")
  const source = text.trim()
  if (!source) return { text: "", ms: 0 }

  // Stream partial output so long sentences show progress instead of a spinner.
  const streamer = new TextStreamer(translator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => report({ kind: "partial", text: chunk }),
  })

  const started = performance.now()
  const output = await translator(source, {
    src_lang: srcLang,
    tgt_lang: tgtLang,
    max_new_tokens: 512,
    streamer,
  })
  const ms = Math.round(performance.now() - started)

  return { text: output?.[0]?.translation_text?.trim() ?? "", ms }
}

async function unload() {
  await translator?.dispose?.()
  translator = null
  activeDevice = null
  return { ok: true }
}

serve({ load, translate, unload })
