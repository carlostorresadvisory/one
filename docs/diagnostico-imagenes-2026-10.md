# Diagnóstico de imágenes que no cargan (11-oct-2026, rama v0.3.1)

Script: `node tools/diagnostico-imagenes.js` (opciones `--reanudar --conc 1 --pausa 1200` para repetir solo los 429, `--experimento` para el test del 429). Detalle por URL en `tmp/diagnostico-imagenes.json` (no versionado). Medido desde el PC de Carlos (IP 85.86.28.30) con User-Agent de iPhone Safari 18, Referer/Origin de Pages. No se abrió ningún navegador y no se tocó código de la app.

## 1. Cómo resuelve la app la URL (sin transformar nada)

| Origen | Dónde | URL que se pide |
|---|---|---|
| Preguntas del banco (194 de 295) | `app.js:114-123` `imagenDe()` lee `datos/imagenes.json`; `app.js:3332` `img.src = datos.url`; Órdago/Contrarreloj: `foto-pregunta.js:69` | La `url` tal cual. 166 son miniaturas/originales de `upload.wikimedia.org` (142 `960px-`, 24 originales con `?utm_...`), 28 son relativas a Pages (`imagenes-ia/` 24, `imagenes-banco/` 4) |
| Tarjetas Más o Menos (340 de 480 cifras, 285 URL únicas) | `masomenos-ui.js:240` `img.src = cifra.imagen.url` | Commons (318 a 960px, 22 a 500px) |
| Hub (6) | `imagenes-hub.json`, `app.js:4483` | Relativas a Pages (`imagenes-hub/*.webp`) |
| Preguntas `srv-` | `app.js:120-122` | `${servidor}/imagenes/<id>.webp` (ruta pública sin token, `servidor/index.js:792`); no hay datos locales que medir. `/imagenes/x.webp` inexistente da 404 (ruta viva), `/` da 401 |

Todas las `<img>` llevan `referrerPolicy='no-referrer'`. El service worker (`sw.js:80-104` `responderFoto`) intercepta las de `upload.wikimedia.org`: las repite con `mode:'cors'` (Commons devuelve `access-control-allow-origin: *`), y solo guarda las respuestas `ok`.

## 2. Resultado medido (540 usos, 465 URL únicas)

Primera pasada (4 en paralelo, pausa 400 ms): 194 OK, **343 con 429**, 1 con 404, 2 pesadas. Repetida despacio (1 en paralelo, 1,2 s): 

| Clase | Nº URL | Detalle |
|---|---|---|
| OK (200) | 534 de 540 usos | jpeg 458, png 37, webp 41; todas con `access-control-allow-origin: *`; peso medio 236 KB |
| 404 | 1 | `art-019` (espiral áurea): el fichero ya no existe en Commons (la página `File:Fibonacci_Golden_Spiral...png` también da 404) |
| 429 transitorio | 3 | `his-043`, `pc-Q90`, `ao-Q500985`: respondieron 200 con otra pasada |
| Pesadas >2 MB | 2 | cifras `ah-Q179288` (2,43 MB) y `ah-Q570204` (2,16 MB), PNG; otras: `geo-043` 1,6 MB, `his-055` 1,46 MB |
| Tipos no soportados por Safari | 0 | no hay svg/tif/avif/gif |
| Redirecciones | 0 | |
| Propias en Pages (34) | 34 OK | `image/webp`, existen en repo y en Pages; Pages sirve `sw.js` con `one-v32` |
| CORS | 0 fallos | 502 respuestas de Commons con ACAO `*` |

## 3. Causas por orden de impacto

