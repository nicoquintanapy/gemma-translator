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

// transformers 4.2.0 was already shown to fail on all three repos with
// "Missing required scale" — the same optimizer that broke translation. The
// open question is whether 3.8.1, whose onnxruntime predates that optimizer,
// gets past it. Both are run so the comparison is in one output.
const CANDIDATES = []
for (const lib of ["3.8.1", "4.2.0"]) {
  for (const repo of [
    "onnx-community/whisper-tiny",
    "Xenova/whisper-tiny",
  ]) {
    CANDIDATES.push({ lib, repo, dtype: "q8" })
  }
}

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
    up = (await fetch("http://127.0.0.1:4192/")).ok
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

const browser = await chromium.launch({
  // En CI se usa el Chromium que instala Playwright; en local, el preinstalado.
  executablePath: process.env.PW_CHROME || undefined,
  args: ["--no-sandbox"],
})
const page = await (await browser.newContext()).newPage()
page.on("pageerror", (e) => console.log("  [pageerror]", e.message))

await page.goto("http://127.0.0.1:4192/", { waitUntil: "load" })
await page.waitForFunction(() => window.probeReady === true, null, { timeout: 30000 })
console.log("crossOriginIsolated:", await page.evaluate(() => globalThis.crossOriginIsolated))

const results = []
for (const candidate of CANDIDATES) {
  console.log(`\n--- transformers ${candidate.lib} · ${candidate.repo} (${candidate.dtype}) ---`)
  const result = await page.evaluate((c) => window.runProbe(c), candidate)
  results.push({ ...candidate, ...result })
  console.log(
    result.ok
      ? `  OK  cargado en ${result.loadedMs} ms, transcribió en ${result.totalMs} ms · texto: ${JSON.stringify(result.text)}`
      : `  FALLO: ${result.error}`,
  )
}

await browser.close()
server.kill("SIGKILL")

console.log("\n================ RESUMEN ================")
for (const r of results) {
  console.log(`${r.ok ? "PASA " : "FALLA"}  transformers ${r.lib}  ${r.repo}${r.ok ? "" : `  <- ${r.error.slice(0, 90)}`}`)
}
const anyPass = results.some((r) => r.ok)
console.log(anyPass ? "\nAl menos un modelo carga: la voz es viable." : "\nNinguno carga: hay que cambiar de motor STT.")
process.exit(anyPass ? 0 : 1)
