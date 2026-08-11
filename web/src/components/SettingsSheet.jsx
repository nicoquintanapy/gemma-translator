import { useEffect, useState } from "react"
import { DEVICE_PREFERENCES, STT_MODELS } from "../lib/engineConfig.js"
import { clearModelCache, formatBytes, getStorageEstimate } from "../lib/storage.js"
import { LANGUAGES } from "../lib/languages.js"
import { isSpeechSupported, listMissingVoices } from "../lib/tts.js"

export default function SettingsSheet({
  open,
  onClose,
  settings,
  onChange,
  runtime,
  persisted,
  onReload,
}) {
  const [estimate, setEstimate] = useState(null)
  const [voices, setVoices] = useState({ missing: [], total: 0 })

  useEffect(() => {
    if (!open) return
    getStorageEstimate().then(setEstimate)
    setVoices(listMissingVoices(LANGUAGES))
  }, [open])

  if (!open) return null

  const handleClear = async () => {
    const confirmed = window.confirm(
      "Esto borra los modelos descargados de este navegador. Tendrás que volver a descargarlos (con conexión). ¿Continuar?",
    )
    if (!confirmed) return
    await clearModelCache()
    await onReload()
  }

  // Changing device or model size requires rebuilding the pipelines, so these
  // controls are pending until the user reloads the engine.
  const restartNeeded =
    runtime.translate && settings.device !== runtime.translate.device

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside
        className="sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Ajustes"
      >
        <header className="sheet-header">
          <h2>Ajustes</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <section className="sheet-section">
          <h3>Reproducción</h3>
          <label className="row-toggle">
            <input
              type="checkbox"
              checked={settings.autoSpeak}
              onChange={(event) => onChange({ autoSpeak: event.target.checked })}
            />
            <span>Leer la traducción en voz alta automáticamente</span>
          </label>
          {!isSpeechSupported() && (
            <p className="note note-warn">
              Este navegador no expone síntesis de voz; la salida será solo texto.
            </p>
          )}
          {isSpeechSupported() && voices.missing.length > 0 && (
            <p className="note">
              {voices.missing.length === voices.total
                ? "Este dispositivo no tiene ninguna voz del sistema instalada, así que la salida será solo texto."
                : `Sin voz del sistema para ${voices.missing.slice(0, 5).join(", ")}${
                    voices.missing.length > 5
                      ? ` y ${voices.missing.length - 5} idioma(s) más`
                      : ""
                  }. La traducción escrita funciona igual.`}
            </p>
          )}
        </section>

        <section className="sheet-section">
          <h3>Rendimiento</h3>
          <label className="field">
            <span>Acelerador</span>
            <select
              value={settings.device}
              onChange={(event) => onChange({ device: event.target.value })}
            >
              {Object.entries(DEVICE_PREFERENCES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="note">
            Los pesos son int8, que la CPU ejecuta de forma nativa. WebGPU puede
            no soportar esos kernels en todos los navegadores: si falla, se
            vuelve a CPU automáticamente.
          </p>

          <label className="field">
            <span>Modelo de voz</span>
            <select
              value={settings.sttSize}
              onChange={(event) => onChange({ sttSize: event.target.value })}
            >
              {Object.entries(STT_MODELS).map(([value, model]) => (
                <option key={value} value={value}>
                  {model.label} (~{model.approxMb} MB)
                </option>
              ))}
            </select>
          </label>
          <p className="note">{STT_MODELS[settings.sttSize]?.note}</p>

          {restartNeeded && (
            <button className="btn btn-primary" onClick={onReload}>
              Aplicar y recargar el motor
            </button>
          )}
        </section>

        <section className="sheet-section">
          <h3>Almacenamiento</h3>
          <dl className="kv">
            <div>
              <dt>En uso</dt>
              <dd>{estimate ? formatBytes(estimate.usage) : "—"}</dd>
            </div>
            <div>
              <dt>Disponible</dt>
              <dd>{estimate ? formatBytes(estimate.quota) : "—"}</dd>
            </div>
            <div>
              <dt>Persistente</dt>
              <dd>{persisted ? "Sí" : "No garantizado"}</dd>
            </div>
          </dl>
          {!persisted && (
            <p className="note note-warn">
              El navegador no ha concedido almacenamiento persistente, así que
              podría descartar los modelos si se queda sin espacio. Instalar la
              app (menú del navegador → «Instalar») suele bastar para
              conseguirlo.
            </p>
          )}
          <button className="btn btn-danger" onClick={handleClear}>
            Borrar modelos descargados
          </button>
        </section>

        <section className="sheet-section">
          <h3>Motor activo</h3>
          <dl className="kv">
            <div>
              <dt>Traducción</dt>
              <dd>{runtime.translate?.device ?? "—"}</dd>
            </div>
            <div>
              <dt>Voz</dt>
              <dd>{runtime.stt?.device ?? "—"}</dd>
            </div>
            <div>
              <dt>Hilos WASM</dt>
              <dd>{globalThis.crossOriginIsolated ? "múltiples" : "1 (sin aislamiento)"}</dd>
            </div>
          </dl>
          {!globalThis.crossOriginIsolated && (
            <p className="note">
              El servidor no envía las cabeceras COOP/COEP, así que la inferencia
              corre en un solo hilo. Ver el README para configurarlas.
            </p>
          )}
        </section>
      </aside>
    </div>
  )
}
