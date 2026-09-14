# ONE

App personal de Carlos Torres para aprender sin leer: un juego de preguntas sin teclado (swipe, tap, ordenar), con memoria, repetición espaciada y dificultad adaptativa. Una pantalla, un botón.

Proyecto independiente de CT Advisory: repo propio, sin datos de negocio. Contenido no confidencial (las preguntas y el código pueden salir a modelos gratuitos de OpenRouter).

**App publicada**: https://carlostorresadvisory.github.io/one/ (GitHub Pages, desde `main`).

## Estado (15-sep-2026, v0.2b3 publicada)

- **Qué hay**: PWA instalable desde Safari. La partida es un **mazo vertical** de 10 tarjetas a pantalla completa: deslizas arriba para la siguiente y abajo para volver; puedes pasar una pregunta y volver a ella; la respuesta queda fija al darla, pero la **confianza** (Baja/Media/Alta, dentro de la tarjeta, tras el enunciado, opcional) se puede cambiar incluso después de responder y recalcula XP y consolidación. 4 mecánicas sin teclado (swipe o botones V/F, test de 4, ordenar por taps, encuentra el error). Al responder, la explicación y la **imagen de Wikimedia Commons** (con atribución, cuando la pregunta la tiene) aparecen siempre dentro de la tarjeta, sin scroll y sin ningún toque para desplegar nada: si no cabe, ceden primero las respuestas (a una línea, luego fuera), después el enunciado (menor, luego fuera) y solo al final la explicación baja un paso de tamaño; la imagen nunca se quita, solo se encoge hasta una franja mínima. Debajo, **Preguntar a** ChatGPT / Claude / Gemini (icono con su nombre) abre la web con un prompt constructivo ya escrito, y una fila compacta con "esta pregunta está mal" y "Siguiente ›". El gesto se indica con dos chevrones animados de poca opacidad al pie de la tarjeta (se apagan al primer deslizamiento de la sesión) y un contador 3/10 en la cabecera. **v0.1e**: cuando la pregunta no tiene imagen, la tarjeta respondida dibuja un **visual de datos** (fórmula, línea de tiempo, barras, comparación, flujo o dato) generado y verificado por dos modelos distintos (`visuales.js`, ver sección Visuales); las explicaciones bajan a 40 palabras; el enunciado se ve entero antes de responder (sin recorte fijo ni toques; si no cabe, baja a 15 px, se compactan las opciones y solo al final se recorta); el cierre pregunta "¿Seguro que quieres terminar?". Escalera adaptativa (`nivelPartida` 1-5: sube cada 2 aciertos seguidos, baja 1 por fallo), nivel por área, repaso espaciado Leitner (1-3-7-14-30 días), racha, XP y combo. Hub con radar de 8 áreas, nota S+…D, Misión de hoy y Pendientes. El resumen final es otro mazo vertical: cifras, una tarjeta por pregunta fallada o frágil (con Preguntar a e imagen) y Otra partida / Inicio. Estado en `localStorage`; no hay servidor.
- **v0.2 (14-sep)**: **Repaso siempre accesible e infinito** (botón Repaso del HUB → mazo vertical sin fin con todo el banco: primero las respondidas por prioridad de repaso, después las no respondidas ya reveladas para leer; filtro por área; aprendizaje pasivo, no se responde desde ahí). **Servidor de generación** desplegado en `https://one.ctadvisory.es` (ver "Servidor (v0.2)"). **Cliente conectado**: la app se enlaza al servidor una sola vez abriendo `https://carlostorresadvisory.github.io/one/?servidor=https://one.ctadvisory.es&token=<TOKEN_ONE>` (queda en `localStorage` `one.servidor`, la URL se limpia); al abrir y al acabar cada partida manda su resumen (`POST /estado`) y recibe preguntas nuevas verificadas (`one.bancoExtra`, chip "N preguntas nuevas"; punto gris/verde/ámbar junto a Comenzar). **Átomo**: mantener pulsada un área del HUB (o su botón ⚛) abre el núcleo con sus subtemas orbitando; se afina por anillos y **Generar** pide una tanda de 10 al servidor; mientras se genera se puede jugar o repasar; al terminar, chip "Tanda lista: N" (o la propia pantalla de espera si sigues en ella). Sin servidor configurado la app se comporta exactamente como antes y no hace ninguna petición. **v0.2b3 (15-sep)**: el átomo es un árbol que se abre al tocar (sin órbita giratoria; el texto va dentro de los nodos; al tocar cambian núcleo y ruta al instante y aparecen nodos de espera; mientras carga o genera se ofrece "Jugar el área" y "Repasar"); nodo **"Más…"** en cada anillo (páginas nuevas del servidor, hasta 6 anillos) y hilos de finanzas corporativas y M&A, reestructuraciones, inversión y banca en la puerta de Economía y física moderna en Ciencia; **Conectar** desde la app instalada tocando el punto de estado y pegando el enlace (iOS separa el almacenamiento de la app instalada del de Safari); el servidor genera primero con **Gemini gratis** (`gemini-flash-lite-latest` / `gemini-3.6-flash`, coste 0) y cae a los `:free` de OpenRouter.
- **Banco**: `datos/banco.json`, **295 preguntas** en 8 áreas, generadas y verificadas con el criterio de utilidad de `tools/criterio.js` (entender el mundo, conversar con criterio, curiosidades memorables, enlace con la actualidad; nada de siglas, puertos, versiones ni fechas sueltas). Renovación del 12-sep: 482 verificadas → fuera 58 duplicadas y 158 de utilidad 1/5; distribución final de utilidad 2: 61 · 3: 39 · 4: 103 · 5: 92. Rechazadas con motivo en `datos/rechazadas.json`; puntuaciones en `datos/utilidad.json`. **167 preguntas con imagen** en `datos/imagenes.json` (criterio de cobertura ampliado el 13-sep y revalidación completa con un modelo que VE la miniatura) y **98 con visual de datos** en el campo `visual` de `datos/banco.json` (2 tienen ambas cosas y muestran la imagen): **263/295 (89 %)** con algo visual; las 32 restantes son conceptos abstractos de economía, lógica, filosofía y tecnología sin imagen libre ni cifra publicada. Explicaciones ≤ 40 palabras en 293/295 (las largas originales en `datos/explicaciones-largas.json`). Coste acumulado del pipeline: < 0,15 $.
- **Verificación**: 455 tests (`node --test tests/*.test.js`: motor, pipeline, servidor, sincronización, átomo), 64 tests e2e con Playwright (`npx playwright test`) a 375×812, 393×852 con zonas seguras y 430×932 (el servidor se simula con `page.route`, nunca se llama al real) con capturas en `docs/capturas/` (incluidas `docs/capturas/430x932/`), más una pasada adversarial (revisor final + adversarial gratis) con sus hallazgos arreglados o refutados con motivo (v0.1c en `ola-final-report.md`, v0.1d en `adversarial-v01d-triage.md`, ambos en `.superpowers/sdd/2026-09-12-one-v0.1c-mazo-vertical/`, carpeta git-ignored).

