// Text-to-speech via the Web Speech API.
//
// Deliberate trade-off: a neural TTS model (Kokoro, Piper) would be another
// 80-300 MB download and covers far fewer languages than the twenty this app
// translates. `speechSynthesis` uses voices already installed in the operating
// system — zero bytes, no network, and broad language coverage — at the cost of
// depending on what the user's OS happens to ship. `listMissingVoices()` makes
// that dependency visible instead of failing silently.

let cachedVoices = []

function refreshVoices() {
  if (typeof speechSynthesis === "undefined") return []
  cachedVoices = speechSynthesis.getVoices() ?? []
  return cachedVoices
}

// Voices load asynchronously in most browsers; the event fires once ready.
if (typeof speechSynthesis !== "undefined") {
  refreshVoices()
  speechSynthesis.addEventListener?.("voiceschanged", refreshVoices)
}

export function isSpeechSupported() {
  return typeof speechSynthesis !== "undefined"
}

/** Best voice for a BCP-47 tag: exact match first, then same base language. */
export function findVoice(bcp47) {
  if (!bcp47) return null
  const voices = cachedVoices.length ? cachedVoices : refreshVoices()
  const wanted = bcp47.toLowerCase()
  const base = wanted.split("-")[0]
  return (
    voices.find((v) => v.lang?.toLowerCase() === wanted) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith(`${base}-`)) ??
    voices.find((v) => v.lang?.toLowerCase() === base) ??
    null
  )
}

/**
 * Languages the app can translate into but this device cannot pronounce.
 *
 * Returns `{ missing, total }` so the caller can distinguish "a few gaps" from
 * "this device has no speech voices at all" — listing twenty language names is
 * noise, whereas one sentence is actionable.
 */
export function listMissingVoices(languages) {
  const speakable = languages.filter((language) => language.bcp47)
  const missing = isSpeechSupported()
    ? speakable.filter((language) => !findVoice(language.bcp47))
    : speakable
  return { missing: missing.map((language) => language.label), total: speakable.length }
}

export function stopSpeaking() {
  if (isSpeechSupported()) speechSynthesis.cancel()
}

export function speak(text, bcp47) {
  return new Promise((resolve, reject) => {
    if (!isSpeechSupported()) {
      reject(new Error("Este navegador no soporta síntesis de voz"))
      return
    }
    if (!text?.trim()) {
      resolve()
      return
    }
    stopSpeaking()

    const utterance = new SpeechSynthesisUtterance(text)
    const voice = findVoice(bcp47)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else if (bcp47) {
      utterance.lang = bcp47
    }
    utterance.rate = 1
    utterance.onend = () => resolve()
    utterance.onerror = (event) =>
      // Cancelling mid-sentence is a normal user action, not a failure.
      event.error === "canceled" || event.error === "interrupted"
        ? resolve()
        : reject(new Error(event.error || "Fallo al reproducir la voz"))

    speechSynthesis.speak(utterance)
  })
}
