# Próxima sesión — ONE v0.3: revisar maquetas con Carlos y ejecutar el plan de las fases 3-10

## Lo último (10-oct-2026, mediodía)
- **Maquetas revisadas por Carlos en el iPhone** (rama `diseno-secciones`, `prototipos/secciones/index.html`, commit `4309f1b`). Decidido: **imagen de Commons de fondo con la pregunta encima** (sombra abajo); **ninguna tarjeta grande con emoji**, siempre foto; **Afinar con fotos a escala real** (alto proporcional a la cifra; la de la estimación crece con el deslizador); **preguntas difíciles** (ejemplos en la maqueta). Duda «hueco en Contrarreloj» resuelta: lo llena la foto. **Sin decidir**: salvavidas magenta (¿icono propio?), resplandores, avatar de 100 px, y las 3 asunciones del plan (abajo). **Nada de esto está aún en la spec**: llevarlo antes de construir, con adversarial.
- **Esfinge v2 hecha, pendiente de que Carlos la vea en el iPhone** (plan `docs/superpowers/plans/2026-10-10-esfinge-interpolada.md`). `prototipos/avatares/esfinge-v2/`: reposo en bucle (2,1 s) + 7 gestos (saludo, pensando, sorpresa, triste, acierto, euforia, guiño), todos salen del ancla N (A8.17) y vuelven a ella hacia delante; uniones inventadas por RIFE (`rife-ncnn-vulkan` en `%LOCALAPPDATA%\rife-ncnn-vulkan\`, modelo `rife-v4.6`), sin fundidos; 64 fps de la fuente marcados a 60 (cada fotograma se ve una vez); alfa propio por croma verde; `player.js` cambia de clip solo en puntos de salida del reposo (espera máx. ~2 s). Se monta con `cd tools/esfinge && python clips.py [gesto]` (lee `gestos.txt`; deja tiras de cada unión en `tiras/` e `informe.json`); juez gratis `node juez.mjs tiras/*.jpg` (`openrouter/free`; acierta el control malo pero da falsos positivos en el cambio de fila de la tira: es primer filtro, no veredicto).
- **Límites del material** (decir a Carlos): RIFE no sabe mover la pata lejos (la disuelve), así que la pata solo se mueve con fotogramas reales. Por eso **«pensando» empieza con un saludo** (en el vídeo B nunca se piensa desde el reposo) y el **saludo incluye el gesto de pensar** antes de bajar la pata (es el único camino real de vuelta). El **triste entra por la sorpresa de A** (las orejas salen de verdad) y enlaza con el triste de B. Si Carlos quiere un «pensando» sin saludo, haría falta un vídeo nuevo (Wan first-last-frame: neutro → pata en la barbilla).
- Descartado: montaje con fundidos (`esfinge-candidatas/personaje.mp4`), triste de ONE con fundido FILM.

## Dónde estamos (6-oct-2026, noche)
- **Publicado**: v0.3 fases 1-2 (caché `one-v21`) + prototipo de avatares en `https://carlostorresadvisory.github.io/one/prototipos/avatares/`.
- **Spec aprobada**: `docs/superpowers/specs/2026-10-05-one-v0.3-tres-modos-design.md`.
- **Plan escrito y revisado** (adversarial Nemotron gratis: 4 aplicadas, 5 ya cubiertas): `docs/superpowers/plans/2026-10-06-one-v0.3-fases-3-10.md`. Una rama por fase (`v0.3-fase-3`, …), commit por tarea, publicación con OK de Carlos. **Sin ejecutar todavía.**
- Esfinge definitiva: `prototipos/avatares/esfinge-mp4/` (4 MP4 stacked alpha + `player.js`); la fase 4 la lleva a `avatar.js`. Las animaciones se mejoran otro día: no reabrir.

## Decisiones de Carlos del 6-oct (ya en spec y plan)
- **Órdago no da objetos**: lo que se gana es el fondo, dinero canjeable en la Tienda. Superar el máximo solo se celebra.
- Tarjeta = modo, sin Comenzar; modos sin hacer → tarjeta apagada «Pronto». «Tienda», «Órdago», insignia PREMIUM sin bloquear, aviso grande «Preguntas generadas» clicable.
- Imágenes con impacto, nunca esquemas; IA (Cloudflare FLUX gratis, cupo 100/día; Runware de respaldo dentro de 0,10 €/día) solo como último recurso.

## Asunciones del plan pendientes de confirmar con Carlos (preguntar al empezar)
1. El `nivel` del multiplicador de Órdago es el nivel de la pregunta (1-5).
2. La tarjeta Tienda abre ya en la fase 3 una Tienda mínima con la mochila; en el hub la esfinge animada vive en esa tarjeta y la cabecera no lleva otra (un reproductor por pantalla).
3. `sharp` en `servidor/`/`tools/` para el WebP de IA (fase 7): Carlos hará `npm install` en el VPS y pondrá `CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en su `.env`.

## Siguiente paso
0a. **Esfinge v2**: Carlos la abre en el iPhone (`npm run servir`, `http://192.168.1.137:8765/prototipos/avatares/esfinge-v2/index.html`) y dice qué uniones nota; se retoca con `clips.py` y, cuando la apruebe, la fase 4 la lleva a `avatar.js` (sustituye a `esfinge-mp4/`).
0b. Cerrar las 3 dudas de las maquetas, pasar lo decidido a la spec v0.3 con adversarial.
1. Confirmar las 3 asunciones con Carlos.
2. Fase 3 con `superpowers:subagent-driven-development` (implementador y revisor Sonnet, re-revisión Haiku; cierre con Opus ejecutando la app + adversarial `delegar.mjs --escalera revisar`). Empieza por la Tarea 3.1: panel `?depurar=sonido` y **Carlos lo abre en su iPhone** por la red local (`npm run servir`, IP con `ipconfig`) y manda capturas; sin causa demostrada no se toca el sonido.
3. Fases 4 → 10 en orden, una sesión por fase si el contexto pasa de 250k.

## Aparcado de fases 1-2
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos; `esfinge.js` usa el `document` global (desaparece en la fase 4).
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (725) y `npx playwright test` (155). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
