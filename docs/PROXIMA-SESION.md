# Próxima sesión — ONE v0.3: plan con todo (feedback de Carlos del 6-oct)

## Dónde estamos
- **v0.3 fases 1-2 publicadas** el 6-oct-2026 (`main`, caché `one-v21`): sonido (zzfx), efectos, esfinge SVG, mochila + respaldo v3, modos + filtro de área/ruta con «Generar preguntas», hub nuevo (radar + 6 tarjetas + Comenzar), silencio persistente en la cabecera. Premio: solo Clásico con 10/10; Repaso nunca.
- Spec: `docs/superpowers/specs/2026-10-05-one-v0.3-tres-modos-design.md` (7 fases; las 3-7 —Apuesta, Más o menos/Afinar, Contrarreloj, Esfinge-tienda— sin hacer). Hay que **reescribir en su sitio** lo que el feedback de abajo cambia (regla LEAN).

## Feedback de Carlos tras probar en el iPhone (6-oct) — todo entra en el plan
1. **Faltan los modos de juego nuevos**: el hub enseña tarjetas que no llevan a ningún juego nuevo.
2. **Cada tarjeta, al tocarla, lleva directamente a su modo. Se quita el botón Comenzar.**
3. La sección de la esfinge se llama **«Tienda»**.
4. **Apuesta pasa a llamarse «Órdago».**
5. **El sonido no funciona** en el iPhone. Pista: desbloqueo de `AudioContext` asíncrono en iOS (`sonido.js#desbloquear` devuelve false antes de que `resume()` resuelva; carga perezosa de zzfx). Diagnosticar con systematic-debugging antes de arreglar.
6. **Generar preguntas = funcionalidad premium de pago real en el futuro**: NO se bloquea ahora (solo la usa Carlos). Basta con dejarla marcada como premium (insignia), sin candado ni cobro.
7. **Al terminar de generarse, aviso grande «Preguntas generadas», clicable**, que lleva a jugarlas.
8. **Visuales**: todas las tarjetas, incluidas las recién generadas, tienen que intentar traer visual, sobre todo **más imágenes** (Wikimedia Commons). Las visuales que generamos nosotros llevan texto y nadie lo lee: tienen que **enganchar al ojo** (forma, color, imagen; casi sin texto).
9. **La esfinge se ve fatal; el avatar tiene que ser más grande.** Buscar en GitHub diseños de avatar/personaje con licencia libre y **enseñarle a Carlos 3-4 opciones con un prototipo de cada una para que elija**.

## Cómo hacerlo (decisión de Carlos: «un plan con todo, y lo visual por subagentes para no quemar cuota»)
- Primero, ajustar la spec a este feedback y que Carlos la vea. Después, un plan único con writing-plans que cubra los arreglos (puntos 2-7), los visuales (punto 8), el avatar (punto 9) y los 4 modos (Órdago, Más o menos/Afinar, Contrarreloj, Tienda), con fases que se puedan publicar por separado.
- Delegar la búsqueda del avatar en GitHub y los barridos de visuales/imágenes a subagentes baratos (Haiku) o a `delegar.mjs` (OpenRouter gratis; es información pública). Prototipos de avatar desechables para que Carlos elija en el iPhone.
- Ejecución con subagent-driven-development: implementador y revisor Sonnet, re-revisión Haiku, revisión final con Opus ejecutando la app + adversarial OpenRouter gratis.

## Aparcado de fases 1-2
- Límites de tamaño al importar un respaldo v3 manipulado; RAF de `contarCifra` sin cancelar; confeti concurrente puede crear dos lienzos; `esfinge.js` usa el `document` global (queda obsoleto si cambia el avatar).
- Preexistentes: importar el mismo fichero dos veces no hace nada y no da aviso de éxito; flakes de tests de servidor en Windows (`servidor-cola.test.js:888` EPERM de rename, `servidor-generacion.test.js:1150` temporizadores bajo carga).

## Cómo trabajar
- Scripts de `tools/`: `node --env-file=.env`. Verificación: `node --test tests/*.test.js` (725) y `npx playwright test` (155). La suite e2e regenera `docs/capturas/*.png`: no se commitean.
- Publicar solo con OK de Carlos; el modo automático bloquea el push, así que lo lanza él: `! git checkout main && git merge --ff-only <rama> && git push origin main`. Tras el push: `gh run list` y comprobar que `https://carlostorresadvisory.github.io/one/sw.js` sirve la caché nueva.
