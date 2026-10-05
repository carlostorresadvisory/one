# Prompt de arranque para la próxima sesión de ONE

> Copiar y pegar tal cual al abrir Claude Code en `C:\Users\torre\OneDrive\Desktop\ONE`. Actualizado el 5-oct-2026 a las 23:40. El historial anterior está en `git log`.

---

Hola. Continuamos ONE (app personal de Carlos para aprender sin leer: preguntas sin teclado, PWA en el iPhone). Lee la memoria del proyecto. **Estamos a mitad de ejecutar el plan de las fases 1-2 de ONE v0.3 (tres modos adictivos) con superpowers:subagent-driven-development. Sigue ejecutando desde donde se quedó, en loop, sin pararte entre tareas.** No reabras decisiones cerradas.

## Dónde estamos
- **Rama `v0.3-fases-1-2`** (sale de `main` en `2553aca`). No está publicada.
- **Spec aprobada**: `docs/superpowers/specs/2026-10-05-one-v0.3-tres-modos-design.md` (hub con radar + 6 tarjetas Clásico/Repaso/Apuesta/Más o menos/Contrarreloj/Esfinge-tienda + Comenzar; filtro de átomos en todos los modos con «Generar preguntas»; Más o menos con Comparar y Afinar; mochila, cofres y tienda; esfinge SVG; efectos y sonido; 7 fases).
- **Plan de las fases 1-2**: `docs/superpowers/plans/2026-10-05-one-v0.3-fases-1-2.md` (10 tareas). Las fases 3-7 tendrán su propio plan después.
- **Ledger (manda sobre la memoria)**: `.superpowers/sdd/2026-10-05-one-v0.3-fases-1-2/progress.md`. Ahí están las tareas cerradas, los rulings del escaneo previo (fallos del plan en T6-T10 ya decididos: hay que pasárselos a cada implementador en su dispatch) y los minors aplazados para la revisión final. Los briefs de cada tarea ya están extraídos: `task-N-brief.md`; instrucciones comunes para implementadores: `dispatch-implementador.md`.
- **Hechas**: T1 sonido.js (+vendor/zzfx.js), T2 efectos.js (+vendor/canvas-confetti.js), T3 esfinge.js (cerrada en `6a7219b`). **Siguiente: T4** (mochila.js núcleo + respaldo.js v3).

## Cómo seguir
- Por tarea: implementador **Sonnet** (dispatch corto: dispatch-implementador.md + task-N-brief.md + rulings del ledger que toquen esa tarea + ruta del report) → `review-package` → revisor **Sonnet** con la plantilla task-reviewer-prompt.md → arreglos reanudando al mismo implementador → re-revisión **Haiku** → ledger. Scripts en `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/`.
- La suite e2e regenera `docs/capturas/*.png`: no se commitean (añadir ficheros por nombre).
- Al terminar las 10: revisión final de rama con **Opus EJECUTANDO la app** (paquete `review-package` desde `2553aca`) + pasada adversarial con un modelo gratis de OpenRouter; una ola de arreglos.
- **Publicar (merge a `main` + push) solo con el OK de Carlos.** Tras el push: `gh run list` y que `https://carlostorresadvisory.github.io/one/sw.js` sirve `one-v21`. Luego avisar a Carlos para probar en el iPhone.
- Después: plan de la fase 3 (Apuesta) con writing-plans.

## Dónde está todo
- Repo público `carlostorresadvisory/one`, GitHub Pages `https://carlostorresadvisory.github.io/one/` (caché `one-v20` en main; Pages necesita `.nojekyll`).
- Servidor en el VPS de IONOS (`ssh root@31.70.132.252`, `/opt/one`); estas fases no lo tocan.
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (≈671) y `npx playwright test` (≈128 e2e).

## Decisiones fijas (no reabrir)
Paleta oscura + cian, sin magenta (dorado como acento); ninguna pantalla hace scroll y la letra no se encoge; imágenes solo de Wikimedia Commons con atribución; la verificación de contenido nunca se salta; generación gratis primero (pago solo el escalón ultrabarato, tope 0,10 €/día); preguntas infinitas y adaptativas; Repaso = partida de pendientes.

## Cómo trabajar con Carlos
Ficha de arranque y línea de contexto en cada mensaje (`~/.claude/CLAUDE.md`); relevo a 250k de contexto; preguntarle lo que no esté claro antes de construir; commitear por fases.
