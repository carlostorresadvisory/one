# Próxima sesión — ONE v0.3: revisar maquetas con Carlos y ejecutar el plan de las fases 3-10

## Lo último (10-oct-2026, mediodía)
- **Maquetas revisadas por Carlos en el iPhone** (rama `diseno-secciones`, `prototipos/secciones/index.html`, commit `4309f1b`). Decidido: **imagen de Commons de fondo con la pregunta encima** (sombra abajo); **ninguna tarjeta grande con emoji**, siempre foto; **Afinar con fotos a escala real** (alto proporcional a la cifra; la de la estimación crece con el deslizador); **preguntas difíciles** (ejemplos en la maqueta). Duda «hueco en Contrarreloj» resuelta: lo llena la foto. **Sin decidir**: salvavidas magenta (¿icono propio?), resplandores, avatar de 100 px, y las 3 asunciones del plan (abajo). **Nada de esto está aún en la spec**: llevarlo antes de construir, con adversarial.
- **Esfinge v2 hecha, pendiente de que Carlos la vea en el iPhone** (plan `docs/superpowers/plans/2026-10-10-esfinge-interpolada.md`). `prototipos/avatares/esfinge-v2/`: reposo en bucle (2,1 s) + 6 gestos (saludo, pensando, sorpresa, triste, acierto, euforia; guiño quitado por Carlos: sin uso), todos salen del ancla N (A8.17) y vuelven a ella hacia delante; uniones inventadas por RIFE (`rife-ncnn-vulkan` en `%LOCALAPPDATA%\rife-ncnn-vulkan\`, modelo `rife-v4.6`), sin fundidos; 64 fps de la fuente marcados a 60 (cada fotograma se ve una vez); alfa propio por croma verde; `player.js` cambia de clip solo en puntos de salida del reposo (espera máx. ~2 s). Se monta con `cd tools/esfinge && python clips.py [gesto]` (lee `gestos.txt`; deja tiras de cada unión en `tiras/` e `informe.json`); juez gratis `node juez.mjs tiras/*.jpg` (`openrouter/free`; acierta el control malo pero da falsos positivos en el cambio de fila de la tira: es primer filtro, no veredicto).
- **Revisión de Carlos (10-oct, tarde)**: acierto y euforia bien; guiño fuera (sin uso). Saludo y pensando tienen que ser distintos y solo «sube la pata, gesto, vuelve al reposo»: RIFE no sabe mover la pata lejos (la disuelve), así que se hacen como las candidatas que Carlos dio por buenas, bajando la pata por el mismo camino (saludo B0,0-1,2 y vuelta; pensando B9,8→8,6 y vuelta). Sorpresa: entrada A2,34-2,48, el «¡oh!» A2,86-3,12 a ¼ de velocidad con RIFE, salida antes de que arranque la euforia. Triste: sin la mueca (era el ojo entrecerrado de A2,58-2,81); entra por las orejas de A y enlaza con el triste de B3,88. Segunda revisión: quitar la «mueca de sonreír» del arranque. Sorpresa y triste ya no entran por la sonrisa del final del acierto: las orejas crecen con la recogida de orejas de A al revés (A3,20→2,90). Saludo: en B el entrecerrar de ojos y la subida de la pata van juntos (B0,25-0,48); arrancar en 0,48 hace que la pata aparezca por fundido, así que arranca en 0,40 con algo de entrecerrado. Tercera revisión de Carlos (10-oct, 16:15): **saludo, acierto y euforia bien**. Por hacer:
  - **Pensando**: sonríe al final y se nota el boomerang (sube y baja por el mismo camino). Probar: subida = B9,8→8,6 al revés, mantener la pata en la barbilla con un tramo a cámara lenta (`B~`), y bajada por un camino real distinto (B9,0→9,7 hacia delante tras el salto barbilla-barbilla B2,41→B8,89 que ya salió limpio); cortar antes de la sonrisa del final (mirar B9,4-9,8 en hoja fina).
  - **Sorpresa**: todavía muy corta (2 s). Alargar: orejas creciendo también más lentas (`A~` en el tramo al revés) y el «¡oh!» más largo (~3 s en total).
  - **Triste**: empezar más tarde (ahora se mezcla con la sorpresa: quitar o acortar el tramo de orejas de A y entrar más cerca de la cara triste de B, ~B4,2) y un poco más largo (tramo triste de B a cámara lenta).
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
