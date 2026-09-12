// e2e de ONE: partida completa a 375x812 contra el banco de ejemplo, más una
// partida de humo contra el banco real. Playwright headless (Tarea 5 del plan).
import { test, expect } from '@playwright/test';

const CAPTURAS = 'docs/capturas';

/** Detecta el tipo de la pregunta actual por sus selectores data-test y responde.
 * Devuelve el tipo detectado ('vf' | 'test4' | 'ordenar' | 'error'). */
async function responderPreguntaActual(page) {
  if (await page.locator('[data-test="vf-verdadero"]').count()) {
    await page.locator('[data-test="vf-verdadero"]').click();
    return 'vf';
  }
  if (await page.locator('[data-test="opcion-0"]').count()) {
    await page.locator('[data-test="opcion-0"]').click();
    return 'test4';
  }
  if (await page.locator('[data-test="item-0"]').count()) {
    // Tocar las 4 tarjetas en el orden en que aparecen (no hace falta acertar
    // el orden real para completar la partida).
    await page.locator('[data-test="item-0"]').click();
    await page.locator('[data-test="item-1"]').click();
    await page.locator('[data-test="item-2"]').click();
    await page.locator('[data-test="item-3"]').click();
    return 'ordenar';
  }
  if (await page.locator('[data-test="fila-0"]').count()) {
    await page.locator('[data-test="fila-0"]').click();
    return 'error';
  }
  throw new Error('No se reconoce el tipo de la pregunta actual (ningún selector conocido presente)');
}

/** Juega hasta que aparece el resumen, avanzando con "siguiente" tras cada
 * respuesta. `alDetectarTipo` (opcional) se llama la primera vez que aparece
 * cada tipo, y `alVerFeedback` la primera vez que se ve el feedback. */
async function jugarPartida(page, { alDetectarTipo, alVerFeedback } = {}) {
  const tiposVistos = new Set();
  let feedbackVisto = false;

  // Margen generoso: una partida real tiene 10 preguntas.
  for (let vueltas = 0; vueltas < 25; vueltas += 1) {
    if (await page.locator('[data-test="resumen"]').isVisible()) return;

    const tipo = await responderPreguntaActual(page);
    if (!tiposVistos.has(tipo)) {
      tiposVistos.add(tipo);
      if (alDetectarTipo) await alDetectarTipo(tipo);
    }

    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    if (!feedbackVisto) {
      feedbackVisto = true;
      if (alVerFeedback) await alVerFeedback();
    }

    await page.locator('[data-test="siguiente"]').click();
  }

  throw new Error('La partida no terminó tras 25 vueltas (¿bucle sin fin?)');
}

test.describe('ONE · integración e2e', () => {
  test('partida completa con el banco de ejemplo: mecánicas, resumen, racha y progreso', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    // 1. Inicio visible, racha en 0.
    await page.goto('/?ejemplo=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');
    await page.screenshot({ path: `${CAPTURAS}/01-inicio.png` });

    // 2. Jugar: recorrer la partida capturando la primera vez de cada mecánica
    // y del feedback.
    await page.locator('[data-test="jugar"]').click();

    const nombreCaptura = { vf: '02-vf.png', test4: '03-test4.png', ordenar: '04-ordenar.png', error: '05-error.png' };
    await jugarPartida(page, {
      alDetectarTipo: async (tipo) => {
        await page.screenshot({ path: `${CAPTURAS}/${nombreCaptura[tipo]}` });
      },
      alVerFeedback: async () => {
        await page.screenshot({ path: `${CAPTURAS}/06-feedback.png` });
      },
    });

    // 3. Resumen visible, racha a 1.
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await page.screenshot({ path: `${CAPTURAS}/07-resumen.png` });

    // 4. Recargar: la racha persiste; ir a progreso y comprobar una barra > 0.
    await page.reload();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');

    await page.locator('[data-test="progreso"]').click();
    const barras = page.locator('[data-test^="barra-"]');
    await expect(barras.first()).toBeVisible();
    const anchos = await barras.evaluateAll((nodos) => nodos.map((n) => parseFloat(n.style.width) || 0));
    expect(anchos.some((ancho) => ancho > 0)).toBe(true);
    await page.screenshot({ path: `${CAPTURAS}/08-progreso.png` });

    // 5. Sin errores de página en toda la sesión.
    expect(erroresPagina).toEqual([]);
  });

  // Última: partida de humo contra el banco real (sin ?ejemplo=1). No debe
  // lanzar y debe llegar al resumen con lo que haya generado el pipeline.
  test('partida contra el banco real: no lanza y llega al resumen', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    await page.goto('/');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="jugar"]').click();

    await jugarPartida(page);

    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    expect(erroresPagina).toEqual([]);
  });
});
