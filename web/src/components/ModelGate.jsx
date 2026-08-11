import { formatBytes } from "../lib/storage.js"
import { getLanguage } from "../lib/languages.js"

// Shown in the output pane until the selected pair's models are local.
// Downloading is always an explicit choice: the whole point of per-pair models
// is that you only pay for the languages you actually use.

export default function ModelGate({ status, progress, error, srcLang, tgtLang, bytes, pivot, onDownload }) {
  const src = getLanguage(srcLang).label
  const tgt = getLanguage(tgtLang).label

  if (status === "loading") {
    return <p className="gate-inline">Comprobando modelos…</p>
  }

  if (status === "unsupported") {
    return (
      <div className="gate-inline gate-inline-warn">
        <strong>{src} → {tgt} no está disponible</strong>
        <p>
          Esta versión no incluye modelos para esa combinación, ni directa ni
          pasando por inglés. Elige otro par.
        </p>
      </div>
    )
  }

  if (status === "downloading") {
    const pct = progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0
    return (
      <div className="gate-inline" role="status" aria-live="polite">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p>
          Descargando {src} → {tgt} · {pct}% ({formatBytes(progress.loaded)} de{" "}
          {formatBytes(progress.total)})
        </p>
        <p className="gate-hint">
          Mantén esta pestaña abierta y la pantalla encendida. Si se corta, al
          reintentar solo se baja lo que falte.
        </p>
      </div>
    )
  }

  return (
    <div className="gate-inline">
      <strong>
        {src} → {tgt}
      </strong>
      <p>
        {pivot
          ? `Esta combinación pasa por inglés, así que son dos modelos (${formatBytes(bytes)}).`
          : `Un modelo, ${formatBytes(bytes)}. Se guarda y no se vuelve a descargar.`}
      </p>
      <button className="btn btn-primary" onClick={onDownload}>
        Descargar y usar sin conexión
      </button>
      {error && <p className="gate-error-inline">{error}</p>}
    </div>
  )
}
