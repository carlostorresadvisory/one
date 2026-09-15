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

/** Ronda de corrección 1 del indicador de tanda (hallazgo Important, verificado en vivo por el
 * revisor a 375×812 en la vista `pregunta`): con un `right` fijo, el indicador solapaba
 * `.cabecera-estado` (racha 🔥 y "Nivel N") porque ese bloque cambia de ancho según su texto. Se
 * midió que ni siquiera cabía sin solapar en la MISMA fila que la cabecera (llegaba a tocar el
 * logo) a 375px con el botón "←" también visible, así que el indicador pasó a una segunda fila bajo
 * la cabecera entera (Plan B) -- el riesgo ahí ya no es la cabecera sino el contenido de la vista,
 * que no deja hueco propio arriba (la tarjeta del mazo "ES la vista", spec v0.1c §1). Esta
 * comprobación es geometría real (getBoundingClientRect), no una asunción de que "cabía": mira
 * CUALQUIER hijo directo de `.cabecera` (el botón "←", el logo "🧠 ONE" y `.cabecera-estado`) y,
 * cuando hay una tarjeta de mazo visible (vistas `pregunta`/`repaso`), también esa tarjeta. No-op si
 * el indicador está oculto (nada que solapar). Llamar tras `esperarAsentamientoMazo` si hay tarjeta
 * en pantalla: a mitad de la transición de entrada su geometría real todavía no es la definitiva. */
async function assertSinSolapeCabecera(page) {
  const solapes = await page.evaluate(() => {
    const indicador = document.querySelector('[data-test="indicador-tanda"]');
    if (!indicador || indicador.hidden) return [];
    const cajaIndicador = indicador.getBoundingClientRect();
    const seSolapan = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const candidatos = [...document.querySelectorAll('.cabecera > *'), document.querySelector('.tarjeta-mazo--actual')].filter(
      Boolean
    );
    return candidatos
      .filter((hijo) => !hijo.hidden)
      .map((hijo) => ({
        testId: hijo.dataset.test || hijo.className || hijo.tagName,
        caja: hijo.getBoundingClientRect(),
      }))
      .filter(({ caja }) => caja.width > 0 && caja.height > 0 && seSolapan(cajaIndicador, caja));
  });
  expect(solapes, `el indicador de tanda solapa con: ${JSON.stringify(solapes)}`).toEqual([]);
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
    // Hallazgo C1 (revisión final v0.1e): `.tarjeta-contenido.scrollHeight` NO ve un desborde
    // que ocurre DENTRO de un hijo suyo (p. ej. `.zona-imagen`) cuando ese hijo tiene overflow
    // visible y flex-shrink:0 en su propio descendiente (el SVG del visual) -- en flexbox, el
    // desborde de un flex item no siempre propaga al scrollHeight del contenedor flex, así que
    // `ajustarEncaje.cabe()` (que solo mira `.tarjeta-contenido`) puede dar por bueno un encaje
    // que en pantalla se ve roto. Dos comprobaciones nuevas que SÍ lo ven:
    //  1) el mismo contrato scrollHeight<=clientHeight pero aplicado a CADA HIJO DIRECTO de
    //     `.tarjeta-contenido` (no solo al propio `.tarjeta-contenido`), para pillar un desborde
    //     interno de cualquier hijo aunque no llegue a sumar al de su padre.
    //  2) geometría real: ningún hijo de `.zona-imagen` (el SVG del visual, su leyenda, o la
    //     imagen+pie) puede sobresalir del rectángulo de `.zona-imagen` -- ni por arriba ni por
    //     abajo -- más de 1px, medido con getBoundingClientRect (no depende de scrollHeight en
    //     absoluto, así que ve el desborde aunque el flujo normal de scrollHeight no lo cuente).
    // OJO: esto NO debe pillar el recorte intencional por line-clamp (`.enunciado`/
    // `.explicacion` en tarjeta--enunciado-clamp/--explicacion-clamp, ver ajustarEncaje/
    // calcularLineasClamp en app.js): esos elementos usan `display:-webkit-box;
    // overflow:hidden` a propósito, y en Chromium su `scrollHeight` SIGUE devolviendo el
    // alto del texto COMPLETO sin recortar (es justo lo que calcularLineasClamp explota
    // para calcular cuántas líneas caben) aunque el recorte visual funcione perfectamente
    // (el texto de más nunca se pinta, con "…" al final). Eso es una verdad ya conocida y
    // aceptada del propio diseño, no el bug de C1: C1 es un desborde que SÍ se pinta fuera
    // de su caja porque el padre tiene `overflow:visible` (el default). Por eso el
    // contrato scrollHeight<=clientHeight por hijo solo se exige cuando el propio hijo
    // tiene `overflow` visible en su eje vertical -- con overflow:hidden/clip/scroll/auto
    // el navegador ya garantiza que nada se pinta fuera de la caja, así que un
    // scrollHeight mayor ahí es ruido esperado, no una señal de un desborde real.
    const hijosContenido = contenido
      ? Array.from(contenido.children)
          .filter((hijo) => getComputedStyle(hijo).overflowY === 'visible')
          .map((hijo) => ({
            clase: hijo.getAttribute('class') || hijo.tagName,
            alto: hijo.scrollHeight,
            visible: hijo.clientHeight,
          }))
      : [];
    const desbordesZonaImagen = [];
    if (contenido) {
      contenido.querySelectorAll('.zona-imagen').forEach((zona) => {
        const rectZona = zona.getBoundingClientRect();
        Array.from(zona.children).forEach((hijo) => {
          const rectHijo = hijo.getBoundingClientRect();
          desbordesZonaImagen.push({
            clase: hijo.getAttribute('class') || hijo.tagName,
            sobresaleArriba: rectZona.top - rectHijo.top,
            sobresaleAbajo: rectHijo.bottom - rectZona.bottom,
          });
        });
      });
    }
    return {
      alto: tarjeta.scrollHeight,
      visible: tarjeta.clientHeight,
      contenidoAlto: contenido ? contenido.scrollHeight : null,
      contenidoVisible: contenido ? contenido.clientHeight : null,
      hijosContenido,
      desbordesZonaImagen,
    };
  });
  expect(medidas).not.toBeNull();
  expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
  if (medidas.contenidoAlto !== null) {
    expect(medidas.contenidoAlto).toBeLessThanOrEqual(medidas.contenidoVisible + 2);
  }
  for (const hijo of medidas.hijosContenido) {
    expect(
      hijo.alto,
      `.${hijo.clase} desborda su propia caja dentro de .tarjeta-contenido (scrollHeight ${hijo.alto} > clientHeight ${hijo.visible})`
    ).toBeLessThanOrEqual(hijo.visible + 2);
  }
  for (const d of medidas.desbordesZonaImagen) {
    expect(d.sobresaleArriba, `.${d.clase} sobresale por ARRIBA de su .zona-imagen (${d.sobresaleArriba.toFixed(1)}px)`).toBeLessThanOrEqual(1);
    expect(d.sobresaleAbajo, `.${d.clase} sobresale por ABAJO de su .zona-imagen (${d.sobresaleAbajo.toFixed(1)}px)`).toBeLessThanOrEqual(1);
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

  // Hallazgo M2 (revisión final v0.1e): antes, si la imagen de Commons fallaba al
  // cargar, el hueco se quedaba vacío del todo aunque la pregunta SÍ tuviera un
  // visual generado (spec v0.1e §2) -- la prioridad fija imagen->visual de
  // construirTarjetaRespondida se decide en el momento de construir la tarjeta,
  // cuando la imagen "existe" a efectos de datos aunque su carga real falle
  // después de forma asíncrona. Ahora el `error` del <img> intenta
  // construirBloqueVisual como respaldo antes de rendirse. Mismo patrón que el
  // test de arriba (URL 404 real vía tools/servir.js), pero con una pregunta
  // sintética que SÍ trae `visual`.
  test('M2 (revisión final v0.1e): si la imagen de Commons falla al cargar, el visual de respaldo aparece en su lugar', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const idSintetico = 'sintetico-m2-imagen-rota-con-visual';
    const visualesEjemplo = await page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json()));
    const preguntaSintetica = { ...visualesEjemplo.dato, id: idSintetico };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSintetica);
    await page.evaluate(
      (id) =>
        window.__one.forzarImagen(id, {
          id,
          url: 'datos/no-existe-m2.png',
          pagina: 'https://commons.wikimedia.org/wiki/File:Ejemplo.png',
          titulo: 'Ejemplo',
          autor: 'Autor de ejemplo',
          licencia: 'CC0',
          leyenda: 'Imagen rota a propósito (M2)',
          termino: 'ejemplo',
          ancho: 1,
          alto: 1,
        }),
      idSintetico
    );
    await page.evaluate(
      (id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'm2-imagen-rota-visual' }),
      idSintetico
    );

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    // El onerror del <img> es asíncrono (espera a la respuesta 404 real): las
    // aserciones de Playwright reintentan hasta que el respaldo se pinta.
    await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
    await expect(t.locator('[data-test="visual"]')).toBeVisible();
    await expect(t.locator('[data-test="visual-pie"]')).toHaveText(preguntaSintetica.visual.leyenda);
    // El respaldo cuenta como "hay imagen" a efectos de alineación arriba
    // (spec v0.1d §3): la marca no debe perderse solo porque la imagen
    // concreta haya fallado si hay un visual que la sustituya.
    await expect(t.locator('.tarjeta-contenido')).toHaveClass(/tarjeta-contenido--imagen/);
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
    // Hallazgo I1 (revisión final v0.1e): la pista textual ("Desliza ↑ para la
    // siguiente...") y el chevrón se solapaban 16px cuando las dos estaban
    // visibles a la vez (las 5 primeras tarjetas de la vida de la app). El
    // arreglo apaga el chevrón mientras la pista textual esté activa (sobra:
    // la pista ya explica el gesto). Este test quiere aislar el chevrón en sí
    // (independiente de la pista), así que se simula el presupuesto de la
    // pista YA agotado (`one.pistaMazo` en localStorage, ver
    // contarPistaMazoMostrada/LIMITE_PISTA_MAZO=5 en app.js) ANTES de entrar
    // en la partida -- si no, en un contexto de test recién creado (localStorage
    // vacío) la pista se mostraría en su lugar y el chevrón, correctamente,
    // no se vería.
    await page.evaluate(() => localStorage.setItem('one.pistaMazo', '5'));
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="comenzar"]').click();

    const indicador = page.locator('[data-test="mazo-gesto"]');
    await expect(page.locator('[data-test="pista-mazo"]')).toBeHidden();
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
      // assertTarjetaSinScroll ya se ha llamado arriba (con su comprobación
      // geométrica reforzada, hallazgo C1): en este punto el SVG está
      // GARANTIZADO contenido en su `.zona-imagen` (no desbordado), así que
      // `caja.height` mide el dibujo ya encajado -- antes del arreglo C1
      // (`.visual-svg` con `flex:0 0 auto; max-height:100%`), esta misma
      // lectura podía devolver un alto mayor de 88 sin que eso dijera nada
      // sobre si el SVG cabía de verdad (podía desbordar y aun así medir
      // "suficiente"). Mínimo de la cascada de encaje (spec v0.1d §4): 90px,
      // con el mismo margen de 2px que ya usa assertTarjetaSinScroll para
      // redondeos.
      const caja = await visual.boundingBox();
      expect(caja.height).toBeGreaterThanOrEqual(88);

      const leyenda = t.locator('[data-test="visual-pie"]');
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

// ============================================================================
// C1 (revisión final v0.1e, Critical): el SVG del visual desbordaba su caja y
// tapaba la respuesta correcta -- `.visual-svg` con `flex:0 0 auto;
// max-height:100%` mide ese 100% contra `.zona-imagen--visual` ignorando el
// `gap` y `.visual-pie` (leyenda) que van debajo en la misma caja, y como
// `.tarjeta-contenido` está en overflow:visible (nunca hidden/scroll), el
// desborde no aumenta su scrollHeight -- `ajustarEncaje.cabe()` no lo ve. El
// revisor lo midió en vivo a 393×852 CON las zonas seguras reales de un
// iPhone (notch/Dynamic Island arriba, home indicator abajo): 72 de 96
// tarjetas con visual desbordaban, peores casos cie-085/fil-041/fil-055
// (10px) y eco-065 (8px) -- las 4 preguntas de este bloque, tomadas del banco
// REAL (no sintéticas), respondidas MAL a propósito (fallarPreguntaActual):
// la respuesta incorrecta es justo lo que el SVG desbordado tapaba.
// env(safe-area-inset-*) vale 0 en Chromium headless (no hay notch que
// simular de por sí), así que se inyecta el mismo padding que aplicaría iOS.
// ============================================================================
test.describe('ONE · C1 visual desbordado con zonas seguras del iPhone', () => {
  const CASOS_PEORES_C1 = ['cie-085', 'fil-041', 'fil-055', 'eco-065'];

  for (const id of CASOS_PEORES_C1) {
    test(`C1 ${id}: a 393×852 con zonas seguras del iPhone, la tarjeta respondida (mal) no desborda su visual`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
      await page.locator('[data-test="cerebro"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      // Zonas seguras reales de un iPhone con notch/Dynamic Island (59px
      // arriba) y home indicator (34px abajo) -- las mismas que midió el
      // revisor en vivo para encontrar el desborde de hasta 10px.
      await page.addStyleTag({
        content: '.cabecera { padding-top: 59px !important; } body { padding-bottom: 34px !important; }',
      });

      await page.evaluate((ids) => window.__one.empezarPartida({ ids, etiqueta: 'c1-zonas-seguras' }), [id]);

      const t = tarjetaActual(page);
      await fallarPreguntaActual(page);
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);

      await assertSinScroll(page);
      // Aserción reforzada C1 (ver assertTarjetaSinScroll): ve el desborde
      // geométrico real del SVG aunque scrollHeight no lo cuente.
      await assertTarjetaSinScroll(page);

      // El visual sigue existiendo y visible (nunca se quita, spec v0.1d §4):
      // lo que se arregla es que quepa, no que desaparezca.
      await expect(t.locator('[data-test="visual"]')).toBeVisible();
    });
  }
});

