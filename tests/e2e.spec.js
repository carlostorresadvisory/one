// e2e de ONE: HUB (radar + misión + pendientes + niveles) ->
// partida (mazo vertical, confianza dentro de la tarjeta, feedback compacto) ->
// resumen (carrusel "Para repasar") -> HUB, contra el banco de ejemplo, más una
// partida de humo contra el banco real. Playwright headless a 375x812.
import { test, expect } from '@playwright/test';

const CAPTURAS = 'docs/capturas';

/** Aviso grande «Preguntas generadas» (v0.3 fase 3): sustituye al indicador pequeño en el estado «lista». */
const avisoGeneradas = (page) => page.locator('[data-test="aviso-generadas"]');
const jugarAviso = (page) => page.locator('[data-test="aviso-generadas-jugar"]');
/** Con la tanda terminando mientras se mira la espera del Átomo el aviso no se enseña (esa vista ya
 * tiene «Jugar la tanda»): se espera el resultado, se vuelve al HUB y allí llega el aviso. */
async function esperarAvisoTrasEspera(page, timeout) {
  await expect(page.locator('[data-test="atomo-espera-resultado"]')).toHaveText('Jugar la tanda', { timeout });
  await expect(avisoGeneradas(page)).toBeHidden();
  await page.locator('[data-test="volver"]').click();
  await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
  await expect(avisoGeneradas(page)).toContainText('· 10');
}

/** Ninguna vista debe hacer scroll (spec "que se note" 12-sep): la .vista activa
 * debe caber entera en su alto visible. */
/** «Saber +» (v0.3.2): abre el panel del botón dado y devuelve el panel (vive en document.body, no en la tarjeta). */
async function abrirSaberMas(page, dentro = page) {
  await dentro.locator('[data-test="saber-mas"]').first().click();
  const menu = page.locator('[data-test="saber-mas-menu"]');
  await expect(menu).toBeVisible();
  return menu;
}

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
      .filter((hijo) => !hijo.hidden && getComputedStyle(hijo).visibility !== 'hidden') // racha/nivel ceden su sitio al indicador (17-sep)
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

/** "Sin hueco muerto" para la visual de la tarjeta REVELADA (spec v0.2a.2.1 §1.1, Ruling R9): con
 * `.zona-imagen` como único `flex-grow` de `.tarjeta-contenido`, si no está en su techo (max-height)
 * debe absorber EXACTAMENTE todo el sobrante -- lo que le sobra a `.tarjeta` una vez descontados
 * padding/gap propios, `.tarjeta-accion` y el resto de hijos de `.tarjeta-contenido` (con sus
 * gaps) tiene que ser su alto real, sin margen sin usar. Devuelve los px de hueco (`idealZona -
 * zonaReal`): ~0 cuando lo absorbe todo, un valor grande y ESPERADO cuando la zona ya está en su
 * techo (ahí el hueco no es un bug, es el margen que el techo reserva a propósito). Reutilizable
 * por la Tarea 7 (barrido del banco real) y por cualquier test de esta zona.
 * IMPORTANTE para quien la reuse: solo da un `huecoMuerto` fiable con `page.emulateMedia({
 * reducedMotion: 'reduce' })` activo en la página. Sin él, la entrada de la visual al responder
 * (`visual-entra`, 220ms, spec §8) puede seguir a mitad de camino cuando se mide -- no cambia el
 * alto real de nada, pero mientras esa animación corre `getBoundingClientRect()` de
 * `.tarjeta-contenido`/`.zona-imagen` puede leer varios px por encima de `clientHeight` (que sí es
 * estable), colando un "hueco muerto" falso que desaparece en cuanto se desactiva el movimiento
 * (medido en vivo: hasta 20px de diferencia sin `reducedMotion`, 0px con él). */
async function medirHuecoMuerto(page) {
  return page.evaluate(() => {
    const tarjeta = document.querySelector('.tarjeta-mazo--actual');
    if (!tarjeta) return null;
    const contenido = tarjeta.querySelector('.tarjeta-contenido');
    const accion = tarjeta.querySelector('.tarjeta-accion');
    const zona = contenido ? contenido.querySelector('.zona-imagen') : null;
    if (!contenido || !zona) return null;

    const estiloTarjeta = getComputedStyle(tarjeta);
    const paddingVertical = parseFloat(estiloTarjeta.paddingTop) + parseFloat(estiloTarjeta.paddingBottom);
    const gapTarjeta = parseFloat(estiloTarjeta.rowGap) || 0;

    const gapContenido = parseFloat(getComputedStyle(contenido).rowGap) || 0;
    const hermanos = Array.from(contenido.children).filter((hijo) => hijo !== zona);
    const sumaHermanos = hermanos.reduce((total, hijo) => total + hijo.getBoundingClientRect().height, 0);
    // N hijos directos de `.tarjeta-contenido` (incluida la zona) -> N-1 huecos entre ellos.
    const huecosContenido = Math.max(0, contenido.children.length - 1) * gapContenido;

    const accionAlto = accion ? accion.getBoundingClientRect().height : 0;
    const tarjetaAlto = tarjeta.getBoundingClientRect().height;
    const zonaReal = zona.getBoundingClientRect().height;
    const zonaIdeal = tarjetaAlto - paddingVertical - gapTarjeta - accionAlto - sumaHermanos - huecosContenido;

    return { huecoMuerto: zonaIdeal - zonaReal, zonaIdeal, zonaReal, tarjetaAlto };
  });
}

/** El radar absorbe el espacio libre del HUB (spec "pantalla completa"
 * 12-sep): nada de hueco vacío entre la rejilla de modos y el pie. */
async function comprobarHuecoGridPie(page) {
  const cajaGrid = await page.locator('[data-test="hub-modos"]').boundingBox();
  const cajaPie = await page.locator('.hub-pie').boundingBox();
  expect(cajaGrid).not.toBeNull();
  expect(cajaPie).not.toBeNull();
  const hueco = cajaPie.y - (cajaGrid.y + cajaGrid.height);
  expect(hueco).toBeLessThanOrEqual(48);
}

/** v0.3: abre la hoja del filtro con el chip de la cabecera (cualquier pantalla de modo). */
async function abrirHojaFiltro(page) {
  await page.locator('[data-test="chip-filtro"]').click();
  await expect(page.locator('[data-test="hoja-filtro"]')).toBeVisible();
}

/** v0.3: con la hoja abierta, elige un área (en Clásico/Repaso abre su átomo dentro de la hoja). */
async function elegirAreaEnFiltro(page, area) {
  await page.locator(`[data-test="filtro-area-${area}"]`).click();
  await expect(page.locator('[data-test="atomo"]')).toBeVisible();
}

/** La hoja del filtro es una superposición: assertSinScroll mira la vista de DEBAJO, esto mira la hoja. */
async function assertHojaSinScroll(page) {
  const medidas = await page.locator('[data-test="hoja-filtro"]').evaluate((h) => ({ alto: h.scrollHeight, visible: h.clientHeight }));
  expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
}

/** v0.3: desde el HUB, un solo toque en la tarjeta del modo lo abre. */
async function entrarEnModo(page, modo) {
  await page.locator(`[data-test="modo-${modo}"]`).click();
}

/** v0.3: Repaso = partida de las falladas (decisión de Carlos, 5-oct). Requiere ≥ 1 pendiente. */
async function entrarEnRepaso(page) {
  await entrarEnModo(page, 'repaso');
  await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
  await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Repaso');
}

/** v0.3: el feed de lectura ya no tiene botón en el hub (solo se llega desde el final del resumen).
 * Los e2e del feed lo abren con el gancho de test: el `goto` debe llevar `test=1`. */
async function abrirFeedRepaso(page) {
  await page.evaluate(() => window.__one.abrirRepaso());
  await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
}

/** v0.3: sustituye al "+" de la tarjeta de área (retirada). Abre el átomo del área sobre el HUB, sin
 * partida debajo, con el gancho de test (el `goto` debe llevar `test=1`); "←" vuelve al HUB. */
async function abrirAtomoDesdeHub(page, area = 'economia') {
  await page.evaluate((a) => window.__one.abrirAtomo(a), area);
  await expect(page.locator('[data-test="atomo"]')).toBeVisible();
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
  } else if (tipo === 'test4') { // las opciones salen barajadas: se acierta por el índice original (en el banco de ejemplo la correcta es la 0)
    await t.locator('[data-test^="opcion-"][data-original="0"]').click();
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
    await t.locator('[data-test^="opcion-"][data-original="3"]').click(); // una incorrecta (la correcta es la 0)
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
 * cargado ('ok'), falle ('error': construirBloqueImagen sustituye el bloque
 * por la capa siguiente —visual de datos o, si tampoco hay, la tarjeta
 * tipográfica—, nunca lo quita del todo desde spec §8/v0.2a.2, ver app.js) o
 * se agote un timeout corto ('timeout') — nunca cuelga.
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
  test('HUB -> partida -> resumen -> HUB: mecánicas, feedback, radar, misión, pendientes y progreso', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err));

    // 1. ONE abre directamente en el HUB, con la racha en 0.
    await page.goto('/?ejemplo=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');

    // Mapa título -> índice sospechoso del banco de ejemplo: permite acertar siempre
    // las preguntas de tipo "error" cuando queremos acertar a propósito.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    // 2. En el HUB están las tarjetas de modo, el radar de las 8 áreas, la
    // Misión de hoy y Pendientes. Estado recién creado: puntuación 0 en todas las
    // áreas -> radar vacío con aviso, sin relleno de solidez todavía, Pendientes
    // en 0 y una Misión de hoy recién generada (Economía + Historia son las dos
    // áreas más flojas del banco de ejemplo con todo a 0, por orden de AREAS).
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="radar"]')).toBeVisible();
    await expect(page.locator('[data-test="radar-solido"]')).toHaveCount(0);
    await expect(page.locator('#radar-vacio')).toBeVisible();
    await expect(page.locator('[data-test="hub-modos"] > .hub-modo')).toHaveCount(6);
    await expect(page.locator('[data-test="marcador-repaso"]')).toHaveText('Al día');
    await assertSinScroll(page);
    await comprobarHuecoGridPie(page);
    await page.screenshot({ path: `${CAPTURAS}/02-hub.png` });

    // 3. En el HUB no hay «←»: no hay a dónde volver.
    await expect(page.locator('[data-test="volver"]')).toBeHidden();

    // 4. Practicar solo un área desde el HUB: tocar la tarjeta de "geografia"
    // arranca una partida filtrada (el banco de ejemplo tiene 4 preguntas de esa
    // área: con 5 o más no habría aviso). La cabecera debe anunciar "Solo Geografía" y la tarjeta debe serlo.
    await page.locator('[data-test="modo-clasico"]').click();
    await abrirHojaFiltro(page);
    await elegirAreaEnFiltro(page, 'geografia');
    await page.locator('[data-test="filtro-elegir"]').click();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Solo hay 4 preguntas de Geografía');
    await page.locator('[data-test="filtro-corto-jugar"]').click();
    await expect(page.locator('[data-test="chip-filtro"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Geografía');
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Geografía');

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
    // El orden de las 4 preguntas de geografía lo decide el rng del motor: fallamos la primera sea cual sea.
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await expect(tarjeta1.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(tarjeta1.locator('[data-test="explicacion"]')).toBeVisible();
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await avanzarTrasRespuesta(page);

    // 6. Segunda pregunta de geografía: acertamos a propósito (con la explicación y "Siguiente" a la vista)
    // y el resto del área se juega acertando; la última puede avanzar sola al resumen o esperar "Siguiente".
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Geografía');
    const tarjeta2 = tarjetaActual(page);
    await expect(tarjeta2.locator('[data-test="confianza"]')).toBeVisible();
    await responderPreguntaActual(page, sospechosoPorTitulo);
    // Acierto: la explicación también se ve siempre, sin tocar nada.
    await expect(tarjeta2.locator('[data-test="explicacion"]')).toBeVisible();
    await expect(tarjeta2.locator('[data-test="siguiente"]')).toBeVisible();
    await avanzarTrasRespuesta(page);
    await jugarPartida(page, { sospechosoPorTitulo });
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
    await assertSinScroll(page);

    // 7. "Inicio" (resumen) vuelve SIEMPRE al HUB. Con la
    // primera pregunta fallada, el resumen ES un mazo de repaso (spec v0.1c
    // §6): hay que recorrerlo hasta la tarjeta final para llegar a "Inicio".
    // La racha ya cuenta esta partida filtrada como partida completa del día,
    // la nota de economía deja de estar vacía ('—'), y Pendientes pasa a 1 (el
    // fallo de la primera pregunta de economía sigue sin recuperar).
    const finalEconomia = await recorrerRepasoHastaFinal(page);
    await finalEconomia.locator('[data-test="ir-inicio"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toBeHidden();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await expect(page.locator('[data-test="radar-solido"], .radar-dato')).not.toHaveCount(0);
    await expect(page.locator('[data-test="marcador-repaso"]')).toHaveText('1 por repasar');
    await assertSinScroll(page);

    // 8. Practicar "Pendientes" desde el HUB: la única tarjeta pendiente es la
    // fallada en el paso 5. Acertarla debe mostrar el chip "Recuperada" y, al
    // terminar (era la única, así que la partida se cierra ahí), un resumen sin
    // fallos ("Para repasar" vacío) y Pendientes de vuelta a 0.
    await expect(page.locator('[data-test="marcador-repaso"]')).toHaveText('1 por repasar');
    await entrarEnRepaso(page); // chip «Repaso»
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
    await expect(page.locator('[data-test="marcador-repaso"]')).toHaveText('Al día');

    // 9. "←" desde pregunta/resumen vuelve siempre al HUB:
    // arrancamos la partida normal (sin filtro) para comprobarlo desde pregunta. Clásico recuerda
    // el filtro de Geografía del paso 4: el aviso de menos de 5 ofrece «Volver a TODOS».
    await entrarEnModo(page, 'clasico');
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Solo hay 4 preguntas de Geografía');
    await page.locator('[data-test="filtro-corto-todos"]').click();
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // 10. Partida normal (sin filtro) de verdad, desde la tarjeta Clásico: la primera
    // pregunta se falla a propósito (deja al menos una tarjeta en "Para repasar"
    // para el resumen), la segunda se acierta con confianza Alta (comprueba el
    // "×1,5"), y el resto se juega en modo genérico capturando cada mecánica
    // nueva (con la confianza visible) y el primer feedback.
    await entrarEnModo(page, 'clasico');
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
    // comprobar sus 3 enlaces de «Saber +» — contienen el prompt de ESTA
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
    const menuRepaso1 = await abrirSaberMas(page, tarjetaRepaso1);
    const hrefChatgpt = await menuRepaso1.locator('[data-test="preguntar-chatgpt"]').getAttribute('href');
    const hrefClaude = await menuRepaso1.locator('[data-test="preguntar-claude"]').getAttribute('href');
    const hrefGemini = await menuRepaso1.locator('[data-test="preguntar-gemini"]').getAttribute('href');
    expect(hrefChatgpt.startsWith('https://chatgpt.com/?q=')).toBe(true);
    expect(hrefClaude.startsWith('https://claude.ai/new?q=')).toBe(true);
    expect(hrefGemini.startsWith('https://www.google.com/search?udm=50&q=')).toBe(true);
    for (const href of [hrefChatgpt, hrefClaude, hrefGemini]) {
      expect(decodeURIComponent(href)).toContain(explicacionFallada);
    }
    for (const destino of ['chatgpt', 'claude', 'gemini']) {
      await expect(menuRepaso1.locator(`[data-test="preguntar-${destino}"]`)).toHaveAttribute('target', '_blank');
      await expect(menuRepaso1.locator(`[data-test="preguntar-${destino}"]`)).toHaveAttribute('rel', 'noopener');
    }
    await page.keyboard.press('Escape');
    await expect(menuRepaso1).toHaveCount(0);
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

    // 11b (18-sep-2026, Carlos): desde la última tarjeta del resumen, un empujón más hacia arriba
    // encadena con el repaso del HUB, sin botón. La pista lo anuncia en la propia tarjeta.
    await expect(tarjetaFinal.locator('[data-test="resumen-seguir-repaso"]')).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await expect(page.locator('[data-vista="resumen"]')).toBeHidden();

    // 12. Recargar: siempre se cae en el HUB (no hay "última
    // vista" que recordar); la racha persiste. Volver al HUB: el radar ya no
    // está vacío, hay relleno de solidez y al menos una barra de área tiene progreso.
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 1');
    await expect(page.locator('#radar-vacio')).toBeHidden();
    await expect(page.locator('[data-test="radar-solido"], .radar-dato')).not.toHaveCount(0);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
    await page.locator('[data-test="modo-clasico"]').click();

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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS_430}/01-hub.png` });

    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
    await comprobarHuecoGridPie(page);
    await page.screenshot({ path: `${CAPTURAS_430}/02-hub.png` });

    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    await page.locator('[data-test="modo-clasico"]').click();

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
    const menuRepaso430 = await abrirSaberMas(page, tarjetaRepaso430);
    await expect(menuRepaso430.locator('[data-test="preguntar-chatgpt"]')).toHaveAttribute('href', /^https:\/\/chatgpt\.com\/\?q=/);
    await expect(menuRepaso430.locator('[data-test="preguntar-claude"]')).toHaveAttribute('href', /^https:\/\/claude\.ai\/new\?q=/);
    await expect(menuRepaso430.locator('[data-test="preguntar-gemini"]')).toHaveAttribute('href', /udm=50/);
    await page.keyboard.press('Escape');

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

    await page.locator('[data-test="modo-clasico"]').click();

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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');

    await page.evaluate(() =>
      window.__one.empezarPartida({ ids: ['no-existe-en-el-banco'], etiqueta: 'inexistente' })
    );

    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="pregunta"]')).toBeHidden();
    await expect(page.locator('[data-test="aviso-hub"]')).toBeVisible();
    await expect(page.locator('[data-test="aviso-hub"]')).toHaveText('Nada que jugar con este filtro');
    await expect(page.locator('[data-test="chip-filtro"]')).toBeHidden();
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
      // Ronda 1 de revisión de la Tarea 2 (M3): lista actualizada a las
      // clases que la cascada REVELADA usa de verdad hoy (spec §8) —
      // 'tarjeta--sin-respuestas'/'--sin-enunciado'/'--explicacion-menor'/
      // '--explicacion-minima' ya no las añade ajustarEncaje en ninguna
      // rama (su CSS se retiró en esta misma ronda, ver estilos.css), y
      // 'tarjeta--enunciado-menor' sigue viva pero solo en la cascada SIN
      // responder (paso (a), no la revelada) — se deja aquí igualmente por
      // si esta tarjeta cayera en esa rama alguna vez.
      const CLASES_CASCADA = [
        'tarjeta--compacta-1',
        'tarjeta--enunciado-menor',
        'tarjeta--enunciado-14',
        'tarjeta--enunciado-clamp',
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
      // v0.2a.2.1 §1.3: sin imagen ni `visual` (p. ej. eco-091, el "ordenar" más largo del banco
      // real), la tarjeta cae en la tercera capa -- la clave ya está en la visual y
      // `.respuesta-resumen` ya no se pinta ahí (spec: "la línea Respuesta: deja de duplicarse"),
      // así que no hay texto de tamaño fijo que medir. Con imagen o visual de datos (p. ej.
      // art-092, el "error" más largo) `.respuesta-resumen` sigue existiendo y se comprueba igual
      // que siempre.
      if (compactado === null && normal === null) return;
      expect(compactado).not.toBeNull();
      expect(compactado).toBe(normal);
    }

    async function comprobarEnViewport(viewport, sufijo) {
      await page.setViewportSize(viewport);
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
      await expect(pie0.locator('a')).toHaveText('Commons · Autor de ejemplo · CC BY-SA 4.0');
      await expect(pie0.locator('a')).toHaveAttribute('target', '_blank');
      await expect(pie0.locator('a')).toHaveAttribute('rel', 'noopener');
      await avanzarTrasRespuesta(page);

      // Hueco 1 (art-001, test4, Public domain sin autor): atribución
      // simplificada, sin autor ni "undefined" colgando.
      await expect(t).toHaveAttribute('data-indice', '1');
      await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
      await t.locator('[data-test^="opcion-"][data-original="0"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await expect(t.locator('[data-test="imagen"]')).toBeVisible();
      const pie1 = t.locator('[data-test="imagen-pie"]');
      await expect(pie1).toContainText('Public domain');
      await expect(pie1).not.toContainText('undefined');
      await expect(pie1.locator('a')).toHaveText('Commons · Public domain');
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
  // 90px). Actualizado en la Tarea 5 (v0.2a.2.1 §1.4): con la visual fija al
  // 50 % (spec §1.1) esta explicación de 60 palabras ya NO cabe entera -- se
  // recorta y, por eso mismo, se vuelve tocable (excepción explícita de
  // Carlos, 17-sep) en vez de verse entera sin recorte como antes.
  test('v0.2a.2.1: peor caso (explicación más larga del banco + imagen) — la imagen se queda al 50 %, la explicación se recorta y se abre tocándola', async ({ page }) => {
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
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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

      // El texto ENTERO sigue en el DOM (el recorte es solo visual: line-clamp), pero ya no cabe
      // a la vista con la visual en su 50 % -- y entonces se puede tocar (spec §1.4.2).
      const explicacion = t.locator('[data-test="explicacion"]');
      await expect(explicacion).toBeVisible();
      expect((await explicacion.textContent()).trim()).toBe(peor.explicacion.trim());
      await expect(explicacion).toHaveClass(/explicacion--recortada/);

      const overlay = page.locator('[data-test="visual-completa"]');
      await explicacion.click();
      await expect(overlay).toBeVisible();
      await expect(overlay.locator('[data-test="visual-completa-texto"]')).toContainText(peor.explicacion.trim().slice(-30));
      await page.keyboard.press('Escape');
      await expect(overlay).toBeHidden();

      // La respuesta compacta sigue SIN reaccionar al toque: la excepción del §1.4.2 es solo para
      // el texto recortado, no una vuelta a las alternancias de v0.1c.
      const claseAntes = await t.getAttribute('class');
      await t.locator('.zona-respuesta').click({ force: true }).catch(() => {});
      expect(await t.getAttribute('class')).toBe(claseAntes);
      expect(await overlay.evaluate((el) => el.hidden)).toBe(true);

      await page.screenshot({ path: `${CAPTURAS}/v0.1d-peor-caso-imagen-explicacion-${sufijo}.png` });
    }

    await comprobarEnViewport({ width: 375, height: 812 }, '375');
    await comprobarEnViewport({ width: 430, height: 932 }, '430');
  });

  // Reescrito en la Tarea 2 de spec §8/v0.2a.2 (protagonismo visual, 16-sep):
  // la cascada de la tarjeta REVELADA cambió entera (ver ajustarEncaje en
  // mazo.js) -- ya no hay tarjeta--sin-respuestas/--sin-enunciado/
  // --explicacion-menor/--explicacion-minima en esta rama. La primera versión
  // de este test (Tarea 2) tuvo que reducir el enunciado sintético de
  // `.repeat(4)` a `.repeat(2)` porque la cascada de entonces no tenía NINGÚN
  // paso que recortara el enunciado y `.repeat(4)` desbordaba sin converger
  // nunca -- exactamente el riesgo que la Ronda 1 de revisión (I2) señaló:
  // sin tope de longitud en el pipeline de generación, un enunciado largo de
  // verdad podía reproducir el mismo desborde. Con el paso nuevo
  // (tarjeta--enunciado-clamp, penúltimo de la cascada) el `.repeat(4)`
  // original ya converge -- restaurado aquí para comprobarlo de verdad, no
  // solo en teoría. La explicación también larguísima (tiene su propio
  // recorte calculado) fuerza la cascada nueva entera y comprueba paso a
  // paso -- con getComputedStyle, no solo con el nombre de la clase -- que
  // cada pieza realmente se encoge y que el ORDEN es siempre respuesta
  // compacta -> enunciado 14px -> explicación (clamp 2) -> visual al 30% ->
  // enunciado (clamp 2) -> explicación (clamp 1), y que la visual NUNCA
  // desaparece (solo baja su suelo). Pregunta sintética inyectada vía
  // window.__one.inyectarPregunta: más simple y menos frágil que interceptar
  // datos/banco.json con page.route, y no depende de qué traiga el banco real.
  //
  // Ronda 2 de revisión (I2 parcial): antes se comprobaba un absoluto
  // (`zonaImagenAlto >= 118`), que colaba un suelo roto -- `flex-basis:30%`
  // sin más no es un suelo de verdad porque `.zona-imagen` sigue con
  // `flex-shrink:1` (medido en vivo: 124px de 554px, 22.4%, por debajo del
  // 30% que exige la spec, con un `min-height:120px` fijo que ya no
  // representaba el 30% real de una tarjeta más alta). Arreglado en
  // estilos.css (`min-height:max(120px, 30%)`, misma técnica que el suelo
  // del 40%). Este test pasa a comprobar la RATIO real (`.zona-imagen` >=
  // 30% de `.tarjeta-contenido`, con el mismo margen de 0.01 que ya usa el
  // test de "estructura fija" para el redondeo) en las TRES resoluciones,
  // no un absoluto en una sola.
  const VIEWPORTS_CASCADA = [
    { width: 375, height: 812, nombre: '375' },
    { width: 393, height: 852, nombre: '393', zonaSegura: true },
    { width: 430, height: 932, nombre: '430' },
  ];

  for (const vp of VIEWPORTS_CASCADA) {
    test(`spec §8 (Tarea 2, Ronda 1 I2, Ronda 2): cascada de encaje paso a paso de la tarjeta revelada a ${vp.nombre}×${vp.height} — respuesta → enunciado 14px → explicación → enunciado clamp → feedback menor, la visual nunca baja del 50 %`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      if (vp.zonaSegura) {
        // Mismas zonas seguras reales de un iPhone que el resto de la suite
        // (ver "C1 visual desbordado con zonas seguras del iPhone" más
        // arriba): env(safe-area-inset-*) vale 0 en Chromium headless.
        await page.addStyleTag({
          content: '.cabecera { padding-top: 59px !important; } body { padding-bottom: 34px !important; }',
        });
      }

      const idSintetico = `sintetico-desborde-extremo-${vp.nombre}`;
      const preguntaSintetica = {
        id: idSintetico,
        area: 'historia',
        tipo: 'vf',
        nivel: 1,
        enunciado:
          'Enunciado sintético deliberadamente larguísimo para forzar un desborde extremo de la tarjeta respondida y comprobar que la cascada de encaje sacrifica primero las respuestas, luego el enunciado, y solo al final la explicación y la visual. '.repeat(
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
        const respuestaResumen = tarjeta.querySelector('.respuesta-resumen');
        const enunciado = tarjeta.querySelector('.enunciado');
        const explicacion = tarjeta.querySelector('.explicacion');
        const imagen = tarjeta.querySelector('[data-test="imagen"]');
        const zonaImagen = tarjeta.querySelector('.zona-imagen');
        const contenido = tarjeta.querySelector('.tarjeta-contenido');
        return {
          clases: [...tarjeta.classList],
          zonaImagenClases: zonaImagen ? [...zonaImagen.classList] : [],
          respuestaResumenDisplay: respuestaResumen ? getComputedStyle(respuestaResumen).display : null,
          enunciadoFontSize: enunciado ? getComputedStyle(enunciado).fontSize : null,
          enunciadoLineClamp: enunciado ? getComputedStyle(enunciado).webkitLineClamp : null,
          explicacionLineClamp: explicacion ? getComputedStyle(explicacion).webkitLineClamp : null,
          imagenAlto: imagen ? imagen.getBoundingClientRect().height : null,
          zonaImagenAlto: zonaImagen ? zonaImagen.getBoundingClientRect().height : null,
          contenidoAlto: contenido ? contenido.clientHeight : null,
          tarjetaAlto: tarjeta.getBoundingClientRect().height,
        };
      });

      // La visual NUNCA desaparece por falta de espacio (spec §8), y desde v0.2a.2.1 §1.1.1 nunca
      // baja del 50 % real de la TARJETA (ver la comprobación de proporción más abajo, junto al
      // resto de pasos de la cascada).
      expect(estado.imagenAlto).not.toBeNull();
      expect(estado.contenidoAlto).toBeGreaterThan(0);

      // Paso (a): la respuesta pasa a su resumen de una línea
      // (tarjeta--compacta-1) — lo primero en ceder, igual que antes.
      expect(estado.clases).toContain('tarjeta--compacta-1');
      expect(estado.respuestaResumenDisplay).toBe('block');

      // Paso (b): el enunciado baja a 14px (tarjeta--enunciado-14, spec §8) —
      // con este desborde tan extremo, la cascada tiene que haber llegado aquí.
      expect(estado.clases).toContain('tarjeta--enunciado-14');
      expect(estado.enunciadoFontSize).toBe('14px');

      // Paso (c): la explicación se recorta con line-clamp calculado (mínimo 2
      // líneas, o 1 si hizo falta el último recurso) — getComputedStyle
      // confirma el recorte real, no solo el nombre de la clase.
      expect(estado.clases).toContain('tarjeta--explicacion-clamp');
      expect(['1', '2']).toContain(estado.explicacionLineClamp);

      // Paso (d), spec v0.2a.2.1 §1.4.1: con un enunciado `.repeat(4)` tan
      // extremo, ni siquiera (a)-(c) bastan — la cascada tiene que llegar a
      // recortar también el enunciado (mínimo 2 líneas, mismo mecanismo que la
      // cascada sin responder). El enunciado absorbe el resto del desborde SIN
      // que la visual baje nunca de su 50 % real (comprobado abajo) -- si algún
      // día no bastara, la explicación a 1 línea y, como último recurso,
      // tarjeta--feedback-menor son quienes ceden después, nunca la visual.
      expect(estado.clases).toContain('tarjeta--enunciado-clamp');
      expect(Number(estado.enunciadoLineClamp)).toBeGreaterThanOrEqual(2);

      // La visual nunca baja del 50 % de la TARJETA (spec v0.2a.2.1 §1.1.1), ni en el peor caso.
      expect(
        estado.zonaImagenAlto / estado.tarjetaAlto,
        `.zona-imagen mide ${estado.zonaImagenAlto}px de ${estado.tarjetaAlto}px de tarjeta a ${vp.nombre}px`
      ).toBeGreaterThanOrEqual(0.5 - 1 / estado.tarjetaAlto);

      // Paso (d) de v0.2a.2: `zona-imagen--reducida` (bajar la visual al 30 %) YA NO EXISTE.
      expect(estado.zonaImagenClases).not.toContain('zona-imagen--reducida');

      // Paso (f), nuevo, NO se comprueba aquí (Ronda de corrección de la Tarea 4, medido en vivo):
      // a estos tres viewports (812-932px de alto) el 50 % de la visual deja de sobra para que la
      // cascada converja ya en el paso (d) -- `tarjeta--enunciado-clamp` calcula 2-5 líneas según
      // el viewport, nunca agota su suelo de 2. Ni alargar más el enunciado/explicación sintéticos
      // cambia eso: una vez clampados, su alto lo decide el espacio libre (calcularLineasClamp),
      // no la longitud del texto de origen. El paso (f) SÍ está cubierto, con datos reales: la
      // pregunta art-091 del banco a 375×667 lo alcanza (ver "visual al 50-60 % real de la
      // tarjeta"), un viewport más bajo que ninguno de los tres de aquí.
    });
  }

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
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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

  // Reescrito en la Tarea 2 de spec §8/v0.2a.2 (protagonismo visual): antes
  // Una imagen rota deja el color del área (fase 7), nunca la tarjeta sin zona de imagen ni un
  // emoji grande; `tarjeta-contenido--imagen` no se quita nunca.
  test('imagen rota (404): cae al color del área, nunca deja la tarjeta sin zona de imagen', async ({
    page,
  }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
    // toHaveCount/toBeVisible reintentan hasta que el respaldo sustituye el bloque.
    await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
    await expect(t.locator('[data-test="imagen-pie"]')).toHaveCount(0);
    await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
    await expect(t.locator('.tarjeta-contenido')).toHaveClass(/tarjeta-contenido--imagen/);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
  });

  // --- v0.1d: gesto, contador, fila compacta, confianza compacta, imagen ---

  test('mazo v0.1d §1: contador de la cabecera (respondidas/total en partida)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();

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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // Necesario para acertar SIEMPRE las de tipo "error" (spec de
    // responderPreguntaActual): sin este mapa, "responder correctamente"
    // adivina el índice 0, que falla en cualquier "error" cuyo sospechoso no
    // sea ese, metiendo fallos NO intencionados en el repaso.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    await page.locator('[data-test="modo-clasico"]').click();

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

  test('v0.2a.2.1 §1.2.4: "esta pregunta está mal" en su propia línea bajo los chips, y "Anotado" en su sitio', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();

    const t = tarjetaActual(page);
    await responderPreguntaActual(page);
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();

    const fila = t.locator('.fila-accion');
    await expect(fila).toBeVisible();
    const cajaFila = await fila.boundingBox();
    expect(cajaFila.height).toBeLessThanOrEqual(28); // 12px de texto, ya no 44

    // La flecha ↓ vive en la fila de los chips, POR ENCIMA: ya no comparte fila con el enlace.
    const cajaEstaMal = await t.locator('[data-test="esta-mal"]').boundingBox();
    const cajaFlecha = await t.locator('[data-test="siguiente"]').boundingBox();
    expect(cajaFlecha.y + cajaFlecha.height).toBeLessThanOrEqual(cajaEstaMal.y + 2);

    // "esta pregunta está mal" -> "Anotado" ocupa el mismo sitio, sin fila aparte.
    await t.locator('[data-test="esta-mal"]').click();
    await expect(t.locator('[data-test="esta-mal"]')).toBeHidden();
    await expect(t.locator('.reportada')).toBeVisible();
    await expect(t.locator('.reportada')).toHaveText('Anotado');
    await assertTarjetaSinScroll(page);
  });

  test('mazo v0.1d §3: confianza compacta a 32px tras responder, sigue editable', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();

    const t = tarjetaActual(page);
    const cajaAntes = await t.locator('[data-test="confianza"]').boundingBox();
    expect(cajaAntes.height).toBeGreaterThanOrEqual(42);
    expect(cajaAntes.height).toBeLessThanOrEqual(46);

    // Las de tipo «error» necesitan el índice del sospechoso: sin él el test era intermitente.
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
    await responderPreguntaActual(page, sospechosoPorTitulo);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();

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

  test('v0.2a.2.1 §1.1: la imagen absorbe el sobrante sin hueco muerto (Ruling R9)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // Geometría determinista (mismo motivo que "estructura fija" más abajo): sin esto, medir justo
    // tras responder puede pillar la entrada de la visual (visual-entra, spec §8, 220ms) a mitad de
    // camino y las medidas de .zona-imagen/.tarjeta-contenido salen unos px del sitio.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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

    // Ruling R9 (ronda de corrección 1): la spec fija el invariante [50 %, 60 %] y dice que la
    // visual "crece hasta el 60 % cuando el texto deja sitio" -- no que SIEMPRE llegue al 60 %. A
    // este viewport, con la explicación real de his-001, el presupuesto fijo no deja sitio hasta
    // el techo (medido: ~54 %), así que la aserción correcta no es "≥59 %" sino el invariante más
    // "sin hueco muerto": la visual absorbe TODO lo que le sobra, y si no llega al techo es porque
    // no había más que absorber, no porque algo se quedó sin usar.
    const hueco = await medirHuecoMuerto(page);
    expect(hueco, 'no se pudo medir el hueco muerto (falta .zona-imagen o .tarjeta-contenido)').not.toBeNull();
    const proporcion = hueco.zonaReal / hueco.tarjetaAlto;
    expect(
      proporcion,
      `la zona mide ${hueco.zonaReal.toFixed(1)}px de ${hueco.tarjetaAlto.toFixed(1)}px de tarjeta = ${(proporcion * 100).toFixed(1)}% (fuera de [50,60])`
    ).toBeGreaterThanOrEqual(0.5 - 1 / hueco.tarjetaAlto);
    expect(proporcion).toBeLessThanOrEqual(0.6 + 1 / hueco.tarjetaAlto);
    expect(
      Math.abs(hueco.huecoMuerto) <= 2 || proporcion >= 0.59,
      `hueco muerto de ${hueco.huecoMuerto.toFixed(1)}px (zona ideal ${hueco.zonaIdeal.toFixed(1)}px, zona real ${hueco.zonaReal.toFixed(1)}px) y la zona está al ${(proporcion * 100).toFixed(1)}% (no llegó a su techo del 59 %)`
    ).toBe(true);
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
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
// Fase 7 (imágenes con impacto): la app solo enseña foto real, el color del área (nunca un emoji
// grande ni una tarjeta de texto) o, solo para una fórmula de matemáticas/ciencia, su dibujo. Describe
// aparte: inyectarPregunta añade la pregunta sintética al banco YA cargado.
// ============================================================================
test.describe('ONE · imagen, color del área y fórmula (fase 7)', () => {
  const TIPOS_SIN_DIBUJO = ['linea-tiempo', 'barras', 'comparacion', 'flujo', 'dato'];

  for (const tipo of TIPOS_SIN_DIBUJO) {
    test(`sin imagen, una pregunta con visual "${tipo}" enseña el color del área y NO dibuja el visual`, async ({ page }) => {
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      const visualesEjemplo = await page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json()));
      const pregunta = visualesEjemplo[tipo];
      expect(pregunta).toBeTruthy();

      await page.evaluate((p) => window.__one.inyectarPregunta(p), pregunta);
      await page.evaluate((id) => window.__one.empezarPartida({ ids: [id], etiqueta: `color-${id}` }), pregunta.id);

      const t = tarjetaActual(page);
      await t.locator('[data-test="vf-verdadero"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);

      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
      await expect(t.locator('[data-test="visual"]')).toHaveCount(0);
      await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
      await expect(t.locator('.visual-clave')).toHaveCount(0);
    });
  }

  test('una fórmula de ciencia sin imagen sí se dibuja, con su leyenda y sin scroll', async ({ page }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const visualesEjemplo = await page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json()));
    const pregunta = { ...visualesEjemplo.formula, area: 'ciencia' };
    await page.evaluate((p) => window.__one.inyectarPregunta(p), pregunta);
    await page.evaluate((id) => window.__one.empezarPartida({ ids: [id], etiqueta: `formula-${id}` }), pregunta.id);

    const t = tarjetaActual(page);
    await expect(t.locator('[data-test="visual"]')).toHaveCount(0);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await expect(t.locator('[data-test="visual"]')).toBeVisible();
    await expect(t.locator('[data-test="visual-pie"]')).toHaveText(pregunta.visual.leyenda);
    await expect(t.locator('[data-test="zona-color"]')).toHaveCount(0);
  });

  test('con imagen Y visual en la misma pregunta, gana la imagen', async ({ page }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const [visualesEjemplo, imagenesEjemplo] = await Promise.all([
      page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json())),
      page.evaluate(() => fetch('datos/imagenes.ejemplo.json').then((r) => r.json())),
    ]);
    const idSintetico = 'sintetico-visual-e-imagen';
    const preguntaSintetica = { ...visualesEjemplo.formula, area: 'ciencia', id: idSintetico };
    const imagenForzada = { ...imagenesEjemplo['his-001'], id: idSintetico };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaSintetica);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenForzada);
    await page.evaluate((id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'visual-y-imagen' }), idSintetico);

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
    await expect(t.locator('[data-test="imagen"]')).toBeVisible();
    await expect(t.locator('[data-test="visual"]')).toHaveCount(0);
  });

  test('«Imagen mala»: la zona pasa al color del área, se guarda en el móvil y no vuelve a salir', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['his-001'], etiqueta: 'imagen-mala' }));

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(t.locator('[data-test="imagen"]')).toBeVisible();

    await t.locator('[data-test="imagen-mala"]').click();
    await expect(t.locator('[data-test="imagen"]')).toHaveCount(0);
    await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
    const guardadas = await page.evaluate(() => JSON.parse(localStorage.getItem('one.imagenesMalas')));
    expect(guardadas).toContain('his-001');
    await assertSinScroll(page);

    // Al recargar sigue sin salir la imagen.
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['his-001'], etiqueta: 'imagen-mala-2' }));
    const t2 = tarjetaActual(page);
    await t2.locator('[data-test="vf-verdadero"]').click();
    await expect(t2.locator('[data-test="siguiente"]')).toBeVisible();
    await expect(t2.locator('[data-test="imagen"]')).toHaveCount(0);
    await expect(t2.locator('[data-test="zona-color"]')).toBeVisible();
  });

  test('una imagen generada con IA dice «Imagen generada con IA» y no enlaza a ninguna página', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate(() =>
      window.__one.forzarImagen('his-001', {
        id: 'his-001',
        url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        pagina: null,
        titulo: 'Ilustración',
        autor: null,
        licencia: null,
        fuente: 'IA',
        leyenda: 'Ilustración generada',
        ancho: 1,
        alto: 1,
      })
    );
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['his-001'], etiqueta: 'imagen-ia' }));

    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    const pie = t.locator('[data-test="imagen-pie"]');
    await expect(pie).toContainText('Imagen generada con IA');
    await expect(pie.locator('a')).toHaveCount(0);
  });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 375, height: 667 },
  ]) {
    test(`sin scroll con el color del área a ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      const visualesEjemplo = await page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json()));
      const pregunta = visualesEjemplo.barras;
      await page.evaluate((p) => window.__one.inyectarPregunta(p), pregunta);
      await page.evaluate((id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'color-viewport' }), pregunta.id);
      const t = tarjetaActual(page);
      await assertSinScroll(page);
      await t.locator('[data-test="vf-verdadero"]').click();
      await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
      await esperarAsentamientoMazo(page);
      await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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

    // CRITICAL (Ronda de corrección 1 de la Tarea 5): este es justo el escenario que rompía --
    // `tarjeta--enunciado-clamp` de verdad activo (line-clamp con más texto real detrás, así que
    // `scrollHeight > clientHeight` por construcción) en la tarjeta ACTIVA sin responder. Antes del
    // fix, `marcarRecorte` se llamaba aquí igual que en la revelada y dejaba el enunciado con
    // `role="button"`/`tabindex="0"`/la clase `enunciado--recortado`, y un toque abría la
    // superposición de texto sobre una pregunta que el jugador ni ha visto entera ni ha respondido
    // -- viola "la tarjeta ACTIVA sin responder no cambia" (v0.1d §3/§4). Nada de eso debe estar.
    const enunciado = t.locator('.enunciado');
    await expect(enunciado).not.toHaveClass(/enunciado--recortado/);
    expect(await enunciado.getAttribute('role')).toBeNull();
    expect(await enunciado.getAttribute('tabindex')).toBeNull();
    await enunciado.click({ force: true });
    expect(await page.locator('[data-test="visual-completa"]').evaluate((el) => el.hidden)).toBe(true);
  });

  // CRITICAL (Ronda de corrección 1 de la Tarea 5), con una pregunta REAL del banco: log-040 tiene
  // el enunciado más largo de todo el banco real (265 caracteres, tipo test4) -- el candidato con
  // más opciones de que la cascada "sin responder" lo recorte. A 375×667 (viewport más estrecho que
  // el que usan la mayoría de los tests de este fichero, con menos alto disponible) puede no
  // llegar de verdad a `tarjeta--enunciado-clamp` -- medido en vivo: no llega, y por eso este test
  // por sí solo pasaría igual sin el fix. Se deja de todas formas, tal como pidió la revisión, como
  // comprobación directa con datos reales del banco; el test de arriba (enunciado sintético de ~40
  // líneas, que SÍ fuerza `tarjeta--enunciado-clamp`) es el que de verdad habría fallado sin el fix.
  test('CRITICAL (Ronda de corrección 1, banco real): log-040 (el enunciado más largo del banco) como tarjeta activa a 375×667 no vuelve tocable el enunciado', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await page.evaluate(() => window.__one.empezarPartida({ ids: ['log-040'], etiqueta: 'critico-enunciado-activo' }));
    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-respondida', 'false');

    const enunciado = t.locator('.enunciado');
    await expect(enunciado).not.toHaveClass(/enunciado--recortado/);
    expect(await enunciado.getAttribute('role')).toBeNull();
    expect(await enunciado.getAttribute('tabindex')).toBeNull();
    await enunciado.click({ force: true });
    expect(await page.locator('[data-test="visual-completa"]').evaluate((el) => el.hidden)).toBe(true);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
     * de «Saber +» (C1). */
    async function comprobarSinSolape() {
      await assertTarjetaSinScroll(page);
      const actual = tarjetaActual(page);
      const explicacion = actual.locator('[data-test="explicacion"]');
      const preguntarA = actual.locator('[data-test="saber-mas-fila"]');
      await expect(explicacion).toBeVisible();
      await expect(preguntarA).toBeVisible();
      const cajaExplicacion = await explicacion.boundingBox();
      const cajaPreguntarA = await preguntarA.boundingBox();
      const explicacionAbajo = cajaExplicacion.y + cajaExplicacion.height;
      expect(
        explicacionAbajo,
        `La explicación (bottom ${explicacionAbajo.toFixed(1)}) solapa "Saber +" (top ${cajaPreguntarA.y.toFixed(1)})`
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
    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await comprobarSinSolape();
  });

  test('HUB → Repaso infinito (v0.2a.1 §7): respondidas primero, luego sin responder, sin tarjeta de cierre', async ({
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

    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await expect(page.locator('[data-test="repaso-vista"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);


    // El feed de lectura no es un modo: sin chip de filtro.
    await expect(page.locator('[data-test="chip-filtro"]')).toBeHidden();

    // Tramo 1: fallada, frágil, acertada -- mismo orden que
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
    await expect(actual.locator('[data-test="zona-color"]')).toBeVisible(); // sin imagen: color del área (fase 7)

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

      await abrirFeedRepaso(page);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

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

    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-test', 'repaso-tarjeta');
    await expect(t.locator('.repaso-marca')).toContainText('✗ fallada'); // pendiente -> tramo "fallada"

    // Sin imagen la zona es el color del área; la correcta se ve en la respuesta compacta y no hay
    // ninguna línea tachada de "la tuya".
    await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
    await expect(t.locator('.respuesta-compacta')).toContainText(preguntaTest4.opciones[preguntaTest4.correcta]);
    await expect(t.locator('.respuesta-compacta-linea--tachada')).toHaveCount(0);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await abrirFeedRepaso(page);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await abrirFeedRepaso(page);
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await abrirFeedRepaso(page);
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

    // Directo al HUB con el aviso de conexión.
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

  // Ola final v0.2b4 (M5): con más nuevas de las que caben en una partida (10), el chip decía "14
  // preguntas nuevas · Jugar" y al tocarlo arrancaba una partida de 10. Los dos números a la vista.
  test('v0.2b4 §3 (M5): con más de 10 nuevas el chip dice "14 nuevas · Jugar 10"', async ({ page }) => {
    await page.route(
      `${URL_SERVIDOR}/**`,
      conPreflight(async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            preguntas: Array.from({ length: 14 }, (_, i) => preguntaServidor(`srv-muchas-${i + 1}`)),
            enCola: 0,
          }),
        });
      })
    );

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    const chip = page.locator('[data-test="nuevas-servidor"]');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('14 nuevas · Jugar 10');
    await expect(chip).toHaveAttribute('aria-label', 'Jugar 10 preguntas nuevas');
    await chip.click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
  });

  /** Fase 7: la pregunta llega SIN imagen (`imagenPendiente: true`) porque la tanda urgente no
   * la esperó; en la siguiente sincronización el servidor la manda en `actualizadas` y el banco
   * extendido la incorpora sin que el jugador tenga que hacer nada. */
  test('fase 7: una tarjeta sin imagen la recibe en la siguiente sincronización', async ({ page }) => {
    test.setTimeout(45000);
    let sincronizaciones = 0;
    let desdeRecibido;
    const ID = 'srv-pendiente-1';
    const IMAGEN = { url: `/imagenes/${ID}.webp`, pagina: null, titulo: null, autor: null, licencia: null, fuente: 'IA', nota: 5 };

    await page.route(`${URL_SERVIDOR}/**`, conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname !== '/estado') {
        await route.fulfill({ status: 404, headers: CORS, body: '{}' });
        return;
      }
      sincronizaciones += 1;
      const cuerpo = JSON.parse(req.postData() || '{}');
      if (sincronizaciones === 1) {
        // Primera: la pregunta entra en el banco extendido sin visual y marcada como pendiente.
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({
            preguntas: [{ ...preguntaServidor(ID), imagen: null, imagenPendiente: true }],
            enCola: 0,
            actualizadas: [],
          }),
        });
        return;
      }
      // Segunda: nada nuevo, pero el visual que faltaba ya está listo.
      desdeRecibido = cuerpo.desde;
      await route.fulfill({
        status: 200, contentType: 'application/json', headers: CORS,
        body: JSON.stringify({ preguntas: [], enCola: 0, actualizadas: [{ id: ID, imagen: IMAGEN, explicacion: '' }] }),
      });
    }));

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // Estado tras la primera sincronización: en el banco, sin visual, marcada.
    await expect
      .poll(() => page.evaluate((id) => {
        const b = JSON.parse(localStorage.getItem('one.bancoExtra') || '[]');
        const p = b.find((q) => q.id === id);
        return p ? `${p.imagen === null}|${p.imagenPendiente === true}` : null;
      }, ID), { timeout: 10000 })
      .toBe('true|true');

    // Segunda sincronización: se dispara al recargar (mismo camino que "al abrir la app").
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await expect
      .poll(() => page.evaluate((id) => {
        const b = JSON.parse(localStorage.getItem('one.bancoExtra') || '[]');
        const p = b.find((q) => q.id === id);
        return p && p.imagen ? `${p.imagen.fuente}|${p.imagenPendiente}` : null;
      }, ID), { timeout: 10000 })
      .toBe('IA|false');

    expect(desdeRecibido).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
  });

  // Requisito extra del controlador (no en el brief, va más allá de comprobar solo localStorage):
  // la MISMA situación de arriba, pero verificando que el visual de verdad se PINTA en la tarjeta
  // cuando el jugador la ve en el repaso -- construirTarjetaRespondida (app.js) es la misma función
  // para la tarjeta respondida en partida y para el repaso, así que fallar la pregunta a propósito
  // (aterriza en "para repasar", primera del tramo 1) es el camino más corto y determinista hasta
  // esa pantalla sin depender del orden del banco real (295 preguntas).
  test('fase 7 (extra): la tarjeta en el repaso muestra la imagen que llegó en la sincronización', async ({
    page,
  }) => {
    test.setTimeout(45000);
    let sincronizaciones = 0;
    const ID = 'srv-pendiente-repaso-1';
    const IMAGEN = { url: `/imagenes/${ID}.webp`, pagina: null, titulo: null, autor: null, licencia: null, fuente: 'IA', nota: 5 };

    await page.route(`${URL_SERVIDOR}/**`, conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/imagenes/')) {
        await route.fulfill({ status: 200, contentType: 'image/gif', headers: CORS, body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
        return;
      }
      if (url.pathname !== '/estado') {
        await route.fulfill({ status: 404, headers: CORS, body: '{}' });
        return;
      }
      sincronizaciones += 1;
      if (sincronizaciones === 1) {
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({
            preguntas: [{ ...preguntaServidor(ID), imagen: null, imagenPendiente: true }],
            enCola: 0,
            actualizadas: [],
          }),
        });
        return;
      }
      // Cualquier sincronización posterior (aquí, la que dispara finalizarPartida): el visual ya está.
      await route.fulfill({
        status: 200, contentType: 'application/json', headers: CORS,
        body: JSON.stringify({ preguntas: [], enCola: 0, actualizadas: [{ id: ID, imagen: IMAGEN, explicacion: '' }] }),
      });
    }));

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // La primera sincronización trae la pregunta sin visual; el chip la ofrece para jugar.
    const chip = page.locator('[data-test="nuevas-servidor"]');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    // Falla A PROPÓSITO (preguntaServidor siempre respuesta:true): así aterriza en "para repasar" y
    // será la ÚNICA tarjeta de ese tramo (nada más se jugó en este test).
    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-falso"]').click();
    await avanzarTrasRespuesta(page); // única pregunta de la partida -> termina -> finalizarPartida sincroniza otra vez.
    await expect(page.locator('[data-vista="resumen"]')).toBeVisible();

    // La segunda sincronización (disparada por finalizarPartida) ya trae el visual: se espera a que
    // el banco extendido lo refleje antes de comprobar la pantalla.
    await expect
      .poll(() => page.evaluate((id) => {
        const b = JSON.parse(localStorage.getItem('one.bancoExtra') || '[]');
        const p = b.find((q) => q.id === id);
        return p && p.imagen ? p.imagen.fuente : null;
      }, ID), { timeout: 10000 })
      .toBe('IA');

    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    const tarjetaRepaso = tarjetaActual(page);
    await expect(tarjetaRepaso.locator('[data-test="imagen"]')).toBeVisible();
    await expect(tarjetaRepaso.locator('[data-test="imagen-pie"]')).toContainText('Imagen generada con IA');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
  });
});

// C4 de la revisión final v0.2b3-atomo-amplio-gemini: el `::before` de 44×44 que amplía el área
// táctil del punto de estado (estilos.css#button.punto-servidor::before), CENTRADO en el punto,
// invadía la esquina del botón principal. Desde v0.3 el punto vive en el pie del HUB: su área táctil no
// debe pisar ni los enlaces del pie ni la rejilla de modos. Geometría real, sin mocks de servidor.
test('HUB: el área táctil de 44px del punto de estado no pisa los enlaces del pie ni la rejilla (C4)', async ({ page }) => {
  await page.goto('/?test=1');
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
      exportar: caja('[data-test="exportar"]'),
      importar: caja('.hub-pie .boton-archivo'),
      creditos: caja('[data-test="abrir-creditos"]'),
      grid: caja('[data-test="hub-modos"]'),
    };
  });

  function seSolapan(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  expect(geometria.areaTactil.height, 'el área táctil debe seguir midiendo >= 44px de alto (Apple HIG)').toBeGreaterThanOrEqual(44);
  for (const enlace of ['exportar', 'importar', 'creditos']) {
    expect(seSolapan(geometria.areaTactil, geometria[enlace]), `el área táctil del punto no debe solapar «${enlace}»`).toBe(false);
  }
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

  test('sin servidor: Generar apagado y aviso de conectar en la hoja del filtro', async ({
    page,
  }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía');
    await expect(page.locator('[data-test="atomo-aviso"]')).toHaveText(
      'Conecta el servidor para generar preguntas nuevas'
    );
    await expect(page.locator('[data-test="atomo-generar"]')).toBeDisabled();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(0);

    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertHojaSinScroll(page);
  });

  test('con servidor: "⚛" abre el átomo (4 nodos), elegir uno pide el anillo 2, Generar -> espera -> Jugar mientras -> 2 sondeos -> aviso «Preguntas generadas» -> partida con esos ids', async ({
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
    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);
    await expect(page.locator('[data-test="atomo-generar"]')).toBeEnabled();

    await page.screenshot({ path: `${CAPTURAS}/v0.2b2-atomo-375.png` });
    await assertHojaSinScroll(page);

    // Ronda 1 de revisión (Minor #7): sin-scroll también a 393x852, no solo a 375x812.
    await page.setViewportSize({ width: 393, height: 852 });
    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await page.locator('[data-test="atomo-nodo"]').first().click();
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados y crisis');
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2); // anillo 2 (mock de arriba)
    await expect(page.locator('[data-test="atomo-atras"]')).toBeEnabled();

    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    // Ola final v0.2b4 (I3): el restante se redondea con tanda.js#formatearRestante, igual que el
    // indicador -- antes la espera decía "· ~42 s" crudos mientras el indicador decía "~40 s"
    // (y con una cola larga, "· ~980 s" frente a "~16 min").
    await expect(page.locator('[data-test="atomo-espera-texto"]')).toHaveText(
      'Generando 10 preguntas de Economía › Mercados y crisis · ~40 s'
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
    await expect(avisoGeneradas(page)).toContainText('Preguntas generadas', { timeout: 13000 });
    await expect(avisoGeneradas(page)).toContainText('· 10');
    await expect(page.locator('[data-test="indicador-tanda"]')).toBeHidden();

    await jugarAviso(page).click();
    await expect(avisoGeneradas(page)).toBeHidden();
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

    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();
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

    await abrirAtomoDesdeHub(page, 'economia');
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

  test('trabajo "parcial" terminal (hechas>=pedidas, contrato real del servidor) con 3 preguntas: aviso «Preguntas generadas · 3», sondeo detenido y Generar disponible otra vez (Ronda final, Critical #1)', async ({
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
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();

    // Se espera en la vista de espera del Átomo: ahí el aviso no se enseña (ya tiene su botón).
    await expect(page.locator('[data-test="atomo-espera-resultado"]')).toHaveText('Jugar la tanda', { timeout: 5000 });
    await expect(avisoGeneradas(page)).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.avisoGeneradas')).ids.length)).toBe(3);

    // Sondeo detenido de verdad: un ciclo más (>5s) no debe sumar ninguna llamada más.
    const llamadasTrasChip = contadores.trabajo;
    await page.waitForTimeout(6000);
    expect(contadores.trabajo).toBe(llamadasTrasChip);

    // Generar vuelve a estar disponible (finalizarTrabajoAtomo se llamó al llegar a terminal).
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(avisoGeneradas(page)).toContainText('· 3');
    await abrirAtomoDesdeHub(page, 'economia');
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
    await abrirAtomoDesdeHub(page, 'economia');
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
    // El aviso grande pendiente se descarta con este botón: no vuelve al terminar la partida.
    expect(await page.evaluate(() => localStorage.getItem('one.avisoGeneradas'))).toBeNull();
    await expect(avisoGeneradas(page)).toBeHidden();
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
    await abrirAtomoDesdeHub(page, 'economia');
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
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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

  test('v0.2b4 §2: el indicador se ve en todas las vistas mientras se genera y tocarlo abre la espera desde el HUB', async ({ page }) => {
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
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();

    const indicador = page.locator('[data-test="indicador-tanda"]');
    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText('0 de 10 · ~40 s');

    // Vista de espera -> HUB -> partida: el indicador nunca desaparece (vive fuera de <main>).
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    await expect(indicador).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(indicador).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(indicador).toBeVisible();

    // Ola final v0.2b4 (I1): DENTRO de una partida el toque ya no navega -- abrir la espera desde
    // `pregunta` abandonaba la partida en curso (irAlHub por el "←"). Se queda donde está.
    await indicador.click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeHidden();

    // Spec §2: fuera de la partida (HUB), en curso, tocarlo sí abre la vista de espera del átomo.
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
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
    // más ancho ("0 de 10 · ~40 s", mismo ancho renderizado que "5 de 10 · ~40 s") y, ya
    // terminada la tanda, sin indicador y con el aviso grande abajo (no debe provocar scroll).
    // Extra (hallazgo Minor diferido): assertSinScroll(page) en las tres vistas, a 375×812 y
    // 393×852 (esta función se llama bajo los dos tamaños de viewport más abajo) -- cierra el
    // riesgo del `padding-top` dinámico de <main> mientras el indicador está visible (Plan B).
    async function comprobarSolapeEnTresVistas() {
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      await assertSinSolapeCabecera(page);
      await assertSinScroll(page);

      await page.locator('[data-test="modo-clasico"]').click();
      await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
      await esperarAsentamientoMazo(page); // geometría definitiva de la tarjeta, no a mitad de transición
      await assertSinSolapeCabecera(page);
      await assertSinScroll(page);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      await abrirFeedRepaso(page);
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

    // Estado terminal (spec §2): el mismo mock por defecto (sin `trabajoRespuesta` fija) resuelve
    // "lista" con 10 preguntas en su segundo sondeo; el indicador se apaga y llega el aviso grande.
    await page.unroute(`${URL_SERVIDOR}/**`);
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await expect(avisoGeneradas(page)).toContainText('· 10', { timeout: 13000 });
    await expect(indicador).toBeHidden();

    await comprobarSolapeEnTresVistas();
    await page.setViewportSize({ width: 393, height: 852 });
    await comprobarSolapeEnTresVistas();
  });

  /** Ola final v0.2b4 -- I1: el indicador vive fuera de <main>, encima de la partida. Tocarlo
   * mientras se juega la abandonaba: en 'en-curso' abría la espera (y el "←" de ahí desmontaba el
   * mazo) y en 'lista' arrancaba OTRA partida encima. Ruling del controlador: desde
   * `pregunta`/`repaso` el toque no hace nada; desde el HUB sigue funcionando igual que siempre. */
  test('v0.2b4 §2 (I1): tocar el indicador durante una partida no la abandona; el aviso de tanda lista no se enseña durante la partida y sí fuera', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const indicador = page.locator('[data-test="indicador-tanda"]');
    const texto = page.locator('[data-test="indicador-tanda-texto"]');

    // (a) 'en-curso' desde `repaso`: el toque no navega (el primer sondeo del mock dice "generando").
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    await page.locator('[data-test="atomo-repasar-mientras"]').click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await expect(texto).toHaveText(/^0 de 10/);
    await indicador.click();
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeHidden();

    // (b) tanda lista con una partida a medias: el aviso no se enseña (pulsarlo la abandonaría).
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    const contadorAntes = await tarjetaActual(page).locator('[data-test="mazo-contador"]').textContent();

    await expect.poll(() => page.evaluate(() => localStorage.getItem('one.avisoGeneradas')), { timeout: 13000 }).not.toBeNull();
    await expect(indicador).toBeHidden();
    await expect(avisoGeneradas(page)).toBeHidden();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    // Sigue siendo LA MISMA partida (el contador no se ha reiniciado a "0/10" de otra tanda).
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText(contadorAntes);

    // Fuera de la partida (HUB) el aviso espera ahí y tocarlo arranca la tanda.
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(avisoGeneradas(page)).toContainText('· 10');
    await jugarAviso(page).click();
    await expect(avisoGeneradas(page)).toBeHidden();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
  });

  /** v0.2b4.1 §6: `hechas` avanza por pregunta verificada, así que el indicador puede enseñar
   * cualquier número de 1 a 10 -- no solo 0, 5 y 10 como en v0.2b4 (donde subía de lote en lote).
   * El servidor falso devuelve 3 y luego 7 para demostrar los dos que antes eran imposibles. */
  function servidorTandaFinaFalso({ contadores = {} } = {}) {
    let sondeos = 0;
    const suma = (clave) => { contadores[clave] = (contadores[clave] || 0) + 1; };
    const pasos = [
      { estado: 'generando', hechas: 3, preguntas: [] },
      { estado: 'generando', hechas: 7, preguntas: [] },
    ];
    return conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"preguntas":[],"enCola":0,"actualizadas":[]}' });
        return;
      }
      if (url.pathname === '/subtemas') {
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ subtemas: [{ indice: 0, corto: 'Mercados', completo: 'Mercados y crisis' }] }),
        });
        return;
      }
      if (url.pathname === '/generar') {
        suma('generar');
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ trabajoId: 'tanda-fina-1', enCola: 0, estimadoSeg: 40, segundosPorPregunta: 4 }),
        });
        return;
      }
      if (url.pathname === '/trabajo/tanda-fina-1') {
        suma('trabajo');
        const paso = pasos[sondeos] || null;
        sondeos += 1;
        const cuerpo = paso
          ? { ...paso, pedidas: 10, motivo: null, segundosPorPregunta: 4 }
          : {
              estado: 'lista', hechas: 10, pedidas: 10, motivo: null, segundosPorPregunta: 4,
              preguntas: Array.from({ length: 10 }, (_, i) => preguntaServidor(`srv-fina-${i + 1}`)),
            };
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(cuerpo) });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
  }

  test('v0.2b4.1 §6: el indicador enseña "3 de 10" (progreso por pregunta, no por lote de 5)', async ({ page }) => {
    test.setTimeout(45000);
    const contadores = {};
    await page.route(`${URL_SERVIDOR}/**`, servidorTandaFinaFalso({ contadores }));

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();

    const texto = page.locator('[data-test="indicador-tanda-texto"]');
    await expect(texto).toHaveText(/^3 de 10 · ~/, { timeout: 12000 });
    await page.screenshot({ path: `${CAPTURAS}/v0.2b4.1-indicador-3-de-10-375.png` });
    await expect(texto).toHaveText(/^7 de 10 · ~/, { timeout: 12000 });
    await esperarAvisoTrasEspera(page, 15000);
    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
  });

  /** Ola final v0.2b4.1 (C1): el servidor pone un trabajo URGENTE en 'parcial' entre sus dos lotes
   * de 5 (servidor/cola.js#procesarCola: `siguiente.estado = siguiente.preguntas.length > 0 ?
   * 'parcial' : 'generando'` cuando el trabajo continúa). Con la lista de estados "en curso" del
   * cliente ('en-cola'/'generando') ese 'parcial' se leía como TERMINAL y la app cerraba la tanda
   * con las 5 que hubiera -- medido en vivo el 15-sep: "Tanda lista · 4" mientras el servidor
   * seguía y acabó con 8. Solo 'lista'/'fallida' (o `hechas >= pedidas`) son terminales. */
  function servidorTandaParcialFalso() {
    let sondeos = 0;
    const pregunta = (i) => preguntaServidor(`srv-parcial-${i + 1}`);
    return conPreflight(async (route, req) => {
      const url = new URL(req.url());
      if (url.pathname === '/estado') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"preguntas":[],"enCola":0,"actualizadas":[]}' });
        return;
      }
      if (url.pathname === '/subtemas') {
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ subtemas: [{ indice: 0, corto: 'Mercados', completo: 'Mercados y crisis' }] }),
        });
        return;
      }
      if (url.pathname === '/generar') {
        await route.fulfill({
          status: 200, contentType: 'application/json', headers: CORS,
          body: JSON.stringify({ trabajoId: 'tanda-parcial-1', enCola: 0, estimadoSeg: 40, segundosPorPregunta: 4 }),
        });
        return;
      }
      if (url.pathname === '/trabajo/tanda-parcial-1') {
        // Primer sondeo: 'parcial' a mitad (5 de 10) -- el lote 1 acabó con algún fallo y el
        // trabajo SIGUE. Del segundo en adelante: 'parcial' ya completo (10 de 10), terminal.
        const primero = sondeos === 0;
        sondeos += 1;
        const cuerpo = primero
          ? { estado: 'parcial', hechas: 5, pedidas: 10, motivo: null, segundosPorPregunta: 4, preguntas: Array.from({ length: 5 }, (_, i) => pregunta(i)) }
          : { estado: 'parcial', hechas: 10, pedidas: 10, motivo: null, segundosPorPregunta: 4, preguntas: Array.from({ length: 10 }, (_, i) => pregunta(i)) };
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(cuerpo) });
        return;
      }
      await route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
  }

  test('v0.2b4.1 (C1): un "parcial" a mitad (5 de 10) NO cierra la tanda; se cierra al llegar a 10', async ({ page }) => {
    test.setTimeout(45000);
    await page.route(`${URL_SERVIDOR}/**`, servidorTandaParcialFalso());

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();

    const texto = page.locator('[data-test="indicador-tanda-texto"]');
    // Con el bug: aquí ya se anunciaba una tanda de 5 y el sondeo se paraba para siempre.
    await expect(texto).toHaveText(/^5 de 10 · ~/, { timeout: 12000 });
    await esperarAvisoTrasEspera(page, 15000);
    await assertSinScroll(page);
  });

  test('v0.2b4 §2: el chip "tanda-lista" del HUB ya no existe (una sola señal)', async ({ page }) => {
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="tanda-lista"]')).toHaveCount(0);
  });

  test('v0.2b4 §5: el nodo de paginación dice "Regenerar temas" y el mensaje de agotado no cambia', async ({ page }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await abrirAtomoDesdeHub(page, 'economia');
    const mas = page.locator('[data-test="atomo-mas"]');
    await expect(mas).toBeVisible();
    // Ola final v0.2b4 (M10): el texto se parte en un <tspan> por línea (atomo.js#pintarLineas) y
    // los tspan se crean sin nada entre medias, así que el `textContent` crudo viene PEGADO. La
    // aserción anterior comparaba con esa cadena pegada ('Regenerartemas'), que no es texto de
    // producto: dice tanto del reparto en líneas como del texto, y habría que reescribirla si el
    // salto cayera en otro sitio. Se compara la frase que de verdad lee el jugador: cada línea
    // normalizada y unidas por un espacio.
    await expect
      .poll(() =>
        mas.evaluate((n) =>
          [...n.querySelectorAll('tspan')]
            .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' ')
        )
      )
      .toBe('Regenerar temas');
    // Ola final v0.2b4 (concern 5): el `aria-label` se quedó en "Más subtemas" del nombre anterior,
    // así que un lector de pantalla anunciaba una cosa y el nodo decía otra. Debe coincidir con lo
    // que se lee, sobre todo aquí: el texto visible va partido en <tspan>, y el nombre accesible es
    // lo único que suena entero.
    await expect(mas).toHaveAttribute('aria-label', 'Regenerar temas');
    await assertHojaSinScroll(page);
  });

  /** Servidor falso para el caso "iOS recarga la PWA a mitad de tanda" (spec v0.2b4 §1): el mismo
   * `trabajoId` sobrevive a la recarga, y /trabajo/:id responde "generando 5 de 10" hasta el
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
            body: JSON.stringify({ estado: 'generando', hechas: 5, pedidas: 10, preguntas: [], motivo: null, segundosPorPregunta: 4 }),
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

  test('v0.2b4 §1: recargar a mitad de tanda retoma el sondeo y acaba en el aviso «Preguntas generadas»', async ({ page }) => {
    const contadores = {};
    await page.route(`${URL_SERVIDOR}/**`, servidorTandaFalso({ contadores, sondeosAntesDeTerminar: 3 }));

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();

    const indicador = page.locator('[data-test="indicador-tanda"]');
    const texto = page.locator('[data-test="indicador-tanda-texto"]');
    await expect(indicador).toBeVisible();
    await expect(texto).toHaveText(/^5 de 10 · ~/, { timeout: 8000 });
    await page.screenshot({ path: `${CAPTURAS}/v0.2b4-indicador-375.png` });

    // La tanda está persistida ANTES de recargar (spec §1, clave one.atomoTrabajo).
    const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem('one.atomoTrabajo') || 'null'));
    expect(guardada.id).toBe('tanda-recarga-1');
    expect(guardada.pedidas).toBe(10);
    expect(guardada.corto).toBe('Economía');
    const sondeosAntes = contadores.trabajo;

    // Exactamente lo que hace iOS al cambiar de app o bloquear el móvil.
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    // Sin tocar nada: el indicador sigue ahí y el sondeo se ha reanudado solo.
    await expect(indicador).toBeVisible();
    // Extra (hallazgo Minor diferido de tareas anteriores): reanudar NO debe pasar por ningún
    // texto de fallo (mostrarIndicadorTandaFallida) -- sería una regresión silenciosa de
    // reanudarTandaGuardada/idsUtilizablesDeTanda (ver brief §Step 2, el fallo típico ahí).
    await expect(texto).not.toHaveText(/No se pudo generar|La tanda se perdió|El servidor tarda demasiado/);
    await expect.poll(() => contadores.trabajo, { timeout: 8000 }).toBeGreaterThan(sondeosAntes);

    await expect(avisoGeneradas(page)).toContainText('· 10', { timeout: 13000 });
    await expect(indicador).toBeHidden();
    await page.screenshot({ path: `${CAPTURAS}/v0.2b4-indicador-lista-375.png` });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await jugarAviso(page).click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
    // Estado terminal ya mostrado: la clave se limpia (spec §1) -- y NO reaparece al jugar la tanda.
    expect(await page.evaluate(() => localStorage.getItem('one.atomoTrabajo'))).toBe(null);
  });

  /** Ola final v0.2b4 -- Critical C2: un corte de red de UN SOLO sondeo no puede matar la tanda.
   * Antes `consultarTrabajo` devolvía `null` igual para un 404 que para la red caída, y
   * `sondearTrabajoAtomo` lo trataba siempre como "el trabajo ya no existe": paraba el sondeo,
   * borraba `one.atomoTrabajo` y mentía con "La tanda se perdió, genera otra". Aquí se aborta
   * exactamente el 3.er sondeo (`internetdisconnected`, lo que pasa al salir de cobertura) y se
   * comprueba que el indicador sigue en curso, la clave sigue guardada y el sondeo siguiente
   * continúa hasta el aviso «Preguntas generadas». */
  test('v0.2b4 §1: un sondeo con la red caída NO borra la tanda ni para el sondeo (C2)', async ({ page }) => {
    // Cinco sondeos reales a 5 s cada uno: no cabe en el timeout por defecto de 30 s.
    test.setTimeout(60000);
    const contadores = {};
    let sondeos = 0;
    // Un ÚNICO manejador (su contador interno de sondeos es una clausura: recrearlo en cada
    // petición lo reiniciaría y el trabajo no llegaría nunca a "lista"). Con el 3.er sondeo
    // abortado, el manejador solo ve 4 de los 5: termina en el 5.º sondeo real.
    const servidor = servidorTandaFalso({ contadores, sondeosAntesDeTerminar: 4 });
    await page.route(`${URL_SERVIDOR}/**`, async (route) => {
      const peticion = route.request();
      const url = new URL(peticion.url());
      if (url.pathname === '/trabajo/tanda-recarga-1' && peticion.method() !== 'OPTIONS') {
        sondeos += 1;
        if (sondeos === 3) {
          await route.abort('internetdisconnected');
          return;
        }
      }
      await servidor(route);
    });

    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();

    const indicador = page.locator('[data-test="indicador-tanda"]');
    const texto = page.locator('[data-test="indicador-tanda-texto"]');
    await expect(texto).toHaveText(/^5 de 10 · ~/, { timeout: 8000 });

    // Se espera a que el 3.er sondeo (el abortado) haya ocurrido de verdad.
    await expect.poll(() => sondeos, { timeout: 15000 }).toBeGreaterThanOrEqual(3);

    // Nada de "La tanda se perdió": el indicador sigue en curso y la clave sigue ahí.
    await expect(indicador).toBeVisible();
    await expect(texto).not.toHaveText(/La tanda se perdió|No se pudo generar|Sin conexión/);
    const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem('one.atomoTrabajo') || 'null'));
    expect(guardada && guardada.id).toBe('tanda-recarga-1');

    // Y el sondeo siguiente (ya con red) continúa hasta el final.
    await esperarAvisoTrasEspera(page, 25000);
  });

  // Ola final v0.2b4 (M4): una tanda guardada sin configuración de servidor no se puede sondear
  // (no hay a quién preguntar). Antes se pintaba el indicador y se arrancaba un intervalo de 5 s
  // condenado a no averiguar nunca nada; ahora la clave huérfana se limpia al arrancar.
  test('v0.2b4 §1 (M4): una tanda guardada sin configuración de servidor se descarta al arrancar', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'one.atomoTrabajo',
        JSON.stringify({ id: 'tanda-huerfana-1', corto: 'Economía', inicio: Date.now(), pedidas: 10 })
      );
    });
    await page.goto('/?test=1'); // sin ?servidor=&token=: no hay configuración guardada
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="indicador-tanda"]')).toBeHidden();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('one.atomoTrabajo'))).toBe(null);
  });

  test('v0.2b4: captura del nodo "Regenerar temas"', async ({ page }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);

    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo-mas"]')).toBeVisible();
    await page.screenshot({ path: `${CAPTURAS}/v0.2b4-atomo-regenerar-375.png` });
    await assertHojaSinScroll(page);
  });

  test('v0.3: «Generar preguntas» desde el aviso pide la tanda de ESA ruta; al llegar, el índice la apunta y Clásico la juega con el filtro', async ({ page }) => {
    const peticiones = [];
    const servidor = servidorAtomoFalso(); // UNA instancia: su contador de sondeos debe avanzar (generando → lista)
    await page.route(`${URL_SERVIDOR}/**`, async (route) => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/generar') peticiones.push(route.request().postDataJSON());
      await servidor(route);
    });
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ clasico: { area: 'economia', ruta: ['Mercados y crisis financieras'], etiquetas: ['Mercados y crisis'] } }));
    });
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeEnabled();
    await page.locator('[data-test="filtro-corto-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();
    expect(peticiones[0]).toMatchObject({ area: 'economia', ruta: ['Mercados y crisis financieras'] });
    await expect(page.locator('[data-test="atomo-espera-resultado"]')).toHaveText('Jugar la tanda', { timeout: 13000 });
    const indice = await page.evaluate(() => JSON.parse(localStorage.getItem('one.indiceRutas')));
    expect(indice['["economia",["Mercados y crisis financieras"]]']).toHaveLength(10);
    await page.locator('[data-test="volver"]').click();
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Economía · Mercados y crisis');
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
  });

  // --- v0.3.4 A: acceso a lo generado (fila «Tus temas» del hub y sección «Generados» de la hoja del filtro) ---

  /** Siembra 9 temas generados (de 3 en 3 preguntas, en 4 áreas) en el índice, sus etiquetas y el banco extra. El último
   * del índice (el 9.º) es el más reciente. Con 9 chips la fila no cabe en 375 px: obliga al scroll horizontal. */
  const TEMAS_SEMBRADOS = [
    ['economia', 'Mercados y crisis financieras', 'Mercados'], ['historia', 'Roma antigua y su imperio', 'Roma'],
    ['ciencia', 'Física cuántica y relatividad', 'Cuántica'], ['geografia', 'Ríos y cuencas del mundo', 'Ríos'],
    ['economia', 'Comercio internacional y aranceles', 'Comercio'], ['historia', 'Grecia clásica', 'Grecia'],
    ['ciencia', 'Genética y evolución', 'Genética'], ['geografia', 'Cordilleras y volcanes', 'Volcanes'],
    ['historia', 'Las guerras mundiales', 'Guerras mundiales'],
  ];
  async function sembrarTemasGenerados(page) {
    await page.addInitScript((temas) => {
      const indice = {};
      const etiquetas = {};
      const extra = [];
      temas.forEach(([area, completo, corto], i) => {
        const clave = JSON.stringify([area, [completo]]);
        const ids = [0, 1, 2].map((j) => `srv-tema-${i}-${j}`);
        indice[clave] = ids;
        etiquetas[clave] = [corto];
        ids.forEach((id) => extra.push({ id, area, tipo: 'vf', nivel: 1, enunciado: `Enunciado de prueba (${id}).`, explicacion: 'Explicación de prueba.', respuesta: true }));
      });
      localStorage.setItem('one.indiceRutas', JSON.stringify(indice));
      localStorage.setItem('one.etiquetasRutas', JSON.stringify(etiquetas));
      localStorage.setItem('one.bancoExtra', JSON.stringify(extra));
    }, TEMAS_SEMBRADOS);
  }

  test('v0.3.4: sin temas generados la fila «Tus temas» no ocupa sitio; tras una tanda aparece en el hub y tocar el chip abre Clásico con ese filtro', async ({ page }) => {
    const servidor = servidorAtomoFalso();
    await page.route(`${URL_SERVIDOR}/**`, servidor);
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ clasico: { area: 'economia', ruta: ['Mercados y crisis financieras'], etiquetas: ['Mercados y crisis'] } }));
    });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="tus-temas"]')).toBeHidden();
    expect(await page.locator('[data-test="tus-temas"]').evaluate((n) => n.getBoundingClientRect().height)).toBe(0);

    await page.locator('[data-test="modo-clasico"]').click();
    await page.locator('[data-test="filtro-corto-generar"]').click();
    await expect(page.locator('[data-test="atomo-espera-resultado"]')).toHaveText('Jugar la tanda', { timeout: 13000 });
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const chips = page.locator('[data-test="tus-temas"] [data-test="tema-generado"]');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveText('Mercados y crisis · 10');
    await expect(chips.first()).toHaveAttribute('title', 'Economía · Mercados y crisis');
    await expect(avisoGeneradas(page)).toBeVisible(); // el aviso grande de la tanda tapa la parte baja del hub hasta que se cierra (✕ o 20 s)
    await page.locator('[data-test="aviso-generadas-cerrar"]').click();
    await expect(avisoGeneradas(page)).toBeHidden();
    for (const vp of [{ width: 375, height: 667 }, { width: 430, height: 932 }]) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
    }
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: `${CAPTURAS}/v0.3.4-tus-temas-375x667.png` });

    await chips.first().click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Economía · Mercados y crisis');
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/10');
  });

  test('v0.3.4: con 9 temas la fila hace scroll horizontal, el más reciente va primero y el hub no scrollea en 375×667 ni 430×932', async ({ page }) => {
    await sembrarTemasGenerados(page);
    await page.goto('/?test=1');
    const chips = page.locator('[data-test="tus-temas"] [data-test="tema-generado"]');
    await expect(chips).toHaveCount(9);
    await expect(chips.first()).toHaveText('Guerras mundiales · 3');
    await expect(chips.last()).toHaveText('Mercados · 3');
    for (const vp of [{ width: 375, height: 667 }, { width: 430, height: 932 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
      const fila = await page.locator('[data-test="tus-temas"] .temas-fila').evaluate((n) => ({ ancho: n.scrollWidth, visible: n.clientWidth, alto: n.scrollHeight, altoVisible: n.clientHeight }));
      expect(fila.ancho).toBeGreaterThan(fila.visible); // la fila no cabe: se desliza
      expect(fila.alto).toBeLessThanOrEqual(fila.altoVisible + 1); // y nunca en vertical
      const cajas = await page.evaluate(() => ({
        modosAbajo: document.querySelector('[data-test="hub-modos"]').getBoundingClientRect().bottom,
        temasArriba: document.querySelector('[data-test="tus-temas"]').getBoundingClientRect().top,
        temasAbajo: document.querySelector('[data-test="tus-temas"]').getBoundingClientRect().bottom,
        pieArriba: document.querySelector('.hub-pie').getBoundingClientRect().top,
      }));
      expect(cajas.temasArriba).toBeGreaterThanOrEqual(cajas.modosAbajo - 1); // la fila va bajo las tarjetas
      expect(cajas.temasAbajo).toBeLessThanOrEqual(cajas.pieArriba + 1); // y sobre el pie, sin pisarlo
    }
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: `${CAPTURAS}/v0.3.4-tus-temas-9-375x667.png` });
    await chips.nth(6).click(); // el 7.º más reciente es el 3.º sembrado: Cuántica
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Ciencia · Cuántica');
  });

  test('v0.3.4: «Generados» abre la hoja del filtro de Clásico y de Órdago, fija el filtro del modo y no sale en Más o menos', async ({ page }) => {
    await sembrarTemasGenerados(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await abrirHojaFiltro(page);
    const generados = page.locator('[data-test="filtro-generados"]');
    await expect(generados).toBeVisible();
    await expect(generados.locator('[data-test="tema-generado"]')).toHaveCount(9);
    const cajas = await page.evaluate(() => ({
      generados: document.querySelector('[data-test="filtro-generados"]').getBoundingClientRect().bottom,
      todos: document.querySelector('[data-test="filtro-todos"]').getBoundingClientRect().top,
    }));
    expect(cajas.generados).toBeLessThanOrEqual(cajas.todos); // «Generados» arriba, TODOS y las áreas debajo
    await assertHojaSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.3.4-filtro-generados-375x667.png` });
    await generados.locator('[data-test="tema-generado"]', { hasText: 'Roma' }).click();
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Historia · Roma');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.filtros')).clasico)).toEqual({ area: 'historia', ruta: ['Roma antigua y su imperio'], etiquetas: ['Roma'] });
    await abrirHojaFiltro(page); // reabrir: el tema puesto sale marcado
    await expect(generados.locator('[data-test="tema-generado"][aria-pressed="true"]')).toHaveText('Roma · 3');
    await page.locator('[data-test="filtro-cerrar"]').click();

    // Órdago: otra hoja, otro filtro (el de Clásico no se toca).
    await page.locator('[data-test="volver"]').click();
    await page.locator('[data-test="modo-ordago"]').click();
    await abrirHojaFiltro(page);
    await expect(generados.locator('[data-test="tema-generado"][aria-pressed="true"]')).toHaveCount(0);
    await generados.locator('[data-test="tema-generado"]', { hasText: 'Volcanes' }).click();
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    const filtros = await page.evaluate(() => JSON.parse(localStorage.getItem('one.filtros')));
    expect(filtros.ordago).toEqual({ area: 'geografia', ruta: ['Cordilleras y volcanes'], etiquetas: ['Volcanes'] });
    expect(filtros.clasico.etiquetas).toEqual(['Roma']);

    // Más o menos filtra por área y juega cifras: ahí no hay temas que fijar.
    await page.locator('[data-test="volver"]').click();
    await page.locator('[data-test="modo-masomenos"]').click();
    await abrirHojaFiltro(page);
    await expect(page.locator('[data-test="filtro-todos"]')).toBeVisible();
    await expect(generados).toHaveCount(0);
  });

  test('v0.3: chip → Economía → nodo del anillo → Elegir: hoja cerrada y chip con el nodo (listeners vivos en la superposición)', async ({ page }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoFalso());
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await page.locator('[data-test="modo-clasico"]').click();
    await abrirHojaFiltro(page);
    await elegirAreaEnFiltro(page, 'economia');
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);
    await page.locator('[data-test="atomo-nodo"]').first().click();
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados y crisis');
    await page.locator('[data-test="filtro-elegir"]').click();
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Economía · Mercados y crisis');
    await expect(page.locator('[data-vista="filtro-corto"]')).toBeVisible(); // subtema nunca generado: 0 preguntas
    // Reabrir: la hoja vuelve al nivel de áreas y sus botones siguen respondiendo.
    await abrirHojaFiltro(page);
    await page.locator('[data-test="filtro-todos"]').click();
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
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

    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4); // página 1 del anillo 1
    await expect(page.locator('[data-test="atomo-mas"]')).toBeVisible();

    await page.screenshot({ path: `${CAPTURAS}/v0.2b3-atomo-mas-375.png` });
    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertHojaSinScroll(page);
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

    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertHojaSinScroll(page);
  });

  test('"Más…" agotado: "No hay más por ahora" 2s y vuelve a "Más…"', async ({ page }) => {
    const cuerpos = [];
    await page.route(`${URL_SERVIDOR}/**`, servidorAtomoV3Falso({ cuerpos }));
    await page.goto(`/?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`);
    await abrirAtomoDesdeHub(page, 'economia');
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
    await abrirAtomoDesdeHub(page, 'economia');
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

  test('anillo cargando: nodos de espera y un toque durante la carga no cambia la ruta', async ({
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
    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(4);

    await page.locator('[data-test="atomo-nodo"]').first().click(); // dispara la carga retrasada 3s

    // Todo esto debe ser cierto YA (brief: "en < 500 ms"), sin esperar los 3s del mock.
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados', { timeout: 500 });
    await expect(page.locator('[data-test="atomo-esperando"]')).toHaveCount(6, { timeout: 500 });
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(0, { timeout: 500 });

    await page.screenshot({ path: `${CAPTURAS}/v0.2b3-atomo-esperando-375.png` });
    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });

    // Un toque sobre un nodo de espera no hace nada: la ruta sigue igual.
    await page.locator('[data-test="atomo-esperando"]').first().click({ force: true });
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Economía › Mercados');

    // Resuelve el retraso: llegan los subtemas reales.
    resolverRetraso();
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(2);
    await expect(page.locator('[data-test="atomo-esperando"]')).toHaveCount(0);
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

    // Solo lleva `?test=1` (para el gancho que abre el átomo): comprueba que `location.search` no gana
    // nada tras conectar (el enlace se pegó en un <input>, nunca tocó la barra de direcciones).
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();

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
    expect(await page.evaluate(() => location.search)).toBe('?test=1');

    // El anillo se recarga con la configuración recién guardada: ya no "sin servidor".
    await expect(page.locator('[data-test="atomo-nodo"]')).toHaveCount(1);
    await expect(page.locator('[data-test="atomo-ayuda"]')).toHaveText(
      'Toca un tema para concretar; «Elegir» fija el filtro'
    );

    // El "Conectado" desaparece solo, a los 2s (mismo mecanismo que mostrarAvisoHub).
    await expect(page.locator('[data-test="conectar-hecho"]')).toBeHidden({ timeout: 3000 });
  });

  // Revisión combinada (Tarea 4): Carlos aterriza en el HUB al abrir la app instalada, así que el
  // punto de estado de ahí (en el pie) también debe abrir la hoja -- no solo el gemelo
  // dentro del Átomo, que exige un paso extra (abrir el átomo de un área) para llegar a él.
  test('abrir la hoja también desde el punto de estado del HUB (en el pie), sin pasar por el Átomo', async ({
    page,
  }) => {
    await page.route(`${URL_SERVIDOR}/**`, servidorConectarFalso());

    await page.goto('/');
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
    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();

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
    await abrirAtomoDesdeHub(page, 'economia');
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();

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

// ============================================================================
// Tarea 2 del plan v0.2a2-protagonismo-visual (spec §8, enmienda 16-sep-2026):
// estructura fija de la tarjeta REVELADA (partida respondida y repaso, spec
// §8 punto 1) con la visual como protagonista, garantizada en las tres capas
// de la Tarea 1 (imagen -> fórmula dibujada -> color del área, fase 7). Consume el mismo banco de ejemplo que "ONE ·
// visuales v0.1e" (datos/visuales.ejemplo.json + datos/imagenes.ejemplo.json)
// para tener las tres capas bajo control, sin depender de qué traiga el
// banco real en cada momento.
// ============================================================================
test.describe('ONE · protagonismo visual (spec §8, v0.2a.2 — Tarea 2)', () => {
  /** Inyecta tres preguntas vf sintéticas, una por capa (imagen forzada,
   * visual de datos del banco de ejemplo, y una tercera SIN imagen ni
   * `visual` para que caiga en el color del área) — ids sufijados para
   * no chocar entre viewports que comparten el mismo `page` de test en test.
   * Las tres son `respuesta: true`: el test las falla A PROPÓSITO
   * (vf-falso) para que las tres entren en `repasoPartida` (app.js:
   * `respondidas.filter((h) => !h.correcta || h.delta.fragil)`) y aparezcan
   * también en el carrusel de resumen — si se acertaran, ArrowUp desde la
   * tarjeta de cifras no tendría a dónde ir (hallazgo real al verificar este
   * test en vivo: con las tres acertadas, repasoPartida quedaba vacío y el
   * mazo de resumen solo tenía 1 tarjeta). */
  async function inyectarTresCapas(page, sufijo) {
    const [visualesEjemplo, imagenesEjemplo] = await Promise.all([
      page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json())),
      page.evaluate(() => fetch('datos/imagenes.ejemplo.json').then((r) => r.json())),
    ]);

    const idImagen = `pv-imagen-${sufijo}`;
    const idVisual = `pv-visual-${sufijo}`;
    const idClave = `pv-clave-${sufijo}`;

    const preguntaImagen = { ...visualesEjemplo.formula, id: idImagen };
    const preguntaVisual = { ...visualesEjemplo.formula, area: 'ciencia', id: idVisual };
    // Copia de "formula" SIN su `visual` (ni imagen forzada): cae en el color
    // del área por las dos primeras faltando de verdad, no porque se ignoren.
    const { visual: _visualDescartado, ...preguntaClaveSinVisual } = visualesEjemplo.formula;
    const preguntaClave = { ...preguntaClaveSinVisual, id: idClave };

    const imagenForzada = { ...imagenesEjemplo['his-001'], id: idImagen };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaImagen);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenForzada);
    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaVisual);
    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaClave);

    return { idImagen, idVisual, idClave };
  }

  /** Geometría + contenido de la tarjeta ACTUAL para una `capa` dada
   * ('imagen'/'visual'/'clave'): sin scroll (assertTarjetaSinScroll ya cubre
   * el desborde geométrico de `.zona-imagen`, spec §8 hallazgo C1 de v0.1e),
   * `.zona-imagen` mide entre el 50 % y el 60 % de la TARJETA ENTERA (spec
   * v0.2a.2.1 §1.1.1 -- el margen de 1px cubre redondeo de
   * getBoundingClientRect/clientHeight), su borde superior coincide con el
   * inferior de `.pregunta-cabecera` ± 12px (Ruling R8: el gap real es
   * 8-10px según si la tarjeta lleva dataset.respondida="true" o es la
   * "neutra" del repaso sin responder, R2 de la Tarea 2), y la capa que
   * corresponde está visible dentro. */
  async function comprobarCapaProtagonista(page, capa) {
    await esperarAsentamientoMazo(page);
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);

    const medidas = await page.evaluate(() => {
      const tarjeta = document.querySelector('.tarjeta-mazo--actual');
      const contenido = tarjeta ? tarjeta.querySelector('.tarjeta-contenido') : null;
      const zona = contenido ? contenido.querySelector('.zona-imagen') : null;
      const cabecera = contenido ? contenido.querySelector('.pregunta-cabecera') : null;
      if (!zona || !cabecera) return null;
      const rectZona = zona.getBoundingClientRect();
      const rectCabecera = cabecera.getBoundingClientRect();
      return {
        zonaAlto: rectZona.height,
        tarjetaAlto: tarjeta.getBoundingClientRect().height,
        topZona: rectZona.top,
        bottomCabecera: rectCabecera.bottom,
      };
    });
    expect(medidas, '.zona-imagen o .pregunta-cabecera no están en la tarjeta actual').not.toBeNull();
    expect(
      medidas.zonaAlto / medidas.tarjetaAlto,
      `.zona-imagen mide ${medidas.zonaAlto}px de ${medidas.tarjetaAlto}px de tarjeta`
    ).toBeGreaterThanOrEqual(0.5 - 1 / medidas.tarjetaAlto);
    expect(medidas.zonaAlto / medidas.tarjetaAlto).toBeLessThanOrEqual(0.6 + 1 / medidas.tarjetaAlto);
    expect(
      Math.abs(medidas.topZona - medidas.bottomCabecera),
      `top de .zona-imagen (${medidas.topZona}) se aleja > 12px del bottom de .pregunta-cabecera (${medidas.bottomCabecera})`
    ).toBeLessThanOrEqual(12);

    const t = tarjetaActual(page);
    if (capa === 'imagen') await expect(t.locator('[data-test="imagen"]')).toBeVisible();
    else if (capa === 'visual') await expect(t.locator('[data-test="visual"]')).toBeVisible();
    else await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
  }

  const VIEWPORTS = [
    { width: 375, height: 812, nombre: '375' },
    { width: 393, height: 852, nombre: '393', zonaSegura: true },
    { width: 430, height: 932, nombre: '430' },
  ];

  for (const vp of VIEWPORTS) {
    test(`estructura fija a ${vp.nombre}×${vp.height}: imagen/fórmula/color del área protagonizan sin scroll, en partida y en repaso`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Geometría determinista: sin esto, medir justo tras responder puede
      // pillar la entrada de la visual (visual-entra, spec §8, 220ms) a
      // mitad de camino y el top de .zona-imagen sale unos px más abajo de
      // su posición final (hallazgo real al verificar este test en vivo).
      // De paso ejercita la regla de estilos.css que anula esa animación
      // bajo "reducir movimiento".
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/?ejemplo=1&test=1');
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      if (vp.zonaSegura) {
        // Mismas zonas seguras reales de un iPhone que "C1 visual desbordado
        // con zonas seguras del iPhone" más arriba: env(safe-area-inset-*)
        // vale 0 en Chromium headless, así que se inyecta el mismo padding.
        await page.addStyleTag({
          content: '.cabecera { padding-top: 59px !important; } body { padding-bottom: 34px !important; }',
        });
      }

      const { idImagen, idVisual, idClave } = await inyectarTresCapas(page, vp.nombre);
      await page.evaluate(
        (ids) => window.__one.empezarPartida({ ids, etiqueta: `pv-${ids[0]}` }),
        [idImagen, idVisual, idClave]
      );

      // --- partida: las tres, en orden, cada una recién revelada al
      // responder. Falladas a propósito (vf-falso, las tres son
      // respuesta:true): así entran en repasoPartida y aparecen también en
      // el resumen de abajo — ver el porqué en inyectarTresCapas. ---
      const capas = ['imagen', 'visual', 'clave'];
      for (const capa of capas) {
        const t = tarjetaActual(page);
        await t.locator('[data-test="vf-falso"]').click();
        await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
        await comprobarCapaProtagonista(page, capa);
        if (vp.nombre === '375' && capa === 'imagen') {
          // Captura nombrada por el brief de la Tarea 2 (mirada con Read
          // antes de commitear, ver task-2-report.md).
          await page.screenshot({ path: `${CAPTURAS}/v0.2a2-partida-375.png` });
        }
        await avanzarTrasRespuesta(page); // la 3ª termina la partida -> resumen.
      }

      // --- repaso: el mazo de resumen reutiliza construirTarjetaRepaso con
      // las MISMAS tres tarjetas, en el mismo orden (repasoPartida). ---
      await expect(page.locator('[data-test="resumen"]')).toBeVisible();
      await assertSinScroll(page);

      for (const capa of capas) {
        await page.keyboard.press('ArrowUp');
        await esperarAsentamientoMazo(page);
        const tRepaso = tarjetaActual(page);
        await expect(tRepaso).toHaveAttribute('data-test', 'repaso-tarjeta');

        // La marca de repaso vive DENTRO de .pregunta-cabecera (spec §8: "la
        // cabecera con nivel y la marca de repaso se funden en la misma
        // línea"), ya no como <p> aparte tras ella.
        const marcaEnCabecera = await tRepaso.evaluate((tarjeta) => {
          const marca = tarjeta.querySelector('.repaso-marca');
          return Boolean(marca && marca.parentElement && marca.parentElement.classList.contains('pregunta-cabecera'));
        });
        expect(marcaEnCabecera, 'la .repaso-marca no está dentro de .pregunta-cabecera').toBe(true);

        await comprobarCapaProtagonista(page, capa);
        if (vp.nombre === '375' && capa === 'clave') {
          // Segunda captura nombrada por el brief de la Tarea 2.
          await page.screenshot({ path: `${CAPTURAS}/v0.2a2-repaso-clave-375.png` });
        }
      }
    });
  }

  // R2 de la Tarea 2: la tarjeta ACTIVA sin responder (construirTarjetaSinResponder,
  // dataset.respondida="false") es la ÚNICA que NO lleva tarjeta--revelada —
  // spec §8 solo aplica a la tarjeta ya revelada (respondida en la partida y
  // toda tarjeta del repaso, incluida la "sin responder" de ese tramo, que SÍ
  // la lleva por reutilizar construirTarjetaRespondida).
  test('la tarjeta ACTIVA sin responder no lleva tarjeta--revelada ni tarjeta--recien-revelada', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();

    const t = tarjetaActual(page);
    await expect(t).toHaveAttribute('data-respondida', 'false');
    await expect(t).not.toHaveClass(/tarjeta--revelada/);
    await expect(t).not.toHaveClass(/tarjeta--recien-revelada/);

    // Al responder, la tarjeta se RECONSTRUYE (manejarRespuesta): la nueva sí
    // las lleva — revelada siempre, recién-revelada por ser la partida.
    // responderPreguntaActual (no un click suelto): "ordenar" necesita CUATRO
    // toques para enviar la respuesta, no uno — un solo click ahí habría
    // dejado la tarjeta activa sin responder de verdad (hallazgo real al
    // verificar este test en vivo, con una pregunta "ordenar" al azar).
    await responderPreguntaActual(page);
    const tRevelada = tarjetaActual(page);
    await expect(tRevelada).toHaveClass(/tarjeta--revelada/);
    await expect(tRevelada).toHaveClass(/tarjeta--recien-revelada/);
  });

  // Barrido del banco REAL completo (295 preguntas, spec §8 "Verificación"):
  // con ?test=1, abrir el repaso (todas sin responder de fábrica) y recorrer
  // el hook window.__one.irA ya existente (mismo mecanismo que las suites
  // "ronda final de revisión de rendimiento" de más arriba) comprobando que
  // CADA tarjeta construida tiene `.zona-imagen` con una imagen, un SVG de
  // datos o la tarjeta tipográfica — nunca vacía. Todo dentro de un único
  // page.evaluate (sin 295 idas y vueltas Playwright<->página): asegurarRepasoConstruidoHasta
  // es idempotente por índice, así que el coste total es el mismo que un solo
  // irA(294) (ver I1 más arriba), solo repartido en 295 pasos.
  // Tarea 7 de v0.2a.2.1: el barrido original (spec §8) solo comprobaba que
  // cada tarjeta tuviera ALGO en `.zona-imagen`; esta versión añade las dos
  // garantías nuevas de la rama -- suelo del 50% y cero desborde -- sobre el
  // banco real completo. Sigue en un único page.evaluate con window.__one.irA
  // (idéntico al barrido original): a diferencia del barrido de 44 ids con
  // visual de datos (Tarea 6, más arriba en "gráficos de datos escalados al
  // hueco"), que SÍ necesita contexto nuevo por id porque juega partidas
  // reales (empezarPartida) y por tanto acumula racha/nivel entre preguntas,
  // este barrido solo NAVEGA por el repaso (irA), que no juega ni acumula
  // progreso -- no hay "cambio de nivel" que colar entre tarjetas. Mismo
  // patrón que ya usaba con éxito el barrido original antes de esta tarea.
  test('v0.2a.2.1 §3.7: barrido del banco entero en el repaso — el 100 % tiene imagen o color del área, ninguna sale de [50,60] % y ninguna desborda', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    const total = await page.evaluate(() => window.__one.repasoNodosLength());
    expect(total).toBeGreaterThan(0);

    const faltantes = await page.evaluate((n) => {
      const problemas = [];
      for (let i = 0; i < n; i += 1) {
        window.__one.irA(i);
        const tarjeta = document.querySelector('.tarjeta-mazo--actual');
        const zona = tarjeta ? tarjeta.querySelector('.zona-imagen') : null;
        const contenido = tarjeta ? tarjeta.querySelector('.tarjeta-contenido') : null;
        if (!zona || !contenido) { problemas.push({ i, motivo: 'sin zona o sin contenido' }); continue; }
        const tieneAlgo = Boolean(zona.querySelector('img, svg, .zona-imagen--color')) || zona.classList.contains('zona-imagen--color');
        if (!tieneAlgo) { problemas.push({ i, motivo: 'zona vacía' }); continue; }
        const ratio = zona.getBoundingClientRect().height / tarjeta.getBoundingClientRect().height;
        // Tolerancia de 1px sobre el alto real de la tarjeta, como en el resto de la suite.
        // El color del área (sin foto) puede bajar hasta el 35 % antes de recortar texto (fase 7).
        const suelo = (zona.classList.contains('zona-imagen--color') ? 0.35 : 0.5) - 1 / tarjeta.getBoundingClientRect().height;
        const techo = 0.6 + 1 / tarjeta.getBoundingClientRect().height;
        if (ratio < suelo) { problemas.push({ i, motivo: `visual al ${(ratio * 100).toFixed(1)} %` }); continue; }
        // Ronda de corrección 1 (Tarea 7, minor): el barrido original solo miraba el suelo del 50 %;
        // la spec fija un RANGO [50,60], así que también hay que comprobar que nadie supera el techo.
        if (ratio > techo) { problemas.push({ i, motivo: `visual al ${(ratio * 100).toFixed(1)} % (supera el techo del 60 %)` }); continue; }
        if (contenido.scrollHeight > contenido.clientHeight + 2) {
          problemas.push({ i, motivo: `desborda ${contenido.scrollHeight - contenido.clientHeight}px` });
        }
      }
      return problemas;
    }, total);

    expect(faltantes, `${faltantes.length} de ${total} tarjetas con problema: ${JSON.stringify(faltantes.slice(0, 10))}`).toEqual([]);
  });

});

test.describe('ONE · pantalla completa (spec §8 "Ver a pantalla completa", v0.2a.2 — Tarea 3)', () => {
  /** Inyecta una pregunta vf con imagen forzada y otra SIN imagen ni `visual` (cae en la tercera
   * capa, tarjeta tipográfica) — mismo patrón que inyectarTresCapas de la suite "protagonismo
   * visual" de arriba, con solo las dos capas que hacen falta aquí. Ids sufijados para no chocar
   * entre tests que comparten `page`. */
  async function inyectarImagenYClave(page, sufijo) {
    const [visualesEjemplo, imagenesEjemplo] = await Promise.all([
      page.evaluate(() => fetch('datos/visuales.ejemplo.json').then((r) => r.json())),
      page.evaluate(() => fetch('datos/imagenes.ejemplo.json').then((r) => r.json())),
    ]);
    const idImagen = `pc-imagen-${sufijo}`;
    const idClave = `pc-clave-${sufijo}`;
    const preguntaImagen = { ...visualesEjemplo.formula, id: idImagen };
    const { visual: _sinVisual, ...preguntaClaveSinVisual } = visualesEjemplo.formula;
    const preguntaClave = { ...preguntaClaveSinVisual, id: idClave };
    const imagenForzada = { ...imagenesEjemplo['his-001'], id: idImagen };

    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaImagen);
    await page.evaluate((datos) => window.__one.forzarImagen(datos.id, datos), imagenForzada);
    await page.evaluate((p) => window.__one.inyectarPregunta(p), preguntaClave);

    return { idImagen, idClave };
  }

  /** Arranca una partida de UNA sola pregunta (por su id) y la falla a propósito
   * (vf-falso): la revela con `tarjeta--revelada` y `.zona-imagen`, lista para tocar. */
  async function jugarYRevelar(page, id, etiqueta) {
    await page.evaluate((p) => window.__one.empezarPartida(p), { ids: [id], etiqueta });
    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-falso"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    return t;
  }

  test('abre desde la imagen en partida: hidden=false, contenido ≥80% del ancho de la ventana, foco en el botón de cierre, cierra por toque en cualquier sitio, foco vuelve a la zona y el mazo sigue en la misma tarjeta', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'a');
    const t = await jugarYRevelar(page, idImagen, 'pc-a');

    const indiceAntes = await page.evaluate(() => document.querySelector('.tarjeta-mazo--actual').dataset.indice);

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();
    expect(await overlay.evaluate((el) => el.hidden)).toBe(false);

    const anchoRatio = await page.evaluate(() => {
      const media = document.querySelector('.visual-completa-media');
      if (!media) return 0;
      return media.getBoundingClientRect().width / window.innerWidth;
    });
    expect(anchoRatio, `el contenido mide ${(anchoRatio * 100).toFixed(1)}% del ancho de la ventana`).toBeGreaterThanOrEqual(0.8);

    // Ronda 1 de revisión (Important #2/#3): el foco al abrir va al botón de cierre, el ÚNICO
    // elemento enfocable del diálogo -- ya no al contenedor `.visual-completa` en sí.
    const focoEsElBotonCerrar = await page.evaluate(
      () => document.activeElement === document.querySelector('[data-test="visual-cerrar"]')
    );
    expect(focoEsElBotonCerrar, 'el foco no está en el botón de cierre al abrir').toBe(true);

    // Toque en cualquier sitio (spec §8): lejos del botón de cierre (arriba-izquierda, 44x44) para
    // que esta comprobación sea de verdad "cualquier sitio" y no coincida con el test dedicado del
    // botón (I2, más abajo).
    await overlay.click({ position: { x: 300, y: 750 } });
    expect(await overlay.evaluate((el) => el.hidden), 'un toque en cualquier sitio debe cerrar').toBe(true);

    const focoEnZona = await page.evaluate(
      () => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.test === 'visual-abrir'
    );
    expect(focoEnZona, 'el foco no volvió a la zona al cerrar').toBe(true);

    const indiceDespues = await page.evaluate(() => document.querySelector('.tarjeta-mazo--actual').dataset.indice);
    expect(indiceDespues, 'el mazo no debe cambiar de tarjeta solo por abrir/cerrar la superposición').toBe(indiceAntes);
    await assertTarjetaSinScroll(page);
  });

  test('cierra deslizando hacia abajo ≥60px (pointerdown/pointerup propios de la superposición): un deslizamiento corto no cierra, uno largo sí', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'c');
    const t = await jugarYRevelar(page, idImagen, 'pc-c');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    // Eventos pointerdown/pointerup dispatched a mano (no page.mouse): así se aísla el mecanismo
    // de cierre por deslizamiento del propio `click` (que ya cierra con cualquier toque y haría
    // ambigua esta comprobación -- un mouseup real de page.mouse dispara además un click nativo).
    await page.evaluate(() => {
      const el = document.querySelector('[data-test="visual-completa"]');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 300 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 190, clientY: 340 })); // dy=40 < 60
    });
    expect(await overlay.evaluate((el) => el.hidden), 'un deslizamiento corto (<60px) no debe cerrar').toBe(false);

    await page.evaluate(() => {
      const el = document.querySelector('[data-test="visual-completa"]');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 300 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 190, clientY: 400 })); // dy=100 >= 60
    });
    expect(await overlay.evaluate((el) => el.hidden), 'un deslizamiento largo (>=60px) debe cerrar').toBe(true);

    await assertTarjetaSinScroll(page);
  });

  test('un deslizamiento que arranca en la zona-imagen (>10px) no abre pantalla completa; un toque limpio después sí', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'd');
    const t = await jugarYRevelar(page, idImagen, 'pc-d');

    const zona = t.locator('[data-test="visual-abrir"]');
    const caja = await zona.boundingBox();
    expect(caja).not.toBeNull();
    const cx = caja.x + caja.width / 2;
    const cy = caja.y + caja.height / 2;

    const overlay = page.locator('[data-test="visual-completa"]');
    // Deslizamiento real con page.mouse (mismo helper `arrastrar` que usa el resto de la suite
    // para el gesto del mazo): 40px, por encima del ARRANQUE de 10px que distingue toque de
    // deslizamiento, pero por debajo del UMBRAL_PX de 60px del mazo -- no cambia de tarjeta, solo
    // prueba que el mismo gesto no abre la superposición aunque el navegador SÍ dispare un `click`
    // real al soltar sobre el mismo elemento.
    await arrastrar(page, [
      { x: cx, y: cy },
      { x: cx, y: cy - 40 },
    ]);
    expect(
      await overlay.evaluate((el) => el.hidden),
      'un deslizamiento (>10px) sobre la zona-imagen no debe abrir pantalla completa'
    ).toBe(true);

    await zona.click();
    expect(await overlay.evaluate((el) => el.hidden), 'un toque limpio (sin arrastre) sí debe abrir pantalla completa').toBe(false);
  });

  test('con prefers-reduced-motion no hay animación de entrada', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'e');
    const t = await jugarYRevelar(page, idImagen, 'pc-e');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();
    // Bajo "reducir movimiento" la regla genérica `*, *::before, *::after` de estilos.css fuerza
    // `animation-duration: 0.001ms !important` -- Chromium lo devuelve en notación científica
    // (1e-06s = 0.000001s = 0.001ms), así que se compara el NÚMERO, no el string exacto.
    const duracion = await overlay.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duracion)).toBeLessThan(0.01);
  });

  test('el enlace de atribución del pie de la imagen sigue funcionando y no abre pantalla completa', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'f');
    const t = await jugarYRevelar(page, idImagen, 'pc-f');

    const enlace = t.locator('[data-test="imagen-pie"] a');
    await expect(enlace).toHaveAttribute('target', '_blank');
    // Disparado a mano (dispatchEvent), no un `.click()` real de Playwright: un evento sintético
    // sobre un `<a>` sigue invocando los listeners (incluido el stopPropagation de
    // construirAtribucionImagen, lo que este test comprueba) pero, al no ser "trusted", el
    // navegador NO ejecuta la acción por defecto (navegar/abrir pestaña) -- evita depender de red
    // real hacia Commons o de manejar una pestaña emergente solo para esta comprobación.
    await enlace.evaluate((a) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

    const overlay = page.locator('[data-test="visual-completa"]');
    expect(await overlay.evaluate((el) => el.hidden), 'el enlace de atribución no debe abrir pantalla completa').toBe(true);
  });

  test('abre también desde el repaso "sin fin" del HUB (mazo-repaso)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    // Foto forzada en todo el banco de ejemplo: la primera tarjeta del repaso, sea cual sea, la lleva.
    await page.evaluate(async () => {
      const banco = await fetch('datos/banco.ejemplo.json').then((r) => r.json());
      const lista = Array.isArray(banco) ? banco : banco.preguntas;
      for (const p of lista) {
        window.__one.forzarImagen(p.id, {
          id: p.id,
          url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          pagina: 'https://commons.wikimedia.org/wiki/File:Ejemplo.png',
          titulo: 'Ejemplo',
          autor: 'Autor de ejemplo',
          licencia: 'CC0',
          leyenda: 'Imagen de ejemplo',
          ancho: 1,
          alto: 1,
        });
      }
    });
    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    const t = tarjetaActual(page);
    await expect(t.locator('[data-test="visual-abrir"]')).toBeVisible();
    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    expect(await overlay.evaluate((el) => el.hidden)).toBe(false);
    await page.keyboard.press('Escape');
    expect(await overlay.evaluate((el) => el.hidden)).toBe(true);
  });

  // Ronda 1 de revisión (Important #2): la flecha "←" de la cabecera dejó de cerrar la
  // superposición (era inalcanzable por un toque real, tapada por la propia superposición) --
  // este botón de dentro es su reemplazo, y este test lo ejercita con una interacción real.
  test('el botón de cierre (44×44, arriba a la izquierda) cierra la superposición', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'g');
    const t = await jugarYRevelar(page, idImagen, 'pc-g');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    const boton = page.locator('[data-test="visual-cerrar"]');
    await expect(boton).toHaveAttribute('aria-label', 'Cerrar');
    const caja = await boton.boundingBox();
    expect(caja).not.toBeNull();
    expect(caja.width, 'el botón de cierre debe medir al menos 44px de ancho').toBeGreaterThanOrEqual(44);
    expect(caja.height, 'el botón de cierre debe medir al menos 44px de alto').toBeGreaterThanOrEqual(44);

    await boton.click();
    expect(await overlay.evaluate((el) => el.hidden), 'el botón de cierre debe cerrar la superposición').toBe(true);
  });

  // Ronda 1 de revisión (Important #3) + Ronda 2 (Important de accesibilidad, corrige una fuga de
  // la Ronda 1): trampa de foco de DOS paradas -- botón de cierre y, cuando el pie clona un enlace
  // de atribución (I4), también ese enlace. Antes (Ronda 1) el `keydown` de Tab devolvía el foco al
  // botón SIEMPRE, sin mirar si había un enlace: el enlace existía en el DOM y era clicable con
  // ratón/dedo, pero un usuario de teclado nunca podía llegar a él. Con solo dos paradas, Tab y
  // Shift+Tab hacen lo mismo (alternan entre las mismas dos) -- no hay una tercera a la que "saltar
  // de más" en ninguna dirección.
  test('trampa de foco con atribución (imagen): Tab pasa al enlace de Commons y de vuelta al botón; Shift+Tab hace el mismo camino', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'h');
    const t = await jugarYRevelar(page, idImagen, 'pc-h');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    const focoDentro = async () =>
      page.evaluate(() => {
        const dialogo = document.querySelector('[data-test="visual-completa"]');
        return Boolean(dialogo && document.activeElement && dialogo.contains(document.activeElement));
      });
    const focoEsSelector = async (selector) => page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);

    expect(await focoEsSelector('[data-test="visual-cerrar"]'), 'el foco no empieza en el botón de cierre').toBe(true);

    await page.keyboard.press('Tab');
    expect(await focoDentro(), 'Tab sacó el foco de la superposición').toBe(true);
    expect(await focoEsSelector('[data-test="visual-completa-pie"] a'), 'Tab debería llevar el foco al enlace de Commons').toBe(true);

    await page.keyboard.press('Tab');
    expect(await focoEsSelector('[data-test="visual-cerrar"]'), 'un segundo Tab debería devolver el foco al botón de cierre').toBe(true);

    await page.keyboard.press('Shift+Tab');
    expect(await focoDentro(), 'Shift+Tab sacó el foco de la superposición').toBe(true);
    expect(await focoEsSelector('[data-test="visual-completa-pie"] a'), 'Shift+Tab desde el botón debería llevar el foco al enlace').toBe(true);

    await page.keyboard.press('Shift+Tab');
    expect(await focoEsSelector('[data-test="visual-cerrar"]'), 'un segundo Shift+Tab debería devolver el foco al botón').toBe(true);
  });

  // Ronda 1 de revisión (Important #4): la atribución (autor/licencia/enlace a Commons) ya no se
  // pierde en pantalla completa -- el pie reutiliza el MISMO figcaption que la tarjeta, con el
  // fixture de e2e (his-001: "Autor de ejemplo", "CC BY-SA 4.0", licencia que SÍ exige atribución).
  test('el pie de la imagen en pantalla completa contiene la leyenda, el autor, la licencia y un enlace a Commons', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'i');
    const t = await jugarYRevelar(page, idImagen, 'pc-i');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    const pie = page.locator('[data-test="visual-completa-pie"]');
    await expect(pie).toBeVisible();
    await expect(pie.locator('.imagen-pie-leyenda')).toHaveText('La toma de la Bastilla, 14 de julio de 1789 (imagen de ejemplo para el e2e)');
    const atribucion = pie.locator('.imagen-pie-atribucion');
    await expect(atribucion).toContainText('Autor de ejemplo');
    await expect(atribucion).toContainText('CC BY-SA 4.0');
    const enlace = atribucion.locator('a');
    await expect(enlace).toHaveText('Commons · Autor de ejemplo · CC BY-SA 4.0');
    await expect(enlace).toHaveAttribute('target', '_blank');
    await expect(enlace).toHaveAttribute('rel', 'noopener');
    await expect(enlace).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Ejemplo-toma-bastilla.png');

    // El enlace clonado sigue sin abrir/cerrar la superposición al tocarlo (stopPropagation propio,
    // no heredado de cloneNode -- ver construirPieVisualCompleta).
    await enlace.evaluate((a) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(await overlay.evaluate((el) => el.hidden), 'el enlace de atribución clonado no debe cerrar la superposición').toBe(false);
  });

  // Ola final de revisión (Critical #1): el cierre por deslizamiento NUNCA funcionaba con un gesto
  // táctil REAL -- solo con los eventos `PointerEvent` sintéticos que ya cubría el test de arriba
  // ("cierra deslizando..."). `touch-action:auto` heredado dejaba que el navegador reclamase el
  // desplazamiento vertical como scroll y cancelase el puntero (`pointercancel`) antes de entregar
  // `pointerup`, con lo que ni el umbral de 60px ni el respaldo "toque en cualquier sitio" (que
  // depende de un `click` que `pointercancel` también suprime) llegaban a ejecutarse. Reproducido con
  // `Input.dispatchTouchEvent` vía CDP, igual que hizo el revisor final (`fase3c.mjs`/`fase13.mjs`).
  test('Critical: cierra con un gesto táctil REAL (CDP Input.dispatchTouchEvent), no solo con pointerdown/pointerup sintéticos', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'l');
    const t = await jugarYRevelar(page, idImagen, 'pc-l');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    const cdp = await page.context().newCDPSession(page);
    const caja = await page.locator('[data-test="visual-completa-medio"] > *').boundingBox();
    expect(caja).not.toBeNull();
    const cx = Math.round(caja.x + caja.width / 2);
    const y0 = Math.round(caja.y + caja.height / 2) - 50;

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: y0 }] });
    for (let k = 1; k <= 8; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: y0 + k * 15 }] }); // 120px totales
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    expect(
      await overlay.evaluate((el) => el.hidden),
      'un deslizamiento táctil REAL hacia abajo (120px) debe cerrar la superposición'
    ).toBe(true);
  });

  // Re-revisión de la ola final (Important N1, regresión de 15e9a5b): el `setPointerCapture` que se
  // añadió como cinturón para C1 hacía que, con ratón/trackpad, un clic REAL sobre el enlace
  // "Commons" del pie lo recibiera la propia `.visual-completa` (capturado) en vez del `<a>` --  se
  // cerraba sin navegar, y el `stopPropagation` propio del enlace clonado (construirPieVisualCompleta)
  // nunca llegaba a ejecutarse porque el evento se retargeteaba antes de alcanzarlo. Se quitó la
  // captura (app.js, cableado de cierre): el cierre táctil real lo sigue garantizando
  // `touch-action:none` por sí solo (ver el test de arriba), sin necesitar `setPointerCapture`.
  test('N1: un clic REAL de ratón en el enlace "Commons" del pie NO cierra la superposición y el enlace recibe el clic', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'p');
    const t = await jugarYRevelar(page, idImagen, 'pc-p');

    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    const enlace = page.locator('[data-test="visual-completa-pie"] a');
    await expect(enlace).toHaveAttribute('target', '_blank');
    await expect(enlace).toHaveAttribute('href', /^https:\/\/commons\.wikimedia\.org\//);

    // Clic REAL de Playwright (mousedown+mouseup+click reales vía CDP, no dispatchEvent): esto es
    // justo lo que rompía setPointerCapture. `page.route` a nivel de CONTEXTO (no de página: el
    // enlace abre una pestaña nueva por target="_blank", y las rutas de contexto se aplican también
    // a páginas futuras) intercepta la navegación a Commons SIN dejarla completarse de verdad --
    // así se confirma que el enlace recibió el clic (la ruta se dispara) sin depender de que
    // Commons responda ni de esperar a que una pestaña nueva termine de abrirse del todo
    // (waitForEvent('popup') resultó frágil en este entorno de pruebas, sin red real: probado en
    // vivo, agotaba su propio timeout de 30s aunque el clic sí llegara al enlace).
    let seNavego = false;
    await page.context().route('https://commons.wikimedia.org/**', async (route) => {
      seNavego = true;
      await route.abort();
    });

    await enlace.click();
    await page.waitForTimeout(500); // margen para que el navegador procese target="_blank" y dispare la ruta

    expect(seNavego, 'el clic debería haber intentado navegar a Commons (el enlace recibió el clic de verdad)').toBe(true);
    expect(
      await overlay.evaluate((el) => el.hidden),
      'un clic real en el enlace de atribución NO debe cerrar la superposición'
    ).toBe(false);

    // Cinturón: cierra cualquier pestaña que hubiera llegado a abrirse antes de que la ruta abortara.
    for (const p of page.context().pages()) {
      if (p !== page) await p.close();
    }
  });

  // Ola final de revisión (Important #1): con la superposición abierta, el mazo de debajo NO debe
  // seguir navegando por teclado (ArrowUp/PageUp) -- mazo.js#alKeydown vive en `document` y solo
  // comprobaba si la VISTA estaba visible, no si había un diálogo por encima; y al cerrar, el foco
  // no debe perderse en <body> (mismo hallazgo, efecto colateral: `zonaImagenAbrio` podía apuntar a
  // una tarjeta que ya no es la actual). Usa el repaso del HUB con el banco real (igual que el
  // guión de reproducción del revisor, fase5.mjs) para tener varias tarjetas navegables de verdad.
  test('Important: con la superposición abierta el mazo no navega por teclado; al cerrar el foco queda dentro de la tarjeta actual', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    await page.evaluate(() => window.__one.irA(5));
    await esperarAsentamientoMazo(page);
    const indiceAntes = await page.evaluate(() => document.querySelector('.tarjeta-mazo--actual').dataset.indice);
    const enunciadoAntes = await page.locator('.tarjeta-mazo--actual .enunciado').textContent();

    const t = tarjetaActual(page);
    await t.locator('[data-test="visual-abrir"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    // Adversarial A2 + Important #1: <main> queda inert mientras está abierta.
    expect(await page.evaluate(() => document.querySelector('main#app').inert), '<main> debería quedar inert al abrir').toBe(true);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250); // margen: si el mazo se hubiera movido, la transición ya habría acabado
    const indiceDuranteAbierta = await page.evaluate(() => document.querySelector('.tarjeta-mazo--actual').dataset.indice);
    const enunciadoDuranteAbierta = await page.locator('.tarjeta-mazo--actual .enunciado').textContent();
    expect(indiceDuranteAbierta, 'ArrowUp ×2 con la superposición abierta no debería mover el mazo').toBe(indiceAntes);
    expect(enunciadoDuranteAbierta, 'el enunciado bajo la superposición no debería cambiar').toBe(enunciadoAntes);

    await page.keyboard.press('Escape');
    expect(await overlay.evaluate((el) => el.hidden)).toBe(true);
    expect(await page.evaluate(() => document.querySelector('main#app').inert), '<main> debería dejar de ser inert al cerrar').toBe(false);

    const focoDentroDeLaActual = await page.evaluate(() => {
      const tarjeta = document.querySelector('.tarjeta-mazo--actual');
      return Boolean(tarjeta && document.activeElement && tarjeta.contains(document.activeElement));
    });
    expect(focoDentroDeLaActual, 'el foco debería quedar dentro de la tarjeta actual al cerrar, nunca en <body>').toBe(true);
    expect(await page.evaluate(() => document.activeElement === document.body), 'el foco no debería perderse en <body>').toBe(false);
  });

  // Ola final de revisión (adversarial A1 + A3): una doble apertura no debe reconstruir el clon dos
  // veces ni perder la referencia de la apertura real; 30 ciclos abrir/cerrar no deben dejar nodos
  // residuales en el DOM ni acumular errores de JS (listeners registrados una sola vez al cargar el
  // módulo, nunca dentro de abrirVisualCompleta/cerrarVisualCompleta).
  test('una doble apertura no clona el medio dos veces (A1); 30 ciclos abrir/cerrar no dejan nodos residuales ni errores (A3)', async ({
    page,
  }) => {
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen } = await inyectarImagenYClave(page, 'n');
    const t = await jugarYRevelar(page, idImagen, 'pc-n');
    const overlay = page.locator('[data-test="visual-completa"]');

    // A1: dos toques en el mismo tick de JS (sin await entre ellos) sobre la misma zona -- la
    // segunda apertura debe ignorarse (nodoVisualCompleta ya no está `hidden`), sin reconstruir el
    // clon ni perder la referencia de foco de la apertura real.
    await page.evaluate(() => {
      const zona = document.querySelector('.tarjeta-mazo--actual [data-test="visual-abrir"]');
      zona.click();
      zona.click();
    });
    await expect(overlay).toBeVisible();
    const hijosMedioTrasDobleToque = await page.evaluate(
      () => document.querySelector('[data-test="visual-completa-medio"]').children.length
    );
    expect(hijosMedioTrasDobleToque, 'una doble apertura no debería clonar el medio dos veces').toBe(1);
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    const focoEnZonaTrasDobleToque = await page.evaluate(
      () => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.test === 'visual-abrir'
    );
    expect(focoEnZonaTrasDobleToque, 'el foco debería volver a la zona correctamente tras una doble apertura').toBe(true);

    // A3: 30 ciclos abrir/cerrar.
    const zona = t.locator('[data-test="visual-abrir"]');
    for (let i = 0; i < 30; i += 1) {
      await zona.click();
      await expect(overlay).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(overlay).toBeHidden();
    }

    const hijosResiduales = await page.evaluate(() => ({
      medio: document.querySelector('[data-test="visual-completa-medio"]').children.length,
      pie: document.querySelector('[data-test="visual-completa-pie"]').children.length,
    }));
    expect(hijosResiduales, 'no deberían quedar nodos residuales tras 30 ciclos').toEqual({ medio: 0, pie: 0 });
    expect(errores, `errores JS durante los ciclos: ${errores.join('; ')}`).toEqual([]);

    // Sigue funcionando con normalidad después de los 30 ciclos (ni un Escape "acumulado" cierra
    // dos veces de forma anómala, ni Tab se comporta distinto).
    await zona.click();
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  // Ola final de revisión (Minor #1 + Minor #4): el clon de la imagen debe conservar
  // `referrerPolicy="no-referrer"` (si no, un fallo de caché real filtraría el origen de la app a
  // upload.wikimedia.org, justo lo que el <img> de la tarjeta evita a propósito); el clon de la
  // fase 7: el color del área no se abre a pantalla completa.
  test('el clon de la imagen conserva referrerPolicy="no-referrer" (M1); la zona de color no se abre', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const { idImagen, idClave } = await inyectarImagenYClave(page, 'o');
    const overlay = page.locator('[data-test="visual-completa"]');

    let t = await jugarYRevelar(page, idImagen, 'pc-o1');
    await t.locator('[data-test="visual-abrir"]').click();
    await expect(overlay).toBeVisible();
    const referrerPolicy = await page.evaluate(() => document.querySelector('.visual-completa-media').referrerPolicy);
    expect(referrerPolicy, 'el clon de la imagen debería conservar referrerPolicy="no-referrer"').toBe('no-referrer');
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    t = await jugarYRevelar(page, idClave, 'pc-o2');
    await expect(t.locator('[data-test="zona-color"]')).toBeVisible();
    await expect(t.locator('[data-test="visual-abrir"]')).toHaveCount(0);
    await t.locator('[data-test="zona-color"]').click();
    await expect(overlay).toBeHidden();
  });
});

test.describe('ONE · zona de acción v0.2a.2.1 (§1.2)', () => {
  test('sin botón "Siguiente ›": la flecha ↓ de 36px pasa de pregunta, la confianza va encima de los chips y la acción ocupa ≤25% de la tarjeta', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.locator('[data-test="modo-clasico"]').click();

    const t = tarjetaActual(page);
    await responderPreguntaActual(page);
    await esperarAsentamientoMazo(page);

    // 1. No existe NINGÚN botón con el texto viejo.
    await expect(page.getByRole('button', { name: 'Siguiente ›' })).toHaveCount(0);
    await expect(t.locator('.boton-siguiente')).toHaveCount(0);

    // 2. `data-test="siguiente"` SE CONSERVA, ahora sobre la flecha de 36×36.
    const flecha = t.locator('[data-test="siguiente"]');
    await expect(flecha).toBeVisible();
    await expect(flecha).toHaveAttribute('aria-label', 'Siguiente');
    const cajaFlecha = await flecha.boundingBox();
    expect(cajaFlecha.width).toBeGreaterThanOrEqual(34);
    expect(cajaFlecha.width).toBeLessThanOrEqual(40);
    expect(cajaFlecha.height).toBeGreaterThanOrEqual(34);
    expect(cajaFlecha.height).toBeLessThanOrEqual(40);

    // 3. «Saber +» (píldora de ≥44px), en la MISMA fila que la flecha y a su izquierda.
    const chip = t.locator('[data-test="saber-mas"]');
    await expect(chip).toContainText('Saber +');
    const cajaChip = await chip.boundingBox();
    expect(cajaChip.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(cajaChip.y + cajaChip.height / 2 - (cajaFlecha.y + cajaFlecha.height / 2))).toBeLessThan(10);
    expect(cajaChip.x).toBeLessThan(cajaFlecha.x);

    // 4. La confianza está POR ENCIMA de "Preguntar a" en el eje Y, y dentro de .tarjeta-accion.
    const cajaConfianza = await t.locator('[data-test="confianza"]').boundingBox();
    const cajaPreguntar = await t.locator('[data-test="saber-mas-fila"]').boundingBox();
    expect(cajaConfianza.y + cajaConfianza.height).toBeLessThanOrEqual(cajaPreguntar.y + 2);
    const confianzaEnAccion = await t.evaluate((tarjeta) => {
      const fila = tarjeta.querySelector('.confianza-fila');
      return Boolean(fila && fila.closest('.tarjeta-accion'));
    });
    expect(confianzaEnAccion, 'la fila de confianza debe vivir dentro de .tarjeta-accion').toBe(true);

    // 5. "esta pregunta está mal" en su propia línea BAJO los chips.
    const cajaEstaMal = await t.locator('[data-test="esta-mal"]').boundingBox();
    expect(cajaEstaMal.y).toBeGreaterThanOrEqual(cajaPreguntar.y + cajaPreguntar.height - 2);

    // 6. La zona de acción entera ≤25% de la tarjeta (spec §1.2.5).
    const proporcion = await t.evaluate((tarjeta) => {
      const accion = tarjeta.querySelector('.tarjeta-accion');
      return accion.getBoundingClientRect().height / tarjeta.getBoundingClientRect().height;
    });
    expect(proporcion, `la zona de acción ocupa el ${(proporcion * 100).toFixed(1)}% de la tarjeta`).toBeLessThanOrEqual(0.25);

    // 7. La flecha pasa de pregunta de verdad. `mazo-contador` no sirve de señal aquí: refleja
    // "respondidas/total" (contadorTextoPartida en app.js), así que se repinta igual en TODAS las
    // tarjetas visibles y no cambia con la mera navegación (confirmado por un e2e ya existente,
    // "Sigue siendo LA MISMA partida", que depende justo de que NO cambie). `data-indice` (mazo.js)
    // sí identifica la tarjeta por posición y es la misma señal que usa el test de repaso de abajo.
    const indiceAntes = await tarjetaActual(page).getAttribute('data-indice');
    await flecha.click();
    await esperarAsentamientoMazo(page);
    expect(await tarjetaActual(page).getAttribute('data-indice')).not.toBe(indiceAntes);
  });

  test('en el repaso (soloLectura) hay chips y flecha, pero ni confianza ni "está mal"; la flecha avanza el mazo', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    const t = tarjetaActual(page);
    await expect(t.locator('[data-test="saber-mas"]')).toBeVisible();
    await expect(t.locator('[data-test="confianza"]')).toHaveCount(0);
    await expect(t.locator('[data-test="esta-mal"]')).toHaveCount(0);

    const flecha = t.locator('[data-test="siguiente"]');
    await expect(flecha).toBeVisible();
    const indiceAntes = await tarjetaActual(page).getAttribute('data-indice');
    await flecha.click();
    await esperarAsentamientoMazo(page);
    expect(await tarjetaActual(page).getAttribute('data-indice')).not.toBe(indiceAntes);
    await assertTarjetaSinScroll(page);
  });
});

test.describe('ONE · visual al 50-60 % real de la tarjeta (v0.2a.2.1 §1.1)', () => {
  /** Una imagen REAL con dimensiones intrínsecas exactas y sin red: un SVG en data: URI. Los
   * fixtures PNG 1×1 de `?ejemplo=1` no sirven aquí, porque lo que se está probando es justo que
   * el FORMATO de la imagen no cambia el alto de la zona. */
  function imagenFixture(ancho, alto, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  async function proporcionZona(page) {
    return page.evaluate(() => {
      const tarjeta = document.querySelector('.tarjeta-mazo--actual');
      const zona = tarjeta ? tarjeta.querySelector('.zona-imagen') : null;
      if (!zona) return null;
      const rZona = zona.getBoundingClientRect();
      const rTarjeta = tarjeta.getBoundingClientRect();
      return { zona: rZona.height, tarjeta: rTarjeta.height, ratio: rZona.height / rTarjeta.height };
    });
  }

  const VIEWPORTS = [
    { width: 375, height: 667, nombre: '375' },
    { width: 390, height: 844, nombre: '390' },
  ];

  for (const vp of VIEWPORTS) {
    test(`Duchamp (art-091, imagen real del banco) a ${vp.width}×${vp.height}: la zona mide entre el 50 % y el 60 % de la tarjeta, con cover y el pie DENTRO`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/?test=1');
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

      // La imagen real de art-091 vive en upload.wikimedia.org: se fuerza un fixture con las
      // MISMAS dimensiones (900×949) para que el test no dependa de la red, conservando la
      // pregunta real del banco (tipo `error`, su enunciado, su explicación de 39 palabras).
      await page.evaluate((url) => window.__one.forzarImagen('art-091', {
        id: 'art-091', url,
        pagina: 'https://commons.wikimedia.org/wiki/File:Duchamp_Fountaine.jpg',
        titulo: 'Duchamp Fountaine.jpg', autor: 'Marcel Duchamp', licencia: 'Public domain',
        leyenda: 'Fuente de Duchamp, readymade que cuestiona qué es arte',
        termino: 'Fountain Marcel Duchamp 1917', ancho: 900, alto: 949,
      }), imagenFixture(900, 949, '#c8c8c8'));
      await page.evaluate(() => window.__one.empezarPartida({ ids: ['art-091'], etiqueta: 'duchamp' }));

      const t = tarjetaActual(page);
      // art-091 es tipo "error" (banco real): cualquier fila revela la tarjeta, la corrección
      // de la respuesta no afecta a la medida de la zona visual que prueba este test.
      await responderPreguntaActual(page);
      await esperarAsentamientoMazo(page);
      await expect(t.locator('[data-test="imagen"]')).toBeVisible();

      const medidas = await proporcionZona(page);
      expect(medidas, 'no se encontró .zona-imagen en la tarjeta actual').not.toBeNull();
      expect(
        medidas.ratio,
        `la zona mide ${medidas.zona.toFixed(1)}px de ${medidas.tarjeta.toFixed(1)}px de tarjeta = ${(medidas.ratio * 100).toFixed(1)}%`
      ).toBeGreaterThanOrEqual(0.5 - 1 / medidas.tarjeta);
      expect(medidas.ratio).toBeLessThanOrEqual(0.6 + 1 / medidas.tarjeta);

      // La imagen llena la zona y recorta (cover), y el pie está DENTRO de la zona.
      const detalle = await t.evaluate((tarjeta) => {
        const zona = tarjeta.querySelector('.zona-imagen');
        const img = zona.querySelector('img');
        const pie = zona.querySelector('.imagen-pie');
        const rZona = zona.getBoundingClientRect();
        const rImg = img.getBoundingClientRect();
        const rPie = pie.getBoundingClientRect();
        return {
          objectFit: getComputedStyle(img).objectFit,
          altoImg: rImg.height / rZona.height,
          anchoImg: rImg.width / rZona.width,
          pieDentro: rPie.bottom <= rZona.bottom + 1 && rPie.top >= rZona.top - 1,
          pieSolapa: rPie.top < rZona.bottom,
          posicionPie: getComputedStyle(pie).position,
        };
      });
      expect(detalle.objectFit).toBe('cover');
      expect(detalle.altoImg).toBeGreaterThanOrEqual(0.99);
      expect(detalle.anchoImg).toBeGreaterThanOrEqual(0.99);
      expect(detalle.posicionPie).toBe('absolute');
      expect(detalle.pieDentro, 'el pie debe quedar dentro de la zona, superpuesto a la imagen').toBe(true);
      expect(detalle.pieSolapa).toBe(true);

      // Ruling R11 (encargo del coordinador, cobertura pedida por la revisión de la Tarea 4):
      // a 375×667, art-091 (tipo "error", banco real) SÍ llega al último recurso de la cascada
      // -- comprobado en vivo (script de un solo uso contra el servidor local, no un e2e): con
      // `.titulo-tarjeta`/`.instruccion-error` propios del tipo "error" más un cambio de nivel al
      // fallar la fila 0, ni (a)-(f) bastan (ver el comentario del paso (g) en ajustarEncaje,
      // mazo.js). A 390×844 no se ha confirmado que se llegue a este último recurso -- por eso la
      // aserción va condicionada al viewport donde SÍ se midió, no forzada para los dos.
      if (vp.width === 375) {
        const minimo = await t.evaluate((tarjeta) => {
          const seleccionables = ['.titulo-tarjeta', '.instruccion-error', '.cambio-nivel', '.cambio-nivel-area'];
          return {
            aplicado: tarjeta.classList.contains('tarjeta--feedback-minimo'),
            ocultos: seleccionables
              .map((sel) => tarjeta.querySelector(sel))
              .filter(Boolean)
              .map((el) => getComputedStyle(el).display),
          };
        });
        expect(minimo.aplicado, 'tarjeta--feedback-minimo debería aplicarse a art-091 a 375×667').toBe(true);
        expect(minimo.ocultos.length, 'no se encontró ninguno de los 4 elementos en la tarjeta de art-091').toBeGreaterThan(0);
        for (const display of minimo.ocultos) expect(display).toBe('none');
      }

      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
    });
  }

  test('mismo alto para 4 formatos: vertical, apaisada, cuadrada y documento dan la MISMA zona (±1px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const FORMATOS = [
      { nombre: 'vertical', ancho: 600, alto: 900 },
      { nombre: 'apaisada', ancho: 900, alto: 400 },
      { nombre: 'cuadrada', ancho: 600, alto: 600 },
      { nombre: 'documento', ancho: 500, alto: 1000 },
    ];
    const alturas = [];
    for (const f of FORMATOS) {
      await page.evaluate((datos) => window.__one.forzarImagen('art-091', {
        id: 'art-091', url: datos.url,
        pagina: 'https://commons.wikimedia.org/wiki/File:Duchamp_Fountaine.jpg',
        titulo: 'formato', autor: 'Autor', licencia: 'Public domain',
        leyenda: 'Fuente de Duchamp, readymade que cuestiona qué es arte',
        termino: 'x', ancho: datos.ancho, alto: datos.alto,
      }), { url: imagenFixture(f.ancho, f.alto, '#556677'), ancho: f.ancho, alto: f.alto });
      await page.evaluate(() => window.__one.empezarPartida({ ids: ['art-091'], etiqueta: 'formatos' }));
      await responderPreguntaActual(page);
      await esperarAsentamientoMazo(page);
      await expect(tarjetaActual(page).locator('[data-test="imagen"]')).toBeVisible();
      const medidas = await proporcionZona(page);
      alturas.push({ ...f, altoZona: medidas.zona });
    }
    const referencia = alturas[0].altoZona;
    for (const a of alturas) {
      expect(
        Math.abs(a.altoZona - referencia),
        `la zona con imagen ${a.nombre} (${a.ancho}×${a.alto}) mide ${a.altoZona}px frente a ${referencia}px de la vertical`
      ).toBeLessThanOrEqual(1);
    }
  });

  test('el alto lo decide el TEXTO: explicación corta sin hueco muerto; explicación de 60 palabras recortada, ambas en [50,60] (Ruling R9)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const base = {
      area: 'ciencia', tipo: 'vf', nivel: 1, respuesta: true,
      enunciado: 'El agua hierve a 100 °C al nivel del mar.',
      confianza: 1, generador: 'manual', verificador: 'manual', verificado: true,
    };
    const corta = { ...base, id: 'alto-corta', explicacion: 'A presión normal, sí.' };
    // 60 palabras, el peor caso real del banco (eco-091 tiene 60).
    const larga = { ...base, id: 'alto-larga', explicacion: Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ') + '.' };
    await page.evaluate((q) => window.__one.inyectarPregunta(q), corta);

    await page.evaluate(() => window.__one.empezarPartida({ ids: ['alto-corta'], etiqueta: 'alto-corta' }));
    await tarjetaActual(page).locator('[data-test="vf-verdadero"]').click();
    await esperarAsentamientoMazo(page);
    const conCorta = await proporcionZona(page);
    // Ruling R9 (ronda de corrección 1): el invariante es [50,60] y "sin hueco muerto", no "siempre
    // llega al 59-60 %" -- a este viewport el presupuesto fijo no deja sitio hasta el techo ni con
    // la explicación más corta posible (medido: ~53 %). Ver medirHuecoMuerto más arriba.
    expect(
      conCorta.ratio,
      `con explicación corta la zona mide ${(conCorta.ratio * 100).toFixed(1)}% (fuera de [50,60])`
    ).toBeGreaterThanOrEqual(0.5 - 1 / conCorta.tarjeta);
    expect(conCorta.ratio).toBeLessThanOrEqual(0.6 + 1 / conCorta.tarjeta);
    const huecoCorta = await medirHuecoMuerto(page);
    expect(huecoCorta, 'no se pudo medir el hueco muerto').not.toBeNull();
    expect(
      Math.abs(huecoCorta.huecoMuerto) <= 2 || conCorta.ratio >= 0.59,
      `hueco muerto de ${huecoCorta.huecoMuerto.toFixed(1)}px con explicación corta y la zona está al ${(conCorta.ratio * 100).toFixed(1)}% (no llegó a su techo del 59 %)`
    ).toBe(true);
    await assertTarjetaSinScroll(page);

    // Estado limpio antes de la segunda medida (mismo motivo que "Tarea 3b: capturas..." más
    // arriba): sin esto, el XP de responder 'alto-corta' se arrastra y puede cruzar un nivel justo
    // al responder 'alto-larga', colando un aviso `.cambio-nivel` que la cascada no contempla y
    // que no tiene nada que ver con lo que este test mide (el efecto del TEXTO sobre la zona).
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate((q) => window.__one.inyectarPregunta(q), larga);

    await page.evaluate(() => window.__one.empezarPartida({ ids: ['alto-larga'], etiqueta: 'alto-larga' }));
    await tarjetaActual(page).locator('[data-test="vf-verdadero"]').click();
    await esperarAsentamientoMazo(page);
    const conLarga = await proporcionZona(page);
    // Ruling R9: solo el invariante [50,60] -- nada de "≤52 %" (el brief lo daba por hecho sin
    // medirlo; con el bug de calcularLineasClamp ya corregido, corta y larga quedan casi
    // indistinguibles a este viewport, ambas ~53 %, y las dos son correctas: el invariante no exige
    // que el suelo y el techo se distingan mucho, solo que la zona nunca salga de [50,60]).
    expect(
      conLarga.ratio,
      `con explicación de 60 palabras la zona mide ${(conLarga.ratio * 100).toFixed(1)}% (fuera de [50,60])`
    ).toBeGreaterThanOrEqual(0.5 - 1 / conLarga.tarjeta);
    expect(conLarga.ratio).toBeLessThanOrEqual(0.6 + 1 / conLarga.tarjeta);
    await expect(tarjetaActual(page).locator('.explicacion')).toHaveClass(/explicacion--recortada/);
    await assertTarjetaSinScroll(page);
  });
});

test.describe('ONE · texto recortado tocable (v0.2a.2.1 §1.4)', () => {
  const EXPLICACION_60 = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ') + '.';

  async function partidaConExplicacion(page, explicacion, id) {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate((q) => window.__one.inyectarPregunta(q), {
      id, area: 'ciencia', tipo: 'vf', nivel: 1, respuesta: true,
      enunciado: 'El agua hierve a 100 °C al nivel del mar.',
      explicacion, confianza: 1, generador: 'manual', verificador: 'manual', verificado: true,
    });
    await page.evaluate((ids) => window.__one.empezarPartida({ ids: [ids], etiqueta: 'recorte' }), id);
    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await esperarAsentamientoMazo(page);
    return t;
  }

  test('explicación recortada: es tocable, abre la superposición con el texto ENTERO, Escape la cierra y devuelve el foco', async ({ page }) => {
    const t = await partidaConExplicacion(page, EXPLICACION_60, 'txt-larga');
    const explicacion = t.locator('[data-test="explicacion"]');
    await expect(explicacion).toHaveClass(/explicacion--recortada/);
    await expect(explicacion).toHaveAttribute('role', 'button');
    await expect(explicacion).toHaveAttribute('tabindex', '0');
    await expect(t.locator('.explicacion-ver-todo')).toBeVisible();

    await explicacion.click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-test="visual-completa-titulo"]')).toHaveText('Explicación');
    await expect(overlay.locator('[data-test="visual-completa-texto"]')).toContainText('palabra59');
    // El foco arranca en el botón de cierre, igual que con una imagen.
    expect(await page.evaluate(() => document.activeElement === document.querySelector('[data-test="visual-cerrar"]'))).toBe(true);

    await page.keyboard.press('Escape');
    expect(await overlay.evaluate((el) => el.hidden)).toBe(true);
    // El foco vuelve al propio párrafo (tiene tabindex=0 mientras está recortado).
    expect(await page.evaluate(() => document.activeElement === document.querySelector('.tarjeta-mazo--actual .explicacion'))).toBe(true);
    await assertTarjetaSinScroll(page);
  });

  test('explicación entera: NO reacciona al toque ni lleva role/tabindex', async ({ page }) => {
    const t = await partidaConExplicacion(page, 'A presión normal, sí.', 'txt-corta');
    const explicacion = t.locator('[data-test="explicacion"]');
    await expect(explicacion).not.toHaveClass(/explicacion--recortada/);
    expect(await explicacion.getAttribute('role')).toBeNull();
    expect(await explicacion.getAttribute('tabindex')).toBeNull();
    await expect(t.locator('.explicacion-ver-todo')).toBeHidden();

    await explicacion.click();
    expect(await page.locator('[data-test="visual-completa"]').evaluate((el) => el.hidden)).toBe(true);
  });

  test('enunciado recortado: abre la superposición con el título "Pregunta"', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const enunciadoLargo = `¿Cuál es la respuesta? ${'Contexto muy largo que no cabe de ninguna manera. '.repeat(8)}`;
    await page.evaluate((q) => window.__one.inyectarPregunta(q), {
      id: 'txt-enunciado', area: 'ciencia', tipo: 'vf', nivel: 1, respuesta: true,
      enunciado: enunciadoLargo, explicacion: EXPLICACION_60,
      confianza: 1, generador: 'manual', verificador: 'manual', verificado: true,
    });
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['txt-enunciado'], etiqueta: 'recorte-enunciado' }));
    const t = tarjetaActual(page);
    await t.locator('[data-test="vf-verdadero"]').click();
    await esperarAsentamientoMazo(page);

    const enunciado = t.locator('.enunciado');
    await expect(enunciado).toHaveClass(/enunciado--recortado/);
    await enunciado.click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-test="visual-completa-titulo"]')).toHaveText('Pregunta');
    await expect(overlay.locator('[data-test="visual-completa-texto"]')).toContainText('Contexto muy largo');
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  // Ronda de corrección 2 (Important): la tarjeta NEUTRA del repaso (una pregunta nunca
  // respondida, `construirTarjetaRespondida` con `tarjeta--revelada`/`tarjeta--neutra` pero SIN
  // `dataset.respondida` -- app.js) cae en la cascada REVELADA de `ajustarEncaje` (que decide por
  // `dataset.respondida === 'false'`, no por `'true'`), así que su enunciado SÍ puede recortarse
  // (paso (d)) y SÍ debe poder tocarse igual que en una tarjeta respondida de verdad -- la guarda
  // del Critical de la Ronda 1 usaba `=== 'true'` y la dejaba fuera por error, truncando el
  // enunciado sin forma de leerlo entero justo en el repaso. `nivel: 0` (por debajo de cualquier
  // nivel real del banco de ejemplo, que empieza en 1) la deja de PRIMERA en el repaso sin
  // necesitar navegar ni filtrar: nada se ha respondido todavía, así que el tramo 1 (respondidas)
  // está vacío y esta es la primera tarjeta del tramo 2 (sin responder) sin ambigüedad de orden.
  test('Ronda de corrección 2: en el repaso, una tarjeta NEUTRA (nunca respondida) con enunciado larguísimo SÍ deja tocarlo', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();

    const enunciadoLargo = 'Enunciado sintético deliberadamente absurdo, mucho más largo de lo que cabría nunca en una tarjeta neutra del repaso, pensado para forzar el recorte calculado del paso (d) de la cascada revelada. '.repeat(6);
    await page.evaluate((q) => window.__one.inyectarPregunta(q), {
      id: 'sintetico-repaso-neutra-enunciado', area: 'ciencia', tipo: 'vf', nivel: 0, respuesta: true,
      enunciado: enunciadoLargo, explicacion: 'Explicación cualquiera: no es lo que se prueba aquí.',
      confianza: 1, generador: 'manual', verificador: 'manual', verificado: true,
    });

    await abrirFeedRepaso(page);
    await expect(page.locator('[data-vista="repaso"]')).toBeVisible();
    await esperarAsentamientoMazo(page);

    const t = tarjetaActual(page);
    await expect(t).toHaveClass(/tarjeta--neutra/);
    expect(await t.getAttribute('data-respondida')).toBeNull(); // sin dataset.respondida, a propósito (app.js)

    const enunciado = t.locator('.enunciado');
    await expect(enunciado).toHaveClass(/enunciado--recortado/);
    await expect(enunciado).toHaveAttribute('role', 'button');
    await expect(enunciado).toHaveAttribute('tabindex', '0');

    await enunciado.click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-test="visual-completa-titulo"]')).toHaveText('Pregunta');
    await expect(overlay.locator('[data-test="visual-completa-texto"]')).toContainText('cascada revelada');
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('un deslizamiento que arranca en la explicación recortada (>10px) NO abre la superposición', async ({ page }) => {
    const t = await partidaConExplicacion(page, EXPLICACION_60, 'txt-desliz');
    const caja = await t.locator('[data-test="explicacion"]').boundingBox();
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    expect(await page.locator('[data-test="visual-completa"]').evaluate((el) => el.hidden)).toBe(true);
  });

  // Important #2 (Ronda de corrección 1): `.visual-completa` es `touch-action:none` entero (Critical
  // #1 de Tarea 3, imprescindible para que el cierre por deslizamiento reciba `pointerup` con un
  // gesto táctil real) -- sin distinguir, un dedo que arranca DENTRO del texto largo para leerlo
  // cerraba la superposición en cuanto se movía ≥60px verticales, aunque solo estuviera
  // desplazándose. Mismo patrón CDP que "Critical: cierra con un gesto táctil REAL" de la suite de
  // pantalla completa (Input.dispatchTouchEvent, no pointerdown/pointerup sintéticos).
  test('Important (Ronda de corrección 1): un arrastre táctil REAL dentro de un texto largo lo desplaza sin cerrar la superposición', async ({ page }) => {
    const EXPLICACION_600 = Array.from({ length: 600 }, (_, i) => `palabra${i}`).join(' ') + '.';
    const t = await partidaConExplicacion(page, EXPLICACION_600, 'txt-600-scroll');
    await t.locator('[data-test="explicacion"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    const textoLocator = page.locator('[data-test="visual-completa-texto"]');
    const caja = await textoLocator.boundingBox();
    expect(caja).not.toBeNull();
    const medida = await textoLocator.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    expect(medida.scrollH, 'el texto de 600 palabras debe desplazar de verdad').toBeGreaterThan(medida.clientH + 1);

    const cdp = await page.context().newCDPSession(page);
    const cx = Math.round(caja.x + caja.width / 2);
    const y0 = Math.round(caja.y + caja.height / 2);
    // Arrastre hacia ARRIBA (el contenido sube, como al leer hacia abajo) DENTRO del bloque de texto.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: y0 }] });
    for (let k = 1; k <= 8; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: y0 - k * 15 }] }); // 120px totales
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    expect(
      await textoLocator.evaluate((el) => el.scrollTop),
      'el arrastre dentro del texto debe desplazarlo de verdad, no quedarse en 0'
    ).toBeGreaterThan(0);
    expect(
      await overlay.evaluate((el) => el.hidden),
      'la superposición debe seguir abierta: el gesto era para leer, no para cerrar'
    ).toBe(false);
  });

  test('Important (Ronda de corrección 1): un arrastre táctil REAL que arranca FUERA del texto (el margen de la superposición) sigue cerrándola', async ({ page }) => {
    const EXPLICACION_600 = Array.from({ length: 600 }, (_, i) => `palabra${i}`).join(' ') + '.';
    const t = await partidaConExplicacion(page, EXPLICACION_600, 'txt-600-cierra');
    await t.locator('[data-test="explicacion"]').click();
    const overlay = page.locator('[data-test="visual-completa"]');
    await expect(overlay).toBeVisible();

    // El margen de `.visual-completa` (padding, fuera de `.visual-completa-texto`) sigue siendo
    // parte de la superposición: un arrastre que arranca ahí no toca nada de lo que hay que leer.
    const caja = await page.locator('[data-test="visual-completa-texto"]').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const cx = 8;
    const y0 = Math.round(caja.y + caja.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: y0 }] });
    for (let k = 1; k <= 8; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: y0 + k * 15 }] }); // 120px hacia abajo
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    expect(
      await overlay.evaluate((el) => el.hidden),
      'un arrastre que arranca fuera del texto debe seguir cerrando la superposición'
    ).toBe(true);
  });

  // Tarea 7: capturas del banco REAL (no el de ejemplo) para que Carlos las compare a ojo con las
  // suyas del iPhone -- mismo patrón que "capturas v0.1d" de más arriba. sospechosoPorTitulo se
  // construye desde datos/banco.json (no el .ejemplo.json de otros tests) porque art-091 es tipo
  // "error" del banco real: sin el mapa, responderPreguntaActual tocaría la fila 0 por defecto
  // (Guernica), una respuesta incorrecta para esta pregunta (el sospechoso real es la fila 2,
  // Fountain) que no es la que Carlos vio en su captura original.
  test('capturas v0.2a.2.1 para comparar con el iPhone de Carlos', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const banco = await page.evaluate(() => fetch('datos/banco.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(
      banco.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso])
    );

    // 1. Duchamp (art-091), la captura que Carlos mandó con la imagen al 25 %.
    await page.evaluate((url) => window.__one.forzarImagen('art-091', {
      id: 'art-091', url, pagina: 'https://commons.wikimedia.org/wiki/File:Duchamp_Fountaine.jpg',
      titulo: 'Duchamp Fountaine.jpg', autor: 'Marcel Duchamp', licencia: 'Public domain',
      leyenda: 'Fuente de Duchamp, readymade que cuestiona qué es arte', termino: 'x', ancho: 900, alto: 949,
    }), `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="949"><rect width="100%" height="100%" fill="#d8d4cc"/><circle cx="450" cy="480" r="300" fill="#f2efe9"/></svg>')}`);
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['art-091'], etiqueta: 'captura-duchamp' }));
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await esperarAsentamientoMazo(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.2a2.1-duchamp-375.png` });

    // 2. economía/ordenar (eco-089), la tarjeta tipográfica que Carlos llamó "muy mala".
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['eco-089'], etiqueta: 'captura-ordenar' }));
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await esperarAsentamientoMazo(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.2a2.1-ordenar-375.png` });

    // 3. gráfico de datos repartido en el hueco nuevo.
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['cie-008'], etiqueta: 'captura-grafico' }));
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await esperarAsentamientoMazo(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.2a2.1-grafico-375.png` });

    // 4. la explicación recortada, abierta a pantalla completa.
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['eco-091'], etiqueta: 'captura-texto' }));
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await esperarAsentamientoMazo(page);
    await tarjetaActual(page).locator('[data-test="explicacion"]').click();
    await expect(page.locator('[data-test="visual-completa"]')).toBeVisible();
    await page.screenshot({ path: `${CAPTURAS}/v0.2a2.1-texto-completo-375.png` });
    await page.keyboard.press('Escape');
  });
});

test.describe('ONE · v0.3 hoja del filtro', () => {
  test('el chip abre la hoja, Ciencia → átomo (sin servidor) → Elegir: la partida es solo de Ciencia; sin scroll a 375×812 y 375×667', async ({ page }) => {
    // Banco real (35 de ciencia): con el de ejemplo (2) la Tarea 7 mandaría al aviso de "menos de 5".
    await page.goto('/?test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    const chip = page.locator('[data-test="chip-filtro"]');
    await expect(chip).toHaveText('TODOS');

    await abrirHojaFiltro(page);
    await expect(page.locator('[data-test="filtro-todos"]')).toHaveAttribute('aria-pressed', 'true');
    await assertHojaSinScroll(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await assertHojaSinScroll(page);

    await page.locator('[data-test="filtro-area-ciencia"]').click();
    await expect(page.locator('[data-test="atomo"]')).toBeVisible();
    await expect(page.locator('[data-test="atomo-ruta"]')).toHaveText('Ciencia');
    await assertHojaSinScroll(page);
    await page.locator('[data-test="filtro-elegir"]').click();

    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(chip).toHaveText('Ciencia');
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Ciencia');
    await assertSinScroll(page);
  });

  test('cerrar (✕ o Escape) no cambia el filtro ni abandona la partida; el foco vuelve al chip', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await abrirHojaFiltro(page);
    await page.locator('[data-test="filtro-cerrar"]').click();
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(page.locator('[data-test="chip-filtro"]')).toBeFocused();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await abrirHojaFiltro(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
  });

  test('Atrás en el anillo 1 del átomo vuelve a la lista de áreas dentro de la hoja', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await abrirHojaFiltro(page);
    await elegirAreaEnFiltro(page, 'ciencia');
    const atras = page.locator('[data-test="atomo-atras"]');
    await expect(atras).toBeEnabled();
    await atras.click();
    await expect(page.locator('[data-test="atomo"]')).toBeHidden();
    await expect(page.locator('[data-test="filtro-areas"]')).toBeVisible();
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeVisible();
  });

  for (const alto of [812, 667]) test(`chip con subtema largo (375×${alto}): la cabecera no crece y racha/nivel no se parten`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: alto });
    await page.goto('/?ejemplo=1&test=1');
    const ids = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()).then((b) => b.slice(0, 2).map((p) => p.id)));
    await page.evaluate((lista) => window.__one.empezarPartida({ ids: lista, etiqueta: 'Economía · Mercados y crisis financieras' }), ids);
    await expect(page.locator('[data-test="chip-filtro"]')).toBeVisible();
    const cab = await page.locator('.cabecera').first().boundingBox();
    expect(cab.height).toBeLessThanOrEqual(92); // la banda de modo (avatar de 100 px con margen negativo) no crece con el chip largo
    const estado = await page.locator('.cabecera-estado').boundingBox();
    expect(estado.width).toBeGreaterThanOrEqual(36); // no aplastado (antes 30 px y 4 líneas)
    const racha = await page.locator('[data-test="racha"]').boundingBox();
    expect(racha.height).toBeLessThanOrEqual(26); // una sola línea
    await assertSinScroll(page);
  });

  test('chip con etiqueta larga: se recorta con … sin encoger la letra ni salirse de la pantalla', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    const ids = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()).then((b) => b.slice(0, 2).map((p) => p.id)));
    await page.evaluate((lista) => window.__one.empezarPartida({ ids: lista, etiqueta: 'Civilizaciones mesoamericanas precolombinas y su legado' }), ids);
    const chip = page.locator('[data-test="chip-filtro"]');
    await expect(chip).toHaveText('Civilizaciones mesoamericanas precolombinas y su legado');
    const medidas = await chip.evaluate((n) => ({
      fuente: getComputedStyle(n).fontSize, recortado: n.scrollWidth > n.clientWidth, derecha: n.getBoundingClientRect().right,
    }));
    expect(medidas.fuente).toBe('14px');
    expect(medidas.recortado).toBe(true);
    expect(medidas.derecha).toBeLessThanOrEqual(375);
    await assertSinScroll(page);
  });

  test('pocos elementos: Geografía (4 en el banco de ejemplo) → aviso; «Jugar las 4» juega solo esas; «Volver a TODOS» quita el filtro', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await abrirHojaFiltro(page);
    await elegirAreaEnFiltro(page, 'geografia');
    await page.locator('[data-test="filtro-elegir"]').click();
    await expect(page.locator('[data-vista="filtro-corto"]')).toBeVisible();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Solo hay 4 preguntas de Geografía');
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeDisabled(); // sin servidor
    await expect(page.locator('[data-test="filtro-corto-pista"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Geografía');
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await assertSinScroll(page);

    await page.locator('[data-test="filtro-corto-jugar"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Geografía');

    await page.locator('[data-test="volver"]').click();
    await page.locator('[data-test="modo-clasico"]').click();
    await page.locator('[data-test="filtro-corto-todos"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
  });

  test('segunda ronda del mismo día con filtro de área: «Jugar las 4» vuelve a jugar esas 4 (no rebota al hub)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
    await page.locator('[data-test="modo-clasico"]').click();
    await abrirHojaFiltro(page);
    await elegirAreaEnFiltro(page, 'geografia');
    await page.locator('[data-test="filtro-elegir"]').click();
    await page.locator('[data-test="filtro-corto-jugar"]').click();
    await jugarPartida(page, { sospechosoPorTitulo });
    await page.locator('[data-test="resumen-cifras"] [data-test="ir-inicio"]').click();
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Solo hay 4 preguntas de Geografía');
    await page.locator('[data-test="filtro-corto-jugar"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await expect(page.locator('[data-test="aviso-hub"]')).toBeHidden();
    await expect(tarjetaActual(page).locator('[data-test="nivel-pregunta"]')).toContainText('Geografía');
  });

  test('defensivo: Volver con la hoja del filtro abierta la cierra', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await abrirHojaFiltro(page);
    await page.evaluate(() => document.querySelector('[data-test="volver"]').click()); // el overlay tapa el botón: click programático
    await expect(page.locator('[data-test="hoja-filtro"]')).toBeHidden();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
  });

  test('Review Focus 3: un subtema guardado sin preguntas locales → aviso con 0, nunca partida vacía ni racha', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ clasico: { area: 'historia', ruta: ['Roma antigua y su imperio'], etiquetas: ['Roma'] } }));
    });
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Aún no hay preguntas de Historia · Roma');
    await expect(page.locator('[data-test="filtro-corto-jugar"]')).toBeHidden();
    await expect(page.locator('[data-test="resumen"]')).toBeHidden();
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 0');
    await assertSinScroll(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await assertSinScroll(page);
  });

  test('Repaso filtrado a Ciencia con 1 pendiente: aviso con «Repasar la 1», sin Generar; jugarla la recupera', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
    const idCiencia = bancoEjemplo.find((p) => p.area === 'ciencia').id;
    await page.evaluate((id) => window.__one.empezarPartida({ ids: [id], etiqueta: 'Prueba' }), idCiencia);
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    await page.locator('[data-test="volver"]').click();
    await page.evaluate(() => localStorage.setItem('one.filtros', JSON.stringify({ repaso: { area: 'ciencia', ruta: [], etiquetas: [] } })));
    await page.evaluate(() => window.__one.arrancarModo('repaso'));
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Solo hay 1 pendiente de Ciencia');
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeHidden();
    await page.locator('[data-test="filtro-corto-jugar"]').click(); // «Repasar la 1»
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Repaso · Ciencia');
    await responderPreguntaActual(page, sospechosoPorTitulo);
    await expect(tarjetaActual(page).locator('[data-test="recuperada"]')).toBeVisible();
  });
});

test.describe('ONE · v0.3 HUB de modos', () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
    test(`HUB ${viewport.width}×${viewport.height}: 6 tarjetas, nada del hub viejo, sin scroll y letra fija`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route('https://upload.wikimedia.org/**', (r) => r.abort()); // imagen rota: la tarjeta se ve igual
      await page.goto('/?ejemplo=1');
      await expect(page.locator('[data-test="hub-modos"] > .hub-modo')).toHaveCount(6);
      for (const id of ['clasico', 'repaso', 'ordago', 'masomenos', 'contrarreloj']) {
        await expect(page.locator(`[data-test="modo-${id}"]`)).toBeVisible();
      }
      await expect(page.locator('[data-test="comenzar"]')).toHaveCount(0);
      await expect(page.locator('[data-test="modo-clasico"]')).not.toHaveAttribute('aria-pressed', /.*/);
      await expect(page.locator('[data-test="marcador-clasico"]')).toHaveText('Hoy 0/0');
      await expect(page.locator('[data-test="marcador-repaso"]')).toHaveText('Al día');
      await expect(page.locator('[data-test="marcador-ordago"]')).toHaveText('Fondo 1.000');
      await expect(page.locator('[data-test="marcador-masomenos"]')).toHaveText('Sin récord');
      await expect(page.locator('[data-test="marcador-contrarreloj"]')).toHaveText('Sin marca');
      await expect(page.locator('[data-test="marcador-tienda"]')).toHaveText('🎒 0');
      await expect(page.locator('[data-test="tarjeta-tienda"] canvas.avatar-lienzo, [data-test="tarjeta-tienda"] img.avatar-fijo')).toHaveCount(1);
      await expect(page.locator('header canvas, header img')).toHaveCount(0); // el hub no lleva esfinge en la cabecera
      await expect(page.locator('[data-test="silencio"]')).toBeVisible();
      for (const quitado of ['mision', 'pendientes', 'repaso-hub', 'kpi-aciertos-hoy', 'recuperadas', 'practicar-economia']) {
        await expect(page.locator(`[data-test="${quitado}"]`)).toHaveCount(0);
      }
      await assertSinScroll(page);
      const fuentes = await page.locator('.hub-modo-nombre').evaluateAll((ns) => ns.map((n) => getComputedStyle(n).fontSize));
      expect(new Set(fuentes)).toEqual(new Set(['16px']));
      await page.screenshot({ path: `${CAPTURAS}/v0.3-hub-${viewport.width}x${viewport.height}.png` });
    });
  }

  test('Repaso sin falladas avisa «Nada por repasar» sin navegar', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await entrarEnModo(page, 'repaso');
    await expect(page.locator('[data-test="aviso-hub"]')).toHaveText('Nada por repasar');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
  });

  test('v0.3 fase 3: tocar una tarjeta lleva a su modo; ninguna es «Pronto»; sin Comenzar', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-test="comenzar"]')).toHaveCount(0);
    await expect(page.locator('[data-test="hub-modos"] [aria-disabled="true"]')).toHaveCount(0);
    await expect(page.locator('[data-test="hub-modos"]')).not.toContainText('Pronto');
    await page.locator('[data-test="modo-clasico"]').dblclick();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    for (const vp of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
      await page.setViewportSize(vp);
      await page.locator('[data-test="volver"]').click();
      await assertSinScroll(page);
      await page.locator('[data-test="modo-clasico"]').click();
      await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    }
  });

  test('Review Focus 4: 375×667 con aviso de tanda generada, chip de nuevas y aviso del hub a la vez: sin scroll ni solapes con las tarjetas', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await page.evaluate(() => {
      window.__one.simularTandaLista({ ids: ['eco-001'], corto: 'Mercados y crisis financieras' });
      window.__one.mostrarChipNuevas(14, ['eco-001']);
    });
    await page.locator('[data-test="modo-repaso"]').click(); // sin falladas: avisa «Nada por repasar» sin navegar
    await expect(page.locator('[data-test="aviso-hub"]')).toBeVisible();
    await assertSinScroll(page);
    const solapes = await page.evaluate(() => {
      const caja = (sel) => document.querySelector(sel).getBoundingClientRect();
      const se = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const modos = caja('[data-test="hub-modos"]');
      // El aviso de tanda generada es una banda superpuesta por diseño (se cierra solo a los 20 s):
      // lo que no debe hacer es solapar a los otros dos avisos entre sí ni a las tarjetas.
      return ['[data-test="nuevas-servidor"]', '[data-test="aviso-hub"]']
        .filter((sel) => se(caja(sel), modos));
    });
    expect(solapes).toEqual([]);
  });

  test('silencio: alterna 🔊/🔇 con aria-pressed y persiste tras recargar', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    const boton = page.locator('[data-test="silencio"]');
    await expect(boton).toHaveText('🔊');
    await boton.click();
    await expect(boton).toHaveText('🔇');
    await expect(boton).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('[data-test="silencio"]')).toHaveText('🔇');
  });

  test('Exportar descarga un respaldo v3 con modos; Importar acepta un respaldo v2 antiguo (Review Focus 5)', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="silencio"]').click();
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('[data-test="exportar"]').click()]);
    const respaldo = JSON.parse(await (await descarga.createReadStream()).toArray().then((t) => Buffer.concat(t).toString('utf8')));
    expect(respaldo.version).toBe(3);
    expect(respaldo.estado.version).toBe(2);
    expect(respaldo.modos['one.silencio']).toBe('1');

    // Respaldo v2 tal cual lo exportaba la app hasta v0.2 (motor.exportar), construido con el propio motor.
    const v2 = await page.evaluate(() =>
      import('./motor.js').then((m) => {
        const e = m.crearEstado('2026-10-05');
        e.racha = { dias: 7, ultimaFecha: null };
        return m.exportar(e);
      })
    );
    await page.locator('#importar-archivo').setInputFiles({ name: 'viejo.json', mimeType: 'application/json', buffer: Buffer.from(v2) });
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 7');
    await expect(page.locator('[data-test="hub-modos"] > .hub-modo')).toHaveCount(6);
  });

  test('Importar un respaldo v3 con basura en modos: el estado entra y la clave vieja one.ultimoModo se ignora', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    const v3 = await page.evaluate(() =>
      import('./motor.js').then((m) => {
        const e = m.crearEstado('2026-10-05');
        e.racha = { dias: 5, ultimaFecha: null };
        return JSON.stringify({ version: 3, estado: JSON.parse(m.exportar(e)), modos: { 'one.ultimoModo': 'inexistente', 'one.silencio': 7, 'otra.clave': 'x' } });
      })
    );
    await page.locator('#importar-archivo').setInputFiles({ name: 'basura.json', mimeType: 'application/json', buffer: Buffer.from(v3) });
    await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 5');
    expect(await page.evaluate(() => localStorage.getItem('one.ultimoModo'))).toBeNull();
    await expect(page.locator('[data-test="hub-modos"] > .hub-modo')).toHaveCount(6);
  });

  test('Créditos: las 6 imágenes del hub con fuente, autor y licencia (5 con enlace; Órdago es IA); cierra con Escape; cabe a 375×667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1');
    await page.locator('[data-test="abrir-creditos"]').click();
    const hoja = page.locator('[data-test="creditos"]');
    await expect(hoja).toBeVisible();
    await expect(hoja.locator('li')).toHaveCount(6);
    await expect(hoja.locator('a[href^="https://"]')).toHaveCount(5);
    await expect(hoja.locator('a[href^="https://commons.wikimedia.org/wiki/File:"]').first()).toHaveText('Commons · LitterART · CC BY-SA 4.0');
    await expect(hoja).toContainText('Openverse');
    await expect(hoja).toContainText('Tienda');
    await expect(hoja).toContainText('Imagen generada con IA');
    const medidas = await hoja.evaluate((h) => ({ alto: h.scrollHeight, visible: h.clientHeight, arriba: h.getBoundingClientRect().top }));
    expect(medidas.alto).toBeLessThanOrEqual(medidas.visible + 2);
    expect(medidas.arriba).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(hoja).toBeHidden();
  });

  for (const viewport of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
    test(`silencio persistente (spec §7): visible y pulsable en partida con una tanda generada pendiente (el aviso no se enseña), sin solape de cabecera, ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1&test=1');
      await entrarEnModo(page, 'clasico');
      await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
      const boton = page.locator('[data-test="silencio"]');
      await expect(boton).toBeVisible();
      await boton.click();
      await expect(boton).toHaveAttribute('aria-pressed', 'true');
      await boton.click();
      await expect(boton).toHaveAttribute('aria-pressed', 'false');
      await page.evaluate(() => window.__one.simularTandaLista({ ids: ['eco-001'], corto: 'Mercados y crisis financieras' }));
      await expect(page.locator('[data-test="aviso-generadas"]')).toBeHidden();
      await expect(boton).toBeVisible();
      await esperarAsentamientoMazo(page);
      await assertSinSolapeCabecera(page);
      const dentro = await boton.evaluate((n) => {
        const c = n.getBoundingClientRect();
        return c.left >= 0 && c.right <= document.documentElement.clientWidth;
      });
      expect(dentro).toBe(true);
      await boton.click(); // pulsable: no lo tapa nada
      await expect(boton).toHaveAttribute('aria-pressed', 'true');
    });
  }

  for (const viewport of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
    test(`Tienda ${viewport.width}×${viewport.height}: la tarjeta abre la vista con la mochila, sin scroll, ← vuelve al hub y no quedan «Esfinge» ni «Apuesta»`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1');
      await expect(page.locator('[data-test="tarjeta-tienda"]')).toContainText('Tienda');
      await expect(page.locator('body')).not.toContainText('Apuesta');
      await expect(page.locator('body')).not.toContainText('Esfinge');
      await page.locator('[data-test="tarjeta-tienda"]').dblclick(); // doble toque rápido: una sola vista
      await expect(page.locator('[data-vista="tienda"]')).toBeVisible();
      await expect(page.locator('[data-vista="tienda"]')).toContainText('Tienda');
      await expect(page.locator('[data-test="tienda-avatar"] canvas.avatar-lienzo, [data-test="tienda-avatar"] img.avatar-fijo')).toHaveCount(1);
      for (const id of ['cincuenta', 'salvavidas', 'mas5']) {
        await expect(page.locator(`[data-test="tienda-cantidad-${id}"]`)).toHaveText('Tienes 0');
      }
      await expect(page.locator('[data-test="tienda-objeto-salvavidas"]')).toContainText('🛟');
      await expect(page.locator('body')).not.toContainText('Apuesta');
      await expect(page.locator('body')).not.toContainText('Esfinge');
      expect(await page.locator('[data-vista="tienda"]').evaluate((n) => getComputedStyle(n).rowGap)).toBe('14px');
      // El silencio no se desplaza fuera de la tanda (margin-left auto solo con .cabecera--con-tanda).
      expect(await page.locator('[data-test="silencio"]').evaluate((n) => getComputedStyle(n).marginLeft)).toBe('0px');
      await assertSinScroll(page);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    });
  }

  test('Tienda: la cantidad refleja la mochila guardada', async ({ page }) => {
    await page.goto('/?ejemplo=1');
    await page.evaluate(() => localStorage.setItem('one.mochila', JSON.stringify({ version: 1, objetos: { cincuenta: 2, salvavidas: 1, mas5: 0 } })));
    await page.reload();
    await expect(page.locator('[data-test="marcador-tienda"]')).toHaveText('🎒 3');
    await page.locator('[data-test="tarjeta-tienda"]').click();
    await expect(page.locator('[data-test="tienda-cantidad-cincuenta"]')).toHaveText('Tienes 2');
    await expect(page.locator('[data-test="tienda-cantidad-salvavidas"]')).toHaveText('Tienes 1');
  });
});

test.describe('ONE · v0.3 Clásico con efectos, sonido y premio', () => {
  test('acierto: ding + gesto «acierto» + salto; fallo: golpe + gesto «triste»', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
    await page.locator('body').click({ position: { x: 5, y: 5 } }); // primer gesto: desbloquea el audio
    await expect.poll(() => page.evaluate(() => window.__one.estadoAudio())).toBe('running');
    await responderPreguntaActual(page, sospechosoPorTitulo);
    expect((await page.evaluate(() => window.__one.gestosPedidos)).at(-1)).toBe('acierto');
    await expect(tarjetaActual(page).locator('.tarjeta-contenido')).toHaveClass(/efecto-acierto/);
    expect(await page.evaluate(() => window.__one.sonidos())).toContain('ding');
    await avanzarTrasRespuesta(page);
    await fallarPreguntaActual(page, sospechosoPorTitulo);
    expect((await page.evaluate(() => window.__one.gestosPedidos)).at(-1)).toBe('triste');
    expect(await page.evaluate(() => window.__one.sonidos())).toContain('golpe');
    await assertSinScroll(page);
    await assertTarjetaSinScroll(page);
  });

  for (const alto of [812, 667]) {
    test(`tanda de 10 con 10 aciertos (375×${alto}): premio de 1 objeto en el resumen, confeti, fanfarria y 🎒 1 en el hub`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: alto });
      await page.goto('/?ejemplo=1&test=1');
      await page.locator('[data-test="modo-clasico"]').click();
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
      const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
      await jugarPartida(page, { sospechosoPorTitulo });
      await expect(page.locator('[data-test="resumen"]')).toBeVisible();
      await expect(page.locator('[data-test="premio"]')).toContainText('¡Premio! +1');
      await expect(page.locator('[data-test="confeti"]')).toHaveCount(1);
      expect(await page.evaluate(() => window.__one.sonidos())).toContain('fanfarria');
      await assertSinScroll(page);
      await assertTarjetaSinScroll(page);
      expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('one.mochila')).objetos).reduce((a, b) => a + b, 0))).toBe(1);
      await page.locator('[data-test="resumen-cifras"] [data-test="ir-inicio"]').click();
      await expect(page.locator('[data-test="marcador-tienda"]')).toHaveText('🎒 1');
    });
  }

  // Reglas del premio (Carlos, 6-oct): solo Clásico con 10/10; con 9 no hay; Repaso nunca da premio.
  async function jugarTandaConFallos(page, sospechosoPorTitulo, fallos) {
    for (let i = 0; i < 10; i += 1) {
      if (i < fallos) await fallarPreguntaActual(page, sospechosoPorTitulo);
      else await responderPreguntaActual(page, sospechosoPorTitulo);
      await avanzarTrasRespuesta(page);
    }
    await expect(page.locator('[data-test="resumen"]')).toBeVisible();
  }

  async function sospechososDelBanco(page) {
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    return new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
  }

  test('Clásico 9/10: sin premio ni objeto en la mochila', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await jugarTandaConFallos(page, await sospechososDelBanco(page), 1);
    await expect(page.locator('[data-test="premio"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('one.mochila'))).toBeNull();
  });

  test('si guardar la mochila falla, el objeto vive en memoria: el resumen lo anuncia y la Tienda lo cuenta', async ({ page }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'one.mochila') throw new Error('QuotaExceededError');
        return original.call(this, k, v);
      };
    });
    await page.goto('/?ejemplo=1&test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await jugarTandaConFallos(page, await sospechososDelBanco(page), 0);
    await expect(page.locator('[data-test="premio"]')).toHaveCount(1);
    await page.locator('[data-test="ir-inicio"]').click();
    await page.waitForTimeout(450);
    await page.locator('[data-test="tarjeta-tienda"]').click();
    const cantidades = await page.locator('.tienda-objeto-cantidad').allTextContents();
    expect(cantidades.reduce((suma, t) => suma + Number(t.replace('Tienes ', '')), 0)).toBe(1);
  });

  test('Repaso 10/10: nunca da premio', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    const sospechosoPorTitulo = await sospechososDelBanco(page);
    await jugarTandaConFallos(page, sospechosoPorTitulo, 10); // 10 pendientes
    const final = await recorrerRepasoHastaFinal(page);
    await final.locator('[data-test="ir-inicio"]').click();
    await entrarEnRepaso(page);
    await jugarTandaConFallos(page, sospechosoPorTitulo, 0);
    await expect(page.locator('[data-test="premio"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('one.mochila'))).toBeNull();
  });

  test('con reducir movimiento: premio sí, confeti no', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
    await jugarPartida(page, { sospechosoPorTitulo });
    await expect(page.locator('[data-test="premio"]')).toBeVisible();
    await expect(page.locator('[data-test="confeti"]')).toHaveCount(0);
  });
});

test('v0.3 fase 3: ONE abre directamente en el hub, sin pantalla 🧠/💪 y sin «←» en el hub', async ({ page }) => {
  await page.goto('/?ejemplo=1&test=1');
  await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
  await expect(page.locator('[data-vista="inicio"]')).toHaveCount(0);
  await expect(page.locator('[data-test="cerebro"]')).toHaveCount(0);
  await expect(page.locator('[data-test="volver"]')).toBeHidden();
  await page.locator('[data-test="modo-clasico"]').click();
  await expect(page.locator('[data-test="volver"]')).toBeVisible();
  await page.locator('[data-test="volver"]').click();
  await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
  await expect(page.locator('[data-test="volver"]')).toBeHidden();
  for (const vp of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(vp);
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await assertSinScroll(page);
  }
});

test.describe('ONE · v0.3 aviso grande «Preguntas generadas» e insignia PREMIUM (Tarea 3.5)', () => {
  const IDS = ['eco-001', 'eco-002', 'eco-003'];
  const simular = (page) => page.evaluate((ids) => window.__one.simularTandaLista({ ids, corto: 'Roma' }), IDS);

  test('aviso visible en el hub, alto > 1/8 de pantalla a 375×812, sin scroll; tocarlo juega exactamente esas preguntas y borra la clave', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await simular(page);
    const aviso = avisoGeneradas(page);
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Preguntas generadas');
    await expect(aviso).toContainText('Roma');
    const caja = await aviso.boundingBox();
    expect(caja.height).toBeGreaterThan(812 / 8);
    expect(Math.round(caja.y + caja.height)).toBe(812);
    const cierre = await page.locator('[data-test="aviso-generadas-cerrar"]').boundingBox();
    expect(cierre.width).toBeGreaterThanOrEqual(44);
    expect(cierre.height).toBeGreaterThanOrEqual(44);
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.3-aviso-generadas-375x812.png` });

    await jugarAviso(page).click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/3');
    await expect(aviso).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('one.avisoGeneradas'))).toBeNull();
  });

  test('sin scroll a 375×667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await simular(page);
    await expect(avisoGeneradas(page)).toBeVisible();
    await assertSinScroll(page);
  });

  test('durante una partida el aviso no se ve; al acabarla (resumen) aparece', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible(); // el banco ya está cargado
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['eco-001'], etiqueta: 'Una' }));
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await simular(page);
    await expect(avisoGeneradas(page)).toBeHidden();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('one.avisoGeneradas'))).not.toBeNull();
    await responderPreguntaActual(page);
    await avanzarTrasRespuesta(page);
    await expect(page.locator('[data-vista="resumen"]')).toBeVisible();
    await expect(avisoGeneradas(page)).toBeVisible();
  });

  test('con la app en segundo plano no se muestra; al volver a primer plano aparece', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      window.__one.simularTandaLista({ ids: ['eco-001', 'eco-002'], corto: 'Roma' });
    });
    await expect(avisoGeneradas(page)).toBeHidden();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(avisoGeneradas(page)).toBeVisible();
  });

  test('recargar con el aviso pendiente lo mantiene en el hub; ✕ lo quita y no vuelve tras recargar', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await simular(page);
    await expect(avisoGeneradas(page)).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(avisoGeneradas(page)).toBeVisible();
    await expect(avisoGeneradas(page)).toContainText('Roma');
    await page.locator('[data-test="aviso-generadas-cerrar"]').click();
    await expect(avisoGeneradas(page)).toBeHidden();
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(avisoGeneradas(page)).toBeHidden();
  });

  test('insignia PREMIUM en los dos botones «Generar preguntas»', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-test="filtro-corto-generar"] [data-test="insignia-premium"]')).toHaveCount(1);
    await expect(page.locator('[data-test="atomo-generar"] [data-test="insignia-premium"]')).toHaveCount(1);
    await expect(page.locator('[data-test="insignia-premium"]').first()).toHaveText('PREMIUM');
  });
});

test.describe('ONE · v0.3 avatar: la esfinge v2 (fase 4)', () => {
  const reproductores = (page) => page.locator('canvas.avatar-lienzo, img.avatar-fijo');

  test('un solo reproductor de esfinge por pantalla y del tamaño pedido', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(reproductores(page)).toHaveCount(1); // el hub: solo la tarjeta Tienda
    await expect(page.locator('[data-test="tarjeta-tienda"] canvas.avatar-lienzo, [data-test="tarjeta-tienda"] img.avatar-fijo')).toHaveCount(1);
    await entrarEnModo(page, 'clasico');
    await expect(reproductores(page)).toHaveCount(1);
    const caja = await page.locator('[data-test="avatar-cabecera"]').boundingBox();
    expect(caja.height).toBeGreaterThanOrEqual(96);
    expect(caja.height).toBeLessThanOrEqual(120);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('saludo');
    await page.locator('[data-test="volver"]').click();
    await page.locator('[data-test="tarjeta-tienda"]').click();
    await expect(page.locator('[data-vista="tienda"]')).toBeVisible();
    await expect(reproductores(page)).toHaveCount(1); // la Tienda: el protagonista, y el de la tarjeta ya destruido
    await expect(page.locator('[data-test="tienda-avatar"] canvas.avatar-lienzo, [data-test="tienda-avatar"] img.avatar-fijo')).toHaveCount(1);
    for (const vp of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
      const lado = await page.locator('[data-test="tienda-avatar"] .avatar-lienzo').evaluate((c) => c.getBoundingClientRect().height);
      expect(lado).toBeGreaterThanOrEqual(96);
      expect(lado).toBeLessThanOrEqual(100); // v0.3.3: la esfinge de la Tienda es de 100 px fijos, no llena el hueco
    }
  });

  test('20 idas y vueltas hub-Tienda no agotan los contextos WebGL de Chrome', async ({ page }) => {
    test.setTimeout(120000);
    const avisos = [];
    page.on('console', (m) => { if (/Too many active WebGL contexts/i.test(m.text())) avisos.push(m.text()); });
    await page.addInitScript(() => { // guarda cada contexto WebGL creado para contar los que siguen vivos
      window.__contextos = [];
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (tipo, ...resto) {
        const ctx = original.call(this, tipo, ...resto);
        if (ctx && /webgl/.test(tipo) && !window.__contextos.includes(ctx)) window.__contextos.push(ctx);
        return ctx;
      };
    });
    await page.goto('/?ejemplo=1&test=1');
    for (let i = 0; i < 20; i += 1) {
      await page.locator('[data-test="tarjeta-tienda"]').click();
      await expect(page.locator('[data-vista="tienda"]')).toBeVisible();
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-test="tarjeta-tienda"]')).toBeVisible();
    }
    expect(avisos).toEqual([]);
    const vivos = await page.evaluate(() => window.__contextos.filter((c) => !c.isContextLost()).length);
    expect(vivos).toBeLessThanOrEqual(2); // el de la tarjeta actual; los de las 20 vueltas, liberados
  });

  test('acertar pide el gesto «acierto» y la esfinge no se vuelve a montar', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'clasico');
    await expect(reproductores(page)).toHaveCount(1);
    const lienzo = await page.locator('[data-test="avatar-cabecera"] canvas').elementHandle();
    const bancoEjemplo = await page.evaluate(() => fetch('datos/banco.ejemplo.json').then((r) => r.json()));
    const sospechosoPorTitulo = new Map(bancoEjemplo.filter((p) => p.tipo === 'error').map((p) => [p.tarjeta.titulo, p.sospechoso]));
    await responderPreguntaActual(page, sospechosoPorTitulo); // las de «error» no tienen la correcta en la fila 0
    const gestos = await page.evaluate(() => window.__one.gestosPedidos);
    expect(gestos).toContain('acierto');
    expect(await lienzo.evaluate((c) => c.isConnected)).toBe(true); // misma esfinge, sin remontar
  });

  test('pensando: a los 8 s sin responder la esfinge lo pide, y responder lo detiene', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'clasico');
    await expect.poll(() => page.evaluate(() => window.__one.gestosPedidos), { timeout: 12000 }).toContain('pensando');
    await page.evaluate(() => window.__one.gestosPedidos.splice(0));
    await responderPreguntaActual(page);
    await page.waitForTimeout(9000);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).not.toContain('pensando');
  });

  test('sin vídeo (autoplay bloqueado), la esfinge sale como imagen fija (nunca un hueco)', async ({ page }) => {
    await page.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new Error('bloqueado')); });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('img.avatar-fijo')).toBeVisible();
    await expect(page.locator('img.avatar-fijo')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('img.avatar-fijo')).toHaveAttribute('alt', '');
  });

  test('con reducir movimiento no se pide ningún vídeo', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const pedidos = [];
    page.on('request', (r) => { if (r.url().endsWith('.mp4')) pedidos.push(r.url()); });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('img.avatar-fijo')).toBeVisible();
    await entrarEnModo(page, 'clasico');
    await expect(page.locator('img.avatar-fijo')).toBeVisible();
    expect(pedidos).toEqual([]);
  });

  test('el hub no lleva avatar en la cabecera y la esfinge no es texto accesible', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('header canvas, header img.avatar-fijo')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Esfinge');
  });

  test('con el service worker activo el vídeo sigue funcionando y los gestos quedan en la caché', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator('[data-test="tarjeta-tienda"] canvas.avatar-lienzo')).toHaveCount(1);
    expect(await page.evaluate(async () => Boolean(await caches.match('avatar/reposo.mp4')))).toBe(true);
    await entrarEnModo(page, 'clasico'); // pide `saludo`: se descarga y se guarda al primer uso
    await expect.poll(() => page.evaluate(async () => Boolean(await caches.match('avatar/saludo.mp4'))), { timeout: 15000 }).toBe(true);
    await expect(page.locator('[data-test="avatar-cabecera"] canvas.avatar-lienzo')).toHaveCount(1);
  });
});

test.describe('ONE · v0.3 Órdago (fase 5)', () => {
  const URL_SERVIDOR_ORDAGO = 'https://servidor.prueba';
  const TOKEN_ORDAGO = 'token-de-prueba-e2e-1234567890';
  const CORS_ORDAGO = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const VIEWPORTS = [{ width: 375, height: 812 }, { width: 375, height: 667 }];
  const VIEWPORTS_ORDAGO_HUB = VIEWPORTS;
  const sinScrollEnAmbos = async (page) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
    }
  };

  // Tras cada cambio de panel los botones ignoran toques durante 350 ms (antirrebote contra el doble toque).
  const esperarAntirrebote = (page) => page.waitForTimeout(450);

  /** Una ronda con los ganchos de test: ficha, respuesta (acertada o fallada) y, si se pide, «Siguiente». */
  async function jugarRondaOrdago(page, { ficha = '10', acertar = true, siguiente = true } = {}) {
    await esperarAntirrebote(page);
    await page.locator(`[data-test="ficha-${ficha}"]`).click();
    await page.evaluate((a) => (a ? window.__one.acertarPreguntaOrdago() : window.__one.fallarPreguntaOrdago()), acertar);
    await expect(page.locator('[data-test="ordago-resultado"]')).toBeVisible();
    if (siguiente) {
      await esperarAntirrebote(page);
      await page.locator('[data-test="ordago-siguiente"]').click();
    }
  }

  test('Órdago: foto con enunciado, ficha, respuesta, cobro, nivel ≥ 3, quiebra y fondo nuevo (sin scroll a 375×812 y 375×667)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible();
    await expect(page.locator('[data-test="ordago-fondo"]')).toHaveText('1.000');
    await expect(page.locator('[data-test="ordago-opciones"]')).toBeHidden();
    await expect(page.locator('[data-test="foto-pregunta-enunciado"]')).toBeVisible(); // enunciado encima de la foto
    await expect(page.locator('[data-test="ficha-10"]')).toContainText('100');
    await expect(page.locator('[data-test="ficha-ordago"]')).toContainText('1.000');
    // Cada ficha enseña lo que GANARÍA al acertar (la ficha vuelve multiplicada): ficha × (base − 1), base 1,5/1,6/1,7
    // según el nivel 3/4/5, sin el factor dorada (aún no se conoce) ni racha. La dorada no se ve antes de elegir ficha.
    const nivelFicha = await page.evaluate(() => window.__one.ultimaPreguntaOrdago().nivel);
    const textoFicha = await page.locator('[data-test="ficha-10"]').innerText();
    expect(textoFicha).toMatch(/→ \+\d/);
    const ganaFicha = Number((textoFicha.match(/→ \+([\d.]+)/)[1]).replace(/\./g, ''));
    expect(ganaFicha).toBe({ 3: 50, 4: 60, 5: 70 }[nivelFicha]);
    await expect(page.locator('[data-test="foto-pregunta"]')).not.toHaveClass(/foto-pregunta--dorada/);
    await expect(page.locator('[data-test="ordago-fichas"]')).toContainText('Si sales, la pierdes');
    await expect(page.locator('[data-test="nivel-partida"]')).toBeHidden(); // el «Nivel N» de la partida clásica no contradice al de la pregunta
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1); // un solo reproductor por pantalla
    expect(await page.evaluate(() => window.__one.ultimaPreguntaOrdago().nivel)).toBeGreaterThanOrEqual(3);
    await sinScrollEnAmbos(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-10"]').click();
    await expect(page.locator('[data-test="ordago-opciones"]')).toBeVisible();
    await expect(page.locator('[data-test="ficha-10"]')).toBeHidden();
    await sinScrollEnAmbos(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-opciones"] button').first().click();
    await expect(page.locator('[data-test="ordago-delta"]')).toHaveText(/^[+−]\d+/);
    await expect(page.locator('[data-test="ordago-explicacion"]')).toContainText('Respuesta:');
    await sinScrollEnAmbos(page);
    // Órdago y fallo a propósito: quiebra.
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-siguiente"]').click();
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-ordago"]').click();
    await page.evaluate(() => window.__one.fallarPreguntaOrdago());
    await expect(page.locator('[data-test="ordago-delta"]')).toHaveText(/^−\d+/);
    await expect(page.locator('[data-test="ordago-siguiente"]')).toHaveText('Continuar');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-siguiente"]').click();
    await expect(page.locator('[data-vista="quiebra"]')).toBeVisible();
    await expect(page.locator('[data-test="quiebra-maximo"]')).toContainText('Máximo alcanzado');
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1); // la misma esfinge de la banda
    await sinScrollEnAmbos(page);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('triste');
    await esperarAntirrebote(page);
    await page.locator('[data-test="quiebra-fondo-nuevo"]').click();
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible();
    await expect(page.locator('[data-test="ordago-fondo"]')).toHaveText('1.000');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago')).quiebras)).toBe(1);
  });

  test('Órdago: solo sirve V/F o test4 de nivel 3-5 durante 12 rondas', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    for (let i = 0; i < 12; i += 1) {
      const pregunta = await page.evaluate(() => window.__one.ultimaPreguntaOrdago());
      expect(pregunta.nivel).toBeGreaterThanOrEqual(3);
      expect(['vf', 'test4']).toContain(pregunta.tipo);
      // Ficha mínima para no llegar a la quiebra por azar; se alterna acierto y fallo.
      await jugarRondaOrdago(page, { ficha: '10', acertar: i % 3 !== 2 });
    }
  });

  test('Review Focus 2: doble toque en la ficha y en la respuesta apuesta y responde una sola vez', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    // El segundo toque de cada doble toque cae sobre el botón nuevo que aparece en el mismo sitio: no cuenta.
    await page.locator('[data-test="ficha-25"]').dblclick();
    await expect(page.locator('[data-test="ordago-opciones"]')).toBeVisible();
    await expect(page.locator('[data-test="ordago-resultado"]')).toBeHidden();
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-opciones"] button').first().dblclick();
    await expect(page.locator('[data-test="ordago-resultado"]')).toBeVisible();
    const guardado = await page.evaluate(() => ({
      ordago: JSON.parse(localStorage.getItem('one.ordago')),
      respondidas: JSON.parse(localStorage.getItem('one.estado')).hoy.respondidas,
    }));
    expect(guardado.respondidas).toBe(1); // registrarRespuesta una sola vez
    expect(guardado.ordago.curva.length).toBe(2); // una sola ronda resuelta
    const delta = Math.abs(guardado.ordago.fondo - 1000);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(250 * 1.55 + 1); // una ficha del 25 %: gana como mucho ficha × (1,7 × 1,5 − 1)
    // «Siguiente» con doble toque tampoco se salta una pregunta.
    const antes = await page.evaluate(() => window.__one.ultimaPreguntaOrdago().id);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-siguiente"]').dblclick();
    await expect(page.locator('[data-test="ordago-fichas"]')).toBeVisible();
    await expect(page.locator('[data-test="ordago-opciones"]')).toBeHidden(); // la ficha no se eligió con el segundo toque
    const despues = await page.evaluate(() => window.__one.ultimaPreguntaOrdago().id);
    expect(despues).not.toBe(antes);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).hoy.respondidas)).toBe(1);
  });

  const leerOrdago = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago')));

  test('Elegir ficha compromete: recargar antes de responder pierde la ficha (racha a 0) una sola vez', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await jugarRondaOrdago(page, { ficha: '10', acertar: true });
    const antes = await leerOrdago(page);
    expect(antes.racha).toBe(1);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-25"]').click();
    const apuesta = Math.floor(antes.fondo * 0.25);
    expect((await leerOrdago(page)).pendiente).toMatchObject({ ficha: apuesta }); // la ronda queda comprometida en lo guardado
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await entrarEnModo(page, 'ordago');
    const despues = await leerOrdago(page);
    expect(despues.fondo).toBe(antes.fondo - apuesta);
    expect(despues.racha).toBe(0);
    expect(despues.pendiente).toBeNull();
    await page.waitForTimeout(450);
    await page.reload(); // una segunda recarga no vuelve a cobrar
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    expect((await leerOrdago(page)).fondo).toBe(antes.fondo - apuesta);
  });

  test('Elegir ficha compromete: salir con «←» tras elegir ficha la pierde; recargar después de responder no cobra dos veces', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-10"]').click();
    await expect(page.locator('[data-test="ordago-opciones"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const salida = await leerOrdago(page);
    expect(salida.fondo).toBe(900);
    expect(salida.pendiente).toBeNull();
    // Antes de elegir ficha, salir es gratis.
    await page.waitForTimeout(450);
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    await page.locator('[data-test="volver"]').click();
    expect((await leerOrdago(page)).fondo).toBe(900);
    // Respondida la ronda, recargar no la cobra otra vez.
    await page.waitForTimeout(450);
    await entrarEnModo(page, 'ordago');
    await jugarRondaOrdago(page, { ficha: '10', acertar: true, siguiente: false });
    const tras = await leerOrdago(page);
    expect(tras.pendiente).toBeNull();
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    expect((await leerOrdago(page)).fondo).toBe(tras.fondo);
  });

  test('Elegir ficha y recargar: la ficha ya está cobrada en el hub y en la Tienda (no se esquiva comprando) y Órdago no la cobra otra vez', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-50"]').click();
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    const tras = await leerOrdago(page);
    expect(tras.fondo).toBe(500); // hub: la ficha se cobró al arrancar, sin entrar en Órdago
    expect(tras.pendiente).toBeNull();
    await page.locator('[data-test="tarjeta-tienda"]').click();
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('500');
    await page.locator('[data-test="volver"]').click();
    await entrarEnModo(page, 'ordago');
    expect((await leerOrdago(page)).fondo).toBe(500); // Órdago al montarse no la cobra otra vez
  });

  test('Quiebra: un fondo nuevo gratis al día; ya usado, «Vuelve mañana» (con objetos, también «Vender objetos → Tienda»)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.evaluate(() => window.__one.sembrarMochila({ cincuenta: 1 }));
    await entrarEnModo(page, 'ordago');
    const quebrar = async () => {
      await esperarAntirrebote(page);
      await page.locator('[data-test="ficha-ordago"]').click();
      await page.evaluate(() => window.__one.fallarPreguntaOrdago());
      await esperarAntirrebote(page);
      await page.locator('[data-test="ordago-siguiente"]').click();
      await expect(page.locator('[data-vista="quiebra"]')).toBeVisible();
    };
    await quebrar();
    await expect(page.locator('[data-test="quiebra-fondo-nuevo"]')).toBeVisible();
    await expect(page.locator('[data-test="quiebra-manana"]')).toBeHidden();
    await esperarAntirrebote(page);
    await page.locator('[data-test="quiebra-fondo-nuevo"]').click();
    await expect(page.locator('[data-test="ordago-fondo"]')).toHaveText('1.000');
    const hoyGuardado = (await leerOrdago(page)).fondoNuevoDia;
    expect(hoyGuardado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Segunda quiebra el mismo día: ni fondo nuevo ni nada gratis.
    await quebrar();
    await expect(page.locator('[data-test="quiebra-fondo-nuevo"]')).toBeHidden();
    await expect(page.locator('[data-test="quiebra-manana"]')).toHaveText('Vuelve mañana');
    await expect(page.locator('[data-test="quiebra-vender"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    // Recargar sigue en quiebra; el máximo histórico no se tocó.
    await page.reload();
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-test="quiebra-manana"]')).toBeVisible();
    expect((await leerOrdago(page)).quiebras).toBe(1);
    // Mañana (la fecha guardada es de ayer): otra vez hay fondo nuevo.
    await page.evaluate(() => {
      const o = JSON.parse(localStorage.getItem('one.ordago'));
      o.fondoNuevoDia = '2000-01-01';
      localStorage.setItem('one.ordago', JSON.stringify(o));
    });
    await page.reload();
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-test="quiebra-fondo-nuevo"]')).toBeVisible();
    await expect(page.locator('[data-test="quiebra-manana"]')).toBeHidden();
  });

  test('Órdago: recargar en plena quiebra vuelve a la pantalla de quiebra al entrar', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await jugarRondaOrdago(page, { ficha: 'ordago', acertar: false, siguiente: false });
    await page.reload();
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-vista="quiebra"]')).toBeVisible();
  });

  test('Órdago: el primer acierto supera el máximo y celebra (confeti, fanfarria, esfinge eufórica y resplandor dorado) sin dar objeto', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await jugarRondaOrdago(page, { ficha: '10', acertar: true, siguiente: false });
    await expect(page.locator('[data-test="ordago-aviso"]')).toContainText('Nuevo máximo');
    await expect(page.locator('[data-test="confeti"]')).toHaveCount(1);
    const sonidos = await page.evaluate(() => window.__one.sonidos());
    expect(sonidos).toContain('fanfarria');
    expect(sonidos).toContain('monedas');
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('euforia');
    await expect(page.locator('[data-test="avatar-cabecera"]')).toHaveClass(/cabecera-avatar--resplandor/);
    expect(await page.evaluate(() => localStorage.getItem('one.mochila'))).toBeNull(); // Órdago no da objetos
    await assertSinScroll(page);
  });

  test('Órdago: la pregunta dorada se revela DESPUÉS de elegir ficha (borde dorado y esfinge sorprendida)', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.01; });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-test="foto-pregunta"]')).not.toHaveClass(/foto-pregunta--dorada/);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).not.toContain('sorpresa');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-10"]').click();
    await expect(page.locator('[data-test="foto-pregunta"]')).toHaveClass(/foto-pregunta--dorada/);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('sorpresa');
    // La dorada multiplica ×1,5 más: con nivel 3 y ficha 100 se ganan 100 × (1,5 × 1,5 − 1) = 125 (nivel 4: 140; nivel 5: 155).
    const nivel = await page.evaluate(() => window.__one.ultimaPreguntaOrdago().nivel);
    await page.evaluate(() => window.__one.acertarPreguntaOrdago());
    await expect(page.locator('[data-test="ordago-delta"]')).toHaveText(`+${{ 3: 125, 4: 140, 5: 155 }[nivel]}`);
  });

  test('Órdago: peor caso (enunciado, opciones y explicación larguísimos) sin scroll y sin recortar el enunciado ni encoger la letra a 375×667', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.9999; }); // elige la última candidata (la inyectada) y no sale dorada
    await page.goto('/?ejemplo=1&test=1');
    const larga = 'Esta es una pregunta deliberadamente larga para comprobar que el enunciado se lee entero encima de la foto sin encoger la letra ni provocar scroll en ninguna pantalla';
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible(); // la app ya cargó el banco
    await page.setViewportSize({ width: 375, height: 667 });
    // Inyectar y entrar en la misma tarea: la sincronización en segundo plano reconstruye el banco y borraría la inyectada.
    await page.evaluate((texto) => {
      window.__one.inyectarPregunta({
        id: 'zz-larga', area: 'historia', tipo: 'test4', nivel: 5, enunciado: texto,
        explicacion: `${texto} ${texto}`, confianza: 1, generador: 'manual', verificador: 'manual', verificado: true,
        opciones: ['Una opción bastante larga que ocupa dos líneas', 'Otra opción igual de larga que la anterior', 'Tercera opción larga para el test', 'Cuarta opción larga para el test'], correcta: 0,
      });
      window.__one.arrancarModo('ordago');
    }, larga);
    expect((await page.evaluate(() => window.__one.ultimaPreguntaOrdago())).id).toBe('zz-larga');
    const medir = () => page.evaluate(() => {
      const foto = document.querySelector('[data-test="foto-pregunta"]').getBoundingClientRect();
      const nodo = document.querySelector('[data-test="foto-pregunta-enunciado"]');
      const texto = nodo.getBoundingClientRect();
      return { cabe: texto.top >= foto.top - 1 && texto.bottom <= foto.bottom + 1, fuente: getComputedStyle(nodo).fontSize };
    });
    expect(await medir()).toEqual({ cabe: true, fuente: '20px' });
    await assertSinScroll(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-50"]').click();
    await assertSinScroll(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-opciones"] button').first().click();
    await assertSinScroll(page);
    expect(await medir()).toEqual({ cabe: true, fuente: '20px' });
    // La explicación (~390 caracteres, más que la más larga del banco) sale ENTERA: la foto cede alto, nada de «…».
    const explicacion = await page.evaluate(() => {
      const nodo = document.querySelector('[data-test="ordago-explicacion"]');
      const caja = nodo.getBoundingClientRect();
      return { recortada: nodo.scrollHeight > nodo.clientHeight + 1, dentro: caja.bottom <= window.innerHeight, fuente: getComputedStyle(nodo).fontSize };
    });
    expect(explicacion).toEqual({ recortada: false, dentro: true, fuente: '14px' });
  });

  test('Órdago: las opciones salen barajadas y se evalúa por el índice original', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    const ordenes = new Set();
    let ronda = 0;
    while (ordenes.size < 2 && ronda < 12) {
      ronda += 1;
      await esperarAntirrebote(page);
      await page.locator('[data-test="ficha-10"]').click();
      const pregunta = await page.evaluate(() => window.__one.ultimaPreguntaOrdago());
      if (pregunta.tipo === 'test4') {
        const originales = await page.locator('[data-test="ordago-opciones"] button').evaluateAll((bs) => bs.map((b) => b.dataset.original));
        expect([...originales].sort()).toEqual(['0', '1', '2', '3']);
        ordenes.add(originales.join(''));
        await esperarAntirrebote(page);
        await page.locator(`[data-test="ordago-opciones"] [data-original="${pregunta.correcta}"]`).click();
        await expect(page.locator('[data-test="ordago-delta"]')).toHaveText(/^[+]/); // acertar por el original suma
      } else {
        await page.evaluate(() => window.__one.acertarPreguntaOrdago());
      }
      await esperarAntirrebote(page);
      await page.locator('[data-test="ordago-siguiente"]').click();
    }
    expect(ordenes.size).toBeGreaterThan(1); // no sale siempre el mismo orden
  });

  test('Clásico: las opciones de un test4 salen barajadas y el orden no cambia al volver a la tarjeta', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.waitForFunction(() => window.__one?.listo === true);
    // Solo preguntas test4 (antes salían del azar y a veces tocaban < 2): 10 con 4! = 24 órdenes posibles.
    await page.evaluate(() => window.__one.empezarPartida({ ids: ['cie-001', 'art-001', 'tec-001', 'eco-101', 'his-101', 'his-103', 'cie-102', 'tec-101', 'tec-103', 'geo-101'], etiqueta: 'barajadas' }));
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    const ordenes = new Set();
    for (let i = 0; i < 10; i += 1) {
      const t = tarjetaActual(page);
      if ((await tipoPreguntaActual(page)) === 'test4') {
        const leer = () => t.locator('[data-test^="opcion-"]').evaluateAll((bs) => bs.map((b) => b.dataset.original).join(''));
        const antes = await leer();
        expect([...antes].sort().join('')).toBe('0123');
        ordenes.add(antes);
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        expect(await leer()).toBe(antes);
      }
      await responderPreguntaActual(page);
      await avanzarTrasRespuesta(page);
    }
    expect(ordenes.size).toBeGreaterThan(1);
  });

  test('Órdago: con < 5 jugables difíciles bajo el filtro ofrece Generar (PREMIUM) o volver a TODOS; «Jugar las N» solo sirve nivel ≥ 3', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ ordago: { area: 'geografia', ruta: [], etiquetas: [] } }));
    });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-vista="filtro-corto"]')).toBeVisible();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toHaveText('Solo hay 3 preguntas de Geografía');
    await expect(page.locator('[data-test="filtro-corto-generar"] [data-test="insignia-premium"]')).toBeVisible();
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeDisabled(); // sin servidor
    await page.locator('[data-test="filtro-corto-jugar"]').click();
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible();
    for (let i = 0; i < 4; i += 1) {
      const pregunta = await page.evaluate(() => window.__one.ultimaPreguntaOrdago());
      expect(pregunta.area).toBe('geografia');
      expect(pregunta.nivel).toBeGreaterThanOrEqual(3);
      await jugarRondaOrdago(page, { ficha: '10', acertar: true });
    }
    await page.locator('[data-test="volver"]').click();
    await entrarEnModo(page, 'ordago');
    await page.locator('[data-test="filtro-corto-todos"]').click();
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
  });

  test('Órdago: «Generar preguntas» desde el aviso pide la tanda con nivelObjetivo 4', async ({ page }) => {
    const peticiones = [];
    await page.route(`${URL_SERVIDOR_ORDAGO}/**`, async (ruta) => {
      const peticion = ruta.request();
      if (peticion.method() === 'OPTIONS') {
        await ruta.fulfill({ status: 204, headers: CORS_ORDAGO });
        return;
      }
      const cabeceras = { ...CORS_ORDAGO, 'Content-Type': 'application/json' };
      if (new URL(peticion.url()).pathname === '/generar') {
        peticiones.push(peticion.postDataJSON());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ trabajoId: 't-1', enCola: 1, estimadoSeg: 40 }) });
      } else {
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null, estado_servidor: 'ok' }) });
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ ordago: { area: 'geografia', ruta: [], etiquetas: [] } }));
    });
    await page.goto(`/?ejemplo=1&test=1&servidor=${encodeURIComponent(URL_SERVIDOR_ORDAGO)}&token=${TOKEN_ORDAGO}`);
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeEnabled();
    await page.locator('[data-test="filtro-corto-generar"]').click();
    await expect.poll(() => peticiones.length).toBe(1);
    expect(peticiones[0]).toMatchObject({ area: 'geografia', nivelObjetivo: 4, urgente: true });
  });

  for (const viewport of VIEWPORTS_ORDAGO_HUB) {
    test(`Órdago: la tarjeta del hub ya no es «Pronto», enseña el fondo y su minicurva (hub ${viewport.width}×${viewport.height} sin scroll)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1&test=1');
      const tarjeta = page.locator('[data-test="modo-ordago"]');
      await expect(tarjeta).not.toHaveAttribute('aria-disabled', 'true');
      await expect(tarjeta).not.toContainText('Pronto');
      await expect(page.locator('[data-test="marcador-ordago"]')).toHaveText('Fondo 1.000');
      await expect(tarjeta.locator('[data-test="curva-ordago"] polyline')).toHaveCount(1);
      await assertSinScroll(page);
      // Tras ganar, la tarjeta enseña el fondo nuevo y la curva sigue ahí.
      await entrarEnModo(page, 'ordago');
      await page.waitForTimeout(450);
      await page.locator('[data-test="ficha-10"]').click();
      await page.evaluate(() => window.__one.acertarPreguntaOrdago());
      const fondo = await page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago')).fondo);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-test="marcador-ordago"]')).toHaveText('Fondo ' + String(fondo).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
      const puntos = await tarjeta.locator('[data-test="curva-ordago"] polyline').getAttribute('points');
      expect(puntos.split(' ').length).toBe(2); // [1000, fondo]
      await assertSinScroll(page);
    });
  }

  test('Review Focus 5: el aviso «Preguntas generadas» no se enseña durante la ronda y la tarjeta del hub enseña el fondo', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-test="marcador-ordago"]')).toHaveText('Fondo 1.000');
    await entrarEnModo(page, 'ordago');
    await page.evaluate(() => window.__one.simularTandaLista({ ids: ['zz-1'], corto: 'Historia' }));
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeHidden();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeVisible();
  });
});

test.describe('ONE · v0.3 Contrarreloj (fase 6)', () => {
  const VIEWPORTS = [{ width: 375, height: 812 }, { width: 375, height: 667 }];
  const sinScrollEnAmbos = async (page) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
    }
  };
  const esperarAntirrebote = (page) => page.waitForTimeout(450);
  const objetosEnMochila = (page) => page.evaluate(() => {
    const crudo = localStorage.getItem('one.mochila');
    return crudo ? Object.values(JSON.parse(crudo).objetos).reduce((a, b) => a + b, 0) : 0;
  });

  test('Contrarreloj: rampa desde el nivel 1, tiempo agotado = caída con explicación, cofre a la 10 y plantarse (sin scroll a 375×812 y 375×667)', async ({ page }) => {
    await page.clock.install();
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 1 de 10');
    await expect(page.locator('[data-test="contrarreloj-puntos"] > span')).toHaveCount(10); // 10 puntos de progreso, no «n/10»
    await expect(page.locator('[data-test="foto-pregunta-enunciado"]')).toBeVisible(); // enunciado encima de la foto
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1); // un solo reproductor por pantalla
    const pregunta = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj());
    expect(pregunta.nivel).toBe(1); // la rampa empieza en el nivel 1
    expect(['vf', 'test4']).toContain(pregunta.tipo);
    await sinScrollEnAmbos(page);
    // El reloj es por tiempo transcurrido (no por fotogramas): se salta en bloques para no pintar 700 fotogramas.
    await page.clock.fastForward(9200); // quedan ~2,8 s: empieza el tictac
    await page.clock.runFor(1000);
    await page.clock.fastForward(5000);
    await expect(page.locator('[data-vista="caida"]')).toBeVisible();
    expect(await page.evaluate(() => window.__one.sonidos())).toContain('tictac'); // los 3 últimos segundos
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('triste');
    await expect(page.locator('[data-test="caida-explicacion"]')).toContainText('Respuesta:');
    await expect(page.locator('[data-test="caida-resumen"]')).toContainText('Se acabó el tiempo');
    await sinScrollEnAmbos(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="caida-reintentar"]').click();
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 1 de 10');
    expect(await objetosEnMochila(page)).toBe(0);
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await expect(page.locator('[data-vista="cofre"]')).toBeVisible();
    await expect(page.locator('[data-test="cofre-objeto-0"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('euforia');
    await sinScrollEnAmbos(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-plantarse"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    expect(await objetosEnMochila(page)).toBe(1);
    await expect(page.locator('[data-test="marcador-tienda"]')).toContainText('1');
    // Se guardaron los récords: 10/10 y ningún doble; la serie no se guarda.
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('one.contrarreloj')));
    expect(guardado.mejor.aciertos).toBe(10);
    expect(guardado.doblesGanados).toBe(0);
  });

  test('Contrarreloj: un fallo te tumba con la explicación y cada respuesta pasa por registrarRespuesta', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.acertarContrarreloj(3));
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 4 de 10');
    await page.evaluate(() => window.__one.fallarContrarreloj());
    await expect(page.locator('[data-vista="caida"]')).toBeVisible();
    await expect(page.locator('[data-test="caida-resumen"]')).toContainText('pregunta 4 de 10');
    await expect(page.locator('[data-test="caida-explicacion"]')).toContainText('Respuesta:');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).hoy.respondidas)).toBe(4);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.contrarreloj')).mejor.aciertos)).toBe(3);
  });

  test('Contrarreloj: doble o nada — 6→4 s, superarlo da 2 objetos y caer en él, ninguno', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await expect(page.locator('[data-test="cofre-doble"]')).toContainText('6→4 s');
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-doble"]').click();
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    await expect(page.locator('[data-test="contrarreloj-fase"]')).toBeVisible();
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 1 de 10');
    // Caer en el doble: se pierde el cofre.
    await page.evaluate(() => window.__one.fallarContrarreloj());
    await expect(page.locator('[data-test="caida-resumen"]')).toContainText('pierdes el cofre');
    expect(await objetosEnMochila(page)).toBe(0);
    await esperarAntirrebote(page);
    await page.locator('[data-test="caida-reintentar"]').click();
    await expect(page.locator('[data-test="contrarreloj-fase"]')).toBeHidden(); // vuelve a la serie normal
    // Superar el doble: 2 objetos.
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-doble"]').click();
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await expect(page.locator('[data-vista="cofre"]')).toBeVisible();
    await expect(page.locator('[data-test="cofre-objeto-1"]')).toHaveCount(1);
    await expect(page.locator('[data-test="cofre-doble"]')).toBeHidden();
    await sinScrollEnAmbos(page);
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-recoger"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    expect(await objetosEnMochila(page)).toBe(2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.contrarreloj')).doblesGanados)).toBe(1);
  });

  test('Review Focus 2: doble toque en una respuesta responde una sola vez y en «Plantarse» da un solo cofre', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await esperarAntirrebote(page);
    const pregunta = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj());
    const original = pregunta.tipo === 'vf' ? String(pregunta.respuesta) : String(pregunta.correcta);
    await page.locator(`[data-test="contrarreloj-opciones"] [data-original="${original}"]`).dblclick();
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado')).hoy.respondidas)).toBe(1);
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 2 de 10'); // no se saltó otra
    await page.evaluate(() => window.__one.acertarContrarreloj(9));
    await expect(page.locator('[data-vista="cofre"]')).toBeVisible();
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-plantarse"]').dblclick();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    expect(await objetosEnMochila(page)).toBe(1);
  });

  test('Review Focus 3: recargar a mitad de la serie la pierde sin contar como caída', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.acertarContrarreloj(5));
    await page.reload();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    // Ni récord ni caída guardados: solo existe lo que se guarda al TERMINAR una serie.
    expect(await page.evaluate(() => localStorage.getItem('one.contrarreloj'))).toBeNull();
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 1 de 10');
  });

  test('Contrarreloj en segundo plano: el tiempo se para y al volver es la misma posición con otra pregunta y el tiempo completo', async ({ page }) => {
    await page.clock.install();
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.acertarContrarreloj(2));
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 3 de 10');
    const antes = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().id);
    await page.clock.fastForward(4000);
    const ocultar = (oculto) => page.evaluate((valor) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => valor });
      document.dispatchEvent(new Event('visibilitychange'));
    }, oculto);
    await ocultar(true);
    await page.clock.fastForward(30000); // mucho más que el tiempo de la pregunta: no debe caer
    expect(await page.evaluate(() => document.querySelector('[data-vista="contrarreloj"]').hidden)).toBe(false);
    await ocultar(false);
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 3 de 10');
    const despues = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().id);
    expect(despues).not.toBe(antes);
    // Tiempo completo otra vez (≈ 10,7 s en la 3.ª): a los 9,5 s todavía no ha caído; a los 11,5 sí.
    await page.clock.fastForward(9500);
    expect(await page.evaluate(() => document.querySelector('[data-vista="contrarreloj"]').hidden)).toBe(false);
    await page.clock.fastForward(2000);
    await expect(page.locator('[data-vista="caida"]')).toBeVisible();
  });

  test('Contrarreloj: peor caso (enunciado largo) sin scroll y sin encoger la letra a 375×667', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.9999; }); // elige la última candidata (la inyectada)
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.setViewportSize({ width: 375, height: 667 });
    const larga = 'Pregunta deliberadamente larga para comprobar que el enunciado cabe entero sobre la foto';
    await page.evaluate((texto) => {
      window.__one.inyectarPregunta({
        id: 'zz-larga-cr', area: 'historia', tipo: 'test4', nivel: 1, // la rampa empieza en el nivel 1
        enunciado: texto,
        explicacion: texto, confianza: 1, generador: 'manual', verificador: 'manual', verificado: true,
        opciones: ['Una opción bastante larga pero válida', 'Otra opción igual de larga que la 1', 'Tercera opción', 'Cuarta opción'], correcta: 0,
      });
      window.__one.arrancarModo('contrarreloj');
    }, larga);
    expect((await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj())).id).toBe('zz-larga-cr');
    await assertSinScroll(page);
    const medidas = await page.evaluate(() => {
      const foto = document.querySelector('[data-test="foto-pregunta"]').getBoundingClientRect();
      const nodo = document.querySelector('[data-test="foto-pregunta-enunciado"]');
      const texto = nodo.getBoundingClientRect();
      return {
        cabe: texto.top >= foto.top - 1 && texto.bottom <= foto.bottom + 1,
        fuente: getComputedStyle(nodo).fontSize,
        opcion: getComputedStyle(document.querySelector('[data-test="contrarreloj-opcion-0"]')).fontSize,
        fotoAlto: foto.height,
      };
    });
    expect(medidas).toMatchObject({ cabe: true, fuente: '20px', opcion: '16px' });
    expect(medidas.fotoAlto).toBeGreaterThan(100);
  });
  for (const viewport of VIEWPORTS) {
    test(`Contrarreloj: la tarjeta del hub ya no es «Pronto», enseña «Sin marca» y luego la marca (hub ${viewport.width}×${viewport.height} sin scroll)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1&test=1');
      const tarjeta = page.locator('[data-test="modo-contrarreloj"]');
      await expect(tarjeta).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('[data-test="marcador-contrarreloj"]')).toHaveText('Sin marca');
      await assertSinScroll(page);
      await entrarEnModo(page, 'contrarreloj');
      await page.evaluate(() => window.__one.acertarContrarreloj(4));
      await page.evaluate(() => window.__one.fallarContrarreloj());
      await page.waitForTimeout(450);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-test="marcador-contrarreloj"]')).toHaveText('4/10');
      await assertSinScroll(page);
    });
  }

  test('Contrarreloj: con < 10 jugables bajo el filtro avisa (Generar PREMIUM / volver a TODOS) y sin «Jugar las N» (una serie no repite preguntas)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ contrarreloj: { area: 'geografia', ruta: [], etiquetas: [] } }));
    });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="filtro-corto"]')).toBeVisible();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toContainText('de Geografía');
    await expect(page.locator('[data-test="filtro-corto-generar"] [data-test="insignia-premium"]')).toBeVisible();
    await expect(page.locator('[data-test="filtro-corto-jugar"]')).toBeHidden(); // una serie no repite: sin «Jugar las N»
    await page.locator('[data-test="filtro-corto-todos"]').click();
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
  });

  test('Contrarreloj: «Generar preguntas» desde el aviso pide la tanda sin nivelObjetivo (rampa 1-5, a diferencia de Órdago)', async ({ page }) => {
    const peticiones = [];
    const cors = {
      'Access-Control-Allow-Origin': 'http://localhost:8765',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    await page.route('https://servidor.prueba/**', async (ruta) => {
      const peticion = ruta.request();
      if (peticion.method() === 'OPTIONS') {
        await ruta.fulfill({ status: 204, headers: cors });
        return;
      }
      const cabeceras = { ...cors, 'Content-Type': 'application/json' };
      if (new URL(peticion.url()).pathname === '/generar') {
        peticiones.push(peticion.postDataJSON());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ trabajoId: 't-1', enCola: 1, estimadoSeg: 40 }) });
      } else {
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null, estado_servidor: 'ok' }) });
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ contrarreloj: { area: 'geografia', ruta: [], etiquetas: [] } }));
    });
    await page.goto('/?ejemplo=1&test=1&servidor=https%3A%2F%2Fservidor.prueba&token=token-de-prueba-e2e-1234567890');
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeEnabled();
    await page.locator('[data-test="filtro-corto-generar"]').click();
    await expect.poll(() => peticiones.length).toBe(1);
    expect(peticiones[0]).toMatchObject({ area: 'geografia' });
    expect(peticiones[0].nivelObjetivo).toBeUndefined();
  });

  test('Contrarreloj: «←» en la pantalla del cofre es plantarse y el objeto llega a la mochila una sola vez', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await expect(page.locator('[data-vista="cofre"]')).toBeVisible();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    expect(await objetosEnMochila(page)).toBe(1);
    await entrarEnModo(page, 'contrarreloj');
    await page.locator('[data-test="volver"]').click();
    expect(await objetosEnMochila(page)).toBe(1); // salir de una serie a medias no entrega nada
  });

  test('Contrarreloj: con el almacenamiento bloqueado el cofre y la marca viven en memoria (Tienda y hub)', async ({ page }) => {
    await page.addInitScript(() => {
      const bloqueadas = ['one.mochila', 'one.contrarreloj'];
      const setItem = Storage.prototype.setItem;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.setItem = function (k, v) {
        if (bloqueadas.includes(k)) throw new Error('SecurityError');
        return setItem.call(this, k, v);
      };
      Storage.prototype.getItem = function (k) {
        if (bloqueadas.includes(k)) throw new Error('SecurityError');
        return getItem.call(this, k);
      };
    });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-plantarse"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="marcador-contrarreloj"]')).toHaveText('10/10');
    await page.waitForTimeout(450);
    await page.locator('[data-test="tarjeta-tienda"]').click();
    const cantidades = await page.locator('.tienda-objeto-cantidad').allTextContents();
    expect(cantidades.reduce((suma, t) => suma + Number(t.replace('Tienes ', '')), 0)).toBe(1);
  });

  test('Review Focus 5: el aviso «Preguntas generadas» no se enseña durante Contrarreloj ni en el cofre y sale al volver al hub', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await page.evaluate(() => window.__one.simularTandaLista({ ids: ['zz-1'], corto: 'Historia' }));
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeHidden();
    await page.evaluate(() => window.__one.acertarContrarreloj(10));
    await expect(page.locator('[data-vista="cofre"]')).toBeVisible();
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeHidden();
    await esperarAntirrebote(page);
    await page.locator('[data-test="cofre-plantarse"]').click();
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeVisible();
  });
});

test.describe('ONE · v0.3 Más o menos (fase 8)', () => {
  const VIEWPORTS = [{ width: 375, height: 812 }, { width: 375, height: 667 }];
  const sinScrollEnAmbos = async (page) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
    }
  };
  const esperarAntirrebote = (page) => page.waitForTimeout(450);
  const pareja = (page) => page.evaluate(() => window.__one.parejaMasomenos());
  /** Entra en Más o menos con el filtro de área indicado (o sin filtro). */
  async function entrar(page, area = null) {
    if (area) {
      await page.addInitScript((a) => {
        localStorage.setItem('one.filtros', JSON.stringify({ masomenos: { area: a, ruta: [], etiquetas: [] } }));
      }, area);
    }
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'masomenos');
    await expect(page.locator('[data-vista="masomenos"]')).toBeVisible();
    await expect(page.locator('[data-test="mm-cuerpo"] > *').first()).toBeVisible();
    await esperarAntirrebote(page); // los toques de los primeros 350 ms no cuentan
  }
  /** Responde Comparar pulsando el botón correcto (o el contrario) según la pareja real. */
  async function responder(page, correcta = true) {
    await esperarAntirrebote(page);
    const p = await pareja(page);
    const sube = p.abajo.valor > p.arriba.valor;
    await page.locator(`[data-test="mm-${correcta === sube ? 'mas' : 'menos'}"]`).click();
    return p;
  }
  const siguiente = async (page) => {
    await esperarAntirrebote(page);
    await page.locator('[data-test="mm-siguiente"]').click();
  };

  test('Comparar: dos tarjetas, un solo avatar, acierto sube la de abajo, sin scroll a 375×812 y 375×667 y sin tocar el radar', async ({ page }) => {
    await entrar(page);
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
    await expect(page.locator('[data-test="mm-var-comparar"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mm-tarjeta')).toHaveCount(2);
    await expect(page.locator('[data-test="mm-valor-abajo"]')).toHaveText('?');
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1); // un solo reproductor por pantalla
    await sinScrollEnAmbos(page);
    const antes = await pareja(page);
    await responder(page, true);
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toHaveText('¡Correcto!');
    await expect(page.locator('[data-test="mm-diferencia"]')).toContainText(antes.abajo.nombre);
    await expect(page.locator('[data-test="mm-record"]')).toHaveText('Récord 1');
    await expect(page.locator('[data-test="mm-racha"]')).toBeHidden(); // la llama sale desde racha 3
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('acierto');
    await sinScrollEnAmbos(page);
    await siguiente(page);
    const despues = await pareja(page);
    expect(despues.arriba.id).toBe(antes.abajo.id); // la de abajo sube
    await expect(page.locator('[data-test="mm-valor-abajo"]')).toHaveText('?');
    // Las cifras no son preguntas del banco: ni radar ni respondidas de hoy.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado'))?.hoy?.respondidas ?? 0)).toBe(0);
  });

  test('Comparar: fallar pone la racha a 0, enseña la diferencia y sigue con una pareja nueva', async ({ page }) => {
    await entrar(page);
    await responder(page, true);
    await siguiente(page);
    await responder(page, true);
    await siguiente(page);
    await expect(page.locator('[data-test="mm-record"]')).toHaveText('Récord 2');
    const p = await responder(page, false);
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toHaveText('Fallaste');
    await expect(page.locator('[data-test="mm-diferencia"]')).toContainText(/más|menos|antes|después/);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('triste');
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('one.masomenos')));
    expect(guardado.comparar).toEqual({ racha: 0, record: 2 });
    await sinScrollEnAmbos(page);
    await siguiente(page);
    expect((await pareja(page)).arriba.id).not.toBe(p.abajo.id);
  });

  test('Comparar: ninguna pareja mostrada supera ×4 (fechas: 300 años) en 30 parejas', async ({ page }) => {
    await entrar(page);
    for (let i = 0; i < 30; i += 1) {
      const p = await pareja(page);
      expect(p.arriba.categoria).toBe(p.abajo.categoria);
      expect(p.arriba.valor).not.toBe(p.abajo.valor);
      if (p.abajo.unidad === 'año') {
        expect(Math.abs(p.arriba.valor - p.abajo.valor)).toBeLessThanOrEqual(300);
      } else {
        const mayor = Math.max(p.arriba.valor, p.abajo.valor);
        const menor = Math.min(p.arriba.valor, p.abajo.valor);
        expect(mayor / menor).toBeLessThanOrEqual(4);
        expect((mayor - menor) / mayor).toBeGreaterThanOrEqual(0.05);
      }
      expect(await page.evaluate(() => window.__one.responderMasomenos(true))).toBe(true);
      await siguiente(page);
    }
  });

  // Sin service worker: page.route no ve lo que el SW pide por su cuenta (guarda las fotos de Commons en la caché aparte).
  test.describe('sin service worker', () => {
    test.use({ serviceWorkers: 'block' });

    test('Comparar con fechas: botones «Después» / «Antes», sin scroll y las dos tarjetas con el color del área si no hay foto', async ({ page }) => {
      await page.route('https://upload.wikimedia.org/**', (r) => r.abort()); // todas las fotos rotas: color del área, sin hueco
      await entrar(page, 'historia');
      await expect(page.locator('[data-test="mm-mas"]')).toHaveText('Después');
      await expect(page.locator('[data-test="mm-menos"]')).toHaveText('Antes');
      await expect(page.locator('.mm-tarjeta[data-area="historia"]')).toHaveCount(2);
      await expect(page.locator('.mm-tarjeta-img')).toHaveCount(0); // el error de carga quita la foto
      await sinScrollEnAmbos(page);
      await responder(page, true);
      await expect(page.locator('[data-test="mm-diferencia"]')).toContainText(/años? (antes|después)/);
      await sinScrollEnAmbos(page);
    });
  });

  test('Comparar con tamaños: al responder, las dos fotos pasan a su tamaño real sobre la misma línea de suelo', async ({ page }) => {
    await entrar(page, 'economia');
    await responder(page, true);
    await expect(page.locator('[data-test="escala"]')).toBeVisible();
    await expect(page.locator('[data-test="escala-misteriosa"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    await page.waitForTimeout(900); // la transición de la revelación
    const medidas = await page.evaluate(() => {
      const a = document.querySelector('[data-test="escala-ref"]').getBoundingClientRect();
      const b = document.querySelector('[data-test="escala-misteriosa"]').getBoundingClientRect();
      return { sueloA: Math.round(a.bottom), sueloB: Math.round(b.bottom), ladoA: a.width, ladoB: b.width, altoA: a.height, altoB: b.height };
    });
    expect(Math.abs(medidas.sueloA - medidas.sueloB)).toBeLessThanOrEqual(1); // misma línea de suelo
    const p = await pareja(page);
    const razon = Math.max(p.arriba.valor, p.abajo.valor) / Math.min(p.arriba.valor, p.abajo.valor);
    const lados = Math.max(medidas.ladoA, medidas.ladoB) / Math.min(medidas.ladoA, medidas.ladoB);
    expect(lados).toBeGreaterThan(Math.sqrt(razon) * 0.85); // lado ∝ √cifra (el área es la cifra)
    expect(lados).toBeLessThan(Math.sqrt(razon) * 1.15);
  });

  test('Afinar con tamaños: la foto de la misteriosa crece con la barra, «Listo» califica y revela a escala (sin scroll en ambos tamaños)', async ({ page }) => {
    await entrar(page, 'economia');
    await page.locator('[data-test="mm-var-afinar"]').click();
    await esperarAntirrebote(page);
    await expect(page.locator('[data-test="mm-var-afinar"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-test="mm-enunciado"]')).toContainText('PIB');
    await expect(page.locator('[data-test="mm-referencia"]')).toContainText('US$');
    await expect(page.locator('[data-test="escala"]')).toBeVisible();
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1);
    await sinScrollEnAmbos(page);
    const lado = () => page.locator('[data-test="escala-misteriosa"]').evaluate((n) => { const r = n.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    const inicial = await lado();
    const textoInicial = await page.locator('[data-test="mm-estimacion"]').textContent();
    await page.locator('[data-test="mm-barra"]').fill('1500');
    await page.waitForTimeout(900); // la transición de tamaño
    await expect(page.locator('[data-test="mm-estimacion"]')).not.toHaveText(textoInicial);
    expect(await lado()).not.toBe(inicial); // la foto cambia de tamaño en tiempo real
    await expect(page.locator('[data-test="escala-misteriosa"]')).toHaveClass(/escala-caja--estimacion/); // contorno de «tu estimación»
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toHaveText(/¡Clavado!|Muy cerca|Cerca|Lejos/);
    await expect(page.locator('[data-test="escala-fantasma"]')).toBeVisible();
    await expect(page.locator('[data-test="mm-diferencia"]')).toContainText('US$');
    await sinScrollEnAmbos(page);
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('one.masomenos')));
    expect(guardado.variante).toBe('afinar');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.estado'))?.hoy?.respondidas ?? 0)).toBe(0); // no toca el radar
  });

  test('Afinar: clavar la cifra da «¡Clavado!», confeti y la esfinge eufórica; lejos corta la racha', async ({ page }) => {
    await entrar(page, 'geografia');
    await page.locator('[data-test="mm-var-afinar"]').click();
    await expect(page.locator('[data-test="mm-barra"]')).toBeVisible();
    await esperarAntirrebote(page);
    const estimado = await page.evaluate(() => window.__one.estimarMasomenos({ factor: 1 }));
    expect(estimado).toBeGreaterThan(0);
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toHaveText('¡Clavado!');
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('euforia');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.masomenos')).afinar)).toEqual({ racha: 1, record: 1 });
    await siguiente(page);
    await esperarAntirrebote(page);
    await page.evaluate(() => window.__one.estimarMasomenos({ extremo: 'lejos' })); // la punta más alejada de la barra: lejos
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toHaveText('Lejos');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.masomenos')).afinar)).toEqual({ racha: 0, record: 1 });
  });

  test('Afinar con fechas: la foto del evento con la pregunta encima y la línea temporal en su banda (sin scroll en ambos tamaños)', async ({ page }) => {
    await entrar(page, 'historia');
    await page.locator('[data-test="mm-var-afinar"]').click();
    await expect(page.locator('[data-test="foto-pregunta"]')).toBeVisible();
    await esperarAntirrebote(page);
    // Pareja fija (Austerlitz de referencia, Azincourt a estimar): no depende del azar.
    expect(await page.evaluate(() => window.__one.fijarParejaMasomenos('ah-Q134114', 'ah-Q188495'))).toBe(true);
    await esperarAntirrebote(page);
    await expect(page.locator('[data-test="foto-pregunta-enunciado"]')).toContainText('¿en qué año fue?');
    await expect(page.locator('[data-test="escala-linea"]')).toBeVisible();
    await expect(page.locator('[data-test="escala-marca-ref"]')).toBeAttached();
    await sinScrollEnAmbos(page);
    const ticks = async () => page.locator('[data-test="escala-linea"] .escala-tic-texto').allTextContents();
    const antes = await ticks();
    await page.evaluate(() => window.__one.estimarMasomenos({ anos: 3 })); // cerca: décadas
    await expect(page.locator('[data-test="escala-marca-estimacion"]')).toBeAttached();
    expect(await ticks()).not.toEqual(antes); // la línea hizo zoom: otras etiquetas
    await sinScrollEnAmbos(page);
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toHaveText('¡Clavado!');
    await expect(page.locator('[data-test="escala-marca-real"]')).toBeAttached();
    await sinScrollEnAmbos(page);
    // La línea va en su banda oscura: un fondo casi opaco para que se lea sobre la foto.
    const fondo = await page.locator('[data-test="escala-linea"]').evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(fondo).toMatch(/rgba\(11, 15, 20, 0\.8/);
  });

  test('letra sin encoger: cifra, nombre, botones y enunciado miden lo mismo en 375×812 y 375×667', async ({ page }) => {
    await entrar(page);
    const medir = () => page.evaluate(() => {
      const f = (s) => getComputedStyle(document.querySelector(s)).fontSize;
      return { valor: f('[data-test="mm-valor-arriba"]'), nombre: f('.mm-tarjeta-nombre'), boton: f('[data-test="mm-mas"]'), pregunta: f('.mm-pregunta') };
    });
    const grande = await medir();
    await page.setViewportSize({ width: 375, height: 667 });
    expect(await medir()).toEqual(grande);
    // La cifra se reduce solo si es larga («391.027 millones US$»), nunca por debajo de 11 px; el resto no cambia.
    expect(Number.parseFloat(grande.valor)).toBeGreaterThanOrEqual(16);
    expect(Number.parseFloat(grande.valor)).toBeLessThanOrEqual(28);
    expect({ ...grande, valor: undefined }).toEqual({ nombre: '16px', boton: '20px', pregunta: '14px', valor: undefined });
    await page.locator('[data-test="mm-var-afinar"]').click();
    await expect(page.locator('[data-test="mm-estimacion"]')).toBeVisible(); // la variante se pinta tras el toque
    // Pareja fija de tamaños (PIB): Afinar al azar puede tocar fechas, que usan línea temporal y no tienen `.escala-etiqueta`.
    expect(await page.evaluate(() => window.__one.fijarParejaMasomenos('pib-Q183', 'pib-Q851'))).toBe(true);
    await expect(page.locator('.escala-etiqueta').first()).toBeVisible();
    const afinar = await page.evaluate(() => {
      const f = (s) => getComputedStyle(document.querySelector(s)).fontSize;
      return { lectura: f('[data-test="mm-estimacion"]'), etiqueta: f('.escala-etiqueta') };
    });
    expect(afinar.lectura).toBe('20px');
    expect(Number.parseFloat(afinar.etiqueta)).toBeGreaterThanOrEqual(11); // texto funcional ≥ 11 px
  });

  test('premio: al llegar a 10 de racha cae 1 objeto en la mochila (y a la 11 no)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.masomenos', JSON.stringify({ version: 1, variante: 'comparar', comparar: { racha: 9, record: 9 }, afinar: { racha: 0, record: 0 } }));
    });
    await entrar(page);
    await responder(page, true);
    await expect(page.locator('[data-test="mm-premio"]')).toContainText('Premio:');
    const objetos = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('one.mochila')).objetos).reduce((a, b) => a + b, 0));
    expect(await objetos()).toBe(1);
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('euforia');
    await siguiente(page);
    await responder(page, true);
    await expect(page.locator('[data-test="mm-premio"]')).toHaveCount(0);
    expect(await objetos()).toBe(1);
    await expect(page.locator('[data-test="mm-racha"]')).toBeVisible(); // llama desde racha 3
  });

  test('un doble toque en «Más» responde una sola vez', async ({ page }) => {
    await entrar(page);
    await page.locator('[data-test="mm-mas"]').dblclick();
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('one.masomenos')).comparar);
    expect(guardado.racha).toBeLessThanOrEqual(1); // una sola respuesta: racha 1 como mucho
    expect(guardado.record).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-test="mm-resultado"]')).toHaveCount(1);
  });

  test('la variante se recuerda al salir y volver a entrar; «←» destruye la pantalla y la esfinge', async ({ page }) => {
    await entrar(page);
    await page.locator('[data-test="mm-var-afinar"]').click();
    await esperarAntirrebote(page);
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(page.locator('[data-test="mm-cuerpo"] > *')).toHaveCount(0); // sin nodos ni oyentes vivos
    await entrarEnModo(page, 'masomenos');
    await expect(page.locator('[data-test="mm-var-afinar"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-test="mm-barra"]')).toBeVisible();
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1);
  });

  test('sin parejas comparables bajo el filtro: aviso y «Volver a TODOS»', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ masomenos: { area: 'ciencia', ruta: [], etiquetas: [] } }));
    });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'masomenos');
    await expect(page.locator('[data-vista="filtro-corto"]')).toBeVisible();
    await expect(page.locator('[data-test="filtro-corto-texto"]')).toContainText('No hay cifras comparables de Ciencia');
    await expect(page.locator('[data-test="filtro-corto-generar"]')).toBeHidden(); // «Generar» cifras es la fase 10
    await page.locator('[data-test="filtro-corto-todos"]').click();
    await expect(page.locator('[data-vista="masomenos"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('TODOS');
  });

  test('el chip del filtro solo ofrece áreas y la elegida se aplica (solo cifras de ese área)', async ({ page }) => {
    await entrar(page);
    await abrirHojaFiltro(page);
    await page.locator('[data-test="filtro-area-geografia"]').click();
    await expect(page.locator('[data-test="atomo"]')).toBeHidden(); // nivel área: no hay árbol de átomos
    await expect(page.locator('[data-vista="masomenos"]')).toBeVisible();
    await expect(page.locator('[data-test="chip-filtro"]')).toHaveText('Geografía');
    for (let i = 0; i < 5; i += 1) {
      const p = await pareja(page);
      expect(['altitud-montana', 'longitud-rio', 'poblacion-pais', 'poblacion-ciudad', 'superficie-pais']).toContain(p.abajo.categoria);
      await page.evaluate(() => window.__one.responderMasomenos(true));
      await siguiente(page);
    }
  });

  test('con el almacenamiento bloqueado la racha y el récord viven en memoria y nada lanza', async ({ page }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'one.masomenos') throw new Error('SecurityError');
        return setItem.call(this, k, v);
      };
      Storage.prototype.getItem = function (k) {
        if (k === 'one.masomenos') throw new Error('SecurityError');
        return getItem.call(this, k);
      };
    });
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await entrar(page);
    await responder(page, true);
    await expect(page.locator('[data-test="mm-record"]')).toHaveText('Récord 1');
    await siguiente(page);
    await responder(page, true);
    await expect(page.locator('[data-test="mm-record"]')).toHaveText('Récord 2');
    await page.waitForTimeout(450);
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="marcador-masomenos"]')).toHaveText('Récord 2');
    expect(errores).toEqual([]);
  });

  test('«Preguntas generadas» no se enseña durante Más o menos y sale al volver al hub', async ({ page }) => {
    await entrar(page);
    await page.evaluate(() => window.__one.simularTandaLista({ ids: ['zz-1'], corto: 'Historia' }));
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeHidden();
    await responder(page, true);
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeHidden();
    await esperarAntirrebote(page);
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="aviso-generadas"]')).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`hub ${viewport.width}×${viewport.height}: la tarjeta de Más o menos ya no es «Pronto», enseña «Sin récord» y luego el récord (sin scroll)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?ejemplo=1&test=1');
      const tarjeta = page.locator('[data-test="modo-masomenos"]');
      await expect(tarjeta).not.toHaveAttribute('aria-disabled', 'true');
      await expect(tarjeta).not.toContainText('Pronto');
      await expect(page.locator('[data-test="marcador-masomenos"]')).toHaveText('Sin récord');
      await assertSinScroll(page);
      await entrarEnModo(page, 'masomenos');
      await expect(page.locator('[data-vista="masomenos"]')).toBeVisible();
      await responder(page, true);
      await esperarAntirrebote(page);
      await page.locator('[data-test="volver"]').click();
      await expect(page.locator('[data-test="marcador-masomenos"]')).toHaveText('Récord 1');
      await assertSinScroll(page);
    });
  }

  test('el respaldo exportado lleva one.masomenos', async ({ page }) => {
    await entrar(page);
    await responder(page, true);
    const respaldo = await page.evaluate(async () => {
      const { exportarRespaldo } = await import('./respaldo.js');
      const { cargarEstado } = await import('./motor.js').catch(() => ({}));
      return exportarRespaldo(cargarEstado ? cargarEstado() : { version: 2 }, localStorage);
    }).catch(() => null);
    if (respaldo) expect(JSON.parse(respaldo).modos['one.masomenos']).toBeTruthy();
    else expect(await page.evaluate(() => localStorage.getItem('one.masomenos'))).toBeTruthy();
  });

  // --- Revisión final de la fase 8 (verificada ejecutando la app y contrastando con Wikidata) --------------------------
  /** Pasa a Afinar con fechas y devuelve una función que mide las etiquetas de la línea temporal. */
  const medirLinea = (page) => page.evaluate(() => {
    const banda = document.querySelector('[data-test="escala-linea"]').getBoundingClientRect();
    const cajas = [...document.querySelectorAll('[data-test="escala-linea"] .escala-marca-texto, [data-test="escala-linea"] .escala-tic-texto')]
      .map((n) => { const r = n.getBoundingClientRect(); return { texto: n.textContent, izq: r.left, der: r.right, arriba: r.top, abajo: r.bottom }; });
    return { banda: { izq: banda.left, der: banda.right, arriba: banda.top, abajo: banda.bottom }, cajas, ancho: window.innerWidth };
  });
  const comprobarLinea = (m, donde) => {
    for (const c of m.cajas) {
      expect(c.izq, `${donde}: «${c.texto}» se sale por la izquierda`).toBeGreaterThanOrEqual(m.banda.izq - 0.5);
      expect(c.der, `${donde}: «${c.texto}» se sale por la derecha`).toBeLessThanOrEqual(m.banda.der + 0.5);
      expect(c.izq).toBeGreaterThanOrEqual(0);
      expect(c.der).toBeLessThanOrEqual(m.ancho);
      expect(c.arriba, `${donde}: «${c.texto}» se sale por arriba`).toBeGreaterThanOrEqual(m.banda.arriba - 0.5);
      expect(c.abajo, `${donde}: «${c.texto}» se sale por abajo`).toBeLessThanOrEqual(m.banda.abajo + 0.5);
    }
    for (let i = 0; i < m.cajas.length; i += 1) {
      for (let j = i + 1; j < m.cajas.length; j += 1) {
        const a = m.cajas[i];
        const b = m.cajas[j];
        const pisa = a.izq < b.der && b.izq < a.der && a.arriba < b.abajo && b.arriba < a.abajo;
        expect(pisa, `${donde}: «${a.texto}» pisa a «${b.texto}»`).toBe(false);
      }
    }
  };

  test('línea temporal legible a 375×667: ninguna etiqueta se pisa ni se sale de la banda (referencia, estimación y real, en 6 rondas)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await entrar(page, 'historia');
    await page.locator('[data-test="mm-var-afinar"]').click();
    await esperarAntirrebote(page);
    for (let ronda = 0; ronda < 6; ronda += 1) {
      await expect(page.locator('[data-test="escala-linea"]')).toBeVisible();
      await esperarAntirrebote(page); // un «Listo» en los primeros 350 ms de la ronda no cuenta
      comprobarLinea(await medirLinea(page), `ronda ${ronda} · solo referencia`);
      for (const anos of [0, 4, -20, 150]) {
        await page.evaluate((a) => window.__one.estimarMasomenos({ anos: a }), anos);
        comprobarLinea(await medirLinea(page), `ronda ${ronda} · estimación a ${anos} años`);
      }
      await page.evaluate(() => window.__one.estimarMasomenos({ anos: 4 }));
      await page.locator('[data-test="mm-listo"]').click();
      await expect(page.locator('[data-test="escala-marca-real"]')).toBeAttached();
      comprobarLinea(await medirLinea(page), `ronda ${ronda} · real`);
      await assertSinScroll(page);
      await siguiente(page);
    }
  });

  test('Afinar enseña la cifra real contando en el panel del resultado («Real: …»)', async ({ page }) => {
    await entrar(page, 'geografia');
    await page.locator('[data-test="mm-var-afinar"]').click();
    await esperarAntirrebote(page);
    const esperado = await page.evaluate(async () => {
      const { valorConUnidad } = await import('/masomenos.js');
      const p = window.__one.parejaMasomenos().abajo;
      return valorConUnidad(p);
    });
    await page.evaluate(() => {
      window.__cambiosReal = 0;
      new MutationObserver((lista) => {
        for (const m of lista) if ([...m.addedNodes].some((n) => n.dataset?.test === 'mm-real' || n.querySelector?.('[data-test="mm-real-valor"]')) || m.target.dataset?.test === 'mm-real-valor' || m.target.parentElement?.dataset?.test === 'mm-real-valor') window.__cambiosReal += 1;
      }).observe(document.querySelector('[data-test="mm-cuerpo"]'), { childList: true, subtree: true, characterData: true });
    });
    await page.evaluate(() => window.__one.estimarMasomenos({ factor: 1.3 }));
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-real"]')).toContainText('Real: ');
    await expect(page.locator('[data-test="mm-real-valor"]')).toHaveText(esperado);
    // contó (varios cambios de texto) en vez de aparecer de golpe, salvo que el sistema pida menos movimiento
    const reducido = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!reducido) expect(await page.evaluate(() => window.__cambiosReal)).toBeGreaterThan(2);
    await expect(page.locator('[data-test="mm-lectura"], .mm-lectura')).toHaveCount(0); // la lectura de la barra ya no está: la real vive en el panel
  });

  test('Comparar no pinta el contorno cian de «tu estimación» ni su rastro al revelar a escala', async ({ page }) => {
    await entrar(page, 'economia');
    await responder(page, true);
    await expect(page.locator('[data-test="escala-misteriosa"]')).toBeVisible();
    await expect(page.locator('.escala-caja--estimacion')).toHaveCount(0);
    await expect(page.locator('[data-test="escala-fantasma"]')).toHaveCount(0);
    expect(await page.locator('[data-test="escala-misteriosa"]').evaluate((n) => getComputedStyle(n).outlineStyle)).not.toBe('dashed');
  });

  test('el récord se celebra una sola vez por racha: la esfinge no se vuelve eufórica en cada acierto de la racha', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.masomenos', JSON.stringify({ version: 1, variante: 'comparar', comparar: { racha: 2, record: 3 }, afinar: { racha: 0, record: 0 } }));
    });
    await entrar(page);
    for (let i = 0; i < 4; i += 1) {
      await responder(page, true);
      await siguiente(page);
    }
    const gestos = await page.evaluate(() => window.__one.gestosPedidos);
    expect(gestos.filter((g) => g === 'euforia')).toHaveLength(1); // el gesto del récord es la euforia
    // al fallar y volver a superar el récord (7), se celebra otra vez
    await responder(page, false);
    await siguiente(page);
    for (let i = 0; i < 8; i += 1) {
      await responder(page, true);
      await siguiente(page);
    }
    expect((await page.evaluate(() => window.__one.gestosPedidos)).filter((g) => g === 'euforia')).toHaveLength(2);
  });

  test('cabecera del modo: una sola llama (la de racha del modo) y «Récord» separado de ella', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.masomenos', JSON.stringify({ version: 1, variante: 'comparar', comparar: { racha: 5, record: 5 }, afinar: { racha: 0, record: 0 } }));
    });
    await entrar(page);
    await expect(page.locator('[data-test="mm-racha"]')).toHaveText('🔥 5');
    await expect(page.locator('[data-test="racha"]')).toBeHidden(); // la llama general de la cabecera no duplica
    await expect(page.locator('[data-test="mm-record"]')).toHaveText('Récord 5');
    expect(await page.locator('[data-test="mm-record"]').evaluate((n) => getComputedStyle(n, '::before').content)).toBe('"· "');
    const separacion = await page.evaluate(() => {
      const a = document.querySelector('[data-test="mm-racha"]').getBoundingClientRect();
      const b = document.querySelector('[data-test="mm-record"]').getBoundingClientRect();
      return b.left - a.right;
    });
    expect(separacion).toBeGreaterThanOrEqual(6);
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="racha"]')).toBeVisible(); // fuera del modo vuelve
  });

  test.describe('con un banco de cifras a medida', () => {
    test.use({ serviceWorkers: 'block' }); // el service worker serviría el cifras.json del precaché en vez del de la prueba
    const cifra = (id, nombre, valor, extra = {}) => ({ id, area: 'economia', categoria: 'pib-pais', unidad: 'US$', nombre, valor, fuente: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD', fecha: '2024-12-31', ...extra });
    const PIB = [
      cifra('pib-1', 'Austria', 391026962800), cifra('pib-2', 'Bélgica', 644783000000), cifra('pib-3', 'Suecia', 584960000000),
      cifra('pib-4', 'Noruega', 485500000000), cifra('pib-5', 'Dinamarca', 407090000000), cifra('pib-6', 'Polonia', 809200000000),
      cifra('pib-7', 'Irlanda', 551400000000), cifra('pib-8', 'Argentina', 633300000000),
    ];
    const conBanco = async (page, banco) => {
      await page.route('**/datos/cifras.json', (r) => r.fulfill({ json: banco }));
    };

    test('cifras largas en formato compacto y nombres sin partir por letras en las tarjetas (375×667 y 375×812)', async ({ page }) => {
      await conBanco(page, PIB);
      await entrar(page);
      for (const vp of VIEWPORTS) {
        await page.setViewportSize(vp);
        for (let i = 0; i < 4; i += 1) {
          const medidas = await page.evaluate(() => [...document.querySelectorAll('.mm-tarjeta')].map((t) => {
            const caja = t.getBoundingClientRect();
            const nombre = t.querySelector('.mm-tarjeta-nombre');
            const valor = t.querySelector('.mm-tarjeta-valor');
            const lineaNombre = Number.parseFloat(getComputedStyle(nombre).lineHeight);
            return {
              nombre: nombre.textContent, valor: valor.textContent, tamano: Number.parseFloat(getComputedStyle(valor).fontSize),
              lineasNombre: Math.round(nombre.getBoundingClientRect().height / lineaNombre),
              valorDentro: valor.getBoundingClientRect().right <= caja.right + 0.5 && valor.getBoundingClientRect().left >= caja.left - 0.5,
              nombreAnchoCabe: nombre.scrollWidth <= nombre.clientWidth + 1,
            };
          }));
          for (const m of medidas) {
            expect(m.lineasNombre, `«${m.nombre}» no se parte`).toBe(1);
            expect(m.valorDentro, `«${m.valor}» cabe en su tarjeta`).toBe(true);
            expect(m.nombreAnchoCabe).toBe(true);
            expect(m.tamano).toBeGreaterThanOrEqual(11);
            expect(m.valor).not.toMatch(/\d{3}\.\d{3}\.\d{3}/); // nada de 391.026.962.800
          }
          expect(medidas[0].valor).toMatch(/millones US\$$/);
          await page.evaluate(() => window.__one.responderMasomenos(true));
          await siguiente(page);
        }
      }
    });

    test('un banco con menos cifras válidas que el mínimo avisa como si no hubiera cifras; las inválidas se descartan', async ({ page }) => {
      const malas = [
        cifra('x-1', 'Una', 1e9), cifra('x-2', 'Dos', 2e9, { unidad: 'euros' }), cifra('x-3', 'Tres', -5), cifra('x-4', 'Cuatro', 4e9, { area: 'arte' }),
        cifra('pib-1', 'Repetida', 5e9), cifra('pib-1', 'Otra con el mismo id', 6e9),
      ];
      await conBanco(page, malas);
      await page.goto('/?ejemplo=1&test=1');
      await entrarEnModo(page, 'masomenos');
      await expect(page.locator('[data-vista="masomenos"]')).toBeHidden();
      await expect(page.locator('#aviso-hub').first()).toContainText('No se pudieron cargar las cifras');
    });

    test('años a. C.: las Termópilas se escriben 480 a. C. (sin el año de menos) y todos con el formato «N a. C.»', async ({ page }) => {
      const hecho = (id, nombre, valor) => ({ id, area: 'historia', categoria: 'ano-hecho', unidad: 'año', nombre, valor, fuente: 'https://www.wikidata.org/wiki/Q1', fecha: '2026-10-11' });
      const banco = [
        hecho('ah-1', 'Batalla de las Termópilas', -480), hecho('ah-2', 'Batalla de Salamina', -480 + 1), hecho('ah-3', 'Batalla de Maratón', -490),
        hecho('ah-4', 'Batalla de Platea', -479), hecho('ah-5', 'Batalla de Gaugamela', -331), hecho('ah-6', 'Batalla de Issos', -333),
        hecho('ah-7', 'Batalla de Cannas', -216), hecho('ah-8', 'Batalla de Zama', -202),
      ];
      await conBanco(page, banco);
      await entrar(page);
      expect(await page.evaluate(() => window.__one.fijarParejaMasomenos('ah-2', 'ah-1'))).toBe(true); // Termópilas, la oculta, en la 1.ª
      await esperarAntirrebote(page);
      const textos = [];
      for (let i = 0; i < 6; i += 1) {
        await page.evaluate(() => window.__one.responderMasomenos(true));
        await page.waitForTimeout(900); // la cuenta termina
        textos.push(await page.locator('[data-test="mm-valor-abajo"]').textContent());
        await siguiente(page);
      }
      expect(textos.some((t) => t === '480 a. C.')).toBe(true);
      expect(textos.every((t) => /^\d+ a\. C\.$/.test(t))).toBe(true);
    });
  });
});

test.describe('ONE · v0.3 récord de Más o menos tras recargar (fase 9)', () => {
  test('recargar a mitad de una racha que ya iba en el récord no lo vuelve a celebrar', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.masomenos', JSON.stringify({ version: 1, variante: 'comparar', comparar: { racha: 5, record: 5 }, afinar: { racha: 0, record: 0 } }));
    });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'masomenos');
    await expect(page.locator('[data-test="mm-cuerpo"] > *').first()).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(450);
      await page.evaluate(() => window.__one.responderMasomenos(true));
      await page.waitForTimeout(450);
      await page.locator('[data-test="mm-siguiente"]').click();
    }
    await expect(page.locator('[data-test="mm-record"]')).toHaveText('Récord 8');
    expect((await page.evaluate(() => window.__one.gestosPedidos)).filter((g) => g === 'euforia')).toHaveLength(0);
  });
});

test.describe('ONE · v0.3 Órdago: el vigía de «pensando» arranca en la primera ronda (fase 9)', () => {
  test('a los 8 s sin tocar nada en la primera ronda la esfinge «piensa»', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__one.gestosPedidos), { timeout: 12000 }).toContain('pensando');
  });
});

test.describe('ONE · v0.3 barra de comodines (fase 9.2)', () => {
  const VIEWPORTS = [{ width: 375, height: 812 }, { width: 375, height: 667 }];
  const sinScrollEnAmbos = async (page, conTarjeta = false) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      if (conTarjeta) await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      if (conTarjeta) await assertTarjetaSinScroll(page);
    }
  };
  const esperarAntirrebote = (page) => page.waitForTimeout(450);
  const mochila = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.mochila')).objetos);
  const sembrar = async (page, objetos) => {
    await page.waitForFunction(() => window.__one?.listo === true); // sin esto, el arranque asíncrono puede pisar la partida con el hub
    await page.evaluate((o) => window.__one.sembrarMochila(o), objetos);
  };
  const tipoOrdago = (page) => page.evaluate(() => window.__one.ultimaPreguntaOrdago().tipo);
  const empezar = (page, ids) => page.evaluate((i) => window.__one.empezarPartida({ ids: i, etiqueta: 'comodines' }), ids);

  for (const [tipo, ids] of [['test4', ['cie-001']], ['vf', ['eco-001']], ['ordenar', ['his-002']]]) {
    test(`Clásico (${tipo}): la barra aparece con la mochila sembrada, sin scroll en 375×812 y 375×667 y sin hueco si está vacía`, async ({ page }) => {
      await page.goto('/?ejemplo=1&test=1');
      await sembrar(page, {});
      await empezar(page, ids);
      await expect(tarjetaActual(page)).toBeVisible();
      await expect(tarjetaActual(page).locator('[data-test="comodines"]')).toBeHidden(); // mochila vacía: nada
      await sembrar(page, { cincuenta: 1, salvavidas: 1, mas5: 1 });
      await empezar(page, ids);
      const barra = tarjetaActual(page).locator('[data-test="comodines"]');
      await expect(barra).toBeVisible();
      await expect(barra.locator('button')).toHaveCount(tipo === 'test4' ? 2 : 1); // +5 s no vale en Clásico; 50/50 solo en test4
      await expect(barra.locator('[data-test="comodin-mas5"]')).toHaveCount(0);
      await sinScrollEnAmbos(page, true);
    });
  }

  test('Clásico: 50/50 deja 2 opciones (doble toque = un solo uso) y la correcta sigue', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { cincuenta: 2 });
    await empezar(page, ['cie-001']);
    const t = tarjetaActual(page);
    await expect(t.locator('[data-test^="opcion-"]')).toHaveCount(4);
    await t.locator('[data-test="comodin-cincuenta"]').click({ clickCount: 2 });
    await expect(t.locator('[data-test^="opcion-"]:visible')).toHaveCount(2);
    await expect(t.locator('[data-test^="opcion-"][data-original="0"]')).toBeVisible();
    expect((await mochila(page)).cincuenta).toBe(1);
    await expect(t.locator('[data-test="comodin-cincuenta"]')).toBeDisabled();
    await sinScrollEnAmbos(page, true);
  });

  test('Clásico: Salvavidas armado y fallo = no respondida (no se registra) y se gasta una sola vez; si aciertas, no se gasta', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { salvavidas: 2 });
    await empezar(page, ['cie-001', 'art-001', 'tec-001']);
    // Armado y acertando: no se gasta.
    await tarjetaActual(page).locator('[data-test="comodin-salvavidas"]').click();
    await responderPreguntaActual(page);
    expect((await mochila(page)).salvavidas).toBe(2);
    await avanzarTrasRespuesta(page);
    // Armado y fallando: no cuenta como fallo ni se registra, y se gasta uno.
    const registradas = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('one.estado')).tarjetas ?? {}).length);
    const antes = await registradas();
    await tarjetaActual(page).locator('[data-test="comodin-salvavidas"]').click({ clickCount: 2 });
    await fallarPreguntaActual(page);
    await expect(tarjetaActual(page).locator('[data-test="comodines-aviso"]')).toContainText('no cuenta como fallo');
    await expect(tarjetaActual(page).locator('[data-test="siguiente"]')).toHaveCount(0); // sigue sin responder
    expect((await mochila(page)).salvavidas).toBe(1);
    expect(await registradas()).toBe(antes);
    await sinScrollEnAmbos(page, true);
    // La pregunta nueva se responde con normalidad.
    await page.setViewportSize({ width: 375, height: 812 });
    await esperarAntirrebote(page);
    await responderPreguntaActual(page);
    await expect(tarjetaActual(page).locator('[data-test="siguiente"]')).toBeVisible();
  });

  test('Órdago: 50/50 quita 2 respuestas y Salvavidas pierde la mitad de la ficha sin cortar la racha (sin scroll con la barra)', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { cincuenta: 1, salvavidas: 2 });
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible();
    for (let i = 0; i < 12 && (await tipoOrdago(page)) !== 'test4'; i += 1) {
      await esperarAntirrebote(page);
      await page.locator('[data-test="ficha-10"]').click();
      await page.evaluate(() => window.__one.acertarPreguntaOrdago());
      await esperarAntirrebote(page);
      await page.locator('[data-test="ordago-siguiente"]').click();
    }
    expect(await tipoOrdago(page)).toBe('test4');
    const barra = page.locator('[data-test="ordago-comodines"]');
    await expect(barra).toBeHidden(); // con las fichas en pantalla la barra aún no está: aparece con las opciones
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-10"]').click();
    await expect(barra.locator('button')).toHaveCount(2); // 50/50 + Salvavidas
    await sinScrollEnAmbos(page);
    await barra.locator('[data-test="comodin-cincuenta"]').click({ clickCount: 2 });
    expect((await mochila(page)).cincuenta).toBe(0);
    await expect(page.locator('[data-test="ordago-opciones"] button:visible')).toHaveCount(2);
    const cajas = await page.locator('[data-test="ordago-opciones"] button:visible').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { izq: r.left, der: r.right, abajo: r.bottom }; }));
    expect(cajas[0].izq).toBe(cajas[1].izq); // las 2 que quedan, en una columna: ocupan el hueco de las ocultas
    expect(cajas[0].der - cajas[0].izq).toBeGreaterThan(250);
    await expect(page.locator('[data-test="ordago-opciones"] [data-original="0"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    await barra.locator('[data-test="comodin-salvavidas"]').click({ clickCount: 2 });
    expect((await mochila(page)).salvavidas).toBe(2); // armado, aún no gastado
    const antes = await page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago'))) ?? { fondo: 1000, racha: 0 }; // sin rondas jugadas aún no hay nada guardado
    await page.evaluate(() => window.__one.fallarPreguntaOrdago());
    const despues = await page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago')));
    const apuesta = Math.max(1, Math.floor(antes.fondo * 0.1));
    expect(antes.fondo - despues.fondo).toBe(apuesta - Math.floor(apuesta / 2)); // pierde la mitad (la ficha menos su mitad)
    expect(despues.racha).toBe(antes.racha); // la racha no se corta
    expect((await mochila(page)).salvavidas).toBe(1);
    await expect(page.locator('[data-test="ordago-explicacion"]')).toContainText('Salvavidas');
    await expect(barra).toBeHidden(); // en el resultado la barra no está
    await sinScrollEnAmbos(page);
  });

  test('Contrarreloj: +5 s hace crecer la barra y Salvavidas perdona el fallo (sigues vivo), cada uno gastado una vez', async ({ page }) => {
    await page.clock.install();
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { mas5: 2, salvavidas: 2 });
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    const barraComodines = page.locator('[data-test="contrarreloj-comodines"]');
    await expect(barraComodines.locator('[data-test="comodin-mas5"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    await page.clock.fastForward(8000);
    await page.clock.runFor(100);
    const fraccion = () => page.locator('[data-test="contrarreloj-barra"]').evaluate((n) => Number(n.style.getPropertyValue('--fraccion')));
    const antes = await fraccion();
    await barraComodines.locator('[data-test="comodin-mas5"]').click({ clickCount: 2 });
    await page.clock.runFor(100);
    expect(await fraccion()).toBeGreaterThan(antes + 0.1);
    expect((await mochila(page)).mas5).toBe(1);
    await barraComodines.locator('[data-test="comodin-salvavidas"]').click({ clickCount: 2 });
    expect((await mochila(page)).salvavidas).toBe(2); // armado, aún no gastado
    await page.evaluate(() => window.__one.fallarContrarreloj());
    await expect(page.locator('[data-vista="caida"]')).toBeHidden();
    await page.clock.runFor(600);
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 2 de 10');
    expect((await mochila(page)).salvavidas).toBe(1);
    await expect(barraComodines.locator('[data-test="comodin-cantidad-salvavidas"]')).toHaveText('×1');
    await sinScrollEnAmbos(page);
    // Sin armar otro, el siguiente fallo sí tumba.
    await page.evaluate(() => window.__one.fallarContrarreloj());
    await expect(page.locator('[data-vista="caida"]')).toBeVisible();
    expect((await mochila(page)).salvavidas).toBe(1);
  });

  test('Más o menos: Salvavidas mantiene la racha ante un fallo en Comparar y ante Cerca/Lejos en Afinar; 50/50 y +5 s no aparecen', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.filtros', JSON.stringify({ masomenos: { area: 'economia', ruta: [], etiquetas: [] } }));
    });
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { cincuenta: 1, salvavidas: 2, mas5: 1 });
    await entrarEnModo(page, 'masomenos');
    await expect(page.locator('[data-test="mm-cuerpo"] > *').first()).toBeVisible();
    const barra = page.locator('[data-test="mm-comodines"]');
    await expect(barra.locator('button')).toHaveCount(1);
    await expect(barra.locator('[data-test="comodin-salvavidas"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    await esperarAntirrebote(page);
    await page.evaluate(() => window.__one.responderMasomenos(true));
    await esperarAntirrebote(page);
    await page.locator('[data-test="mm-siguiente"]').click();
    await esperarAntirrebote(page);
    await barra.locator('[data-test="comodin-salvavidas"]').click({ clickCount: 2 });
    expect((await mochila(page)).salvavidas).toBe(2);
    await page.evaluate(() => window.__one.responderMasomenos(false));
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toContainText('racha salvada');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.masomenos')).comparar)).toEqual({ racha: 1, record: 1 });
    expect((await mochila(page)).salvavidas).toBe(1);
    // Afinar: «Lejos» con el Salvavidas armado tampoco corta la racha.
    await esperarAntirrebote(page);
    await page.locator('[data-test="mm-var-afinar"]').click();
    await expect(page.locator('[data-test="mm-barra"]')).toBeVisible();
    await esperarAntirrebote(page);
    await page.locator('[data-test="mm-comodines"] [data-test="comodin-salvavidas"]').click();
    await page.evaluate(() => window.__one.estimarMasomenos({ factor: 15, anos: 1500 }));
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toContainText('racha salvada');
    expect((await mochila(page)).salvavidas).toBe(0);
  });
});

test.describe('ONE · v0.3 Tienda completa (fase 9.3)', () => {
  const VIEWPORTS = [{ width: 375, height: 812 }, { width: 375, height: 667 }];
  const sinScrollEnAmbos = async (page) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertSinScroll(page);
    }
  };
  const esperarAntirrebote = (page) => page.waitForTimeout(450);
  const fondoGuardado = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago') ?? '{"fondo":1000}').fondo);
  const mochila = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.mochila')).objetos);
  const abrirTienda = async (page) => {
    await page.locator('[data-test="tarjeta-tienda"]').click();
    await expect(page.locator('[data-vista="tienda"]')).toBeVisible();
  };

  test('comprar y vender: con 1.000, 50/50 → fondo 700 y «Tienes 1»; vender → 850; doble toque = una operación; sin scroll', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await abrirTienda(page);
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('1.000');
    await expect(page.locator('[data-test="tienda-vender-cincuenta"]')).toBeDisabled(); // no lo tienes
    await expect(page.locator('[data-test="tienda-comprar-cincuenta"]')).toHaveText('Comprar · 300');
    await expect(page.locator('[data-test="tienda-vender-cincuenta"]')).toHaveText('Vender · 150');
    await expect(page.locator('[data-test="tienda-comprar-salvavidas"]')).toHaveText('Comprar · 500');
    await expect(page.locator('[data-test="tienda-vender-mas5"]')).toHaveText('Vender · 100');
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1); // un solo reproductor por pantalla
    await sinScrollEnAmbos(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('[data-test="tienda-comprar-cincuenta"]').click({ clickCount: 2 });
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('700');
    await expect(page.locator('[data-test="tienda-cantidad-cincuenta"]')).toHaveText('Tienes 1');
    await expect(page.locator('[data-test="tienda-aviso"]')).toContainText('comprado');
    expect(await fondoGuardado(page)).toBe(700);
    expect((await mochila(page)).cincuenta).toBe(1); // el doble toque compró una sola vez
    expect(await page.evaluate(() => window.__one.gestosPedidos)).toContain('acierto');
    await sinScrollEnAmbos(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-vender-cincuenta"]').click({ clickCount: 2 });
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('850');
    await expect(page.locator('[data-test="tienda-cantidad-cincuenta"]')).toHaveText('Tienes 0');
    await expect(page.locator('[data-test="tienda-vender-cincuenta"]')).toBeDisabled();
    expect(await fondoGuardado(page)).toBe(850);
    expect((await mochila(page)).cincuenta).toBe(0);
    // Lo comprado llega al hub (🎒) y al fondo de su tarjeta.
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-comprar-mas5"]').click();
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="marcador-tienda"]')).toHaveText('🎒 1');
  });

  test('con fondo 400 el Salvavidas (500) no se puede comprar, el 50/50 (300) sí; con fondo justo queda en 0', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.ordago', JSON.stringify({ version: 1, fondo: 400, curva: [400], maximo: 1000, quiebras: 0, racha: 0 }));
    });
    await page.goto('/?ejemplo=1&test=1');
    await abrirTienda(page);
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('400');
    await expect(page.locator('[data-test="tienda-comprar-salvavidas"]')).toBeDisabled();
    await expect(page.locator('[data-test="tienda-comprar-cincuenta"]')).toBeEnabled();
    await page.locator('[data-test="tienda-comprar-mas5"]').click(); // 200 → quedan 200
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('200');
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-comprar-mas5"]').click(); // fondo justo → 0
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('0');
    await expect(page.locator('[data-test="tienda-comprar-mas5"]')).toBeDisabled();
    expect(await fondoGuardado(page)).toBe(0);
  });

  test('rarezas: etiqueta de color por objeto y solo el épico (dorado) lleva resplandor', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await abrirTienda(page);
    await expect(page.locator('[data-test="tienda-rareza-mas5"]')).toHaveText('Común');
    await expect(page.locator('[data-test="tienda-rareza-cincuenta"]')).toHaveText('Raro');
    await expect(page.locator('[data-test="tienda-rareza-salvavidas"]')).toHaveText('Épico');
    const sombra = (id) => page.locator(`[data-test="tienda-rareza-${id}"]`).evaluate((n) => getComputedStyle(n).boxShadow);
    expect(await sombra('mas5')).toBe('none');
    expect(await sombra('cincuenta')).toBe('none');
    expect(await sombra('salvavidas')).not.toBe('none');
    // Letra funcional >= 11 px y relleno >= 8 px en todo lo que tiene borde o fondo.
    const medidas = await page.evaluate(() => [...document.querySelectorAll('[data-vista="tienda"] .tienda-boton, [data-vista="tienda"] .cofre-etiqueta, [data-vista="tienda"] .tienda-objeto')].map((n) => {
      const c = getComputedStyle(n);
      return { letra: parseFloat(c.fontSize), relleno: Math.min(parseFloat(c.paddingTop), parseFloat(c.paddingBottom), parseFloat(c.paddingLeft), parseFloat(c.paddingRight)) };
    }));
    for (const m of medidas) {
      expect(m.letra).toBeGreaterThanOrEqual(11);
      expect(m.relleno).toBeGreaterThanOrEqual(8);
    }
  });

  test('quiebra con objetos: «Vender objetos → Tienda» lleva a la Tienda, vender saca del pozo y Órdago sigue con el fondo que queda', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await page.evaluate(() => window.__one.sembrarMochila({ cincuenta: 1 }));
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-ordago"]').click();
    await page.evaluate(() => window.__one.fallarPreguntaOrdago());
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-siguiente"]').click();
    await expect(page.locator('[data-vista="quiebra"]')).toBeVisible();
    await expect(page.locator('[data-test="quiebra-vender"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await esperarAntirrebote(page);
    await page.locator('[data-test="quiebra-vender"]').click({ clickCount: 2 });
    await expect(page.locator('[data-vista="tienda"]')).toBeVisible();
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('0');
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1);
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-vender-cincuenta"]').click();
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('150');
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.waitForTimeout(450);
    await entrarEnModo(page, 'ordago');
    await expect(page.locator('[data-vista="ordago"]')).toBeVisible(); // ya no está en quiebra
    await expect(page.locator('[data-test="ordago-fondo"]')).toHaveText('150');
  });

  test('quiebra sin objetos: no hay botón de vender', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-ordago"]').click();
    await page.evaluate(() => window.__one.fallarPreguntaOrdago());
    await esperarAntirrebote(page);
    await page.locator('[data-test="ordago-siguiente"]').click();
    await expect(page.locator('[data-vista="quiebra"]')).toBeVisible();
    await expect(page.locator('[data-test="quiebra-vender"]')).toBeHidden();
  });

  test('con el almacenamiento bloqueado comprar y vender viven en memoria y nada lanza', async ({ page }) => {
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.addInitScript(() => {
      const bloqueadas = ['one.mochila', 'one.ordago'];
      const setItem = Storage.prototype.setItem;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.setItem = function (k, v) {
        if (bloqueadas.includes(k)) throw new Error('SecurityError');
        return setItem.call(this, k, v);
      };
      Storage.prototype.getItem = function (k) {
        if (bloqueadas.includes(k)) throw new Error('SecurityError');
        return getItem.call(this, k);
      };
    });
    await page.goto('/?ejemplo=1&test=1');
    await abrirTienda(page);
    await page.locator('[data-test="tienda-comprar-cincuenta"]').click();
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('700');
    await expect(page.locator('[data-test="tienda-cantidad-cincuenta"]')).toHaveText('Tienes 1');
    await esperarAntirrebote(page);
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="marcador-tienda"]')).toHaveText('🎒 1');
    await page.waitForTimeout(450);
    await abrirTienda(page);
    await expect(page.locator('[data-test="tienda-fondo"]')).toHaveText('700');
    expect(errores).toEqual([]);
  });
});

test.describe('ONE · v0.3.1 Contrarreloj con rampa y Premium', () => {
  test('Contrarreloj, banco completo: preguntas 1-2 de nivel 1, 3-4 de nivel 2 y la 10 de nivel ≥ 4', async ({ page }) => {
    await page.goto('/?test=1');
    await page.waitForFunction(() => window.__one?.listo === true);
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    const niveles = [];
    for (let i = 0; i < 10; i += 1) {
      niveles.push((await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj())).nivel);
      if (i < 9) await page.evaluate(() => window.__one.acertarContrarreloj(1));
    }
    expect(niveles.slice(0, 2)).toEqual([1, 1]);
    expect(niveles.slice(2, 4)).toEqual([2, 2]);
    expect(niveles[9]).toBeGreaterThanOrEqual(4);
  });

  test('Premium: hub → «+» → Activar → fondo +1.000 → «Activo desde…», sin scroll a 375×667 (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await page.waitForFunction(() => window.__one?.listo === true);
    const boton = page.locator('[data-test="premium-boton"]');
    await expect(boton).toBeVisible();
    await expect(boton).toHaveAttribute('aria-label', 'Premium');
    expect((await boton.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await boton.click();
    await expect(page.locator('[data-vista="premium"]')).toBeVisible();
    await expect(page.locator('[data-test="premium-boton"]')).toBeHidden();
    await expect(page.locator('h2.premium-titulo')).toHaveText('Esfinx Premium');
    await expect(page.locator('canvas.avatar-lienzo, img.avatar-fijo')).toHaveCount(1); // la esfinge protagonista, un solo reproductor
    await assertSinScroll(page);
    const activar = page.locator('[data-test="premium-activar"]');
    expect((await activar.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(600); // deja que la esfinge pinte su primer fotograma antes de la captura
    await page.screenshot({ path: 'docs/capturas/v0.3.1-premium-375x667.png' });
    const fondo = () => page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago') ?? '{"fondo":1000}').fondo);
    expect(await fondo()).toBe(1000);
    await activar.click({ clickCount: 2 }); // el doble toque es una sola activación
    await expect(page.locator('[data-test="premium-estado"]')).toContainText('Activo desde');
    await expect(activar).toBeHidden();
    expect(await fondo()).toBe(2000);
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('one.premium')));
    expect(guardado).toMatchObject({ activo: true, bonificado: true });
    await assertSinScroll(page);
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-test="premium-boton"]')).toHaveAttribute('aria-label', 'Premium activo');
    await page.locator('[data-test="premium-boton"]').click();
    await page.locator('[data-test="premium-desactivar"]').click();
    await page.waitForTimeout(450); // antirrebote
    await page.locator('[data-test="premium-activar"]').click(); // reactivar no regala más
    await expect(page.locator('[data-test="premium-estado"]')).toContainText('Activo desde');
    expect(await fondo()).toBe(2000);
  });

  test('Premium: con la tanda gratis del día gastada, «Generar preguntas» abre Premium sin pedir nada; con Premium activo genera', async ({ page }) => {
    const peticiones = [];
    const cors = {
      'Access-Control-Allow-Origin': 'http://localhost:8765',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    await page.route('https://servidor.prueba/**', async (ruta) => {
      const peticion = ruta.request();
      if (peticion.method() === 'OPTIONS') {
        await ruta.fulfill({ status: 204, headers: cors });
        return;
      }
      const cabeceras = { ...cors, 'Content-Type': 'application/json' };
      if (new URL(peticion.url()).pathname === '/generar') {
        peticiones.push(peticion.postDataJSON());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ trabajoId: 't-1', enCola: 1, estimadoSeg: 40 }) });
      } else {
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [], motivo: null, estado_servidor: 'ok' }) });
      }
    });
    await page.addInitScript(() => {
      const d = new Date();
      const dos = (n) => String(n).padStart(2, '0');
      if (!sessionStorage.getItem('sembrado')) {
        sessionStorage.setItem('sembrado', '1');
        localStorage.setItem('one.filtros', JSON.stringify({ contrarreloj: { area: 'geografia', ruta: [], etiquetas: [] } }));
        localStorage.setItem('one.premium.generadas', JSON.stringify({ dia: `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`, n: 1 }));
      }
    });
    await page.goto('/?ejemplo=1&test=1&servidor=https%3A%2F%2Fservidor.prueba&token=token-de-prueba-e2e-1234567890');
    await entrarEnModo(page, 'contrarreloj');
    await page.locator('[data-test="filtro-corto-generar"]').click();
    await expect(page.locator('[data-vista="premium"]')).toBeVisible();
    await expect(page.locator('[data-test="premium-motivo"]')).toContainText('tanda gratis');
    expect(peticiones).toHaveLength(0);
    await page.locator('[data-test="premium-activar"]').click();
    await expect(page.locator('[data-test="premium-estado"]')).toContainText('Activo desde');
    await page.locator('[data-test="volver"]').click();
    await entrarEnModo(page, 'contrarreloj');
    await page.locator('[data-test="filtro-corto-generar"]').click();
    await expect.poll(() => peticiones.length).toBe(1);
  });
});

test.describe('ONE · v0.3.2 «Saber +» en todos los modos', () => {
  const esperarAntirrebote = (page) => page.waitForTimeout(450);

  /** Con el botón visible: abrirlo enseña tres enlaces con su href, el panel cabe en la ventana con ≥ 8 px de
   * margen y no se mueve el scroll; tocar fuera (`fuera`) lo cierra sin hacer lo que hacía ese toque
   * (`intacto` lo comprueba). `capturas` (opcional) guarda el cerrado y el abierto. */
  async function comprobarSaberMas(page, { fuera, intacto, capturas = null }) {
    const boton = page.locator('[data-test="saber-mas"]:visible').first();
    await expect(boton).toBeVisible();
    await expect(boton).toContainText('Saber +');
    expect((await boton.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('[data-test="saber-mas-menu"]')).toHaveCount(0);
    const scrollAntes = await page.evaluate(() => [document.scrollingElement.scrollHeight, document.scrollingElement.scrollTop]);
    if (capturas) await page.screenshot({ path: `${CAPTURAS}/v0.3.2-saber-mas-${capturas}-cerrado.png` });
    await boton.click();
    const menu = page.locator('[data-test="saber-mas-menu"]');
    await expect(menu).toBeVisible();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('a')).toHaveCount(3);
    await expect(menu.locator('[data-test="preguntar-chatgpt"]')).toHaveAttribute('href', /^https:\/\/chatgpt\.com\/\?q=./);
    await expect(menu.locator('[data-test="preguntar-claude"]')).toHaveAttribute('href', /^https:\/\/claude\.ai\/new\?q=./);
    await expect(menu.locator('[data-test="preguntar-gemini"]')).toHaveAttribute('href', /^https:\/\/www\.google\.com\/search\?udm=50&q=./);
    const caja = await menu.boundingBox();
    const vp = page.viewportSize();
    expect(caja.y).toBeGreaterThanOrEqual(8);
    expect(caja.x).toBeGreaterThanOrEqual(8);
    expect(caja.y + caja.height).toBeLessThanOrEqual(vp.height - 8);
    expect(caja.x + caja.width).toBeLessThanOrEqual(vp.width - 8);
    expect(await page.evaluate(() => [document.scrollingElement.scrollHeight, document.scrollingElement.scrollTop])).toEqual(scrollAntes);
    if (capturas) await page.screenshot({ path: `${CAPTURAS}/v0.3.2-saber-mas-${capturas}-abierto.png` });
    await fuera.click();
    await expect(menu).toHaveCount(0);
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await intacto();
    // Escape también cierra y devuelve el foco al botón.
    await boton.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(boton).toBeFocused();
  }

  test('Clásico y Repaso: tras responder, «Saber +» abre tres enlaces y el toque fuera no avanza', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?ejemplo=1&test=1');
    await page.locator('[data-test="modo-clasico"]').click();
    await responderPreguntaActual(page);
    await esperarAsentamientoMazo(page);
    const indice = await tarjetaActual(page).getAttribute('data-indice');
    await comprobarSaberMas(page, {
      fuera: tarjetaActual(page).locator('[data-test="siguiente"]'),
      intacto: async () => { expect(await tarjetaActual(page).getAttribute('data-indice')).toBe(indice); },
      capturas: 'clasico',
    });
    // Repaso (soloLectura): el mismo botón.
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await abrirFeedRepaso(page);
    await esperarAsentamientoMazo(page);
    const indiceRepaso = await tarjetaActual(page).getAttribute('data-indice');
    await comprobarSaberMas(page, {
      fuera: tarjetaActual(page).locator('[data-test="siguiente"]'),
      intacto: async () => { expect(await tarjetaActual(page).getAttribute('data-indice')).toBe(indiceRepaso); },
    });
  });

  test('Órdago: bajo la explicación de la ronda revelada; el toque fuera no pasa de ronda', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'ordago');
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-10"]').click();
    await page.evaluate(() => window.__one.acertarPreguntaOrdago());
    await expect(page.locator('[data-test="ordago-resultado"]')).toBeVisible();
    await esperarAntirrebote(page);
    await comprobarSaberMas(page, {
      fuera: page.locator('[data-test="ordago-siguiente"]'),
      intacto: async () => { await expect(page.locator('[data-test="ordago-resultado"]')).toBeVisible(); },
      capturas: 'ordago',
    });
  });

  test('Contrarreloj: en «Has caído», no durante la serie', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    await expect(page.locator('[data-test="saber-mas"]:visible')).toHaveCount(0);
    await esperarAntirrebote(page);
    await page.evaluate(() => window.__one.fallarContrarreloj());
    await expect(page.locator('[data-vista="caida"]')).toBeVisible();
    await esperarAntirrebote(page);
    await comprobarSaberMas(page, {
      fuera: page.locator('[data-test="caida-reintentar"]'),
      intacto: async () => { await expect(page.locator('[data-vista="caida"]')).toBeVisible(); },
    });
  });

  test('Más o menos: Comparar y Afinar, con el prompt de cifras', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await entrarEnModo(page, 'masomenos');
    await expect(page.locator('[data-test="mm-cuerpo"] > *').first()).toBeVisible();
    await esperarAntirrebote(page);
    const p = await page.evaluate(() => window.__one.parejaMasomenos());
    await page.locator(`[data-test="mm-${p.abajo.valor > p.arriba.valor ? 'mas' : 'menos'}"]`).click();
    await expect(page.locator('[data-test="mm-resultado-titulo"]')).toBeVisible();
    await esperarAntirrebote(page);
    await comprobarSaberMas(page, {
      fuera: page.locator('[data-test="mm-siguiente"]'),
      intacto: async () => { await expect(page.locator('[data-test="mm-resultado-titulo"]')).toBeVisible(); },
    });
    await page.locator('[data-test="saber-mas"]:visible').first().click();
    const href = await page.locator('[data-test="preguntar-claude"]').getAttribute('href');
    const prompt = decodeURIComponent(href.split('?q=')[1]);
    expect(prompt).toContain('Comparación:');
    expect(prompt).toContain(p.abajo.nombre);
    await page.keyboard.press('Escape');

    await page.locator('[data-test="mm-var-afinar"]').click();
    await esperarAntirrebote(page);
    await page.evaluate(() => window.__one.estimarMasomenos({ factor: 1.3 }));
    await page.locator('[data-test="mm-listo"]').click();
    await expect(page.locator('[data-test="mm-real"]')).toBeVisible();
    await esperarAntirrebote(page);
    await comprobarSaberMas(page, {
      fuera: page.locator('[data-test="mm-siguiente"]'),
      intacto: async () => { await expect(page.locator('[data-test="mm-real"]')).toBeVisible(); },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v0.3.3: Tienda ampliada (Saltar, Segunda oportunidad, Escudo de racha, Cofre, Títulos) y esfinge a 100 px
// ---------------------------------------------------------------------------------------------------------------
test.describe('ONE · v0.3.3 Tienda ampliada', () => {
  const VIEWPORTS = [{ width: 375, height: 812 }, { width: 375, height: 667 }];
  const sinScrollEnAmbos = async (page, conTarjeta = false) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      if (conTarjeta) await esperarAsentamientoMazo(page);
      await assertSinScroll(page);
      if (conTarjeta) await assertTarjetaSinScroll(page);
    }
  };
  const esperarAntirrebote = (page) => page.waitForTimeout(450);
  const mochila = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.mochila')));
  const objetos = async (page) => (await mochila(page)).objetos;
  const fondoGuardado = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago') ?? '{"fondo":1000}').fondo);
  const sembrar = async (page, o) => {
    await page.waitForFunction(() => window.__one?.listo === true);
    await page.evaluate((x) => window.__one.sembrarMochila(x), o);
  };
  const conFondo = (page, fondo) => page.addInitScript((f) => {
    localStorage.setItem('one.ordago', JSON.stringify({ version: 1, fondo: f, curva: [f], maximo: Math.max(1000, f), quiebras: 0, racha: 0 }));
  }, fondo);
  const abrirTienda = async (page) => {
    await page.locator('[data-test="tarjeta-tienda"]').click();
    await expect(page.locator('[data-vista="tienda"]')).toBeVisible();
  };
  const empezar = (page, ids) => page.evaluate((i) => window.__one.empezarPartida({ ids: i, etiqueta: 'comodines' }), ids);
  const textoTarjeta = (page) => tarjetaActual(page).locator('.tarjeta-contenido').innerText();
  const ultimasCiencia = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.estado') ?? '{}').areas?.ciencia?.ultimas ?? []);

  test('Tienda a 375×667: esfinge de 100 px, tres grupos, la lista hace scroll por dentro y la página no (capturas)', async ({ page }) => {
    await conFondo(page, 5000);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await abrirTienda(page);
    const caja = await page.locator('[data-test="tienda-avatar"]').boundingBox();
    expect([caja.width, caja.height]).toEqual([100, 100]);
    await expect(page.locator('[data-test="tienda-avatar"] canvas.avatar-lienzo, [data-test="tienda-avatar"] img.avatar-fijo')).toHaveCount(1);
    const lado = await page.locator('[data-test="tienda-avatar"] .avatar-lienzo, [data-test="tienda-avatar"] .avatar-fijo').first().evaluate((c) => c.getBoundingClientRect().height);
    expect(lado).toBeGreaterThanOrEqual(96);
    expect(lado).toBeLessThanOrEqual(100);
    await expect(page.locator('.tienda-grupo-titulo')).toHaveText(['Comodines', 'Cofre', 'Títulos']);
    await expect(page.locator('[data-test="tienda-grupo-comodines"] .tienda-objeto')).toHaveCount(6);
    await expect(page.locator('[data-test="tienda-grupo-titulos"] .tienda-objeto')).toHaveCount(5);
    await assertSinScroll(page); // la página no se desplaza
    const lista = page.locator('[data-test="tienda-mochila"]');
    const medidas = await lista.evaluate((n) => ({ alto: n.scrollHeight, visible: n.clientHeight, overflow: getComputedStyle(n).overflowY }));
    expect(medidas.overflow).toBe('auto');
    expect(medidas.alto).toBeGreaterThan(medidas.visible + 40); // hay más de lo que cabe: el scroll es de la lista
    const cajaLista = await lista.boundingBox();
    expect(cajaLista.y + cajaLista.height).toBeLessThanOrEqual(667); // la lista termina dentro de la pantalla
    await page.waitForTimeout(700); // deja que la esfinge pinte su primer fotograma
    await page.screenshot({ path: 'docs/capturas/v0.3.3-tienda-375x667.png' });
    await lista.evaluate((n) => { n.scrollTop = n.scrollHeight; });
    await expect.poll(() => lista.evaluate((n) => n.scrollTop)).toBeGreaterThan(100);
    await assertSinScroll(page);
    await page.screenshot({ path: 'docs/capturas/v0.3.3-tienda-scroll-375x667.png' });
    await page.setViewportSize({ width: 430, height: 932 });
    await lista.evaluate((n) => { n.scrollTop = 0; });
    await assertSinScroll(page);
    await page.screenshot({ path: 'docs/capturas/v0.3.3-tienda-430x932.png' });
  });

  test('Premium a 375×667: esfinge de 100 px y sin scroll (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?ejemplo=1&test=1');
    await page.waitForFunction(() => window.__one?.listo === true);
    await page.locator('[data-test="premium-boton"]').click();
    await expect(page.locator('[data-vista="premium"]')).toBeVisible();
    const caja = await page.locator('[data-test="premium-avatar"]').boundingBox();
    expect([caja.width, caja.height]).toEqual([100, 100]);
    await assertSinScroll(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'docs/capturas/v0.3.3-premium-375x667.png' });
    await page.locator('[data-test="premium-activar"]').click();
    await expect(page.locator('[data-test="premium-estado"]')).toContainText('Activo desde');
    await assertSinScroll(page);
  });

  test('comprar cada tipo: Saltar, Segunda oportunidad, Escudo (tope de 2), Cofre y Título; sin scroll en la página', async ({ page }) => {
    await conFondo(page, 5000);
    await page.goto('/?ejemplo=1&test=1');
    await abrirTienda(page);
    await expect(page.locator('[data-test="tienda-comprar-saltar"]')).toHaveText('Comprar · 250');
    await expect(page.locator('[data-test="tienda-comprar-segunda"]')).toHaveText('Comprar · 400');
    await expect(page.locator('[data-test="tienda-comprar-escudo"]')).toHaveText('Comprar · 600');
    await expect(page.locator('[data-test="tienda-comprar-cofre"]')).toHaveText('Comprar · 250');
    await page.locator('[data-test="tienda-comprar-saltar"]').click({ clickCount: 2 }); // doble toque = una compra
    await expect(page.locator('[data-test="tienda-cantidad-saltar"]')).toHaveText('Tienes 1');
    expect(await fondoGuardado(page)).toBe(4750);
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-comprar-segunda"]').click();
    await expect(page.locator('[data-test="tienda-cantidad-segunda"]')).toHaveText('Tienes 1');
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-comprar-escudo"]').click();
    await esperarAntirrebote(page);
    await page.locator('[data-test="tienda-comprar-escudo"]').click();
    await expect(page.locator('[data-test="tienda-cantidad-escudo"]')).toHaveText('Tienes 2');
    await expect(page.locator('[data-test="tienda-comprar-escudo"]')).toBeDisabled(); // tope de 2
    expect((await objetos(page)).escudo).toBe(2);
    expect(await fondoGuardado(page)).toBe(4750 - 400 - 600 - 600);
    // Cofre: cobra 250, anuncia el objeto y lo mete en la mochila; sus probabilidades están a la vista.
    await expect(page.locator('[data-test="tienda-cofre-probabilidades"]')).toContainText('+5 s 30 % · Saltar 25 % · 50/50 20 % · Segunda oportunidad 15 % · Salvavidas 10 %');
    await esperarAntirrebote(page);
    const antes = Object.values(await objetos(page)).reduce((a, b) => a + b, 0);
    const fondoAntes = await fondoGuardado(page);
    const aciertosAntes = await page.evaluate(() => window.__one.gestosPedidos.filter((g) => g === 'acierto').length);
    await page.locator('[data-test="tienda-comprar-cofre"]').click({ clickCount: 2 });
    await expect(page.locator('[data-test="tienda-aviso"]')).toContainText('Cofre abierto');
    expect(await fondoGuardado(page)).toBe(fondoAntes - 250);
    expect(Object.values(await objetos(page)).reduce((a, b) => a + b, 0)).toBe(antes + 1); // un solo objeto, el cofre no se guarda
    expect(await page.evaluate(() => window.__one.gestosPedidos.filter((g) => g === 'acierto').length)).toBe(aciertosAntes + 1); // un solo gesto de acierto
    // Títulos: se compran, se equipan y no se venden.
    await esperarAntirrebote(page);
    const boton = page.locator('[data-test="tienda-titulo-erudito"]');
    await expect(boton).toHaveText('Comprar · 500');
    await boton.click();
    await expect(boton).toHaveText('Equipar');
    expect((await mochila(page)).titulos).toEqual(['erudito']);
    await esperarAntirrebote(page);
    await boton.click();
    await expect(boton).toHaveText('Equipado');
    await expect(page.locator('[data-test="tienda-titulo-equipado"]')).toHaveText('📜 Erudito');
    await expect(page.locator('[data-test="tienda-vender-erudito"]')).toHaveCount(0);
    expect((await mochila(page)).titulo).toBe('erudito');
    await sinScrollEnAmbos(page);
  });

  test('el título equipado se ve bajo «Tienda» en el hub; Leyenda va en dorado y es lo único con resplandor', async ({ page }) => {
    await conFondo(page, 5000);
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-test="titulo-tienda"]')).toBeHidden();
    await abrirTienda(page);
    for (const id of ['curioso', 'leyenda']) {
      await esperarAntirrebote(page);
      await page.locator(`[data-test="tienda-titulo-${id}"]`).click(); // comprar
      await esperarAntirrebote(page);
      await page.locator(`[data-test="tienda-titulo-${id}"]`).click(); // equipar
      await expect(page.locator(`[data-test="tienda-titulo-${id}"]`)).toHaveText('Equipado');
      const sombra = await page.locator('[data-test="tienda-titulo-equipado"]').evaluate((n) => getComputedStyle(n).textShadow);
      if (id === 'leyenda') expect(sombra).not.toBe('none');
      else expect(sombra).toBe('none');
      await esperarAntirrebote(page);
      await page.locator('[data-test="volver"]').click();
      const titulo = page.locator('[data-test="titulo-tienda"]');
      await expect(titulo).toBeVisible();
      await expect(titulo).toHaveText(id === 'curioso' ? '📜 Curioso' : '📜 Leyenda');
      const [cNombre, cTitulo, cMarcador] = await Promise.all([
        page.locator('[data-test="tarjeta-tienda"] .hub-modo-nombre').boundingBox(),
        titulo.boundingBox(),
        page.locator('[data-test="marcador-tienda"]').boundingBox(),
      ]);
      expect(cTitulo.y).toBeGreaterThanOrEqual(cNombre.y + cNombre.height - 1); // bajo «Tienda»
      expect(cMarcador.y).toBeGreaterThanOrEqual(cTitulo.y + cTitulo.height - 1);
      const sombraHub = await titulo.evaluate((n) => getComputedStyle(n).textShadow);
      if (id === 'leyenda') expect(sombraHub).not.toBe('none');
      else expect(sombraHub).toBe('none');
      await esperarAntirrebote(page);
      if (id === 'curioso') await abrirTienda(page);
    }
  });

  test('Clásico · Saltar: otra pregunta sin tocar el radar ni el contador, se gasta uno y el doble toque es un solo uso', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { saltar: 2 });
    await empezar(page, ['cie-001', 'art-001', 'tec-001']);
    const antes = await textoTarjeta(page);
    const contador = await tarjetaActual(page).locator('[data-test="mazo-contador"]').innerText();
    const estadoAntes = await page.evaluate(() => localStorage.getItem('one.estado'));
    await tarjetaActual(page).locator('[data-test="comodin-saltar"]').click({ clickCount: 2 });
    await expect.poll(() => textoTarjeta(page)).not.toBe(antes);
    expect((await objetos(page)).saltar).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('one.estado'))).toBe(estadoAntes); // ni radar ni repaso
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText(contador);
    await expect(tarjetaActual(page).locator('[data-test="comodin-cantidad-saltar"]')).toHaveText('×1');
    await sinScrollEnAmbos(page, true);
  });

  test('Clásico · Saltar desarma el Salvavidas armado sin gastarlo; también vale en V/F', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { saltar: 1, salvavidas: 1 });
    await empezar(page, ['cie-001', 'art-001', 'tec-001']);
    await tarjetaActual(page).locator('[data-test="comodin-salvavidas"]').click();
    await esperarAntirrebote(page);
    await tarjetaActual(page).locator('[data-test="comodin-saltar"]').click();
    await esperarAntirrebote(page);
    await expect(tarjetaActual(page).locator('[data-test="comodin-salvavidas"]')).toHaveAttribute('aria-pressed', 'false'); // desarmado
    expect(await objetos(page)).toMatchObject({ salvavidas: 1, saltar: 0 });
  });

  test('Clásico · Segunda oportunidad: tacha la fallada, el radar anota el fallo una sola vez y el segundo intento cuenta como acierto', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { segunda: 1 });
    await empezar(page, ['cie-001']);
    const t = tarjetaActual(page);
    await t.locator('[data-test="comodin-segunda"]').click({ clickCount: 2 });
    expect((await objetos(page)).segunda).toBe(1); // armada, aún no gastada
    await t.locator('[data-test^="opcion-"][data-original="3"]').click();
    await expect(t.locator('[data-test^="opcion-"][data-original="3"]')).toBeDisabled();
    await expect(t.locator('[data-test^="opcion-"][data-original="3"]')).toHaveClass(/opcion-tachada/);
    await expect(t.locator('[data-test="comodines-aviso"]')).toContainText('Segunda oportunidad');
    await expect(t.locator('[data-test="siguiente"]')).toHaveCount(0); // sigue sin responder
    expect((await objetos(page)).segunda).toBe(0);
    expect(await ultimasCiencia(page)).toEqual([false]); // el fallo está en el radar
    await sinScrollEnAmbos(page, true);
    await page.setViewportSize({ width: 375, height: 812 });
    await esperarAntirrebote(page);
    await t.locator('[data-test^="opcion-"][data-original="0"]').click();
    await expect(t.locator('[data-test="siguiente"]')).toBeVisible();
    expect(await ultimasCiencia(page)).toEqual([false]); // el acierto del segundo intento no se vuelve a registrar
    await avanzarTrasRespuesta(page);
    await expect(page.locator('[data-test="resumen-cifras"]')).toContainText('1/1'); // pero en la partida cuenta como acierto
  });

  test('Clásico · Segunda oportunidad + Salvavidas: primero actúa la Segunda; el Salvavidas solo si el segundo intento también falla', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { segunda: 1, salvavidas: 1 });
    await empezar(page, ['cie-001']);
    const t = tarjetaActual(page);
    await t.locator('[data-test="comodin-segunda"]').click();
    await t.locator('[data-test="comodin-salvavidas"]').click();
    await t.locator('[data-test^="opcion-"][data-original="3"]').click();
    await expect(t.locator('[data-test="comodines-aviso"]')).toContainText('Segunda oportunidad');
    expect(await objetos(page)).toMatchObject({ segunda: 0, salvavidas: 1 });
    await esperarAntirrebote(page);
    await t.locator('[data-test^="opcion-"][data-original="2"]').click(); // el segundo intento también falla
    await expect(tarjetaActual(page).locator('[data-test="comodines-aviso"]')).toContainText('no cuenta como fallo');
    expect(await objetos(page)).toMatchObject({ segunda: 0, salvavidas: 0 });
  });

  test('Segunda oportunidad no aparece en verdadero/falso ni en cifras', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { segunda: 1 });
    await empezar(page, ['eco-001']);
    await expect(tarjetaActual(page).locator('[data-test="comodin-segunda"]')).toHaveCount(0);
  });

  test('Órdago · Saltar solo antes de elegir ficha: cambia la pregunta sin tocar el fondo y desaparece al apostar', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { saltar: 2, salvavidas: 1 });
    await entrarEnModo(page, 'ordago');
    const barra = page.locator('[data-test="ordago-comodines"]');
    await expect(barra.locator('button')).toHaveCount(1); // con las fichas, solo Saltar
    await expect(barra.locator('[data-test="comodin-saltar"]')).toBeVisible();
    await sinScrollEnAmbos(page);
    const idAntes = await page.evaluate(() => window.__one.ultimaPreguntaOrdago().id);
    await esperarAntirrebote(page);
    await barra.locator('[data-test="comodin-saltar"]').click({ clickCount: 2 });
    await expect.poll(() => page.evaluate(() => window.__one.ultimaPreguntaOrdago().id)).not.toBe(idAntes);
    expect((await objetos(page)).saltar).toBe(1); // el doble toque gastó uno solo
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.ordago') ?? '{}').pendiente ?? null)).toBeNull(); // nada comprometido
    expect(await fondoGuardado(page)).toBe(1000);
    await esperarAntirrebote(page);
    await page.locator('[data-test="ficha-10"]').click();
    await expect(barra.locator('[data-test="comodin-saltar"]')).toHaveCount(0); // con la ficha puesta ya no se puede saltar
    await expect(barra.locator('[data-test="comodin-salvavidas"]')).toBeVisible();
    await sinScrollEnAmbos(page);
  });

  test('Contrarreloj · Saltar: otra pregunta con el reloj de nuevo y el contador sin avanzar', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { saltar: 1 });
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    const idAntes = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().id);
    await esperarAntirrebote(page);
    await page.locator('[data-test="contrarreloj-comodines"] [data-test="comodin-saltar"]').click({ clickCount: 2 });
    await expect.poll(() => page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().id)).not.toBe(idAntes);
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', 'Pregunta 1 de 10');
    expect((await objetos(page)).saltar).toBe(0);
    await sinScrollEnAmbos(page);
  });

  test('Contrarreloj · Segunda oportunidad en un test4: tacha la fallada y el segundo intento acertado hace avanzar la serie', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { segunda: 1 });
    await entrarEnModo(page, 'contrarreloj');
    await expect(page.locator('[data-vista="contrarreloj"]')).toBeVisible();
    let tipo = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().tipo);
    for (let i = 0; i < 8 && tipo !== 'test4'; i += 1) {
      await page.evaluate(() => window.__one.acertarContrarreloj(1));
      tipo = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().tipo);
    }
    expect(tipo).toBe('test4');
    const puntos = await page.locator('[data-test="contrarreloj-puntos"]').getAttribute('aria-label');
    await page.locator('[data-test="contrarreloj-comodines"] [data-test="comodin-segunda"]').click();
    await page.evaluate(() => window.__one.fallarContrarreloj());
    await expect(page.locator('[data-vista="caida"]')).toBeHidden();
    await expect(page.locator('[data-test="contrarreloj-opciones"] .opcion-tachada')).toHaveCount(1);
    expect((await objetos(page)).segunda).toBe(0);
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).toHaveAttribute('aria-label', puntos);
    await page.evaluate(() => window.__one.acertarContrarreloj(1));
    await expect(page.locator('[data-test="contrarreloj-puntos"]')).not.toHaveAttribute('aria-label', puntos);
    await sinScrollEnAmbos(page);
  });

  test('con 5 comodines la barra se queda en una fila (icono y cantidad) y sin scroll en 375×667', async ({ page }) => {
    await page.goto('/?ejemplo=1&test=1');
    await sembrar(page, { cincuenta: 1, segunda: 1, saltar: 1, mas5: 1, salvavidas: 1 });
    await entrarEnModo(page, 'contrarreloj');
    let tipo = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().tipo);
    for (let i = 0; i < 8 && tipo !== 'test4'; i += 1) {
      await page.evaluate(() => window.__one.acertarContrarreloj(1));
      tipo = await page.evaluate(() => window.__one.ultimaPreguntaContrarreloj().tipo);
    }
    const barra = page.locator('[data-test="contrarreloj-comodines"]');
    await expect(barra.locator('button')).toHaveCount(5);
    const ys = await barra.locator('button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(new Set(ys).size).toBe(1); // una sola fila
    await sinScrollEnAmbos(page);
  });

  for (const [escudos, racha, gastados] of [[2, 6, 2], [1, 1, 0]]) {
    test(`Escudo de racha: 3 días sin jugar con ${escudos} escudo(s) → racha ${racha}, ${gastados} gastado(s)`, async ({ page }) => {
      await page.goto('/?ejemplo=1&test=1');
      await sembrar(page, { escudo: escudos });
      await page.evaluate(() => import('./motor.js').then((m) => { // racha de 5 días cuya última partida fue hace 3 días (2 días perdidos)
        const f = (atras) => {
          const d = new Date();
          d.setDate(d.getDate() - atras);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const e = m.crearEstado(f(3));
        e.racha = { dias: 5, ultimaFecha: f(3) };
        localStorage.setItem('one.estado', m.exportar(e));
      }));
      await page.reload();
      await page.waitForFunction(() => window.__one?.listo === true);
      await expect(page.locator('[data-test="racha"]')).toHaveText('🔥 5');
      await empezar(page, ['cie-001']);
      await responderPreguntaActual(page);
      await avanzarTrasRespuesta(page);
      await expect(page.locator('[data-test="racha"]')).toHaveText(`🔥 ${racha}`);
      expect((await objetos(page)).escudo).toBe(escudos - gastados);
      if (gastados > 0) await expect(page.locator('[data-test="escudo-gastado"]')).toContainText(`−${gastados}`);
      else await expect(page.locator('[data-test="escudo-gastado"]')).toHaveCount(0);
    });
  }

  test('una mochila v1 guardada se lee al arrancar sin perder nada y se reescribe como v2 al comprar', async ({ page }) => {
    await conFondo(page, 2000);
    await page.addInitScript(() => {
      if (!localStorage.getItem('v1-sembrada')) {
        localStorage.setItem('v1-sembrada', '1');
        localStorage.setItem('one.mochila', JSON.stringify({ version: 1, objetos: { cincuenta: 2, salvavidas: 1, mas5: 3 } }));
      }
    });
    await page.goto('/?ejemplo=1&test=1');
    await expect(page.locator('[data-test="marcador-tienda"]')).toHaveText('🎒 6');
    await abrirTienda(page);
    await expect(page.locator('[data-test="tienda-cantidad-cincuenta"]')).toHaveText('Tienes 2');
    await page.locator('[data-test="tienda-comprar-saltar"]').click();
    const m = await mochila(page);
    expect(m.version).toBe(2);
    expect(m.objetos).toEqual({ cincuenta: 2, salvavidas: 1, mas5: 3, saltar: 1, segunda: 0, escudo: 0 });
  });
});

test.describe('ONE · v0.3.4 B tanda de 10 o 100', () => {
  const URL_SERVIDOR = 'https://servidor.prueba';
  const TOKEN = 'token-de-prueba-e2e-1234567890';
  const URL_APP = `/?ejemplo=1&test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`;
  const CORS = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const PREMIUM_ACTIVO = { activo: true, desde: '2026-10-12', ultimaRecarga: '2026-10', bonificado: true };

  const preguntaServidor = (i) => ({
    id: `srv-t100-${i}`,
    area: 'economia',
    tipo: 'vf',
    nivel: 1,
    enunciado: `Enunciado de la tanda grande (${i}).`,
    explicacion: 'Explicación corta de prueba, del servidor falso.',
    respuesta: true,
  });
  const preguntas = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, k) => preguntaServidor(desde + k));

  /** Servidor simulado: /generar apunta el cuerpo; /trabajo/:id responde `respuestas[i]` (la última se repite). */
  async function servidorFalso(page, { respuestas, generar = [], trabajos = [] }) {
    await page.route(`${URL_SERVIDOR}/**`, async (ruta) => {
      const peticion = ruta.request();
      if (peticion.method() === 'OPTIONS') {
        await ruta.fulfill({ status: 204, headers: CORS });
        return;
      }
      const cabeceras = { ...CORS, 'Content-Type': 'application/json' };
      const camino = new URL(peticion.url()).pathname;
      if (camino === '/estado') {
        await ruta.fulfill({ status: 200, headers: cabeceras, body: '{"preguntas":[],"enCola":0}' });
      } else if (camino === '/subtemas') {
        const subtemas = [{ indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' }];
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ subtemas }) });
      } else if (camino === '/generar') {
        const cuerpo = peticion.postDataJSON();
        generar.push(cuerpo);
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ trabajoId: 't-100', enCola: 1, estimadoSeg: cuerpo.n * 20 }) });
      } else if (camino.startsWith('/trabajo/')) {
        const respuesta = respuestas[Math.min(trabajos.length, respuestas.length - 1)];
        trabajos.push(Date.now());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ motivo: null, segundosPorPregunta: 20, ...respuesta }) });
      } else {
        await ruta.fulfill({ status: 404, headers: cabeceras, body: '{}' });
      }
    });
  }

  const conPremium = (page) => page.addInitScript((premium) => {
    if (!localStorage.getItem('premium-sembrado')) {
      localStorage.setItem('premium-sembrado', '1');
      localStorage.setItem('one.premium', JSON.stringify(premium));
    }
  }, PREMIUM_ACTIVO);

  const opcion = (selector, n) => selector.locator(`[data-test="tanda-${n}"]`);

  test('selector «10 · 100» en la hoja del filtro: 10 por defecto, el 100 lleva insignia dorada y sin Premium abre la pantalla Premium sin pedir nada', async ({ page }) => {
    const generar = [];
    await servidorFalso(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }], generar });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(URL_APP);
    await page.waitForFunction(() => window.__one?.listo === true);
    await abrirAtomoDesdeHub(page, 'economia');
    const selector = page.locator('[data-test="selector-tanda-atomo"]');
    await expect(selector).toBeVisible();
    await expect(opcion(selector, 10)).toHaveAttribute('aria-checked', 'true');
    await expect(opcion(selector, 100)).toHaveAttribute('aria-checked', 'false');
    await expect(opcion(selector, 100).locator('[data-test="insignia-tanda-100"]')).toHaveText('PREMIUM');
    const color = await opcion(selector, 100).locator('[data-test="insignia-tanda-100"]').evaluate((n) => getComputedStyle(n).color);
    expect(color).toBe('rgb(242, 193, 78)'); // --dorado
    for (const n of [10, 100]) expect((await opcion(selector, n).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await assertHojaSinScroll(page);

    await opcion(selector, 100).click();
    await expect(page.locator('[data-vista="premium"]')).toBeVisible();
    await expect(page.locator('[data-test="premium-motivo"]')).toContainText('100 preguntas');
    expect(generar).toHaveLength(0);

    // Sin plan, el 100 no queda elegido: al volver sigue el 10 y Generar pide 10.
    await page.locator('[data-test="volver"]').click();
    await abrirAtomoDesdeHub(page, 'economia');
    await expect(opcion(page.locator('[data-test="selector-tanda-atomo"]'), 10)).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-test="atomo-generar"]').click();
    await expect.poll(() => generar.length).toBe(1);
    expect(generar[0].n).toBe(10);
  });

  test('con Premium activo el 100 se elige, se ve elegido en las dos pantallas y Generar pide n = 100', async ({ page }) => {
    const generar = [];
    await servidorFalso(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 100, preguntas: [] }], generar });
    await conPremium(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('sembrado')) {
        sessionStorage.setItem('sembrado', '1');
        localStorage.setItem('one.filtros', JSON.stringify({ contrarreloj: { area: 'geografia', ruta: [], etiquetas: [] } }));
      }
    });
    await page.goto(URL_APP);
    await page.waitForFunction(() => window.__one?.listo === true);

    // Aviso de «menos de 5» (Contrarreloj con un filtro sin jugables).
    await entrarEnModo(page, 'contrarreloj');
    const corto = page.locator('[data-test="selector-tanda-corto"]');
    await expect(corto).toBeVisible();
    await expect(opcion(corto, 100).locator('[data-test="insignia-tanda-100"]')).toBeVisible();
    await opcion(corto, 100).click();
    await expect(opcion(corto, 100)).toHaveAttribute('aria-checked', 'true');
    await expect(opcion(corto, 10)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-vista="premium"]')).toBeHidden();

    // La elección se ve también en la hoja del filtro (misma elección en los dos sitios).
    await page.evaluate(() => window.__one.abrirAtomo('economia'));
    await expect(opcion(page.locator('[data-test="selector-tanda-atomo"]'), 100)).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-test="atomo-generar"]').click();
    await expect.poll(() => generar.length).toBe(1);
    expect(generar[0]).toMatchObject({ area: 'economia', n: 100, urgente: true });
    await expect(page.locator('[data-test="atomo-espera-texto"]')).toContainText('Generando 100 preguntas de Economía');
    await expect(page.locator('[data-test="atomo-espera-progreso-texto"]')).toHaveText('0 de 100');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.atomoTrabajo')).pedidas)).toBe(100);
  });

  test('«23 de 100» en la espera y en el indicador; las 20 listas se juegan antes de que acabe y el aviso llega con las 100 (captura 375×667)', async ({ page }) => {
    test.setTimeout(60000);
    const trabajos = [];
    await servidorFalso(page, {
      trabajos,
      respuestas: [
        { estado: 'generando', hechas: 0, pedidas: 100, preguntas: [] },
        { estado: 'parcial', hechas: 23, pedidas: 100, preguntas: preguntas(1, 20) },
        { estado: 'parcial', hechas: 23, pedidas: 100, preguntas: preguntas(1, 20) },
        { estado: 'lista', hechas: 100, pedidas: 100, preguntas: preguntas(1, 100) },
      ],
    });
    await conPremium(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(URL_APP);
    await page.waitForFunction(() => window.__one?.listo === true);
    await abrirAtomoDesdeHub(page, 'economia');
    const selector = page.locator('[data-test="selector-tanda-atomo"]');
    await opcion(selector, 100).click();
    await assertHojaSinScroll(page);
    const capturaSelector = await page.screenshot();
    await page.locator('[data-test="atomo-generar"]').click();

    const progreso = page.locator('[data-test="atomo-espera-progreso-texto"]');
    await expect(progreso).toHaveText('0 de 100');
    await expect(page.locator('[data-test="atomo-jugar-listas"]')).toBeHidden();
    await expect(progreso).toHaveText('23 de 100', { timeout: 9000 });
    await expect(page.locator('[data-test="indicador-tanda-texto"]')).toHaveText(/^23 de 100/);
    const jugarListas = page.locator('[data-test="atomo-jugar-listas"]');
    await expect(jugarListas).toHaveText('Jugar las 20 listas');
    await assertSinScroll(page);
    await assertSinSolapeCabecera(page);
    const capturaProgreso = await page.screenshot();

    // Una sola imagen con el selector (izquierda) y el progreso (derecha).
    const lienzo = await page.context().newPage();
    await lienzo.setViewportSize({ width: 750, height: 667 });
    await lienzo.setContent(`<body style="margin:0;display:flex;background:#0b0f14"><img width="375" height="667" src="data:image/png;base64,${capturaSelector.toString('base64')}"><img width="375" height="667" src="data:image/png;base64,${capturaProgreso.toString('base64')}"></body>`);
    await lienzo.screenshot({ path: `${CAPTURAS}/v0.3.4-tanda-100-375x667.png` });
    await lienzo.close();

    // Se juegan ya las 20 que hay, sin esperar a las otras 80.
    await jugarListas.click();
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    await esperarAsentamientoMazo(page);
    await expect(tarjetaActual(page).locator('[data-test="mazo-contador"]')).toHaveText('0/20');
    expect(await page.evaluate(() => localStorage.getItem('one.atomoTrabajo') !== null)).toBe(true); // la tanda sigue en marcha

    // La tanda termina mientras se juega: al volver al hub, el aviso trae las 100.
    await page.locator('[data-test="volver"]').click();
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await expect(avisoGeneradas(page)).toContainText('· 100', { timeout: 20000 });
    expect(await page.evaluate(() => localStorage.getItem('one.atomoTrabajo'))).toBe(null);
    await assertSinScroll(page);
  });

  test('sondeo de la tanda de 100: 5 s, 5 s, 10 s, 10 s... hasta 30 s sin preguntas nuevas; con preguntas nuevas vuelve a 5 s', async ({ page }) => {
    const trabajos = [];
    // Los sondeos 1 a 9 no traen nada; el 10 trae 5 preguntas; después, otra vez nada.
    const vacio = { estado: 'generando', hechas: 0, pedidas: 100, preguntas: [] };
    const cinco = { estado: 'parcial', hechas: 5, pedidas: 100, preguntas: preguntas(1, 5) };
    await servidorFalso(page, { trabajos, respuestas: [...Array(9).fill(vacio), cinco] });
    await conPremium(page);
    await page.clock.install();
    await page.goto(URL_APP);
    await page.waitForFunction(() => window.__one?.listo === true);
    await abrirAtomoDesdeHub(page, 'economia');
    await opcion(page.locator('[data-test="selector-tanda-atomo"]'), 100).click();
    await page.locator('[data-test="atomo-generar"]').click();
    await expect(page.locator('[data-vista="atomo-espera"]')).toBeVisible();

    /** Avanza el reloj de la página y espera a que la petición que dispare (si hay) llegue y se procese. */
    const pasar = async (ms, esperados) => {
      await page.clock.runFor(ms);
      await expect.poll(() => trabajos.length).toBe(esperados);
      await page.waitForTimeout(150); // la respuesta se procesa y se programa el siguiente sondeo
    };
    await expect.poll(() => trabajos.length).toBe(1); // el sondeo inmediato
    await page.waitForTimeout(150);
    // Esperas previstas: 5, 5, 10, 10, 15, 15, 20, 20, 25 (sondeos 2 a 10); el 10 trae preguntas nuevas.
    const esperas = [5000, 5000, 10000, 10000, 15000, 15000, 20000, 20000, 25000];
    let total = 1;
    for (const espera of esperas) {
      await pasar(espera - 1000, total); // todavía no toca
      total += 1;
      await pasar(1000, total);
    }
    // El sondeo 10 trajo 5 preguntas nuevas: el siguiente vuelve a los 5 s (y no a los 25-30 s).
    await pasar(4000, total);
    total += 1;
    await pasar(1000, total);
    await expect(page.locator('[data-test="atomo-jugar-listas"]')).toHaveText('Jugar las 5 listas');
    // Y sin más novedades se vuelve a espaciar: tras los 5 s siguen 5, luego 10.
    await pasar(4000, total);
    total += 1;
    await pasar(1000, total);
    await pasar(9000, total);
    total += 1;
    await pasar(1000, total);
  });
});

test.describe('ONE · v0.3.4 C avisos del iPhone (Web Push)', () => {
  const URL_SERVIDOR = 'https://servidor.prueba';
  const TOKEN = 'token-de-prueba-e2e-1234567890';
  const URL_APP = `/?ejemplo=1&test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`;
  const CORS = {
    'Access-Control-Allow-Origin': 'http://localhost:8765',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const TEMA_ECONOMIA = encodeURIComponent(JSON.stringify(['economia', [], []]));

  const preguntaAviso = (i) => ({
    id: `srv-aviso-${i}`, area: 'economia', tipo: 'vf', nivel: 1,
    enunciado: `Pregunta de la tanda avisada (${i}).`, explicacion: 'Explicación corta de prueba.', respuesta: true,
  });
  const listaDe = (n) => Array.from({ length: n }, (_, i) => preguntaAviso(i + 1));

  /** Servidor simulado con /vapid y /suscribir: `suscripciones` y `generar` recogen los cuerpos recibidos. */
  async function servidorAvisos(page, { respuestas, suscripciones = [], generar = [], vapid = [], conClave = true } = {}) {
    let sondeos = 0;
    await page.route(`${URL_SERVIDOR}/**`, async (ruta) => {
      const peticion = ruta.request();
      if (peticion.method() === 'OPTIONS') {
        await ruta.fulfill({ status: 204, headers: CORS });
        return;
      }
      const cabeceras = { ...CORS, 'Content-Type': 'application/json' };
      const camino = new URL(peticion.url()).pathname;
      if (camino === '/estado') {
        await ruta.fulfill({ status: 200, headers: cabeceras, body: '{"preguntas":[],"enCola":0}' });
      } else if (camino === '/subtemas') {
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ subtemas: [{ indice: 0, corto: 'Mercados y crisis', completo: 'Mercados y crisis financieras' }] }) });
      } else if (camino === '/generar') {
        generar.push(peticion.postDataJSON());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ trabajoId: 't-aviso', enCola: 1, estimadoSeg: 40 }) });
      } else if (camino === '/vapid') {
        vapid.push(Date.now());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify(conClave ? { activa: true, publica: 'BAUGBwgJ' } : { activa: false }) });
      } else if (camino === '/suscribir') {
        suscripciones.push(peticion.postDataJSON());
        await ruta.fulfill({ status: 200, headers: cabeceras, body: '{"ok":true,"trabajo":true}' });
      } else if (camino.startsWith('/trabajo/')) {
        const respuesta = respuestas[Math.min(sondeos, respuestas.length - 1)];
        sondeos += 1;
        await ruta.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify({ motivo: null, segundosPorPregunta: 4, ...respuesta }) });
      } else {
        await ruta.fulfill({ status: 404, headers: cabeceras, body: '{}' });
      }
    });
  }

  /** Simula el entorno de la app instalada en el iPhone: `navigator.standalone`, `Notification` y `PushManager`
   * (Chromium sin FCM no puede suscribirse de verdad). Cuenta cuántas veces se pide permiso y se suscribe. */
  const simularAvisos = (page, { instalada = true, permiso = 'default', respuesta = 'granted', rechazado = false } = {}) =>
    page.addInitScript((config) => {
      window.__avisos = { permisos: 0, suscripciones: 0, claveBytes: 0 };
      if (config.instalada) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      let actual = config.permiso;
      Object.defineProperty(Notification, 'permission', { get: () => actual, configurable: true });
      Notification.requestPermission = () => {
        window.__avisos.permisos += 1;
        actual = config.respuesta;
        return Promise.resolve(config.respuesta);
      };
      PushManager.prototype.getSubscription = async () => null;
      PushManager.prototype.subscribe = async function subscribe(opciones) {
        window.__avisos.suscripciones += 1;
        window.__avisos.claveBytes = opciones.applicationServerKey.length;
        return { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', keys: { p256dh: 'p256', auth: 'auth' } }) };
      };
      if (config.rechazado) localStorage.setItem('one.avisosPermiso', 'rechazado');
    }, { instalada, permiso, respuesta, rechazado });

  const contadores = (page) => page.evaluate(() => window.__avisos);
  const generarEconomia = async (page) => {
    await page.waitForFunction(() => window.__one?.listo === true);
    await abrirAtomoDesdeHub(page, 'economia');
    await page.locator('[data-test="atomo-generar"]').click();
  };

  test('app instalada, primera tanda: pide el permiso en el toque, se suscribe y manda la suscripción con el id de la tanda, el tema y su URL; la línea de instalar no sale', async ({ page }) => {
    const suscripciones = [];
    const vapid = [];
    await servidorAvisos(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }], suscripciones, vapid });
    await simularAvisos(page, { instalada: true, permiso: 'default', respuesta: 'granted' });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(URL_APP);
    await generarEconomia(page);
    await expect(page.locator('[data-test="atomo-espera"]')).toBeVisible();
    await expect.poll(() => suscripciones.length).toBe(1);
    expect(await contadores(page)).toEqual({ permisos: 1, suscripciones: 1, claveBytes: 6 });
    expect(vapid.length).toBe(1);
    const cuerpo = suscripciones[0];
    expect(cuerpo.trabajoId).toBe('t-aviso');
    expect(cuerpo.suscripcion).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', keys: { p256dh: 'p256', auth: 'auth' } });
    expect(cuerpo.tema).toMatch(/^Econom/);
    expect(cuerpo.url).toBe(`./?tema=${TEMA_ECONOMIA}`);
    await expect(page.locator('[data-test="aviso-instalar"]')).toBeHidden();
    await assertSinScroll(page);
  });

  test('app instalada con el permiso ya concedido: no vuelve a preguntar pero apunta el dispositivo a la tanda nueva', async ({ page }) => {
    const suscripciones = [];
    await servidorAvisos(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }], suscripciones });
    await simularAvisos(page, { instalada: true, permiso: 'granted' });
    await page.goto(URL_APP);
    await generarEconomia(page);
    await expect.poll(() => suscripciones.length).toBe(1);
    expect((await contadores(page)).permisos).toBe(0);
  });

  test('si el jugador dice que no: no hay suscripción ni llamada al servidor, queda recordado y la tanda se puede jugar desde la espera de dentro', async ({ page }) => {
    const suscripciones = [];
    const vapid = [];
    await servidorAvisos(page, {
      respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }, { estado: 'lista', hechas: 10, pedidas: 10, preguntas: listaDe(10) }],
      suscripciones, vapid,
    });
    await simularAvisos(page, { instalada: true, permiso: 'default', respuesta: 'denied' });
    await page.goto(URL_APP);
    await generarEconomia(page);
    await expect(page.locator('[data-test="atomo-espera-resultado"]')).toHaveText('Jugar la tanda', { timeout: 9000 });
    expect(await contadores(page)).toEqual({ permisos: 1, suscripciones: 0, claveBytes: 0 });
    expect(suscripciones).toEqual([]);
    expect(vapid).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('one.avisosPermiso'))).toBe('rechazado');
  });

  test('con un «no» anterior recordado no se vuelve a pedir el permiso aunque el sistema siga en «default»', async ({ page }) => {
    await servidorAvisos(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }] });
    await simularAvisos(page, { instalada: true, permiso: 'default', rechazado: true });
    await page.goto(URL_APP);
    await generarEconomia(page);
    await expect(page.locator('[data-test="atomo-espera"]')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await contadores(page)).toEqual({ permisos: 0, suscripciones: 0, claveBytes: 0 });
  });

  test('Safari normal (sin instalar): no se pide permiso ni se llama a /vapid; la espera enseña «Para recibir avisos, añade Esfinx a la pantalla de inicio» (captura 375×667)', async ({ page }) => {
    const suscripciones = [];
    const vapid = [];
    await servidorAvisos(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }], suscripciones, vapid });
    await simularAvisos(page, { instalada: false, permiso: 'default' });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(URL_APP);
    await generarEconomia(page);
    const linea = page.locator('[data-test="aviso-instalar"]');
    await expect(linea).toBeVisible();
    await expect(linea).toHaveText('Para recibir avisos, añade Esfinx a la pantalla de inicio');
    await assertSinScroll(page);
    await page.screenshot({ path: `${CAPTURAS}/v0.3.4-aviso-instalar-375x667.png` });
    await page.waitForTimeout(300);
    expect(await contadores(page)).toEqual({ permisos: 0, suscripciones: 0, claveBytes: 0 });
    expect(suscripciones).toEqual([]);
    expect(vapid).toEqual([]);
  });

  test('servidor sin avisos activados (/vapid dice activa:false): la tanda va igual, sin suscripción', async ({ page }) => {
    const suscripciones = [];
    const vapid = [];
    await servidorAvisos(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }], suscripciones, vapid, conClave: false });
    await simularAvisos(page, { instalada: true, permiso: 'granted' });
    await page.goto(URL_APP);
    await generarEconomia(page);
    await expect(page.locator('[data-test="atomo-espera"]')).toBeVisible();
    await expect.poll(() => vapid.length).toBe(1);
    await page.waitForTimeout(300);
    expect(suscripciones).toEqual([]);
    expect((await contadores(page)).suscripciones).toBe(0);
  });

  test('abrir la app desde la notificación (`?tema=`): entra directo a jugar Clásico con el filtro del tema y limpia la URL', async ({ page }) => {
    await servidorAvisos(page, { respuestas: [{ estado: 'generando', hechas: 0, pedidas: 10, preguntas: [] }] });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${URL_APP}&tema=${TEMA_ECONOMIA}`);
    await page.waitForFunction(() => window.__one?.listo === true);
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.filtros')).clasico)).toEqual({ area: 'economia', ruta: [], etiquetas: [] });
    expect(new URL(page.url()).searchParams.has('tema')).toBe(false);
    expect(new URL(page.url()).searchParams.get('test')).toBe('1');
  });

  test('un `?tema=` roto o de un área que no existe se ignora: la app abre en el hub', async ({ page }) => {
    for (const tema of ['%7Bmal', encodeURIComponent(JSON.stringify(['inventada', [], []]))]) {
      await page.goto(`${URL_APP}&tema=${tema}`);
      await page.waitForFunction(() => window.__one?.listo === true);
      await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    }
  });

  test('con la app abierta, tocar la notificación (el service worker manda `abrir-tema`) abre Clásico con ese tema', async ({ page }) => {
    await page.goto(URL_APP);
    await page.waitForFunction(() => window.__one?.listo === true);
    await expect(page.locator('[data-vista="progreso"]')).toBeVisible();
    await page.evaluate((tema) => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { tipo: 'abrir-tema', url: `${location.origin}/?tema=${tema}` } }));
    }, TEMA_ECONOMIA);
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.filtros')).clasico.area)).toBe('economia');
  });

  test('abierta desde la notificación con la tanda aún sondeándose: espera a que llegue y entra a jugar sin enseñar el aviso grande', async ({ page }) => {
    await servidorAvisos(page, {
      respuestas: [{ estado: 'lista', hechas: 10, pedidas: 10, preguntas: listaDe(10) }],
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem('tanda-sembrada')) {
        localStorage.setItem('tanda-sembrada', '1');
        localStorage.setItem('one.atomoTrabajo', JSON.stringify({ id: 't-aviso', corto: 'Economía', inicio: Date.now() - 60000, pedidas: 10, area: 'economia', ruta: [], etiquetas: [] }));
      }
    });
    await page.goto(`${URL_APP}&tema=${TEMA_ECONOMIA}`);
    await expect(page.locator('[data-vista="pregunta"]')).toBeVisible({ timeout: 9000 });
    await expect(avisoGeneradas(page)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('one.atomoTrabajo'))).toBe(null);
    expect(await page.evaluate(() => localStorage.getItem('one.avisoGeneradas'))).toBe(null);
  });
});
