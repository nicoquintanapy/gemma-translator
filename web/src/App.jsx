import { useCallback, useEffect, useRef, useState } from "react"
import ModelGate from "./components/ModelGate.jsx"
import LanguagePicker from "./components/LanguagePicker.jsx"
import SettingsSheet from "./components/SettingsSheet.jsx"
import StatusBar from "./components/StatusBar.jsx"
import { useTranslator } from "./hooks/useTranslator.js"
import { getLanguage, isRtl } from "./lib/languages.js"
import { requestPersistentStorage } from "./lib/storage.js"
import { speak, stopSpeaking } from "./lib/tts.js"

const SETTINGS_KEY = "offline-translator-settings"

const DEFAULT_SETTINGS = {
  srcLang: "es",
  tgtLang: "en",
  autoSpeak: false,
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
  const [timing, setTiming] = useState(null)
  const [runtimeError, setRuntimeError] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [persisted, setPersisted] = useState(false)

  const engine = useTranslator({ srcLang: settings.srcLang, tgtLang: settings.tgtLang })

  // A translation in flight blocks the next; `pendingRef` remembers the input
  // changed meanwhile so we re-run once at the end, not once per keystroke.
  const translatingRef = useRef(false)
  const pendingRef = useRef(false)
  const textareaRef = useRef(null)
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
  }, [engine.status])

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const ready = engine.status === "ready"

  const runTranslation = useCallback(
    async (text, { speakResult, force = false } = {}) => {
      const source = text.trim()
      if (!source || !ready) {
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

      try {
        const result = await engine.translate(source)
        setTargetText(result.text)
        setTiming(result.ms)
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
          setTimeout(() => runTranslation(textareaRef.current?.value ?? ""), 0)
        }
      }
    },
    [engine, ready, settings.srcLang, settings.tgtLang, settings.autoSpeak],
  )

  const translateNow = useCallback(
    (text) => runTranslation(text, { speakResult: settings.autoSpeak, force: true }),
    [runTranslation, settings.autoSpeak],
  )

  // Translate shortly after typing stops, so the common case needs no button.
  useEffect(() => {
    if (!ready || !sourceText.trim()) return
    const timer = setTimeout(() => runTranslation(sourceText, { speakResult: false }), 500)
    return () => clearTimeout(timer)
  }, [sourceText, ready, runTranslation])

  // Switching pair invalidates the shown translation.
  useEffect(() => {
    setTargetText("")
    lastKeyRef.current = ""
  }, [settings.srcLang, settings.tgtLang])

  const swapLanguages = useCallback(() => {
    stopSpeaking()
    setSettings((prev) => ({ ...prev, srcLang: prev.tgtLang, tgtLang: prev.srcLang }))
    setSourceText(targetText)
  }, [targetText])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        translateNow(sourceText)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [translateNow, sourceText])

  const startDownload = useCallback(async () => {
    await requestPersistentStorage()
    await engine.download()
    setPersisted((await navigator.storage?.persisted?.()) ?? false)
  }, [engine])

  const sourceLang = getLanguage(settings.srcLang)
  const targetLang = getLanguage(settings.tgtLang)

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Traductor offline</h1>
        <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
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
              available={engine.registry}
              onChange={(value) => updateSettings({ srcLang: value })}
            />
          </div>
          <textarea
            ref={textareaRef}
            className="pane-text"
            dir={isRtl(settings.srcLang) ? "rtl" : "ltr"}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder={`Escribe en ${sourceLang.label}`}
            aria-label={`Texto en ${sourceLang.label}`}
          />
          <div className="pane-foot">
            <button
              className="btn btn-primary"
              onClick={() => translateNow(sourceText)}
              disabled={!sourceText.trim() || isTranslating || !ready}
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
              available={engine.registry}
              onChange={(value) => updateSettings({ tgtLang: value })}
            />
            <div className="pane-actions">
              <button
                className="btn btn-ghost"
                onClick={() =>
                  speak(targetText, targetLang.bcp47).catch((err) => setRuntimeError(err.message))
                }
                disabled={!targetText}
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

          {ready ? (
            <div
              className="pane-text pane-readonly"
              dir={isRtl(settings.tgtLang) ? "rtl" : "ltr"}
              aria-live="polite"
            >
              {targetText || <span className="placeholder">La traducción aparecerá aquí</span>}
            </div>
          ) : (
            <div className="pane-text">
              <ModelGate
                status={engine.status}
                progress={engine.progress}
                error={engine.error}
                srcLang={settings.srcLang}
                tgtLang={settings.tgtLang}
                bytes={engine.bytes}
                pivot={engine.pivot}
                onDownload={startDownload}
              />
            </div>
          )}
        </section>
      </main>

      <StatusBar
        online={online}
        ready={ready}
        pivot={engine.pivot}
        timing={timing}
        error={runtimeError}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        persisted={persisted}
        onModelsCleared={engine.refresh}
      />
    </div>
  )
}
