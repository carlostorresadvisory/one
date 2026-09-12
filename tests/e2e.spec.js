// e2e de ONE: partida completa a 375x812 contra el banco de ejemplo, más una
// partida de humo contra el banco real. Playwright headless (Tarea 5 del plan).
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

/** Juega hasta que aparece el resumen, avanzando con "siguiente" tras cada
 * respuesta. `alDetectarTipo` (opcional) se llama la primera vez que aparece
 * cada tipo, y `alVerFeedback` la primera vez que se ve el feedback.
 * `sospechosoPorTitulo` se reenvía a responderPreguntaActual. */
async function jugarPartida(page, { alDetectarTipo, alVerFeedback, sospechosoPorTitulo } = {}) {
  const tiposVistos = new Set();
  let feedbackVisto = false;

  // Margen generoso: una partida real tiene 10 preguntas.
  for (let vueltas = 0; vueltas < 25; vueltas += 1) {
    if (await page.locator('[data-test="resumen"]').isVisible()) return;

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

    // Mapa título -> índice sospechoso del banco de ejemplo: permite acertar siempre
    // las preguntas de tipo "error" (junto con el acierto garantizado de vf/test4/
    // ordenar) para que la comprobación de "sube en la 1ª respuesta" no dependa del
    // azar de qué pregunta le toca primero al jugador.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    // 2. Navegación: desde la primera pregunta, "←" vuelve a inicio abandonando la
    // partida (nada se ha respondido, así que la racha no se mueve). Cubre el
    // callejón sin salida que había hoy entre pregunta e inicio.
    await page.locator('[data-test="jugar"]').click();
    await expect(page.locator('[data-test="nivel-pregunta"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');

    // 3. Practicar solo un área desde Progreso: "practicar-economia" arranca una
    // partida filtrada (el banco de ejemplo tiene 2 preguntas de economía). La
    // cabecera debe anunciar "Solo Economía" y la tarjeta debe ser de esa área.
    await page.locator('[data-test="progreso"]').click();
    const practicarEconomia = page.locator('[data-test="practicar-economia"]');
    await expect(practicarEconomia).toBeVisible();
    await practicarEconomia.click();

    await expect(page.locator('[data-test="modo-area"]')).toBeVisible();
    await expect(page.locator('[data-test="modo-area"]')).toHaveText('Solo Economía');
    await expect(page.locator('[data-test="nivel-pregunta"]')).toContainText('Economía');

    // "No lo sé": despliega la explicación sola y ofrece "Siguiente", sin marcar
    // ni ✓ ni ✗ (es un fallo a efectos de motor, pero neutro a efectos visuales).
    await page.locator('[data-test="no-lo-se"]').click();
    await expect(page.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(page.locator('#explicacion-texto')).toBeVisible();
    await page.locator('[data-test="siguiente"]').click();

    // La segunda (y última) pregunta de economía del banco de ejemplo: se responde
    // normal y, al agotarse el área, la partida filtrada termina sola en el resumen.
    await expect(page.locator('[data-test="nivel-pregunta"]')).toContainText('Economía');
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await page.locator('[data-test="siguiente"]').click();
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();

    // "Inicio" limpia el filtro: de vuelta a inicio, "Solo Economia" desaparece.
    await page.locator('[data-test="inicio"]').click();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="modo-area"]')).toBeHidden();
    // La racha ya cuenta esta partida filtrada como partida completa del día (aunque
    // corta): pasa a 1 aquí, y la partida sin filtrar de más abajo no la duplica
    // (actualizarRacha no cambia si ya se jugó hoy).
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');

    // 4. Partida normal (sin filtro): recorrer capturando la primera vez de cada
    // mecánica y del feedback, como antes.
    await page.locator('[data-test="jugar"]').click();

    // La escalera inmediata: el nivel de la pregunta se ve desde la primera tarjeta.
    await expect(page.locator('[data-test="nivel-pregunta"]')).toBeVisible();

    const nombreCaptura = { vf: '02-vf.png', test4: '03-test4.png', ordenar: '04-ordenar.png', error: '05-error.png' };
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
        await page.screenshot({ path: `${CAPTURAS}/06-feedback.png` });
      },
    });

    // 5. Resumen visible, racha a 1.
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await page.screenshot({ path: `${CAPTURAS}/07-resumen.png` });

    // 6. Recargar: la racha persiste; ir a progreso y comprobar una barra > 0.
    await page.reload();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');

    await page.locator('[data-test="progreso"]').click();
    const barras = page.locator('[data-test^="barra-"]');
    await expect(barras.first()).toBeVisible();
    const anchos = await barras.evaluateAll((nodos) => nodos.map((n) => parseFloat(n.style.width) || 0));
    expect(anchos.some((ancho) => ancho > 0)).toBe(true);
    await page.screenshot({ path: `${CAPTURAS}/08-progreso.png` });

    // 7. Sin errores de página en toda la sesión.
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