// ============================================================================
// Añadido A/B (v0.1e, 13-sep tarde): feedback de Carlos desde el iPhone sobre
// una captura real — "No podemos tener preguntas que no caben": un enunciado
// largo se recortaba a 5 líneas fijas aunque sobrara media tarjeta vacía. La
// tarjeta SIN responder pasa a tener su propia cascada en ajustarEncaje
// (enunciado-menor -> opciones-compactas -> line-clamp calculado, sin ningún
// toque). Describe aparte, mismo patrón de inyectarPregunta que "cascada de
// encaje paso a paso" de más arriba (id sintético, no depende del banco).
// ============================================================================
test.describe('ONE · Añadido A/B v0.1e', () => {
  test('Añadido A: un enunciado de ~6 líneas sin responder se ve ENTERO (ya no hay recorte fijo a 5 líneas)', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const idSintetico = 'sintetico-enunciado-6-lineas';
    const preguntaSintetica = {
      id: idSintetico,
      area: 'historia',
      tipo: 'vf',
      nivel: 1,
      enunciado:
        'Enunciado sintético pensado para ocupar unas seis líneas a 375px de ancho, de forma que quepa entero en la tarjeta sin responder ahora que ya no hay un recorte fijo de cinco líneas esperando un toque que en esta tarjeta ya no existe.',
      explicacion: 'Explicación cualquiera: no es lo que se prueba en este test.',
      confianza: 1,
      generador: 'manual',
      verificador: 'manual',
      verificado: true,
      respuesta: true,
    };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSintetica);
    await page.evaluate(
      (id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'enunciado-6-lineas' }),
      idSintetico
    );

    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-respondida', 'false');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const estado = await t.evaluate((tarjeta) => {
      const enunciado = tarjeta.querySelector('.enunciado');
      return {
        lineClamp: getComputedStyle(enunciado).getPropertyValue('-webkit-line-clamp'),
        scrollHeight: enunciado.scrollHeight,
        clientHeight: enunciado.clientHeight,
      };
    });
    // Sin recorte efectivo: con sitio de sobra, se ve el enunciado ENTERO.
    expect(estado.lineClamp).toBe('none');
    expect(estado.scrollHeight).toBeLessThanOrEqual(estado.clientHeight + 2);
  });

  test('Añadido A: un enunciado absurdo de ~40 líneas sin responder no hace scroll y acaba en el recorte calculado', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const idSintetico = 'sintetico-enunciado-40-lineas';
    const preguntaSintetica = {
      id: idSintetico,
      area: 'historia',
      tipo: 'vf',
      nivel: 1,
      enunciado:
        'Enunciado sintético deliberadamente absurdo, mucho más largo de lo que cabría nunca en una tarjeta sin responder, pensado para forzar el último recurso de la cascada de encaje: ni bajar el tamaño de letra del enunciado ni compactar las opciones basta, así que tiene que acabar recortado con puntos suspensivos, sin scroll en ningún punto de la tarjeta. '.repeat(
          6
        ),
      explicacion: 'Explicación cualquiera: no es lo que se prueba en este test.',
      confianza: 1,
      generador: 'manual',
      verificador: 'manual',
      verificado: true,
      respuesta: true,
    };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSintetica);
    await page.evaluate(
      (id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'enunciado-40-lineas' }),
      idSintetico
    );

    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-respondida', 'false');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const estado = await t.evaluate((tarjeta) => {
      const enunciado = tarjeta.querySelector('.enunciado');
      return {
        clases: [...tarjeta.classList],
        lineClamp: getComputedStyle(enunciado).getPropertyValue('-webkit-line-clamp'),
      };
    });
    // Último recurso de la cascada: recorte calculado y activo (nunca "none"
    // con un enunciado que a todas luces no cabe entero). El propio
    // -webkit-line-clamp es quien pinta el "…" al mostrar (no se toca el DOM:
    // el texto completo sigue en el enunciado, ver ajustarEncaje) — se
    // comprueba aquí que el recorte esté realmente activo con un número de
    // líneas concreto, que es justo lo que produce esa elipsis visual.
    expect(estado.clases).toContain('tarjeta--enunciado-clamp');
    expect(estado.lineClamp).not.toBe('none');
    expect(Number(estado.lineClamp)).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Repaso del HUB (spec v0.2 §2, Tarea 3 de v0.2a-repaso): feed "sin fin" de
