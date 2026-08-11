import { useEffect, useState } from "react"
import {
  DEVICE_PREFERENCES,
  STT_MODELS,
  TRANSLATION_ENGINES,
} from "../lib/engineConfig.js"
import {
  clearModelCache,
  formatBytes,
  getPartialDownloadBytes,
  getStorageEstimate,
} from "../lib/storage.js"
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
  const [partialBytes, setPartialBytes] = useState(0)

  useEffect(() => {
    if (!open) return
    getStorageEstimate().then(setEstimate)
    getPartialDownloadBytes().then(setPartialBytes)
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

  // Changing the device, the speech model, or whether speech is loaded at all
  // requires rebuilding the pipelines, so those controls stay pending until the
  // user reloads the engine.
  const restartNeeded =
    Boolean(runtime.translate) &&
    (settings.device !== runtime.translate.device ||
      settings.enableVoice !== Boolean(runtime.stt) ||
      settings.translationEngine !== runtime.translate.engine)

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
          <h3>Motor de traducción</h3>
          <label className="field">
            <span>Estrategia</span>
            <select
              value={settings.translationEngine}
              onChange={(event) =>
                onChange({ translationEngine: event.target.value })
              }
            >
              {Object.entries(TRANSLATION_ENGINES).map(([value, engine]) => (
                <option key={value} value={value}>
                  {engine.label}
                </option>
              ))}
            </select>
          </label>
          <p className="note">
            {TRANSLATION_ENGINES[settings.translationEngine]?.detail}
          </p>
          {settings.translationEngine === "opus" && (
            <p className="note">
              Elegir un par nuevo pide confirmación antes de descargar nada. Los
              pares que no existan directos se resuelven pivotando por inglés.
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

          <label className="row-toggle">
            <input
              type="checkbox"
              checked={settings.enableVoice}
              onChange={(event) => onChange({ enableVoice: event.target.checked })}
            />
            <span>Reconocimiento de voz (entrada por micrófono)</span>
          </label>
          <p className="note">
            Desactivarlo ahorra la descarga del modelo de voz y reduce
            bastante la memoria que usa la pestaña. En móviles es la diferencia
            entre que funcione y que el sistema cierre la pestaña.
          </p>

          <label className="field">
            <span>Modelo de voz</span>
            <select
              value={settings.sttSize}
              disabled={!settings.enableVoice}
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
            {partialBytes > 0 && (
              <div>
                <dt>Descarga a medias</dt>
                <dd>{formatBytes(partialBytes)}</dd>
              </div>
            )}
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
              <dd>{runtime.stt?.device ?? "no cargada"}</dd>
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
