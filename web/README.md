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

## Dos motores de traducción

| | Ligero (Opus-MT) — por defecto | Universal (NLLB-200) |
| :--- | :--- | :--- |
| Descarga | ~90 MB por dirección | 350 MB una vez |
| Cobertura | los pares que descargues | 200 idiomas, cualquier combinación |
| Par nuevo | otra descarga | 0 MB |
| Pares sin publicar | pivota por inglés | no aplica |

**Por qué elegir idiomas no reduce NLLB.** NLLB-200 es un único modelo
monolítico: el idioma se selecciona con un token de entrada (`spa_Latn`), no
cargando pesos distintos. De sus ~615M de parámetros, unos 260M son la tabla de
embeddings del vocabulario multilingüe de 256k tokens — el bloque más grande, y
compartido por los 200 idiomas. Recortar la lista de `languages.js` a dos
idiomas ahorraría exactamente cero bytes. Por eso el motor ligero es un cambio
de familia de modelo, no un filtro.

**Disponibilidad de pares.** Helsinki-NLP no publicó todas las combinaciones, y
no todas tienen build ONNX. En vez de codificar una lista de repos y confiar,
`src/lib/translationPacks.js` **sondea** el Hub y cachea el resultado. Un par
directo que no exista se resuelve pivotando por inglés (dos paquetes); si
tampoco hay ruta, se dice explícitamente. El sondeo distingue «no publicado» (un
404 real) de «no se pudo comprobar» (sin conexión), porque decirle a alguien sin
red que su idioma no existe es a la vez falso e inútil.

Los paquetes residentes se mantienen en un LRU de 3 en el worker, suficiente
para una ruta con pivote sin recargar constantemente.

## Cómo se guardan los modelos

- Los pesos van a **Cache Storage**, bajo la clave `offline-translator-models`.
- Al iniciar la descarga se llama a `navigator.storage.persist()` para pedir
  almacenamiento persistente; sin él el navegador puede descartar los modelos si
  se queda sin espacio. Instalar la app como PWA suele bastar para que se
  conceda. El estado real se muestra en Ajustes.
- El *app shell* lo precachea un service worker; el runtime WASM se cachea bajo
  demanda durante la descarga inicial.
- «Borrar modelos descargados» en Ajustes vacía la caché por completo.

**Reanudación byte a byte.** transformers.js solo escribe un archivo en Cache
Storage cuando ha llegado entero, así que un corte al 90 % de un archivo de
60 MB no dejaba nada y volvía a empezar de cero. `workers/resumableFetch.js`
envuelve el `fetch` global: los bytes se van guardando en OPFS a medida que
llegan y un reintento continúa con una petición `Range` desde donde quedó. La
respuesta que ve transformers.js es indistinguible de una normal — primero
emite lo que ya está en disco y luego sigue de la red — así que su propio
reporte de progreso sigue funcionando.

Cualquier fallo en ese camino cae de vuelta a un `fetch` normal: un bug ahí
tiene que degradar al comportamiento anterior, nunca romper la descarga.

Verificado en Chromium con la red estrangulada: cortando a los 2 MB de un
archivo de 8 MB quedan 2 MB en OPFS, el reintento completa los 8 MB y el hash
coincide byte a byte con la descarga íntegra.

*Nota sobre localStorage:* no sirve para esto. Tiene un límite de ~5-10 MB, es
síncrono y solo almacena cadenas. Cache Storage y OPFS son las APIs pensadas
para binarios grandes.

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

El perfil por defecto en móvil es más conservador: motor ligero, modelo de voz
`tiny` y **reconocimiento de voz desactivado**, lo que deja la primera descarga
en **~90 MB**. Todo se activa con un toggle.

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

## Compatibilidad del runtime con los pesos cuantizados

onnxruntime-web 1.26 (el que trae transformers.js v4) ejecuta un transformador
QDQ — `TransposeDQWeightsForMatMulNBits` — en el nivel de optimización
*extended*. Los ONNX cuantizados que publican los repos `Xenova/*` se generaron
antes de eso y no contienen los inicializadores de escala por peso que ese paso
espera, así que crear la sesión puede fallar con:

```
Missing required scale: model.shared.weight_merged_0_scale
```

No es un fallo de descarga: los pesos están bien y ya en caché. `runtime.js`
baja el nivel de optimización y reconstruye — `completa` → `básica` →
`sin optimizar` — lo que no cuesta ancho de banda. `sin optimizar` ejecuta el
grafo tal como se exportó: más lento, pero es el único nivel que no puede
tropezar con una optimización.

Si aun así falla, la tarjeta de error ofrece reintentar con los pesos sin
cuantizar (`fp32`). Es opt-in y nunca automático, porque la descarga es varias
veces mayor.

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
