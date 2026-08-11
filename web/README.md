# Traductor offline en el navegador

Traductor de voz y texto que descarga sus modelos una vez, los guarda en el
navegador y a partir de ahí funciona **sin servidor y sin conexión**. No hay
backend: toda la inferencia ocurre en Web Workers dentro de la pestaña.

Es una app independiente dentro de este repositorio. No sustituye al kiosco de
Raspberry Pi de `frontend/` + `backend/`, que sigue funcionando igual.

## Por qué no reutiliza el motor del kiosco

El proyecto original es "offline" en el sentido de *sin internet, pero con
servidores locales*: un binario nativo de LiteRT-LM sirviendo Gemma 4 E2B en el
puerto 9379 y un `http.server` de Python con Moonshine para voz. Nada de eso
puede ejecutarse en un navegador, así que la capa de inferencia se reescribió
por completo:

| Capa | Kiosco (Raspberry Pi) | Esta app (navegador) |
| :--- | :--- | :--- |
| Traducción | Gemma 4 E2B vía LiteRT-LM (~2.6 GB, proceso nativo) | NLLB-200 distilled 600M int8 vía onnxruntime-web (~350 MB) |
| Voz → texto | Moonshine (Python, solo inglés) | Whisper base/tiny int8 (multilingüe) |
| Texto → voz | moonshine-voice (Python) | `speechSynthesis` (voces del sistema) |
| Transporte | `fetch` a `localhost:3000` | Web Workers, mismo origen |

Se eligió NLLB en lugar de un LLM generalista porque es un modelo de traducción
dedicado: recibe los idiomas de origen y destino como etiquetas FLORES-200 y
emite la traducción directamente. No hace falta *prompt*, ni pedirle JSON, ni
tolerar que se salga del formato — y ocupa una fracción de lo que ocupa Gemma.

## Uso

```bash
cd web
npm install
npm run dev        # http://localhost:5174
```

Producción:

```bash
npm run build      # genera dist/
npm run preview
```

`npm run dev` y `npm run build` ejecutan antes `scripts/copy-ort.mjs`, que copia
el runtime WASM de onnxruntime a `public/ort/`. Es imprescindible: por defecto
transformers.js lo descarga de un CDN en cada arranque en frío, lo que rompería
el funcionamiento offline. Esos archivos están en `.gitignore` porque se
regeneran desde `node_modules`.

## Despliegue

`dist/` es estático: sirve con cualquier hosting. Dos requisitos:

1. **HTTPS** (o `localhost`). Sin él no hay micrófono ni service worker.
2. **Cabeceras COOP/COEP**, opcionales pero muy recomendables:

   ```
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Embedder-Policy: credentialless
   ```

   Activan `SharedArrayBuffer`, que es lo que permite a onnxruntime-web usar
   varios hilos. Sin ellas la app funciona igual, pero en un solo hilo y bastante
   más lenta. Se usa `credentialless` y no `require-corp` porque este último
   bloquearía la descarga de los modelos desde huggingface.co.

   La app muestra en Ajustes → «Motor activo» si el aislamiento está activo.

### GitHub Pages

`.github/workflows/deploy-web.yml` publica `web/dist` en GitHub Pages en cada
push a `main` que toque `web/`, compilando con `VITE_BASE` apuntando al subpath
del repositorio.

Requiere un ajuste manual una sola vez: **Settings → Pages → Build and
deployment → Source: «GitHub Actions»**. El workflow no puede activarlo por sí
mismo porque el `GITHUB_TOKEN` por defecto no tiene permiso para crear el sitio
de Pages.

Salvedad conocida: **GitHub Pages no permite enviar cabeceras propias**, así que
allí no hay aislamiento cross-origin y la inferencia corre en un solo hilo. Es
perfectamente usable para probar, pero para uso real conviene un hosting donde
puedas definir COOP/COEP (Netlify, Vercel, Cloudflare Pages, nginx…).

## Cómo se guardan los modelos

- Los pesos van a **Cache Storage**, bajo la clave `offline-translator-models`.
- Al iniciar la descarga se llama a `navigator.storage.persist()` para pedir
  almacenamiento persistente; sin él el navegador puede descartar los modelos si
  se queda sin espacio. Instalar la app como PWA suele bastar para que se
  conceda. El estado real se muestra en Ajustes.
- El *app shell* lo precachea un service worker; el runtime WASM se cachea bajo
  demanda durante la descarga inicial.
- «Borrar modelos descargados» en Ajustes vacía la caché por completo.

## Atajos

| Tecla | Acción |
| :--- | :--- |
| **Barra espaciadora** | Empezar / detener grabación (ignorada al escribir) |
| **Ctrl/⌘ + Enter** | Traducir ahora |

Al dejar de escribir, la traducción se lanza sola tras una breve pausa.

## Idiomas

20 idiomas en `src/lib/languages.js`, cada uno con sus tres códigos (FLORES-200
para NLLB, nombre en inglés para Whisper, BCP-47 para la síntesis de voz).
Añadir uno es añadir una fila.

Dos limitaciones que la interfaz muestra explícitamente en vez de fallar en
silencio:

- **Guaraní** lo traduce NLLB pero Whisper no lo transcribe: el botón de
  micrófono se deshabilita y explica por qué. Escribiendo funciona.
- La **lectura en voz alta** depende de las voces instaladas en el sistema
  operativo, no de un modelo descargado. Ajustes indica para qué idiomas falta
  voz en el dispositivo actual.

## Móviles

El perfil por defecto en móvil es más conservador: modelo de voz `tiny` y
**reconocimiento de voz desactivado**, lo que deja la primera descarga en
~350 MB en vez de ~500 MB. Ambas cosas se activan con un toggle.

La razón es concreta: en iPhone y iPad todos los navegadores son WebKit por
debajo, y el límite de memoria por pestaña es bajo. Cargar los dos modelos a la
vez lo roza, y el sistema mata la pestaña — lo que el usuario percibe como
«se cortó la conexión», no como un fallo de memoria. Tres mitigaciones:

- Los modelos se cargan **secuencialmente**, no en paralelo, para no duplicar el
  pico de memoria durante la inicialización.
- Se toma un **wake lock** durante la descarga, para que la pantalla no se
  apague y el sistema no suspenda la pestaña a medias.
- Reintentar **continúa desde donde quedó**: los archivos ya completos están en
  Cache Storage y no se vuelven a bajar.

## Rendimiento

Por defecto la inferencia corre en **CPU (WASM)**: los pesos publicados son int8
y la CPU los ejecuta de forma nativa. WebGPU está disponible como opción
experimental en Ajustes — el soporte de kernels int8 en modelos
codificador-decodificador varía según el navegador, así que si falla la
inicialización se vuelve a CPU automáticamente y se avisa en pantalla.

## Estructura

```
src/
  workers/
    runtime.js           configuración compartida de transformers.js + RPC
    translate.worker.js  NLLB-200
    stt.worker.js        Whisper
  lib/
    engineConfig.js      qué se descarga y dónde se guarda
    languages.js         tabla de idiomas y sus tres códigos
    workerClient.js      RPC con promesas sobre Worker
    storage.js           persistencia, cuota y limpieza de caché
    tts.js               síntesis de voz del sistema
  hooks/
    useEngine.js         ciclo de vida de los dos workers y la descarga
    useAudioRecorder.js  micrófono → Float32 PCM mono a 16 kHz
  components/            ModelGate, LanguagePicker, MicButton, SettingsSheet, StatusBar
scripts/copy-ort.mjs     auto-aloja el runtime WASM de onnxruntime
```
