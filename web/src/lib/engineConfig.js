// Single source of truth for what gets downloaded and where it is stored.
// Imported by both the UI (to render the download gate) and the workers.

// All model files land in one Cache Storage bucket so "delete models" is a
// single, unambiguous operation instead of guessing at library internals.
export const MODEL_CACHE_KEY = "offline-translator-models"

// transformers.js also keeps a small integrity-hash cache alongside the models.
export const AUX_CACHE_KEYS = ["experimental_transformers-hash-cache"]

// The two translation strategies. "opus" trades universal coverage for a much
// smaller footprint — the right default on phones, where the multilingual
// embedding table is the single biggest thing standing between the user and a
// working app.
export const TRANSLATION_ENGINES = {
  opus: {
    label: "Ligero — un paquete por par de idiomas",
    detail: "~90 MB por dirección. Solo descargas los pares que uses.",
  },
  nllb: {
    label: "Universal — un solo modelo, 200 idiomas",
    detail: "350 MB una vez y cualquier combinación funciona para siempre.",
  },
}

export const DEFAULT_TRANSLATION_ENGINE = "opus"

export const TRANSLATION_MODEL = {
  id: "Xenova/nllb-200-distilled-600M",
  label: "NLLB-200 distilled 600M",
  // `q8` maps to the `_quantized` ONNX files in this repo. Roughly 350 MB of
  // weights; the exact figure is reported live by the download progress
  // callback rather than hardcoded here.
  dtype: "q8",
  approxMb: 350,
}

export const STT_MODELS = {
  base: {
    id: "Xenova/whisper-base",
    label: "Whisper base",
    dtype: "q8",
    approxMb: 150,
    note: "Mejor precisión. Recomendado en escritorio.",
  },
  tiny: {
    id: "Xenova/whisper-tiny",
    label: "Whisper tiny",
    dtype: "q8",
    approxMb: 45,
    note: "Más ligero y rápido. Recomendado en móvil.",
  },
}

export const DEFAULT_STT_SIZE = "base"

// WASM is the default and the guaranteed path: the quantized ONNX weights
// these repos publish are int8, which the CPU backend runs natively. WebGPU is
// offered as an opt-in because support for int8 seq2seq kernels varies by
// browser — the workers fall back to WASM automatically when it fails, so
// enabling it can only cost startup time, never correctness.
export const DEVICE_PREFERENCES = {
  wasm: "CPU (WASM)",
  webgpu: "GPU (WebGPU, experimental)",
}

export const DEFAULT_DEVICE = "wasm"
