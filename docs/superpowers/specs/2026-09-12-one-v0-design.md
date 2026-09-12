# ONE · spec v0 — prototipo jugable en el iPhone

**Fecha**: 12-sep-2026 · **Decidido con Carlos en brainstorming** (enfoque B de tres). Sustituye, para la v0, el alcance del sprint 1 del análisis del 8-sep: sin servidor, sin Postgres, sin CUERPO.

## 1. Qué es la v0

Una web instalable (PWA) que Carlos abre en el iPhone, pulsa **▶ JUGAR** y responde **10 preguntas sin teclado**. Recuerda la racha, el nivel por área y qué toca repasar; sube o baja la dificultad sola; las preguntas están verificadas por un segundo modelo. Mejor que un trivia de una tarde, sin ser una locura; base desde la que seguir.

**Criterio de éxito de hoy**: Carlos juega una partida completa en su iPhone, instalada desde Safari, con preguntas que no le hagan dudar de la app. **Criterio de éxito de la v0**: vuelve solo 7 días seguidos (se lee en la racha).

**Fuera de la v0**: servidor, cuentas, CUERPO, idiomas, audio, mapa de conocimiento, métricas "cognitivas", boss, texto libre, "elige el camino".

## 2. Producto

### Pantallas
1. **Inicio**: 🧠, racha (🔥 N días), botón ▶ JUGAR, enlace a Progreso.
2. **Pregunta** (una a la vez, pantalla completa, 375 px primero): enunciado + mecánica. Barra fina de progreso (n/10). Debajo, discreto: **"¿por qué?"** (muestra la explicación tras responder) y **"esta pregunta está mal"** (marca el id en el estado local; no interrumpe).
3. **Feedback** inmediato sobre la misma tarjeta: ✓/✗, +XP, combo ×N si hay 3+ aciertos seguidos. Avanza al tocar o al deslizar.
4. **Resumen** al acabar: aciertos/10, XP ganado, racha, áreas tocadas. Botón "Otra" y "Inicio".
5. **Progreso**: racha, preguntas de hoy, una barra por área con **dato real** (% de acierto de las últimas 20 respuestas del área) y "N estables" (tarjetas en caja ≥ 3), botón **Exportar** (descarga el estado en JSON) e **Importar**.

### Mecánicas (4)
| tipo | gesto | señal | XP base |
|---|---|---|---|
| `vf` | swipe izquierda = falso, derecha = verdadero (también dos botones) | débil (50 % azar) | 5 |
| `test4` | tap en una de 4 opciones | buena | 8 |
| `ordenar` | tap secuencial 1→2→3→4 sobre 4 tarjetas; tap sobre una elegida la deshace | fuerte | 12 |
| `error` | tap sobre la fila sospechosa de una tarjeta de 3-5 datos | fuerte (pensamiento crítico) | 12 |

Mezcla por partida: ~3 `vf`, ~4 `test4`, ~2 `ordenar`, ~1 `error` (lo que haya disponible; el selector no falla si falta un tipo).

## 3. Banco de preguntas

- **200 preguntas**, 8 áreas × 25: `economia`, `historia`, `ciencia`, `tecnologia`, `geografia`, `filosofia`, `arte`, `logica`. Niveles 1-5 por área (≈ 5 por nivel). Español.
- Fichero `datos/banco.json`: array de preguntas con este esquema, validado por `tools/validar-banco.js`:

```json
{
  "id": "eco-007",
  "area": "economia",
  "tipo": "vf | test4 | ordenar | error",
  "nivel": 3,
  "enunciado": "texto",
  "explicacion": "1-2 líneas, la idea clave",
  "confianza": 0.9,
  "generador": "id del modelo",
  "verificador": "id del modelo",
  "verificado": true
}
```
Campos por tipo: `vf` → `respuesta: true|false`; `test4` → `opciones: [4 strings]`, `correcta: 0-3`; `ordenar` → `criterio: "de menor a mayor …"`, `items: [4 strings en el orden correcto]` (la UI los baraja); `error` → `tarjeta: {titulo, filas: [{etiqueta, valor}]}`, `sospechoso: índice`.

