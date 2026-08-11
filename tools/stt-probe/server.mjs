// Static server with cross-origin isolation, so the probe runs under the same
// headers the real app uses.
//
// The port matters: the Fetch standard maintains a list of blocked ports, and
// both browsers and Node's fetch refuse them outright with "bad port". 4190
// (ManageSieve) is on that list — curl is not, which is exactly why it looked
// fine locally and failed under fetch.
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
})
  .on("error", (error) => {
    console.error("[server] no pudo escuchar:", error.message)
    process.exit(1)
  })
  .listen(4192, "127.0.0.1", () => console.log("[server] escuchando en 4192"))
