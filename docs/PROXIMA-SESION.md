# Próxima sesión — ONE v0.3: cerrar la fase 3 (sonido en el iPhone, revisión ejecutando la app, publicar)

## Lo último (10-oct-2026, noche, sesión desatendida)
- **Hechas y revisadas en `v0.3-fase-3`**: 3.1 pasos 1-3 (panel `?depurar=sonido`), 3.3 (tarjeta = modo, «Pronto»), 3.4 (Tienda mínima, Órdago), **3.4b** (`ce5a448`: ONE abre directamente en el hub, fuera la pantalla 🧠/💪, sin «←» en el hub; spec §3 y plan en `d550e57`), **3.5** (`089d29c`: aviso grande «Preguntas generadas» + insignia PREMIUM; rulings en el plan: juega exactamente lo generado, nunca se muestra en pregunta/repaso/espera del Átomo, fuera del respaldo) y parte de **3.6** (`ece4cd0`: caché `one-v22` con `aviso-generadas.js`; el e2e del barrido 375×667 tenía una carrera al arrancar → espera al hub, tope 180 s).
- Suites: unitarios **743/743**. e2e: tras la 3.5, 164 pasan + el barrido (ya arreglado y verificado aislado, 1,5 min). La e2e completa final la cortó Claude Code por falta de memoria en el PC: **relanzarla**.
- Adversariales (gratis): spec+plan 3.4b (Groq gpt-oss-120b, 10 objeciones, 0 aplicadas) y código de la fase (Nemotron, 5 objeciones, 0 aplicadas: falsas o contra la spec; punto del pie 30×44 asumido). Detalle en `.superpowers/sdd/2026-10-06-one-v0.3-fases-3-10/progress.md`.

## Siguiente paso
1. Leer `progress.md` y `git log --oneline -8`.
2. `npx playwright test` completo (con memoria libre; cerrar otras apps) → verde; `git checkout -- docs/capturas`.
3. **Sonido (3.1 pasos 4-6 → 3.2)**, lo último por decisión de Carlos: `npm run servir` (lo cortó también la falta de memoria) y Carlos abre en el iPhone `http://192.168.1.137:8765/?depurar=sonido` (ya entra directo al hub). Si no carga: iPhone en la wifi `MIWIFI_sHY3` (no en datos 5G) y el PC con `ipconfig` mostrando aún 192.168.1.137; probar antes `http://192.168.1.137:8765/` desde el propio iPhone. Alternativa: Tailscale (PC 100.72.197.51; permitir node en el perfil Privado del cortafuegos). Capturas del panel con el interruptor en sonido y en silencio → `docs/diagnostico-sonido-2026-10.md` con la causa demostrada → 3.2.
4. Resto de 3.6: revisión final Opus **ejecutando la app** a 375×667 (hub directo, cada tarjeta, Tienda, aviso con `?test=1` y `__one.simularTandaLista`, silencio, sin scroll), `PROXIMA-SESION` reescrito y **OK de Carlos para publicar**.
5. Antes de las fases 4, 5, 6 y 8: alinear su parte del plan con la spec del 10-oct (esfinge v2 y su API `gesto()`, fotos de fondo, suelo de nivel 3, Afinar con fotos).

## Aparcado de fases 1-2
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos; `esfinge.js` usa el `document` global (desaparece en la fase 4).
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (743) y `npx playwright test` (≈165). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
