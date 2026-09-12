// e2e de ONE: inicio (🧠/💪) -> HUB (radar + niveles) -> partida -> resumen -> HUB,
// contra el banco de ejemplo, más una partida de humo contra el banco real.
// Playwright headless a 375x812.
import { test, expect } from '@playwright/test';

const CAPTURAS = 'docs/capturas';

/** Detecta el tipo de la pregunta actual por sus selectores data-test y responde.
 * Devuelve el tipo detectado ('vf' | 'test4' | 'ordenar' | 'error').
 * `sospechosoPorTitulo` (opcional, Map título -> índice) permite acertar siempre
 * las preguntas de tipo "error" sea cual sea la que toque; sin él se limita a
 * tocar la primera fila, como antes. */
async function responderPreguntaActual(page, sospechosoPorTitulo) {
  if (await page.locator('[data-test="vf-verdadero"]').count()) {
    await page.locator('[data-test="vf-verdadero"]').click();
    return 'vf';
  }
  if (await page.locator('[data-test="opcion-0"]').count()) {
    await page.locator('[data-test="opcion-0"]').click();
    return 'test4';
  }
  if (await page.locator('[data-test="item-0"]').count()) {
    // Tocar por el índice ORIGINAL (data-original), no por la posición mostrada
    // tras barajar: así siempre se acierta el orden correcto, sea cual sea la
    // pregunta (evaluar() de motor.js exige [0,1,2,3] en índices originales).
    for (let i = 0; i < 4; i++) {
      await page.locator(`[data-original="${i}"]`).click();
    }
    return 'ordenar';
  }
  if (await page.locator('[data-test="fila-0"]').count()) {
    let indice = 0;
    if (sospechosoPorTitulo) {
      const titulo = (await page.locator('.titulo-tarjeta').textContent())?.trim();
      if (sospechosoPorTitulo.has(titulo)) indice = sospechosoPorTitulo.get(titulo);
    }
    await page.locator(`[data-test="fila-${indice}"]`).click();
    return 'error';
  }
  throw new Error('No se reconoce el tipo de la pregunta actual (ningún selector conocido presente)');
}

/** Falla A PROPÓSITO la pregunta actual del banco de ejemplo, sea del tipo que
 * sea: en vf pulsa "Falso" (las vf del ejemplo son verdaderas), en test4 la
 * última opción (la correcta del ejemplo es la 0), en ordenar el orden inverso y
 * en "error" una fila que NO es la sospechosa. */
async function fallarPreguntaActual(page, sospechosoPorTitulo) {
  if (await page.locator('[data-test="vf-falso"]').count()) {
    await page.locator('[data-test="vf-falso"]').click();
    return 'vf';
  }
  if (await page.locator('[data-test="opcion-3"]').count()) {
    await page.locator('[data-test="opcion-3"]').click();
    return 'test4';
  }
  if (await page.locator('[data-test="item-0"]').count()) {
    for (let i = 3; i >= 0; i--) await page.locator(`[data-original="${i}"]`).click();
    return 'ordenar';
  }
  if (await page.locator('[data-test="fila-0"]').count()) {
    let sospechoso = 0;
    if (sospechosoPorTitulo) {
      const titulo = (await page.locator('.titulo-tarjeta').textContent())?.trim();
      if (sospechosoPorTitulo.has(titulo)) sospechoso = sospechosoPorTitulo.get(titulo);
    }
    const filas = await page.locator('[data-test^="fila-"]').count();
    await page.locator(`[data-test="fila-${(sospechoso + 1) % filas}"]`).click();
    return 'error';
  }
  throw new Error('No se reconoce el tipo de la pregunta actual para fallarla');
}

/** Tras responder: si se acierta (y no es "no lo sé"), la app puede avanzar sola
 * a la siguiente pregunta en ~1,4s; si se falla o es "no lo sé", nunca avanza
 * sola y espera a "Siguiente". Aceptamos ambos desenlaces sin depender de
 * temporizadores fijos largos: si "Siguiente" sigue visible en un margen corto
 * se pulsa; si ya no lo está (avanzó sola, o se llegó al resumen) no hay nada
 * que pulsar y seguimos. */
