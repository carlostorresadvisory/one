# Próxima sesión — ONE v0.3: plan único de las fases 3-10

## Dónde estamos (6-oct-2026, tarde)
- **Publicado**: v0.3 fases 1-2 (caché `one-v21`) + prototipo de avatares en `https://carlostorresadvisory.github.io/one/prototipos/avatares/` (fuera de la app y del sw).
- **Spec reescrita con todo el feedback de Carlos** y lista para su OK final: `docs/superpowers/specs/2026-10-05-one-v0.3-tres-modos-design.md`. Fases 3-10 en su §13; §14 sin decisiones abiertas.
- Pasada adversarial de la spec hecha (Nemotron gratis; 6 de 10 objeciones aplicadas). Los cambios posteriores (imágenes con IA, avatar) aún no han pasado adversarial.

## Decisiones de Carlos del 6-oct (ya en la spec)
- Tarjeta = modo, sin Comenzar; modos sin hacer → tarjeta apagada «Pronto». Sección «Tienda». Apuesta → «Órdago». Generar = insignia PREMIUM sin bloquear. Aviso grande «Preguntas generadas» clicable.
- **Imágenes con impacto, nunca esquemas**: los visuales dibujados de `visuales.js` dejan de enseñarse (salvo imprescindibles). Orden: Commons → otros bancos libres (Openverse, Met, Rijksmuseum, NASA…) → IA solo como último recurso → color del área. Nota de calidad 1-5 con modelo gratis con visión; < 4 se sustituye.
- **IA de imágenes**: Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell` (gratis, ~230/día; probado: 9,8 s, buena calidad; no admite `seed`). Claves `CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` ya en `.env` local; **falta ponerlas en el `.env` del VPS** (Carlos, en la fase 7). Respaldo Runware (~0,0006 $/img) dentro del tope 0,10 €/día. Pollinations descartado.
- **Avatar = la esfinge de ONE**, diseño propio de Carlos con Gemini: `prototipos/avatares/i-esfinge/*.png` (4 expresiones, fondo recortado) y animaciones de Wan 2.2 en `prototipos/avatares/esfinge-video/` (`reposo`, `acierto`, `euforica` WebP animados 320 px; `triste` = imagen fija + CSS; `original.mp4` para re-recortar). Tamaño orientativo ≈ ⅓ del ancho y ⅙ del alto, en inicio y cabecera de modos. Las WebP pesan 0,4-0,6 MB cada una: optimizar en el plan (menos fps/colores) sin perder calidad visible.
- Extras opcionales cuando Carlos tenga cuota de Wan (Space `Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom`): vídeos «saludo / pensando / sorpresa» (desde la neutral) y «triste / hundida» (desde la triste); prompts en el historial de la sesión del 6-oct, 10 s con tramos por segundos.

## Siguiente paso
0. **Esfinge animada definitiva — hecha, pendiente del OK de Carlos en el iPhone** (opción J): `prototipos/avatares/esfinge-mp4/` = 4 MP4 H.264 «stacked alpha» 480 px · 24 fps · CRF 24 (reposo 291 KB bucle 437-625 del original; acierto 437 KB, 4-210 con pausa en la sonrisa; eufórica 649 KB, 210-400; triste 240 KB = 17 fotogramas FILM de reposo→`i-esfinge/triste.png` + respiración + vuelta) y `player.js` (WebGL, respaldo 2D; reposo en bucle, el resto una vez y vuelve). FILM gratis vía el Space `meta-artem/frame-interpolation` (API REST `/api/predict/`, modelo `akhaliq/frame-interpolation-film-style`). Vídeos extra (saludo/pensando/sorpresa): OpenRouter tiene 29 modelos de vídeo, todos de pago (seedance-1-5-pro ≈ 0,04 $/clip 5 s sin audio; wan-3.0/veo-3.1-lite ≈ 0,05 $/s a 480p): solo con aprobación y cifra exacta.
1. Enseñar a Carlos la spec final y pedir su OK (y que mire la opción J del prototipo en el iPhone).
2. Adversarial gratis (delegar.mjs, escalera `revisar`) sobre los cambios de imágenes y avatar.
3. `superpowers:writing-plans`: plan único de las fases 3-10, publicables por separado. El sonido roto del iPhone se diagnostica con `systematic-debugging` antes de tocarlo (pista: desbloqueo asíncrono de `AudioContext` y carga perezosa de zzfx fuera del gesto; interruptor de silencio).
4. Ejecutar con subagent-driven-development (implementador y revisor Sonnet, re-revisión Haiku, revisión final con Opus ejecutando la app + adversarial OpenRouter gratis).

## Aparcado de fases 1-2
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos; `esfinge.js` usa el `document` global (se resuelve al pasar a `avatar.js`).
- Preexistentes: importar el mismo fichero dos veces no hace nada y no da aviso de éxito; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM de rename, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (725) y `npx playwright test` (155). La suite e2e regenera `docs/capturas/*.png`: no se commitean.
- Procesar imágenes/vídeo: Pillow + numpy instalados; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- El visor de artefactos de claude.ai no sirve `.riv`/`.glb` ni deja hacer fetch: los prototipos se prueban en GitHub Pages.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main` (o `! git push origin main` si ya está en main). Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
