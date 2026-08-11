import { useCallback, useEffect, useRef, useState } from "react"
import ModelGate from "./components/ModelGate.jsx"
import LanguagePicker from "./components/LanguagePicker.jsx"
import MicButton from "./components/MicButton.jsx"
import SettingsSheet from "./components/SettingsSheet.jsx"
import StatusBar from "./components/StatusBar.jsx"
import { useAudioRecorder } from "./hooks/useAudioRecorder.js"
import { useEngine } from "./hooks/useEngine.js"
import { canTranscribe, getLanguage, isRtl } from "./lib/languages.js"
import { DEFAULT_DEVICE, DEFAULT_STT_SIZE } from "./lib/engineConfig.js"
import { getModelCacheSize, requestPersistentStorage } from "./lib/storage.js"
import { speak, stopSpeaking } from "./lib/tts.js"

const SETTINGS_KEY = "offline-translator-settings"

const DEFAULT_SETTINGS = {
  device: DEFAULT_DEVICE,
  sttSize: DEFAULT_STT_SIZE,
  autoSpeak: true,
  srcLang: "es",
  tgtLang: "en",
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [sourceText, setSourceText] = useState("")
  const [targetText, setTargetText] = useState("")
  const [isTranslating, setIsTranslating] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [timing, setTiming] = useState({ translate: null, stt: null })
  const [runtimeError, setRuntimeError] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [persisted, setPersisted] = useState(false)
  const [cachedBytes, setCachedBytes] = useState(0)

  const engine = useEngine({ device: settings.device, sttSize: settings.sttSize })
  const recorder = useAudioRecorder()

  // A translation in flight blocks the next one; `pendingRef` remembers that
  // the input changed meanwhile so we re-run once at the end instead of
  // queueing one job per keystroke.
  const translatingRef = useRef(false)
  const pendingRef = useRef(false)
  const textareaRef = useRef(null)
  // Key of the last completed translation, so the debounced auto-run does not
  // repeat work already triggered explicitly (e.g. right after a voice input).
  const lastKeyRef = useRef("")

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {})
    getModelCacheSize().then(setCachedBytes)
  }, [engine.status])

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const runTranslation = useCallback(
    async (text, { speakResult, force = false } = {}) => {
      const source = text.trim()
      if (!source || engine.status !== "ready") {
        if (!source) setTargetText("")
        return
      }

      const key = `${settings.srcLang}|${settings.tgtLang}|${source}`
      if (!force && key === lastKeyRef.current) return

      if (translatingRef.current) {
        pendingRef.current = true
        return
      }

      translatingRef.current = true
      setIsTranslating(true)
      setRuntimeError(null)
      setTargetText("")

      try {
        const result = await engine.translate({
          text: source,
          srcLang: getLanguage(settings.srcLang).flores,
          tgtLang: getLanguage(settings.tgtLang).flores,
          onPartial: (chunk) => setTargetText((prev) => prev + chunk),
        })
        setTargetText(result.text)
        setTiming((prev) => ({ ...prev, translate: result.ms }))
        lastKeyRef.current = key

        if (speakResult ?? settings.autoSpeak) {
          speak(result.text, getLanguage(settings.tgtLang).bcp47).catch((err) =>
            setRuntimeError(err.message),
          )
        }
      } catch (err) {
        setRuntimeError(err?.message ?? String(err))
      } finally {
        translatingRef.current = false
        setIsTranslating(false)
        if (pendingRef.current) {
          pendingRef.current = false
          // Re-read the latest text from the DOM-backed state on the next tick.
          setTimeout(() => runTranslation(textareaRef.current?.value ?? ""), 0)
        }
      }
    },
    [engine, settings.srcLang, settings.tgtLang, settings.autoSpeak],
  )

  const translateNow = useCallback(
    (text) => runTranslation(text, { speakResult: settings.autoSpeak, force: true }),
    [runTranslation, settings.autoSpeak],
  )

  // Auto-translate shortly after typing stops, so the common case needs no
  // button press; the explicit button stays for keyboard-free confirmation.
  useEffect(() => {
    if (engine.status !== "ready" || !sourceText.trim()) return
    const timer = setTimeout(() => runTranslation(sourceText, { speakResult: false }), 800)
    return () => clearTimeout(timer)
  }, [sourceText, engine.status, runTranslation])

  const handleMic = useCallback(async () => {
    if (engine.status !== "ready") return

    if (recorder.isRecording) {
      const audio = await recorder.stop()
      if (!audio) return
      setIsTranscribing(true)
      setRuntimeError(null)
      try {
        const result = await engine.transcribe({
          audio,
          language: getLanguage(settings.srcLang).whisper,
        })
        setIsTranscribing(false)
        if (!result.text) {
          setRuntimeError("No se detectó voz en la grabación.")
          return
        }
        setTiming((prev) => ({ ...prev, stt: result.ms }))
        setSourceText(result.text)
        await runTranslation(result.text, {
          speakResult: settings.autoSpeak,
          force: true,
        })
      } catch (err) {
        setIsTranscribing(false)
        setRuntimeError(err?.message ?? String(err))
      }
      return
    }

    stopSpeaking()
    await recorder.start()
  }, [engine, recorder, settings.srcLang, settings.autoSpeak, runTranslation])

  const swapLanguages = useCallback(() => {
    setSettings((prev) => ({ ...prev, srcLang: prev.tgtLang, tgtLang: prev.srcLang }))
    setSourceText(targetText)
    setTargetText(sourceText)
  }, [sourceText, targetText])

  // Space is push-to-talk, but only when the user is not typing.
  useEffect(() => {
    const isEditing = (target) =>
      target instanceof HTMLElement &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)

    const onKeyDown = (event) => {
      if (event.code === "Space" && !isEditing(event.target) && !event.repeat) {
        event.preventDefault()
        handleMic()
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        translateNow(sourceText)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleMic, translateNow, sourceText])

  const reloadEngine = useCallback(async () => {
    stopSpeaking()
    await engine.reset()
    setSettingsOpen(false)
    await engine.load()
  }, [engine])

  const startEngine = useCallback(async () => {
    await requestPersistentStorage()
    await engine.load()
    setPersisted((await navigator.storage?.persisted?.()) ?? false)
  }, [engine])

  if (engine.status !== "ready") {
    return (
      <ModelGate
        status={engine.status}
        progress={engine.progress}
        error={engine.error}
        notices={engine.notices}
        sttSize={settings.sttSize}
        cachedBytes={cachedBytes}
        onStart={startEngine}
        onRetry={startEngine}
      />
    )
  }

  const sourceLang = getLanguage(settings.srcLang)
  const targetLang = getLanguage(settings.tgtLang)
  const micDisabled = isTranscribing || isTranslating || !canTranscribe(settings.srcLang)

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Traductor offline</h1>
        <button
          className="btn btn-ghost"
          onClick={() => setSettingsOpen(true)}
          aria-label="Ajustes"
        >
          Ajustes
        </button>
      </header>

      <main className="panes">
        <section className="pane">
          <div className="pane-head">
            <LanguagePicker
              id="src-lang"
              label="Idioma de origen"
              value={settings.srcLang}
              onChange={(value) => updateSettings({ srcLang: value })}
            />
            <MicButton
              isRecording={recorder.isRecording}
              level={recorder.level}
              disabled={micDisabled}
              title={
                canTranscribe(settings.srcLang)
                  ? "Grabar (barra espaciadora)"
                  : `El reconocimiento de voz no cubre ${sourceLang.label}; escribe el texto`
              }
              onToggle={handleMic}
            />
          </div>
          <textarea
            ref={textareaRef}
            className="pane-text"
            dir={isRtl(settings.srcLang) ? "rtl" : "ltr"}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder={
              recorder.isRecording
                ? "Escuchando…"
                : `Escribe o habla en ${sourceLang.label}`
            }
            aria-label={`Texto en ${sourceLang.label}`}
          />
          <div className="pane-foot">
            {isTranscribing && <span className="chip chip-busy">Transcribiendo…</span>}
            {recorder.error && <span className="chip chip-error">{recorder.error}</span>}
            <button
              className="btn btn-primary"
              onClick={() => translateNow(sourceText)}
              disabled={!sourceText.trim() || isTranslating}
            >
              {isTranslating ? "Traduciendo…" : "Traducir"}
            </button>
          </div>
        </section>

        <button className="swap-btn" onClick={swapLanguages} aria-label="Intercambiar idiomas">
          ⇄
        </button>

        <section className="pane pane-output">
          <div className="pane-head">
            <LanguagePicker
              id="tgt-lang"
              label="Idioma de destino"
              value={settings.tgtLang}
              onChange={(value) => updateSettings({ tgtLang: value })}
            />
            <div className="pane-actions">
              <button
                className="btn btn-ghost"
                onClick={() => speak(targetText, targetLang.bcp47).catch((err) => setRuntimeError(err.message))}
                disabled={!targetText}
                aria-label="Escuchar traducción"
              >
                ▶ Escuchar
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => navigator.clipboard?.writeText(targetText)}
                disabled={!targetText}
              >
                Copiar
              </button>
            </div>
          </div>
          <div
            className="pane-text pane-readonly"
            dir={isRtl(settings.tgtLang) ? "rtl" : "ltr"}
            aria-live="polite"
          >
            {targetText || <span className="placeholder">La traducción aparecerá aquí</span>}
          </div>
        </section>
      </main>

      <StatusBar
        online={online}
        runtime={engine.runtime}
        timing={timing}
        error={runtimeError}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        runtime={engine.runtime}
        persisted={persisted}
        onReload={reloadEngine}
      />
    </div>
  )
}
