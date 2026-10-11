# Próxima sesión — ONE v0.3: revisar y publicar las fases 5 (Órdago), 6 (Contrarreloj) y 7 (imágenes), con la 3 y la 4 aún sin publicar

## Lo último (11-oct-2026, rama `v0.3-fase-7`, sale de `v0.3-fase-6`)
- **Fase 7 (imágenes con impacto) implementada (7.1-7.7), falta el cierre del controlador**: revisión final con Opus **ejecutando la app** (fotos y créditos en Clásico/Repaso/Órdago/Contrarreloj, color del área cuando no hay foto, botón «Imagen mala», tarjetas del hub con foto), adversarial gratis (`delegar.mjs --escalera revisar`) y **OK de Carlos** para publicar. Publicar la 7 publica también la 3, la 4, la 5 y la 6.
- Qué hay: nota de imagen con modelo de visión (`tools/nota-imagen.js`), bancos libres Openverse/Met/AIC/NASA (`tools/bancos-libres.js`), imagen IA de último recurso (`servidor/imagen-ia.js`, Cloudflare FLUX schnell, WebP ≤80 KB, cupo 100/día y tope 0,10 €/día, Runware solo en código), lote reanudable `tools/mejorar-imagenes.js`, imagen en las preguntas generadas (`servidor/imagenes.js`), la app solo enseña foto real, color del área o una fórmula dibujada (se acabó la tarjeta tipográfica y los gráficos), crédito real (`Fuente · Autor · Licencia` o «Imagen generada con IA»), botón «Imagen mala» (`one.imagenesMalas`, en el respaldo) y las 6 tarjetas del hub con foto puntuada (`imagenes-hub/`, `datos/imagenes-hub.json`). Caché `one-v27`: las fotos se guardan al verlas (tope de 256 KB en total, por bytes), no se precachean.
- **Lote del banco (pasada 1)**: muestra de 1 de cada 3 preguntas por tiempo (límite de ~11 llamadas de visión/min): 118 puntuadas, 39 mantenidas y 79 sustituidas (47 de IA, 24 Commons, 7 Openverse, 1 Met), 8 sin puntuar; gasto de IA 0 € (49 imágenes hoy de 100). Quedan ~170 preguntas sin tocar: `node --env-file=.env tools/mejorar-imagenes.js --continuar` (varias pasadas o días; las que quedan con foto mediocre se marcan `pendienteMejora`).
- **⚠️ Carlos:** (1) OK para publicar; (2) **desplegar el servidor**: poner `CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` (y `RUNWARE_API_KEY` si la quieres) en `/opt/one/.env` del VPS y `docker compose -f servidor/docker-compose.yml up -d --build` (instala `sharp`); sin eso el servidor viejo sigue mandando `visual` y la app lo ignora; (3) prueba en el iPhone: ¿las fotos tienen impacto?, ¿se leen los créditos?, ¿«Imagen mala» sustituye la foto?; (4) cuando marques imágenes malas, copia `/opt/one-datos/imagenes-malas.json` a `datos/imagenes-malas.json` para que el lote las sustituya.
- Fase 6 sigue pendiente de su cierre (abajo); fase 4 de OK (esfinge v2; banda 100 px) y la 3 de sonido en el iPhone.

## Decisiones tomadas en la fase 7 (para el revisor)
- Visión: Gemini flash-lite / 3.6-flash primero (no hay clave de OpenRouter); concurrencia 2 y reintento a los 20 s por el 429. Las imágenes de bancos distintos de Commons y las de IA se guardan como WebP en `imagenes-banco/` e `imagenes-ia/`; las de Commons siguen por URL.
- Muestra 1/3 en vez de lote completo (ver arriba); el comando completo sigue documentado.
- Se retiran la tarjeta tipográfica y los visuales dibujados; solo se dibuja una fórmula de matemáticas/ciencia (`esVisualImprescindible`). El código de dibujo de `visuales.js` sigue vivo por la fórmula: candidato a limpieza.
- «Imagen mala» no reporta la pregunta al servidor como mala: manda `motivo: 'imagen-mala'` y el servidor quita la imagen, la deja pendiente y no vuelve a elegirla (`imagenesDescartadas`).
- Ruta pública `GET /imagenes/<id>.webp` (sin token): son fotos libres o ilustraciones sin datos personales.
- El color del área (sin foto) es el último en ceder en la cascada de la tarjeta revelada (`tarjeta--zona-color-baja`, suelo del 35 % en vez del 50 %): sin la tarjeta tipográfica, la línea «Respuesta» vuelve a verse y a 375×667 con un «Combo» desbordaba 15 px. Con foto el 50 % sigue fijo.
- Flake conocido: el e2e «Órdago · doble toque en la ficha» falló una vez bajo carga y pasa aislado.
- Los `avisos` de `validar-banco` por imagen de IA sin título ni página (94) son esperados.


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
2. Cierres pendientes de las fases 5, 6 y 7 (revisión Opus ejecutando, adversarial, OK de Carlos); después, fase 8 en rama nueva que sale de la 7.
3. **Sonido (3.1 pasos 4-6 → 3.2)**, lo último por decisión de Carlos: `npm run servir` y Carlos abre en el iPhone `http://192.168.1.137:8765/?depurar=sonido`. Si no carga: iPhone en la wifi `MIWIFI_sHY3` (no en datos 5G); alternativa Tailscale (PC 100.72.197.51). Capturas del panel con el interruptor en sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` → 3.2.
4. Antes de la fase 8: alinear su parte del plan con la spec del 10-oct (fotos de fondo, suelo de nivel 3, Afinar con fotos).

## Aparcado
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar fuera de Órdago; confeti concurrente puede crear dos lienzos.
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (836) y `npx playwright test` (187). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Los e2e de Órdago esperan 450 ms entre paneles por el antirrebote; con varios trabajadores en paralelo el vídeo de la esfinge los vuelve lentos (usar `--workers=1`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva (`one-v27`).
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
