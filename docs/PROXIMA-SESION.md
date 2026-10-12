# Próxima sesión — Esfinx (antes ONE) tras v0.3.3 (12-oct-2026)

**v0.3.3 PUBLICADA** el 12-oct (main `88f495a`, Pages `one-v36`): Tienda ampliada (Saltar, Segunda oportunidad, Escudo de racha, Cofre, 5 Títulos; spec v0.3 §6; plan `docs/superpowers/plans/2026-10-12-esfinx-v0.3.3-tienda.md`) y esfinge a 100 px en Tienda y Premium. Comprobado en Pages: sin scroll a 375 × 667, sin errores.

## v0.3.4 en curso (plan `docs/superpowers/plans/2026-10-12-esfinx-v0.3.4-tandas.md`)
- **A** PUBLICADO (main `efe267c`, Pages `one-v37`): fila «Tus temas» en el hub y «Generados» en el filtro; clave nueva `one.etiquetasRutas` (en el respaldo). Adversarial de Nemotron: 2 hallazgos, ambos falsos.
- **B** PUBLICADO (main `7616e15`, Pages `one-v38`) y servidor DESPLEGADO en el VPS (19:13, `/opt/one` en `7616e15` desacoplado, solo se recreó `servidor-one-servidor-1`, coordinado con E- ELOY y CRM). Prueba real: n=7 → 400; tanda de 10 (Geografía · Volcanes) «lista» en ~9 min con **5 aprobadas de 10** (el verificador rechaza ~50 %: «10» rinde 5-7 preguntas; valorar pedir de más hasta llegar a n). Ojo: en el servidor «parcial» = en marcha con alguna lista, no final.
- **C** PUBLICADO (main `9df1e14`, Pages `one-v39`) y servidor DESPLEGADO (20:25, `/opt/one` en `9df1e14`; claves VAPID generadas en el VPS y añadidas a `/opt/one/.env`, copia previa `.env.bak-vapid`; `/vapid` activa). Falta la prueba real de Carlos en el iPhone con la app instalada (punto 9). Adversarial de Nemotron: 3 hallazgos (1 falso, 2 asumidos: el cuerpo está limitado a 64 KB y 5 dispositivos por tanda; se marca avisado antes de enviar para no duplicar).
- Notificación probada por Carlos en el iPhone (12-oct ~21:00): llega. Su tanda dio 2 de 10 y sin imágenes → v0.3.5.
- **v0.3.5 PUBLICADA** (main `a3b084d`, Pages `one-v40`) y DESPLEGADA (21:56, `/opt/one` en `a3b084d`, coordinado con E- ELOY y CRM): tanda de n acaba con n APROBADAS (tope 3·n); imágenes pendientes no se rinden (IA de último recurso, reintento a las 6 h, migración de las viejas); dentro de cada área se sirven antes las que tienen imagen; pregunta `srv-` sin imagen pinta su `visual` en Clásico/Repaso; prompts de «ordenar» y test4 (índice desde 0) corregidos. Adversarial de Nemotron: 3 hallazgos, todos falsos (`finally` libera el indicador; Node de un hilo; ids únicos).
- **Relleno del colchón**: 836 de 872 sin imagen (249 con `visual`). Script: en el VPS, `docker compose -f servidor/docker-compose.yml stop one-servidor`, `... run --rm --no-deps one-servidor node tools/rellenar-colchon.js --datos /datos-servidor --limite N --lote 10` (`--dry-run` solo cuenta), y `start one-servidor`. El servidor también rellena 10 por pasada él solo.
- Ritmo medido 12-oct 22:23 → 23:43 (temporizador cada 15 min, `fda8cac`): **0 imágenes nuevas** (36/836 igual; 6 «esperando a mañana por falta de IA»). Sin llamadas a modelos desde 21:35: las galerías no encuentran nada para temas abstractos y la IA de Cloudflare no tiene cupo hasta las 00:00 UTC (la misma cuenta la gastó el relleno local). Re-medir tras las 02:00; si sigue ~0, mirar con trazas cuántas preguntas toca cada pasada y por qué rama sale cada una.
- e2e «tanda de 10 con 10 aciertos (375×667)» falla también en la base (tarjeta 3 px más alta con el banco real): revisar junto con «Comparar con fechas».
- **D** hecho y fusionado (`8c3dd50`): `HF_TOKEN` en `.env` (verificado, genera imágenes); Pollinations descartado (marca de agua, API de pago), Pexels sin claves nuevas, Pixabay prohíbe peticiones automáticas. Queda por borrar el worktree `.claude/worktrees/v0.3.4d` (el borrado lo bloqueó el clasificador por el `.env` de dentro: lo borra Carlos o se aprueba).
- **B** (tandas de 10 o 100, Premium) tras A; **C** (Web Push al iPhone) tras B: el despliegue en el VPS se confirma con Carlos.
- El token de HF se mandó a la sesión E- ELOY (dueña del cazador), a petición de Carlos.

