# Prompt de arranque para la próxima sesión de ONE

> Copiar y pegar tal cual al abrir Claude Code en `C:\Users\torre\OneDrive\Desktop\ONE`. Actualizado por última vez el 12-sep-2026 a las 17:05 (sesión en curso; se vuelve a actualizar al cerrar).

---

Hola. Continuamos ONE (app personal de preguntas sin teclado). Lee primero `README.md`, `docs/PROXIMA-SESION.md` (este fichero), la hoja de ruta en `docs/superpowers/specs/2026-09-12-one-v0-design.md` §7 y la memoria del proyecto. No reabras decisiones cerradas.

**Dónde está todo**
- Repo público `carlostorresadvisory/one`, rama `main`, publicado en https://carlostorresadvisory.github.io/one/ (GitHub Pages; los cambios llegan a la PWA en la segunda apertura por el service worker).
- Verificación: `npm test` (79 tests del motor y pipeline) y `npm run e2e` (Playwright a 375×812, capturas en `docs/capturas/`). Todo en verde en el último commit.
- Banco: `datos/banco.json` (331 preguntas verificadas, 8 áreas). Pipeline en `tools/` (generar → verificar `--solo-pendientes` → validar → `auditar-banco` → `revisar-muestra`). Solo modelos `:free` salvo `--permitir-pago --tope-eur N`; Carlos aprobó 0,50 $/día el 12-sep (gasto real ese día ≈ 0,03-0,10 $, ver `datos/llamadas.log`, ignorado por git).

**Qué se hizo el 12-sep** (todo commitado): v0 completa — motor (escalera `nivelPartida`, nivel por área, Leitner, `siguientePregunta` con filtro de área, "No lo sé", `puntuacionArea`/`notaArea`), UI (4 mecánicas, feedback con nivel ↑/↓, ←, practicar por área, exportar/importar), PWA, pipeline con cascada gratis→pago, dos pasadas adversariales de código y una de 30 preguntas (4 fuera). Rediseño del flujo en marcha al cerrar (ver "pendiente").

**Pendiente / en marcha al cerrar la sesión del 12-sep**
1. Rediseño del flujo (agente Sonnet): Inicio 🧠/💪 → hub (radar de 8 áreas, tarjetas de área con barra fina y nota S+/S/A/B/C/D, 3 KPIs, botón "Comenzar") → partida; feedback dinámico (acierto avanza solo ~1,4 s; fallo sacude y muestra explicación); botones IDK (cuadrado) y ? en todas las mecánicas; vistas a pantalla exacta sin rebote, transiciones deslizantes; fondo dinámico adaptado del CSS de ctadvisory.es. Comprobar si quedó commitado y publicado (`git log`, `git status`); si no, terminar, verificar con `npm test` + `npm run e2e` y publicar.
2. Auditoría del banco entero (`node tools/auditar-banco.js`): resultado en `datos/auditoria.json` / `datos/auditoria.log`. Cruzar con criterio antes de `--aplicar` (gpt-5-mini fue más laxo que nex en la muestra).
3. Carlos tiene que revisar `docs/revision-muestra-2026-09-12.md` (30 preguntas) y decir cuáles están mal → tasa de error real.
4. Siguiente en la hoja de ruta (v0.1): generación continua por área/nivel (con la escalera, ~5 preguntas por nivel y área se agotan en días); boss "elige el camino"; FSRS; exportar reportadas.

**Decisiones fijas (no reabrir)**: sin servidor en v0; GitHub Pages público; paleta actual (fondo oscuro + cian, **sin magenta**); "Comenzar", no "Jugar"; V/F 50/50 en el generador; lote de 4 en verificación (los gratis cortan el JSON con lotes grandes); nunca modelos de pago sin `--permitir-pago --tope-eur` aprobado por Carlos.

**Cómo trabajar**: ficha de arranque y línea de contexto en cada mensaje (`~/.claude/CLAUDE.md`); construir con agentes Sonnet a partir de contratos explícitos (funcionó bien); pasada adversarial con modelo gratis de OpenRouter antes de entregar; commitear por fases y publicar con `git push` (Pages tarda ~1 min).
