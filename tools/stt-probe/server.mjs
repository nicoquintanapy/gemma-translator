// Static server with cross-origin isolation, so the probe runs under the same
// headers the real app uses.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" }

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "")
  try {
    const body = await readFile(join(process.cwd(), path === "/" ? "index.html" : path))
    res.writeHead(200, {
      "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end("not found")
  }
}).listen(4190, "127.0.0.1")