// TODO lo jugado (ordenarRepaso en motor.js), distinto del repaso de UNA
// partida (resumen, ya cubierto arriba). Tres preguntas sintéticas de áreas
// distintas (ciencia sin nada, historia con imagen forzada, economía con
// visual — reutilizando datos/visuales.ejemplo.json como en "ONE · visuales
// v0.1e"), respondidas mal / bien con Baja / bien con Alta para forzar los
// tres estados del feed (fallada, frágil, acertada) en ese orden.
// ============================================================================
test.describe('ONE · repaso v0.2a', () => {
  const ID_FALLADA = 'sintetico-repaso-fallada';
  const ID_FRAGIL = 'sintetico-repaso-fragil';
  const ID_ACERTADA = 'sintetico-repaso-acertada';

  /** Inyecta las 3 preguntas sintéticas, juega la partida cerrada a esos ids
   * (falla la 1ª, acierta la 2ª con Baja, acierta la 3ª con Alta) y vuelve al
   * HUB con "←" desde el resumen (manejarVolver ya lleva siempre al HUB fuera
   * de la vista progreso, sin tener que recorrer el mazo de resumen). */
  async function prepararYJugar(page) {
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const [visualesEjemplo, imagenesEjemplo] = await Promise.all([
      page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json())),
      page.evaluate(() => fetch('datos/imagenes.ejemplo.json').then((r) => r.json())),
    ]);

    const preguntaFallada = {
      id: ID_FALLADA,
      area: 'ciencia',
      tipo: 'vf',
      nivel: 1,
      enunciado: 'El agua hierve a 100 grados Celsius al nivel del mar.',
      explicacion: 'A presión atmosférica estándar (nivel del mar), el punto de ebullición del agua es 100°C.',
      confianza: 1,
      generador: 'manual',
      verificador: 'manual',
      verificado: true,
      respuesta: true,
    };
    const preguntaFragil = {
      id: ID_FRAGIL,
      area: 'historia',
      tipo: 'vf',
      nivel: 1,
      enunciado: 'La Segunda Guerra Mundial terminó en 1945.',
      explicacion: 'La rendición de Japón en septiembre de 1945 puso fin a la Segunda Guerra Mundial.',
      confianza: 1,
      generador: 'manual',
      verificador: 'manual',
      verificado: true,
      respuesta: true,
    };
    // "formula" (visuales.ejemplo.json) es área economía, vf, respuesta true:
    // mismo patrón que "ONE · visuales v0.1e" (id sintético, no depende de qué
    // traiga el banco real en cada momento).
    const preguntaAcertada = { ...visualesEjemplo.formula, id: ID_ACERTADA };
    const imagenFragil = { ...imagenesEjemplo['his-001'], id: ID_FRAGIL };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaFallada);
    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaFragil);
    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaAcertada);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenFragil);

    // { ids } sirve el primer id elegible EN ESE ORDEN (motor.js/siguientePregunta):
    // así se controla exactamente qué tarjeta responde cada confianza.
    await page.evaluate(
      (ids) => window.__one.empezarPartida({ ids, etiqueta: 'repaso-v0.2a' }),
      [ID_FALLADA, ID_FRAGIL, ID_ACERTADA]
    );

    // 1) Falla a propósito (confianza Media, por defecto): la respuesta
    // correcta es Verdadero, así que tocar "Falso" falla.
    let t = tarjetaActual(page);
    await t.locator('[data-test="vf-falso"]').click();
    await avanzarTrasRespuesta(page);

    // 2) Acierta con confianza Baja -> frágil (cuenta, pero no consolida).
    t = tarjetaActual(page);
    await t.locator('[data-test="confianza-baja"]').click();
    await t.locator('[data-test="vf-verdadero"]').click();
    await avanzarTrasRespuesta(page);

    // 3) Acierta con confianza Alta -> consolida, sin quedar frágil ni pendiente.
    t = tarjetaActual(page);
    await t.locator('[data-test="confianza-alta"]').click();
    await t.locator('[data-test="vf-verdadero"]').click();
    await avanzarTrasRespuesta(page); // última pregunta: termina la partida -> resumen.

    await expect(page.locator('[data-vista="resumen"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click(); // "←": fuera de progreso, siempre al HUB.
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
  }

  // Revisión final de rama (Critical, C1): abrirRepaso() montaba el mazo
  // (renderRepaso) ANTES de mostrarVista('repaso') -- con la vista todavía
  // hidden (display:none), ajustarEncaje mide clientHeight/scrollHeight sobre
  // cajas de alto 0, `cabe()` da true SIEMPRE y la cascada de encaje nunca se
  // aplica: con banco real a 393×852 con zonas seguras, 6 de 30 tarjetas
  // desbordaban al abrir (his-046 30px, art-090 23px...), la explicación
  // montada sobre "Preguntar a". Mismo defecto latente en finalizarPartida
  // (montarMazo antes de mostrarVista('resumen')): la tarjeta de índice 1 del
  // resumen desbordaba 282px hasta un resize. Este test falla sin invertir
  // ese orden en ambos sitios (ver abrirRepaso/finalizarPartida en app.js).
  test('C1 (Critical, revisión final): resumen (tarjeta 1) y repaso (primera tarjeta) no desbordan al abrir, sin resize, con enunciado+explicación largos e imagen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/?test=1');
    // Zonas seguras simuladas de un iPhone (mismo patrón que "ONE · C1 visual
    // desbordado con zonas seguras del iPhone"): env(safe-area-inset-*) vale
    // 0 en Chromium headless.
    await page.addStyleTag({
      content: '.cabecera { padding-top: 59px !important; } body { padding-bottom: 34px !important; }',
    });
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const idLargo = 'sintetico-c1-desborde';
    const preguntaLarga = {
      id: idLargo,
      area: 'historia',
      tipo: 'vf',
      nivel: 1,
      enunciado:
        'Durante la Revolución Francesa, la Asamblea Nacional Constituyente aprobó la Declaración de los Derechos del Hombre y del Ciudadano en agosto de 1789, sentando las bases jurídicas y filosóficas de buena parte del constitucionalismo liberal europeo posterior.',
      explicacion:
        'La Declaración de 1789 proclamó la libertad, la igualdad ante la ley y la soberanía nacional como principios fundamentales, inspirándose en el pensamiento ilustrado de Rousseau, Montesquieu y Locke. Su influencia llegó mucho más allá de Francia: sirvió de modelo directo para constituciones posteriores en toda Europa y América Latina durante el siglo XIX, y sigue citándose hoy como uno de los textos fundacionales del constitucionalismo moderno y de los derechos humanos contemporáneos.',
      confianza: 1,
      generador: 'manual',
      verificador: 'manual',
      verificado: true,
      respuesta: true,
    };
    const imagenLarga = {
      id: idLargo,
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      pagina: 'https://commons.wikimedia.org/wiki/File:Ejemplo-c1.png',
      titulo: 'Ejemplo-c1.png',
      autor: 'Autor de ejemplo',
      licencia: 'CC BY-SA 4.0',
      leyenda: 'Imagen forzada para el caso C1 (enunciado + explicación largos)',
      termino: 'ejemplo',
      ancho: 1,
      alto: 1,
    };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaLarga);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenLarga);
    await page.evaluate((id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'c1-desborde' }), idLargo);

    // Falla A PROPÓSITO (la respuesta correcta es Verdadero): repasoPartida
    // tendrá exactamente este ítem, y el feed del HUB (ordenarRepaso) también
    // lo devolverá como única tarjeta ("fallada", pendiente).
    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-falso"]').click();
    await avanzarTrasRespuesta(page); // única pregunta -> termina la partida -> resumen.
    await expect(page.locator('[data-vista="resumen"]')).toBeVisible();

    /** Sin resize ni más interacción que la mínima para hacer "actual" la
     * tarjeta a comprobar: la explicación no debe solapar la fila
     * "Preguntar a" (C1). */
    async function comprobarSinSolape() {
      await assertTarjetaSinScroll(page);
      const actual = tarjetaActual(page);
      const explicacion = actual.locator('[data-test="explicacion"]');
      const preguntarA = actual.locator('[data-test="preguntar-a"]');
      await expect(explicacion).toBeVisible();
      await expect(preguntarA).toBeVisible();
      const cajaExplicacion = await explicacion.boundingBox();
      const cajaPreguntarA = await preguntarA.boundingBox();
      const explicacionAbajo = cajaExplicacion.y + cajaExplicacion.height;
      expect(
        explicacionAbajo,
        `La explicación (bottom ${explicacionAbajo.toFixed(1)}) solapa "Preguntar a" (top ${cajaPreguntarA.y.toFixed(1)})`
      ).toBeLessThanOrEqual(cajaPreguntarA.y + 1);
    }

    // 1) Resumen, tarjeta de índice 1 (repasoPartida[0], la fallada): un solo
    // deslizamiento desde la tarjeta 0 (cifras), sin resize.
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await comprobarSinSolape();

    // 2) HUB → Repaso: la MISMA pregunta, ahora desde ordenarRepaso, como
    // primera (única) tarjeta -- sin deslizar ni redimensionar nada más.
    await page.locator('[data-test="volver"]').click(); // "←" desde el resumen: siempre al HUB.
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="repaso-hub"]').click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await comprobarSinSolape();
  });

  test('HUB → Repaso infinito (v0.2a.1 §7): respondidas primero, luego sin responder, filtro por área en ambos tramos, sin tarjeta de cierre', async ({
    page,
  }) => {
    // `?ejemplo=1` (banco de 12 preguntas, contenido conocido) en vez del real
    // de `/?test=1`: el tramo 2 (sin responder) ahora es TODO lo que no se ha
    // jugado, así que con el banco real (295 preguntas) sería enorme e
    // impredecible por área para las comprobaciones exactas de este test. El
    // orden exacto de `listarNoRespondidas` (nivel asc., rotación, por id) ya
    // está probado a fondo en motor.test.js; aquí solo se comprueba que la
    // UI lo conecta bien: aparece, se distingue visualmente, respeta el
    // filtro y el mazo sigue "sin fin".
    await page.goto('/?ejemplo=1&test=1');
    await prepararYJugar(page);

    // Una pregunta más, SIN responder, con un `visual` propio (v0.2a.1 §7
    // pide comprobar assertTarjetaSinScroll también en una no respondida con
    // visual, además de una con imagen -- el banco de ejemplo no trae
    // ninguna con `visual` de fábrica). Área ciencia y nivel 3 a propósito:
    // por encima de cie-001 (nivel 1) y cie-002 (nivel 2), así queda última
    // del tramo 2 filtrado a ciencia sin ambigüedad de rotación (nivel
    // ascendente es el criterio primario).
    const visualesEjemplo = await page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json()));
    const preguntaSinResponderVisual = {
      ...visualesEjemplo.dato,
      id: 'sintetico-repaso-sinresponder-visual',
      area: 'ciencia',
      nivel: 3,
    };
    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSinResponderVisual);

    const botonRepasoHub = page.locator('[data-test="repaso-hub"]');
    await expect(botonRepasoHub).toHaveAttribute('aria-disabled', 'false');
    await expect(botonRepasoHub).toHaveText('Repaso');

    await botonRepasoHub.click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await expect(page.locator('[data-test="repaso-vista"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    // I2 (revisión final, accesibilidad): la fila es un grupo con etiqueta, y
    // el chip activo ("Todas" por defecto) lo anuncia con aria-pressed.
    const filtroRepaso = page.locator('[data-test="repaso-filtro"]');
    await expect(filtroRepaso).toHaveAttribute('role', 'group');
    await expect(filtroRepaso).toHaveAttribute('aria-label', 'Filtrar por área');
    const chipTodas = filtroRepaso.locator('[data-area="todas"]');
    await expect(chipTodas).toHaveAttribute('aria-pressed', 'true');

    // Tramo 1, sin filtrar: fallada, frágil, acertada -- mismo orden que
    // siempre (ordenarRepaso no cambia).
    let actual = tarjetaActual(page);
    await expect(actual).toHaveAttribute('data-test', 'repaso-tarjeta');
    await expect(actual.locator('[data-test="nivel-pregunta"]')).toContainText('Ciencia');
    await expect(actual.locator('.repaso-marca')).toHaveText('✗ fallada · hoy');

    // Minor 7 (ronda final de revisión): captura regenerada con el estado
    // actual del repaso (respondidas primero).
    await page.screenshot({ path: `${CAPTURAS}/v0.2a-repaso-375.png` });

    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    actual = tarjetaActual(page);
    await expect(actual.locator('[data-test="nivel-pregunta"]')).toContainText('Historia');
    await expect(actual.locator('.repaso-marca')).toHaveText('✓ frágil · hoy');
    await expect(actual.locator('[data-test="imagen"]')).toBeVisible(); // imagen forzada, spec §2

    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    actual = tarjetaActual(page);
    await expect(actual.locator('[data-test="nivel-pregunta"]')).toContainText('Economía');
    await expect(actual.locator('.repaso-marca')).toHaveText('✓ acertada · hoy');
    await expect(actual.locator('[data-test="visual"]')).toBeVisible();

    // Tramo 2 (sin responder, v0.2a.1 §7): borde neutro (ni verde ni rojo),
    // marca "· sin responder" con su propio data-test, sin "hace N días", sin
    // confianza (soloLectura ya la quita) ni feedback de XP.
    await page.keyboard.press('ArrowUp');
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    actual = tarjetaActual(page);
    await expect(actual).toHaveClass(/tarjeta--neutra/);
    await expect(actual).not.toHaveClass(/(^| )correcto( |$)/);
    await expect(actual).not.toHaveClass(/(^| )incorrecto( |$)/);
    await expect(actual.locator('[data-test="repaso-marca-nueva"]')).toHaveText('· sin responder');
    await expect(actual.locator('.confianza-fila')).toHaveCount(0);
    await expect(actual.locator('[data-test="feedback-texto"]')).toBeHidden();

    await page.screenshot({ path: `${CAPTURAS}/v0.2a1-repaso-sin-responder-375.png` });

    // Ninguna tarjeta de cierre en toda la vista: el mazo es "sin fin" de verdad.
    await expect(page.locator('[data-test="repaso-cierre"]')).toHaveCount(0);

    // Filtro por "ciencia" (área de la fallada): tramo 1 = solo ella; tramo 2
    // = cie-001 (nivel 1), cie-002 (nivel 2) y la sintética con visual (nivel
    // 3) -- 4 tarjetas por vuelta. "filtro por área respeta ambos tramos".
    const chipCiencia = filtroRepaso.locator('[data-area="ciencia"]');
    await chipCiencia.click();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await expect(chipCiencia).toHaveClass(/repaso-chip--activa/);
    await expect(chipCiencia).toHaveAttribute('aria-pressed', 'true');
    await expect(chipTodas).toHaveAttribute('aria-pressed', 'false');

    actual = tarjetaActual(page);
    await expect(actual.locator('[data-test="nivel-pregunta"]')).toContainText('Ciencia');
    await expect(actual.locator('.repaso-marca')).toHaveText('✗ fallada · hoy');

    // El número de nodos que respaldan el mazo (`repasoNodos` en app.js) no
    // crece sin límite: mazo.js ya limita a máximo 3 los ADJUNTOS al DOM en
    // cada momento pase lo que pase (ver render() en mazo.js), así que contar
    // ".tarjeta" en el documento no distinguiría un recorte de vueltas
    // correcto de uno roto -- lo que sí puede crecer sin límite es este array
    // (window.__one.repasoNodosLength(), expuesto solo con ?test=1), acotado
    // a ~2 vueltas (spec: "no supera 2×N+1", N = 4 con este filtro).
    const N = 4;
    for (let i = 0; i < N; i += 1) {
      const longitud = await page.evaluate(() => window.__one.repasoNodosLength());
      expect(longitud, `paso ${i} del filtro ciencia`).toBeLessThanOrEqual(2 * N + 1);
      await page.keyboard.press('ArrowUp');
      await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
    }
    // Tras exactamente N (4) ArrowUp desde la fallada -- cie-001, cie-002, la
    // sintética con visual y de vuelta a la fallada --: "la vuelta 2 empieza
    // por la primera respondida". En este mismo paso se retiró la vuelta 1
    // entera (el colchón bajó a ≤ 3 justo aquí, ver mantenerVueltasRepaso):
    // el array sigue acotado.
    expect(await page.evaluate(() => window.__one.repasoNodosLength())).toBeLessThanOrEqual(2 * N + 1);
    await expect(tarjetaActual(page).locator('.repaso-marca')).toHaveText('✗ fallada · hoy');

    // La vuelta 1 (con los nodos que se acaban de recorrer) ya se retiró: se
    // recorre la vuelta 2 -- mismo contenido, nodos nuevos -- hasta la
    // sintética con visual, para comprobar también su encaje sin scroll.
    await page.keyboard.press('ArrowUp'); // cie-001 (vuelta 2)
    await esperarAsentamientoMazo(page);
    await page.keyboard.press('ArrowUp'); // cie-002 (vuelta 2)
    await esperarAsentamientoMazo(page);
    await page.keyboard.press('ArrowUp'); // sintética con visual (vuelta 2)
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    actual = tarjetaActual(page);
    await expect(actual.locator('[data-test="visual"]')).toBeVisible();
    await expect(actual.locator('[data-test="repaso-marca-nueva"]')).toHaveText('· sin responder');

    // Filtro por "historia" (área de la frágil): tramo 2 incluye his-001, que
    // trae imagen REAL del banco de ejemplo (datos/imagenes.ejemplo.json) --
    // la comprobación de "no respondida con imagen" pedida por la spec.
    const chipHistoria = filtroRepaso.locator('[data-area="historia"]');
    await chipHistoria.click();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await expect(chipHistoria).toHaveClass(/repaso-chip--activa/);
    actual = tarjetaActual(page);
    await expect(actual.locator('.repaso-marca')).toHaveText('✓ frágil · hoy');

    await page.keyboard.press('ArrowUp'); // his-001: sin responder, con imagen real de ejemplo.
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    actual = tarjetaActual(page);
    await expect(actual).toHaveClass(/tarjeta--neutra/);
    await expect(actual.locator('[data-test="repaso-marca-nueva"]')).toHaveText('· sin responder');
    await expect(actual.locator('[data-test="imagen"]')).toBeVisible();

    await page.screenshot({ path: `${CAPTURAS}/v0.2a-repaso-filtro-375.png` });

    // Salir: solo con "←" (cabecera), directo al HUB.
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
  });

  test('Repaso a 393×852 (con zonas seguras del iPhone) y a 430×932: ninguna tarjeta hace scroll', async ({
    page,
  }) => {
    async function comprobarEnViewport(viewport, conZonasSeguras) {
      await page.setViewportSize(viewport);
      await page.goto('/?test=1');
      if (conZonasSeguras) {
        // Mismas zonas seguras simuladas que "ONE · C1 visual desbordado..."
        // (env(safe-area-inset-*) vale 0 en Chromium headless).
        await page.addStyleTag({
          content: '.cabecera { padding-top: 59px !important; } body { padding-bottom: 34px !important; }',
        });
      }
      await prepararYJugar(page);

      await page.locator('[data-test="repaso-hub"]').click();
      await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
      await esperarAsentamientoMazo(page);

      // Las 3 respondidas (fallada, frágil, acertada) y, sin tarjeta de
      // cierre (v0.2a.1 §7, "sin fin"), varias más sin responder del banco
      // REAL (`/?test=1`): cubre los dos tramos con contenido real de
      // longitud variable, sin depender de qué id concreto toque.
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('ArrowUp');
        await esperarAsentamientoMazo(page);
        await assertSinScroll(page);
        await assertTarjetaSinScroll(page);
      }
    }

    await comprobarEnViewport({ width: 393, height: 852 }, true);
    await comprobarEnViewport({ width: 430, height: 932 }, false);
  });

  // Ronda 1 de revisión (Important): una tarjeta ANTERIOR a v0.2 no tiene
  // ultimaRespuesta ni ultimaCorrecta (esos dos campos no existían todavía).
  // Se precarga en localStorage un estado con esa forma exacta -- ANTES de
  // que app.js lea `one.estado` al arrancar, así que goto + set + reload, no
  // goto + set a secas (cargarEstado() se ejecuta una sola vez, de forma
  // síncrona, al evaluar el módulo) -- para una tarjeta fallada (pendiente)
  // de una pregunta test4 del banco de ejemplo. Solo se omiten esos dos
  // campos nuevos: el resto sigue la plantilla real de motor.js
  // (registrarRespuesta/normalizarEstado), no un JSON inventado.
  test('Repaso: una tarjeta anterior a v0.2 (sin ultimaRespuesta ni ultimaCorrecta) se pinta marcando solo la correcta', async ({
    page,
  }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();

    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const preguntaTest4 = bancoEjemplo.find((p) => p.tipo === 'test4');
    expect(preguntaTest4).toBeTruthy();

    const estadoAnteriorAV02 = {
      version: 2,
      xp: 0,
      combo: 0,
      nivelPartida: 1,
      racha: { dias: 0, ultimaFecha: null },
      hoy: { fecha: '2020-01-01', respondidas: 1, aciertos: 0 },
      areas: {},
      tarjetas: {
        [preguntaTest4.id]: {
          caja: 0,
          proximo: '2020-01-02',
          aciertos: 0,
          fallos: 1,
          ultimo: '2020-01-01',
          ultimoFallo: '2020-01-01',
          pendiente: true,
          prioridad: 1,
          recuperada: false,
          fragil: false,
          // Sin ultimaRespuesta ni ultimaCorrecta: así era una tarjeta antes
          // de v0.2 (motor.js los añadió con registrarRespuesta en esta spec).
        },
      },
      reportadas: [],
      historial: [],
      recuperadas: 0,
      confianza: { altas: 0, altasOk: 0, bajas: 0, bajasOk: 0 },
      mision: null,
    };
    await page.evaluate(
      (estado) => localStorage.setItem('one.estado', JSON.stringify(estado)),
      estadoAnteriorAV02
    );
    await page.reload(); // recarga app.js: cargarEstado() lee YA el estado precargado.

    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const botonRepasoHub = page.locator('[data-test="repaso-hub"]');
    await expect(botonRepasoHub).toHaveAttribute('aria-disabled', 'false');
    await botonRepasoHub.click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-test', 'repaso-tarjeta');
    await expect(t.locator('.repaso-marca')).toContainText('✗ fallada'); // pendiente -> tramo "fallada"

    // Sin ultimaRespuesta no hay forma de saber qué opción se marcó: se pinta
    // SOLO la correcta (spec v0.2 §2), sin ninguna línea tachada de "la tuya".
    const compacta = t.locator('.respuesta-compacta');
    await expect(compacta).toContainText(preguntaTest4.opciones[preguntaTest4.correcta]);
    await expect(compacta.locator('.respuesta-compacta-linea--tachada')).toHaveCount(0);
  });

  // Ronda final de revisión (I1): la ronda 1 usaba un ::after position:absolute
  // DENTRO del propio contenedor con scroll, que viajaba con los chips en vez
  // de quedarse fijo sobre el borde. Sustituido por mask-image sobre la
  // propia fila (estilos.css, .repaso-filtro), que se quita con la clase
  // repaso-filtro--final -- este test comprueba la máscara, no un ::after.
  test('Repaso: el degradado (mask-image) de la fila de chips avisa de que hay más a la derecha, y se apaga al llegar al final', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await prepararYJugar(page);

    await page.locator('[data-test="repaso-hub"]').click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    /** mask-image / -webkit-mask-image, lo que el navegador exponga (Chromium
     * soporta ambas formas; se lee cualquiera de las dos por robustez). */
    const leerMask = (el) => {
      const estilo = getComputedStyle(el);
      const prefijada = estilo.getPropertyValue('-webkit-mask-image');
      const estandar = estilo.getPropertyValue('mask-image');
      return prefijada && prefijada !== 'none' ? prefijada : estandar;
    };

    const filtro = page.locator('[data-test="repaso-filtro"]');
    // Al cargar (9 chips no caben a 375px): sin la clase que quita la
    // máscara, y la propia máscara realmente aplicada (no 'none').
    await expect(filtro).not.toHaveClass(/repaso-filtro--final/);
    expect(await filtro.evaluate(leerMask)).not.toBe('none');

    // Desplazada hasta el final -> aparece repaso-filtro--final y la máscara
    // se quita (ya no hay "más a la derecha" que avisar).
    await filtro.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(filtro).toHaveClass(/repaso-filtro--final/);
    expect(await filtro.evaluate(leerMask)).toBe('none');
  });

  // Adaptado de v0.2a (Carlos, 14-sep 16:00: "quiero que me permita todas y
  // construir hacia que sea infinito igual que las preguntas"): antes, sin
  // NINGUNA tarjeta jugada, "Juega primero" apagaba el botón del HUB. Ahora
  // el repaso incluye TODO el banco (respondidas + sin responder, v0.2a.1
  // §7), así que con banco no vacío siempre hay feed que mostrar, aunque no
  // se haya jugado ni una sola partida.
  test('Repaso: sin ninguna tarjeta jugada pero con banco no vacío, el botón del HUB ya está activo y el feed es todo tarjetas sin responder', async ({
    page,
  }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const botonRepasoHub = page.locator('[data-test="repaso-hub"]');
    await expect(botonRepasoHub).toHaveAttribute('aria-disabled', 'false');
    await expect(botonRepasoHub).toHaveText('Repaso');

    await botonRepasoHub.click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    // Sin nada respondido, la primera tarjeta ya es del tramo 2 (nivel más
    // bajo del banco de ejemplo): borde neutro, marca "sin responder", sin
    // tarjeta de cierre en ningún punto de la vista.
    const actual = tarjetaActual(page);
    await expect(actual).toHaveAttribute('data-test', 'repaso-tarjeta');
    await expect(actual).toHaveClass(/tarjeta--neutra/);
    await expect(actual.locator('[data-test="repaso-marca-nueva"]')).toHaveText('· sin responder');
    await expect(actual.locator('[data-test="nivel-pregunta"]')).toContainText('nivel 1');
    await expect(page.locator('[data-test="repaso-cierre"]')).toHaveCount(0);
  });

  // Ronda final de revisión (Opus, con el banco real a 393×852): C1
  // (Critical, UX) — con 295 preguntas la columna de puntos era una raya
  // inútil (el punto "actual" solo caía dentro de la caja cerca de la mitad
  // del array) y se repintaba entera en cada deslizamiento (84 ms con CPU
  // x4). Arreglo en mazo.js/pintarPuntos: por encima de 12 huecos, ventana de
  // 9 puntos centrada en el índice actual.
  test('C1 (Critical, ronda final de revisión de rendimiento): con el banco real, la columna de puntos pinta como mucho 9 y el punto actual siempre cae dentro de la caja', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await page.locator('[data-test="repaso-hub"]').click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    /** No basta con que `.mazo-punto--actual` exista en el DOM: antes de C1
     * podía existir pero quedar fuera del área visible de `.mazo-puntos`
     * (recortado por overflow) salvo cerca de la mitad del array. */
    async function comprobarVentanaDePuntos() {
      const conteo = await page.locator('.mazo-punto').count();
      expect(conteo).toBeLessThanOrEqual(9);
      const cajaColumna = await page.locator('.mazo-puntos').boundingBox();
      const cajaActual = await page.locator('.mazo-punto--actual').boundingBox();
      expect(cajaColumna).not.toBeNull();
      expect(cajaActual).not.toBeNull();
      expect(cajaActual.y, 'el punto actual queda por ENCIMA de .mazo-puntos').toBeGreaterThanOrEqual(
        cajaColumna.y - 1
      );
      expect(
        cajaActual.y + cajaActual.height,
        'el punto actual queda por DEBAJO de .mazo-puntos'
      ).toBeLessThanOrEqual(cajaColumna.y + cajaColumna.height + 1);
    }

    await comprobarVentanaDePuntos(); // índice 0, recién abierto.

    // Banco real sin filtrar (295 preguntas, todas sin responder de fábrica):
    // salto de test (window.__one.irA), no 150/294 ArrowUp reales.
    await page.evaluate(() => window.__one.irA(150));
    await esperarAsentamientoMazo(page);
    await comprobarVentanaDePuntos();

    await page.evaluate(() => window.__one.irA(294)); // última del banco real sin filtrar.
    await esperarAsentamientoMazo(page);
    await comprobarVentanaDePuntos();
  });

  // Ronda final de revisión: I1 (Important, rendimiento) — abrir el repaso
  // con el banco real construía las ~295 tarjetas de golpe (2,5 s con CPU x4,
  // 27.000 nodos). Arreglo: mismo mecanismo que la partida (huecos con
  // `nodo: null` hasta la PRIMERA VEZ que se llega a ellos, ver
  // mantenerVueltasRepaso/asegurarRepasoConstruidoHasta en app.js).
  test('I1 (Important, ronda final de revisión de rendimiento): abrir el repaso con el banco real construye como mucho 3 tarjetas, y cada deslizamiento como mucho una más', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await page.locator('[data-test="repaso-hub"]').click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    const construidasAlAbrir = await page.evaluate(() => window.__one.repasoNodosConstruidos());
    expect(construidasAlAbrir).toBeLessThanOrEqual(3);

    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('ArrowUp');
      await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
    }

    const construidasTrasDiez = await page.evaluate(() => window.__one.repasoNodosConstruidos());
    expect(construidasTrasDiez).toBeLessThanOrEqual(13);

    // La vuelta infinita y el contador n/N siguen funcionando con huecos
    // perezosos: n/N se fija por vuelta (no por cuántos nodos hay
    // construidos), así que se sigue viendo con normalidad.
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toBeVisible();
  });
});

