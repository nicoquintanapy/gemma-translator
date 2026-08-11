// The language table that ties the three engines together.
//
// Each engine speaks a different dialect of "language code":
//   - NLLB-200 wants FLORES-200 tags   ("spa_Latn")
//   - Whisper wants English names      ("spanish")
//   - speechSynthesis wants BCP-47     ("es-ES")
//
// Keeping the mapping in one place means a language is either fully wired or
// visibly marked as partial, never silently broken.

export const LANGUAGES = [
  { id: "es", label: "Español",    flores: "spa_Latn", whisper: "spanish",    bcp47: "es-ES" },
  { id: "en", label: "English",    flores: "eng_Latn", whisper: "english",    bcp47: "en-US" },
  { id: "pt", label: "Português",  flores: "por_Latn", whisper: "portuguese", bcp47: "pt-BR" },
  { id: "gn", label: "Guaraní",    flores: "grn_Latn", whisper: null,         bcp47: null    },
  { id: "fr", label: "Français",   flores: "fra_Latn", whisper: "french",     bcp47: "fr-FR" },
  { id: "de", label: "Deutsch",    flores: "deu_Latn", whisper: "german",     bcp47: "de-DE" },
  { id: "it", label: "Italiano",   flores: "ita_Latn", whisper: "italian",    bcp47: "it-IT" },
  { id: "ca", label: "Català",     flores: "cat_Latn", whisper: "catalan",    bcp47: "ca-ES" },
  { id: "nl", label: "Nederlands", flores: "nld_Latn", whisper: "dutch",      bcp47: "nl-NL" },
  { id: "pl", label: "Polski",     flores: "pol_Latn", whisper: "polish",     bcp47: "pl-PL" },
  { id: "ru", label: "Русский",    flores: "rus_Cyrl", whisper: "russian",    bcp47: "ru-RU" },
  { id: "uk", label: "Українська", flores: "ukr_Cyrl", whisper: "ukrainian",  bcp47: "uk-UA" },
  { id: "tr", label: "Türkçe",     flores: "tur_Latn", whisper: "turkish",    bcp47: "tr-TR" },
  { id: "ar", label: "العربية",     flores: "arb_Arab", whisper: "arabic",     bcp47: "ar-SA" },
  { id: "hi", label: "हिन्दी",       flores: "hin_Deva", whisper: "hindi",      bcp47: "hi-IN" },
  { id: "zh", label: "中文",        flores: "zho_Hans", whisper: "chinese",    bcp47: "zh-CN" },
  { id: "ja", label: "日本語",      flores: "jpn_Jpan", whisper: "japanese",   bcp47: "ja-JP" },
  { id: "ko", label: "한국어",      flores: "kor_Hang", whisper: "korean",     bcp47: "ko-KR" },
  { id: "vi", label: "Tiếng Việt", flores: "vie_Latn", whisper: "vietnamese", bcp47: "vi-VN" },
  { id: "id", label: "Indonesia",  flores: "ind_Latn", whisper: "indonesian", bcp47: "id-ID" },
]

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]))

export function getLanguage(id) {
  return BY_ID.get(id) ?? BY_ID.get("en")
}

// Languages Whisper cannot transcribe are still translatable by typing.
export function canTranscribe(id) {
  return Boolean(getLanguage(id).whisper)
}

// Right-to-left scripts need `dir="rtl"` on the panels that show them.
const RTL = new Set(["ar"])

export function isRtl(id) {
  return RTL.has(id)
}
