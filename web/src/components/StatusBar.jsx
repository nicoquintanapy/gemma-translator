export default function StatusBar({ online, ready, pivot, timing, error }) {
  return (
    <footer className="statusbar">
      <span className={`pill ${online ? "pill-online" : "pill-offline"}`}>
        {online ? "En línea" : "Sin conexión"}
      </span>
      <span className="status-item">
        Modelos: <strong>{ready ? "listos, en este dispositivo" : "sin descargar"}</strong>
      </span>
      {pivot && <span className="status-item">Vía inglés</span>}
      {timing != null && (
        <span className="status-item">
          Última traducción: <strong>{timing} ms</strong>
        </span>
      )}
      {error && <span className="status-error">{error}</span>}
    </footer>
  )
}