## Fluidez de la esfinge (abierto)
- Carlos ve a pocos fps la esfinge en los modos, en los gestos y el confeti (iPhone, sin ahorro de batería). Causa probable: `texImage2D` de un vídeo 480×960 a WebGL en cada fotograma es lento en Safari iOS (WebKit bug 216250). Con gráfica por software: entero 41 fps, a mitad 61 fps.
- Medidor publicado: `https://carlostorresadvisory.github.io/one/?depurar=fps` y `…&subida=media` (`depurar-fps.js`). **Esperando capturas de Carlos**. Si la mitad va mejor: reescalar los clips de `avatar/` (p. ej. 320×640) con ffmpeg y comprobar la tarjeta del hub.
- e2e «Comparar con fechas» (`tests/e2e.spec.js` ~7706) falla también en `v0.3.1`: espera 0 tarjetas sin foto y ve 2 (datos de imágenes de cifras); revisar la prueba.

## Estado (12-oct-2026, 11:10)
- **Publicado** (main `0ae2d3c`, Pages `one-v34`): v0.3.1 (las 7 correcciones) + v0.3.2 (botón «Saber +» con ChatGPT/Claude/Gemini en todos los modos, descrito en la spec v0.3 §4) + 223 imágenes nuevas.
- **Regla de Carlos: ninguna pregunta sin imagen**, solo fuentes gratis o hiperbaratas (no generadores de pago). Quedan **9 preguntas** (art-082, cie-090, eco-083, eco-091, fil-055, log-013, log-042, tec-015, tec-053) y **2 cifras** (ah-Q244356, ah-Q203681). Completar tras las 00:00 UTC: `node --env-file=.env tools/rellenar-imagenes.js --que ambas --flux --liston 3 --reintentar --juez google/gemini-2.5-flash-lite --tope-usd 0.30` (Cloudflare gratis; Space FLUX.1-schnell de HF anónimo con cupo diario). Luego validar (`tools/validar-banco.js`, `tools/diagnostico-imagenes.js --local`, unitarios) y `git push origin v0.3.1:main` (Carlos autorizó «publica tú»).
- **Carlos debe revisar a ojo** las imágenes con `revisar: true` (≈ 77: galerías con nota 3 e IA que no llegó a 4) y la tanda de arte.
- Cupo de Cloudflare (comprobado el 12-oct, solo lectura): el VPS usa la **misma cuenta** (`CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en `/opt/one/.env`), pero solo genera imágenes a demanda de las tandas pedidas (2 hoy, 11 en total en `/opt/one-datos/imagenes`); no hay trabajo de fondo ni cron. El cupo lo agota nuestro relleno local (~60 al día). El Space FLUX de Hugging Face anónimo también se agota (ZeroGPU sin segundos el 12-oct a las 09:20 UTC).
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
