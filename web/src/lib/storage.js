// Browser-storage helpers for the downloaded weights.

import { AUX_CACHE_KEYS, MODEL_CACHE_KEY, PARTIAL_DIR } from "./engineConfig.js"

/**
 * Ask the browser to mark this origin's storage as persistent.
 *
 * This matters more than it looks: without it the models sit in "best-effort"
 * storage, which the browser is free to evict under disk pressure — the user
 * would come back offline one day to a 350 MB hole and a broken app. Chrome
 * usually grants it silently for installed//engaged origins; a refusal is not
 * fatal, so we only report it.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { supported: false, granted: false }
  try {
    const already = await navigator.storage.persisted?.()
    if (already) return { supported: true, granted: true }
    return { supported: true, granted: await navigator.storage.persist() }
  } catch {
    return { supported: true, granted: false }
  }
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

/** True when at least one model file is already in Cache Storage. */
export async function hasCachedModels() {
  if (!("caches" in self)) return false
  try {
    const cache = await caches.open(MODEL_CACHE_KEY)
    const keys = await cache.keys()
    return keys.length > 0
  } catch {
    return false
  }
}

/** Bytes currently held by the model cache, summed from the stored responses. */
export async function getModelCacheSize() {
  if (!("caches" in self)) return 0
  try {
    const cache = await caches.open(MODEL_CACHE_KEY)
    const keys = await cache.keys()
    let total = 0
    for (const request of keys) {
      const response = await cache.match(request)
      if (!response) continue
      // `Content-Length` is cheap; fall back to reading the blob only when the
      // header is missing so we don't re-materialise hundreds of MB.
      const header = Number(response.headers.get("content-length"))
      if (Number.isFinite(header) && header > 0) total += header
      else total += (await response.clone().blob()).size
    }
    return total
  } catch {
    return 0
  }
}

export async function clearModelCache() {
  if ("caches" in self) {
    await Promise.all(
      [MODEL_CACHE_KEY, ...AUX_CACHE_KEYS].map((key) => caches.delete(key)),
    )
  }
  // Half-finished downloads live outside Cache Storage, in OPFS; leaving them
  // behind would keep occupying space the user just asked to reclaim.
  try {
    const root = await navigator.storage?.getDirectory?.()
    await root?.removeEntry(PARTIAL_DIR, { recursive: true })
  } catch {
    /* nothing stored, or OPFS unavailable */
  }
}

/** Bytes held as incomplete downloads, shown alongside the cache size. */
export async function getPartialDownloadBytes() {
  try {
    const root = await navigator.storage?.getDirectory?.()
    if (!root) return 0
    const dir = await root.getDirectoryHandle(PARTIAL_DIR, { create: false })
    let total = 0
    for await (const [, handle] of dir.entries()) {
      if (handle.kind === "file") total += (await handle.getFile()).size
    }
    return total
  } catch {
    return 0
  }
}

export function formatBytes(bytes) {
  if (!bytes) return "0 MB"
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}
