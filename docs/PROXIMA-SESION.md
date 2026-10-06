# Próxima sesión — ONE v0.3 fase 3 (Apuesta)

## Dónde estamos
- **v0.3 fases 1-2 publicadas** el 6-oct-2026: `main` en `ddc49f6`, caché `one-v21` servida en GitHub Pages. Incluye sonido (zzfx), efectos (confeti, destello, contador), esfinge SVG, mochila + respaldo v3, modos + filtro de área/ruta con «Generar preguntas», hub nuevo (radar + 6 tarjetas + Comenzar), silencio persistente en la cabecera.
- **Decisión de Carlos (6-oct)**: el premio (1 objeto a la mochila) solo se da en **Clásico con 10/10**; Repaso nunca da premio.
- Spec: `docs/superpowers/specs/2026-10-05-one-v0.3-tres-modos-design.md` (7 fases). Plan de fases 1-2 ya ejecutado: `docs/superpowers/plans/2026-10-05-one-v0.3-fases-1-2.md`.

## Siguiente
1. Esperar lo que diga Carlos tras probar en el iPhone (sobre todo: que suene al primer toque y que el premio de 10/10 aparezca en la mochila).
2. Plan de la **fase 3 (Apuesta)** con superpowers:writing-plans, desde la spec. Luego ejecutarlo con subagent-driven-development (implementador y revisor Sonnet, re-revisión Haiku, revisión final Opus ejecutando la app + adversarial OpenRouter gratis).

## Aparcado de fases 1-2 (para valorar en fases siguientes)
- Desbloqueo de audio asíncrono en iOS (el primer toque podría no sonar).
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos; `esfinge.js` usa el `document` global.
- Preexistentes: importar el mismo fichero dos veces no hace nada y no hay aviso de éxito; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM de rename, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (725) y `npx playwright test` (155). La suite e2e regenera `docs/capturas/*.png`: no se commitean.
- Publicar solo con OK de Carlos; el modo automático bloquea el push, así que lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
