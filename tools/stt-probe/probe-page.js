// Runs in the page as a real ES module, loaded by a <script type="module">.
//
// The probe logic lives here rather than inside page.evaluate() because code
// evaluated that way has no base URL, so dynamic import() cannot resolve any
// specifier at all — not even an absolute path.
// transformers.min.js, not transformers.web.js: the latter still carries bare
// imports like "onnxruntime-web/webgpu" and expects a bundler, so a browser
// loading it directly fails to resolve them. This one is self-contained.
import { pipeline } from "/node_modules/@huggingface/transformers/dist/transformers.min.js"

window.runProbe = async ({ repo, dtype }) => {
  const started = performance.now()
  try {
    const transcriber = await pipeline("automatic-speech-recognition", repo, { device: "wasm", dtype })
    const loadedMs = Math.round(performance.now() - started)

    // One second of quiet 16 kHz tone. Accuracy is not the subject; whether
    // onnxruntime will build and run the graph at all is.
    const audio = new Float32Array(16000)
    for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i / 20) * 0.02

    const output = await transcriber(audio, { language: "spanish", task: "transcribe" })
    return {
      ok: true,
      loadedMs,
      totalMs: Math.round(performance.now() - started),
      text: (output?.text ?? "").slice(0, 80),
    }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 300) }
  }
}

window.probeReady = true