async function avanzarTrasRespuesta(page) {
  const siguiente = page.locator('[data-test="siguiente"]');
  try {
    await siguiente.waitFor({ state: 'visible', timeout: 300 });
  } catch {
    return; // ya no está: avanzó sola o se llegó al resumen.
  }
  try {
    await siguiente.click({ timeout: 2000 });
  } catch {
    // Avanzó sola justo antes del click: no pasa nada, seguimos.
  }
}

/** Juega hasta que aparece el resumen, avanzando tras cada respuesta con
 * avanzarTrasRespuesta(). `alDetectarTipo` (opcional) se llama la primera vez
 * que aparece cada tipo, y `alVerFeedback` la primera vez que se ve el
 * feedback. `sospechosoPorTitulo` se reenvía a responderPreguntaActual.
 * En cada vuelta comprueba que "No lo sé" (IDK) esté visible ANTES de
 * responder: debe verse en las 4 mecánicas, porque vive fuera de la tarjeta de
 * cada tipo (index.html), no dentro. */
async function jugarPartida(page, { alDetectarTipo, alVerFeedback, sospechosoPorTitulo } = {}) {
  const tiposVistos = new Set();
  let feedbackVisto = false;

  // Margen generoso: una partida real tiene 10 preguntas.
  for (let vueltas = 0; vueltas < 25; vueltas += 1) {
    if (await page.locator('[data-test="resumen"]').isVisible()) return;

    await expect(page.locator('[data-test="no-lo-se"]')).toBeVisible();

    const tipo = await responderPreguntaActual(page, sospechosoPorTitulo);
    if (!tiposVistos.has(tipo)) {
      tiposVistos.add(tipo);
      if (alDetectarTipo) await alDetectarTipo(tipo);
    }

    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    if (!feedbackVisto) {
      feedbackVisto = true;
      if (alVerFeedback) await alVerFeedback();
    }

    await avanzarTrasRespuesta(page);
  }

  throw new Error('La partida no terminó tras 25 vueltas (¿bucle sin fin?)');
}

