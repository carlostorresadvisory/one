# ONE · análisis del concepto y qué reutilizar de CT Advisory

## Contexto

Carlos ha diseñado con ChatGPT una app móvil de aprendizaje adaptativo gamificado. La conversación (enlace compartido, leída el 8-sep-2026) evoluciona así:

1. **Problema de partida**: leer le aburre, quiere aprender de forma continua a nivel universitario en todas las áreas (parte de economía/finanzas avanzado, IA intermedio, resto a nivel bachillerato), idiomas (C2 inglés/francés, empezar alemán). Quiere una plataforma con memoria que genere preguntas, suba la dificultad con aciertos/errores, explique bajo demanda y "invite a jugar".
2. **«The Infinite Mind»**: RPG intelectual con grafo de conocimiento, 6 niveles cognitivos por concepto, modos Feynman/Debate/Counterfactual, memoria en 5 capas, detector de "ilusión de dominio".
3. **«ONE»** (Carlos pide simple y móvil): una pantalla, un botón JUGAR, la IA decide todo, swipes, feed infinito tipo TikTok, tres pestañas (Jugar/Progreso/Mapa), boss battles.
4. **Cero teclado, cero voz** (Carlos): 11 mecánicas sin escribir (tap, swipe V/F, ordenar, emparejar, árbol de decisión, "encuentra el error", conectar conceptos, sliders, manipular modelos, idiomas por audio+imagen).
5. **«MIND & BODY» spec v1.0** (Carlos pide onboarding holístico, calibración, métricas, barras, y una segunda sección "brazo musculoso" para gimnasio): 91 secciones, 7 métricas globales, cerebro visual por regiones, Body Engine con progresión automática, Flow Engine, quests, 6 sprints, stack React Native + Expo + Supabase.
6. **Astra vs Fable**: ChatGPT recomienda Fable 5.1 como constructor y Astra como revisor, y (con razón) recorta: no empezar por el Knowledge Graph, no generar cada pregunta en vivo, IA como componente dentro de una arquitectura determinista.

Decisiones de Carlos en esta sesión: **uso personal diario** (un solo usuario), y el concepto **no es confidencial** (pasada adversarial en OpenRouter gratis, hecha con `nvidia/nemotron-3-ultra-550b-a55b:free`, coste 0).

## Mi opinión (ya corregida con la pasada adversarial)

