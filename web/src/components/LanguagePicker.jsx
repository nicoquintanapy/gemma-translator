import { LANGUAGES } from "../lib/languages.js"

export default function LanguagePicker({ id, value, onChange, label }) {
  return (
    <label className="lang-picker">
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.id} value={language.id}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  )
}
