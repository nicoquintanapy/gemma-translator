// Browser-storage helpers. Model-cache specifics live in lib/models.js.

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

export function formatBytes(bytes) {
  if (!bytes) return "0 MB"
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}
