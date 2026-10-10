# Próxima sesión — ONE v0.3: revisar maquetas con Carlos y ejecutar el plan de las fases 3-10

## Lo último (10-oct-2026, mediodía)
- **Maquetas revisadas por Carlos en el iPhone** (rama `diseno-secciones`, `prototipos/secciones/index.html`, commit `4309f1b`). Decidido: **imagen de Commons de fondo con la pregunta encima** (sombra abajo); **ninguna tarjeta grande con emoji**, siempre foto; **Afinar con fotos a escala real** (alto proporcional a la cifra; la de la estimación crece con el deslizador); **preguntas difíciles** (ejemplos en la maqueta). Duda «hueco en Contrarreloj» resuelta: lo llena la foto. **Sin decidir**: salvavidas magenta (¿icono propio?), resplandores, avatar de 100 px, y las 3 asunciones del plan (abajo). **Nada de esto está aún en la spec**: llevarlo antes de construir, con adversarial.
- **Esfinge: NO generar vídeo nuevo** (Carlos: «con lo que tenemos, interpolando y sin cortes, puedes generar todas las animaciones, pero con muchísimo tacto»). Fuentes: `prototipos/avatares/esfinge-video/original.mp4` (6-oct, «A») y `prototipos/avatares/esfinge-candidatas/video-7oct.mp4` («B»), 640 px, 64 fps, 10 s. Gestos que hay (segundos): A acierto 0,1-2,2 · A sorpresa «¡oh!» con orejas 2,3-3,3 (**la sorpresa buena**, Carlos) · A euforia con chispas 3,3-6,2 · A guiños 7,1-7,9 y 9,2-9,9 · A reposo 6,3-9,9 · B saludo 0,2-1,4 y 7,4-8,0 · B pensando 1,5-3,0 y 8,5-9,6 · B sorpresa 3,0-3,5 · **B triste 4,0-6,7** (ojos cerrados, después de la sorpresa; Carlos: «el triste lo tienes después de la sorpresa») · B neutros solo en 0-0,2, 6,2-6,8 y 9,6-10.
- **Lo que Carlos rechaza**: clips en bucle que se notan al reiniciar, **boomerangs (ida y vuelta)**, congelaciones, fundidos que se ven, movimientos no naturales. El triste montado hoy en ONE (fundido FILM hacia una imagen fija) **no sirve**. Pide fluidez: los clips de ONE van a 24 fps; las fuentes dan 64.
- **Probado el 10-oct** (`tools/esfinge/`, scripts Python con numpy + ffmpeg de imageio_ffmpeg; `D.npy` se regenera con `saltos.py`): matriz de parecido entre los 1.282 fotogramas de A y B; saltos «video texture» con fundido de 3-8 fotogramas; color de B igualado a A (`alinear.py`, el encuadre ya coincide); montaje continuo `personaje.py tramos.txt`. Resultado en `prototipos/avatares/esfinge-candidatas/index.html` (sección 0, `personaje.mp4`): **Carlos sigue viendo cortes y movimientos no naturales**. Uniones dentro del mismo vídeo = 0; entre A y B ≈ 5 (paso normal 0,5, p95 2,0). Conclusión: el fundido no basta; hace falta **interpolación de movimiento real (RIFE o FILM)** en cada unión y salida/entrada al reposo, y revisar cada gesto a mano.

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
0a. **Esfinge** (sesión propia, plan antes de tocar nada): por cada gesto (saludo, pensando, sorpresa «¡oh!», triste, acierto, euforia, guiño) un clip que salga del reposo y vuelva a él solo hacia delante, con transiciones interpoladas (RIFE local con `rife-ncnn-vulkan`, gratis, o FILM), a 64 fps, stacked alpha como `prototipos/avatares/esfinge-mp4/`. Criterio de hecho: Carlos lo ve en el iPhone y no nota ningún corte. Herramientas: la interpolación la hace un programa (RIFE/FILM), no un modelo de lenguaje; un modelo gratis con visión de OpenRouter (contenido 🟢, sin datos confidenciales) puede hacer de primer juez de naturalidad sobre tiras de fotogramas antes de enseñárselo a Carlos (sugerencia de Carlos, 10-oct: «estoy bastante seguro de que puede salir si lo hacemos bien con las herramientas adecuadas»). Servir en local: `npm run servir`, abrir `http://<IP>:8765/...` (el Wi-Fi de Carlos ya es red privada).
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
