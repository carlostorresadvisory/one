# Próxima sesión — ONE v0.3: revisar maquetas con Carlos y ejecutar el plan de las fases 3-10

## Lo último (10-oct-2026, 3 am)
- **Maquetas de las secciones pendientes** (Órdago, Más o menos, Afinar, Contrarreloj, Tienda; 3 estados cada una, estáticas, 375×667 sin scroll) en la rama `diseno-secciones`, `prototipos/secciones/index.html`. Sin publicar ni revisar con adversarial. Dudas abiertas para Carlos: emoji del salvavidas sale magenta (¿icono propio?), resplandores dorado/cian alrededor de esfinge y cofre (¿se quedan?), avatar de 100 px en Más o menos/Afinar (¿resta espacio?), Contrarreloj «jugando» deja un hueco grande entre la pregunta y los botones. Las tarjetas usan emojis sobre degradado como sustituto de imágenes.
- **Adversarial de las maquetas** (Nemotron gratis, 10-oct): aplicadas (Órdago con estado «Nuevo máximo» y nota de «Vender objetos»; Antes/Después deshabilitados tras revelar; Afinar con «Muy cerca», marca verde y umbrales de la spec §5.3.1). Descartadas: avatar de 40 px en cabeceras (contradice ⅓ del ancho, §7), avatar pequeño y filtro en la Tienda (la spec la quiere protagonista), capa de efectos (fuera de una maqueta estática).
- **Esfinge**: se quedan los 4 clips del 6-oct. Faltan saludo, pensando, sorpresa y triste alternativa: **Carlos genera** un vídeo Wan 10 s con el prompt de `docs/esfinge-prompt-wan.md` (imagen `prototipos/avatares/esfinge-video/neutral.jpg`) y lo deja en `Downloads`; después, cortes medidos + hoja de contacto + OK + montaje.

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
0. Enseñar las maquetas a Carlos en el iPhone (publicar la rama con su OK o servirlas en local), recoger cambios, pasada adversarial (otro modelo) y llevar lo decidido a la spec antes de construir.
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
- Más adelante: vídeos extra de la esfinge (saludo/pensando/sorpresa) con Wan o de pago con cifra exacta y aprobación.
