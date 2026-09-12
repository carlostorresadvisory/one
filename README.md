# ONE

App personal de Carlos Torres para aprender sin leer: un juego de preguntas sin teclado (swipe, tap, ordenar), con memoria, repetición espaciada y dificultad adaptativa. Una pantalla, un botón.

Proyecto independiente de CT Advisory: repo propio, sin datos de negocio. Contenido no confidencial (las preguntas y el código pueden salir a modelos gratuitos de OpenRouter).

**App publicada**: https://carlostorresadvisory.github.io/one/ (GitHub Pages, desde `main`).

## Estado (12-sep-2026, v0 jugable)

- **Qué hay**: PWA instalable desde Safari. Partida de 10 preguntas, 4 mecánicas sin teclado (swipe o botones V/F, test de 4, ordenar por taps, encuentra el error). Escalera adaptativa inmediata (`nivelPartida` 1-5: sube por acierto, baja por fallo, persiste), nivel por área como memoria lenta, repaso espaciado Leitner (1-3-7-14-30 días), racha, XP y combo. Nivel visible en cada tarjeta y en el feedback. Botón "No lo sé" (fallo sin culpa, contado aparte), "esta pregunta está mal", practicar solo un área desde Progreso, exportar/importar el estado. Estado en `localStorage` del dispositivo; no hay servidor.
- **Banco**: `datos/banco.json`, **335 preguntas verificadas** en 8 áreas (economía, historia, ciencia, tecnología, geografía, filosofía, arte, lógica), niveles 1-5. Generadas por modelos gratuitos y verificadas por un segundo modelo de otra familia (cascada gratis → de pago barato con tope). 65 rechazadas con motivo en `datos/rechazadas.json`. Coste total de la generación y verificación del 12-sep: 0,023 $.
- **Verificación**: 74 tests del motor y del pipeline (`npm test`), 2 tests e2e con Playwright a 375×812 (`npm run e2e`) con capturas en `docs/capturas/`, dos pasadas adversariales con modelos gratuitos (motor y UI) con sus objeciones resueltas o declaradas en la sesión.
- **Pendiente de Carlos**: revisar `docs/revision-muestra-2026-09-12.md` (30 preguntas al azar) para medir la tasa de error real del banco.

## Cómo instalarla en el iPhone

Abrir la URL en Safari → botón Compartir → "Añadir a pantalla de inicio". Se abre a pantalla completa, con icono. Las actualizaciones llegan solas: el service worker sirve la copia guardada y baja la nueva en segundo plano, así que un cambio se ve en la **segunda** apertura.

## Cómo trabajar en el repo

```
npm test              # motor + pipeline (node --test)
npm run e2e           # Playwright a 375 px (instala antes: npm i && npx playwright install chromium)
npm run servir        # http://localhost:8765  (añade ?ejemplo=1 para el banco de ejemplo)
```

Pipeline de preguntas (requiere `OPENROUTER_API_KEY` en el entorno; nunca en el repo):

```
node tools/generar-preguntas.js [--area economia] [--tipos vf,test4] [--cantidad 6]   # borradores → datos/borradores/
node tools/verificar-preguntas.js --solo-pendientes                                  # verifica lo nuevo → datos/banco.json
node tools/validar-banco.js                                                          # esquema, ids, mínimos por área
node tools/revisar-muestra.js --n 30                                                 # muestra en Markdown para revisar a mano
```

Por defecto solo se usan modelos `:free`. La cola de pago barato de la cascada (`tools/openrouter.js`, `MODELOS`) solo se recorre con `--permitir-pago --tope-eur N`; el gasto queda en `datos/llamadas.log` (ignorado por git).

## Documentos

- Spec v0 y hoja de ruta: `docs/superpowers/specs/2026-09-12-one-v0-design.md`
- Plan de implementación: `docs/superpowers/plans/2026-09-12-one-v0.md`
- Análisis del concepto (8-sep) y conversación de origen: `docs/2026-09-08-*.md`

## Siguiente (v0.1, por orden)

1. **Generación continua**: reposición automática por área y nivel cuando el pozo baja de 10 sin responder (con la escalera, ~5 preguntas por nivel y área se agotan en días).
2. **Inicio nuevo** (ideas de Carlos, 12-sep): fondo dinámico como ctadvisory.es, 🧠 clicable → stats, 💪 apagado ("pronto", será CUERPO), botón "Comenzar"; las stats antes de las preguntas.
3. Boss semanal con "elige el camino"; FSRS en lugar de Leitner cuando haya datos; exportar las preguntas reportadas para depurar el banco.

Después: v1 (servidor + Postgres en el VPS, fuentes propias, CUERPO mínimo) y v2 (feed vertical infinito tipo TikTok). Detalle en la spec.

## Reglas heredadas

Las de `~/.claude/CLAUDE.md` (planificar por riesgo, modelo y effort más eficientes, pasada adversarial antes de entregar, cifra exacta antes de gastar, preguntar cuando la respuesta mejore el resultado).
