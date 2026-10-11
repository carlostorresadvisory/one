# Próxima sesión — ONE v0.3.1: correcciones de Carlos tras probar v0.3 (11-oct-2026)

v0.3 PUBLICADA el 11-oct (main `8287e5f`, Pages `one-v32`, servidor del VPS reconstruido con las claves de Cloudflare). Carlos: «buena primera versión».

## Correcciones pedidas por Carlos (11-oct, 18:28) — planificar antes de ejecutar
1. **Órdago**: quitar la imagen de la ruleta (tarjeta del hub y/o fondo del modo) y poner otra.
2. **Reacciones de la esfinge muy lentas**: el gesto debe empezar al instante (los gestos se descargan bajo demanda desde 97e1914: precargar los más usados — acierto/triste — tras el arranque, o empezar el gesto desde el fotograma de reposo sin esperar).
3. **La esfinge como icono de la app** (iconos/180, 192, 512 y manifest).
4. **Nombre nuevo de la app**: Carlos elige entre 10 propuestas (preferidas: Esfinx, Giza; resto: Ankh, Kefrén, Acerta, Nefer, Órdago, Enigma, Oráculo, Sfinga) tras comprobar que no chocan con apps conocidas.
5. **Muchas imágenes no cargan**: diagnosticar en el iPhone/real (Commons 404 como art-019, CORS del SW, miniaturas sin comprobar por el 429, rutas `/imagenes/` del servidor) con causa demostrada.
6. **Contrarreloj: preguntas más fáciles al principio** (rampa de dificultad: niveles bajos en las primeras y suelo de nivel 3 solo a partir de cierta pregunta; cambiar la spec §5.4 y §4).
7. **Botón PREMIUM «+» en el inicio**: pantalla del plan freemium (precio, crédito para la Tienda, generar preguntas infinitas). Decisión de Carlos: **sin cobro real** en esta versión; «Activar» lo activa gratis para él; el pago (Stripe/Apple) más adelante.

## Estado (11-oct-2026, rama `v0.3-fase-9`, sale de `v0.3-fase-8`)
- **v0.3 está terminada y lista para publicar** en la entrega 1: esfinge v2 con sonido, Órdago, Contrarreloj, fotos con enunciado, Más o menos, Tienda y comodines. Falta solo el OK de Carlos y su push. Publicar publica también las fases 3 a 8. `CACHE` es `one-v32`.
- Suites: 1001 unitarias (`node --test tests/*.test.js`) y 232 e2e (`npx playwright test --workers=1`).
- Fase 10 (generar cifras en el servidor) **pasa a la entrega 2** (decisión de Carlos, 11-oct).

## Decisiones de Carlos del 11-oct (ya en la spec y en el código)
- **Órdago en equilibrio estricto** (spec §5.2): al acertar la ficha vuelve multiplicada y se gana `ceil(ficha × (multiplicador − 1))`; `multiplicador = base(nivel) × (dorada ? 1,5 : 1) × (racha ≥ 3 ? 1,5 : 1)`, base 1,5 / 1,6 / 1,7 para nivel 3 / 4 / 5. Las fichas enseñan la ganancia sin el factor dorada.
- **La dorada se revela después de elegir ficha** (borde y gesto de sorpresa); antes no se ve.
- **Elegir ficha compromete**: `one.ordago` guarda la ronda pendiente (`pendiente: {pregunta, ficha}`); salir con «←», cambiar de vista o recargar antes de responder cuenta como fallo (pierde la ficha, racha a 0), una sola vez. Aviso «Si sales, la pierdes» bajo las fichas.
- **Un fondo nuevo gratis al día** (fecha local, `fondoNuevoDia` en `one.ordago`; los respaldos viejos sin fecha se leen bien). Ya usado: «Vuelve mañana» y, con objetos, «Vender objetos → Tienda». El máximo histórico solo sube jugando.
- **Contrarreloj**: progreso como 10 puntos que se llenan bajo la cabecera (dorados en el doble o nada), con `aria-label` «Pregunta n de 10».
- **Avatar en partida: 100 px fijos.**
- **Fotos offline en caché aparte** (`one-fotos`, `sw.js`): expulsa las más antiguas pasadas de 60 fotos o 3 MB, fuera del techo de 5 MB del núcleo (4,13 MiB medidos) y no se borra al subir `CACHE`. Las propias, las WebP del servidor y las de Commons se guardan (las ajenas se vuelven a pedir con CORS para no guardar respuestas opacas; si el origen lo niega, se enseñan sin guardar).

## Lo que queda de Carlos (a mano)
1. **OK de publicación** y el push: `! git checkout main && git merge --ff-only v0.3-fase-9 && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve `one-v32`.
2. **Sonido en el iPhone** (fase 3): `npm run servir` y abrir `http://192.168.1.137:8765/?depurar=sonido` (iPhone en la wifi `MIWIFI_sHY3`; alternativa Tailscale, PC 100.72.197.51). Capturas del panel con sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` → fase 3.2.
3. **41 imágenes** pendientes de revisar/sustituir.
4. **VPS tras publicar**: `CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` (y `RUNWARE_API_KEY` si la quiere) en `/opt/one/.env` y `docker compose -f servidor/docker-compose.yml up -d --build` (instala `sharp`; ya acepta `nivelObjetivo`). Al marcar imágenes malas, copiar `/opt/one-datos/imagenes-malas.json` a `datos/imagenes-malas.json`.
5. **Puntuación de fotos de las cifras** cuando haya cuota de visión: `node --env-file=.env tools/mejorar-imagenes.js --cifras [--limite N] [--dry-run]` (361 de 480 con foto sin puntuar, 119 sin foto).
6. Prueba en el iPhone: Órdago (¿el equilibrio y el «Si sales, la pierdes» se sienten bien?), Contrarreloj (¿12 → 6 s con foto se puede jugar?, ¿los puntos se leen?), Afinar con fotos, Tienda y comodines.

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
