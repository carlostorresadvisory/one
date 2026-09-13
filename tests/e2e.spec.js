// e2e de ONE: inicio (🧠/💪) -> HUB (radar + misión + pendientes + niveles) ->
// partida (mazo vertical, confianza dentro de la tarjeta, feedback compacto) ->
// resumen (carrusel "Para repasar") -> HUB, contra el banco de ejemplo, más una
// partida de humo contra el banco real. Playwright headless a 375x812.
import { test, expect } from '@playwright/test';

const CAPTURAS = 'docs/capturas';

/** Ninguna vista debe hacer scroll (spec "que se note" 12-sep): la .vista activa
 * debe caber entera en su alto visible. */
async function assertSinScroll(page) {
  const medidas = await page.evaluate(() => {
    const vista = document.querySelector('.vista:not([hidden])');
    return vista ? { alto: vista.scrollHeight, visible: vista.clientHeight } : null;
  });
  expect(medidas).not.toBeNull();
  expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
}

/** Ninguna TARJETA hace scroll tampoco (spec v0.1c §4.2). Es un contrato más
 * estricto que assertSinScroll: cada tarjeta del mazo recorta su propio
 * contenido con overflow:hidden, así que un desbordamiento interno no se vería
 * en el scrollHeight de la .vista (ver ajustarEncaje en app.js).
 *
 * Comprueba TAMBIÉN `.tarjeta-contenido` (Tarea 3b, hallazgo con art-003 a
 * 430×932), no solo la tarjeta entera: la tarjeta tiene tamaño FIJO (absoluta
 * sobre #mazo), así que su scrollHeight nunca refleja que .tarjeta-contenido
 * (flex:1, min-height:0, sin overflow:hidden propio) se quede sin sitio — ese
 * desborde no escapa de la tarjeta, se solapa en silencio con la zona de
 * acción (Preguntar a/Siguiente) o recorta el enunciado por debajo de sus
 * propias 5 líneas sin puntos suspensivos, y el viejo contrato (solo tarjeta)
 * no lo veía. */
async function assertTarjetaSinScroll(page) {
  const medidas = await page.evaluate(() => {
    const tarjeta = document.querySelector('.tarjeta-mazo--actual');
    if (!tarjeta) return null;
    const contenido = tarjeta.querySelector('.tarjeta-contenido');
    return {
      alto: tarjeta.scrollHeight,
      visible: tarjeta.clientHeight,
      contenidoAlto: contenido ? contenido.scrollHeight : null,
      contenidoVisible: contenido ? contenido.clientHeight : null,
    };
  });
  expect(medidas).not.toBeNull();
  expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
  if (medidas.contenidoAlto !== null) {
    expect(medidas.contenidoAlto).toBeLessThanOrEqual(medidas.contenidoVisible + 2);
  }
}

/** El radar absorbe el espacio libre del HUB (spec "pantalla completa"
 * 12-sep): nada de hueco vacío entre la rejilla de áreas y "Comenzar". */
async function comprobarHuecoGridComenzar(page) {
  const cajaGrid = await page.locator('#progreso-areas').boundingBox();
  const cajaComenzar = await page.locator('[data-test="comenzar"]').boundingBox();
  expect(cajaGrid).not.toBeNull();
  expect(cajaComenzar).not.toBeNull();
  const hueco = cajaComenzar.y - (cajaGrid.y + cajaGrid.height);
  expect(hueco).toBeLessThanOrEqual(48);
}

/** La tarjeta visible del mazo ahora mismo (spec v0.1c: solo la actual/-
 * -actual- puede tocarse; anterior y siguiente están fuera de vista aunque
 * sigan en el DOM). Único punto de entrada para localizar controles: con el
 * mazo, puede haber más de una `[data-test="tarjeta"]` en el DOM a la vez. */
function tarjetaActual(page) {
  return page.locator('.tarjeta-mazo--actual');
}

/** Detecta el tipo de la pregunta actual por sus selectores data-test, sin responder. */
async function tipoPreguntaActual(page) {
  const t = tarjetaActual(page);
  if (await t.locator('[data-test="vf-verdadero"]').count()) return 'vf';
  if (await t.locator('[data-test="opcion-0"]').count()) return 'test4';
  if (await t.locator('[data-test="item-0"]').count()) return 'ordenar';
  if (await t.locator('[data-test="fila-0"]').count()) return 'error';
  throw new Error('No se reconoce el tipo de la pregunta actual (ningún selector conocido presente)');
}

/** Responde CORRECTAMENTE la pregunta actual del banco de ejemplo, sea del tipo
 * que sea. `sospechosoPorTitulo` (opcional, Map título -> índice) permite acertar
 * siempre las preguntas de tipo "error" sea cual sea la que toque. */
async function responderPreguntaActual(page, sospechosoPorTitulo) {
  const t = tarjetaActual(page);
  const tipo = await tipoPreguntaActual(page);
  if (tipo === 'vf') {
    await t.locator('[data-test="vf-verdadero"]').click();
  } else if (tipo === 'test4') {
    await t.locator('[data-test="opcion-0"]').click();
  } else if (tipo === 'ordenar') {
    // Tocar por el índice ORIGINAL (data-original), no por la posición mostrada tras
    // barajar: así siempre se acierta el orden correcto (evaluar() exige [0,1,2,3]).
    for (let i = 0; i < 4; i++) await t.locator(`[data-original="${i}"]`).click();
  } else {
    let indice = 0;
    if (sospechosoPorTitulo) {
      const titulo = (await t.locator('.titulo-tarjeta').textContent())?.trim();
      if (sospechosoPorTitulo.has(titulo)) indice = sospechosoPorTitulo.get(titulo);
    }
    await t.locator(`[data-test="fila-${indice}"]`).click();
  }
  return tipo;
}

/** Falla A PROPÓSITO la pregunta actual del banco de ejemplo, sea del tipo que sea. */
async function fallarPreguntaActual(page, sospechosoPorTitulo) {
  const t = tarjetaActual(page);
  const tipo = await tipoPreguntaActual(page);
  if (tipo === 'vf') {
    await t.locator('[data-test="vf-falso"]').click();
  } else if (tipo === 'test4') {
    await t.locator('[data-test="opcion-3"]').click();
  } else if (tipo === 'ordenar') {
    for (let i = 3; i >= 0; i--) await t.locator(`[data-original="${i}"]`).click();
  } else {
    let sospechoso = 0;
    if (sospechosoPorTitulo) {
      const titulo = (await t.locator('.titulo-tarjeta').textContent())?.trim();
      if (sospechosoPorTitulo.has(titulo)) sospechoso = sospechosoPorTitulo.get(titulo);
    }
    const filas = await t.locator('[data-test^="fila-"]').count();
    await t.locator(`[data-test="fila-${(sospechoso + 1) % filas}"]`).click();
  }
  return tipo;
}

// El mazo anima la transición entre tarjetas en 200ms (spec v0.1c §2.2): tras
// cualquier navegación, se espera a que asiente antes de mirar/capturar nada,
// si no la posición (y una captura de pantalla) queda a mitad de camino.
// Un timeout fijo es frágil (una máquina cargada puede tardar más de 200ms en
// completar la animación, dejando una captura a mitad de camino: hallazgo real
// de la ronda 1 de revisión). Se espera a que la tarjeta actual esté REALMENTE
// asentada midiendo su transform computado (no el inline, que se fija al
// instante aunque la transición CSS siga interpolando hacia él).
async function esperarAsentamientoMazo(page) {
  await page.waitForFunction(
    () => {
      const actual = document.querySelector('.tarjeta-mazo--actual');
      if (!actual) return false;
      const transform = getComputedStyle(actual).transform;
      if (transform === 'none') return true;
      const m = new DOMMatrixReadOnly(transform);
      return Math.abs(m.m42) < 0.5;
    },
    { timeout: 3000 }
  );
}

/** Simula un gesto de arrastre con Pointer Events REALES (I3, ola final):
 * Chromium headless dispara pointerdown/pointermove/pointerup para un puntero
 * de ratón igual que para uno táctil, y ni montarMazo ni activarSwipeVf miran
 * `pointerType` — así que `page.mouse` basta, sin necesitar un contexto con
 * `hasTouch`. `pasos` son posiciones ABSOLUTAS: la primera es donde se agarra
 * (down), las siguientes son movimientos sucesivos (move, con pasos
 * intermedios) antes de soltar (up). */
async function arrastrar(page, pasos) {
  await page.mouse.move(pasos[0].x, pasos[0].y);
  await page.mouse.down();
  for (let i = 1; i < pasos.length; i += 1) {
    await page.mouse.move(pasos[i].x, pasos[i].y, { steps: 4 });
  }
  await page.mouse.up();
}

/** Recorre el mazo de repaso del resumen (spec v0.1c §6) con ArrowUp hasta que
 * la tarjeta ACTUAL sea la final (`[data-test="repaso-final"]`), comprobando
 * en cada parada que ni la vista ni la tarjeta actual hacen scroll. Mira la
 * tarjeta actual (`.tarjeta-mazo--actual`), no una búsqueda global de
 * `[data-test="repaso-final"]`: con la ventana de 3 nodos del mazo, la final
 * puede estar ya en el DOM (como "siguiente", fuera de vista) un paso antes
 * de ser la actual, e `isVisible()` de Playwright no distingue eso de estar
 * realmente en pantalla. Devuelve el locator de la tarjeta final, ya actual. */
async function recorrerRepasoHastaFinal(page) {
  for (let vueltas = 0; vueltas < 20; vueltas += 1) {
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    const actual = tarjetaActual(page);
    if ((await actual.getAttribute('data-test')) === 'repaso-final') return actual;
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
  }
  throw new Error('No se alcanzó [data-test="repaso-final"] tras 20 ArrowUp (¿bucle sin fin?)');
}

