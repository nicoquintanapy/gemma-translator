import { useEffect, useState } from "react"
import { formatBytes, getStorageEstimate } from "../lib/storage.js"
import {
  STT_MODELS,
  TRANSLATION_ENGINES,
  TRANSLATION_MODEL,
} from "../lib/engineConfig.js"
import { OPUS_PACK_APPROX_MB } from "../lib/translationPacks.js"
import { getLanguage } from "../lib/languages.js"
import { isIos, isMobileDevice } from "../lib/device.js"

// First-run screen. The download is explicit and its cost is stated up front —
// several hundred megabytes should never start behind the user's back.

export default function ModelGate({
  status,
  progress,
  error,
  notices,
  sttSize,
  enableVoice,
  onToggleVoice,
  translationEngine,
  onChangeEngine,
  srcLang,
  tgtLang,
  cachedBytes,
  onStart,
  onRetry,
}) {
  const stt = STT_MODELS[sttSize] ?? STT_MODELS.base
  const light = translationEngine === "opus"
  const translationMb = light ? OPUS_PACK_APPROX_MB : TRANSLATION_MODEL.approxMb
  const estimateMb = translationMb + (enableVoice ? stt.approxMb : 0)

  // Warn about a doomed download before the user waits on it, rather than
  // failing with a quota error several hundred megabytes in.
  const [tooLittleSpace, setTooLittleSpace] = useState(false)
  useEffect(() => {
    getStorageEstimate().then((estimate) => {
      if (!estimate?.quota) return
      const free = estimate.quota - estimate.usage
      setTooLittleSpace(free < estimateMb * 1024 * 1024 * 1.2)
    })
  }, [estimateMb])

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : 0

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-title">Traductor offline</h1>
        <p className="gate-lede">
          Los modelos se descargan una sola vez y quedan guardados en este
          navegador. Después funciona sin conexión: nada de lo que digas o
          escribas sale de tu dispositivo.
        </p>

        <ul className="gate-models">
          <li>
            <span className="gate-model-name">
              {light ? "Opus-MT" : TRANSLATION_MODEL.label}
            </span>
            <span className="gate-model-role">
              {light
                ? `Traducción · ${getLanguage(srcLang).label} → ${getLanguage(tgtLang).label}`
                : "Traducción · 200 idiomas"}
            </span>
            <span className="gate-model-size">~{translationMb} MB</span>
          </li>
          <li className={enableVoice ? "" : "gate-model-off"}>
            <span className="gate-model-name">
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={enableVoice}
                  disabled={status === "loading"}
                  onChange={(event) => onToggleVoice(event.target.checked)}
                />
                <span>{stt.label}</span>
              </label>
            </span>
            <span className="gate-model-role">
              Reconocimiento de voz{enableVoice ? "" : " — desactivado"}
            </span>
            <span className="gate-model-size">
              {enableVoice ? `~${stt.approxMb} MB` : "0 MB"}
            </span>
          </li>
          <li className="gate-model-free">
            <span className="gate-model-name">Voces del sistema</span>
            <span className="gate-model-role">Lectura en voz alta</span>
            <span className="gate-model-size">0 MB</span>
          </li>
        </ul>

        {status === "loading" && (
          <div className="gate-progress" role="status" aria-live="polite">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="gate-progress-text">
              {progress.total > 0
                ? `${pct}% · ${formatBytes(progress.loaded)} de ${formatBytes(progress.total)}`
                : "Contactando con el repositorio de modelos…"}
            </p>
            <p className="gate-hint">
              {isMobileDevice()
                ? "Mantén esta pestaña en primer plano y la pantalla encendida. Si sales de la app, el sistema puede descartar la pestaña y cortar la descarga; al reintentar continúa desde donde quedó."
                : "Puedes dejar la pestaña abierta en segundo plano. Si se interrumpe, al reintentar continúa desde donde quedó."}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="gate-error" role="alert">
            <strong>No se pudo cargar el motor.</strong>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={onRetry}>
              Reintentar
            </button>
          </div>
        )}

        {status === "idle" && (
          <>
            <label className="field gate-engine">
              <span>Motor de traducción</span>
              <select
                value={translationEngine}
                onChange={(event) => onChangeEngine(event.target.value)}
              >
                {Object.entries(TRANSLATION_ENGINES).map(([value, engine]) => (
                  <option key={value} value={value}>
                    {engine.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="gate-hint">
              {TRANSLATION_ENGINES[translationEngine]?.detail}
            </p>

            <button className="btn btn-primary btn-lg" onClick={onStart}>
              {cachedBytes > 0
                ? `Cargar modelos (${formatBytes(cachedBytes)} ya en caché)`
                : `Descargar modelos (~${estimateMb} MB)`}
            </button>
            <p className="gate-hint">
              Necesitas conexión solo para esta descarga inicial.
            </p>
            {isMobileDevice() && (
              <p className="gate-hint note-warn">
                {isIos()
                  ? "En iPhone y iPad todos los navegadores usan WebKit, que limita bastante la memoria de una pestaña. Con la voz activada esto ronda el límite y el sistema puede cerrar la pestaña a mitad de la descarga — que es justo lo que se ve como «se cortó la conexión». Empieza solo con traducción de texto y añade la voz después."
                  : "En móvil el sistema puede cerrar la pestaña si necesita memoria. Si la descarga se corta, desactiva la voz y vuelve a intentarlo."}
              </p>
            )}
            {tooLittleSpace && (
              <p className="gate-hint note-warn">
                Este navegador informa de poco espacio disponible para
                almacenamiento web. La descarga puede fallar a mitad; libera
                espacio o elige el modelo de voz «tiny» en Ajustes.
              </p>
            )}
          </>
        )}

        {notices.length > 0 && (
          <ul className="gate-notices">
            {notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
