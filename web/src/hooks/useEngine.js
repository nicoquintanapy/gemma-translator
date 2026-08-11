import { useCallback, useEffect, useRef, useState } from "react"
import { createWorkerClient } from "../lib/workerClient.js"
import { requestPersistentStorage } from "../lib/storage.js"

// Owns the two inference workers and the download lifecycle.
//
// Both models are fetched in parallel and their per-file progress is merged
// into one number, because from the user's point of view there is a single
// action — "download the translator" — not two independent model fetches.

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

export function useEngine({ device, sttSize }) {
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

    if (!workersRef.current) workersRef.current = createWorkers()
    const { translate, stt } = workersRef.current

    try {
      const [translateInfo, sttInfo] = await Promise.all([
        translate.call("load", { device }, (m) => handleProgress("Traductor", m)),
        stt.call("load", { device, size: sttSize }, (m) => handleProgress("Voz", m)),
      ])
      setRuntime({ translate: translateInfo, stt: sttInfo })
      setStatus("ready")
      return true
    } catch (err) {
      const message = err?.message ?? String(err)
      // A bare "Failed to fetch" tells the user nothing; the overwhelmingly
      // common cause is being offline during the one step that needs network.
      setError(
        /failed to fetch|networkerror|err_/i.test(message)
          ? `No se pudo descargar el modelo. La descarga inicial necesita conexión a internet. (${message})`
          : message,
      )
      setStatus("error")
      return false
    }
  }, [device, sttSize, handleProgress])

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
    // Transfer rather than copy the PCM buffer; the caller does not reuse it.
    return workers.stt.call("transcribe", { audio, language }, undefined, [
      audio.buffer,
    ])
  }, [])

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
