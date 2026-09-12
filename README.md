# ONE

App personal de Carlos Torres para aprender sin leer: un juego de preguntas sin teclado (swipe, tap, ordenar), con memoria, repetición espaciada y dificultad adaptativa. Una pantalla, un botón.

Proyecto independiente de CT Advisory: repo propio, sin datos de negocio. Contenido no confidencial (las preguntas y el código pueden salir a modelos gratuitos de OpenRouter).

**App publicada**: https://carlostorresadvisory.github.io/one/ (GitHub Pages, desde `main`).

## Estado (13-sep-2026, v0.1c en rama `v0.1c-mazo-vertical`, pendiente de publicar)

- **Qué hay**: PWA instalable desde Safari. La partida es un **mazo vertical** de 10 tarjetas a pantalla completa: deslizas arriba para la siguiente y abajo para volver; puedes pasar una pregunta y volver a ella; la respuesta queda fija al darla, pero la **confianza** (Baja/Media/Alta, dentro de la tarjeta, tras el enunciado, opcional) se puede cambiar incluso después de responder y recalcula XP y consolidación. 4 mecánicas sin teclado (swipe o botones V/F, test de 4, ordenar por taps, encuentra el error). Al responder, la explicación aparece siempre dentro de la tarjeta (las respuestas se pliegan si no cabe; nunca hay scroll ni cambia el tamaño de letra), con botones **Preguntar a** ChatGPT / Claude / Gemini que abren la web con el prompt ya escrito, e **imagen de Wikimedia Commons** con atribución cuando la pregunta la tiene. Escalera adaptativa (`nivelPartida` 1-5: sube cada 2 aciertos seguidos, baja 1 por fallo), nivel por área, repaso espaciado Leitner (1-3-7-14-30 días), racha, XP y combo. Hub con radar de 8 áreas, nota S+…D, Misión de hoy y Pendientes. El resumen final es otro mazo vertical: cifras, una tarjeta por pregunta fallada o frágil (con Preguntar a e imagen) y Otra partida / Inicio. Estado en `localStorage`; no hay servidor.
- **Banco**: `datos/banco.json`, **295 preguntas** en 8 áreas, generadas y verificadas con el criterio de utilidad de `tools/criterio.js` (entender el mundo, conversar con criterio, curiosidades memorables, enlace con la actualidad; nada de siglas, puertos, versiones ni fechas sueltas). Renovación del 12-sep: 482 verificadas → fuera 58 duplicadas y 158 de utilidad 1/5; distribución final de utilidad 2: 61 · 3: 39 · 4: 103 · 5: 92. Rechazadas con motivo en `datos/rechazadas.json`; puntuaciones en `datos/utilidad.json`. 105 preguntas con imagen en `datos/imagenes.json`. Coste acumulado del pipeline: < 0,15 $.

- **Pendiente de Carlos**: revisar `docs/revision-utilidad-2026-09-12.md` (3 preguntas nuevas por área con su nota de utilidad) y probar v0.1c en el iPhone cuando esté publicada.

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

## Siguiente (v0.2, por orden)

1. **Generación continua e inteligente** (el concepto central): dos modos. *Normal*: el motor pide por detrás preguntas nuevas para las áreas y niveles flojos. *Átomo*: al tocar un área se abre un núcleo con sus subtemas orbitando (primer anillo = hilos de `tools/criterio.js`), se afina anillo a anillo sin teclado y abajo siempre **Generar**. Servidor mínimo en el VPS de IONOS con la clave; **la verificación nunca se salta, se esconde** con un colchón verificado por delante (~30 preguntas) y una sola llamada que devuelve correcta / útil / nivel; mientras se genera, se juega banco o repaso. Detalle en la spec v0.1c §8.
2. Imágenes: repetir `node tools/buscar-imagenes.js --revalidar --aplicar` cuando los modelos gratis respondan (unas 50 imágenes solo pasaron el filtro de relevancia básico); ampliar cobertura en economía y tecnología con gráficos y mapas.
3. Boss estilo esfinge (por diseñar con Carlos); FSRS en lugar de Leitner cuando haya datos; extraer `montarMazo`/`ajustarEncaje` de `app.js` (~1.900 líneas) a un módulo propio.

Después: v1 (servidor + Postgres en el VPS, fuentes propias, CUERPO mínimo) y v2 (feed vertical infinito tipo TikTok; el mazo de v0.1c es su germen). Detalle en la spec.

## Reglas heredadas

Las de `~/.claude/CLAUDE.md` (planificar por riesgo, modelo y effort más eficientes, pasada adversarial antes de entregar, cifra exacta antes de gastar, preguntar cuando la respuesta mejore el resultado).