// Tarea 1 del plan v0.2b2-cliente-atomo (sincronizacion.js): servidor de generación simulado con
// `page.route` (sin tocar el servidor real, spec §4). Origen `https://servidor.prueba` a propósito
// distinto de `http://localhost:8765` (baseURL de este e2e, ver playwright.config.js): el fetch
// real desde la página es cross-origin de verdad, así que el navegador manda un preflight OPTIONS
// (Content-Type: application/json + Authorization fuerzan uno) antes de cada POST -- el mock tiene
// que responder ambos con cabeceras CORS, igual que hace servidor/index.js#manejarPeticion con
// `http://localhost:8765` (uno de los dos orígenes permitidos de la spec §3.1).
test.describe('ONE · servidor de generación v0.2b2 §4 (sincronizacion.js)', () => {
  const URL_SERVIDOR = 'https://servidor.prueba';
  // Ronda 1 de revisión (Important #1, sincronizacion.js#sanearToken): token de 16-128
  // caracteres sin espacios ni caracteres de control -- "abc" (el que pedía el brief original)
  // ya no pasa el saneado que ahora impone guardarConfiguracionDesdeUrl.
  const TOKEN = 'token-de-prueba-e2e-1234567890';
  const CORS = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  function preguntaServidor(id, area = 'economia') {
    return {
      id,
      area,
      tipo: 'vf',
      nivel: 1,
      enunciado: `Enunciado de prueba del servidor falso (${id}).`,
      explicacion: 'Explicación corta de prueba, del servidor falso.',
      respuesta: true,
    };
  }

  /** Responde el preflight OPTIONS con las cabeceras CORS de siempre y delega el resto (la
   * petición real) en `manejador`. */
  function conPreflight(manejador) {
    return async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      await manejador(route, req);
    };
  }

  test('configuración por ?servidor=&token=: URL limpia, aviso, punto verde, POST /estado autenticado, y las preguntas nuevas se pueden jugar', async ({
    page,
  }) => {
    const peticionesEstado = [];
    await page.route(
      `${URL_SERVIDOR}/**`,
      conPreflight(async (route, req) => {
        // Única ruta usada por sincronizacion.js en esta tarea (spec §4, "modo normal").
        peticionesEstado.push(req);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            preguntas: [preguntaServidor('srv-e2e-1'), preguntaServidor('srv-e2e-2', 'historia')],
            enCola: 0,
          }),
        });
      })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);

    // URL limpia: sin servidor/token, conserva ?test=1 (no se pierde el hook de test).
    await expect(page).toHaveURL(/\/\?test=1$/);

    // Directo al HUB (no a los emojis) con el aviso de conexión.
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="aviso-hub"]')).toHaveText('Servidor conectado');

    // El punto se pone verde en cuanto /estado responde 200.
    await expect(page.locator('[data-test="estado-servidor"]')).toHaveAttribute('data-estado', 'verde');

    expect(peticionesEstado.length).toBe(1);
    expect(peticionesEstado[0].headers()['authorization']).toBe(`Bearer ${TOKEN}`);
    const cuerpo = JSON.parse(peticionesEstado[0].postData());
    expect(cuerpo.resumen).toHaveProperty('areas');
    expect(cuerpo.resumen).toHaveProperty('idsConocidos');
    expect(cuerpo.resumen).toHaveProperty('rutasAtomo');

    // El chip de banco extendido aparece con el recuento correcto de esta tanda...
    const chip = page.locator('[data-test="nuevas-servidor"]');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('2 preguntas nuevas · Jugar');
    // ...y al tocarlo arranca la partida con esas preguntas (spec v0.2b4 §3), no solo se cierra.
    await chip.click();
    await expect(chip).toBeHidden();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/2');
    await expect(tarjetaActual(page).locator('[data-test="vf-verdadero"]')).toBeVisible();
  });

  test('sin configuración de servidor: cero peticiones y punto gris (la app funciona igual que sin servidor)', async ({
    page,
  }) => {
    let peticiones = 0;
    page.on('request', (req) => {
      if (req.url().startsWith(URL_SERVIDOR)) peticiones += 1;
    });
    await page.route(`${URL_SERVIDOR}/**`, conPreflight(async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"preguntas":[],"enCola":0}' });
    }));

    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    expect(peticiones).toBe(0);
    await expect(page.locator('[data-test="estado-servidor"]')).toHaveAttribute('data-estado', 'gris');
  });

  test('servidor caído (conexión abortada): punto ámbar, la app sigue jugable con normalidad', async ({ page }) => {
    await page.route(`${URL_SERVIDOR}/**`, (route) => route.abort());

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="estado-servidor"]')).toHaveAttribute('data-estado', 'ambar');

    // Silencioso de verdad: nada de esto impide seguir jugando con normalidad.
    await page.locator('[data-test="comenzar"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
  });
});

