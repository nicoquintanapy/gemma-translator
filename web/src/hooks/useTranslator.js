import { useCallback, useEffect, useRef, useState } from "react"
import {
  TRANSLATOR_URL,
  WORKER_URL,
  REGISTRY_URL,
  downloadRoute,
  isRouteCached,
  loadRegistry,
  routeBytes,
  routeFor,
} from "../lib/models.js"
import { acquireWakeLock } from "../lib/device.js"

// Owns the Bergamot engine and the per-pair download lifecycle.
//
// The engine spawns and manages its own worker threads, so unlike the previous
// ONNX setup there is no worker plumbing to write here — this hook is about
// *when* models are fetched, not how inference runs.

export function useTranslator({ srcLang, tgtLang }) {
  const [registry, setRegistry] = useState(null)
  const [status, setStatus] = useState("loading") // loading|needs-download|downloading|ready|unsupported|error
  const [progress, setProgress] = useState({ loaded: 0, total: 0 })
  const [error, setError] = useState(null)

  const translatorRef = useRef(null)
  const routeRef = useRef([])

  useEffect(() => {
    loadRegistry().then(setRegistry).catch((err) => {
      setError(err.message)
      setStatus("error")
    })
  }, [])

  useEffect(() => {
    return () => {
      translatorRef.current?.delete?.()
      translatorRef.current = null
    }
  }, [])

  const route = registry ? routeFor(registry, srcLang, tgtLang) : null
  const bytes = registry && route ? routeBytes(registry, route) : 0

  // Whenever the pair changes, work out whether its models are already local.
  // This only inspects the cache — downloading stays an explicit action.
  useEffect(() => {
    if (!registry) return
    let cancelled = false

    if (route === null) {
      setStatus("unsupported")
      return
    }

    routeRef.current = route
    setError(null)
    isRouteCached(registry, route).then((cached) => {
      if (!cancelled) setStatus(cached ? "ready" : "needs-download")
    })

    return () => {
      cancelled = true
    }
  }, [registry, srcLang, tgtLang, route?.join()])

  const ensureTranslator = useCallback(async () => {
    if (translatorRef.current) return translatorRef.current
    // Loaded from our own /bergamot/ copy, not through the bundler: see
    // scripts/prepare-assets.mjs for why bundling it breaks the worker.
    const { LatencyOptimisedTranslator } = await import(
      /* @vite-ignore */ TRANSLATOR_URL
    )
    translatorRef.current = new LatencyOptimisedTranslator({
      registryUrl: REGISTRY_URL,
      workerUrl: WORKER_URL,
      // Pivoting is handled by the engine using the same en-centric models the
      // registry ships, so a pair with no direct model still works.
      pivotLanguage: "en",
      cacheSize: 0,
    })
    return translatorRef.current
  }, [])

  const download = useCallback(async () => {
    if (!registry || !route) return false
    setStatus("downloading")
    setError(null)
    setProgress({ loaded: 0, total: bytes })

    // A phone that locks mid-download gets its tab suspended, and the transfer
    // dies looking exactly like a dropped connection.
    const release = await acquireWakeLock()
    try {
      await downloadRoute(registry, route, setProgress)
      setStatus("ready")
      return true
    } catch (err) {
      setError(err?.message ?? String(err))
      setStatus("needs-download")
      return false
    } finally {
      release()
    }
  }, [registry, route?.join(), bytes])

  const translate = useCallback(
    async (text) => {
      const source = text.trim()
      if (!source) return { text: "", ms: 0 }

      const translator = await ensureTranslator()
      const started = performance.now()
      const response = await translator.translate({
        from: srcLang,
        to: tgtLang,
        text: source,
        html: false,
      })
      return {
        text: response.target.text.trim(),
        ms: Math.round(performance.now() - started),
      }
    },
    [ensureTranslator, srcLang, tgtLang],
  )

  const refresh = useCallback(async () => {
    if (!registry || !route) return
    setStatus((await isRouteCached(registry, route)) ? "ready" : "needs-download")
  }, [registry, route?.join()])

  return {
    status,
    error,
    progress,
    registry,
    route,
    bytes,
    pivot: (route?.length ?? 0) > 1,
    download,
    translate,
    refresh,
  }
}
