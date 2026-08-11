import { useCallback, useEffect, useRef, useState } from "react"
import { createWorkerClient } from "../lib/workerClient.js"
import { requestPersistentStorage } from "../lib/storage.js"
import { acquireWakeLock } from "../lib/device.js"

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

export function useEngine({ device, sttSize, enableVoice }) {
  const [status, setStatus] = useState("idle") // idle | loading | ready | error
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ loaded: 0, total: 0, files: 0 })
  const [runtime, setRuntime] = useState({ translate: null, stt: null })
  const [notices, setNotices] = useState([])

  const workersRef = useRef(null)
  const filesRef = useRef(new Map())

  useEffect(() => {
    return () => {
      workersRef.current?.translate.terminate()
      workersRef.current?.stt.terminate()
      workersRef.current = null
    }
  }, [])

  const handleProgress = useCallback((engine, message) => {
    if (message?.kind === "fallback") {
      setNotices((prev) => [
        ...prev,
        `${engine}: ${message.from} no disponible (${message.reason ?? "sin detalle"}), usando CPU.`,
      ])
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

  const load = useCallback(async () => {
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
      // Sequential, not parallel: each pipeline allocates its own arena as it
      // initialises, and doing both at once doubles the peak memory at exactly
      // the moment the tab is most likely to be killed for using too much.
      const translateInfo = await translate.call("load", { device }, (m) =>
        handleProgress("Traductor", m),
      )
      const sttInfo = enableVoice
        ? await stt.call("load", { device, size: sttSize }, (m) =>
            handleProgress("Voz", m),
          )
        : null

      setRuntime({ translate: translateInfo, stt: sttInfo })
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
  }, [device, sttSize, enableVoice, handleProgress])

  const translate = useCallback(async ({ text, srcLang, tgtLang, onPartial }) => {
    const workers = workersRef.current
    if (!workers) throw new Error("El motor no está cargado")
    return workers.translate.call(
      "translate",
      { text, srcLang, tgtLang },
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

  const reset = useCallback(async () => {
    workersRef.current?.translate.terminate()
    workersRef.current?.stt.terminate()
    workersRef.current = null
    filesRef.current = new Map()
    setRuntime({ translate: null, stt: null })
    setProgress({ loaded: 0, total: 0, files: 0 })
    setStatus("idle")
  }, [])

  return { status, error, progress, runtime, notices, load, translate, transcribe, reset }
}
