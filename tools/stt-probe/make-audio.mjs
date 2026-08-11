/**
 * Synthesises Spanish speech with known ground-truth text, so transcription
 * accuracy can be measured rather than eyeballed.
 *
 * Caveat worth stating plainly: espeak-ng is robotic synthetic speech, a
 * different distribution from a human voice. Whisper generally does *worse* on
 * it than on real speech, so the word error rates this produces are a floor,
 * not a prediction. What it does measure honestly is the relative gap between
 * model sizes, and any gross failure — a model that cannot handle Spanish at
 * all will be obvious.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Phrases in the register this app is actually for: travel and medical.
const SENTENCES = [
  "¿Dónde está la estación de tren más cercana?",
  "Necesito un médico porque me duele mucho la cabeza.",
  "¿Cuánto cuesta el billete de autobús hasta el centro?",
  "El clima está muy agradable hoy y quiero salir a caminar.",
  "Por favor, ¿podría repetir eso más despacio?",
]

const dir = join(process.cwd(), "audio")
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const reference = SENTENCES.map((text, index) => {
  const file = `${String(index).padStart(2, "0")}.wav`
  execFileSync("espeak-ng", ["-v", "es", "-s", "150", "-w", join(dir, file), text])
  return { file: `audio/${file}`, text }
})

writeFileSync(join(dir, "reference.json"), JSON.stringify(reference, null, 1))
console.log(`[audio] ${reference.length} frases sintetizadas en audio/`)
