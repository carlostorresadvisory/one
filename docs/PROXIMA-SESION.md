# Próxima sesión — Esfinx (antes ONE) tras v0.3.2 (12-oct-2026)

**v0.3.1 PUBLICADA** el 12-oct (main `ed424c3`, Pages `one-v33`; 426/426 fotos de los datos publicados dan 200 en Pages; servidor sin cambios).

## Estado (12-oct-2026, 11:10)
- **Publicado** (main `0ae2d3c`, Pages `one-v34`): v0.3.1 (las 7 correcciones) + v0.3.2 (botón «Saber +» con ChatGPT/Claude/Gemini en todos los modos, descrito en la spec v0.3 §4) + 223 imágenes nuevas.
- **Regla de Carlos: ninguna pregunta sin imagen**, solo fuentes gratis o hiperbaratas (no generadores de pago). Quedan **9 preguntas** (art-082, cie-090, eco-083, eco-091, fil-055, log-013, log-042, tec-015, tec-053) y **2 cifras** (ah-Q244356, ah-Q203681). Completar tras las 00:00 UTC: `node --env-file=.env tools/rellenar-imagenes.js --que ambas --flux --liston 3 --reintentar --juez google/gemini-2.5-flash-lite --tope-usd 0.30` (Cloudflare gratis; Space FLUX.1-schnell de HF anónimo con cupo diario). Luego validar (`tools/validar-banco.js`, `tools/diagnostico-imagenes.js --local`, unitarios) y `git push origin v0.3.1:main` (Carlos autorizó «publica tú»).
- **Carlos debe revisar a ojo** las imágenes con `revisar: true` (≈ 77: galerías con nota 3 e IA que no llegó a 4) y la tanda de arte.
- Cupo de Cloudflare: lo agota nuestro propio relleno (~61 imágenes con reintentos); el VPS comparte cuenta si lleva `CLOUDFLARE_AI_TOKEN` (sin comprobar).
- Perchance descartado para automatizar: sin API, solo su web. Runware sin clave.
- Gasto OpenRouter del juez barato en este lote: ~0,28 $ (mes ~0,42 $ de 5 $).
- Fase 10 (generar cifras en el servidor) pasa a la entrega 2.

## Decisiones de Carlos del 11-oct (ya en la spec y en el código)
- **Órdago en equilibrio estricto** (spec §5.2): al acertar la ficha vuelve multiplicada y se gana `ceil(ficha × (multiplicador − 1))`; `multiplicador = base(nivel) × (dorada ? 1,5 : 1) × (racha ≥ 3 ? 1,5 : 1)`, base 1,5 / 1,6 / 1,7 para nivel 3 / 4 / 5. Las fichas enseñan la ganancia sin el factor dorada.
- **La dorada se revela después de elegir ficha** (borde y gesto de sorpresa); antes no se ve.
- **Elegir ficha compromete**: `one.ordago` guarda la ronda pendiente (`pendiente: {pregunta, ficha}`); salir con «←», cambiar de vista o recargar antes de responder cuenta como fallo (pierde la ficha, racha a 0), una sola vez. Aviso «Si sales, la pierdes» bajo las fichas.
- **Un fondo nuevo gratis al día** (fecha local, `fondoNuevoDia` en `one.ordago`; los respaldos viejos sin fecha se leen bien). Ya usado: «Vuelve mañana» y, con objetos, «Vender objetos → Tienda». El máximo histórico solo sube jugando.
- **Contrarreloj**: progreso como 10 puntos que se llenan bajo la cabecera (dorados en el doble o nada), con `aria-label` «Pregunta n de 10».
- **Avatar en partida: 100 px fijos.**
- **Fotos offline en caché aparte** (`one-fotos`, `sw.js`): expulsa las más antiguas pasadas de 120 fotos u 8 MB, fuera del techo de 5 MB del núcleo (4,13 MiB medidos) y no se borra al subir `CACHE`. Las propias, las WebP del servidor y las de Commons se guardan (las ajenas se vuelven a pedir con CORS para no guardar respuestas opacas; si el origen lo niega, se enseñan sin guardar).

## Lo que queda de Carlos (a mano)
1. **Probar en el iPhone**: la esfinge al instante (acierto y triste), el icono nuevo (hay que borrar y volver a añadir la app a la pantalla de inicio), Premium («+», Activar, +1.000 en la Tienda) y la rampa de Contrarreloj; una partida de Afinar y de Más o menos para ver que las imágenes cargan.
3. **EUIPO para Esfinx** (clases 9 y 41) antes de la App Store.
4. **Sonido en el iPhone** (fase 3): `npm run servir` y abrir `http://192.168.1.137:8765/?depurar=sonido` (iPhone en la wifi `MIWIFI_sHY3`; alternativa Tailscale, PC 100.72.197.51). Capturas del panel con sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` → fase 3.2.
5. **VPS tras publicar**: `CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` (y `RUNWARE_API_KEY` si la quiere) en `/opt/one/.env` y `docker compose -f servidor/docker-compose.yml up -d --build` (instala `sharp`; ya acepta `nivelObjetivo`). Al marcar imágenes malas, copiar `/opt/one-datos/imagenes-malas.json` a `datos/imagenes-malas.json`.
6. **Huecos de imágenes**: las preguntas sin imagen que no cupieron en el cupo gratis del día, y la puntuación de fotos de las cifras cuando haya cuota de visión: `node --env-file=.env tools/mejorar-imagenes.js --cifras [--limite N] [--dry-run]`.

## Notas para el revisor
- Salvavidas: 50/50 y +5 s se descuentan al usarlos; el Salvavidas queda armado y solo se descuenta si perdona un fallo. En Órdago, `resolverRonda({ salvavidas: true })`; una ronda abandonada se resuelve sin Salvavidas (no se gasta).
- Quiebra → «Vender objetos → Tienda» destruye la ronda y abre la Tienda; «←» vuelve al hub y Órdago retoma el fondo que quede.
- Antirrebote de 350 ms en todas las rondas (los e2e esperan 450). Los e2e con reloj falso usan `page.clock.fastForward`.
- Flakes conocidos (pasan aislados): «Órdago · doble toque en la ficha», «avatar · acertar pide el gesto», «Termópilas» (carga), y por pareja al azar «Afinar: clavar…» y «Afinar con fechas».
- Aparcado: límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar fuera de Órdago; confeti concurrente puede crear dos lienzos; importar el mismo respaldo dos veces no avisa; flakes de servidor en Windows (`servidor-cola.test.js` EPERM, `servidor-generacion.test.js:1150`).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Escaleras de `delegar.mjs`: `qwen3.8-27b:free` ya no existe (sustituido por `thinkingmachines/inkling-small:free`); Groq rechaza contextos > 8k tokens/min; para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