### Causa A (demostrada): Commons responde 429 «Too many requests» a ráfagas, y la app lo trata como imagen rota para siempre
- Evidencia: en la primera pasada 343 de 465 (74 %) dieron 429; el primero a la 7.ª petición. Con `curl` secuencial y sin pausa, 3 de 12 (25 %) dieron 429 con `retry-after: 1` y cuerpo HTML «Wikimedia Error». `--experimento` (25 fotos seguidas, enfriando 70 s entre grupos): 21/25, 20/25 y 20/25 con 429 en las tres variantes de cabeceras, así que NO depende del Referer ni de Origin. El límite es por IP y por ritmo (cada foto pesa 100-400 KB); una red móvil (IP compartida) lo alcanza antes que una fija.
- Código responsable: `sw.js:87` (el 429 es una respuesta y no una excepción, así que no entra al reintento de `sw.js:93`) y `sw.js:99` (no se guarda por no ser `ok`, pero se devuelve igual en `sw.js:104`); el `<img>` recibe `error` y `app.js:3336` / `foto-pregunta.js:71` / `masomenos-ui.js` quitan la imagen sin reintentar. Un 429 de 1 s se convierte en tarjeta sin foto.
- Alcance: afecta a las 166 + 340 fotos de Commons (506 de 540 usos). Cuántas fallan en el iPhone depende de la IP y del ritmo; no se puede medir desde aquí (hace falta el iPhone).
- Corrección propuesta: en `responderFoto`, si `status` es 429 o 5xx, esperar `Retry-After` (≥1 s, máx. 3 intentos con retroceso) antes de devolver; en el cliente, reintentar 1 vez el `<img>` (nuevo `src` con `?r=1`) antes de quitar. A medio plazo, copiar las fotos de Commons a `imagenes-banco/` (ya propias en Pages, sin límite), empezando por las 166 del banco (~35 MB) o solo las de las preguntas que salen más.

### Causa B (demostrada): 101 de 295 preguntas (34 %) no tienen entrada en `datos/imagenes.json`
- Por área sin foto: economía 29/43, lógica 16/24, tecnología 15/27, ciencia 13/35, filosofía 12/42, arte 7/48, geografía 7/34, historia 2/42. Y 140 de 480 cifras sin foto (`PROXIMA-SESION.md`: 119 + las 22 sin puntuar). No es un fallo de carga: nunca se pide imagen. Se ve como «imagen que no carga» si Carlos espera foto.
- Corrección: lote de `tools/buscar-imagenes.js` / IA para economía, lógica y tecnología (los huecos mayores).

### Causa C (demostrada, 1 caso): `art-019` apunta a un fichero borrado de Commons (404)
- `datos/imagenes.json`, clave `art-019`. Corrección: sustituir con `tools/mejorar-imagenes.js` o ponerla a nula. Una comprobación periódica de HEAD/GET lenta (este script con `--reanudar`) lo detectaría.

### Causa D (probable, no medida en iPhone): peso y caché pequeña
- Caché de fotos acotada a 3 MB (`sw.js:57`, `acotarFotos` `sw.js:68`): con ~236 KB de media caben unas 12 fotos; el resto se vuelve a pedir y vuelve a exponerse a la causa A. 4 PNG de 1,2-2,4 MB en 4G tardan segundos. Corrección: pedir `500px-` en lugar de `960px-` en las miniaturas (la pantalla del iPhone a 3x son 1290 px de ancho, pero la foto se recorta con `cover`), o convertir las PNG pesadas a WebP en `imagenes-banco/`; subir el tope de `one-fotos` a 8-10 MB.

### Descartado con datos
- 404 masivos, tipos no soportados por Safari (svg/tif/avif), CORS ausente, redirecciones, rutas propias rotas en Pages, ruta `/imagenes/` del servidor (404 en inexistente, no 401), diferencia por Referer/Origin, versión de `sw.js` en Pages (`one-v32`).

## 4. Comportamiento del service worker con imágenes ajenas
1. Con copia en `one-fotos` se devuelve (`sw.js:83`).
2. Si no, `fetch(url, {mode:'cors'})` (`sw.js:87`). Respuesta ok y no opaca: se guarda.
3. Solo si el fetch lanza excepción (red caída o CORS denegado) se repite sin CORS y se enseña opaca (`sw.js:93`). Un 4xx/5xx NO dispara este reintento: se devuelve tal cual y la `<img>` falla.
4. Sin ninguna respuesta: `503` de texto (la `<img>` falla).
5. En el cliente siempre hay `error` → se quita la imagen y queda el color del área (no se rompe la tarjeta, pero tampoco se reintenta).

## 5. Qué falta por medir (necesita el iPhone)
- Cuántas fallan en su red móvil real y en qué orden. Propuesta: tras aplicar el reintento, anotar en `localStorage` los `error` de imagen con su URL y estado (el `<img>` no da el estado; sí lo daría el SW con un `postMessage`).
