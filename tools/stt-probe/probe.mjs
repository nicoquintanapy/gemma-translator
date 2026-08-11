/**
 * Does speech-to-text actually work in a browser here?
 *
 * This exists because six rounds of this project shipped fixes that could not
 * be run: the model host is unreachable from the development sandbox, so every
 * attempt was reasoned from binaries instead of executed. CI has open network
 * access, so the question gets answered here — before any feature is built on
 * top of the answer.
 *
 * It tries several model repos in a real headless Chromium and reports, for
 * each, whether the session was created and what came back. A failure is a
 * result, not an error: the point is to learn which combination works.
 */

import { chromium } from "playwright"
import { spawn } from "node:child_process"

const CANDIDATES = [
  // Modern exports, built for current onnxruntime. Most likely to load.
  { repo: "onnx-community/whisper-tiny", dtype: "q8" },
  { repo: "onnx-community/whisper-base", dtype: "q8" },
  // The legacy-era exports. These are the family that failed for translation
  // with "Missing required scale"; worth knowing whether Whisper's differ.
  { repo: "Xenova/whisper-tiny", dtype: "q8" },
]

// Nunca "ignore": si el servidor no arranca, su error es justo el dato que
// hace falta, y silenciarlo obliga a adivinar.
const server = spawn(process.execPath, ["server.mjs"], { cwd: process.cwd(), stdio: "pipe" })
server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on("data", (d) => process.stdout.write(`[server:err] ${d}`))
server.on("exit", (code) => console.log(`[server] terminó con código ${code}`))

let up = false
let lastError = "(sin intentos)"
for (let i = 0; i < 80 && !up; i++) {
  try {
    up = (await fetch("http://127.0.0.1:4190/")).ok
  } catch (error) {
    lastError = error?.cause?.message ?? error?.message ?? String(error)
  }
  if (!up) await new Promise((r) => setTimeout(r, 250))
}
if (!up) {
  console.log(`el servidor de prueba no respondió. Último error: ${lastError}`)
  server.kill("SIGKILL")
  process.exit(1)
}

const browser = await chromium.launch({ args: ["--no-sandbox"] })
const page = await (await browser.newContext()).newPage()
page.on("pageerror", (e) => console.log("  [pageerror]", e.message))

console.log("crossOriginIsolated:", await page.evaluate(() => globalThis.crossOriginIsolated))

const results = []
for (const candidate of CANDIDATES) {
  console.log(`\n--- ${candidate.repo} (${candidate.dtype}) ---`)
  const result = await page.evaluate(async ({ repo, dtype }) => {
    const started = performance.now()
    try {
      const { pipeline } = await import(
        "/node_modules/@huggingface/transformers/dist/transformers.web.js"
      )
      const transcriber = await pipeline("automatic-speech-recognition", repo, {
        device: "wasm",
        dtype,
      })
      const loadedMs = Math.round(performance.now() - started)

      // One second of quiet 16 kHz audio. Accuracy is not what is being tested
      // — whether onnxruntime will build and run the graph at all is.
      const audio = new Float32Array(16000)
      for (let i = 0; i < audio.length; i++) {
        audio[i] = Math.sin(i / 20) * 0.02
      }
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
  }, candidate)

  results.push({ ...candidate, ...result })
  console.log(result.ok ? `  OK  cargado en ${result.loadedMs} ms, transcribió en ${result.totalMs} ms · texto: ${JSON.stringify(result.text)}` : `  FALLO: ${result.error}`)
}

await browser.close()
server.kill("SIGKILL")

console.log("\n================ RESUMEN ================")
for (const r of results) {
  console.log(`${r.ok ? "PASA " : "FALLA"}  ${r.repo}`)
}
const anyPass = results.some((r) => r.ok)
console.log(anyPass ? "\nAl menos un modelo carga: la voz es viable." : "\nNinguno carga: hay que cambiar de motor STT.")
process.exit(anyPass ? 0 : 1)