/** Sin avance automático: tras responder, acierto o fallo, la partida SIEMPRE
 * espera a "Siguiente" (dentro de la propia tarjeta ya respondida). */
async function avanzarTrasRespuesta(page) {
  const siguiente = tarjetaActual(page).locator('[data-test="siguiente"]');
  await expect(siguiente).toBeVisible();
  await siguiente.click();
  // El "Siguiente" de la última pregunta termina la partida (finalizarPartida
  // desmonta el mazo, ver app.js): si ya se ve el resumen no queda ninguna
  // .tarjeta-mazo--actual que asentar, y esperarla bloquearía para siempre.
  if (await page.locator('[data-vista="pregunta"]').isVisible()) {
    await esperarAsentamientoMazo(page);
  }
}

/** I4 (ola final): espera a que el `<img>` de `[data-test="imagen"]` quede
 * cargado ('ok'), falle ('error': construirBloqueImagen quita el bloque
 * entero, ver app.js) o se agote un timeout corto ('timeout') — nunca cuelga.
 * Antes, un fallo real de red dejaba el test esperando un 'load' que un
 * 'error' ya disparado no iba a emitir nunca (hasta el timeout POR DEFECTO de
 * Playwright, ~30s, con el mensaje de fallo sin explicar la causa real). */
async function esperarImagenOFallo(page, timeoutMs = 3000) {
  return page.evaluate((limite) => new Promise((resolve) => {
    const evaluarActual = () => {
      const img = document.querySelector('[data-test="imagen"] img');
      if (!img) return 'sin-imagen'; // bloque ya quitado (error) o nunca construido
      if (img.complete && img.naturalWidth > 0) return 'ok';
      if (img.complete) return 'error'; // 'complete' también es true tras un fallo
      return null;
    };
    const yaResuelto = evaluarActual();
    if (yaResuelto) {
      resolve(yaResuelto);
      return;
    }
    const img = document.querySelector('[data-test="imagen"] img');
    const limpiar = () => {
      clearTimeout(temporizador);
      img.removeEventListener('load', alCargar);
      img.removeEventListener('error', alFallar);
    };
    const alCargar = () => { limpiar(); resolve('ok'); };
    const alFallar = () => { limpiar(); resolve('error'); };
    img.addEventListener('load', alCargar, { once: true });
    img.addEventListener('error', alFallar, { once: true });
    const temporizador = setTimeout(() => { limpiar(); resolve('timeout'); }, limite);
  }), timeoutMs);
}

/** vf: FALSO/VERDADERO viven ahora DENTRO de la tarjeta, en su zona de acción
 * anclada abajo (spec v0.1c §4.1 punto 6), y la pista de deslizamiento
 * horizontal sigue viviendo sobre la propia tarjeta. */
async function comprobarZonaAccionVf(page) {
  const t = tarjetaActual(page);
  await expect(t.locator('[data-test="pista-swipe"]')).toBeVisible();
  await expect(t.locator('[data-test="vf-falso"]')).toBeVisible();
  await expect(t.locator('[data-test="vf-verdadero"]')).toBeVisible();
}

/** Juega hasta que aparece el resumen, respondiendo siempre correctamente y
 * avanzando tras cada respuesta con avanzarTrasRespuesta(). `alDetectarTipo`
 * (opcional) se llama en CADA vuelta, con la confianza todavía visible (antes
 * de responder) y el tipo de la pregunta actual — la propia función decide si
 * ya lo había visto (ver capturarSiNuevo más abajo: dedup compartido con las
 * preguntas 1 y 2, respondidas fuera de este bucle). `alVerFeedback` se llama
 * la primera vez que se ve el feedback en toda la partida. En cada vuelta
 * comprueba que la confianza esté visible antes Y después de responder (spec
 * v0.1c §2.3: sigue activa tras responder, ya no se oculta), y que ni la vista
 * ni la tarjeta actual hacen scroll. */
async function jugarPartida(page, { alDetectarTipo, alVerFeedback, sospechosoPorTitulo } = {}) {
  let feedbackVisto = false;

  for (let vueltas = 0; vueltas < 25; vueltas += 1) {
    if (await page.locator('[data-test="resumen"]').isVisible()) return;

    const t = tarjetaActual(page);
    await expect(t.locator('[data-test="confianza"]')).toBeVisible();
    await expect(t.locator('[data-test="confianza-etiqueta"]')).toHaveText('Confianza');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const tipo = await tipoPreguntaActual(page);
    if (tipo === 'vf') await comprobarZonaAccionVf(page);
    if (alDetectarTipo) await alDetectarTipo(tipo);

    await responderPreguntaActual(page, sospechosoPorTitulo);

    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    // La confianza SIGUE activa tras responder (spec v0.1c §2.3): se puede
    // corregir la respuesta ya registrada.
    await expect(t.locator('[data-test="confianza"]')).toBeVisible();
    await expect(t.locator('[data-test="explicacion"]')).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    if (!feedbackVisto) {
      feedbackVisto = true;
      if (alVerFeedback) await alVerFeedback();
    }

    await avanzarTrasRespuesta(page);
  }

  throw new Error('La partida no terminó tras 25 vueltas (¿bucle sin fin?)');
}

