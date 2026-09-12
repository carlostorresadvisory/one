# Prompt de arranque para la próxima sesión de ONE

> Copiar y pegar tal cual al abrir Claude Code en `C:\Users\torre\OneDrive\Desktop\ONE`. Actualizado el 12-sep-2026 a las 18:10 (sesión en curso; se vuelve a actualizar al cerrar).

---

Hola. Continuamos ONE (app personal de preguntas sin teclado). Lee primero `README.md`, `docs/PROXIMA-SESION.md` (este fichero), la spec aprobada `docs/superpowers/specs/2026-09-12-one-v0.1-que-se-note-design.md` y la memoria del proyecto. No reabras decisiones cerradas.

**Dónde está todo**
- Repo público `carlostorresadvisory/one`, rama `main`, publicado en https://carlostorresadvisory.github.io/one/ (GitHub Pages; los cambios llegan a la PWA instalada en la segunda apertura).
- Verificación: `npm test` (motor y pipeline) y `npm run e2e` (Playwright 375×812, capturas en `docs/capturas/`). Todo en verde en el último push.
- Banco: `datos/banco.json` (323 preguntas verificadas, auditadas al completo y con los 77 "ordenar" revisados a mano; 8 áreas). Pipeline en `tools/` (generar → verificar `--solo-pendientes` → validar → `auditar-banco` → `revisar-muestra`). Solo `:free` salvo `--permitir-pago --tope-eur N`; Carlos aprobó 0,50 $/día el 12-sep (gasto real ≈ 0,05 $).

**Qué se hizo el 12-sep** (todo en `main`): v0 completa (motor con escalera, nivel por área, Leitner, filtro de área, notas S+..D; 4 mecánicas; PWA; pipeline con cascada gratis→pago); rediseño del flujo: inicio 🧠/💪 con fondo que respira → hub con radar de 8 áreas, notas, KPIs, "Comenzar" → partida con avance automático tras acierto y botones IDK/?; auditoría completa del banco (331 → 323); brainstorming de gamificación (`docs/2026-09-12-brainstorming-gamificacion.md`, 4 modelos gratis, 30 ideas) y spec v0.1 aprobada por Carlos.

**En marcha al cerrar / pendiente**
1. **Tanda v0.1 "que se note"** según la spec aprobada, en 5 pasos (sección 7): (1) motor — estado v2, confianza Baja/Media/Alta, pendientes, recuperadas, misión del día, `resumenProgreso(hoy)`, filtro `{ids}`; (2) UI partida — selector de confianza en vez de IDK, feedback compacto con chips; (3) hub compacto 4×2 sin scroll con radar sólido, Misión y Pendientes; (4) resumen con carrusel de repaso (swipe); (5) aserciones de no-scroll en e2e, capturas, README, `sw.js` a `one-v4`. Comprobar con `git log` hasta qué paso llegó; seguir desde ahí con agentes Sonnet y la spec como contrato; pasada adversarial gratis del diff antes de publicar.
2. Carlos tiene que probar en el iPhone (segunda apertura) el hub nuevo y decir si sigue sintiendo rebote o scroll.
3. Carlos tiene que revisar `docs/revision-muestra-2026-09-12.md` (30 preguntas) → tasa de error real.
4. Después (v0.2): generación continua por área/nivel (primera de la hoja de ruta), boss "estilo esfinge" (Carlos: "lo hablamos cuando toque"), ideas D del brainstorming (preguntas de conexión, tarjetas que evolucionan), FSRS.

**Decisiones fijas (no reabrir)**: sin servidor en v0/v0.1; GitHub Pages público; paleta oscura + cian, **sin magenta**; "Comenzar", no "Jugar"; selector de confianza Baja/Media/Alta **en lugar de** IDK (no los dos); racha 🔥 se queda tal cual, **sin cinta de sellos**; feedback debajo de la tarjeta, compacto, **no panel flotante**; repaso final con swipe; cada pantalla cabe entera sin scroll ni rebote; V/F 50/50 en el generador; lote de 4 en verificación; nunca modelos de pago sin `--permitir-pago --tope-eur` aprobado.

**Cómo trabajar con Carlos en este proyecto**: ficha de arranque y línea de contexto en cada mensaje (`~/.claude/CLAUDE.md`); preguntarle todo lo que no esté claro ANTES de construir (lo pidió expresamente); construir con agentes Sonnet a partir de contratos explícitos; pasada adversarial con modelo gratis de OpenRouter antes de entregar; commitear por fases y publicar con `git push` (Pages tarda ~1 min); avisarle para que pruebe en el móvil.
