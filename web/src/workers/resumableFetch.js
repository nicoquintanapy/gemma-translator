// Byte-level resumable downloads for model weights.
//
// transformers.js only writes a file to Cache Storage once it has arrived in
// full, so a transfer interrupted at 90% of a 60 MB file leaves nothing behind
// and starts from zero next time. On a phone — where the tab can be reclaimed
// at any moment — that is the difference between a download that eventually
// finishes and one that never does.
//
// This wraps the global fetch: partial bytes are appended to a file in OPFS as
// they arrive, and a retry resumes with a Range request from wherever it got
// to. The response handed back to transformers.js is indistinguishable from a
// normal full-length one — it streams the bytes already on disk first, then
// continues from the network — so its own progress reporting still works.
//
// Every failure path falls back to a plain fetch. A bug in here must degrade to
// today's behaviour, never break downloading altogether.

import { PARTIAL_DIR } from "../lib/engineConfig.js"

// Only the large weight files are worth this machinery; configs and tokenizers
// are a few kilobytes and go straight through.
const RESUMABLE = /\.(onnx|onnx_data|bin|safetensors)(\?|$)/i

function partialName(url) {
  // OPFS names cannot contain slashes; the URL is unique enough after escaping.
  return encodeURIComponent(url).replace(/\*/g, "%2A").slice(-180)
}

async function openPartial(url) {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(PARTIAL_DIR, { create: true })
  const handle = await dir.getFileHandle(partialName(url), { create: true })
  return { dir, handle, access: await handle.createSyncAccessHandle() }
}

async function discardPartial(url) {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(PARTIAL_DIR, { create: true })
    await dir.removeEntry(partialName(url))
  } catch {
    /* already gone */
  }
}

/** Total size of the resource from a 206's Content-Range, or null. */
function totalFromContentRange(response) {
  const header = response.headers.get("content-range")
  const total = header && Number(header.split("/")[1])
  return Number.isFinite(total) && total > 0 ? total : null
}

function supportsOpfs() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createSyncAccessHandle" in FileSystemFileHandle.prototype
  )
}

async function resumableFetch(originalFetch, url, init) {
  let access = null

  try {
    ;({ access } = await openPartial(url))
    const already = access.getSize()

    const headers = new Headers(init?.headers ?? {})
    if (already > 0) headers.set("Range", `bytes=${already}-`)

    let response = await originalFetch(url, { ...init, headers })

    // 416 means the stored partial is at or past the end of the resource —
    // typically because every byte arrived but the transfer was cut before it
    // could be committed. There is nothing left to resume, so start over
    // rather than handing a Range error back as if the download had failed.
    if (response.status === 416) {
      access.truncate(0)
      const retryHeaders = new Headers(init?.headers ?? {})
      retryHeaders.delete("Range")
      response = await originalFetch(url, { ...init, headers: retryHeaders })
    }

    if (!response.ok || !response.body) {
      access.close()
      return response
    }

    // A server that ignored the Range header restarts the content from zero,
    // so anything already on disk is now a prefix of nothing.
    const resumed = response.status === 206 && already > 0
    if (!resumed) access.truncate(0)

    const offset = resumed ? already : 0
    const total = resumed
      ? totalFromContentRange(response)
      : Number(response.headers.get("content-length")) || null

    let written = offset
    const reader = response.body.getReader()
    const handle = access
    access = null // ownership moves into the stream

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Replay what is already on disk so the consumer sees one continuous
          // body of the full length.
          const CHUNK = 4 * 1024 * 1024
          for (let at = 0; at < offset; at += CHUNK) {
            const size = Math.min(CHUNK, offset - at)
            const buffer = new Uint8Array(size)
            handle.read(buffer, { at })
            controller.enqueue(buffer)
          }

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            handle.write(value, { at: written })
            written += value.byteLength
            controller.enqueue(value)
          }

          handle.flush()
          handle.close()
          controller.close()
          // Completed: transformers.js now owns the bytes in Cache Storage.
          await discardPartial(url)
        } catch (error) {
          // Keep whatever landed on disk — that is the entire point.
          try {
            handle.flush()
            handle.close()
          } catch {
            /* already closed */
          }
          controller.error(error)
        }
      },
      cancel() {
        try {
          handle.flush()
          handle.close()
        } catch {
          /* already closed */
        }
        reader.cancel().catch(() => {})
      },
    })

    const outHeaders = new Headers(response.headers)
    outHeaders.delete("content-range")
    if (total) outHeaders.set("content-length", String(total))

    return new Response(stream, {
      status: 200,
      statusText: "OK",
      headers: outHeaders,
    })
  } catch (error) {
    try {
      access?.close()
    } catch {
      /* nothing to close */
    }
    throw error
  }
}

/** Installs the wrapper on the worker's global fetch. Safe to call twice. */
export function installResumableFetch() {
  if (!supportsOpfs() || self.__resumableFetchInstalled) return false

  const originalFetch = self.fetch.bind(self)
  self.__resumableFetchInstalled = true

  self.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url
    const method = (init?.method ?? (typeof input === "object" ? input.method : "GET")) ?? "GET"

    if (!url || method !== "GET" || !RESUMABLE.test(url)) {
      return originalFetch(input, init)
    }

    try {
      return await resumableFetch(originalFetch, url, init)
    } catch {
      // Any problem in the resume path — OPFS unavailable, a locked handle, a
      // server that mishandles Range — must not stop the download happening.
      return originalFetch(input, init)
    }
  }

  return true
}

/** Bytes currently held as incomplete downloads, for the storage readout. */
export async function getPartialBytes() {
  if (!supportsOpfs()) return 0
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(PARTIAL_DIR, { create: true })
    let total = 0
    for await (const [, handle] of dir.entries()) {
      if (handle.kind === "file") total += (await handle.getFile()).size
    }
    return total
  } catch {
    return 0
  }
}

/** Drops every incomplete download. Used by "delete models". */
export async function clearPartials() {
  if (!supportsOpfs()) return
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(PARTIAL_DIR, { recursive: true })
  } catch {
    /* nothing stored */
  }
}
