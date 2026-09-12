// e2e de ONE: inicio (🧠/💪) -> HUB (radar + misión + pendientes + niveles) ->
// partida (selector de confianza, feedback compacto) -> resumen (carrusel "Para
// repasar") -> HUB, contra el banco de ejemplo, más una partida de humo contra
// el banco real. Playwright headless a 375x812.
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

/** Detecta el tipo de la pregunta actual por sus selectores data-test, sin responder. */
async function tipoPreguntaActual(page) {
  if (await page.locator('[data-test="vf-verdadero"]').count()) return 'vf';
  if (await page.locator('[data-test="opcion-0"]').count()) return 'test4';
  if (await page.locator('[data-test="item-0"]').count()) return 'ordenar';
  if (await page.locator('[data-test="fila-0"]').count()) return 'error';
  throw new Error('No se reconoce el tipo de la pregunta actual (ningún selector conocido presente)');
}

/** Responde CORRECTAMENTE la pregunta actual del banco de ejemplo, sea del tipo
 * que sea. `sospechosoPorTitulo` (opcional, Map título -> índice) permite acertar
 * siempre las preguntas de tipo "error" sea cual sea la que toque. */
async function responderPreguntaActual(page, sospechosoPorTitulo) {
  const tipo = await tipoPreguntaActual(page);
  if (tipo === 'vf') {
    await page.locator('[data-test="vf-verdadero"]').click();
  } else if (tipo === 'test4') {
    await page.locator('[data-test="opcion-0"]').click();
  } else if (tipo === 'ordenar') {
    // Tocar por el índice ORIGINAL (data-original), no por la posición mostrada tras
    // barajar: así siempre se acierta el orden correcto (evaluar() exige [0,1,2,3]).
    for (let i = 0; i < 4; i++) await page.locator(`[data-original="${i}"]`).click();
  } else {
    let indice = 0;
    if (sospechosoPorTitulo) {
      const titulo = (await page.locator('.titulo-tarjeta').textContent())?.trim();
      if (sospechosoPorTitulo.has(titulo)) indice = sospechosoPorTitulo.get(titulo);
    }
    await page.locator(`[data-test="fila-${indice}"]`).click();
  }
  return tipo;
}

/** Falla A PROPÓSITO la pregunta actual del banco de ejemplo, sea del tipo que sea. */
async function fallarPreguntaActual(page, sospechosoPorTitulo) {
  const tipo = await tipoPreguntaActual(page);
  if (tipo === 'vf') {
    await page.locator('[data-test="vf-falso"]').click();
  } else if (tipo === 'test4') {
    await page.locator('[data-test="opcion-3"]').click();
  } else if (tipo === 'ordenar') {
    for (let i = 3; i >= 0; i--) await page.locator(`[data-original="${i}"]`).click();
  } else {
    let sospechoso = 0;
    if (sospechosoPorTitulo) {
      const titulo = (await page.locator('.titulo-tarjeta').textContent())?.trim();
      if (sospechosoPorTitulo.has(titulo)) sospechoso = sospechosoPorTitulo.get(titulo);
    }
    const filas = await page.locator('[data-test^="fila-"]').count();
    await page.locator(`[data-test="fila-${(sospechoso + 1) % filas}"]`).click();
  }
  return tipo;
}

/** Sin avance automático (spec "pantalla completa" 12-sep): tras responder,
 * acierto o fallo, la partida SIEMPRE espera a "Siguiente". */
async function avanzarTrasRespuesta(page) {
  const siguiente = page.locator('[data-test="siguiente"]');
  await expect(siguiente).toBeVisible();
  await siguiente.click();
}

/** vf: FALSO/VERDADERO fuera de la tarjeta (en la zona de acción) y la pista de
 * deslizamiento visible sobre la propia tarjeta (spec "pantalla completa" 12-sep). */