- **Pipeline** (Node, sin dependencias, clave `OPENROUTER_API_KEY` del entorno, nunca en el repo):
  1. `tools/generar-preguntas.js --area X --n 25` → modelo gratis **A** genera en lotes de 5-10 por tipo y nivel, salida JSON estricta → `datos/borradores/`.
  2. `tools/verificar-preguntas.js` → modelo gratis **B, de otra familia**, responde por cada pregunta: ¿es verdadera la afirmación/respuesta marcada? ¿es la única correcta? ¿es inequívoca? → `verificado`, `confianza` (0-1). Solo entran al banco las que aprueba con confianza ≥ 0,7.
  3. `tools/revisar-muestra.js --n 30` → saca 30 al azar en Markdown para que **Carlos** las revise a mano y se mida la tasa de error real.
  4. **Cascada de modelos** (pedida por Carlos, 12-sep): la lista de cada papel va de gratis a de pago barato (p. ej. `openai/gpt-5-mini`, `z-ai/glm-4.7-flash`, `google/gemini-2.5-flash`; ids exactos según catálogo). Si un modelo falla (límite de peticiones, 404, JSON inválido) se pasa al siguiente. La cola de pago está **desactivada por defecto**: solo se recorre con `--permitir-pago --tope-eur N`, y N lo fija Carlos antes (regla 5). Presupuesto de hoy: 0 €.
- Los modelos concretos se eligen con el catálogo delante al construir (dos familias distintas, contexto suficiente, JSON fiable) y quedan registrados en cada pregunta.

## 4. Motor (`motor.js`, puro, sin dependencias, con tests)

Estado (localStorage, clave `one.estado`, con `version: 1`):
```
{ version, xp, racha: {dias, ultimaFecha}, hoy: {fecha, respondidas, aciertos},
  areas: { [area]: {nivel 1-5, seguidosOk, seguidosKo, ultimas: [bool ×≤20]} },
  tarjetas: { [id]: {caja 0-4, proximo: "YYYY-MM-DD", aciertos, fallos} },
  reportadas: [id], historial: [{id, fecha, correcta}] (últimas 500) }
```
Funciones (todas puras: reciben estado y devuelven estado nuevo):
- `crearEstado(hoy)`.
- `seleccionarPartida(estado, banco, hoy, n=10, rng)` → ids. 30 % repasos vencidos (`proximo ≤ hoy`, prioridad a los más atrasados), 70 % nuevas del nivel actual del área (±1 si no hay), rotando áreas para no repetir la misma dos veces seguidas. Excluye reportadas. `rng` inyectable para tests.
- `registrarRespuesta(estado, pregunta, correcta, hoy)` → `{estado, delta: {xp, combo}}`. Leitner: acierto sube caja (0→1→2→3→4, intervalos 1-3-7-14-30 días), fallo → caja 0, `proximo = hoy + 1`. Nivel del área: **sube** con 3 aciertos seguidos en preguntas que no sean `vf`, **baja** con 2 fallos seguidos de cualquier tipo. XP = base × (1 + 0,1 × nivel) × 1,5 si combo ≥ 3. Actualiza `hoy` y `ultimas`.
- `actualizarRacha(estado, hoy)`: al completar la primera partida del día, +1 si ayer también; si hay hueco, vuelve a 1.
- `resumenProgreso(estado, banco)` → datos para la pantalla Progreso (cada número sale de aquí; la UI no calcula nada).
- `exportar(estado)` / `importar(json)` con validación de `version`.

## 5. Técnica

- HTML/CSS/JS vanilla, sin build ni framework. Ficheros: `index.html`, `app.js` (UI y gestos), `motor.js`, `estilos.css`, `manifest.json`, `sw.js` (cache-first de los estáticos y del banco; versión en el nombre de la caché), `iconos/` (192 y 512 px, generados por script).
- Gestos: Pointer Events (swipe horizontal ≥ 60 px para `vf`); todo tiene alternativa por botón.
- `motor.js` se carga como módulo ES tanto en el navegador como en `node --test`.
- **Publicación**: GitHub Pages desde `main`, raíz del repo público `ONE`. HTTPS gratis → instalable. Sin dominio propio.
- Tokens de diseño mínimos (`estilos.css`): fondo oscuro, una tipografía del sistema, un color de acento, escala tipográfica de 4 tamaños. Tap targets ≥ 44 px. Sin animaciones más allá de la transición de tarjeta.

## 6. Verificación