test.describe('ONE · integración e2e', () => {
  test('inicio -> HUB -> partida -> resumen -> HUB: mecánicas, feedback, radar, misión, pendientes y progreso', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    // 1. Inicio (🧠/💪) visible, racha en 0, sin botón Comenzar aquí.
    await page.goto('/?ejemplo=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');
    // El botón "Comenzar" vive en el HUB, no aquí: en el inicio de los emojis
    // no debe verse (sigue existiendo en el DOM, solo que su vista está oculta).
    await expect(page.locator('[data-test="comenzar"]')).toBeHidden();
    await page.screenshot({ path: `${CAPTURAS}/01-inicio.png` });

    // Mapa título -> índice sospechoso del banco de ejemplo: permite acertar siempre
    // las preguntas de tipo "error" cuando queremos acertar a propósito.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    // 2. 🧠 lleva SIEMPRE al HUB: ahí está "Comenzar", el radar de las 8 áreas, la
    // Misión de hoy y Pendientes. Estado recién creado: puntuación 0 en todas las
    // áreas -> radar vacío con aviso, sin relleno de solidez todavía, Pendientes
    // en 0 y una Misión de hoy recién generada (Economía + Historia son las dos
    // áreas más flojas del banco de ejemplo con todo a 0, por orden de AREAS).
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="radar"]')).toBeVisible();
    await expect(page.locator('[data-test="radar-solido"]')).toHaveCount(0);
    await expect(page.locator('[data-test="nota-economia"]')).toBeVisible();
    await expect(page.locator('#radar-vacio')).toBeVisible();
    await expect(page.locator('[data-test="mision"]')).toContainText('Misión de hoy');
    await expect(page.locator('[data-test="mision"]')).toContainText('0/3');
    await expect(page.locator('[data-test="pendientes"]')).toHaveText('Pendientes · 0');
    await assertSinScroll(page);
    await comprobarHuecoGridComenzar(page);
    await page.screenshot({ path: `${CAPTURAS}/02-hub.png` });

    // 3. "←" desde el HUB vuelve a los emojis (nunca al revés): comprobamos el
    // viaje de ida y vuelta antes de complicar el estado jugando.
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // 4. Practicar solo un área desde el HUB: tocar la tarjeta de "economia"
    // arranca una partida filtrada (el banco de ejemplo tiene 2 preguntas de esa
    // área). La cabecera debe anunciar "Solo Economía" y la tarjeta debe serlo.
    const practicarEconomia = page.locator('[data-test="practicar-economia"]');
    await expect(practicarEconomia).toBeVisible();
    await practicarEconomia.click();

    await expect(page.locator('[data-test="modo-area"]')).toBeVisible();
    await expect(page.locator('[data-test="modo-area"]')).toHaveText('Solo Economía');
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Economía');

    // 5. Primera pregunta de economía: confianza (con su etiqueta) visible antes
    // de responder; "Siguiente" debe estar OCULTO hasta responder. Fallamos A
    // PROPÓSITO (la tarjeta se sacude, se ve la explicación sola, y sin avance
    // automático: espera siempre a "Siguiente"). Esta tarjeta queda pendiente:
    // el resto del flujo la usa para probar "Pendientes" y el chip "Recuperada".
    const tarjeta1 = tarjetaActual(page);
    await expect(tarjeta1.locator('[data-test="confianza"]')).toBeVisible();
    await expect(tarjeta1.locator('[data-test="confianza-etiqueta"]')).toHaveText('Confianza');
    await expect(tarjeta1.locator('[data-test="confianza-media"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(tarjeta1.locator('[data-test="siguiente"]')).toBeHidden();
    // El orden de las 2 preguntas de economía lo decide el rng del motor: puede
    // salir primero la vf o la de tipo "error", así que fallamos sea cual sea.
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await expect(tarjeta1.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(tarjeta1.locator('[data-test="explicacion"]')).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await avanzarTrasRespuesta(page);

    // 6. Segunda (y última) pregunta de economía: acertamos a propósito. Al ser
    // la última del área filtrada, puede avanzar sola al resumen o esperar
    // "Siguiente".
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Economía');
    const tarjeta2 = tarjetaActual(page);
    await expect(tarjeta2.locator('[data-test="confianza"]')).toBeVisible();
    await responderPreguntaActual(page, sospechosoPorTitulo);
    // Acierto: la explicación también se ve siempre, sin tocar nada.
    await expect(tarjeta2.locator('[data-test="explicacion"]')).toBeVisible();
    await expect(tarjeta2.locator('[data-test="siguiente"]')).toBeVisible();
    await avanzarTrasRespuesta(page);
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await assertSinScroll(page);

    // 7. "Inicio" (resumen) vuelve SIEMPRE al HUB, nunca a los emojis. Con la
    // primera pregunta fallada, el resumen ES un mazo de repaso (spec v0.1c
    // §6): hay que recorrerlo hasta la tarjeta final para llegar a "Inicio".
    // La racha ya cuenta esta partida filtrada como partida completa del día,
    // la nota de economía deja de estar vacía ('—'), y Pendientes pasa a 1 (el
    // fallo de la primera pregunta de economía sigue sin recuperar).
    const finalEconomia = await recorrerRepasoHastaFinal(page);
    await finalEconomia.locator('[data-test="ir-inicio"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="modo-area"]')).toBeHidden();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await expect(page.locator('[data-test="nota-economia"]')).not.toHaveText('—');
    await expect(page.locator('[data-test="pendientes"]')).toHaveText('Pendientes · 1');
    await assertSinScroll(page);

    // 8. Practicar "Pendientes" desde el HUB: la única tarjeta pendiente es la
    // fallada en el paso 5. Acertarla debe mostrar el chip "Recuperada" y, al
    // terminar (era la única, así que la partida se cierra ahí), un resumen sin
    // fallos ("Para repasar" vacío) y Pendientes de vuelta a 0.
    const chipPendientes = page.locator('[data-test="pendientes"]');
    await chipPendientes.click();
    await expect(page.locator('[data-test="modo-area"]')).toHaveText('Pendientes');
    const tarjeta3 = tarjetaActual(page);
    await expect(tarjeta3.locator('[data-test="confianza"]')).toBeVisible();
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await expect(tarjeta3.locator('[data-test="recuperada"]')).toBeVisible();
    await expect(tarjeta3.locator('[data-test="recuperada"]')).toContainText('Recuperada');
    await expect(tarjeta3.locator('[data-test="recuperada"]')).toContainText('la fallaste el');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/10-pendientes.png` });
    await avanzarTrasRespuesta(page);
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    // Sin nada que repasar, la tarjeta 0 (cifras) ya trae el mensaje y los
    // botones directos (spec v0.1c §6): no hace falta deslizar a ningún sitio.
    await expect(page.locator('[data-test="resumen-cifras"]')).toContainText('Sin fallos. Nada que repasar.');
    await expect(page.locator('[data-test="repaso-tarjeta"]')).toHaveCount(0);
    await assertSinScroll(page);
    await page.locator('[data-test="resumen-cifras"] [data-test="ir-inicio"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="pendientes"]')).toHaveText('Pendientes · 0');

    // 9. "←" desde pregunta/resumen vuelve siempre al HUB (nunca a los emojis):
    // arrancamos la partida normal (sin filtro) para comprobarlo desde pregunta.
    await page.locator('[data-test="comenzar"]').click();
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // 10. Partida normal (sin filtro) de verdad, desde "Comenzar": la primera
    // pregunta se falla a propósito (deja al menos una tarjeta en "Para repasar"
    // para el resumen), la segunda se acierta con confianza Alta (comprueba el
    // "×1,5"), y el resto se juega en modo genérico capturando cada mecánica
    // nueva (con la confianza visible) y el primer feedback.
    await page.locator('[data-test="comenzar"]').click();
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toBeVisible();

    const tiposVistos = new Set();
    const nombreCaptura = { vf: '03-vf.png', test4: '04-test4.png', ordenar: '05-ordenar.png', error: '06-error.png' };
    async function capturarSiNuevo(tipo) {
      if (tiposVistos.has(tipo)) return;
      tiposVistos.add(tipo);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await page.screenshot({ path: `${CAPTURAS}/${nombreCaptura[tipo]}` });
    }

    // Pregunta 1: falla a propósito con confianza Media (por defecto).
    const tarjetaP1 = tarjetaActual(page);
    await expect(tarjetaP1.locator('[data-test="confianza"]')).toBeVisible();
    await capturarSiNuevo(await tipoPreguntaActual(page));
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await expect(tarjetaP1.locator('[data-test="siguiente"]')).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await avanzarTrasRespuesta(page);

    // Pregunta 2: confianza Alta + acierto -> "×1,5" en el feedback.
    const tarjetaP2 = tarjetaActual(page);
    await expect(tarjetaP2.locator('[data-test="confianza"]')).toBeVisible();
    await capturarSiNuevo(await tipoPreguntaActual(page));
    await tarjetaP2.locator('[data-test="confianza-alta"]').click();
    await expect(tarjetaP2.locator('[data-test="confianza-alta"]')).toHaveAttribute('aria-pressed', 'true');
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await expect(tarjetaP2.locator('[data-test="feedback-texto"]')).toContainText('×1,5');
    await assertSinScroll(page);
    await avanzarTrasRespuesta(page);

    // Resto de la partida: genérico, siempre acertando.
    await jugarPartida(page, {
      sospechosoPorTitulo,
      alDetectarTipo: capturarSiNuevo,
      alVerFeedback: async () => {
        // Tras la primera respuesta debe verse el cambio de la escalera (sube o baja).
        const t = tarjetaActual(page);
        const cambioNivel = t.locator('[data-test="cambio-nivel"]');
        await expect(cambioNivel).toBeVisible();
        await expect(cambioNivel).toContainText(/↑|↓/);
        await assertSinScroll(page);
        await page.screenshot({ path: `${CAPTURAS}/07-feedback.png` });
      },
    });

    // 11. Resumen visible, racha a 1 (misma partida del día): el mazo de
    // repaso (spec v0.1c §6) arranca con la tarjeta de cifras, que anuncia
    // cuántas hay que repasar (al menos la fallada en la pregunta 1).
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await expect(page.locator('[data-test="repaso"]')).toBeVisible();
    await expect(page.locator('[data-test="resumen-cifras"]')).toContainText('Desliza ↑ para repasar');
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/08-resumen.png` });
    await page.screenshot({ path: `${CAPTURAS}/v0.1c-repaso-cifras.png` });

    // v0.1c §5/§6: deslizar (ArrowUp) a la primera tarjeta de repaso y
    // comprobar sus 3 enlaces "Preguntar a" — contienen el prompt de ESTA
    // pregunta ya codificado en la URL (se compara contra la explicación
    // mostrada, un campo del banco que no cambia de un tipo de pregunta a
    // otro, a diferencia del enunciado en las de tipo "error" genéricas) y el
    // de Gemini lleva "udm=50" (spec v0.1c §5, probado en vivo el 12-sep).
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    const tarjetaRepaso1 = page.locator('[data-test="repaso-tarjeta"]').first();
    await expect(tarjetaRepaso1).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const explicacionFallada = ((await tarjetaRepaso1.locator('[data-test="explicacion"]').textContent()) || '').trim();
    expect(explicacionFallada.length).toBeGreaterThan(0);
    const hrefChatgpt = await tarjetaRepaso1.locator('[data-test="preguntar-chatgpt"]').getAttribute('href');
    const hrefClaude = await tarjetaRepaso1.locator('[data-test="preguntar-claude"]').getAttribute('href');
    const hrefGemini = await tarjetaRepaso1.locator('[data-test="preguntar-gemini"]').getAttribute('href');
    expect(hrefChatgpt.startsWith('https://chatgpt.com/?q=')).toBe(true);
    expect(hrefClaude.startsWith('https://claude.ai/new?q=')).toBe(true);
    expect(hrefGemini.startsWith('https://www.google.com/search?udm=50&q=')).toBe(true);
    for (const href of [hrefChatgpt, hrefClaude, hrefGemini]) {
      expect(decodeURIComponent(href)).toContain(explicacionFallada);
    }
    for (const destino of ['chatgpt', 'claude', 'gemini']) {
      await expect(tarjetaRepaso1.locator(`[data-test="preguntar-${destino}"]`)).toHaveAttribute('target', '_blank');
      await expect(tarjetaRepaso1.locator(`[data-test="preguntar-${destino}"]`)).toHaveAttribute('rel', 'noopener');
    }
    await page.screenshot({ path: `${CAPTURAS}/v0.1c-repaso-tarjeta.png` });

    // Seguir deslizando hasta la tarjeta final (spec v0.1c §6): "Otra partida"
    // / Inicio presentes. Esta partida es ya la 4ª de la sesión contra un
    // banco de ejemplo de solo 12 preguntas (mini partida de economía +
    // pendientes + esta): con casi todo el banco ya respondido HOY,
    // siguientePregunta() puede legítimamente no tener nada que dar
    // (motor.js: una recién acertada no vuelve a estar "pendiente" el mismo
    // día). Que "Otra partida" arranca una partida de verdad, con banco
    // fresco, se comprueba abajo en la suite de 430×932.
    const tarjetaFinal = await recorrerRepasoHastaFinal(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.1c-repaso-final.png` });
    await expect(tarjetaFinal.locator('[data-test="otra-partida"]')).toBeVisible();
    await expect(tarjetaFinal.locator('[data-test="ir-inicio"]')).toBeVisible();

    // 12. Recargar: siempre se cae en el inicio de los emojis (no hay "última
    // vista" que recordar); la racha persiste. Volver al HUB: el radar ya no
    // está vacío, hay relleno de solidez y al menos una barra de área tiene progreso.
    await page.reload();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');

    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('#radar-vacio')).toBeHidden();
    await expect(page.locator('[data-test="nota-economia"]')).not.toHaveText('—');
    const barras = page.locator('[data-test^="barra-"]');
    await expect(barras.first()).toBeVisible();
    const anchos = await barras.evaluateAll((nodos) => nodos.map((n) => parseFloat(n.style.width) || 0));
    expect(anchos.some((ancho) => ancho > 0)).toBe(true);
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/09-hub-progreso.png` });

    // 13. Sin errores de página en toda la sesión.
    expect(erroresPagina).toEqual([]);
  });

  // Última: partida de humo contra el banco real (sin ?ejemplo=1). No debe
  // lanzar, debe llegar al resumen con lo que haya generado el pipeline, y
  // ninguna pregunta ni feedback debe hacer scroll (assertSinScroll/
  // assertTarjetaSinScroll corren en cada vuelta de jugarPartida) — no depende
  // de preguntas concretas del banco.
  test('partida contra el banco real: no lanza, llega al resumen y no hace scroll', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    await page.goto('/');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
    await page.locator('[data-test="comenzar"]').click();

    await jugarPartida(page);

    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await assertSinScroll(page);
    expect(erroresPagina).toEqual([]);
  });

  // Mismo flujo (banco de ejemplo) a 430×932 (iPhone Pro Max): la spec "pantalla
  // completa" pide sin scroll también a este tamaño, y capturas propias.
  test('pantalla completa a 430×932: sin scroll y capturas', async ({ page }) => {
    const CAPTURAS_430 = `${CAPTURAS}/430x932`;
    await page.setViewportSize({ width: 430, height: 932 });

    await page.goto('/?ejemplo=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS_430}/01-inicio.png` });

    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
    await comprobarHuecoGridComenzar(page);
    await page.screenshot({ path: `${CAPTURAS_430}/02-hub.png` });

    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    await page.locator('[data-test="comenzar"]').click();

    const vistos = new Set();
    const nombreCaptura = { vf: '03-vf.png', error: '06-error.png' };
    const v01cVistos = new Set(); // capturas v0.1c-*.png: vf antes/después, ordenar después
    let feedbackCapturado = false;
    let primeraFallada = false; // la primera pregunta se falla a propósito: garantiza
    // algo que repasar (spec v0.1c §6) también a este tamaño.

    for (let vueltas = 0; vueltas < 25; vueltas += 1) {
      if (await page.locator('[data-test="resumen"]').isVisible()) break;

      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      const tipo = await tipoPreguntaActual(page);
      if (tipo === 'vf') await comprobarZonaAccionVf(page);
      if (!vistos.has(tipo) && nombreCaptura[tipo]) {
        vistos.add(tipo);
        await page.screenshot({ path: `${CAPTURAS_430}/${nombreCaptura[tipo]}` });
      }
      if (tipo === 'vf' && !v01cVistos.has('vf-antes')) {
        v01cVistos.add('vf-antes');
        await esperarAsentamientoMazo(page);
        await page.screenshot({ path: `${CAPTURAS_430}/v0.1c-vf-antes.png` });
      }

      const t = tarjetaActual(page);
      if (!primeraFallada) {
        primeraFallada = true;
        await fallarPreguntaActual(page, sospechosoPorTitulo);
      } else {
        await responderPreguntaActual(page, sospechosoPorTitulo);
      }
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      if (vueltas === 0) {
        // Regresión de C1 también a 430×932: la primera respuesta de la
        // partida es la que reproducía el bug de #mazo como scroll container.
        expect(await page.evaluate(() => document.getElementById('mazo').scrollTop)).toBe(0);
      }
      if (tipo === 'vf' && !v01cVistos.has('vf-despues')) {
        v01cVistos.add('vf-despues');
        await esperarAsentamientoMazo(page);
        await page.screenshot({ path: `${CAPTURAS_430}/v0.1c-vf-despues.png` });
      }
      if (tipo === 'ordenar' && !v01cVistos.has('ordenar-despues')) {
        v01cVistos.add('ordenar-despues');
        await esperarAsentamientoMazo(page);
        await page.screenshot({ path: `${CAPTURAS_430}/v0.1c-ordenar-despues.png` });
      }
      if (!feedbackCapturado) {
        feedbackCapturado = true;
        await page.screenshot({ path: `${CAPTURAS_430}/07-feedback.png` });
      }

      await avanzarTrasRespuesta(page);
    }

    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await assertSinScroll(page);
    await expect(page.locator('[data-test="resumen-cifras"]')).toContainText('Desliza ↑ para repasar');
    await page.screenshot({ path: `${CAPTURAS_430}/08-resumen.png` });

    // v0.1c §5/§6, también a 430×932: recorrer el repaso, comprobar los 3
    // enlaces "Preguntar a" de la tarjeta fallada y llegar hasta la final;
    // "Otra partida" arranca una partida nueva.
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    const tarjetaRepaso430 = page.locator('[data-test="repaso-tarjeta"]').first();
    await expect(tarjetaRepaso430).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await expect(tarjetaRepaso430.locator('[data-test="preguntar-chatgpt"]')).toHaveAttribute('href', /^https:\/\/chatgpt\.com\/\?q=/);
    await expect(tarjetaRepaso430.locator('[data-test="preguntar-claude"]')).toHaveAttribute('href', /^https:\/\/claude\.ai\/new\?q=/);
    await expect(tarjetaRepaso430.locator('[data-test="preguntar-gemini"]')).toHaveAttribute('href', /udm=50/);

    const final430 = await recorrerRepasoHastaFinal(page);
    await final430.locator('[data-test="otra-partida"]').click();
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toBeVisible();
  });

  // Mecánicas propias del mazo (spec v0.1c §2): pasar sin responder y volver,
  // confianza que sigue activa tras responder (y recalcula el XP guardado), y
  // la tarjeta de cierre cuando queda algo pendiente al llegar a la 10ª.
  test('mazo: pasar, volver, cambiar confianza tras responder y tarjeta de cierre', async ({ page }) => {
    await page.goto('/?ejemplo=1');

    // Mapa título -> índice sospechoso: para acertar SIEMPRE (incluidas las de
    // tipo "error"), imprescindible aquí porque el cambio de confianza solo
    // recalcula XP visible sobre una respuesta correcta (motor.js §3.1).
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-indice', '0');
    await expect(t).toHaveAttribute('data-respondida', 'false');

    // Pasar sin responder (deslizar arriba = ArrowUp): el hueco 0 sigue sin
    // responder y se puede volver a él.
    await page.keyboard.press('ArrowUp');
    await expect(t).toHaveAttribute('data-indice', '1');

    // Volver (ArrowDown): la tarjeta 0 sigue exactamente como se dejó.
    await page.keyboard.press('ArrowDown');
    await expect(t).toHaveAttribute('data-indice', '0');
    await expect(t).toHaveAttribute('data-respondida', 'false');
    await esperarAsentamientoMazo(page);

    // Capturas v0.1c (spec, paso 11): vf antes/después y ordenar después, la
    // primera vez que tocan en la partida, sea cual sea el hueco.
    const capturadas = new Set();
    async function capturarV01c(nombre) {
      if (capturadas.has(nombre)) return;
      capturadas.add(nombre);
      await page.screenshot({ path: `${CAPTURAS}/v0.1c-${nombre}.png` });
    }
    let tipoHueco0 = await tipoPreguntaActual(page);
    if (tipoHueco0 === 'vf') {
      await esperarAsentamientoMazo(page);
      await capturarV01c('vf-antes');
    }

    // Responder y capturar el XP mostrado y el guardado en localStorage.
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    // Regresión de C1: la PRIMERA respuesta de la partida es la que reproducía
    // el bug (#mazo se convertía en contenedor de scroll de verdad al
    // sustituir el nodo de la tarjeta). scrollTop debe seguir en 0 siempre.
    expect(await page.evaluate(() => document.getElementById('mazo').scrollTop)).toBe(0);
    if (tipoHueco0 === 'vf') await capturarV01c('vf-despues');
    if (tipoHueco0 === 'ordenar') await capturarV01c('ordenar-despues');
    if (tipoHueco0 === 'test4') await capturarV01c('test4-despues');
    const textoAntes = await t.locator('[data-test="feedback-texto"]').textContent();
    const xpAntes = await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).xp);

    // Cambiar la confianza DESPUÉS de responder (spec v0.1c §2.3): el texto de
    // XP se recalcula y el estado guardado en localStorage cambia con él.
    await t.locator('[data-test="confianza-alta"]').click();
    await expect(t.locator('[data-test="confianza-alta"]')).toHaveAttribute('aria-pressed', 'true');
    const textoDespues = await t.locator('[data-test="feedback-texto"]').textContent();
    const xpDespues = await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).xp);
    expect(textoDespues).not.toBe(textoAntes);
    expect(xpDespues).not.toBe(xpAntes);
    await assertTarjetaSinScroll(page);

    await avanzarTrasRespuesta(page);

    // Responde las siguientes 8 (huecos 1..8) y deja la 10ª (hueco 9) sin
    // responder para llegar a la tarjeta de cierre con una pendiente.
    for (let i = 0; i < 8; i += 1) {
      await expect(page.locator('[data-test="resumen"]')).toBeHidden();
      const tipoVuelta = await tipoPreguntaActual(page);
      if (tipoVuelta === 'vf') {
        await esperarAsentamientoMazo(page);
        await capturarV01c('vf-antes');
      }
      await responderPreguntaActual(page, sospechosoPorTitulo);
      await esperarAsentamientoMazo(page);
      if (tipoVuelta === 'vf') await capturarV01c('vf-despues');
      if (tipoVuelta === 'ordenar') await capturarV01c('ordenar-despues');
      if (tipoVuelta === 'test4') await capturarV01c('test4-despues');
      await avanzarTrasRespuesta(page);
    }
    await expect(t).toHaveAttribute('data-indice', '9');
    await expect(t).toHaveAttribute('data-respondida', 'false');

    // Pasar la última sin responder: con las 10 huecos ya alcanzados y uno
    // pendiente, deslizar arriba lleva a la tarjeta de cierre (spec v0.1c §2.4).
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    const cierre = page.locator('[data-test="mazo-cierre"]');
    await expect(cierre).toBeVisible();
    await expect(cierre).toContainText('Quedan 1 sin responder');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page); // I3: también la tarjeta de cierre.
    await page.screenshot({ path: `${CAPTURAS}/v0.1c-cierre.png` });

    // "Volver a ellas" salta directo al hueco 9, todavía sin responder.
    await page.locator('[data-test="volver-pendientes"]').click();
    await esperarAsentamientoMazo(page);
    await expect(t).toHaveAttribute('data-indice', '9');
    await expect(t).toHaveAttribute('data-respondida', 'false');

    await responderPreguntaActual(page, sospechosoPorTitulo);
    await avanzarTrasRespuesta(page);
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
  });

  // I3 (ola final): el e2e solo ejercía el gesto por teclado. Se simulan los
  // cuatro casos de la spec v0.1c §2.2/§2.3 con Pointer Events reales
  // (page.mouse, ver arrastrar()): horizontal puro en vf responde y no
  // navega; vertical puro navega y no responde; y en las dos diagonales, el
  // eje que cruza su propio "arranque" PRIMERO es el que se queda con el
  // gesto — nunca los dos a la vez (el revisor final ya probó esto a mano;
  // aquí queda cubierto por el e2e).
  test('mazo v0.1c §2.2: gesto real (down/move/up) — horizontal, vertical y diagonal nunca disparan los dos a la vez', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // his-001 (vf) + art-001 (test4): 2 huecos fijos, para poder navegar al
    // segundo en los casos verticales/diagonales sin depender del azar.
    async function empezarGesto() {
      await page.evaluate(
        (ids) => window.__one.empezarPartida({ ids, etiqueta: 'gesto-i3' }),
        ['his-001', 'art-001']
      );
      await expect(tarjetaActual(page)).toHaveAttribute('data-indice', '0');
    }

    // Punto de agarre sobre el ENUNCIADO (nunca un <button>: tanto montarMazo
    // como activarSwipeVf ignoran el pointerdown si el objetivo es un botón).
    async function puntoAgarre() {
      const caja = await tarjetaActual(page).locator('.enunciado, .instruccion-error').first().boundingBox();
      return { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
    }

    // --- Caso 1: horizontal puro en vf → responde y NO navega. ---
    await empezarGesto();
    {
      const p0 = await puntoAgarre();
      await arrastrar(page, [p0, { x: p0.x + 80, y: p0.y }]); // dx puro, dy=0
      const t = tarjetaActual(page);
      await expect(t).toHaveAttribute('data-indice', '0');
      await expect(t).toHaveAttribute('data-respondida', 'true');
      expect(await page.evaluate(() => document.getElementById('mazo').scrollTop)).toBe(0);
    }

    // --- Caso 2: vertical puro → navega y NO responde. ---
    await empezarGesto();
    {
      const p0 = await puntoAgarre();
      await arrastrar(page, [p0, { x: p0.x, y: p0.y - 80 }]); // dy puro (arriba), dx=0
      await esperarAsentamientoMazo(page);
      await expect(tarjetaActual(page)).toHaveAttribute('data-indice', '1');
      await expect(page.locator('[data-indice="0"]')).toHaveAttribute('data-respondida', 'false');
    }

    // --- Caso 3: diagonal con DX primero → solo responde, nunca navega. ---
    await empezarGesto();
    {
      const p0 = await puntoAgarre();
      await arrastrar(page, [
        p0,
        { x: p0.x + 15, y: p0.y + 2 }, // dx cruza su arranque (10 mazo / 8 vf) antes que dy
        { x: p0.x + 80, y: p0.y + 80 }, // dy crece después igual de grande: no debe cambiar nada
      ]);
      const t = tarjetaActual(page);
      await expect(t).toHaveAttribute('data-indice', '0');
      await expect(t).toHaveAttribute('data-respondida', 'true');
    }

    // --- Caso 4: diagonal con DY primero → solo navega, nunca responde. ---
    await empezarGesto();
    {
      const p0 = await puntoAgarre();
      await arrastrar(page, [
        p0,
        { x: p0.x + 2, y: p0.y - 15 }, // dy cruza su arranque antes que dx
        { x: p0.x + 80, y: p0.y - 80 }, // dx crece después igual de grande: no debe cambiar nada
      ]);
      await esperarAsentamientoMazo(page);
      await expect(tarjetaActual(page)).toHaveAttribute('data-indice', '1');
      await expect(page.locator('[data-indice="0"]')).toHaveAttribute('data-respondida', 'false');
    }
  });

  // M1 (ola final): un filtro {ids} sin ninguna pregunta elegible (aquí, un id
  // que no existe en el banco — mismo síntoma que una Misión de hoy con ids de
  // un banco ya renovado, aunque misionDelDia ya se autorrepara para ese caso
  // concreto, ver motor.js) no debe fingir una partida ni un resumen vacíos:
  // se vuelve al HUB con un aviso breve y la racha NO sube.
  test('M1: un filtro sin nada que jugar vuelve al HUB con aviso, sin fingir partida ni subir la racha', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');

    await page.evaluate(() =>
      window.__one.empezarPartida({ ids: ['no-existe-en-el-banco'], etiqueta: 'inexistente' })
    );

    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="pregunta"]')).toBeHidden();
    await expect(page.locator('[data-test="aviso-hub"]')).toBeVisible();
    await expect(page.locator('[data-test="aviso-hub"]')).toHaveText('Nada que jugar con este filtro');
    await expect(page.locator('[data-test="modo-area"]')).toBeHidden();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');
    await assertSinScroll(page);
  });

  // Peor caso de la regla de encaje (spec v0.1c §4.2): la pregunta 'ordenar' y
  // la 'error' con la explicación MÁS LARGA del banco REAL (no el de ejemplo),
  // respondidas (falladas a propósito: es la variante más alta de la respuesta
  // compacta, con la línea "tuya" tachada además de la correcta), sin scroll
  // ni en la vista ni en la tarjeta, a 375×812 y 430×932.
  test('mazo v0.1c §4.2: peor caso de encaje (ordenar/error con la explicación más larga) a 375×812 y 430×932', async ({ page }) => {
    await page.goto('/');
    const banco = await page.evaluate(() => fetch('datos/banco.json').then((r) => r.json()));
    const masLargaDeTipo = (tipo) =>
      banco
        .filter((p) => p.tipo === tipo)
        .reduce((mejor, p) => (!mejor || p.explicacion.length > mejor.explicacion.length ? p : mejor), null);
    const peorOrdenar = masLargaDeTipo('ordenar');
    const peorError = masLargaDeTipo('error');
    expect(peorOrdenar).not.toBeNull();
    expect(peorError).not.toBeNull();

    /** Comprueba que el font-size computado de `.respuesta-resumen` (la línea
     * "Respuesta: X ✓" / "Orden: A › B › C › D…") es el mismo con las clases
     * de la cascada de encaje que tenga ahora mismo la tarjeta y sin ellas
     * (las quita, mide, y las vuelve a dejar como estaban). El enunciado y la
     * explicación SÍ pueden bajar de tamaño en la tarjeta respondida (spec
     * v0.1d §3/§4, cambio de contrato de Carlos 13-sep 10:19: única
     * relajación de "los tamaños de letra no cambian"), así que no se
     * comparan aquí a propósito — solo la respuesta, que nunca cambia. */
    async function comprobarFontSizeEstable(tarjetaLocator) {
      const CLASES_CASCADA = [
        'tarjeta--compacta-1',
        'tarjeta--sin-respuestas',
        'tarjeta--enunciado-menor',
        'tarjeta--sin-enunciado',
        'tarjeta--explicacion-menor',
        'tarjeta--explicacion-minima',
        'tarjeta--explicacion-clamp',
      ];
      const { compactado, normal } = await tarjetaLocator.evaluate((tarjeta, clases) => {
        const leerResumen = () => {
          const nodo = tarjeta.querySelector('.respuesta-resumen');
          return nodo ? getComputedStyle(nodo).fontSize : null;
        };
        const compactado = leerResumen();
        const teniaAntes = clases.filter((c) => tarjeta.classList.contains(c));
        tarjeta.classList.remove(...clases);
        const normal = leerResumen();
        // Deja la tarjeta EXACTAMENTE como estaba (esto es solo una medición).
        tarjeta.classList.add(...teniaAntes);
        return { compactado, normal };
      }, CLASES_CASCADA);
      expect(compactado).not.toBeNull();
      expect(compactado).toBe(normal);
    }

    async function comprobarEnViewport(viewport, sufijo) {
      await page.setViewportSize(viewport);
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      // Partida cerrada a estas dos ids concretas (mismo mecanismo que Misión
      // de hoy/Pendientes), expuesta solo con ?test=1 (ver window.__one en app.js).
      await page.evaluate(
        (ids) => window.__one.empezarPartida({ ids, etiqueta: 'peor-caso' }),
        [peorOrdenar.id, peorError.id]
      );

      const t = tarjetaActual(page);

      // Hueco 0: ordenar, fallado a propósito (línea "tuya" + la correcta: el
      // caso más alto posible de la respuesta compacta de este tipo).
      await expect(t).toHaveAttribute('data-indice', '0');
      for (let i = 3; i >= 0; i -= 1) await t.locator(`[data-original="${i}"]`).click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await comprobarFontSizeEstable(t);
      await page.screenshot({ path: `${CAPTURAS}/v0.1c-peor-caso-ordenar-${sufijo}.png` });
      await avanzarTrasRespuesta(page);

      // Hueco 1: error, fallado a propósito con una fila distinta a la sospechosa.
      await expect(t).toHaveAttribute('data-indice', '1');
      const numFilas = await t.locator('[data-test^="fila-"]').count();
      const indiceFallo = (peorError.sospechoso + 1) % numFilas;
      await t.locator(`[data-test="fila-${indiceFallo}"]`).click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await comprobarFontSizeEstable(t);
      await page.screenshot({ path: `${CAPTURAS}/v0.1c-peor-caso-error-${sufijo}.png` });
    }

    await comprobarEnViewport({ width: 375, height: 812 }, '375');
    await comprobarEnViewport({ width: 430, height: 932 }, '430');
  });

  // --- Tarea 3b: imágenes de Wikimedia Commons (spec v0.1c §4) ---
  test('Tarea 3b: imagen de Wikimedia Commons en la tarjeta respondida (banco de ejemplo)', async ({ page }) => {
    // datos/imagenes.ejemplo.json trae dos entradas a propósito distintas para
    // cubrir las dos ramas de atribución (requisito 3 del brief): his-001 con
    // autor y licencia CC BY-SA (la exige) y art-001 en Public domain sin autor
    // (no la exige: "Dominio público · Commons" basta). Ninguna depende de la
    // red (data: URI de 1×1), así el test no depende de Wikimedia.
    async function comprobarEnViewport(viewport) {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1&test=1');
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      await page.evaluate(
        (ids) => window.__one.empezarPartida({ ids, etiqueta: 'imagen-tarea-3b' }),
        ['his-001', 'art-001']
      );

      const t = tarjetaActual(page);

      // Hueco 0 (his-001, vf, CC BY-SA con autor): nunca antes de responder
      // (no debe dar pistas).
      await expect(t).toHaveAttribute('data-indice', '0');
      await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
      await t.locator('[data-test="vf-verdadero"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      // La imagen ya no se pliega nunca (spec v0.1d §3/§4): siempre visible
      // tras responder, aunque tenga que encogerse hasta su mínimo de 90px.
      await expect(t.locator('[data-test="imagen"]')).toBeVisible();
      const pie0 = t.locator('[data-test="imagen-pie"]');
      await expect(pie0).toContainText('Autor de ejemplo');
      await expect(pie0).toContainText('CC BY-SA 4.0');
      await expect(pie0.locator('a')).toHaveText('Commons');
      await expect(pie0.locator('a')).toHaveAttribute('target', '_blank');
      await expect(pie0.locator('a')).toHaveAttribute('rel', 'noopener');
      await avanzarTrasRespuesta(page);

      // Hueco 1 (art-001, test4, Public domain sin autor): atribución
      // simplificada, sin autor ni "undefined" colgando.
      await expect(t).toHaveAttribute('data-indice', '1');
      await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
      await t.locator('[data-test="opcion-0"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await expect(t.locator('[data-test="imagen"]')).toBeVisible();
      const pie1 = t.locator('[data-test="imagen-pie"]');
      await expect(pie1).toContainText('Dominio público');
      await expect(pie1).not.toContainText('undefined');
      await expect(pie1.locator('a')).toHaveText('Commons');
    }

    await comprobarEnViewport({ width: 375, height: 812 });
    await comprobarEnViewport({ width: 430, height: 932 });
  });

  // Peor caso definitivo (spec v0.1d §3/§4, cambio de contrato de Carlos
  // 13-sep 10:19, sustituye a la vieja alternancia "Ver imagen" de v0.1c):
  // "lo que sale primero si no hay espacio son las respuestas; si no, se
  // reduce el tamaño de la pregunta; si no, desaparece la pregunta. La
  // imagen y la explicación es lo que más valor añadido tiene después de
  // responder." Se usa la explicación MÁS LARGA de TODO el banco real (no
  // solo ordenar/error, a diferencia del test de más abajo) con una imagen
  // forzada encima: la imagen debe seguir viéndose (aunque sea a su mínimo de
  // 90px) y la explicación debe verse ENTERA, sin recorte y sin ningún toque
  // — son las respuestas y/o el enunciado quienes ceden espacio antes.
  test('mazo v0.1d §3/§4: peor caso (explicación más larga del banco + imagen) — la imagen se queda, la explicación se ve entera, sin tocar nada', async ({ page }) => {
    await page.goto('/');
    const banco = await page.evaluate(() => fetch('datos/banco.json').then((r) => r.json()));
    const peor = banco.reduce(
      (mejor, p) => (!mejor || p.explicacion.length > mejor.explicacion.length ? p : mejor),
      null
    );
    expect(peor).not.toBeNull();

    const imagenForzada = {
      id: peor.id,
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      pagina: 'https://commons.wikimedia.org/wiki/File:Ejemplo-peor-caso.png',
      titulo: 'Ejemplo-peor-caso.png',
      autor: 'Autor forzado',
      licencia: 'CC BY 4.0',
      leyenda: 'Imagen forzada para el peor caso (spec v0.1d)',
      termino: 'ejemplo',
      ancho: 1,
      alto: 1,
    };

    async function comprobarEnViewport(viewport, sufijo) {
      await page.setViewportSize(viewport);
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenForzada);
      await page.evaluate(
        (id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'peor-caso-imagen' }),
        peor.id
      );

      const t = tarjetaActual(page);
      await expect(t.locator('[data-test="imagen"]')).toHaveCount(0); // nunca antes de responder (no debe dar pistas)

      await responderPreguntaActual(page);
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);

      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);

      // La imagen NUNCA desaparece por falta de espacio (spec v0.1d §3/§4):
      // sigue visible aunque tenga que encogerse hasta su mínimo de 90px.
      const imagen = t.locator('[data-test="imagen"]');
      await expect(imagen).toBeVisible();
      const cajaImagen = await imagen.boundingBox();
      expect(cajaImagen.height).toBeGreaterThanOrEqual(88);

      // La explicación se ve ENTERA (sin recortar), sin ningún toque: son las
      // respuestas y/o el enunciado los que han cedido espacio antes.
      const explicacion = t.locator('[data-test="explicacion"]');
      await expect(explicacion).toBeVisible();
      expect((await explicacion.textContent()).trim()).toBe(peor.explicacion.trim());

      // Sin ningún listener de alternancia en la tarjeta respondida (cambio de
      // contrato de Carlos, 13-sep 10:15: "evitar cantidad de clics"): tocar
      // la explicación o la respuesta compacta no cambia nada del DOM.
      const claseAntes = await t.getAttribute('class');
      await explicacion.click({ force: true });
      await t.locator('.zona-respuesta').click({ force: true }).catch(() => {});
      expect(await t.getAttribute('class')).toBe(claseAntes);
      await expect(explicacion).toBeVisible();
      expect((await explicacion.textContent()).trim()).toBe(peor.explicacion.trim());

      await page.screenshot({ path: `${CAPTURAS}/v0.1d-peor-caso-imagen-explicacion-${sufijo}.png` });
    }

    await comprobarEnViewport({ width: 375, height: 812 }, '375');
    await comprobarEnViewport({ width: 430, height: 932 }, '430');
  });

  // Ronda 1 de revisión de v0.1d (Important, punto 3): un desborde EXTREMO
  // (enunciado + explicación larguísimos, con imagen) que fuerce la cascada
  // más allá de solo quitar las respuestas, para comprobar paso a paso — con
  // getComputedStyle, no solo con el nombre de la clase — que cada pieza
  // realmente se oculta/encoge y que el ORDEN es siempre respuestas ->
  // enunciado -> explicación, nunca al revés (la imagen no se toca nunca).
  // Pregunta sintética inyectada vía window.__one.inyectarPregunta (nuevo,
  // añadido en esta ronda): más simple y menos frágil que interceptar
  // datos/banco.json con page.route, y no depende de qué traiga el banco real.
  test('mazo v0.1d §3/§4 (ronda 1 de revisión): cascada de encaje paso a paso — respuestas → enunciado → explicación, la imagen se queda', async ({ page }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const idSintetico = 'sintetico-desborde-extremo';
    const preguntaSintetica = {
      id: idSintetico,
      area: 'historia',
      tipo: 'vf',
      nivel: 1,
      enunciado:
        'Enunciado sintético deliberadamente larguísimo para forzar un desborde extremo de la tarjeta respondida y comprobar que la cascada de encaje sacrifica primero las respuestas, luego el enunciado, y solo al final la explicación. '.repeat(
          4
        ),
      explicacion:
        'Explicación sintética igualmente larguísima, pensada para seguir sin caber ni siquiera después de quitar las respuestas y el enunciado enteros, de forma que la cascada llegue también a encoger la explicación (spec v0.1d §3/§4, ronda 1 de revisión, 13-sep). '.repeat(
          4
        ),
      confianza: 1,
      generador: 'manual',
      verificador: 'manual',
      verificado: true,
      respuesta: true,
    };
    const imagenSintetica = {
      id: idSintetico,
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      pagina: 'https://commons.wikimedia.org/wiki/File:Ejemplo-desborde-extremo.png',
      titulo: 'Ejemplo-desborde-extremo.png',
      autor: 'Autor forzado',
      licencia: 'CC BY 4.0',
      leyenda: 'Imagen forzada para el desborde extremo (ronda 1 de revisión)',
      termino: 'ejemplo',
      ancho: 1,
      alto: 1,
    };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSintetica);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenSintetica);
    await page.evaluate(
      (id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'desborde-extremo' }),
      idSintetico
    );

    const t = tarjetaActual(page);
    await expect(t.locator('[data-test="imagen"]')).toHaveCount(0); // nunca antes de responder
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const estado = await t.evaluate((tarjeta) => {
      const zonaRespuesta = tarjeta.querySelector('.zona-respuesta');
      const enunciado = tarjeta.querySelector('.enunciado');
      const explicacion = tarjeta.querySelector('.explicacion');
      const imagen = tarjeta.querySelector('[data-test="imagen"]');
      return {
        clases: [...tarjeta.classList],
        zonaRespuestaDisplay: zonaRespuesta ? getComputedStyle(zonaRespuesta).display : null,
        enunciadoDisplay: enunciado ? getComputedStyle(enunciado).display : null,
        enunciadoFontSize: enunciado ? getComputedStyle(enunciado).fontSize : null,
        explicacionFontSize: explicacion ? getComputedStyle(explicacion).fontSize : null,
        imagenAlto: imagen ? imagen.getBoundingClientRect().height : null,
      };
    });

    // La imagen NUNCA desaparece por falta de espacio (spec v0.1d §3/§4): con
    // este desborde a propósito absurdo, sigue ahí, aunque sea a su mínimo.
    expect(estado.imagenAlto).not.toBeNull();
    expect(estado.imagenAlto).toBeGreaterThanOrEqual(88);

    // Paso (b)/(c): las respuestas son lo primero en ceder. Con este
    // desborde tan extremo, tienen que haber desaparecido del todo.
    expect(estado.clases).toContain('tarjeta--sin-respuestas');
    expect(estado.zonaRespuestaDisplay).toBe('none');

    // Paso (d)/(e): el enunciado. Con este desborde, la cascada tiene que
    // haber llegado como mínimo a encogerlo; si además lo ha quitado del
    // todo, getComputedStyle lo confirma (display:none real, no solo el
    // nombre de la clase — la corrección de esta ronda: antes el selector
    // era `>` en vez de descendiente y esta clase no hacía nada).
    const enunciadoTocado =
      estado.clases.includes('tarjeta--enunciado-menor') || estado.clases.includes('tarjeta--sin-enunciado');
    expect(enunciadoTocado).toBe(true);
    if (estado.clases.includes('tarjeta--sin-enunciado')) {
      expect(estado.enunciadoDisplay).toBe('none');
    } else {
      expect(estado.enunciadoFontSize).toBe('15px');
    }

    // Orden: si la cascada ha llegado a tocar la explicación (menor, mínima o
    // recorte final), el enunciado tiene que estar YA fuera del todo — nunca
    // al revés (la imagen y la explicación son "lo último que se toca").
    const explicacionTocada =
      estado.clases.includes('tarjeta--explicacion-menor') ||
      estado.clases.includes('tarjeta--explicacion-minima') ||
      estado.clases.includes('tarjeta--explicacion-clamp');
    if (explicacionTocada) {
      expect(estado.clases).toContain('tarjeta--sin-enunciado');
      if (estado.clases.includes('tarjeta--explicacion-minima') || estado.clases.includes('tarjeta--explicacion-clamp')) {
        expect(estado.explicacionFontSize).toBe('13px');
      } else {
        expect(estado.explicacionFontSize).toBe('14px');
      }
    }
  });

  test('Tarea 3b: capturas con art-003 respondida (banco real) a 375×812 y 430×932', async ({ page }) => {
    // art-003 (La noche estrellada, Public domain) ya tiene entrada real en
    // datos/imagenes.json: capturas pedidas en el brief para revisión visual,
    // con la imagen realmente cargada desde Wikimedia Commons (no una imagen
    // de prueba), sin scroll ni cortes.
    async function capturar(viewport, sufijo) {
      await page.setViewportSize(viewport);
      // Estado limpio en CADA captura (ronda de corrección 1: antes se
      // reutilizaba localStorage entre 375 y 430, así que la segunda salía
      // con XP/nivel arrastrados de la primera en vez de partir igual).
      await page.goto('/?test=1');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      await page.evaluate(() => window.__one.empezarPartida({ ids: ['art-003'], etiqueta: 'captura-imagen' }));

      const t = tarjetaActual(page);
      await t.locator('[data-test="vf-verdadero"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);
      // La imagen ya no se pliega nunca (spec v0.1d §3/§4): siempre visible,
      // así que el <img loading="lazy"> real no necesita nada especial para
      // dispararse antes de esperar a que cargue.
      await expect(t.locator('[data-test="imagen"]')).toBeVisible();
      // I4: sin la red de Wikimedia viva (o si responde lento/falla), el
      // <img> real puede no llegar a cargar nunca — construirBloqueImagen()
      // quita el bloque entero al fallar (ver app.js). Con timeout corto y
      // motivo explícito en vez de dejar que el test cuelgue ~30s sin decir
      // por qué (era el propio hallazgo).
      const estadoImagen = await esperarImagenOFallo(page, 3000);
      test.skip(
        estadoImagen !== 'ok',
        `Imagen real de art-003 no disponible (${estadoImagen}): sin red o Wikimedia no respondió a tiempo.`
      );
      // Espera a que el JPEG real esté DECODIFICADO y listo para pintar, no
      // solo descargado (ronda de corrección 1: `img.complete &&
      // naturalWidth > 0` se cumple antes de que el navegador termine de
      // pintar el bitmap, y la captura de 430 salía con la caja en blanco).
      // img.decode() resuelve justo cuando ya se puede pintar sin más
      // decodificación pendiente; ya se sabe que la imagen cargó bien
      // (estadoImagen === 'ok'), así que decode() no puede quedarse esperando
      // un 'load' que no vaya a llegar. Dos requestAnimationFrame de margen
      // aseguran que ESE frame decodificado ya se compuso en pantalla antes
      // del screenshot.
      await page.evaluate(async () => {
        const img = document.querySelector('[data-test="imagen"] img');
        if (!img) return;
        try {
          await img.decode();
        } catch (err) {
          // Ya cargada (estadoImagen 'ok'): decode() es solo para asegurar el
          // pintado, no una condición de carga — un rechazo aquí no bloquea.
        }
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await page.screenshot({ path: `${CAPTURAS}/v0.1c-imagen-${sufijo}.png` });
      // Misma captura, también con el nombre que pide la spec v0.1d (revisión
      // "sin hueco muerto, imagen proporcionada"): tarjeta respondida CON
      // imagen real de Wikimedia Commons.
      await page.screenshot({ path: `${CAPTURAS}/v0.1d-respondida-imagen-${sufijo}.png` });
    }

    await capturar({ width: 375, height: 812 }, '375');
    await capturar({ width: 430, height: 932 }, '430');
  });

  test('Tarea 3b: imagen rota (404) se quita entera, sin dejar una caja vacía', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // URL relativa que el propio servidor de test (tools/servir.js) responde
    // con 404: dispara el onerror real del <img>, no uno simulado.
    await page.evaluate(() =>
      window.__one.forzarImagen('his-001', {
        id: 'his-001',
        url: 'datos/no-existe-3b.png',
        pagina: 'https://commons.wikimedia.org/wiki/File:Ejemplo.png',
        titulo: 'Ejemplo',
        autor: 'Autor de ejemplo',
        licencia: 'CC0',
        leyenda: 'Imagen rota a propósito',
        termino: 'ejemplo',
        ancho: 1,
        alto: 1,
      })
    );
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['his-001'], etiqueta: 'imagen-rota' }));

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    // El onerror del <img> es asíncrono (espera a la respuesta 404 real):
    // toHaveCount reintenta hasta que construirBloqueImagen() quita el bloque.
    await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
    await expect(t.locator('[data-test="imagen-pie"]')).toHaveCount(0);
    // Sin imagen de verdad, el bloque de contenido vuelve a centrarse (spec
    // v0.1d §3): la marca que lo alineaba arriba se quita con la imagen.
    await expect(t.locator('.tarjeta-contenido')).not.toHaveClass(/tarjeta-contenido--imagen/);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
  });

  // --- v0.1d: gesto, contador, fila compacta, confianza compacta, imagen ---

  test('mazo v0.1d §1: contador de la cabecera (respondidas/total en partida)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    const t = tarjetaActual(page);
    const contador = t.locator('[data-test="mazo-contador"]');
    await expect(contador).toBeVisible();
    await expect(contador).toHaveText('0/10');

    await responderPreguntaActual(page);
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(contador).toHaveText('1/10');
    await avanzarTrasRespuesta(page);

    // La segunda tarjeta ya nace con el contador al día (se refresca en toda
    // la ventana de 3 nodos del mazo, no solo en la actual, ver
    // actualizarBarraProgreso en app.js) y vuelve a subir al responderla.
    await expect(contador).toHaveText('1/10');
    await responderPreguntaActual(page);
    await expect(contador).toHaveText('2/10');
  });

  test('mazo v0.1d §1: contador del repaso (posición/total, no respondidas/10)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();

    // Necesario para acertar SIEMPRE las de tipo "error" (spec de
    // responderPreguntaActual): sin este mapa, "responder correctamente"
    // adivina el índice 0, que falla en cualquier "error" cuyo sospechoso no
    // sea ese, metiendo fallos NO intencionados en el repaso.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    // Falla las dos primeras a propósito para tener exactamente dos tarjetas
    // de repaso con posiciones distintas que comprobar.
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await avanzarTrasRespuesta(page);
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await avanzarTrasRespuesta(page);
    // El resto, acertadas, hasta terminar la partida.
    for (let i = 0; i < 8; i += 1) {
      if (await page.locator('[data-test="resumen"]').isVisible()) break;
      await responderPreguntaActual(page, sospechosoPorTitulo);
      await avanzarTrasRespuesta(page);
    }
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();

    await page.keyboard.press('ArrowUp'); // de la tarjeta 0 (cifras) a la 1ª de repaso
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('1/2');

    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('2/2');
  });

  test('mazo v0.1d §2: fila de acción compacta de 44px tras responder', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    const t = tarjetaActual(page);
    await responderPreguntaActual(page);
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();

    const fila = t.locator('.fila-accion');
    await expect(fila).toBeVisible();
    const cajaFila = await fila.boundingBox();
    expect(cajaFila.height).toBeGreaterThanOrEqual(40);
    expect(cajaFila.height).toBeLessThanOrEqual(48);

    // "esta pregunta está mal" a la izquierda, "Siguiente ›" a la derecha, EN
    // LA MISMA fila (no una debajo de otra, como en v0.1c).
    const cajaEstaMal = await t.locator('[data-test="esta-mal"]').boundingBox();
    const cajaSiguiente = await t.locator('[data-test="siguiente"]').boundingBox();
    expect(Math.abs(cajaEstaMal.y - cajaSiguiente.y)).toBeLessThan(12);
    expect(cajaEstaMal.x).toBeLessThan(cajaSiguiente.x);

    // "esta pregunta está mal" -> "Anotado" ocupa el mismo sitio, sin fila aparte.
    await t.locator('[data-test="esta-mal"]').click();
    await expect(t.locator('[data-test="esta-mal"]')).toBeHidden();
    await expect(t.locator('.reportada')).toBeVisible();
    await expect(t.locator('.reportada')).toHaveText('Anotado');
    await assertTarjetaSinScroll(page);
  });

  test('mazo v0.1d §3: confianza compacta a 32px tras responder, sigue editable', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    const t = tarjetaActual(page);
    const cajaAntes = await t.locator('[data-test="confianza"]').boundingBox();
    expect(cajaAntes.height).toBeGreaterThanOrEqual(42);
    expect(cajaAntes.height).toBeLessThanOrEqual(46);

    await responderPreguntaActual(page);
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();

    const confianza = t.locator('[data-test="confianza"]');
    await expect(confianza).toBeVisible();
    const cajaDespues = await confianza.boundingBox();
    expect(cajaDespues.height).toBeGreaterThanOrEqual(30);
    expect(cajaDespues.height).toBeLessThanOrEqual(34);

    // Sigue editable (spec v0.1c §2.3): cambiar a Alta recalcula el XP
    // mostrado y el guardado (responderPreguntaActual siempre acierta).
    const textoAntes = await t.locator('[data-test="feedback-texto"]').textContent();
    const xpAntes = await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).xp);
    await t.locator('[data-test="confianza-alta"]').click();
    await expect(t.locator('[data-test="confianza-alta"]')).toHaveAttribute('aria-pressed', 'true');
    const textoDespues = await t.locator('[data-test="feedback-texto"]').textContent();
    const xpDespues = await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).xp);
    expect(textoDespues).not.toBe(textoAntes);
    expect(xpDespues).not.toBe(xpAntes);
    await assertTarjetaSinScroll(page);
  });

  test('mazo v0.1d §1: indicador de gesto visible antes de deslizar, se apaga tras un deslizamiento con éxito', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    const indicador = page.locator('[data-test="mazo-gesto"]');
    await expect(indicador).toBeVisible();

    // Navegar con teclado NO enseña el gesto (solo cuenta un deslizamiento
    // real): el indicador se queda encendido.
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await expect(indicador).toBeVisible();

    // Un deslizamiento vertical real (Pointer Events, como en el resto de la
    // suite) sí lo apaga, y se queda apagado el resto de la sesión.
    const puntoAgarre = async () => {
      const caja = await tarjetaActual(page).locator('.enunciado, .instruccion-error').first().boundingBox();
      return { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
    };
    const p0 = await puntoAgarre();
    await arrastrar(page, [p0, { x: p0.x, y: p0.y - 80 }]);
    await esperarAsentamientoMazo(page);
    await expect(indicador).toBeHidden();

    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await expect(indicador).toBeHidden();
  });

  test('mazo v0.1d §3/§4: la imagen absorbe el sobrante, sin hueco muerto (banco de ejemplo)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    // his-001 trae imagen en datos/imagenes.ejemplo.json (data: URI, sin red).
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['his-001'], etiqueta: 'sobrante-imagen' }));

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    await expect(t.locator('[data-test="imagen"]')).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const medidas = await t.evaluate((tarjeta) => {
      const contenido = tarjeta.querySelector('.tarjeta-contenido');
      return { scrollHeight: contenido.scrollHeight, clientHeight: contenido.clientHeight };
    });
    // "Sin hueco muerto" (spec v0.1d §3): con la imagen absorbiendo el
    // sobrante, lo que ocupa el contenido debe quedar muy cerca del alto
    // disponible — nunca más (assertTarjetaSinScroll ya lo cubre) ni mucho
    // menos (esto, que assertTarjetaSinScroll NO cubre).
    expect(medidas.clientHeight - medidas.scrollHeight).toBeLessThan(24);
  });

  // Capturas pedidas por el brief (docs/capturas/v0.1d-*.png, revisadas con
  // Read por el propio agente antes de entregar): sin-responder, respondida
  // sin imagen y repaso. "respondida-imagen" ya se guarda en el test de
  // art-003 de arriba (imagen real de Wikimedia Commons).
  test('capturas v0.1d: sin-responder, respondida-sin-imagen, repaso', async ({ page }) => {
    async function capturar(viewport, sufijo) {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1&test=1');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      // eco-001 (vf) no tiene entrada en datos/imagenes.ejemplo.json: tarjeta
      // sin imagen, tanto antes como después de responder.
      await page.evaluate(() => window.__one.empezarPartida({ ids: ['eco-001'], etiqueta: 'capturas-v0.1d' }));
      await esperarAsentamientoMazo(page);
      const t = tarjetaActual(page);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await page.screenshot({ path: `${CAPTURAS}/v0.1d-sin-responder-${sufijo}.png` });

      // Fallada a propósito: dos pájaros de un tiro — comprueba la tarjeta
      // respondida sin imagen Y deja un elemento en "Para repasar" para la
      // captura de repaso de más abajo.
      await t.locator('[data-test="vf-falso"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
      await page.screenshot({ path: `${CAPTURAS}/v0.1d-respondida-sin-imagen-${sufijo}.png` });

      // Único hueco del filtro ya respondido: "Siguiente" termina la partida
      // directamente (irASiguienteHueco -> finalizarPartida).
      await t.locator('[data-test="siguiente"]').click();
      await expect(page.locator('[data-vista="resumen"]')).toBeVisible();
      await page.keyboard.press('ArrowUp'); // de la tarjeta 0 (cifras) a la 1ª de repaso
      await esperarAsentamientoMazo(page);
      await expect(tarjetaActual(page)).toHaveAttribute('data-test', 'repaso-tarjeta');
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await page.screenshot({ path: `${CAPTURAS}/v0.1d-repaso-${sufijo}.png` });
    }

    await capturar({ width: 375, height: 812 }, '375');
    await capturar({ width: 430, height: 932 }, '430');
  });
});