// C4 de la revisión final v0.2b3-atomo-amplio-gemini: el `::before` de 44×44 que amplía el área
// táctil del punto de estado (estilos.css#button.punto-servidor::before), CENTRADO en el punto,
// invadía 24×24px de la esquina superior derecha de "Comenzar" -- un toque real ahí abría la hoja
// "Conectar" en vez de arrancar la partida (medido en vivo con boundingBox, ver el informe de la
// revisión). Geometría real, sin mocks de servidor: basta con abrir el HUB.
test('HUB: el área táctil de 44px del punto de estado no pisa "Comenzar" (C4)', async ({ page }) => {
  await page.goto('/?test=1');
  await page.locator('[data-test="cerebro"]').click();
  await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

  const geometria = await page.evaluate(() => {
    // Un pseudo-elemento (`::before`) no tiene su propio nodo en el DOM, así que no hay
    // `getBoundingClientRect` directo -- se reconstruye su caja a mano a partir del `getComputedStyle`
    // resuelto (top/left/right/bottom/width/height ya en px, no en el "50%"/"10px" de la hoja de
    // estilos) más la caja REAL del punto (su contenedor: `.punto-servidor` es `position:absolute`,
    // así que es el "containing block" del propio `::before`) y la matriz de su `transform`.
    function cajaPseudoBefore(elemento) {
      const cajaElemento = elemento.getBoundingClientRect();
      const cs = getComputedStyle(elemento, '::before');
      let tx = 0;
      let ty = 0;
      if (cs.transform && cs.transform !== 'none') {
        const m = cs.transform.match(/matrix\(([^)]+)\)/);
        if (m) {
          const partes = m[1].split(',').map(Number);
          [, , , , tx, ty] = partes;
        }
      }
      const ancho = parseFloat(cs.width);
      const alto = parseFloat(cs.height);
      const izquierda =
        cs.left !== 'auto'
          ? cajaElemento.left + parseFloat(cs.left)
          : cajaElemento.right - parseFloat(cs.right) - ancho;
      const arriba =
        cs.top !== 'auto'
          ? cajaElemento.top + parseFloat(cs.top)
          : cajaElemento.bottom - parseFloat(cs.bottom) - alto;
      return { left: izquierda + tx, top: arriba + ty, width: ancho, height: alto, right: izquierda + tx + ancho, bottom: arriba + ty + alto };
    }
    function caja(selector) {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
    return {
      areaTactil: cajaPseudoBefore(document.querySelector('[data-test="estado-servidor"]')),
      comenzar: caja('[data-test="comenzar"]'),
      grid: caja('#progreso-areas'),
    };
  });

  function seSolapan(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  expect(geometria.areaTactil.height, 'el área táctil debe seguir midiendo >= 44px de alto (Apple HIG)').toBeGreaterThanOrEqual(44);
  expect(seSolapan(geometria.areaTactil, geometria.comenzar), 'el área táctil del punto no debe solapar "Comenzar"').toBe(false);
  expect(seSolapan(geometria.areaTactil, geometria.grid), 'el área táctil del punto no debe solapar la rejilla de áreas').toBe(false);
});

// Tarea 2 del plan v0.2b2-cliente-atomo (atomo.js + la vista/espera/tanda lista de app.js): el
// mismo servidor de generación simulado con `page.route` que la Tarea 1, ahora ejercitando
// /subtemas, /generar y /trabajo/:id (spec §4 "Átomo"). Describe aparte para no mezclar sus
// helpers con los de sincronizacion.js de arriba, aunque el patrón de configuración (?test=1&
// servidor=...&token=...) y el preflight CORS son deliberadamente los mismos.
test.describe('ONE · Átomo v0.2b2 §4 (atomo.js + app.js)', () => {
  const URL_SERVIDOR = 'https://servidor.prueba';
  const TOKEN = 'token-de-prueba-e2e-atomo-1234567890';
  const CORS = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  function preguntaServidor(id, area = 'economia') {
    return {
      id,
      area,
      tipo: 'vf',
      nivel: 1,
      enunciado: `Enunciado de prueba del átomo (${id}).`,
      explicacion: 'Explicación corta de prueba, del servidor falso.',
      respuesta: true,
    };
  }

  function conPreflight(manejador) {
    return async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      await manejador(route, req);
    };
  }

  /** Sirve las cuatro rutas que toca esta tarea: /estado silencioso (sin preguntas nuevas, para no
   * interferir con el chip de banco extendido), /subtemas con un anillo 1 fijo de 4 nodos y un
   * anillo 2 de 2, /generar con un trabajoId fijo, y /trabajo/:id que responde "generando" en el
   * primer sondeo y "lista" con 10 preguntas en el segundo (brief de la tarea: "tras 2 sondeos
   * simulados").
   *
   * Ronda 1 de revisión: dos parámetros nuevos, opcionales y con el mismo comportamiento de
   * siempre si no se pasan. `contadores` (objeto mutable) suma una llamada por ruta real (nunca
   * por el preflight OPTIONS) -- para comprobar cuántas veces se llamó a algo sin depender de
   * temporizadores. `trabajoRespuesta` sustituye ENTERA la respuesta de /trabajo/:id (todas las
   * veces, no solo la primera) -- para el caso "el trabajo ya no existe" (404 tras reiniciar el
   * servidor, Minor #8). */
  function servidorAtomoFalso({ contadores = {}, trabajoRespuesta = null } = {}) {
    let sondeos = 0;
    const suma = (clave) => {
      contadores[clave] = (contadores[clave] || 0) + 1;
    };
    return conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        suma('estado');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: '{"preguntas":[],"enCola":0}',
        });
        return;
      }
      if (url.pathname === '/subtemas') {
        suma('subtemas');
        const cuerpo = req.postDataJSON();
        const ruta = Array.isArray(cuerpo.ruta) ? cuerpo.ruta : [];
        const subtemas =
          ruta.length === 0
            ? [
                { indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' },
                { indice: 1, corto: 'Política monetaria', completo: 'Política monetaria y bancos centrales' },
                { indice: 2, corto: 'Comercio internacional', completo: 'Comercio internacional y aranceles' },
                { indice: 3, corto: 'Desigualdad', completo: 'Desigualdad económica' },
              ]
            : [
                { indice: 0, corto: 'Crisis de 2008', completo: 'La crisis financiera mundial de 2008' },
                { indice: 1, corto: 'Burbujas', completo: 'Burbujas especulativas históricas' },
              ];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ subtemas }),
        });
        return;
      }
      if (url.pathname === '/generar') {
        suma('generar');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ trabajoId: 'atomo-e2e-1', estimadoSeg: 42 }),
        });
        return;
      }
      if (url.pathname.startsWith('/trabajo/')) {
        suma('trabajo');
        if (trabajoRespuesta) {
          await route.fulfill(trabajoRespuesta);
          return;
        }
        sondeos += 1;
        if (sondeos === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null }),
          });
          return;
        }
        const preguntas = Array.from({ length: 10 }, (_, i) => preguntaServidor(`srv-atomo-${i + 1}`));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ estado: 'lista', hechas: 10, pedidas: 10, preguntas, motivo: null }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
  }

  test('sin servidor: Generar apagado y aviso de conectar; mantener pulsada el área abre el átomo sin lanzar la partida', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // Pulsación larga real (mousedown/wait/mouseup, no un click): cancelada por movimiento o
    // liberada antes de 500ms no debe abrir nada (ver app.js#renderHub) -- aquí se deja pasar el
    // umbral a propósito.
    const tarjeta = page.locator('[data-test="practicar-economia"]');
    const caja = await tarjeta.boundingBox();
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650); // > 500ms del umbral de pulsación larga
    await page.mouse.up();

    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();
    // El click que el navegador dispara tras soltar NO debe haber lanzado la partida del área.
    await expect(page.locator('[data-vista="pregunta"]')).toBeHidden();
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía');
    await expect(page.locator('[data-test="atomo-aviso"]')).toHaveText(
      'Conecta el servidor para generar preguntas nuevas'
    );
    await expect(page.locator('[data-test="atomo-generar"]')).toBeDisabled();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(0);

    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
  });

  test('v0.2b4 §4: el botón del área muestra "+" con su aria-label, y el toque sigue siendo de 44 px', async ({ page }) => {
    await page.goto('/?test=1');
    await page.locator('[data-test="cerebro"]').click();
    const boton = page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]');
    await expect(boton).toHaveText('+');
    await expect(boton).toHaveAttribute('aria-label', 'Explorar subtemas de Economía');
    // El glyph es pequeño a propósito, pero el ::before amplía el área REAL de toque a >= 44 px.
    const toque = await boton.evaluate((n) => {
      const antes = getComputedStyle(n, '::before');
      const caja = n.getBoundingClientRect();
      return caja.width + parseFloat(antes.left) * -2;
    });
    expect(toque).toBeGreaterThanOrEqual(44);
    await boton.click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();
    // Extra (hallazgo Minor diferido): sin-scroll también aquí, como en el resto de la suite.
    await assertSinScroll(page);
  });

  test('con servidor: "⚛" abre el átomo (4 nodos), elegir uno pide el anillo 2, Generar -> espera -> Jugar mientras -> 2 sondeos -> chip "Tanda lista" -> partida con esos ids', async ({
    page,
  }) => {
    // v0.2b3 Tarea 3 quitó la órbita giratoria entera (ya no hace falta reducedMotion para que
    // Playwright considere "estable" un nodo que antes daba vueltas) -- se conserva de todos modos
    // para seguir ejercitando la app bajo `prefers-reduced-motion`, que sigue siendo un modo real
    // que un jugador puede tener activado (accesibilidad, ver estilos.css).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // Botón "⚛" (descubrible, sin depender del temporizador de la pulsación larga): stopPropagation
    // evita que también se lance la partida del área (ver app.js#renderHub).
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);
    await expect(page.locator('[data-test="atomo-generar"]')).toBeEnabled();

    await page.screenshot({ path: `${CAPTURAS}/v0.2b2-atomo-375.png` });
    await assertSinScroll(page);

    // Ronda 1 de revisión (Minor #7): sin-scroll también a 393x852, no solo a 375x812.
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await page.locator('[data-test="atomo-nodo"]').first().click();
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados y crisis');
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2); // anillo 2 (mock de arriba)
    await expect(page.locator('[data-test="atomo-atras"]')).toBeEnabled();

    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-espera-texto"]')).toHaveText(
      'Generando 10 preguntas de Economía › Mercados y crisis · ~42 s'
    );
    await page.screenshot({ path: `${CAPTURAS}/v0.2b2-espera-375.png` });
    await assertSinScroll(page);

    await page.locator('[data-test="atomo-jugar-mientras"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();

    // El sondeo sigue en segundo plano (cada 5s) mientras se juega (spec §4): "←" vuelve al HUB
    // sin detenerlo. Tras 2 sondeos simulados (el primero "generando", el segundo "lista" con 10),
    // el chip aparece -- timeout ampliado porque son ~10s reales de sondeo (2 x 5000ms).
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const indicador = page.locator('[data-test="indicador-tanda"]');
    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText('Tanda lista · 10', { timeout: 13000 });

    await indicador.click();
    await expect(indicador).toBeHidden();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    // "0/10": recién arrancada (0 respondidas), 10 preguntas totales -- exactamente los ids de
    // la tanda que acaba de llegar, sin relleno (empezarPartida({ids, etiqueta})).
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
  });

  test('doble click en Generar no manda dos POST /generar (Ronda 1 de revisión, Critical)', async ({ page }) => {
    const contadores = {};
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso({ contadores }));

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-generar"]')).toBeEnabled();

    // Dos toques "a la vez" DE VERDAD: dos `.click()` nativos en el MISMO tick de JS. Dos
    // `.click()` de Playwright no valdrían -- cada uno espera a que el botón esté "enabled" antes
    // de tocarlo, así que el segundo se quedaría esperando a que se reactive y nunca reproduciría
    // la carrera que existía antes de este arreglo (atomoGenerarEnVuelo, ver app.js).
    await page.evaluate(() => {
      const boton = document.querySelector('[data-test="atomo-generar"]');
      boton.click();
      boton.click();
    });

    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    expect(contadores.generar).toBe(1);
  });

  test('el trabajo desaparece (404 tras reiniciar el servidor): chip de fallo y el sondeo se detiene (Ronda 1 de revisión, Minor #8)', async ({
    page,
  }) => {
    const contadores = {};
    await page.route(
      `${URL_SERVIDOR}/**`,
      servidorAtomoFalso({ contadores, trabajoRespuesta: { status: 404, headers: CORS, body: '{}' } })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();

    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText(
      'La tanda se perdió, genera otra',
      { timeout: 8000 }
    );
    // Spec §1: en 404 la tanda guardada se limpia, para no reanudar un trabajo que ya no existe.
    expect(await page.evaluate(() => localStorage.getItem('one.atomoTrabajo'))).toBe(null);

    // Spec §2: el aviso de fallo dura 6 s y desaparece; no se queda ocupando la esquina.
    await expect(page.locator('[data-test="indicador-tanda"]')).toBeHidden({ timeout: 9000 });

    // El sondeo se detiene en cuanto consultarTrabajo devuelve null (404): un ciclo más (5s) no
    // debe sumar ninguna llamada más a /trabajo/:id.
    const llamadasTrasElFallo = contadores.trabajo;
    await page.waitForTimeout(6000);
    expect(contadores.trabajo).toBe(llamadasTrasElFallo);
  });

  test('trabajo "parcial" terminal (hechas>=pedidas, contrato real del servidor) con 3 preguntas: chip "Tanda lista: 3", sondeo detenido y Generar disponible otra vez (Ronda final, Critical #1)', async ({
    page,
  }) => {
    const contadores = {};
    await page.route(
      `${URL_SERVIDOR}/**`,
      servidorAtomoFalso({
        contadores,
        trabajoRespuesta: {
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            estado: 'parcial',
            hechas: 3,
            pedidas: 3,
            preguntas: Array.from({ length: 3 }, (_, i) => preguntaServidor(`srv-parcial-${i + 1}`)),
            motivo: 'el verificador rechazó el resto del lote',
          }),
        },
      })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // Generar a anillo 1 (sin elegir subtema): corto = nombre del área ("Economía").
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await page.locator('[data-test="atomo-generar"]').click();

    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText('Tanda lista · 3', { timeout: 5000 });

    // Sondeo detenido de verdad: un ciclo más (>5s) no debe sumar ninguna llamada más.
    const llamadasTrasChip = contadores.trabajo;
    await page.waitForTimeout(6000);
    expect(contadores.trabajo).toBe(llamadasTrasChip);

    // Generar vuelve a estar disponible (finalizarTrabajoAtomo se llamó al llegar a terminal).
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-test="atomo-generar"]')).toBeEnabled();
  });

  test('quedarse en la tarjeta de espera hasta "lista": reacciona sola y "Jugar la tanda" abre la partida (Ronda final, Critical #2)', async ({
    page,
  }) => {
    let sondeos = 0;
    await page.route(
      `${URL_SERVIDOR}/**`,
      conPreflight(async (route, req) => {
        const url = new URL(req.url());
        if (url.pathname === '/estado') {
          await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"preguntas":[],"enCola":0}' });
          return;
        }
        if (url.pathname === '/subtemas') {
          const subtemas = [
            { indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' },
            { indice: 1, corto: 'Política monetaria', completo: 'Política monetaria y bancos centrales' },
            { indice: 2, corto: 'Comercio internacional', completo: 'Comercio internacional y aranceles' },
            { indice: 3, corto: 'Desigualdad', completo: 'Desigualdad económica' },
          ];
          await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ subtemas }) });
          return;
        }
        if (url.pathname === '/generar') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ trabajoId: 'espera-b', estimadoSeg: 15 }),
          });
          return;
        }
        if (url.pathname.startsWith('/trabajo/')) {
          sondeos += 1;
          if (sondeos === 1) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: CORS,
              body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null }),
            });
            return;
          }
          const preguntas = Array.from({ length: 10 }, (_, i) => preguntaServidor(`srv-espera-b-${i + 1}`));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ estado: 'lista', hechas: 10, pedidas: 10, preguntas, motivo: null }),
          });
          return;
        }
        await route.fulfill({ status: 404, headers: CORS, body: '{}' });
      })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-espera-texto"]')).toContainText('Generando 10 preguntas');

    // Sin tocar nada: el segundo sondeo (a los 5s) resuelve "lista" y la tarjeta reacciona sola.
    const resultado = page.locator('[data-test="atomo-espera-resultado"]');
    await expect(resultado).toBeVisible({ timeout: 8000 });
    await expect(resultado).toHaveText('Jugar la tanda');
    await expect(page.locator('[data-test="atomo-espera-texto"]')).toHaveText('Tanda lista: 10 preguntas de Economía');
    await expect(page.locator('[data-test="atomo-espera-acciones"]')).toBeHidden();

    await resultado.click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
  });

  test('visibilitychange oculto/visible: el sondeo se pausa y se reanuda con una consulta inmediata (Ronda final, Critical #3)', async ({
    page,
  }) => {
    let llamadasTrabajo = 0;
    await page.route(
      `${URL_SERVIDOR}/**`,
      conPreflight(async (route, req) => {
        const url = new URL(req.url());
        if (url.pathname === '/estado') {
          await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"preguntas":[],"enCola":0}' });
          return;
        }
        if (url.pathname === '/subtemas') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({
              subtemas: [
                { indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' },
                { indice: 1, corto: 'Política monetaria', completo: 'Política monetaria y bancos centrales' },
                { indice: 2, corto: 'Comercio internacional', completo: 'Comercio internacional y aranceles' },
                { indice: 3, corto: 'Desigualdad', completo: 'Desigualdad económica' },
              ],
            }),
          });
          return;
        }
        if (url.pathname === '/generar') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ trabajoId: 'visib-c', estimadoSeg: 30 }),
          });
          return;
        }
        if (url.pathname.startsWith('/trabajo/')) {
          llamadasTrabajo += 1;
          // Nunca terminal en este test: lo único que importa es CUÁNDO se llama, no el resultado.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null }),
          });
          return;
        }
        await route.fulfill({ status: 404, headers: CORS, body: '{}' });
      })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();

    // Minor #11: sondeo inmediato al arrancar, sin esperar los 5s.
    await expect.poll(() => llamadasTrabajo, { timeout: 3000 }).toBeGreaterThanOrEqual(1);

    // Oculta la pestaña: el sondeo debe pausarse.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const llamadasAlOcultar = llamadasTrabajo;
    await page.waitForTimeout(6000); // más de un ciclo de 5s: si no se hubiera pausado, subiría.
    expect(llamadasTrabajo).toBe(llamadasAlOcultar);

    // Vuelve a ser visible: consulta inmediata (no esperar otros 5s) y reanuda el intervalo de 5s.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => llamadasTrabajo, { timeout: 2000 }).toBeGreaterThan(llamadasAlOcultar);
  });

  test('el service worker no guarda en Cache Storage ninguna clave con "token=" en la URL (Ronda final, Critical #4)', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    // Con el SW ya activo y controlando (self.clients.claim() en sw.js#activate), la SIGUIENTE
    // navegación al enlace especial de configuración sí pasa por su fetch handler -- la primera
    // petición de navegación de esta misma prueba (arriba) no pudo pasar por él: el SW todavía no
    // existía en el momento en que el navegador la pidió (se registra desde dentro de app.js).
    await page.evaluate(() => navigator.serviceWorker.ready);

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const clavesConToken = await page.evaluate(async () => {
      const nombres = await caches.keys();
      const encontradas = [];
      for (const nombre of nombres) {
        // eslint-disable-next-line no-await-in-loop -- unas pocas cachés como mucho, orden no importa.
        const cache = await caches.open(nombre);
        // eslint-disable-next-line no-await-in-loop
        const peticiones = await cache.keys();
        encontradas.push(...peticiones.map((r) => r.url).filter((url) => url.includes('token=')));
      }
      return encontradas;
    });
    expect(clavesConToken).toEqual([]);
  });

  test('v0.2b4 §2: el indicador se ve en todas las vistas mientras se genera y tocarlo abre la espera', async ({ page }) => {
    await page.route(
      `${URL_SERVIDOR}/**`,
      servidorAtomoFalso({
        trabajoRespuesta: {
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null, segundosPorPregunta: 4 }),
        },
      })
    );
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await page.locator('[data-test="atomo-generar"]').click();

    const indicador = page.locator('[data-test="indicador-tanda"]');
    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText('0 de 10 · ~40 s');

    // Vista de espera -> HUB -> partida: el indicador nunca desaparece (vive fuera de <main>).
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    await expect(indicador).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(indicador).toBeVisible();
    await page.locator('[data-test="comenzar"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(indicador).toBeVisible();

    // Spec §2: en curso, tocarlo abre la vista de espera del átomo.
    await indicador.click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    // Ronda de corrección 1 (Important, hallazgo del revisor verificado en vivo a 375×812 en
    // `pregunta`): el indicador no debe solapar NINGÚN hijo de la cabecera (botón "←", logo,
    // racha/nivel) en HUB, pregunta y repaso, a 375×812 y 393×852, con el indicador en su estado
    // más ancho ("0 de 10 · ~40 s", mismo ancho renderizado que "5 de 10 · ~40 s") y en el más
    // corto ("Tanda lista · 10").
    // Extra (hallazgo Minor diferido): assertSinScroll(page) en las tres vistas, a 375×812 y
    // 393×852 (esta función se llama bajo los dos tamaños de viewport más abajo) -- cierra el
    // riesgo del `padding-top` dinámico de <main> mientras el indicador está visible (Plan B).
    async function comprobarSolapeEnTresVistas() {
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      await assertSinSolapeCabecera(page);
      await assertSinScroll(page);

      await page.locator('[data-test="comenzar"]').click();
      await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
      await esperarAsentamientoMazo(page); // geometría definitiva de la tarjeta, no a mitad de transición
      await assertSinSolapeCabecera(page);
      await assertSinScroll(page);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      await page.locator('[data-test="repaso-hub"]').click();
      await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
      await esperarAsentamientoMazo(page);
      await assertSinSolapeCabecera(page);
      await assertSinScroll(page);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    }

    await comprobarSolapeEnTresVistas();
    await page.setViewportSize({ width: 393, height: 852 });
    await comprobarSolapeEnTresVistas();
    await page.setViewportSize({ width: 375, height: 812 });

    // Estado terminal "Tanda lista · 10" (spec §2): el mismo mock por defecto (sin
    // `trabajoRespuesta` fija) resuelve "lista" con 10 preguntas en su segundo sondeo.
    await page.unroute(`${URL_SERVIDOR}/**`);
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText('Tanda lista · 10', { timeout: 13000 });

    await comprobarSolapeEnTresVistas();
    await page.setViewportSize({ width: 393, height: 852 });
    await comprobarSolapeEnTresVistas();
  });

  test('v0.2b4 §2: el chip "tanda-lista" del HUB ya no existe (una sola señal)', async ({ page }) => {
    await page.goto('/?test=1');
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="tanda-lista"]')).toHaveCount(0);
  });

  test('v0.2b4 §5: el nodo de paginación dice "Regenerar temas" y el mensaje de agotado no cambia', async ({ page }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    const mas = page.locator('[data-test="atomo-mas"]');
    await expect(mas).toBeVisible();
    await expect(mas).toHaveText('Regenerartemas'); // dos <tspan>: "Regenerar" + "temas", sin espacio entre ellos.
    await assertSinScroll(page);
  });

  /** Servidor falso para el caso "iOS recarga la PWA a mitad de tanda" (spec v0.2b4 §1): el mismo
   * `trabajoId` sobrevive a la recarga, y /trabajo/:id responde "generando 3 de 10" hasta el
   * sondeo `sondeosAntesDeTerminar`, momento en el que pasa a "lista" con 10 preguntas. */
  function servidorTandaFalso({ contadores = {}, sondeosAntesDeTerminar = 3 } = {}) {
    let sondeos = 0;
    const suma = (clave) => { contadores[clave] = (contadores[clave] || 0) + 1; };
    return conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        suma('estado');
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"preguntas":[],"enCola":0}' });
        return;
      }
      if (url.pathname === '/subtemas') {
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ subtemas: [{ indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' }] }),
        });
        return;
      }
      if (url.pathname === '/generar') {
        suma('generar');
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ trabajoId: 'tanda-recarga-1', enCola: 0, estimadoSeg: 40, segundosPorPregunta: 4 }),
        });
        return;
      }
      if (url.pathname === '/trabajo/tanda-recarga-1') {
        suma('trabajo');
        sondeos += 1;
        if (sondeos < sondeosAntesDeTerminar) {
          await route.fulfill({
            status: 200, contentType: 'application/json', headers: CORS,
            body: JSON.stringify({ estado: 'generando', hechas: 3, pedidas: 10, preguntas: [], motivo: null, segundosPorPregunta: 4 }),
          });
          return;
        }
        const preguntas = Array.from({ length: 10 }, (_, i) => preguntaServidor(`srv-recarga-${i + 1}`));
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ estado: 'lista', hechas: 10, pedidas: 10, preguntas, motivo: null, segundosPorPregunta: 4 }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
  }

  test('v0.2b4 §1: recargar a mitad de tanda retoma el sondeo y acaba en "Tanda lista"', async ({ page }) => {
    const contadores = {};
    await page.route(`${URL_SERVIDOR}/**`, servidorTandaFalso({ contadores, sondeosAntesDeTerminar: 3 }));

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await page.locator('[data-test="atomo-generar"]').click();

    const indicador = page.locator('[data-test="indicador-tanda"]');
    const texto = page.locator('[data-test="indicador-tanda-texto"]');
    await expect(indicador).toBeVisible();
    await expect(texto).toHaveText(/^3 de 10 · ~/, { timeout: 8000 });
    await page.screenshot({ path: `${CAPTURAS}/v0.2b4-indicador-375.png` });

    // La tanda está persistida ANTES de recargar (spec §1, clave one.atomoTrabajo).
    const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem('one.atomoTrabajo') || 'null'));
    expect(guardada.id).toBe('tanda-recarga-1');
    expect(guardada.pedidas).toBe(10);
    expect(guardada.corto).toBe('Economía');
    const sondeosAntes = contadores.trabajo;

    // Exactamente lo que hace iOS al cambiar de app o bloquear el móvil.
    await page.reload();
    await expect(page.locator('[data-vista="inicio"]')).toBeVisible();
    // Sin tocar nada: el indicador sigue ahí y el sondeo se ha reanudado solo.
    await expect(indicador).toBeVisible();
    // Extra (hallazgo Minor diferido de tareas anteriores): reanudar NO debe pasar por ningún
    // texto de fallo (mostrarIndicadorTandaFallida) -- sería una regresión silenciosa de
    // reanudarTandaGuardada/idsUtilizablesDeTanda (ver brief §Step 2, el fallo típico ahí).
    await expect(texto).not.toHaveText(/No se pudo generar|La tanda se perdió|El servidor tarda demasiado/);
    await expect.poll(() => contadores.trabajo, { timeout: 8000 }).toBeGreaterThan(sondeosAntes);

    await expect(texto).toHaveText('Tanda lista · 10', { timeout: 13000 });
    await page.screenshot({ path: `${CAPTURAS}/v0.2b4-indicador-lista-375.png` });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await indicador.click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
    // Estado terminal ya mostrado: la clave se limpia (spec §1) -- y NO reaparece al jugar la tanda.
    expect(await page.evaluate(() => localStorage.getItem('one.atomoTrabajo'))).toBe(null);
  });
});

