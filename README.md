# ONE

App personal de Carlos Torres para aprender sin leer: un juego de preguntas sin teclado (swipe, tap, ordenar), con memoria, repetición espaciada y dificultad adaptativa. Una pantalla, un botón.

Proyecto independiente de CT Advisory: repo propio, sin datos de negocio. Contenido no confidencial (las preguntas y el código pueden salir a modelos gratuitos de OpenRouter).

**App publicada**: https://carlostorresadvisory.github.io/one/ (GitHub Pages, desde `main`).

## Estado (12-sep-2026, v0 jugable)

- **Qué hay**: PWA instalable desde Safari. Partida de 10 preguntas, 4 mecánicas sin teclado (swipe o botones V/F, test de 4, ordenar por taps, encuentra el error). Escalera adaptativa inmediata (`nivelPartida` 1-5: sube por acierto, baja por fallo, persiste), nivel por área como memoria lenta, repaso espaciado Leitner (1-3-7-14-30 días), racha, XP y combo. Nivel visible en cada tarjeta y en el feedback. Selector de confianza Baja/Media/Alta antes de responder (Alta acertada ×1,5 XP; Baja acertada cuenta pero no consolida; Alta fallada entra en Pendientes con prioridad), "esta pregunta está mal", practicar solo un área desde el hub, exportar/importar el estado. Flujo: inicio 🧠/💪 → hub (radar de 8 áreas, nota S+/S/A/B/C/D por área, KPIs, "Comenzar") → partida; acierto avanza solo en ~1,4 s, fallo muestra la explicación; chip "Recuperada" al acertar algo que fallaste, "Misión de hoy" (3 preguntas de tus 2 áreas flojas) y "Pendientes" en el hub, radar con relleno de conocimiento sólido, carrusel "Para repasar" al final de la partida; ninguna pantalla hace scroll (lo comprueba el e2e). Estado en `localStorage` del dispositivo; no hay servidor.
- **Banco**: `datos/banco.json`, **323 preguntas verificadas y auditadas** en 8 áreas (economía, historia, ciencia, tecnología, geografía, filosofía, arte, lógica), niveles 1-5. Generadas por modelos gratuitos y verificadas por un segundo modelo de otra familia y auditadas al completo por un tercero (cascada gratis → de pago barato con tope), más revisión manual de los 77 ejercicios de ordenar. 77 rechazadas con motivo en `datos/rechazadas.json`. Coste total de la generación y verificación del 12-sep: 0,023 $.
- **Verificación**: 121 tests del motor y del pipeline (`npm test`), 2 tests e2e con Playwright a 375×812 (`npm run e2e`) con capturas en `docs/capturas/`, dos pasadas adversariales con modelos gratuitos (motor y UI) con sus objeciones resueltas o declaradas en la sesión.
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

## Imágenes (Wikimedia Commons)

`datos/imagenes.json` (`{id: {...}}`) da una imagen de apoyo a las preguntas donde de verdad aporta: la obra en arte, un mapa o foto del lugar en geografía, la persona/lugar/documento en historia, el fenómeno visible en ciencia. Nunca decoración, y nunca en preguntas abstractas (definiciones, lógica formal, economía conceptual) salvo que haya algo concreto que mostrar.

```
node tools/buscar-imagenes.js [--area X] [--solo-pendientes] [--limite N] [--aplicar]
```

Sin `--aplicar` solo informa (no toca disco). Tres pasos, sin ningún dato confidencial: (A) un modelo `:free` decide si la pregunta se beneficia de imagen y propone términos de búsqueda en inglés; (B) la API pública de Commons (sin clave) busca esos términos y se queda con el primer resultado con licencia libre, tamaño mínimo y tipo de fichero válidos; (C) un modelo `:free` comprueba que la imagen encontrada ilustra de verdad la respuesta correcta, no solo el tema general, y descarta las que no.

**Licencias admitidas**: Public domain, CC0, CC BY (cualquier versión) y CC BY-SA (cualquier versión). Se rechazan siempre: NC (no comercial), ND (sin obra derivada), "fair use" y cualquier imagen sin licencia clara. Cada entrada guarda `autor`, `licencia` y `pagina` (el enlace a la página de Commons): la interfaz debe mostrar esa atribución (autor · licencia · enlace) junto a la imagen. `tools/validar-banco.js` comprueba, si existe `datos/imagenes.json`, que cada id está en el banco, que la url es https de `upload.wikimedia.org` y que la licencia es una de las permitidas.

## Documentos

- Spec v0 y hoja de ruta: `docs/superpowers/specs/2026-09-12-one-v0-design.md`
- Plan de implementación: `docs/superpowers/plans/2026-09-12-one-v0.md`
- Análisis del concepto (8-sep) y conversación de origen: `docs/2026-09-08-*.md`

## Siguiente (v0.1, por orden)

1. **Generación continua**: reposición automática por área y nivel cuando el pozo baja de 10 sin responder (con la escalera, ~5 preguntas por nivel y área se agotan en días).
2. Boss semanal (idea de Carlos: estilo esfinge, por diseñar); FSRS en lugar de Leitner cuando haya datos; exportar las preguntas reportadas para depurar el banco.

Después: v1 (servidor + Postgres en el VPS, fuentes propias, CUERPO mínimo) y v2 (feed vertical infinito tipo TikTok). Detalle en la spec.

## Reglas heredadas

Las de `~/.claude/CLAUDE.md` (planificar por riesgo, modelo y effort más eficientes, pasada adversarial antes de entregar, cifra exacta antes de gastar, preguntar cuando la respuesta mejore el resultado).
