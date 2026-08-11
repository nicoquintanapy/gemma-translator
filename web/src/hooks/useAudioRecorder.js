import { useCallback, useEffect, useRef, useState } from "react"

// Microphone capture that yields exactly what Whisper expects: mono Float32
// PCM at 16 kHz.
//
// Capture goes through MediaRecorder and the resample through an
// OfflineAudioContext rather than a hand-rolled linear interpolation on a
// ScriptProcessorNode: the browser's resampler is properly band-limited (no
// aliasing artefacts fed into the acoustic model) and MediaRecorder is not
// deprecated. An AnalyserNode is tapped off the same stream purely to drive
// the on-screen level meter.

const TARGET_SAMPLE_RATE = 16000

async function decodeToMono16k(blob) {
  const bytes = await blob.arrayBuffer()

  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const decodeCtx = new AudioCtx()
  let decoded
  try {
    decoded = await decodeCtx.decodeAudioData(bytes)
  } finally {
    await decodeCtx.close()
  }

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  if (frames <= 0) return new Float32Array(0)

  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()

  return rendered.getChannelData(0)
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState(null)

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const contextRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    analyserRef.current = null
    if (contextRef.current && contextRef.current.state !== "closed") {
      contextRef.current.close()
    }
    contextRef.current = null
    setLevel(0)
  }, [])

  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream

      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const context = new AudioCtx()
      contextRef.current = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser

      const buffer = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteTimeDomainData(buffer)
        let peak = 0
        for (const sample of buffer) {
          peak = Math.max(peak, Math.abs(sample - 128) / 128)
        }
        setLevel(peak)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()

      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.start()
      recorderRef.current = recorder
      setIsRecording(true)
      return true
    } catch (err) {
      teardown()
      setError(
        err?.name === "NotAllowedError"
          ? "Permiso de micrófono denegado."
          : `No se pudo acceder al micrófono: ${err?.message ?? err}`,
      )
      return false
    }
  }, [teardown])

  /** Stops capture and resolves with the 16 kHz mono Float32Array, or null. */
  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false)
      teardown()
      return null
    }

    const finished = new Promise((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    await finished

    setIsRecording(false)
    recorderRef.current = null
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
    chunksRef.current = []
    teardown()

    if (blob.size === 0) return null
    try {
      const samples = await decodeToMono16k(blob)
      // Guard against accidental taps producing a fraction of a second of noise.
      return samples.length < TARGET_SAMPLE_RATE * 0.25 ? null : samples
    } catch (err) {
      setError(`No se pudo procesar el audio: ${err?.message ?? err}`)
      return null
    }
  }, [teardown])

  return { isRecording, level, error, start, stop, clearError: () => setError(null) }
}