// Tarea 3 del plan v0.2b3-atomo-amplio-gemini: nodo "Más…" con paginación (excluir), 6 anillos, y
// el átomo dinámico de la "Ampliación" (sin órbita, transición inmediata al tocar, nodos de
// espera, fila "Jugar el área / Repasar" mientras carga o falla). Describe aparte con sus propios
// helpers (mismo criterio que el describe de arriba: "para no mezclar sus helpers con los de
// [la tarea anterior], aunque el patrón... sea deliberadamente el mismo").
test.describe('ONE · Átomo v0.2b3 Tarea 3 (nodo "Más…", 6 anillos, dinámico)', () => {
  const URL_SERVIDOR = 'https://servidor.prueba';
  const TOKEN = 'token-de-prueba-e2e-atomo-v3-1234567890';
  const CORS = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  function conPreflight(manejador) {
    return async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      await manejador(route, req);
    };
  }

  const PAGINA1_ANILLO1 = [
    { indice: 0, corto: 'Mercados', completo: 'Mercados y crisis financieras' },
    { indice: 1, corto: 'Política monetaria', completo: 'Política monetaria y bancos centrales' },
    { indice: 2, corto: 'Comercio', completo: 'Comercio internacional y aranceles' },
    { indice: 3, corto: 'Desigualdad', completo: 'Desigualdad económica' },
  ];
  const PAGINA2_ANILLO1_FINANZAS = [
    { indice: 0, corto: 'Finanzas corporativas', completo: 'Finanzas corporativas y M&A' },
    { indice: 1, corto: 'Insolvencia', completo: 'Reestructuraciones e insolvencia' },
    { indice: 2, corto: 'Inversión', completo: 'Inversión y mercados financieros' },
    { indice: 3, corto: 'Banca', completo: 'Banca y regulación financiera' },
  ];
  const PAGINA1_ANILLO2_FINANZAS = [
    { indice: 0, corto: 'Crisis de 2008', completo: 'La crisis financiera mundial de 2008' },
    { indice: 1, corto: 'Burbujas', completo: 'Burbujas especulativas históricas' },
  ];
  const PAGINA2_ANILLO2_FINANZAS = [
    { indice: 0, corto: 'Apalancamiento', completo: 'Apalancamiento y estructuras de capital' },
    { indice: 1, corto: 'Múltiplos', completo: 'Múltiplos de valoración' },
  ];

  /** Sirve /estado (silencioso) y /subtemas con paginación real por `excluir` -- anillo 1 (2
   * páginas de 4 + agotado), anillo 2 de "Finanzas corporativas y M&A" (2 páginas de 2), y
   * anillos 3-7 (genéricos, 2 por nivel, para poder llegar hasta el 6.º sin más mocks). Cada
   * cuerpo de /subtemas recibido se guarda en `cuerpos` (aserción sobre `excluir`). */
  function servidorAtomoV3Falso({ cuerpos = [] } = {}) {
    return conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: '{"preguntas":[],"enCola":0}',
        });
        return;
      }
      if (url.pathname === '/subtemas') {
        const cuerpo = req.postDataJSON();
        cuerpos.push(cuerpo);
        const ruta = Array.isArray(cuerpo.ruta) ? cuerpo.ruta : [];
        const excluir = Array.isArray(cuerpo.excluir) ? cuerpo.excluir : [];

        let subtemas;
        if (ruta.length === 0) {
          if (excluir.length === 0) subtemas = PAGINA1_ANILLO1;
          else if (excluir.length === PAGINA1_ANILLO1.length) subtemas = PAGINA2_ANILLO1_FINANZAS;
          else subtemas = []; // agotado: "No hay más por ahora"
        } else if (ruta.length === 1) {
          subtemas = excluir.length === 0 ? PAGINA1_ANILLO2_FINANZAS : PAGINA2_ANILLO2_FINANZAS;
        } else {
          // Anillos 3.º-7.º (genérico, ignora excluir -- solo hace falta poder avanzar).
          subtemas = [
            { indice: 0, corto: `Sub ${ruta.length}A`, completo: `Subtema nivel ${ruta.length} A` },
            { indice: 1, corto: `Sub ${ruta.length}B`, completo: `Subtema nivel ${ruta.length} B` },
          ];
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ subtemas }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
  }

  test('nodo "Más…": dos páginas del anillo 1, elegir un hilo de la página 2, "Más…" en el anillo 2, avanzar hasta el 6.º anillo y tope', async ({
    page,
  }) => {
    // Sin esto, la captura de más abajo puede pillar el fade-in de 220ms de los nodos a medio
    // camino (Playwright no espera animaciones para sus aserciones de visibilidad, solo a que el
    // elemento exista y no sea opacity:0 vía display/visibility) -- mismo criterio que la suite
    // v0.2b2 de arriba.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cuerpos = [];
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoV3Falso({ cuerpos }));
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4); // página 1 del anillo 1
    await expect(page.locator('[data-test="atomo-mas"]')).toBeVisible();

    await page.screenshot({ path: `${CAPTURAS}/v0.2b3-atomo-mas-375.png` });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    // "Más…" en el anillo 1: pide la página 2 (finanzas) con excluir = los 4 completos de la página 1.
    await page.locator('[data-test="atomo-mas"]').click();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);
    await expect(page.locator('[data-test="atomo-nodo"]', { hasText: 'Finanzas' })).toBeVisible();
    const cuerpoMas1 = cuerpos.find((c) => c.ruta.length === 0 && c.excluir.length === 4);
    expect(cuerpoMas1, 'debería haber una petición de "Más…" en el anillo 1 con excluir de 4 elementos').toBeTruthy();
    expect(cuerpoMas1.excluir.slice().sort()).toEqual(PAGINA1_ANILLO1.map((s) => s.completo).sort());
    // C3 de la revisión final v0.2b3: tras un "Más…" con éxito, "Buscando subtemas…" (mismo nodo,
    // data-test="atomo-cargando" mientras carga) debe quedar oculto -- antes se quedaba fijo bajo
    // el anillo nuevo, indefinidamente (hasta avanzar o retroceder de anillo).
    await expect(page.locator('[data-test="atomo-cargando"]')).toHaveCount(0);
    await expect(page.locator('[data-test="atomo-aviso"]')).toBeHidden();

    // Elegir "Finanzas corporativas y M&A" (página 2) -> anillo 2, "Más…" ahí también.
    await page.locator('[data-test="atomo-nodo"]', { hasText: 'Finanzas' }).click();
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Finanzas corporativas');
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2); // página 1 del anillo 2

    await page.locator('[data-test="atomo-mas"]').click();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2); // página del "modelo" simulada
    const cuerpoMas2 = cuerpos.find((c) => c.ruta.length === 1 && c.excluir.length === 2);
    expect(cuerpoMas2, 'debería haber una petición de "Más…" en el anillo 2 con excluir de 2 elementos').toBeTruthy();
    expect(cuerpoMas2.excluir.slice().sort()).toEqual(PAGINA1_ANILLO2_FINANZAS.map((s) => s.completo).sort());

    // Avanza del anillo 2 (ruta.length=1) hasta ruta.length=6 (5 toques más) tocando siempre el primer nodo.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- cada toque depende del anillo que pintó el anterior.
      await page.locator('[data-test="atomo-nodo"]').first().click();
    }
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2); // 6.º anillo, todavía con nodos

    // 7.º toque: ya en el máximo, no-op + aviso de tope (data-test="atomo-tope").
    const rutaAntesDelTope = await page.locator('[data-test="atomo-ruta"]').textContent();
    await page.locator('[data-test="atomo-nodo"]').first().click();
    await expect(page.locator('[data-test="atomo-tope"]')).toHaveText('Máximo detalle: toca Generar');
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText(rutaAntesDelTope);
    await expect(page.locator('[data-test="atomo-generar"]')).toBeEnabled(); // "Generar sigue disponible"

    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
  });

  test('"Más…" agotado: "No hay más por ahora" 2s y vuelve a "Más…"', async ({ page }) => {
    const cuerpos = [];
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoV3Falso({ cuerpos }));
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);

    await page.locator('[data-test="atomo-mas"]').click(); // página 2 (finanzas)
    await expect(page.locator('[data-test="atomo-nodo"]', { hasText: 'Finanzas' })).toBeVisible();
    await page.locator('[data-test="atomo-mas"]').click(); // página 3: agotado ([])

    // El texto se envuelve en varias líneas SVG (envolverTexto) sin separador entre ellas -- se
    // comprueba por contenido, no por igualdad exacta con espacios entre líneas.
    await expect(page.locator('[data-test="atomo-mas-vacio"]')).toContainText('No hay más');
    // Los 4 subtemas de la página 2 (los últimos con éxito) siguen ahí, sin perderlos.
    await expect(page.locator('[data-test="atomo-nodo"]', { hasText: 'Finanzas' })).toBeVisible();
    await expect(page.locator('[data-test="atomo-mas"]')).toHaveCount(0); // revierte al pasar los 2s

    await expect(page.locator('[data-test="atomo-mas"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-test="atomo-nodo"]', { hasText: 'Finanzas' })).toBeVisible();
  });

  // Ronda de revisión combinada (Tarea 3+4, Important): un 400 real del servidor ("Exclusión
  // inválida", servidor/index.js#normalizarExcluir) en "Más…" ya NO se trata como "agotado" --
  // `pedirSubtemas` sigue devolviendo `null` ante cualquier error HTTP, pero `manejarMasAtomo`
  // ahora distingue ese `null` de un `[]` genuino (ver app.js). Servidor simulado a mano (en vez de
  // `servidorAtomoV3Falso`, que solo sabe responder 200) para poder devolver el 400.
  test('"Más…" con error del servidor (400 "Exclusión inválida"): aviso "No se pudo cargar más" 2s, sin marcar el anillo como agotado', async ({
    page,
  }) => {
    await page.route(
      `${URL_SERVIDOR}/**`,
      conPreflight(async (route, req) => {
        const url = new URL(req.url());
        if (url.pathname === '/estado') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: '{"preguntas":[],"enCola":0}',
          });
          return;
        }
        if (url.pathname === '/subtemas') {
          const cuerpo = req.postDataJSON();
          const excluir = Array.isArray(cuerpo.excluir) ? cuerpo.excluir : [];
          if (excluir.length === 0) {
            // Página 1 (anillo recién abierto): normal, sin excluir.
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: CORS,
              body: JSON.stringify({ subtemas: PAGINA1_ANILLO1 }),
            });
            return;
          }
          // "Más…" (excluir no vacío): el servidor real respondería 400 aquí si `excluir` se
          // pasara de sus límites -- se simula directamente con el mismo código, sin depender de
          // generar 31 elementos reales para disparar el rechazo del servidor.
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ error: 'Exclusión inválida' }),
          });
          return;
        }
        await route.fulfill({ status: 404, headers: CORS, body: '{}' });
      })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);

    await page.locator('[data-test="atomo-mas"]').click();

    await expect(page.locator('[data-test="atomo-mas-error"]')).toHaveText('No se pudo cargar más');
    // NO es "agotado": ni el aviso "No hay más por ahora" ni el estado atomoFallo (que apagaría
    // Generar) se disparan -- solo el aviso corto de arriba.
    await expect(page.locator('[data-test="atomo-mas-vacio"]')).toHaveCount(0);
    // Los 4 subtemas de la página 1 (los últimos con éxito) siguen ahí, y "Más…" sigue pulsable
    // DE INMEDIATO (no hay que esperar a que el aviso de error desaparezca).
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);
    await expect(page.locator('[data-test="atomo-mas"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-generar"]')).toBeEnabled();

    // El aviso desaparece solo, a los 2s.
    await expect(page.locator('[data-test="atomo-mas-error"]')).toBeHidden({ timeout: 3000 });
  });

  test('anillo cargando: nodos de espera, fila "atomo-mientras" y un toque durante la carga no cambia la ruta', async ({
    page,
  }) => {
    // Determinismo de la captura de más abajo (mismo motivo que el test anterior): sin esto, el
    // fade-in de 220ms de los nodos de espera podría quedar a medio camino en la captura.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let resolverRetraso;
    const retraso = new Promise((resolve) => {
      resolverRetraso = resolve;
    });
    await page.route(`${URL_SERVIDOR}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: '{"preguntas":[],"enCola":0}',
        });
        return;
      }
      if (url.pathname === '/subtemas') {
        const cuerpo = req.postDataJSON();
        const ruta = Array.isArray(cuerpo.ruta) ? cuerpo.ruta : [];
        // Primera carga (anillo 1, instantánea) para poder tocar un nodo; la SIGUIENTE (anillo 2,
        // tras tocar) se retrasa 3s -- es esa la que hay que pillar "en vuelo".
        if (ruta.length === 0) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ subtemas: PAGINA1_ANILLO1 }),
          });
          return;
        }
        await retraso;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ subtemas: PAGINA1_ANILLO2_FINANZAS }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);
    await expect(page.locator('[data-test="atomo-mientras"]')).toBeHidden(); // anillo 1 ya listo

    await page.locator('[data-test="atomo-nodo"]').first().click(); // dispara la carga retrasada 3s

    // Todo esto debe ser cierto YA (brief: "en < 500 ms"), sin esperar los 3s del mock.
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados', { timeout: 500 });
    await expect(page.locator('[data-test="atomo-esperando"]')).toHaveCount(6, { timeout: 500 });
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(0, { timeout: 500 });
    await expect(page.locator('[data-test="atomo-mientras"]')).toBeVisible({ timeout: 500 });

    await page.screenshot({ path: `${CAPTURAS}/v0.2b3-atomo-esperando-375.png` });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    // Un toque sobre un nodo de espera no hace nada: la ruta sigue igual.
    await page.locator('[data-test="atomo-esperando"]').first().click({ force: true });
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados');

    // Resuelve el retraso: llegan los subtemas reales y la fila "mientras" desaparece.
    resolverRetraso();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2);
    await expect(page.locator('[data-test="atomo-esperando"]')).toHaveCount(0);
    await expect(page.locator('[data-test="atomo-mientras"]')).toBeHidden();
  });

  test('"Jugar el área" de la fila "atomo-mientras" arranca una partida del área mientras el anillo carga', async ({
    page,
  }) => {
    let resolverRetraso;
    const retraso = new Promise((resolve) => {
      resolverRetraso = resolve;
    });
    await page.route(`${URL_SERVIDOR}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: '{"preguntas":[],"enCola":0}',
        });
        return;
      }
      if (url.pathname === '/subtemas') {
        await retraso; // el anillo 1 mismo llega retrasado: basta para probar "mientras carga".
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ subtemas: PAGINA1_ANILLO1 }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-test="atomo-mientras"]')).toBeVisible();

    await page.locator('[data-test="atomo-mientras-jugar"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(page.locator('[data-test="modo-area"]')).toHaveText('Solo Economía');

    resolverRetraso(); // deja la petición pendiente resolver para no dejar un handle colgado
  });

  test('"Repasar" de la fila "atomo-mientras" abre la pantalla de repaso mientras el anillo carga', async ({
    page,
  }) => {
    let resolverRetraso;
    const retraso = new Promise((resolve) => {
      resolverRetraso = resolve;
    });
    await page.route(`${URL_SERVIDOR}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: '{"preguntas":[],"enCola":0}',
        });
        return;
      }
      if (url.pathname === '/subtemas') {
        await retraso;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ subtemas: PAGINA1_ANILLO1 }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-test="atomo-mientras"]')).toBeVisible();

    await page.locator('[data-test="atomo-mientras-repasar"]').click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();

    resolverRetraso(); // deja la petición pendiente resolver para no dejar un handle colgado
  });
});

// Tarea 4 del plan v0.2b3-atomo-amplio-gemini ("Conectar desde la app instalada"): en iOS la app
// añadida a la pantalla de inicio (`display: standalone`) tiene almacenamiento SEPARADO de Safari,
// así que el enlace `?servidor=&token=` abierto en Safari no llega a la app instalada -- esta hoja
// deja pegar el enlace (o "servidor token") a mano, sin salir de la app. Servidor simulado con
// `page.route` (nunca una llamada real a la red), mismo patrón CORS que las tareas anteriores.
test.describe('ONE · Conectar desde la app instalada (v0.2b3 Tarea 4)', () => {
  const URL_SERVIDOR = 'https://servidor.prueba';
  const TOKEN = 'token-de-prueba-e2e-conectar-1234567890';
  const CORS = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  function conPreflight(manejador) {
    return async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      await manejador(route, req);
    };
  }

  /** Sirve /estado (silencioso, sin preguntas nuevas) y /subtemas (un anillo 1 fijo de 1 nodo) --
   * las dos rutas que toca esta tarea tras conectar con éxito (recarga del anillo + sincronización
   * en segundo plano, ver app.js#manejarConectarOk). */
  function servidorConectarFalso() {
    return conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: '{"preguntas":[],"enCola":0}',
        });
        return;
      }
      if (url.pathname === '/subtemas') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            subtemas: [{ indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' }],
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
  }

  /** Mismo contrato que assertSinScroll (arriba en esta hoja), pero sobre la propia hoja "Conectar":
   * no es una `.vista`, vive fuera del sistema de vistas (position: fixed, anclada abajo). */
  async function assertSinScrollHoja(page) {
    const medidas = await page.evaluate(() => {
      const hoja = document.querySelector('[data-test="conectar"]');
      return hoja ? { alto: hoja.scrollHeight, visible: hoja.clientHeight } : null;
    });
    expect(medidas).not.toBeNull();
    expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
  }

  test('abrir la hoja desde el punto de estado, pegar un enlace, Conectar cierra la hoja, avisa "Conectado" y recarga el anillo', async ({
    page,
  }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorConectarFalso());

    // Sin `?test=1` a propósito: comprueba que `location.search` queda REALMENTE vacío tras
    // conectar (el enlace se pegó en un <input>, nunca tocó la barra de direcciones del navegador).
    await page.goto('/');
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();

    // Sin servidor: punto gris, aviso y ayuda de conectar (Tarea 4).
    await expect(page.locator('[data-test="atomo-estado-servidor"]')).toHaveAttribute('data-estado', 'gris');
    await expect(page.locator('[data-test="atomo-aviso"]')).toHaveText(
      'Conecta el servidor para generar preguntas nuevas'
    );
    await expect(page.locator('[data-test="atomo-ayuda"]')).toHaveText(
      'Conecta el servidor (toca el punto de la cabecera)'
    );

    // Abrir la hoja desde el punto de estado de la cabecera del Átomo.
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await page.locator('[data-test="atomo-estado-servidor"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeVisible();
    await assertSinScrollHoja(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScrollHoja(page);
    await page.setViewportSize({ width: 375, height: 812 });

    const enlace = `https://carlostorresadvisory.github.io/one/?servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`;
    await page.locator('[data-test="conectar-texto"]').fill(enlace);
    await page.locator('[data-test="conectar-ok"]').click();

    // Éxito: hoja cerrada, aviso "Conectado", campo vacío, y la URL real del navegador nunca se
    // tocó (nada de "servidor="/"token=" colgando en el historial, a diferencia del enlace de
    // Safari -- aquí no hay enlace de por medio, solo texto pegado en un campo).
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(page.locator('[data-test="conectar-hecho"]')).toBeVisible();
    await expect(page.locator('[data-test="conectar-texto"]')).toHaveValue('');
    expect(await page.evaluate(() => location.search)).toBe('');

    // El anillo se recarga con la configuración recién guardada: ya no "sin servidor".
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(1);
    await expect(page.locator('[data-test="atomo-ayuda"]')).toHaveText(
      'Mantén pulsada un área del HUB para abrir su átomo'
    );

    // El "Conectado" desaparece solo, a los 2s (mismo mecanismo que mostrarAvisoHub/mostrarAvisoCuerpo).
    await expect(page.locator('[data-test="conectar-hecho"]')).toBeHidden({ timeout: 3000 });
  });

  // Revisión combinada (Tarea 4): Carlos aterriza en el HUB al abrir la app instalada, así que el
  // punto de estado de ahí (junto a "Comenzar") también debe abrir la hoja -- no solo el gemelo
  // dentro del Átomo, que exige un paso extra (abrir el átomo de un área) para llegar a él.
  test('abrir la hoja también desde el punto de estado del HUB (junto a "Comenzar"), sin pasar por el Átomo', async ({
    page,
  }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorConectarFalso());

    await page.goto('/');
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await expect(page.locator('[data-test="estado-servidor"]')).toHaveAttribute('data-estado', 'gris');
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await page.locator('[data-test="estado-servidor"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeVisible();

    const enlace = `https://carlostorresadvisory.github.io/one/?servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`;
    await page.locator('[data-test="conectar-texto"]').fill(enlace);
    await page.locator('[data-test="conectar-ok"]').click();

    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(page.locator('[data-test="conectar-hecho"]')).toBeVisible();
    // sincronizarEnSegundoPlano (fire-and-forget) deja el punto en verde en cuanto /estado responde.
    await expect(page.locator('[data-test="estado-servidor"]')).toHaveAttribute('data-estado', 'verde');
  });

  // Ronda de revisión combinada (Tarea 4, tres Important): (a) el foco vuelve al botón que abrió
  // la hoja al cerrarla, sea por Cancelar o por éxito -- sin esto, cerrar el diálogo deja el foco
  // de teclado "perdido"; (c) el aria-label de los puntos de estado sigue llevando el estado real
  // (gris/verde), no un texto de acción fijo.
  test('foco: Cancelar (y el éxito) devuelven el foco al punto que abrió la hoja; su aria-label refleja el estado', async ({
    page,
  }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorConectarFalso());
    await page.goto('/');
    await page.locator('[data-test="cerebro"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const punto = page.locator('[data-test="estado-servidor"]');
    await expect(punto).toHaveAttribute('aria-label', /sin conectar/i);

    // Cancelar: la hoja se cierra y el foco vuelve al punto que la abrió.
    await punto.click();
    await expect(page.locator('[data-test="conectar"]')).toBeVisible();
    await page.locator('[data-test="conectar-cancelar"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(punto).toBeFocused();

    // Conectar de verdad: también tras el éxito el foco vuelve al punto, y su aria-label pasa a
    // reflejar "conectado" (nunca queda fijo en un texto de acción genérico).
    await punto.click();
    const enlace = `https://carlostorresadvisory.github.io/one/?servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`;
    await page.locator('[data-test="conectar-texto"]').fill(enlace);
    await page.locator('[data-test="conectar-ok"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(punto).toBeFocused();
    await expect(punto).toHaveAttribute('aria-label', /conectado/i);
  });

  // Punto 7 del triaje final v0.2b3: la prueba de arriba solo cubría el punto del HUB
  // (data-test="estado-servidor") -- misma comprobación (foco + aria-label), ahora desde su gemelo
  // dentro de la cabecera del Átomo (data-test="atomo-estado-servidor").
  test('foco (variante Átomo): Cancelar (y el éxito) devuelven el foco al punto del Átomo que abrió la hoja; su aria-label refleja el estado', async ({
    page,
  }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorConectarFalso());
    await page.goto('/?test=1');
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();

    const punto = page.locator('[data-test="atomo-estado-servidor"]');
    await expect(punto).toHaveAttribute('aria-label', /sin conectar/i);

    // Cancelar: la hoja se cierra y el foco vuelve al punto del Átomo que la abrió.
    await punto.click();
    await expect(page.locator('[data-test="conectar"]')).toBeVisible();
    await page.locator('[data-test="conectar-cancelar"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(punto).toBeFocused();

    // Conectar de verdad: también tras el éxito el foco vuelve al punto del Átomo, y su
    // aria-label pasa a reflejar "conectado".
    await punto.click();
    const enlace = `https://carlostorresadvisory.github.io/one/?servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`;
    await page.locator('[data-test="conectar-texto"]').fill(enlace);
    await page.locator('[data-test="conectar-ok"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(punto).toBeFocused();
    await expect(punto).toHaveAttribute('aria-label', /conectado/i);
  });

  test('enlace no válido: aviso de error sin cerrar la hoja; también se abre desde el aviso del átomo; Cancelar/Escape cierran y vacían el campo', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await page.locator('[data-test="cerebro"]').click();
    await page.locator('[data-test="practicar-economia"] [data-test="atomo-abrir"]').click();
    await expect(page.locator('[data-vista="atomo"]')).toBeVisible();

    // Segundo disparador: tocar el propio aviso "Conecta el servidor..." (no solo el punto).
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await page.locator('[data-test="atomo-aviso"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeVisible();

    await page.locator('[data-test="conectar-texto"]').fill('esto no es un enlace ni "servidor token"');
    await page.locator('[data-test="conectar-ok"]').click();
    await expect(page.locator('[data-test="conectar-error"]')).toBeVisible();
    await expect(page.locator('[data-test="conectar"]')).toBeVisible(); // el error NO cierra la hoja

    await page.locator('[data-test="conectar-cancelar"]').click();
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await expect(page.locator('[data-test="conectar-texto"]')).toHaveValue('');
    // Cancelar no guardó nada: sigue sin servidor.
    await expect(page.locator('[data-test="atomo-estado-servidor"]')).toHaveAttribute('data-estado', 'gris');

    // Escape hace lo mismo que Cancelar: cierra y vacía el campo.
    await page.locator('[data-test="atomo-estado-servidor"]').click();
    await page.locator('[data-test="conectar-texto"]').fill('texto que se debe perder');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-test="conectar"]')).toBeHidden();
    await page.locator('[data-test="atomo-estado-servidor"]').click();
    await expect(page.locator('[data-test="conectar-texto"]')).toHaveValue('');
  });
});
