// Languages the app offers.
//
// Which pairs actually exist is decided by `public/models/registry.json`, built
// at deploy time from whatever was bundled — this table only supplies the
// display name and the voice tag. A language listed here with no model in the
// registry is reported as unavailable rather than silently offered.

export const LANGUAGES = [
  { id: "es", label: "Español",    bcp47: "es-ES" },
  { id: "en", label: "English",    bcp47: "en-US" },
  { id: "pt", label: "Português",  bcp47: "pt-BR" },
  { id: "fr", label: "Français",   bcp47: "fr-FR" },
  { id: "de", label: "Deutsch",    bcp47: "de-DE" },
  { id: "it", label: "Italiano",   bcp47: "it-IT" },
  { id: "nl", label: "Nederlands", bcp47: "nl-NL" },
  { id: "pl", label: "Polski",     bcp47: "pl-PL" },
  { id: "cs", label: "Čeština",    bcp47: "cs-CZ" },
  { id: "bg", label: "Български",  bcp47: "bg-BG" },
  { id: "et", label: "Eesti",      bcp47: "et-EE" },
  { id: "ru", label: "Русский",    bcp47: "ru-RU" },
  { id: "uk", label: "Українська", bcp47: "uk-UA" },
  { id: "fa", label: "فارسی",       bcp47: "fa-IR" },
  { id: "is", label: "Íslenska",   bcp47: "is-IS" },
  { id: "nb", label: "Norsk bokmål", bcp47: "nb-NO" },
  { id: "nn", label: "Norsk nynorsk", bcp47: "nn-NO" },
]

const BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]))

export function getLanguage(id) {
  return BY_ID.get(id) ?? BY_ID.get("en")
}

// Right-to-left scripts need dir="rtl" on the panel showing them.
const RTL = new Set(["fa"])

export function isRtl(id) {
  return RTL.has(id)
}
