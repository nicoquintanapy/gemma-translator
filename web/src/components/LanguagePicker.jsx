import { LANGUAGES } from "../lib/languages.js"
import { availableLanguages } from "../lib/models.js"

export default function LanguagePicker({ id, value, onChange, label, available }) {
  // Only offer languages the deployed registry actually has models for; the
  // bundled set is a build-time decision, not something the UI should guess at.
  const usable = available ? availableLanguages(available) : null
  const options = usable ? LANGUAGES.filter((l) => usable.has(l.id)) : LANGUAGES

  return (
    <label className="lang-picker">
      <span className="sr-only">{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((language) => (
          <option key={language.id} value={language.id}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  )
}