1. **El núcleo es bueno y la mejor versión es la intermedia («ONE» + cero teclado)**: un juego infinito de preguntas sin escribir, con memoria y dificultad adaptativa, una pantalla y un botón. Resuelve el problema real ("leer me aburre") y es construible.
2. **La spec MIND & BODY se ha inflado**: 91 secciones, 7 métricas "cognitivas", cerebro por regiones, Body Engine, Flow Engine, quests, idiomas con audio. Es un producto de 12-18 meses para un equipo. Para un usuario el 80 % sobra. El propio ChatGPT lo recorta al final.
3. **Las "métricas cognitivas" son ficción de interfaz**. "Transfer 63", "Reasoning 76", "Calibration" no tienen base de medida. Lo que sí se puede medir con preguntas cerradas: por concepto, acierto reciente y estabilidad de memoria (FSRS con parámetros por defecto, que funcionan desde el primer día; la dificultad inicial de cada pregunta la estima el generador y se corrige con las primeras respuestas). Cada componente visual lleva un dato real asignado: barra de dominio = estabilidad media FSRS del tema; mapa de calor = aciertos por día; KPI = racha, repasos de hoy, conceptos estables.
4. **El riesgo técnico número uno es la veracidad de las preguntas**. No hay cifra fiable de tasa de error de los modelos gratis (ni la mía ni la del revisor): se mide en el primer lote de 200 con Carlos revisando su dominio. Mitigación: generar en lote, verificar con un segundo modelo de otra familia, `confianza` por pregunta, botón "esta pregunta está mal".
5. **CUERPO**: recomiendo secuenciarlo, no eliminarlo. MENTE es la parte con incógnita (¿engancha el bucle?); el registro de series es determinista y ya lo hacen bien Hevy o Strong. Propuesta: MENTE en el primer sprint, CUERPO mínimo (rutina fija, series por tap, una métrica de fatiga) en el segundo. **Decisión de Carlos**, porque lo pidió expresamente.
6. **"Cero teclado" excluye Feynman y Debate, pero no los Boss Battles**: con árbol de decisión, "encuentra el error" y conectar conceptos cabe un boss semanal sin texto libre. Entra en v0.
7. **La pregunta "Astra o Fable" está mal planteada**: ya pagas Claude Max con Claude Code; la comparación con el Plus de 23 € no aplica. Se construye aquí con el mismo método que ha funcionado en el motor (spec → plan → subagentes → pasada adversarial). El modelo que corre DENTRO de la app no es Fable ni Astra: modelos baratos generando en lote.
8. **Stack: PWA (web instalable) antes que React Native + Expo**. Uso personal, iPhone, sin tienda. Instalada desde Safari va a pantalla completa, con icono, y desde iOS 16.4 admite notificaciones; el almacenamiento de una web instalada no sufre el borrado a los 7 días que aplica a las webs normales. El revisor afirmó lo contrario y es incorrecto. Lo que sí es cierto: el estado (progreso, FSRS) vive en Postgres en el VPS, y el móvil solo lo cachea. Reutiliza todo lo que este proyecto ya sabe (Node sin framework, Postgres, Playwright, VPS con backups y TLS). Se pierde háptica fina. Si un día es producto, entonces Expo.
9. **Momento**: dos opciones, decide Carlos. (a) Después del 5-oct, con el lanzamiento cerrado. (b) Tres sprints de tarde-noche en septiembre, aceptando que restan tiempo y cuota al lanzamiento. Un "prototipo de fin de semana" no sirve para probar 7 días de uso: la v0 mínima son ~2 semanas de trabajo.
10. **Coste de explotación** (estimación; catálogo a consultar al construir): generación con modelos gratis y verificación con un modelo de pago barato, unos 2-6 € al mes para 50 preguntas/día. No es cero: la verificación duplica llamadas. Los modelos `:free` tienen límites de peticiones y rotan sin aviso, así que hace falta caída automática a un modelo de pago y un colchón de preguntas verificadas para 7 días.
11. **Riesgo no contemplado antes**: el LLM genera "temario de manual". Para que no sea trivia genérica, v1 (no v0) debería admitir fuentes propias (PDFs, artículos) y generar preguntas ancladas a ellas. Encaja con el problema de fondo: aprender de lo que quieres leer sin leerlo. Nada de CT Advisory ni de clientes sale a modelos gratis por esa vía.

## Qué reutilizar de CT Advisory (inventario verificado en el repo)

**Llevar, en este orden de prioridad:**
- `agente/scripts/model-provider.js` (capa multiproveedor sin SDKs) + tabla `ai_calls` + `logAiCall`/`costUsd`/`tarifaVigente` de `lib.js`. Es lo que permite la caída gratis → pago y saber cuánto se gasta. Se deja fuera, de momento, `modelo_por_etapa`/`parametros_agente`: sobredimensionado para un pipeline de dos pasos (objeción aceptada).
- `web/WEALTH-BORRADOR/motor-perfil.js` + `tools/test-motor-perfil.js`: motor determinista adaptativo con test exhaustivo. Arquitectura del motor de dificultad.
- Cuestionario paso a paso ya construido: `herramienta.html:74-90` + `app-herramienta.js:129-293` (pasos, barra de progreso, donut SVG) + `wealth.css:497-511`.
- `modelo-finanzas.js`: modelo puro + persistencia separada + versión de esquema. Caché local del estado; la verdad está en Postgres.
- `motor-documentos/componentes.js`: `hBarChart`, `barraDeRango`, `heatmap`, `tarjetaKpi`, `escalaBonita`, `envolverTexto`, cada uno con su dato real asignado (punto 3).
- `web/tools/audit-frontend.js` + `audit-backend.js` + skills `frontend-audit` y `design`.
- CI: `agente/scripts/.github/workflows/tests.yml` + `tools/aplicar-migraciones.js` + `tools/correr-suites.js`.
- `agente/scripts/vps/backup-postgres.sh` y `salud-sistema.sh`: base `one` en el mismo Postgres del VPS hereda backup y salud.
- Subagente `openrouter` y los modelos `:free` ya probados, con la cautela del punto 10.
- La sección "Aprendizaje" del brief matinal (`brief.js:145-146`): 2 puntos diarios de actualidad que se convierten en 2-3 preguntas al día. El histórico de briefs da un primer lote de preguntas "de actualidad", que se suma (no sustituye) al lote de fundamentos.
- HUD, solo patrones: bucle de tool-use, gestión de hilo, captura de audio iOS si algún día hay voz.
- `design/tokens.md` (estructura), escala tipográfica de `medianoche.css`, `LEEME.md` del prototipo.