- **Pendiente de Carlos**: revisar `docs/revision-utilidad-2026-09-12.md` (3 preguntas nuevas por área con su nota de utilidad) y probar v0.1e en el iPhone (visuales de datos en las tarjetas sin imagen, explicaciones cortas, enunciado entero, tarjeta hasta abajo).

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

`datos/imagenes.json` (`{id: {...}}`) da una imagen de apoyo a las preguntas donde de verdad aporta, con criterio amplio: la obra en arte, un mapa o foto del lugar en geografía, la persona/lugar/documento en historia, el fenómeno visible en ciencia, un retrato de persona nombrada, un gráfico o diagrama reconocible del fenómeno (curvas de oferta y demanda, inflación, redes), una portada o fotograma de una obra de cine/literatura, o un edificio/objeto concreto. Nunca decoración, y nunca en lógica formal, definiciones puras ni preguntas sin referente visual.

```
node tools/buscar-imagenes.js [--area X] [--solo-pendientes] [--limite N] [--aplicar]
node tools/buscar-imagenes.js --revalidar [--aplicar]
node tools/buscar-imagenes.js --revalidar-visual [--limite N] [--aplicar]
```

Sin `--aplicar` solo informa (no toca disco). Tres pasos para encontrar candidatas, sin ningún dato confidencial: (A) un modelo `:free` decide si la pregunta se beneficia de imagen y propone hasta 3 términos de búsqueda alternativos en inglés; (B) la API pública de Commons (sin clave) busca esos términos y se queda con el primer resultado con licencia libre, tamaño mínimo y tipo de fichero válidos; (C) un modelo `:free` comprueba **por título y descripción** que la imagen encontrada ilustra de verdad la respuesta correcta, no solo el tema general, y descarta las que no. `--revalidar` repite solo el paso C sobre lo ya guardado.