test.describe('ONE · integración e2e', () => {
  test('inicio -> HUB -> partida -> resumen -> HUB: mecánicas, feedback, radar, racha y progreso', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    // 1. Inicio (🧠/💪) visible, racha en 0, sin botón Jugar aquí.
    await page.goto('/?ejemplo=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');
    // El botón "Comenzar" vive en el HUB, no aquí: en el inicio de los emojis
    // no debe verse (sigue existiendo en el DOM, solo que su vista está oculta).
    await expect(page.locator('[data-test="jugar"]')).toBeHidden();
    await page.screenshot({ path: `${CAPTURAS}/01-inicio.png` });

    // Mapa título -> índice sospechoso del banco de ejemplo: permite acertar siempre
    // las preguntas de tipo "error" cuando queremos acertar a propósito.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    // 2. 🧠 lleva SIEMPRE al HUB: ahí está "Comenzar" y el radar de las 8 áreas.
    // Estado recién creado: puntuación 0 en todas las áreas -> radar vacío con aviso.
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="radar"]')).toBeVisible();
    await expect(page.locator('[data-test="nota-economia"]')).toBeVisible();
    await expect(page.locator('#radar-vacio')).toBeVisible();
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

    // 5. Primera pregunta de economía (vf): "No lo sé" (IDK) visible antes de
    // responder; "¿por qué?" y "Siguiente" (dentro de #contenedor-feedback)
    // deben estar OCULTOS hasta responder (guarda de regresión: el atributo
    // hidden de #contenedor-feedback quedaba sin efecto por un display:flex
    // en .feedback que ganaba a la regla [hidden] del navegador). Fallamos A
    // PROPÓSITO (la tarjeta se sacude, se ve la explicación sola, y NO debe
    // avanzar sola: espera a "Siguiente").
    await expect(page.locator('[data-test="no-lo-se"]')).toBeVisible();
    await expect(page.locator('[data-test="porque"]')).toBeHidden();
    await expect(page.locator('[data-test="siguiente"]')).toBeHidden();
    // El orden de las 2 preguntas de economía lo decide el rng del motor: puede
    // salir primero la vf o la de tipo "error", así que fallamos sea cual sea.
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(page.locator('#explicacion-texto')).toBeVisible();
    // Confirmamos que sigue en la misma pregunta pasado un margen: el fallo
    // nunca arma el avance automático (a diferencia del acierto).
    await page.waitForTimeout(400);
    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    await page.locator('[data-test="siguiente"]').click();

    // 6. Segunda (y última) pregunta de economía (error): "No lo sé" visible de
    // nuevo (mecánica distinta). Acertamos a propósito: al ser la última del
    // área filtrada, puede avanzar sola al resumen o esperar "Siguiente".
    await expect(page.locator('[data-test="nivel-pregunta"]')).toContainText('Economía');
    await expect(page.locator('[data-test="no-lo-se"]')).toBeVisible();
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await avanzarTrasRespuesta(page);
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();

    // 7. "Inicio" (resumen) vuelve SIEMPRE al HUB, nunca a los emojis. La racha
    // ya cuenta esta partida filtrada como partida completa del día, y la nota
    // de economía deja de estar vacía ('—'): ya hay datos reales.
    await page.locator('[data-test="inicio"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="modo-area"]')).toBeHidden();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await expect(page.locator('[data-test="nota-economia"]')).not.toHaveText('—');

    // 8. "←" desde pregunta/resumen vuelve siempre al HUB (nunca a los emojis):
    // arrancamos la partida normal (sin filtro) para comprobarlo desde pregunta.
    await page.locator('[data-test="jugar"]').click();
    await expect(page.locator('[data-test="nivel-pregunta"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // 9. Partida normal (sin filtro) de verdad, desde "Comenzar": recorrer
    // capturando la primera vez de cada mecánica y del feedback.
    await page.locator('[data-test="jugar"]').click();
    await expect(page.locator('[data-test="nivel-pregunta"]')).toBeVisible();

    const nombreCaptura = { vf: '03-vf.png', test4: '04-test4.png', ordenar: '05-ordenar.png', error: '06-error.png' };
    await jugarPartida(page, {
      sospechosoPorTitulo,
      alDetectarTipo: async (tipo) => {
        await page.screenshot({ path: `${CAPTURAS}/${nombreCaptura[tipo]}` });
      },
      alVerFeedback: async () => {
        // Tras la primera respuesta debe verse el cambio de la escalera (sube o baja).
        const cambioNivel = page.locator('[data-test="cambio-nivel"]');
        await expect(cambioNivel).toBeVisible();
        await expect(cambioNivel).toContainText(/↑|↓/);
        await page.screenshot({ path: `${CAPTURAS}/07-feedback.png` });
      },
    });

    // 10. Resumen visible, racha a 1 (misma partida del día).
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await page.screenshot({ path: `${CAPTURAS}/08-resumen.png` });

    // 11. Recargar: siempre se cae en el inicio de los emojis (no hay "última
    // vista" que recordar); la racha persiste. Volver al HUB: el radar ya no
    // está vacío y al menos una barra de área tiene progreso real.
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
    await page.screenshot({ path: `${CAPTURAS}/09-hub-progreso.png` });

    // 12. Sin errores de página en toda la sesión.
    expect(erroresPagina).toEqual([]);
  });

  // Última: partida de humo contra el banco real (sin ?ejemplo=1). No debe
  // lanzar y debe llegar al resumen con lo que haya generado el pipeline.
  test('partida contra el banco real: no lanza y llega al resumen', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    await page.goto('/');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="jugar"]').click();

    await jugarPartida(page);

    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    expect(erroresPagina).toEqual([]);
  });
});
