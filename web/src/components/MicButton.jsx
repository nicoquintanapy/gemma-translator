// Records while held (pointer or Space) and also works as a plain toggle on
// touch, where press-and-hold conflicts with the OS text-selection gesture.

export default function MicButton({ isRecording, level, disabled, title, onToggle }) {
  // The ring tracks input level so the user can tell the mic is live before
  // committing to a long sentence.
  const scale = 1 + Math.min(level, 1) * 0.6

  return (
    <button
      type="button"
      className={`mic-btn ${isRecording ? "is-recording" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      title={title}
      aria-pressed={isRecording}
      aria-label={isRecording ? "Detener grabación" : "Grabar voz"}
    >
      {isRecording && (
        <span className="mic-ring" style={{ transform: `scale(${scale})` }} />
      )}
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"
        />
        <path
          fill="currentColor"
          d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11Z"
        />
      </svg>
    </button>
  )
}