1. `node --test tests/` → motor: selector (proporciones, exclusiones, rotación), Leitner, nivel, XP/combo, racha con huecos, export/import.
2. `tools/validar-banco.js` → esquema, ids únicos, 4 opciones, índices dentro de rango, ≥ 20 preguntas por área.
3. Playwright headless a 375×812 (`tests/e2e.spec.js`): abre, juega una partida completa con las 4 mecánicas, ve el resumen, recarga y comprueba que la racha y el progreso persisten. Captura de cada pantalla en `docs/capturas/`.
4. Pasada adversarial con modelo gratis de OpenRouter sobre `motor.js`, `app.js` y 30 preguntas al azar; objeciones resueltas o declaradas.
5. **Carlos (a mano)**: revisa los 30 de `revisar-muestra` y anota las que estén mal → tasa de error del lote; instala en el iPhone (Safari → Compartir → Añadir a pantalla de inicio) y juega una partida.

## 7. Hoja de ruta (después de la v0)

- **Principio de producto (fijado por Carlos, 12-sep)**: las preguntas son **infinitas y adaptativas** — se generan conforme se responde, por área y nivel según los aciertos. En v0 el banco es un lote fijo de 200 (el pipeline llamado una vez). En **v0.1** el mismo pipeline repone automáticamente: cuando el pozo de un área en el nivel actual de Carlos baja de 10 preguntas sin responder, se genera y verifica un lote nuevo de ese área y nivel (script lanzado a mano o programado). En **v1** lo hace el servidor en segundo plano, y la dificultad de lo generado sigue al nivel real de cada área.
- **Cambios entrados en la v0 el mismo 12-sep tras la primera prueba real de Carlos** ("no veo que el sistema aprenda"): **escalera inmediata** — `nivelPartida` (1-5) que sube un nivel por acierto y baja uno por fallo, persiste entre partidas y decide el nivel de la siguiente pregunta (`siguientePregunta`, una a una, en vez de 10 fijas); el nivel por área se mantiene como memoria lenta. **Nivel visible**: cabecera "Área · nivel N" en cada tarjeta, "Nivel N ↑/↓" en el feedback, nivel actual en el inicio.
- **v0.1 — inicio nuevo (ideas de Carlos, 12-sep, no definitivas)**: fondo dinámico reutilizando el CSS de ctadvisory.es (localizar en `Freelance/web`); dos emojis clicables — 🧠 (activo: al tocarlo muestra las stats: racha, nivel, barras por área) y 💪 (apagado, etiqueta "pronto": será CUERPO); debajo botón **"Comenzar"** (menos lúdico que "Jugar"; XP, racha y combo se mantienen). Las stats se ven ANTES de las preguntas.
- **v0.1 — generación continua pasa a ser lo primero**: con ~5 preguntas por nivel y área el banco se agota en días con la escalera; reposición automática por área y nivel cuando el pozo baja de 10 sin responder.
- **v0.1**: boss semanal con "elige el camino" (árbol de 3 pasos), FSRS en lugar de Leitner cuando haya ≥ 2 semanas de datos, lotes nuevos de preguntas (mismo pipeline), preguntas de actualidad desde el brief.
- **v1**: servidor Node + Postgres en el VPS (el estado exportable migra tal cual), capa `model-provider` con coste, fuentes propias (PDF/artículo → preguntas ancladas), CUERPO mínimo si la v0 supera sus 7 días.
- **v2 · feed tipo TikTok**: desaparece la partida de 10. Un feed vertical infinito de tarjetas a pantalla completa con `scroll-snap`, que mezcla preguntas, repasos, microdatos ("¿sabías que…") y microexplicaciones; precarga la tarjeta siguiente; el motor decide el orden en tiempo real (repasos vencidos, nivel, variedad de área y tipo, "descanso" cada N tarjetas). Gestos iguales; la racha pasa a medirse en minutos de sesión además de días.

## Decisiones cerradas en esta spec
- Enfoque B (motor + pipeline), no A (trivia+) ni C (servidor).
- GitHub Pages con repo público (contenido no confidencial, decisión de Carlos 12-sep).
- 0 € hoy: solo modelos gratis; cualquier modelo de pago exige cifra y aprobación.
- Leitner en v0, FSRS en v0.1. Sin arrastrar: ordenar por taps.
- "Elige el camino" fuera de la v0, entra como boss en v0.1.
