# Próxima sesión — ONE v0.3: revisar y publicar la fase 5 (Órdago), con las fases 3 y 4 aún sin publicar

## Lo último (11-oct-2026, rama `v0.3-fase-5`, sale de `v0.3-fase-4`)
- **Fase 5 implementada (tareas 5.1-5.4), falta el cierre del controlador**: revisión final con Opus **ejecutando la app** (10 rondas, una dorada, quiebra, fondo nuevo, nivel ≥ 3 siempre, 375×667), adversarial gratis (`delegar.mjs --escalera revisar`) y **OK de Carlos** para publicar.
- Qué hay: `ordago.js` (reglas puras, suelo de nivel 3 en `modos.js#esJugableDificil`), `foto-pregunta.js` (foto protagonista con el enunciado encima), `ordago-ui.js` (pantalla + quiebra), tarjeta Órdago del hub con fondo y minicurva, `nivelObjetivo` de punta a punta (cliente → `/generar` → cola), caché `one-v24`.
- **⚠️ Carlos (prueba en el iPhone):** ¿la foto con el enunciado encima se lee bien?; ¿la dificultad del suelo de nivel 3 es la que quería?; ¿el parón de 350 ms entre paneles (antirrebote) se nota?
- Fase 4 sigue pendiente de OK (esfinge v2; tamaño de la banda 100 px) y la 3 de sonido en el iPhone (ver abajo). Publicar la 5 publica también la 3 y la 4.

## Decisiones tomadas en la fase 5 (para el revisor)
- Tras el último fallo no se salta a la quiebra: se ve el resultado y el botón «Continuar» lleva a la pantalla de quiebra (el fondo ya está guardado en 0; recargar ahí vuelve a la quiebra).
- Antirrebote de 350 ms tras cada cambio de panel (ficha → respuestas → resultado → siguiente): el segundo toque de un doble toque caería sobre el botón nuevo del mismo sitio.
- Cifras con punto de miles desde 4 cifras (`formatearCifra`): `toLocaleString('es-ES')` deja «1000» pegado y los tests piden «1.000».
- Siguiente pregunta: `elegirPreguntaOrdago` (no `siguientePregunta`, que solo sirve nuevas o vencidas y se quedaría sin material); prefiere las nunca jugadas y no repite hasta agotar.
- El servidor **no** aceptaba `nivelObjetivo` en `/generar` (el plan decía que sí): se ha cableado (`servidor/index.js`, `servidor/cola.js`). Hay que **desplegar el servidor** para que lo use; un servidor viejo lo ignora y el cliente descarta igualmente lo de nivel < 3.
- La tarjeta Órdago pasó a `disponible: true` en la 5.3 (no en la 5.4) para que los e2e entren con un clic.
- Banco de ejemplo: 24 preguntas de nivel 3-5, todas las V/F verdaderas y el test4 con la correcta en 0 (convención de `responderPreguntaActual`); Economía ya tiene 5, así que los tests de «pocos elementos» usan Geografía (4). Las 4 fotos de ejemplo van en preguntas de enunciado corto: **límite previo de Clásico**, un test4 con foto y enunciado de 2 líneas desborda 15 px tras responder a 375×667 (no es de la fase 5, queda por arreglar).
- El aviso «Preguntas generadas» tampoco se enseña en la vista `ordago`.

## Siguiente paso
1. Leer `.superpowers/sdd/2026-10-06-one-v0.3-fases-3-10/progress.md` y `git log --oneline -8`.
2. Cierre de la fase 5 (revisión Opus ejecutando, adversarial, OK de Carlos); después, fase 6 (Contrarreloj) en rama `v0.3-fase-6`.
3. **Sonido (3.1 pasos 4-6 → 3.2)**, lo último por decisión de Carlos: `npm run servir` y Carlos abre en el iPhone `http://192.168.1.137:8765/?depurar=sonido`. Si no carga: iPhone en la wifi `MIWIFI_sHY3` (no en datos 5G); alternativa Tailscale (PC 100.72.197.51). Capturas del panel con el interruptor en sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` → 3.2.
4. Antes de las fases 6 y 8: alinear su parte del plan con la spec del 10-oct (fotos de fondo, suelo de nivel 3, Afinar con fotos).

## Aparcado
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar fuera de Órdago; confeti concurrente puede crear dos lienzos.
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (787) y `npx playwright test` (186). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Los e2e de Órdago esperan 450 ms entre paneles por el antirrebote; con varios trabajadores en paralelo el vídeo de la esfinge los vuelve lentos (usar `--workers=1`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva (`one-v24`).
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
