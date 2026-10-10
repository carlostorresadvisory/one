# Próxima sesión — ONE v0.3: terminar la fase 3 (sonido en el iPhone, aviso grande, cierre)

## Lo último (10-oct-2026, noche)
- **Spec v0.3 actualizada y aprobada** (commit `9c3f255`, adversarial Nemotron: 6 aplicadas, 1 descartada): foto de Commons de fondo con la pregunta encima; ninguna tarjeta grande con emoji, salvo el 🛟 del Salvavidas (Carlos lo quiere así); Afinar con fotos a escala real; **suelo de nivel 3** en Órdago y Contrarreloj (Comparar: parejas ≤ ×4, fechas ≤ 300 años); resplandores solo en lo dorado; esfinge v2 (`prototipos/avatares/esfinge-v2/`, reposo + 6 gestos) para la fase 4, con mapa de gestos en §7. **Pendiente de Carlos**: tamaño del avatar en partida, cuando las fotos estén montadas (spec §14).
- **Asunciones del plan confirmadas** (10-oct): nivel del multiplicador = nivel de la pregunta; Tienda mínima en la fase 3 y en el hub la esfinge solo en su tarjeta; en la fase 7 Carlos hará `npm install` en el VPS y pondrá `CLOUDFLARE_AI_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
- **Fase 3 en marcha** en la rama `v0.3-fase-3` (sale de `diseno-secciones`; al publicar entran también maquetas y esfinge v2). Registro de progreso y decisiones: `.superpowers/sdd/2026-10-06-one-v0.3-fases-3-10/progress.md` (no está en git: es la memoria de la ejecución, léelo primero). Hecho: 3.1 pasos 1-3 (`c474baa`, panel `?depurar=sonido`), 3.3 (`0139b36`, tarjeta = modo, fuera Comenzar, «Pronto»), 3.4 (`d129a0b`+`418a02b`, Tienda mínima con la mochila y Órdago con migración del filtro). Suites: 733 unitarios; e2e 157 antes del arreglo de la 3.4 (la completa se relanza en 3.6).
- Esfinge v2 aprobada entera; lecciones: Carlos detecta todo boomerang; la cara respeta la emoción; nada cosido por zonas.

## Siguiente paso
1. Leer `progress.md` (registro, decisiones y menores aplazados) y `git log --oneline -6`.
2. **Sonido (3.1 pasos 4-6 → 3.2)**: pedir/leer las capturas de Carlos del panel en su iPhone (`http://192.168.1.137:8765/?depurar=sonido`, recargando una vez por la caché del service worker; con el interruptor en sonido y en silencio). El 10-oct al iPhone no le cargaba la URL: el PC sí sirve (curl 200 en 192.168.1.137:8765; cortafuegos permite node en perfil Público, que es el de la wifi `MIWIFI_sHY3`) → comprobar que el iPhone está en esa wifi y no en datos; si sigue sin cargar, alternativa: Tailscale (PC 100.72.197.51, perfil Privado: habría que permitir node también en Privado). Escribir `docs/diagnostico-sonido-2026-10.md` con la causa demostrada y solo entonces la 3.2.
3. **Nueva (Carlos, 10-oct): fuera la pantalla de inicio de 🧠/💪**; ONE abre directamente en el hub de tarjetas. Llevarlo a la spec §3 (con adversarial) y hacerlo como tarea de la fase 3 antes de la 3.5 (revisar e2e que entran por `cerebro`).
4. 3.5 (aviso grande «Preguntas generadas» + PREMIUM) y 3.6 (cierre: `one-v22`, revisión Opus ejecutando la app, adversarial gratis, OK de Carlos para publicar).
5. Antes de las fases 4, 5, 6 y 8: alinear su parte del plan con la spec del 10-oct (esfinge v2 y su API `gesto()`, fotos de fondo, suelo de nivel 3, Afinar con fotos).

## Aparcado de fases 1-2
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos; `esfinge.js` usa el `document` global (desaparece en la fase 4).
- Preexistentes: importar el mismo fichero dos veces no hace nada y no avisa; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (725) y `npx playwright test` (155). La suite e2e regenera `docs/capturas/*.png`: no se commitean (`git checkout -- docs/capturas`).
- Escaleras de `delegar.mjs` al día (6-oct): `qwen3.8-27b:free` ya no existe, sustituido por `thinkingmachines/inkling-small:free`. Groq rechaza contextos > 8k tokens/min (413); para spec + plan ganó `nvidia/nemotron-3-super-120b-a12b:free`.
- Procesar imágenes/vídeo: Pillow + numpy; ffmpeg vía `python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
- Publicar solo con OK de Carlos; el push lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
- Vídeos nuevos de la esfinge solo si interpolar lo existente no basta (Space Wan `multimodalart/wan-2-2-first-last-frame`, 1 vídeo al día; de pago con cifra exacta y aprobación).
