// Runs in the page as a real ES module, loaded by a <script type="module">.
//
// The probe logic lives here rather than inside page.evaluate() because code
// evaluated that way has no base URL, so dynamic import() cannot resolve any
// specifier at all — not even an absolute path.
//
// Both library versions are exposed because they bundle different onnxruntime
// builds, and session creation succeeds under one and not the other:
//   transformers 4.2.0 -> onnxruntime-web 1.26 (has TransposeDQWeightsForMatMulNBits)
//   transformers 3.8.1 -> onnxruntime-web 1.22 (does not)
//
// transformers.min.js, not transformers.web.js: the latter keeps bare imports
// like "onnxruntime-web/webgpu" and expects a bundler.

const LIBS = {
  "4.2.0": "/node_modules/transformers4/dist/transformers.min.js",
  "3.8.1": "/node_modules/transformers3/dist/transformers.min.js",
}

/** Fetches a WAV and returns mono Float32 at the 16 kHz Whisper expects. */
async function loadAudio(url) {
  const bytes = await (await fetch(url)).arrayBuffer()
  const ctx = new AudioContext()
  let decoded
  try {
    decoded = await ctx.decodeAudioData(bytes)
  } finally {
    await ctx.close()
  }
  const frames = Math.ceil(decoded.duration * 16000)
  const offline = new OfflineAudioContext(1, frames, 16000)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

/** Can this library + repo build a session at all? */
window.runProbe = async ({ lib, repo, dtype }) => {
  const started = performance.now()
  try {
    const { pipeline } = await import(LIBS[lib])
    const transcriber = await pipeline("automatic-speech-recognition", repo, { device: "wasm", dtype })
    const loadedMs = Math.round(performance.now() - started)

    const audio = new Float32Array(16000)
    for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i / 20) * 0.02

    const output = await transcriber(audio, { language: "spanish", task: "transcribe" })
    return { ok: true, loadedMs, totalMs: Math.round(performance.now() - started), text: (output?.text ?? "").slice(0, 80) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 260) }
  }
}

/** Transcribes real audio files, for measuring accuracy rather than liveness. */
window.runAccuracy = async ({ lib, repo, dtype, files }) => {
  try {
    const { pipeline } = await import(LIBS[lib])
    const loadStarted = performance.now()
    const transcriber = await pipeline("automatic-speech-recognition", repo, { device: "wasm", dtype })
    const loadedMs = Math.round(performance.now() - loadStarted)

    const results = []
    for (const file of files) {
      const audio = await loadAudio(`/${file}`)
      const started = performance.now()
      const output = await transcriber(audio, { language: "spanish", task: "transcribe" })
      results.push({
        file,
        text: (output?.text ?? "").trim(),
        ms: Math.round(performance.now() - started),
        seconds: +(audio.length / 16000).toFixed(2),
      })
    }
    return { ok: true, loadedMs, results }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 260) }
  }
}

window.probeReady = true
