// Promise-based RPC over a Worker.
//
// Every call gets an id; the worker answers with exactly one `complete` or
// `error` for that id, and may emit any number of `progress` messages in
// between which are handed to the per-call `onProgress` callback.

let nextId = 1

export function createWorkerClient(worker) {
  const pending = new Map()

  worker.addEventListener("message", (event) => {
    const { id, status, data, error } = event.data ?? {}
    const call = pending.get(id)
    if (!call) return

    if (status === "progress") {
      call.onProgress?.(data)
      return
    }
    pending.delete(id)
    if (status === "error") call.reject(new Error(error))
    else call.resolve(data)
  })

  worker.addEventListener("error", (event) => {
    // A worker-level failure (bad import, OOM) never produces per-call
    // responses, so every outstanding promise must be rejected or the UI
    // hangs forever on a spinner.
    const failure = new Error(event.message || "El worker falló al inicializar")
    for (const [id, call] of pending) {
      pending.delete(id)
      call.reject(failure)
    }
  })

  /**
   * @param transfer Optional transferable objects (e.g. an audio buffer) moved
   *   rather than copied. They become unusable on this side afterwards.
   */
  function call(type, payload, onProgress, transfer) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress })
      worker.postMessage({ id, type, payload }, transfer ?? [])
    })
  }

  return { call, terminate: () => worker.terminate() }
}