**Dejar:** todo leads/mandatos/facturas/compliance, `render-documento.js` y plantillas, auditor de PDF, workflows de n8n, web pública, `identidad-ct`, el HUD como aplicación.

**Construir desde cero:** streaming, PWA (manifest + service worker), gamificación (XP, niveles, racha, boss semanal), FSRS, banco de preguntas con pipeline generar→verificar→colchón, evaluación de respuestas, CUERPO mínimo.

## Pasada adversarial: qué se aceptó y qué no

Revisor: `nvidia/nemotron-3-ultra-550b-a55b:free`, 12 objeciones.
- **Aceptadas**: boss battles sí caben sin teclado (6); coste no es cero por la verificación y los modelos gratis son inestables (3, 7); asignar dato real a cada componente visual (9); sembrar preguntas con el brief (12); fuentes propias como v1 (8); el fin de semana no basta para validar (5, en parte).
- **Aceptadas a medias**: CUERPO pasa de "fuera" a "segundo sprint, decide Carlos" (4); la capa multiproveedor se recorta a lo mínimo (10); FSRS con parámetros por defecto desde el día uno, sin esperar 40 repasos por tarjeta como decía el revisor (2); el momento pasa de recomendación a decisión de Carlos (5).
- **Rechazadas, con motivo**: las webs instaladas en iPhone sí van a pantalla completa, sí reciben notificaciones desde iOS 16.4 y no sufren el borrado de datos a los 7 días (1); el paper citado sobre alucinación de modelos gratis no existe, la cifra se mide en vez de citarse (3, en parte); `modelo-finanzas.js` no es crítico si la verdad está en el servidor (11).

## Decisiones de Carlos (8-sep-2026)

- Uso personal, un solo usuario. Concepto no confidencial.
- **MENTE primero; CUERPO mínimo en el segundo sprint.**
- **El cuándo se decide con el plan, el coste y las sesiones delante** (abajo). Nada se construye hasta que Carlos elija.

## Plan propuesto, con sesiones y coste

Una "sesión" es una sesión de Claude Code de 2-3 horas, con subagentes y pasada adversarial gratis incluidas, como las del motor. La cuota semanal del plan Max no se puede medir desde aquí (`~/.claude/CLAUDE.md`, regla 2); la referencia real es el plan de lanzamiento: 31 sesiones para cinco fases.

### Sprint 1 · MENTE v0 (≈ 8 sesiones, ~2 semanas de calendario)