**`--revalidar-visual`**: paso adicional que un modelo `:free` **con visión** (`inclusionai/ling-3.0-flash-vl:free`, con reserva en `google/gemma-4-31b-it:free` y `google/gemma-4-26b-a4b-it:free`) hace VIENDO la miniatura de la imagen (pedida a la API de Commons a 400px, no construida a mano: Wikimedia solo sirve por URL directa los anchos ya generados/cacheados de antes), no solo leyendo el título — detecta lo que el paso C por texto no puede ver (recortes, homónimos con foto real pero de otra persona, imagen borrosa o genérica pese a un título correcto). Se aplica sobre TODAS las imágenes guardadas, nuevas y viejas. Descarta solo lo que el modelo marca `relevante:false`; lo que no responde tras 2 intentos se CONSERVA marcado `revalidacionVisual: "pendiente"` (con `--solo-pendientes` se revisa solo eso; lo aprobado lleva `revalidacionVisual: "ok"`). Con `--permitir-pago --tope-eur N` hay un último escalón de visión de pago (`google/gemini-2.5-flash-lite`). Guarda progreso parcial en `datos/imagenes.json` tras cada lote de 15 (con `--aplicar`), con backoff de 30/60/120s si la cascada de modelos gratis se satura.

**Licencias admitidas**: Public domain, CC0, CC BY (cualquier versión) y CC BY-SA (cualquier versión). Se rechazan siempre: NC (no comercial), ND (sin obra derivada), "fair use" y cualquier imagen sin licencia clara. Cada entrada guarda `autor`, `licencia` y `pagina` (el enlace a la página de Commons): la interfaz debe mostrar esa atribución (autor · licencia · enlace) junto a la imagen. `tools/validar-banco.js` comprueba, si existe `datos/imagenes.json`, que cada id está en el banco, que la url es https de `upload.wikimedia.org` y que la licencia es una de las permitidas.

## Visuales de datos (v0.1e)

Cada pregunta debería tener un visual. Si no hay imagen de Commons, el campo `visual` de la pregunta lo dibuja la app con plantillas SVG propias (`visuales.js`): `formula`, `linea-tiempo`, `barras`, `comparacion`, `flujo` y `dato`, siempre **datos, nunca dibujo generado**. Los genera y verifica `tools/visualizar.js`:

```
node tools/visualizar.js [--solo-pendientes] [--area X] [--limite N] [--aplicar] [--permitir-pago --tope-eur N] [--sin-gratis]
node tools/visualizar.js --reverificar-visuales [--tipos barras,dato] [--aplicar] [--permitir-pago --tope-eur N]
```

Una llamada propone explicación ≤ 40 palabras y visual en JSON; otra llamada a un modelo DISTINTO verifica hechos y datos (reintento único; si falla, `visual: null` y motivo en `datos/visuales.log`; la verificación nunca se salta). `barras` y `dato` exigen `fuente` con institución y año (sin frases como "típico" o "aproximado") y el verificador debe reconstruir la cifra; para conceptos cualitativos se usan comparación, flujo, línea de tiempo o fórmula. `tools/validar-banco.js` valida el esquema y sus límites de longitud. El tope de gasto (`--tope-eur`) se compara con el gasto acumulado del día en `datos/llamadas.log`. **Nunca dos ejecuciones con `--aplicar` a la vez** (cada una reescribe `banco.json` entero). Las funciones `generarVisualYExplicacion` y `verificarVisualYExplicacion` son las que usará el servidor de v0.2 para cada pregunta nueva. Coste real del 13-sep: 0,34 $ para las 295 preguntas (incluidas dos pasadas de corrección).

## Servidor (v0.2)

`servidor/` es un servidor HTTP mínimo (Node 22, sin dependencias) que genera preguntas por detrás y las sirve verificadas: mantiene un "colchón" de ~30 preguntas ya verificadas en disco (`datos-servidor/colchon.json`) para que el móvil nunca espere a que se genere una pregunta al vuelo, y solo genera de verdad cuando el colchón baja del objetivo o alguien pulsa "Generar" en un átomo. Pensado para correr en un contenedor Docker en el VPS de IONOS, detrás de Caddy (HTTPS automático); ver `servidor/DESPLIEGUE.md` para los pasos completos.

```
npm run servidor      # arranca en local con TOKEN_ONE/RUTA_DATOS/etc. del entorno
```

