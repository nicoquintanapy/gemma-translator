import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.jsx"
import "./styles.css"

// Registers the service worker that makes the app shell available offline.
// The models themselves live in Cache Storage, managed by transformers.js.
if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      // No service worker (e.g. served over plain HTTP): the app still runs,
      // it just won't survive a reload while offline.
    })
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
