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
 * en el scrollHeight de la .vista (ver ajustarEncaje en app.js). */
async function assertTarjetaSinScroll(page) {
  const medidas = await page.evaluate(() => {
    const tarjeta = document.querySelector('.tarjeta-mazo--actual');
    return tarjeta ? { alto: tarjeta.scrollHeight, visible: tarjeta.clientHeight } : null;
  });
  expect(medidas).not.toBeNull();
  expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
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

    // 7. "Inicio" (resumen) vuelve SIEMPRE al HUB, nunca a los emojis. La racha
    // ya cuenta esta partida filtrada como partida completa del día, la nota de
    // economía deja de estar vacía ('—'), y Pendientes pasa a 1 (el fallo de la
    // primera pregunta de economía sigue sin recuperar).
    await page.locator('[data-test="inicio"]').click();
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
    await expect(page.locator('[data-test="repaso-vacio"]')).toBeVisible();
    await expect(page.locator('.resumen-repaso-tarjeta')).toHaveCount(0);
    await assertSinScroll(page);
    await page.locator('[data-test="inicio"]').click();
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

    // 11. Resumen visible, racha a 1 (misma partida del día), "Para repasar" con
    // al menos una tarjeta (la fallada en la pregunta 1) y sin scroll.
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await expect(page.locator('[data-test="repaso"]')).toBeVisible();
    const tarjetasRepaso = page.locator('.resumen-repaso-tarjeta');
    await expect(tarjetasRepaso).not.toHaveCount(0);
    await expect(page.locator('[data-test="repaso-puntos"]')).toBeVisible();
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/08-resumen.png` });

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
      await responderPreguntaActual(page, sospechosoPorTitulo);
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
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
    await page.screenshot({ path: `${CAPTURAS_430}/08-resumen.png` });
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

  // Peor caso de la regla de encaje (spec v0.1c §4.2): la pregunta 'ordenar' y
  // la 'error' con la explicación MÁS LARGA del banco REAL (no el de ejemplo),
  // respondidas (falladas a propósito: es la variante más alta de la respuesta
  // compacta, con la línea "tuya" tachada además de la correcta), sin scroll
  // ni en la vista ni en la tarjeta, a 375×812 y 430×932, y sin que ningún
  // font-size computado cambie entre el estado normal y los compactos.
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

    /** Compara el font-size computado de .enunciado/.explicacion/.respuesta-resumen
     * CON las clases tarjeta--compacta-1/2 que tenga ahora mismo la tarjeta y SIN
     * ellas (las quita, mide, y las vuelve a dejar como estaban): la spec v0.1c
     * §4.2 exige que el plegado nunca toque tamaños de letra, solo qué se ve. */
    async function comprobarFontSizeEstable(tarjetaLocator) {
      const { compactado, normal } = await tarjetaLocator.evaluate((tarjeta) => {
        function tamanos() {
          const leer = (selector) => {
            const nodo = tarjeta.querySelector(selector);
            return nodo ? getComputedStyle(nodo).fontSize : null;
          };
          return {
            // "error" con el enunciado genérico del banco pinta la instrucción
            // corta (.instruccion-error) en vez de .enunciado (ver
            // construirBloqueEnunciado): se comprueba el que exista.
            enunciado: leer('.enunciado') || leer('.instruccion-error'),
            explicacion: leer('.explicacion'),
            resumen: leer('.respuesta-resumen'),
          };
        }
        const compactado = tamanos();
        const teniaCompacta1 = tarjeta.classList.contains('tarjeta--compacta-1');
        const teniaCompacta2 = tarjeta.classList.contains('tarjeta--compacta-2');
        tarjeta.classList.remove('tarjeta--compacta-1', 'tarjeta--compacta-2');
        const normal = tamanos();
        // Deja la tarjeta EXACTAMENTE como estaba (esto es solo una medición).
        if (teniaCompacta1) tarjeta.classList.add('tarjeta--compacta-1');
        if (teniaCompacta2) tarjeta.classList.add('tarjeta--compacta-2');
        return { compactado, normal };
      });
      expect(compactado.explicacion).not.toBeNull();
      expect(compactado.enunciado).toBe(normal.enunciado);
      expect(compactado.explicacion).toBe(normal.explicacion);
      expect(compactado.resumen).toBe(normal.resumen);
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
});
