import { OPUS_PACK_APPROX_MB } from "../lib/translationPacks.js"
import { formatBytes } from "../lib/storage.js"
import { getLanguage } from "../lib/languages.js"

// Shown in place of the translation when the selected language pair has no
// packs downloaded yet. The light engine's whole premise is that you only pay
// for the pairs you use, so this asks rather than helping itself to ~90 MB.

export default function PackPrompt({ state, progress, srcLang, tgtLang, onDownload }) {
  const src = getLanguage(srcLang).label
  const tgt = getLanguage(tgtLang).label

  if (state.status === "checking") {
    return <p className="pack-prompt">Comprobando disponibilidad de {src} → {tgt}…</p>
  }

  if (state.status === "offline") {
    return (
      <div className="pack-prompt pack-prompt-warn">
        <strong>No se pudo comprobar {src} → {tgt}</strong>
        <p>
          Hace falta conexión para saber si este par existe y descargarlo. Los
          pares que ya tengas descargados siguen funcionando sin conexión.
        </p>
        <button className="btn btn-primary" onClick={onDownload}>
          Reintentar
        </button>
      </div>
    )
  }

  if (state.status === "unsupported") {
    return (
      <div className="pack-prompt pack-prompt-warn">
        <strong>{src} → {tgt} no está publicado</strong>
        <p>
          No existe un paquete directo ni una ruta pivotando por inglés para
          esta combinación. Elige otro par, o cambia al motor universal en
          Ajustes, que cubre las 200 combinaciones.
        </p>
      </div>
    )
  }

  if (state.status === "downloading") {
    const pct =
      progress.total > 0
        ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
        : 0
    return (
      <div className="pack-prompt" role="status" aria-live="polite">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p>
          {progress.total > 0
            ? `Descargando ${src} → ${tgt} · ${pct}% (${formatBytes(progress.loaded)} de ${formatBytes(progress.total)})`
            : `Preparando ${src} → ${tgt}…`}
        </p>
      </div>
    )
  }

  if (state.status === "needs-download") {
    const packs = state.pairs || 1
    return (
      <div className="pack-prompt">
        <strong>Falta el paquete de {src} → {tgt}</strong>
        <p>
          {packs > 1
            ? `Esta combinación pivota por inglés, así que son ${packs} paquetes (~${packs * OPUS_PACK_APPROX_MB} MB).`
            : `Un paquete, ~${OPUS_PACK_APPROX_MB} MB. Se guarda y no se vuelve a descargar.`}
        </p>
        <button className="btn btn-primary" onClick={onDownload}>
          Descargar este par
        </button>
      </div>
    )
  }

  return null
}
