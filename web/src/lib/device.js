// Device capability hints used to pick safe defaults.
//
// Phones are not just "slower desktops" here: iOS caps how much memory a web
// view may hold and discards backgrounded tabs aggressively, so a profile that
// is merely slow on a laptop can be impossible on a phone.

export function isMobileDevice() {
  if (navigator.userAgentData?.mobile !== undefined) {
    return navigator.userAgentData.mobile
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/**
 * iOS, including Chrome/Firefox on iOS — every browser there is WebKit under
 * the hood and inherits the same web-view memory ceiling.
 */
export function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}

/**
 * Holds a screen wake lock for as long as the returned release function is
 * uncalled. Without it a phone screen locks mid-download, the browser suspends
 * the tab, and a half-finished multi-hundred-megabyte fetch dies — which looks
 * to the user like the connection dropped.
 *
 * Returns a no-op release when the API is unavailable or the request is denied.
 */
export async function acquireWakeLock() {
  if (!navigator.wakeLock?.request) return () => {}

  let sentinel = null
  const reacquire = async () => {
    // The lock is dropped whenever the tab loses visibility; take it again on
    // return so a brief app switch does not silently remove the protection.
    if (document.visibilityState === "visible" && sentinel?.released !== false) {
      try {
        sentinel = await navigator.wakeLock.request("screen")
      } catch {
        /* denied — nothing more to do */
      }
    }
  }

  try {
    sentinel = await navigator.wakeLock.request("screen")
  } catch {
    return () => {}
  }

  document.addEventListener("visibilitychange", reacquire)
  return () => {
    document.removeEventListener("visibilitychange", reacquire)
    sentinel?.release?.().catch(() => {})
    sentinel = null
  }
}
