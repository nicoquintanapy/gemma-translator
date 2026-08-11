import { useEffect, useState } from "react"
import { cachedBytes, clearModels } from "../lib/models.js"
import { formatBytes, getStorageEstimate } from "../lib/storage.js"
import { LANGUAGES } from "../lib/languages.js"
import { isSpeechSupported, listMissingVoices } from "../lib/tts.js"

export default function SettingsSheet({ open, onClose, settings, onChange, persisted, onModelsCleared }) {
  const [estimate, setEstimate] = useState(null)
  const [models, setModels] = useState(0)
  const [voices, setVoices] = useState({ missing: [], total: 0 })

  useEffect(() => {
    if (!open) return
    getStorageEstimate().then(setEstimate)
    cachedBytes().then(setModels)
    setVoices(listMissingVoices(LANGUAGES))
  }, [open])

  if (!open) return null

  const handleClear = async () => {
    const confirmed = window.confirm(
      "Esto borra los modelos guardados en este navegador. Necesitarás conexión para volver a descargarlos. ¿Continuar?",
    )
    if (!confirmed) return
    await clearModels()
    setModels(0)
    await onModelsCleared?.()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajustes">
        <header className="sheet-header">
          <h2>Ajustes</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <section className="sheet-section">
          <h3>Lectura en voz alta</h3>
          <label className="row-toggle">
            <input
              type="checkbox"
              checked={settings.autoSpeak}
              onChange={(event) => onChange({ autoSpeak: event.target.checked })}
            />
            <span>Leer la traducción automáticamente</span>
          </label>
          <p className="note">
            Usa las voces del sistema operativo, no un modelo descargado: cero
            bytes, pero depende de las que tengas instaladas.
          </p>
          {!isSpeechSupported() ? (
            <p className="note note-warn">Este navegador no expone síntesis de voz.</p>
          ) : (
            voices.missing.length > 0 && (
              <p className="note">
                {voices.missing.length === voices.total
                  ? "Este dispositivo no tiene ninguna voz instalada, así que la salida será solo texto."
                  : `Sin voz para ${voices.missing.slice(0, 5).join(", ")}${
                      voices.missing.length > 5 ? ` y ${voices.missing.length - 5} más` : ""
                    }.`}
              </p>
            )
          )}
        </section>

        <section className="sheet-section">
          <h3>Almacenamiento</h3>
          <dl className="kv">
            <div>
              <dt>Modelos guardados</dt>
              <dd>{formatBytes(models)}</dd>
            </div>
            <div>
              <dt>Total del sitio</dt>
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
              app (menú del navegador → «Instalar») suele bastar.
            </p>
          )}
          <button className="btn btn-danger" onClick={handleClear}>
            Borrar modelos descargados
          </button>
        </section>

        <section className="sheet-section">
          <h3>Cómo funciona</h3>
          <p className="note">
            La traducción corre entera en esta pestaña con Bergamot, el motor
            que Firefox usa para traducir páginas. Los modelos se descargan una
            vez desde este mismo sitio y quedan en la caché del navegador: nada
            de lo que escribas sale de tu dispositivo, ni siquiera con conexión.
          </p>
        </section>
      </aside>
    </div>
  )
}
