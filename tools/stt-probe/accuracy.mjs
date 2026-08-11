/**
 * Measures how well Whisper actually transcribes Spanish, per model size.
 *
 * The liveness probe (probe.mjs) answered "does a session build". That is not
 * the question that decides whether voice input is worth ~60-70 MB and a second
 * runtime: a model that loads but mistranscribes is worse than no model, since
 * its errors are then fed into the translator and compound.
 */

import { chromium } from "playwright"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

const MODELS = [
  { lib: "3.8.1", repo: "onnx-community/whisper-tiny", dtype: "q8", approxMb: 45 },
  { lib: "3.8.1", repo: "onnx-community/whisper-base", dtype: "q8", approxMb: 150 },
]

/** Lowercase, strip punctuation, collapse spaces. Accents are kept: they are
 *  part of being correct in Spanish. */
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[¿?¡!.,;:"'()—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Word error rate: edit distance over words, divided by reference length. */
function wordErrorRate(reference, hypothesis) {
  const a = normalise(reference).split(" ").filter(Boolean)
  const b = normalise(hypothesis).split(" ").filter(Boolean)
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return a.length ? d[a.length][b.length] / a.length : 0
}

const reference = JSON.parse(readFileSync("audio/reference.json", "utf8"))

const server = spawn(process.execPath, ["server.mjs"], { cwd: process.cwd(), stdio: "pipe" })
server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on("data", (d) => process.stdout.write(`[server:err] ${d}`))

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
  executablePath: process.env.PW_CHROME || undefined,
  args: ["--no-sandbox"],
})
const page = await (await browser.newContext()).newPage()
page.on("pageerror", (e) => console.log("  [pageerror]", e.message))

await page.goto("http://127.0.0.1:4192/", { waitUntil: "load" })
await page.waitForFunction(() => window.probeReady === true, null, { timeout: 30000 })
console.log("crossOriginIsolated:", await page.evaluate(() => globalThis.crossOriginIsolated))

const summary = []
for (const model of MODELS) {
  console.log(`\n=== ${model.repo} (~${model.approxMb} MB) ===`)
  const outcome = await page.evaluate(
    (m) => window.runAccuracy({ ...m, files: m.files }),
    { ...model, files: reference.map((r) => r.file) },
  )

  if (!outcome.ok) {
    console.log(`  FALLO: ${outcome.error}`)
    summary.push({ ...model, failed: outcome.error })
    continue
  }

  let totalWer = 0
  let totalMs = 0
  let totalSeconds = 0
  for (const [index, result] of outcome.results.entries()) {
    const expected = reference[index].text
    const wer = wordErrorRate(expected, result.text)
    totalWer += wer
    totalMs += result.ms
    totalSeconds += result.seconds
    console.log(`  esperado : ${expected}`)
    console.log(`  obtenido : ${result.text}`)
    console.log(`  WER ${(wer * 100).toFixed(0)}%  ·  ${result.ms} ms para ${result.seconds}s de audio\n`)
  }

  const avgWer = totalWer / outcome.results.length
  summary.push({
    ...model,
    wer: avgWer,
    loadedMs: outcome.loadedMs,
    realtime: totalMs / 1000 / totalSeconds,
  })
}

await browser.close()
server.kill("SIGKILL")

console.log("================ RESUMEN ================")
for (const s of summary) {
  if (s.failed) {
    console.log(`${s.repo}  FALLÓ: ${s.failed.slice(0, 80)}`)
    continue
  }
  console.log(
    `${s.repo.padEnd(30)} ~${String(s.approxMb).padStart(3)} MB  ` +
      `WER ${(s.wer * 100).toFixed(0).padStart(3)}%  ` +
      `carga ${s.loadedMs} ms  ` +
      `${s.realtime.toFixed(2)}x tiempo real`,
  )
}
console.log(
  "\nWER sobre voz sintética (espeak-ng), que es más difícil que la voz humana:\n" +
    "tómalo como cota superior del error, y sobre todo como comparación entre tamaños.",
)
