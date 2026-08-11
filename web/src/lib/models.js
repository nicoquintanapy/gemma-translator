// Model registry, routing, and the download that fills the offline cache.
//
// The engine (Bergamot) fetches model files itself when it first translates a
// pair, but it has no cache of its own and no progress reporting. So the app
// fetches them first, with progress, into a Cache Storage bucket the service
// worker also serves from — by the time the engine asks, every byte is local.
// That is what makes the app work with the network gone.

export const MODEL_CACHE = "bergamot-models"

// Vite rewrites this to "/" locally and "/<repo>/" on GitHub Pages.
const BASE = import.meta.env.BASE_URL

export const REGISTRY_URL = `${BASE}models/registry.json`
export const WORKER_URL = `${BASE}bergamot/worker/translator-worker.js`
export const TRANSLATOR_URL = `${BASE}bergamot/translator.js`

let registryPromise = null

export function loadRegistry() {
  registryPromise ??= fetch(REGISTRY_URL).then((response) => {
    if (!response.ok) throw new Error(`No se pudo leer el registro de modelos (${response.status})`)
    return response.json()
  })
  return registryPromise
}

/** Languages that appear in at least one bundled pair, in either direction. */
export function availableLanguages(registry) {
  const codes = new Set()
  for (const pair of Object.keys(registry)) {
    codes.add(pair.slice(0, 2))
    codes.add(pair.slice(2, 4))
  }
  return codes
}

/**
 * Pair keys needed to get from one language to another.
 *
 * Bergamot publishes everything as xx<->en, so anything that is not already
 * to or from English takes two hops. Returns null when no route exists.
 */
export function routeFor(registry, from, to) {
  if (from === to) return []
  if (registry[`${from}${to}`]) return [`${from}${to}`]
  if (registry[`${from}en`] && registry[`en${to}`]) return [`${from}en`, `en${to}`]
  return null
}

function filesFor(registry, route) {
  return route.flatMap((pair) => Object.values(registry[pair] ?? {}))
}

/** Total bytes a route costs, from the registry's recorded file sizes. */
export function routeBytes(registry, route) {
  return filesFor(registry, route).reduce((sum, file) => sum + (file.size ?? 0), 0)
}

async function isCached(cache, name) {
  return Boolean(await cache.match(`${BASE}${name}`))
}

/** True when every file the route needs is already stored locally. */
export async function isRouteCached(registry, route) {
  if (!("caches" in window) || route.length === 0) return route.length === 0
  const cache = await caches.open(MODEL_CACHE)
  for (const file of filesFor(registry, route)) {
    if (!(await isCached(cache, file.name))) return false
  }
  return true
}

/**
 * Downloads whatever the route still needs, reporting bytes as they arrive.
 *
 * Files already in the cache are skipped, so a retry after an interruption
 * only re-fetches what is genuinely missing.
 */
export async function downloadRoute(registry, route, onProgress) {
  const cache = await caches.open(MODEL_CACHE)
  const files = filesFor(registry, route)

  const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0)
  let loaded = 0

  for (const file of files) {
    const url = `${BASE}${file.name}`
    if (await isCached(cache, url.slice(BASE.length))) {
      loaded += file.size ?? 0
      onProgress?.({ loaded, total })
      continue
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`No se pudo descargar ${file.name} (${response.status})`)
    }

    // Tee the body so progress can be counted without buffering the whole file
    // twice: one branch feeds the counter, the other goes straight to the cache.
    const [counting, storing] = response.body.tee()
    const startedAt = loaded

    const count = (async () => {
      const reader = counting.getReader()
      let seen = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        seen += value.byteLength
        loaded = startedAt + seen
        onProgress?.({ loaded, total })
      }
    })()

    await Promise.all([
      cache.put(url, new Response(storing, { headers: response.headers })),
      count,
    ])

    loaded = startedAt + (file.size ?? 0)
    onProgress?.({ loaded, total })
  }

  return { bytes: total }
}

export async function cachedBytes() {
  if (!("caches" in window)) return 0
  try {
    const cache = await caches.open(MODEL_CACHE)
    let total = 0
    for (const request of await cache.keys()) {
      const response = await cache.match(request)
      if (!response) continue
      const header = Number(response.headers.get("content-length"))
      total += Number.isFinite(header) && header > 0
        ? header
        : (await response.clone().blob()).size
    }
    return total
  } catch {
    return 0
  }
}

export async function clearModels() {
  if ("caches" in window) await caches.delete(MODEL_CACHE)
}
