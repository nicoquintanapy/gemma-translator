import { useCallback, useEffect, useRef, useState } from "react"
import { createWorkerClient } from "../lib/workerClient.js"
import { requestPersistentStorage } from "../lib/storage.js"
import { acquireWakeLock } from "../lib/device.js"
import { resolveRoute } from "../lib/translationPacks.js"

// Owns the two inference workers and the download lifecycle.
//
// The models are fetched one after another but their per-file progress is
// merged into a single number, because from the user's point of view there is
// one action — "download the translator" — not two independent model fetches.

function createWorkers() {
  return {
    translate: createWorkerClient(
      new Worker(new URL("../workers/translate.worker.js", import.meta.url), {
        type: "module",
      }),
    ),
    stt: createWorkerClient(
      new Worker(new URL("../workers/stt.worker.js", import.meta.url), {
        type: "module",
      }),
    ),
  }
}

export function useEngine({ device, sttSize, enableVoice, translationEngine }) {
  const [status, setStatus] = useState("idle") // idle | loading | ready | error
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ loaded: 0, total: 0, files: 0 })
  const [runtime, setRuntime] = useState({ translate: null, stt: null })
  const [notices, setNotices] = useState([])
  // For the per-pair engine: which route the loaded packs currently serve, and
  // whether a pair change is waiting on a download.
  const [route, setRoute] = useState(null)
  const [routeState, setRouteState] = useState({ status: "idle", pairs: 0 })

  const workersRef = useRef(null)
  const filesRef = useRef(new Map())
  // Mirrors `route` so translate() can read the current one without being
  // re-created — and therefore without re-triggering the callers that depend
  // on its identity — every time the pair changes.
  const routeRef = useRef(null)

  useEffect(() => {
    return () => {
      workersRef.current?.translate.terminate()
      workersRef.current?.stt.terminate()
      workersRef.current = null
    }
  }, [])

  const handleProgress = useCallback((engine, message) => {
    if (message?.kind === "notice") {
      // Workers phrase these themselves; the hook must not editorialise, since
      // an inaccurate one ("using CPU" when CPU is what just failed) is worse
      // than none at all.
      setNotices((prev) =>
        prev.includes(message.text) ? prev : [...prev, message.text],
      )
      return
    }
    if (message?.kind !== "download") return

    for (const file of message.files) {
      filesRef.current.set(`${engine}:${file.file}`, file)
    }
    let loaded = 0
    let total = 0
    for (const file of filesRef.current.values()) {
      loaded += file.loaded
      total += file.total
    }
    setProgress({ loaded, total, files: filesRef.current.size })
  }, [])

  const load = useCallback(async ({ srcLang, tgtLang, dtypeOverride } = {}) => {
    setStatus("loading")
    setError(null)
    setNotices([])
    filesRef.current = new Map()
    setProgress({ loaded: 0, total: 0, files: 0 })

    // Ask before downloading: a grant made while the tab is already busy
    // fetching hundreds of megabytes is worth having in place beforehand.
    await requestPersistentStorage()

    // Keep the screen awake for the duration. A phone that locks mid-download
    // gets its tab suspended, and the interrupted fetch is indistinguishable
    // from a dropped connection.
    const releaseWakeLock = await acquireWakeLock()

    if (!workersRef.current) workersRef.current = createWorkers()
    const { translate, stt } = workersRef.current

    try {
      // The light engine needs to know which pair it is being asked for before
      // it can download anything; the universal one ignores this entirely.
      let resolved = null
      if (translationEngine === "opus") {
        resolved = await resolveRoute(srcLang, tgtLang)
        if (resolved?.error === "offline") {
          throw new Error(
            "No se pudo contactar con el repositorio de modelos para comprobar este par. La descarga inicial necesita conexión.",
          )
        }
        if (resolved?.error) {
          throw new Error(
            "No hay paquete publicado para este par de idiomas, ni ruta pivotando por inglés. Elige otro par o cambia al motor universal en Ajustes.",
          )
        }
        setRoute(resolved)
        routeRef.current = resolved
      }

      // Sequential, not parallel: each pipeline allocates its own arena as it
      // initialises, and doing both at once doubles the peak memory at exactly
      // the moment the tab is most likely to be killed for using too much.
      const translateInfo = await translate.call(
        "load",
        { device, engine: translationEngine, route: resolved, dtypeOverride },
        (m) => handleProgress("Traductor", m),
      )
      const sttInfo = enableVoice
        ? await stt.call("load", { device, size: sttSize }, (m) =>
            handleProgress("Voz", m),
          )
        : null

      setRuntime({ translate: translateInfo, stt: sttInfo })
      setRouteState({ status: "ready", pairs: resolved?.steps?.length ?? 0 })
      setStatus("ready")
      return true
    } catch (err) {
      const message = err?.message ?? String(err)
      // A bare "Failed to fetch" tells the user nothing; the overwhelmingly
      // common cause is being offline during the one step that needs network.
      setError(
        /failed to fetch|networkerror|err_/i.test(message)
          ? `Se interrumpió la descarga. Reintentar continúa desde donde quedó: los archivos ya completos no se vuelven a bajar. (${message})`
          : message,
      )
      setStatus("error")
      return false
    } finally {
      releaseWakeLock()
    }
  }, [device, sttSize, enableVoice, translationEngine, handleProgress])

  const translate = useCallback(async ({ text, srcLang, tgtLang, onPartial }) => {
    const workers = workersRef.current
    if (!workers) throw new Error("El motor no está cargado")
    return workers.translate.call(
      "translate",
      { text, srcLang, tgtLang, route: routeRef.current },
      (message) => {
        if (message?.kind === "partial") onPartial?.(message.text)
      },
    )
  }, [])

  const transcribe = useCallback(async ({ audio, language }) => {
    const workers = workersRef.current
    if (!workers) throw new Error("El motor no está cargado")
    if (!enableVoice) throw new Error("El reconocimiento de voz no está activado")
    // Transfer rather than copy the PCM buffer; the caller does not reuse it.
    return workers.stt.call("transcribe", { audio, language }, undefined, [
      audio.buffer,
    ])
  }, [enableVoice])

  /**
   * Ensures the packs for a language pair are downloaded and resident.
   *
   * Split from `load` because changing the pair mid-session must not silently
   * pull ~90 MB: the caller inspects the returned status and asks the user
   * first when a download is required.
   */
  const prepareRoute = useCallback(
    async (srcLang, tgtLang, { download = false } = {}) => {
      if (translationEngine !== "opus") return { status: "ready" }
      if (srcLang === tgtLang) return { status: "ready" }

      setRouteState({ status: "checking", pairs: 0 })
      const resolved = await resolveRoute(srcLang, tgtLang)
      if (resolved?.error) {
        const status = resolved.error === "offline" ? "offline" : "unsupported"
        setRouteState({ status, pairs: 0 })
        return { status }
      }

      if (!download) {
        setRouteState({ status: "needs-download", pairs: resolved.steps.length })
        return { status: "needs-download", route: resolved }
      }

      const releaseWakeLock = await acquireWakeLock()
      filesRef.current = new Map()
      setProgress({ loaded: 0, total: 0, files: 0 })
      setRouteState({ status: "downloading", pairs: resolved.steps.length })
      try {
        await workersRef.current?.translate.call(
          "loadRoute",
          { route: resolved },
          (m) => handleProgress("Traductor", m),
        )
        setRoute(resolved)
        routeRef.current = resolved
        setRouteState({ status: "ready", pairs: resolved.steps.length })
        return { status: "ready", route: resolved }
      } catch (err) {
        setRouteState({ status: "error", pairs: 0 })
        setError(err?.message ?? String(err))
        return { status: "error" }
      } finally {
        releaseWakeLock()
      }
    },
    [translationEngine, handleProgress],
  )

  const reset = useCallback(async () => {
    workersRef.current?.translate.terminate()
    workersRef.current?.stt.terminate()
    workersRef.current = null
    filesRef.current = new Map()
    setRuntime({ translate: null, stt: null })
    setProgress({ loaded: 0, total: 0, files: 0 })
    setRoute(null)
    routeRef.current = null
    setRouteState({ status: "idle", pairs: 0 })
    setStatus("idle")
  }, [])

  return {
    status,
    error,
    progress,
    runtime,
    notices,
    route,
    routeState,
    load,
    translate,
    transcribe,
    prepareRoute,
    reset,
  }
}
