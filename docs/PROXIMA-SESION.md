# Próxima sesión — ONE v0.3: cerrar la fase 4 (esfinge v2) y la fase 3 pendiente (sonido en el iPhone), publicar

## Lo último (11-oct-2026, rama `v0.3-fase-4`)
- **Fase 4 hecha y revisada** (esfinge v2 en WebGL: `avatar.js`, un reproductor por pantalla, gestos por evento, banda de 100 px en los modos; fuera `esfinge.js`). Revisión Opus ejecutando la app + adversarial hechas; arreglos: `destruir()` libera el contexto WebGL (`WEBGL_lose_context`), con autoplay bloqueado el siguiente toque repite `play()` sobre el mismo vídeo y lienzo, «Pronto» sin dorado. Caché `one-v23`; `avatar/` = 3,8 MB, dentro del presupuesto.
- **⚠️ Carlos:** OK de publicación y prueba en el iPhone: la esfinge se mueve, el gesto sale con un retardo de hasta ~2 s (deliberado, spec §7), vuelve sola al reposo y no hay cortes al cambiar de pantalla; confirma o cambia el tamaño de la banda (100 px).
- **Fase 3 pendiente**: sonido (3.1 pasos 4-6 → 3.2), bloqueado hasta las capturas del panel en el iPhone; ver pasos abajo. Detalle en `.superpowers/sdd/2026-10-06-one-v0.3-fases-3-10/progress.md`.

## Siguiente paso
1. Leer `progress.md` y `git log --oneline -8`.
2. `npx playwright test` completo (≈12 min) → verde; `git checkout -- docs/capturas`.
3. **Sonido (3.1 pasos 4-6 → 3.2)**, lo último por decisión de Carlos: `npm run servir` (lo cortó también la falta de memoria) y Carlos abre en el iPhone `http://192.168.1.137:8765/?depurar=sonido` (ya entra directo al hub). Si no carga: iPhone en la wifi `MIWIFI_sHY3` (no en datos 5G) y el PC con `ipconfig` mostrando aún 192.168.1.137; probar antes `http://192.168.1.137:8765/` desde el propio iPhone. Alternativa: Tailscale (PC 100.72.197.51; permitir node en el perfil Privado del cortafuegos). Capturas del panel con el interruptor en sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` con la causa demostrada → 3.2.
4. Resto de 3.6: revisión final Opus **ejecutando la app** a 375×667 (hub directo, cada tarjeta, Tienda, aviso con `?test=1` y `__one.simularTandaLista`, silencio, sin scroll), `PROXIMA-SESION` reescrito y **OK de Carlos para publicar**.
5. Antes de las fases 5, 6 y 8: alinear su parte del plan con la spec del 10-oct (API `gesto()` de la esfinge v2, fotos de fondo, suelo de nivel 3, Afinar con fotos).

## Aparcado de fases 1-2
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos.
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (756) y `npx playwright test` (≈173). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
