# Próxima sesión — ONE v0.3: revisar y publicar las fases 5 (Órdago) y 6 (Contrarreloj), con la 3 y la 4 aún sin publicar

## Lo último (11-oct-2026, rama `v0.3-fase-6`, sale de `v0.3-fase-5`)
- **Fase 6 implementada (tareas 6.1-6.3), falta el cierre del controlador**: revisión final con Opus **ejecutando la app** (series de 10, caída por fallo y por tiempo, cofre, doble o nada, segundo plano, 375×667), adversarial gratis (`delegar.mjs --escalera revisar`) y **OK de Carlos** para publicar. Publicar la 6 publica también la 3, la 4 y la 5.
- Qué hay: `contrarreloj.js` (reglas puras, récords en `one.contrarreloj`, respaldo v3), `contrarreloj-ui.js` (pantalla, «Has caído» y cofre), tarjeta del hub con la marca («Sin marca», `7/10`, `Doble ×N`), aviso de «menos de 10» con Generar PREMIUM (`nivelObjetivo` 4), caché `one-v25`.
- **⚠️ Carlos (prueba en el iPhone):** ¿12 → 6 s con la foto debajo del enunciado se puede jugar?; ¿el cofre y el doble o nada enganchan?; y lo ya anotado de la fase 5: ¿la foto con el enunciado se lee bien?, ¿el suelo de nivel 3 es la dificultad que quería?, ¿se nota el parón de 350 ms?
- Fase 4 sigue pendiente de OK (esfinge v2; tamaño de la banda 100 px) y la 3 de sonido en el iPhone (ver abajo).

## Decisiones tomadas en la fase 6 (para el revisor)
- «Corta» se mide con el canvas del navegador (`app.js#medirTextoReal`, negrita 20 px el enunciado y 16 px la opción), no con `medirAncho`: esa estimación es conservadora y descartaba 2 de cada 3 válidas (13 de 120 de nivel 3-5 frente a 31). En node (tests) sigue el estimador. Constantes medidas a 390 px: enunciado 328 px útiles menos ~8 % por el salto de palabra = 300; opción 330. **Aun así solo ~27-31 preguntas del banco real son jugables en Contrarreloj**: con filtro de área casi siempre saldrá el aviso de «menos de 10»; conviene generar tandas (nivel 4) y cortas.
- Un tiempo agotado no es una respuesta: cae, pero no pasa por `registrarRespuesta` (no ensucia el radar). Fallo con respuesta sí.
- Acierto: pausa de 450 ms (el reloj no corre) para ver el destello; antirrebote de 350 ms al empezar serie, «Volver a empezar» y botones del cofre.
- Los objetos pasan a la mochila solo al «Plantarse» o «Recoger» (la serie no se guarda); recargar en el cofre lo pierde. Tras «Plantarse»/«Recoger» se vuelve al hub y las tarjetas ignoran toques 400 ms (el segundo toque de un doble toque caía sobre una tarjeta).
- Las vistas `contrarreloj`, `caida` y `cofre` no enseñan el aviso «Preguntas generadas».
- Comodines (50/50, salvavidas, +5 s) no se usan todavía en Contrarreloj: llegan en la fase 9 (la regla `responder({salvavidas})` ya existe).
- Los e2e con reloj falso usan `page.clock.fastForward` (el reloj es por tiempo transcurrido): `runFor` pinta cientos de fotogramas del avatar y tarda 20 s.

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
2. Cierres pendientes de las fases 5 y 6 (revisión Opus ejecutando, adversarial, OK de Carlos); después, fase 7 (imágenes) en rama `v0.3-fase-7`, que sale de la 6.
3. **Sonido (3.1 pasos 4-6 → 3.2)**, lo último por decisión de Carlos: `npm run servir` y Carlos abre en el iPhone `http://192.168.1.137:8765/?depurar=sonido`. Si no carga: iPhone en la wifi `MIWIFI_sHY3` (no en datos 5G); alternativa Tailscale (PC 100.72.197.51). Capturas del panel con el interruptor en sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` → 3.2.
4. Antes de la fase 8: alinear su parte del plan con la spec del 10-oct (fotos de fondo, suelo de nivel 3, Afinar con fotos).

## Aparcado
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar fuera de Órdago; confeti concurrente puede crear dos lienzos.
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (803) y `npx playwright test` (200). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Los e2e de Órdago esperan 450 ms entre paneles por el antirrebote; con varios trabajadores en paralelo el vídeo de la esfinge los vuelve lentos (usar `--workers=1`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva (`one-v25`).
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
