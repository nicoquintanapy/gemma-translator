# Traductor offline en el navegador

Traductor de texto que descarga sus modelos una vez, los guarda en el navegador
y a partir de ahí funciona **sin servidor y sin conexión**. No hay backend: la
traducción entera ocurre dentro de la pestaña.

Es una app independiente dentro de este repositorio. No sustituye al kiosco de
Raspberry Pi de `frontend/` + `backend/`, que sigue funcionando igual.

## Qué motor usa y por qué

[Bergamot](https://github.com/browsermt/bergamot-translator): Marian NMT
compilado a WASM, el mismo motor que Firefox lleva embebido para traducir
páginas. Modelos de ~16 MB por dirección, engine de 5 MB.

El proyecto original es "offline" en el sentido de *sin internet, pero con
servidores locales*: un binario nativo de LiteRT-LM sirviendo Gemma 4 E2B en el
puerto 9379 y un `http.server` de Python para voz. Nada de eso puede ejecutarse
en un navegador.

| Capa | Kiosco (Raspberry Pi) | Esta app |
| :--- | :--- | :--- |
| Traducción | Gemma 4 E2B vía LiteRT-LM (~2.6 GB, proceso nativo) | Bergamot / Marian WASM (~16 MB por dirección) |
| Texto → voz | moonshine-voice (Python) | `speechSynthesis` (voces del sistema) |
| Transporte | `fetch` a `localhost:3000` | ninguno; todo en la pestaña |

Antes de Bergamot se intentó transformers.js con NLLB-200 y Opus-MT en ONNX. No
funcionó: onnxruntime-web rechazaba los grafos cuantizados que publican esos
repos (`TransposeDQWeightsForMatMulNBits: Missing required scale`), y además
HuggingFace no era alcanzable desde el entorno donde se desarrollaba, así que la
carga del modelo nunca llegó a ejecutarse ni una vez. Bergamot se eligió porque
es más pequeño, está probado en producción, y **se puede ejecutar y verificar**.

## Uso

```bash
cd web
npm install
npm run dev        # http://localhost:5174
```

`predev` y `prebuild` ejecutan `scripts/prepare-assets.mjs`, que copia el motor
a `public/bergamot/` y descarga los modelos a `public/models/`. Ambos están en
`.gitignore`: se regeneran, no se commitean.

Para cambiar qué idiomas se incluyen:

```bash
TRANSLATION_LANGUAGES=es,en,pt npm run build
```

## Por qué los modelos se sirven desde el propio sitio

No es una optimización, es un requisito. Los buckets de Google Cloud Storage que
publican los modelos de Bergamot **no envían cabeceras CORS**, así que un
navegador en otro origen no puede descargarlos. Comprobado:

```
$ curl -D- -H "Origin: https://ejemplo.github.io" \
    https://storage.googleapis.com/bergamot-models-sandbox/0.3.3/esen/vocab.esen.spm
HTTP/2 200
content-type: application/octet-stream
(sin access-control-allow-origin)
```

Servirlos nosotros lo resuelve y de paso elimina la dependencia de que un bucket
ajeno siga en pie. El CI los descarga en tiempo de build y los mete en el
artefacto, con `actions/cache` para no repetir la descarga en cada push.

## Cómo se guarda todo

- Los modelos van a **Cache Storage**, bucket `bergamot-models`. La app los
  escribe ahí directamente durante la descarga (con progreso), y el service
  worker sirve desde ese mismo bucket — así un fichero traído por cualquiera de
  las dos vías satisface a la otra.
- El motor WASM y el *app shell* los cachea el service worker.
- Al empezar la descarga se pide `navigator.storage.persist()`; sin él el
  navegador puede descartar los modelos si se queda sin espacio. Instalar la app
  como PWA suele bastar. El estado real se ve en Ajustes.
- Se toma un **wake lock** durante la descarga: un móvil que bloquea la pantalla
  suspende la pestaña y corta la transferencia, lo que parece un fallo de red.
- Los ficheros ya presentes se saltan, así que un reintento solo baja lo que
  falta.

## Verificación

Lo que importa de este proyecto es que funcione sin conexión, así que eso se
prueba matando el servidor, no simulando:

```
gate:      «Español → English · un modelo, 21 MB»
descarga:  completa — 4 ficheros, 20.8 MB en Cache Storage
con red:   "Hola, ¿dónde está la estación de tren?"
           → "Hey, where's the train station?"

--- servidor matado (SIGKILL), confirmado con ERR_CONNECTION_REFUSED ---

pestaña NUEVA: "Necesito un médico, por favor."
               → "I need a doctor, please."
otra frase:    "El clima está muy agradable hoy."
               → "The weather is very pleasant today."
```

Dos trampas que invalidaron versiones anteriores de esta prueba, por si alguien
la reescribe:

- `context.setOffline(true)` de Playwright **no bloquea localhost**. Hay que
  matar el proceso.
- Lanzar el servidor con `npx` deja el proceso real huérfano al matar el
  envoltorio, así que "offline" se probaba contra un servidor vivo.
- Esperar a que el panel de salida "tenga texto" deja pasar la traducción
  anterior como si fuera la nueva. Hay que esperar a que **cambie**.

## Despliegue

`dist/` es estático. Dos requisitos:

1. **HTTPS** (o `localhost`), para el service worker.
2. **Cabeceras COOP/COEP**, recomendables:

   ```
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Embedder-Policy: credentialless
   ```

   Habilitan `SharedArrayBuffer` y con ello los hilos del motor. Sin ellas
   funciona, más lento.

### GitHub Pages

`.github/workflows/deploy-web.yml` publica en cada push a `main` que toque
`web/`. Requiere un ajuste manual una vez: **Settings → Pages → Source: «GitHub
Actions»** (el `GITHUB_TOKEN` por defecto no puede crear el sitio).

GitHub Pages no permite cabeceras propias, así que allí no hay aislamiento
cross-origin y el motor va en un solo hilo. Usable; para uso real conviene un
hosting donde puedas definir COOP/COEP.

## Idiomas

El desplegable se construye a partir de `public/models/registry.json`, es decir,
de lo que realmente se incluyó en el build. Un idioma de `src/lib/languages.js`
sin modelo no se ofrece.

Todos los modelos de Bergamot son `xx↔en`, así que los pares que no pasan por
inglés se resuelven **pivotando**: dos modelos y dos traducciones encadenadas.
Funciona, pero el texto pasa dos veces por el motor y pierde algo de calidad; la
interfaz lo indica en la barra de estado.

## Lo que no hace

**Entrada por voz.** Bergamot traduce, no transcribe. Está sin implementar,
pero ya **no** es una incógnita: `tools/stt-probe` la resolvió en CI.

```
PASA   transformers 3.8.1  onnx-community/whisper-tiny   cargó 2669 ms
PASA   transformers 3.8.1  Xenova/whisper-tiny           cargó 1391 ms
FALLA  transformers 4.2.0  onnx-community/whisper-tiny   TransposeDQWeightsForMatMulNBits
FALLA  transformers 4.2.0  Xenova/whisper-tiny           (mismo error)
```

Whisper carga y transcribe con transformers **3.8.1**. Lo determinante es la
versión de la librería — y con ella la de onnxruntime — no el formato del
export: los repos modernos `onnx-community/*` fallan igual que los antiguos
bajo la 4.2.0. Esa suposición, que el formato era la variable, es justo la que
el probe refutó.

Coste de añadirla: un segundo runtime conviviendo con Bergamot
(transformers.js + onnxruntime wasm) más el modelo, del orden de 60-70 MB sobre
los 21 MB actuales. Y `whisper-tiny` transcribe con bastantes errores, que
luego se traducen: los fallos se acumulan.

La **lectura en voz alta** sí está, vía `speechSynthesis`: cero bytes, pero
depende de las voces instaladas en el sistema. Ajustes indica cuáles faltan.

## Estructura

```
src/
  lib/
    models.js      registro, rutas entre idiomas, descarga y caché
    languages.js   nombres y etiquetas de voz
    storage.js     persistencia y cuota
    tts.js         síntesis de voz del sistema
    device.js      wake lock y detección de móvil
  hooks/
    useTranslator.js   motor Bergamot y ciclo de vida de la descarga
  components/          ModelGate, LanguagePicker, SettingsSheet, StatusBar
scripts/prepare-assets.mjs   copia el motor y descarga los modelos
```
