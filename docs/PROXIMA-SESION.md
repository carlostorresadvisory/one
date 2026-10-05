# Prompt de arranque para la próxima sesión de ONE

> Copiar y pegar tal cual al abrir Claude Code en `C:\Users\torre\OneDrive\Desktop\ONE`. Actualizado el 5-oct-2026 a las 20:15. El historial anterior de versiones está en `git log` (este fichero se reescribió entero al cambiar de rumbo).

---

Hola. Continuamos ONE (app personal de Carlos para aprender sin leer: preguntas sin teclado, PWA en el iPhone). Lee la memoria del proyecto y el `README.md`. **Hoy cambia el rumbo: ONE pasa a ser tres modos de juego adictivos.** No reabras decisiones cerradas.

## Por qué (5-oct-2026)
Carlos: «ONE no es suficientemente adictivo». Lo usa él; cuando piensa «debería hacerlo» le da pereza abrirlo y acaba en Instagram. Diagnóstico acordado: las mecánicas de quitar fricción no bastan; hace falta emoción (riesgo, sorpresa, pique). Se construyeron 3 prototipos desechables y **Carlos los probó en el iPhone**:
- **Apuesta** → «funciona muy bien».
- **Más o menos** → «funciona muy bien».
- **Madriguera** → descartada; se sustituye por **Contrarreloj**.
- Pide **imágenes y efectos visuales** en todo: «todo eso viene bien para que sea más adictivo». Con estos 3 modos «vamos que chutamos con ONE».

Prototipos: https://carlostorresadvisory.github.io/one/prototipos/ (código en `prototipos/index.html`, datos de `prototipos/construir-datos.cjs` → `datos.js`; commit `1d9f7c3`). Son la referencia de comportamiento, no código para copiar tal cual.

## Qué hay que construir (los tres modos dentro de ONE)
1. **Apuesta**: fondo de 1.000 puntos con curva tipo cartera; antes de responder eliges fichas 10 % / 25 % / 50 % / Todo; paga ×1 a ×2 según nivel; pregunta dorada ×3 (1 de cada 7); racha de 3 = ×1,5; quiebra → fondo nuevo, se guarda el máximo. Usa preguntas V/F y test4 del banco y de la generación infinita.
2. **Más o menos**: dos cifras, la de abajo oculta; «más/menos» (en historia «antes/después»); la cifra se revela contando; nota curiosa en algunas; racha y récord; temas rotan (población, altura, historia, dinero). **Necesita un banco de cifras verificadas con fuente** (hoy son 72 escritas a mano en el prototipo): generarlas y verificarlas con la cascada gratis, igual que las preguntas.
3. **Contrarreloj de la Esfinge** (sustituye a Madriguera; ideas de Carlos del 5-oct, 20:14, «brainstorming a lo loco», a afinar con él): diseño **simple de avance** (nada de gráficos tipo Crossy Road); una **esfinge** te hace preguntas con tiempo; **si fallas o no contestas a tiempo, empiezas de nuevo**; al llegar a **10 preguntas te da un premio** y te ofrece **doble o nada** para seguir (riesgo tipo «¿quieres continuar?»). Propuesta pendiente de confirmar: la pantalla de «has caído» enseña la explicación de la pregunta que te tumbó (el momento de aprender). Necesita enunciados cortos: filtrar el banco o generar V/F cortas. (Esto sustituye al «boss estilo esfinge DESCARTADO» del 16-sep.)
4. **Imágenes y efectos en los tres**: imágenes de Wikimedia Commons (regla vigente: licencia libre y atribución) también para los elementos de Más o menos (países, edificios, montañas, hechos); efectos de acierto/fallo, cifras que cuentan, confeti en récords, sacudida al fallar, etc.
5. **Sonido (Carlos lo quiere)**: dinero/«success» al acertar, sonido de fallo al fallar. En iOS el audio solo arranca tras el primer toque; botón de silencio.
6. **Avatar permanente en una esquina** (idea de Carlos): se pone contento al acertar y triste al fallar. Propuesta a confirmar: que el avatar SEA la esfinge en los tres modos (un solo personaje, identidad de ONE), con pocas expresiones (neutral, contenta, triste, eufórica en récord/doble o nada).

## Preguntas para Carlos ANTES de diseñar (brainstorming → spec → plan)
1. ¿Cómo encajan los 3 modos en ONE? ¿Sustituyen a la tanda actual como pantalla de entrada (abrir = elegir modo o entrar directo al último), y qué pasa con el hub, el radar, el repaso y el átomo?
2. Esfinge: ¿cuánto tiempo por pregunta (fijo o que se acorta)? ¿qué es el premio a las 10 (puntos para el fondo de Apuesta, una medalla, una imagen de colección)? ¿el doble o nada es otras 10?
3. ¿El fondo de Apuesta y los récords son un marcador único o uno por modo? ¿El premio de la esfinge alimenta el fondo?
4. Avatar: ¿la esfinge para todo o un personaje distinto? ¿Dibujado en SVG propio (gratis, coherente con la paleta)?

## Dónde está todo
- Repo público `carlostorresadvisory/one`, rama `main`, GitHub Pages en https://carlostorresadvisory.github.io/one/ (caché del SW `one-v20`). Tras cada push comprobar `gh run list` y que `…/one/sw.js` responde (memoria: Pages necesita `.nojekyll`).
- Servidor de generación en el VPS de IONOS (`ssh root@31.70.132.252`, `/opt/one`, Docker + Caddy, `https://one.ctadvisory.es` es solo la API y da 401 sin token). Escalón ultrabarato activado con tope de 0,10 €/día (Carlos, 17-sep); lo demás, gratis.
- Scripts de `tools/`: lanzar con `node --env-file=.env` (si no, la cascada dice «sin clave»). Nunca dos `--aplicar` en paralelo.
- Verificación: `node --test tests/*.test.js` (≈630) y `npx playwright test` (≈128 e2e).

## Decisiones fijas (no reabrir)
Paleta oscura + cian, sin magenta; ninguna pantalla hace scroll y la letra no se encoge para encajar; imágenes solo de Wikimedia Commons con licencia libre y atribución (vídeo no); la verificación de preguntas nunca se salta; contenido útil (nada de trivia de especialista, criterio en `tools/criterio.js`); generación gratis primero (pago solo el escalón ultrabarato con su tope); preguntas infinitas y adaptativas.

## Cómo trabajar con Carlos
Ficha de arranque y línea de contexto en cada mensaje (`~/.claude/CLAUDE.md`); preguntarle lo que no esté claro ANTES de construir; superpowers (brainstorming → spec → plan → subagent-driven-development con revisión por tarea, subagentes Sonnet con la spec como contrato); pasada adversarial con un modelo gratis de OpenRouter; **revisión final de rama con Opus EJECUTANDO la app** (es la única que ha encontrado los Critical); commitear por fases, publicar con `git push` y avisarle para probar en el iPhone.