async function comprobarZonaAccionVf(page) {
  await expect(page.locator('[data-test="pista-swipe"]')).toBeVisible();
  await expect(page.locator('.tarjeta [data-test="vf-falso"]')).toHaveCount(0);
  await expect(page.locator('[data-test="vf-falso"]')).toBeVisible();
  await expect(page.locator('[data-test="vf-verdadero"]')).toBeVisible();
}

/** Juega hasta que aparece el resumen, respondiendo siempre correctamente y
 * avanzando tras cada respuesta con avanzarTrasRespuesta(). `alDetectarTipo`
 * (opcional) se llama en CADA vuelta, con el selector de confianza todavía
 * visible (antes de responder) y el tipo de la pregunta actual — la propia
 * función decide si ya lo había visto (ver capturarSiNuevo más abajo: dedup
 * compartido con las preguntas 1 y 2, respondidas fuera de este bucle).
 * `alVerFeedback` se llama la primera vez que se ve el feedback en toda la
 * partida. En cada vuelta comprueba que el selector de confianza esté visible
 * antes de responder y oculto después, y que la vista no haga scroll ni antes
 * ni después de responder (las 4 mecánicas del banco de ejemplo, y cualquiera
 * que salga en la partida de humo contra el banco real). */
async function jugarPartida(page, { alDetectarTipo, alVerFeedback, sospechosoPorTitulo } = {}) {
  let feedbackVisto = false;

  for (let vueltas = 0; vueltas < 25; vueltas += 1) {
    if (await page.locator('[data-test="resumen"]').isVisible()) return;

    await expect(page.locator('[data-test="confianza"]')).toBeVisible();
    await expect(page.locator('[data-test="confianza-etiqueta"]')).toHaveText('Confianza');
    await assertSinScroll(page);

    const tipo = await tipoPreguntaActual(page);
    if (tipo === 'vf') await comprobarZonaAccionVf(page);
    if (alDetectarTipo) await alDetectarTipo(tipo);

    await responderPreguntaActual(page, sospechosoPorTitulo);

    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(page.locator('[data-test="confianza"]')).toBeHidden();
    // La explicación se muestra siempre al responder, sin tocar nada (spec
    // "pantalla completa" 12-sep: sin avance automático, sin botón "?").
    await expect(page.locator('#explicacion-texto')).toBeVisible();
    await assertSinScroll(page);
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
    await expect(page.locator('[data-test="nivel-pregunta"]')).toContainText('Economía');

    // 5. Primera pregunta de economía: selector de confianza (con su etiqueta)
    // visible antes de responder; "Siguiente" (dentro de #contenedor-feedback)
    // debe estar OCULTO hasta responder. Fallamos A PROPÓSITO (la tarjeta se
    // sacude, se ve la explicación sola, y sin avance automático: espera
    // siempre a "Siguiente"). Esta tarjeta queda pendiente: el resto del flujo
    // la usa para probar "Pendientes" y el chip "Recuperada".
    await expect(page.locator('[data-test="confianza"]')).toBeVisible();
    await expect(page.locator('[data-test="confianza-etiqueta"]')).toHaveText('Confianza');
    await expect(page.locator('[data-test="confianza-media"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-test="siguiente"]')).toBeHidden();
    // El orden de las 2 preguntas de economía lo decide el rng del motor: puede
    // salir primero la vf o la de tipo "error", así que fallamos sea cual sea.
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await expect(page.locator('[data-test="confianza"]')).toBeHidden();
    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(page.locator('#explicacion-texto')).toBeVisible();
    await assertSinScroll(page);
    await page.locator('[data-test="siguiente"]').click();

    // 6. Segunda (y última) pregunta de economía: acertamos a propósito. Al ser
    // la última del área filtrada, puede avanzar sola al resumen o esperar
    // "Siguiente".
    await expect(page.locator('[data-test="nivel-pregunta"]')).toContainText('Economía');
    await expect(page.locator('[data-test="confianza"]')).toBeVisible();
    await responderPreguntaActual(page, sospechosoPorTitulo);
    // Acierto: la explicación también se ve siempre, sin tocar nada (spec
    // "pantalla completa" 12-sep: sin avance automático, acierto o fallo).
    await expect(page.locator('#explicacion-texto')).toBeVisible();
    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
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
    await expect(page.locator('[data-test="confianza"]')).toBeVisible();
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await expect(page.locator('[data-test="recuperada"]')).toBeVisible();
    await expect(page.locator('[data-test="recuperada"]')).toContainText('Recuperada');
    await expect(page.locator('[data-test="recuperada"]')).toContainText('la fallaste el');
    await assertSinScroll(page);
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
    await expect(page.locator('[data-test="nivel-pregunta"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // 10. Partida normal (sin filtro) de verdad, desde "Comenzar": la primera
    // pregunta se falla a propósito (deja al menos una tarjeta en "Para repasar"
    // para el resumen), la segunda se acierta con confianza Alta (comprueba el
    // "×1,5"), y el resto se juega en modo genérico capturando cada mecánica
    // nueva (con el selector de confianza visible) y el primer feedback.
    await page.locator('[data-test="comenzar"]').click();
    await expect(page.locator('[data-test="nivel-pregunta"]')).toBeVisible();

    const tiposVistos = new Set();
    const nombreCaptura = { vf: '03-vf.png', test4: '04-test4.png', ordenar: '05-ordenar.png', error: '06-error.png' };
    async function capturarSiNuevo(tipo) {
      if (tiposVistos.has(tipo)) return;
      tiposVistos.add(tipo);
      await assertSinScroll(page);
      await page.screenshot({ path: `${CAPTURAS}/${nombreCaptura[tipo]}` });
    }

    // Pregunta 1: falla a propósito con confianza Media (por defecto).
    await expect(page.locator('[data-test="confianza"]')).toBeVisible();
    await capturarSiNuevo(await tipoPreguntaActual(page));
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await expect(page.locator('[data-test="confianza"]')).toBeHidden();
    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    await assertSinScroll(page);
    await page.locator('[data-test="siguiente"]').click();

    // Pregunta 2: confianza Alta + acierto -> "×1,5" en el feedback.
    await expect(page.locator('[data-test="confianza"]')).toBeVisible();
    await capturarSiNuevo(await tipoPreguntaActual(page));
    await page.locator('[data-test="confianza-alta"]').click();
    await expect(page.locator('[data-test="confianza-alta"]')).toHaveAttribute('aria-pressed', 'true');
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await expect(page.locator('#feedback-texto')).toContainText('×1,5');
    await assertSinScroll(page);
    await avanzarTrasRespuesta(page);

    // Resto de la partida: genérico, siempre acertando.
    await jugarPartida(page, {
      sospechosoPorTitulo,
      alDetectarTipo: capturarSiNuevo,
      alVerFeedback: async () => {
        // Tras la primera respuesta debe verse el cambio de la escalera (sube o baja).
        const cambioNivel = page.locator('[data-test="cambio-nivel"]');
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
  // ninguna pregunta ni feedback debe hacer scroll (assertSinScroll corre en
  // cada vuelta de jugarPartida) — no depende de preguntas concretas del banco.
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
    let feedbackCapturado = false;

    for (let vueltas = 0; vueltas < 25; vueltas += 1) {
      if (await page.locator('[data-test="resumen"]').isVisible()) break;

      await assertSinScroll(page);
      const tipo = await tipoPreguntaActual(page);
      if (tipo === 'vf') await comprobarZonaAccionVf(page);
      if (!vistos.has(tipo) && nombreCaptura[tipo]) {
        vistos.add(tipo);
        await page.screenshot({ path: `${CAPTURAS_430}/${nombreCaptura[tipo]}` });
      }

      await responderPreguntaActual(page, sospechosoPorTitulo);
      await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
      await assertSinScroll(page);
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
});
