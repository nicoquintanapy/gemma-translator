export default function StatusBar({ online, runtime, timing, error }) {
  return (
    <footer className="statusbar">
      <span className={`pill ${online ? "pill-online" : "pill-offline"}`}>
        {online ? "En línea" : "Sin conexión"}
      </span>
      <span className="status-item">
        Motor: <strong>{runtime.translate?.device ?? "—"}</strong>
      </span>
      {timing.translate != null && (
        <span className="status-item">
          Traducción: <strong>{timing.translate} ms</strong>
        </span>
      )}
      {timing.stt != null && (
        <span className="status-item">
          Voz: <strong>{timing.stt} ms</strong>
        </span>
      )}
      {error && <span className="status-error">{error}</span>}
    </footer>
  )
}
