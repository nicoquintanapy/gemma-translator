// Per-pair translation packs (Opus-MT).
//
// Unlike NLLB — one 350 MB model covering 200 languages — Opus-MT publishes a
// small dedicated model per direction, so a user who only ever goes es↔en
// downloads two ~90 MB packs instead of a multilingual embedding table sized
// for languages they will never use.
//
// The catch is coverage: Helsinki-NLP did not convert every combination, and
// not every conversion has an ONNX build. Rather than hardcode a list of repo
// IDs and hope, this module *probes* the Hub and remembers the answer. An
// unavailable direct pair falls back to pivoting through English, and a pair
// with no route at all is reported as such instead of failing mid-download.

import { getLanguage } from "./languages.js"

const AVAILABILITY_KEY = "opus-pack-availability"

// Rough per-pack figure for the UI before a download starts; the progress
// callback reports the real byte count once it is underway.
export const OPUS_PACK_APPROX_MB = 90

// Opus-MT repos are named by ISO-639-1 code. Our language ids already use
// those codes, but keep the mapping explicit so a future language whose id
// differs from its Opus code does not silently produce a wrong repo name.
const OPUS_CODE = {
  es: "es", en: "en", pt: "pt", fr: "fr", de: "de", it: "it", ca: "ca",
  nl: "nl", pl: "pl", ru: "ru", uk: "uk", tr: "tr", ar: "ar", hi: "hi",
  zh: "zh", ja: "ja", ko: "ko", vi: "vi", id: "id", gn: "gn",
}

export function opusRepo(fromId, toId) {
  const from = OPUS_CODE[fromId]
  const to = OPUS_CODE[toId]
  if (!from || !to) return null
  return `Xenova/opus-mt-${from}-${to}`
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(AVAILABILITY_KEY) ?? "{}")
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(AVAILABILITY_KEY, JSON.stringify(cache))
  } catch {
    /* storage full or blocked — probing again later is harmless */
  }
}

/**
 * Does this repo exist on the Hub with a usable config?
 *
 * Three-valued on purpose: `true`, `false`, or `null` for "could not tell".
 * Collapsing the last two into `false` would tell an offline user that their
 * language pair does not exist, which is both wrong and unactionable. Only a
 * definite `true` is cached, since a transient failure must not permanently
 * hide a pair that does exist.
 */
export async function isPackAvailable(repo) {
  if (!repo) return false
  const cache = readCache()
  if (cache[repo] === true) return true

  try {
    const response = await fetch(
      `https://huggingface.co/${repo}/resolve/main/config.json`,
      { method: "GET", cache: "force-cache" },
    )
    if (response.ok) {
      cache[repo] = true
      writeCache(cache)
      return true
    }
    // 404 is a real "this pair was never published"; anything else (429, 5xx,
    // a captive portal) is the Hub being unreachable rather than an answer.
    return response.status === 404 ? false : null
  } catch {
    return null
  }
}

/**
 * Work out how to get from one language to another.
 *
 * Returns `{ steps }` where each step is `{ repo, from, to }`, to be run in
 * order — one step for a direct pair, two when pivoting through English — or
 * `{ error }` with "offline" (the Hub could not be reached, so this says
 * nothing about the pair) or "unsupported" (it was reached and the pair is
 * genuinely not published).
 */
export async function resolveRoute(srcId, tgtId) {
  if (srcId === tgtId) return { steps: [] }

  let sawUnknown = false
  const check = async (repo) => {
    const available = await isPackAvailable(repo)
    if (available === null) sawUnknown = true
    return available === true
  }

  const direct = opusRepo(srcId, tgtId)
  if (await check(direct)) {
    return { steps: [{ repo: direct, from: srcId, to: tgtId }] }
  }

  // English is the hub of the Opus-MT collection: pairs that do not exist
  // directly almost always exist as xx→en and en→yy.
  if (srcId !== "en" && tgtId !== "en") {
    const toEnglish = opusRepo(srcId, "en")
    const fromEnglish = opusRepo("en", tgtId)
    const [a, b] = await Promise.all([check(toEnglish), check(fromEnglish)])
    if (a && b) {
      return {
        steps: [
          { repo: toEnglish, from: srcId, to: "en" },
          { repo: fromEnglish, from: "en", to: tgtId },
        ],
        pivot: true,
      }
    }
  }

  return { error: sawUnknown || !navigator.onLine ? "offline" : "unsupported" }
}

/** Human-readable description of a route, for the download prompt. */
export function describeRoute(route, srcId, tgtId) {
  if (!route || route.error) {
    return `No hay modelo disponible para ${getLanguage(srcId).label} → ${getLanguage(tgtId).label}.`
  }
  if (route.pivot) {
    return `${getLanguage(srcId).label} → English → ${getLanguage(tgtId).label} (2 paquetes)`
  }
  return `${getLanguage(srcId).label} → ${getLanguage(tgtId).label} (1 paquete)`
}