Variables de entorno (ninguna con valor por defecto salvo la indicada): `TOKEN_ONE` (obligatoria: token de 32 bytes en hex para `Authorization: Bearer <token>`), `PUERTO` (por defecto 8787), `RUTA_DATOS` (por defecto `/datos-servidor`; en local puede ser una carpeta cualquiera), `PERMITIR_PAGO` (`0`/`1`, por defecto `0` = solo modelos `:free`), `TOPE_EUR_DIA`. `OPENROUTER_API_KEY` la lee `tools/openrouter.js` por su cuenta, nunca `servidor/index.js`.

Rutas (JSON, UTF-8; todas menos `/salud` exigen el token): `GET /salud` (estado del colchón y gasto de hoy, sin token), `POST /estado` (el móvil manda su resumen y recibe hasta `max` preguntas nuevas; dispara el relleno del colchón en segundo plano), `POST /generar` + `GET /trabajo/:id` (botón "Generar" del átomo, con prioridad alta), `POST /subtemas` (anillos del átomo: el primero es fijo, `tools/criterio.js`; los siguientes los propone el modelo y se cachean), `POST /reportar` ("esta pregunta está mal"). Límite de 64 KB por cuerpo, 60 peticiones/minuto por IP, CORS solo para `https://carlostorresadvisory.github.io` y `http://localhost:8765`. Cada hora, si son entre las 2:00 y las 7:00 (hora de Madrid), rellena el colchón hacia el objetivo con la cascada gratis, sin cron del host.

Tests: `tests/servidor-api.test.js` (servidor en puerto 0, `fetch`, sin red real: `producirTanda` y `llamar` inyectados como falsos). Despliegue: `servidor/Dockerfile`, `servidor/docker-compose.yml` (servicios `one-servidor` + `caddy`), `servidor/Caddyfile`, `servidor/desplegar.sh`, `servidor/.env.ejemplo`.

## Documentos

- Spec v0 y hoja de ruta: `docs/superpowers/specs/2026-09-12-one-v0-design.md`
- Plan de implementación: `docs/superpowers/plans/2026-09-12-one-v0.md`
- Análisis del concepto (8-sep) y conversación de origen: `docs/2026-09-08-*.md`

## Siguiente (v0.2, por orden)

0. **Hecho en v0.2b2 y v0.2b3** (cliente conectado, Átomo amplio y dinámico, Conectar, Gemini gratis; ver Estado). Siguientes, por orden: **v0.2a.2 protagonismo visual** (plan `docs/superpowers/plans/2026-09-14-one-v0.2a2-protagonismo-visual.md`, spec §8; Carlos, 14-sep 22:07: "todavía hay muchas tarjetas con demasiado texto y sin imágenes protagonistas"), **calidad de subtemas** del átomo en anillos ≥ 2 (prompt o modelo), **v0.2b1.1 cascada gratis robusta**.
1. **Generación continua e inteligente** (el concepto central, base ya construida en v0.2b): dos modos. *Normal*: el motor pide por detrás preguntas nuevas para las áreas y niveles flojos. *Átomo*: al tocar un área se abre un núcleo con sus subtemas orbitando (primer anillo = hilos de `tools/criterio.js`), se afina anillo a anillo sin teclado y abajo siempre **Generar**. Servidor mínimo en el VPS de IONOS con la clave; **la verificación nunca se salta, se esconde** con un colchón verificado por delante (~30 preguntas) y una sola llamada que devuelve correcta / útil / nivel; mientras se genera, se juega banco o repaso. Detalle en la spec v0.1c §8.
2. Visuales: cubrir las 32 preguntas sin imagen ni visual (o aceptar que son abstractas); cerrojo de fichero para que dos `--aplicar` no puedan solaparse; revisión humana periódica de `barras`/`dato`.
3. Boss estilo esfinge (por diseñar con Carlos); FSRS en lugar de Leitner cuando haya datos; extraer `montarMazo`/`ajustarEncaje` de `app.js` (2.372 líneas, `wc -l`) a un módulo propio.

Después: v1 (servidor + Postgres en el VPS, fuentes propias, CUERPO mínimo) y v2 (feed vertical infinito tipo TikTok; el mazo de v0.1c es su germen). Detalle en la spec.

## Reglas heredadas

Las de `~/.claude/CLAUDE.md` (planificar por riesgo, modelo y effort más eficientes, pasada adversarial antes de entregar, cifra exacta antes de gastar, preguntar cuando la respuesta mejore el resultado).