// ============================================================================
// v0.1e: visuales generados (spec v0.1e §2/§4, construirVisual en visuales.js)
// -- un dibujo SVG en la misma caja que la imagen, para las preguntas que no
// tienen imagen de Commons. Un test por tipo desde datos/visuales.ejemplo.json
// (un ejemplo por tipo, con los máximos de longitud que permite la spec §2 —
// no ejemplos cortos y cómodos, para comprobar de verdad que el recorte de
// texto del módulo funciona), más el caso de prioridad "imagen y visual ->
// gana la imagen". Describe aparte (no depende del banco de ejemplo cargado
// por la app: inyectarPregunta añade la pregunta sintética al banco YA
// cargado, así que no importa si viene de /?ejemplo=1 o del banco real).
// ============================================================================
test.describe('ONE · visuales v0.1e', () => {
  const TIPOS_VISUAL = ['formula', 'linea-tiempo', 'barras', 'comparacion', 'flujo', 'dato'];

  for (const tipo of TIPOS_VISUAL) {
    test(`visual v0.1e "${tipo}": se pinta en la tarjeta respondida, cabe sin scroll y muestra su leyenda`, async ({
      page,
    }) => {
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      const visualesEjemplo = await page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json()));
      const pregunta = visualesEjemplo[tipo];
      expect(pregunta).toBeTruthy();

      await page.evaluate((p) => window.__one.inyectarPregunta(p), pregunta);
      await page.evaluate(
        (id) => window.__one.empezarPartida({ ids: [id], etiqueta: `visual-${id}` }),
        pregunta.id
      );

      const t = tarjetaActual(page);
      // Sin responder no debe verse ni dar pistas (mismo contrato que la imagen).
      await expect(t.locator('[data-test="visual"]')).toHaveCount(0);
      await t.locator('[data-test="vf-verdadero"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);

      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);

      const visual = t.locator('[data-test="visual"]');
      await expect(visual).toBeVisible();
      const caja = await visual.boundingBox();
      // Mínimo de la cascada de encaje (spec v0.1d §4): 90px, con el mismo
      // margen de 2px que ya usa assertTarjetaSinScroll para redondeos.
      expect(caja.height).toBeGreaterThanOrEqual(88);

      const leyenda = t.locator('.visual-pie');
      await expect(leyenda).toBeVisible();
      await expect(leyenda).toHaveText(pregunta.visual.leyenda);

      await page.screenshot({ path: `${CAPTURAS}/v0.1e-${tipo}-375.png` });
    });
  }

  test('visual v0.1e: con imagen Y visual en la misma pregunta, gana la imagen (spec v0.1e §2, prioridad fija)', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const [visualesEjemplo, imagenesEjemplo] = await Promise.all([
      page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json())),
      page.evaluate(() => fetch('datos/imagenes.ejemplo.json').then((r) => r.json())),
    ]);
    // Id sintético (no reutiliza uno del banco real/de ejemplo): mismo motivo
    // que el resto de sintéticos de este fichero (ver "cascada de encaje paso
    // a paso" más arriba) — evita depender de qué traiga el banco en cada
    // momento y de cómo resuelva un id duplicado la selección por filtro.
    const idSintetico = 'sintetico-visual-e-imagen';
    const preguntaSintetica = { ...visualesEjemplo.dato, id: idSintetico };
    const imagenForzada = { ...imagenesEjemplo['his-001'], id: idSintetico };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSintetica);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenForzada);
    await page.evaluate(
      (id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'visual-y-imagen' }),
      idSintetico
    );

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await expect(t.locator('[data-test="imagen"]')).toBeVisible();
    await expect(t.locator('[data-test="visual"]')).toHaveCount(0);
  });
});