| # | Qué | Sesiones | Modelo de la sesión | Dinero real |
|---|---|---|---|---|
| 1 | Memoria del proyecto + repo `one` + brainstorming (`superpowers:brainstorming`) → spec v0 | 1 | Opus/Fable · high | 0 |
| 2 | Plan SDD + esqueleto: base `one` en el Postgres del VPS, migraciones 001-003, extracción de módulos (model-provider, coste, motor determinista, cuestionario, audit) | 1-2 | Sonnet · medium-high | 0 |
| 3 | Pipeline de preguntas: generar (gratis, caída a pago) → verificar (otro modelo) → banco con `confianza` → colchón 7 días → botón "está mal" | 2 | Sonnet · high | 0 |
| 4 | Primer lote: 200 de fundamentos (economía/finanzas) + histórico del brief. Carlos revisa 30 y se mide la tasa de error | 0,5 | subagente `openrouter` | ~0,10-0,30 € (verificación con modelo de pago barato; cifra exacta con el catálogo delante, regla 5) |
| 5 | PWA: pantalla JUGAR, 3 mecánicas (swipe V/F, test de 4, ordenar), FSRS, progreso con datos reales | 2 | Sonnet · high | 0 |
| 6 | Boss semanal + racha + auditoría visual (Playwright a 375 px) + despliegue en el VPS (contenedor nuevo, TLS por Tailscale) | 1 | Sonnet · medium | 0 |
| 7 | Pasada adversarial de la rama completa + correcciones + 7 días de uso real en el iPhone | 1 | Opus · high + OpenRouter gratis | 0 |

**Criterio de salida del sprint 1**: Carlos vuelve solo 7 días seguidos. Si no, se para y se archiva.

### Sprint 2 · CUERPO mínimo (≈ 3-4 sesiones)

Rutina fija, series por tap, una métrica de fatiga que baja la dificultad de MENTE ese día; misma PWA. Solo si el sprint 1 supera su criterio.

### Después (sin estimar todavía)

Más dominios, alemán, fuentes propias (PDFs → preguntas), conexiones entre dominios, texto libre (Feynman/Debate).

### Coste de explotación (Carlos, 8-sep: la verificación también con otro modelo barato)

| Concepto | Estimación mensual | Nota |
|---|---|---|
| Generación de preguntas (modelo gratis) | 0 € | Con caída a pago si falla, anunciada antes |
| Verificación (otro modelo gratis, de otra familia) | 0-2 € | 50 preguntas/día; el de pago solo como caída; cifra exacta con el catálogo delante antes de la primera llamada |
| VPS, Postgres, backups, TLS | 0 € extra | Reutiliza el VPS de IONOS ya pagado |
| Tienda de apps, cuentas, dominio | 0 € | PWA instalada desde Safari |

### Cuota semanal del plan Max para el piloto (estimación, no medición)

No hay forma de medir la cuota desde un agente (`/usage` es interactivo). Estimación por horas de modelo, que es como se define el plan (Max 20x ≈ 24-40 h/semana de Opus o 240-480 h de Sonnet, bolsa compartida):

| Tipo de sesión | Cuántas | Horas de modelo | Parte de la cuota semanal |
|---|---|---|---|
| Opus · high (spec v0, pasada final) | 2 | ~6 h | ~15-25 % del cupo de Opus |
| Sonnet · medium-high (esqueleto, pipeline, PWA, boss, despliegue) | 6 | ~18 h | ~4-8 % del cupo de Sonnet |

**Piloto completo: 20-30 % de una semana si se concentra, 10-15 % por semana si se reparte en dos.** Fable consume más que Opus: ninguna sesión mecánica va en Fable. **Calibración real**: Carlos escribe `/usage` antes y después de la sesión 1 y con esos dos porcentajes se recalculan las 7 restantes.

### Cuándo (a decidir por Carlos con esto delante)

- **(a) Tras el 5-oct**: 8 sesiones en octubre, lanzamiento intacto.
- **(b) En septiembre, en paralelo**: 8 sesiones equivalen a ~un cuarto de las 31 del lanzamiento; se restan de ahí o se hacen en tardes extra.
- **(c) Solo la sesión 1 ahora** (memoria + spec v0, coste 0, una sesión) y el resto tras el 5-oct.

## Verificación

- Análisis atacado por otro modelo; objeciones resueltas o declaradas arriba.
- La spec v0, cuando exista, se verifica con el prototipo en el iPhone real; antes, Playwright headless a 375 px (regla "no medir en el Chrome de Carlos").
