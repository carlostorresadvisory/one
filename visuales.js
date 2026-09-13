// ONE · visuales.js — construirVisual(visual): dibuja el campo `visual` de una
// pregunta (spec v0.1e §2) como SVG inline, para pintarse en la misma caja que
// hoy ocupa la imagen de Wikimedia Commons (ver construirBloqueImagen /
// construirBloqueVisual en app.js: la imagen manda si existe, este visual es
// el respaldo, y si tampoco hay visual reconocible no se pinta nada — spec
// v0.1e §2 "un solo visual por pregunta").
//
// `visual` es SIEMPRE datos, nunca dibujo (spec v0.1e §2): esta es la única
// pieza que sabe convertir esos datos en trazos. Sin dependencias, sin canvas:
// solo nodos SVG creados a mano con createElementNS. Cada plantilla usa un
// viewBox fijo (320×180, o 320×120 para formula/dato) y `preserveAspectRatio`
// para que el SVG escale con la caja flexible del encaje (spec v0.1d §4) sin
// deformarse; los tamaños de fuente van en unidades del propio viewBox, así
// que también escalan.
//
// Ningún texto puede desbordar su línea (decisión del brief de esta tarea):
// como el nodo aún no está en el DOM cuando se construye, no se puede medir
// con getComputedTextLength(), así que el ancho de cada texto se ESTIMA con
// un factor medio de caracter por tamaño de fuente (FACTOR_ANCHO_MEDIO) y, si
// no cabe, se recorta con "…" (recortarALinea) o se reparte en como mucho dos
// líneas (envolverLineas) antes de recortar la última. El factor es
// deliberadamente conservador (mejor recortar de más que desbordar la caja).

const NS = 'http://www.w3.org/2000/svg';

// Estimación conservadora del ancho medio de un carácter, como fracción del
// font-size, para la tipografía del sistema (-apple-system/system-ui). No es
// una medida real (eso exigiría el nodo ya insertado en el documento): es a
// propósito generosa, para errar del lado de recortar antes que desbordar.
const FACTOR_ANCHO_MEDIO = 0.56;

function medirAncho(texto, tamano) {
  return texto.length * tamano * FACTOR_ANCHO_MEDIO;
}

/** Recorta `texto` a una sola línea que quepa en `maxAncho` al tamaño dado,
 * añadiendo "…" si hace falta cortar. Nunca devuelve más ancho del permitido. */
function recortarALinea(texto, maxAncho, tamano) {
  if (!texto) return '';
  if (medirAncho(texto, tamano) <= maxAncho) return texto;
  let t = texto;
  while (t.length > 1 && medirAncho(`${t}…`, tamano) > maxAncho) {
    t = t.slice(0, -1);
  }
  return `${t.trimEnd()}…`;
}

/** Reparte `texto` en como mucho `maxLineas` líneas que quepan en `maxAncho`;
 * si sobran palabras tras la última línea disponible, esa línea se recorta
 * con "…" (nunca se pierde una línea completa en silencio). */
function envolverLineas(texto, maxAncho, tamano, maxLineas = 2) {
  const normalizado = (texto || '').replace(/\s+/g, ' ').trim();
  if (!normalizado) return [''];
  const palabras = normalizado.split(' ');
  const lineas = [];
  let actual = '';
  let indice = 0;
  let cortado = false;
  while (indice < palabras.length) {
    const palabra = palabras[indice];
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (!actual || medirAncho(candidata, tamano) <= maxAncho) {
      actual = candidata;
      indice += 1;
      continue;
    }
    lineas.push(actual);
    actual = '';
    if (lineas.length === maxLineas) {
      cortado = true;
      break;
    }
  }
  if (!cortado) {
    if (actual) lineas.push(actual);
    if (indice < palabras.length) cortado = true; // red de seguridad, no debería darse
  }
  if (cortado) {
    if (lineas.length) {
      lineas[lineas.length - 1] = recortarALinea(`${lineas[lineas.length - 1]}…`, maxAncho, tamano);
    } else {
      lineas.push(recortarALinea(normalizado, maxAncho, tamano));
    }
  }
  return lineas.length ? lineas.slice(0, maxLineas) : [''];
}

/** Tamaño de fuente que hace caber `texto` en `maxAncho` (con el estimador de
 * arriba), entre `min` y `max`. Si ni al mínimo cabe, quien llama debe además
 * recortar el texto (ver plantillaFormula/plantillaDato). */
function tamanoParaCaber(texto, maxAncho, { min = 12, max = 24 } = {}) {
  if (!texto) return max;
  if (medirAncho(texto, max) <= maxAncho) return max;
  const ajustado = maxAncho / (texto.length * FACTOR_ANCHO_MEDIO);
  return Math.max(min, Math.min(max, ajustado));
}

function esTextoValido(t) {
  return typeof t === 'string' && t.trim().length > 0;
}

function crearSvg(viewBox) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.classList.add('visual-svg');
  svg.dataset.test = 'visual';
  return svg;
}

function crearTexto(x, y, texto, { tamano = 13, color = 'var(--texto)', ancla = 'start', peso } = {}) {
  const el = document.createElementNS(NS, 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('font-size', String(tamano));
  el.setAttribute('fill', color);
  el.setAttribute('text-anchor', ancla);
  el.setAttribute('dominant-baseline', 'middle');
  if (peso) el.setAttribute('font-weight', String(peso));
  el.textContent = texto;
  return el;
}

function crearRect(x, y, w, h, color, opacidad = 1) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0, w)));
  r.setAttribute('height', String(Math.max(0, h)));
  r.setAttribute('rx', '2');
  r.setAttribute('fill', color);
  if (opacidad !== 1) r.setAttribute('opacity', String(opacidad));
  return r;
}

function crearLinea(x1, y1, x2, y2, color, grosor = 1, opacidad = 1) {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1', String(x1));
  l.setAttribute('y1', String(y1));
  l.setAttribute('x2', String(x2));
  l.setAttribute('y2', String(y2));
  l.setAttribute('stroke', color);
  l.setAttribute('stroke-width', String(grosor));
  if (opacidad !== 1) l.setAttribute('opacity', String(opacidad));
  l.setAttribute('stroke-linecap', 'round');
  return l;
}

function crearFlechaAbajo(cx, y, r) {
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', `${cx - r},${y} ${cx + r},${y} ${cx},${y + r * 1.3}`);
  poly.setAttribute('fill', 'var(--acento)');
  return poly;
}

// --- plantillas: una función por tipo, `visual -> SVGElement | null` ---
// Cada una valida su propia forma mínima (nunca la spec completa: eso es
// tools/validar-banco.js) y devuelve null si los datos no tienen ni la pinta
// de lo que dicen ser, para que construirVisual no pinte nada.

const ANCHO = 320;
// Un único alto de viewBox para las seis plantillas (hallazgo al revisar las
// capturas de esta tarea: formula/dato con un viewBox más bajo que las otras
// cuatro quedaban muy letterboxed -franjas de --fondo vacías arriba/abajo-
// dentro de la caja flexible real, que en el móvil suele ser bastante más
// alta que ancha; justo el "espacio muerto" que Carlos pidió eliminar). Con
// las seis a la misma proporción, preserveAspectRatio las escala todas igual
// y ninguna desperdicia más hueco que las demás.
const ALTO_GRANDE = 180;

function plantillaFormula(visual) {
  if (!esTextoValido(visual.texto)) return null;
  const svg = crearSvg(`0 0 ${ANCHO} ${ALTO_GRANDE}`);
  const maxAncho = ANCHO - 32;
  const original = visual.texto.trim();
  const tamano = tamanoParaCaber(original, maxAncho, { min: 14, max: 30 });
  const texto = recortarALinea(original, maxAncho, tamano);

  const y = ALTO_GRANDE * 0.48;
  const anchoTexto = Math.min(maxAncho, medirAncho(texto, tamano));
  const mitad = anchoTexto / 2 + 6;
  svg.appendChild(crearLinea(ANCHO / 2 - mitad, y + tamano * 0.85, ANCHO / 2 + mitad, y + tamano * 0.85, 'var(--acento)', 2));
  svg.appendChild(crearTexto(ANCHO / 2, y, texto, { tamano, ancla: 'middle', color: 'var(--texto)', peso: 700 }));
  return svg;
}

function plantillaLineaTiempo(visual) {
  if (!Array.isArray(visual.hitos)) return null;
  const hitos = visual.hitos
    .filter((h) => h && esTextoValido(h.ano) && esTextoValido(h.texto))
    .slice(0, 5);
  if (!hitos.length) return null;

  const svg = crearSvg(`0 0 ${ANCHO} ${ALTO_GRANDE}`);
  const margen = 16;
  const n = hitos.length;
  const paso = (ALTO_GRANDE - margen * 2) / n;
  const xLinea = 26;

  svg.appendChild(crearLinea(xLinea, margen, xLinea, ALTO_GRANDE - margen, 'var(--texto-suave)', 2, 0.4));

  hitos.forEach((h, i) => {
    const y = margen + paso * i + paso / 2;
    const circulo = document.createElementNS(NS, 'circle');
    circulo.setAttribute('cx', String(xLinea));
    circulo.setAttribute('cy', String(y));
    circulo.setAttribute('r', '5');
    circulo.setAttribute('fill', 'var(--acento)');
    svg.appendChild(circulo);

    const xAno = xLinea + 14;
    const anoTexto = recortarALinea(h.ano.trim(), 60, 13);
    svg.appendChild(crearTexto(xAno, y, anoTexto, { tamano: 13, color: 'var(--acento)', peso: 700 }));

    const xTexto = xLinea + 88;
    const maxAnchoTexto = ANCHO - xTexto - 10;
    const textoTexto = recortarALinea(h.texto.trim(), maxAnchoTexto, 13);
    svg.appendChild(crearTexto(xTexto, y, textoTexto, { tamano: 13, color: 'var(--texto)' }));
  });

  return svg;
}

function formatearValor(v) {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 100) / 100);
}

function plantillaBarras(visual) {
  if (!Array.isArray(visual.items)) return null;
  const items = visual.items
    .filter((it) => it && esTextoValido(it.etiqueta) && typeof it.valor === 'number' && Number.isFinite(it.valor))
    .slice(0, 5);
  if (!items.length) return null;

  const svg = crearSvg(`0 0 ${ANCHO} ${ALTO_GRANDE}`);
  const tieneTitulo = esTextoValido(visual.titulo);
  const inicioY = tieneTitulo ? 30 : 14;

  if (tieneTitulo) {
    const tituloTexto = recortarALinea(visual.titulo.trim(), ANCHO - 20, 13);
    svg.appendChild(crearTexto(10, 14, tituloTexto, { tamano: 13, color: 'var(--texto-suave)', peso: 600 }));
  }

  const n = items.length;
  const paso = (ALTO_GRANDE - inicioY - 10) / n;
  const xEtiqueta = 6;
  const anchoEtiqueta = 92;
  const xBarra = xEtiqueta + anchoEtiqueta + 6;
  const anchoBarraMax = 112;
  const xValor = xBarra + anchoBarraMax + 6;
  // Ancho generoso para el valor (hallazgo al revisar la captura: con menos
  // margen aquí, "26.9 bill $" se recortaba a "26.9 bill…" — un valor
  // numérico real no debería perder su unidad por un cálculo de ancho justo).
  const anchoValor = Math.max(20, ANCHO - xValor - 6);
  const maxValor = Math.max(...items.map((it) => Math.abs(it.valor)), 1e-9);

  items.forEach((it, i) => {
    const y = inicioY + paso * i + paso / 2;
    const altoBarra = Math.max(8, Math.min(14, paso - 10));

    const etiquetaTexto = recortarALinea(it.etiqueta.trim(), anchoEtiqueta, 11);
    svg.appendChild(crearTexto(xEtiqueta, y, etiquetaTexto, { tamano: 11, color: 'var(--texto)' }));

    svg.appendChild(crearRect(xBarra, y - altoBarra / 2, anchoBarraMax, altoBarra, 'var(--texto-suave)', 0.2));
    const anchoBarra = Math.max(3, (Math.abs(it.valor) / maxValor) * anchoBarraMax);
    svg.appendChild(crearRect(xBarra, y - altoBarra / 2, anchoBarra, altoBarra, 'var(--acento)', 1));

    const unidad = esTextoValido(it.unidad) ? ` ${it.unidad.trim()}` : '';
    const valorTexto = recortarALinea(`${formatearValor(it.valor)}${unidad}`, anchoValor, 11);
    svg.appendChild(crearTexto(xValor, y, valorTexto, { tamano: 11, color: 'var(--texto)' }));
  });

  return svg;
}

function plantillaComparacion(visual) {
  if (!Array.isArray(visual.columnas) || visual.columnas.length !== 2) return null;
  const columnas = visual.columnas.map((c) => ({
    titulo: c && esTextoValido(c.titulo) ? c.titulo.trim() : '',
    puntos: c && Array.isArray(c.puntos) ? c.puntos.filter(esTextoValido).map((p) => p.trim()).slice(0, 3) : [],
  }));
  if (columnas.some((c) => !c.titulo || !c.puntos.length)) return null;

  const svg = crearSvg(`0 0 ${ANCHO} ${ALTO_GRANDE}`);
  const xDivisor = ANCHO / 2;
  svg.appendChild(crearLinea(xDivisor, 8, xDivisor, ALTO_GRANDE - 8, 'var(--texto-suave)', 1, 0.35));

  const centros = [ANCHO * 0.27, ANCHO * 0.73];
  const anchoColumna = ANCHO / 2 - 20;
  const tamanoPunto = 11.5;
  const lineHeight = 15;
  const gapPunto = 8;

  columnas.forEach((col, ci) => {
    const cx = centros[ci];
    const xIzquierda = cx - anchoColumna / 2;
    const tituloTexto = recortarALinea(col.titulo, anchoColumna, 13);
    svg.appendChild(crearTexto(cx, 16, tituloTexto, { tamano: 13, ancla: 'middle', color: 'var(--acento)', peso: 700 }));

    let y = 38;
    col.puntos.forEach((punto) => {
      const lineas = envolverLineas(`• ${punto}`, anchoColumna, tamanoPunto, 2);
      lineas.forEach((linea, li) => {
        svg.appendChild(
          crearTexto(xIzquierda, y + li * lineHeight, linea, { tamano: tamanoPunto, ancla: 'start', color: 'var(--texto)' })
        );
      });
      y += lineas.length * lineHeight + gapPunto;
    });
  });

  return svg;
}

function plantillaFlujo(visual) {
  if (!Array.isArray(visual.pasos)) return null;
  const pasos = visual.pasos.filter(esTextoValido).map((p) => p.trim()).slice(0, 4);
  if (!pasos.length) return null;

  const svg = crearSvg(`0 0 ${ANCHO} ${ALTO_GRANDE}`);
  const n = pasos.length;
  const margen = 8;
  const paso = (ALTO_GRANDE - margen * 2) / n;
  const anchoCaja = 220;
  const xCaja = (ANCHO - anchoCaja) / 2;
  const altoCaja = Math.min(40, paso - 10);

  pasos.forEach((texto, i) => {
    const yFila = margen + paso * i;
    const yCaja = yFila + (paso - altoCaja) / 2;

    const rect = crearRect(xCaja, yCaja, anchoCaja, altoCaja, 'var(--acento)', 0.15);
    rect.setAttribute('stroke', 'var(--acento)');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('rx', '8');
    svg.appendChild(rect);

    const textoRecortado = recortarALinea(texto, anchoCaja - 20, 13);
    svg.appendChild(
      crearTexto(ANCHO / 2, yCaja + altoCaja / 2, textoRecortado, { tamano: 13, ancla: 'middle', color: 'var(--texto)', peso: 600 })
    );

    if (i < n - 1) {
      const yFlecha = yCaja + altoCaja + (paso - altoCaja) / 2 - 4;
      svg.appendChild(crearFlechaAbajo(ANCHO / 2, yFlecha, 5));
    }
  });

  return svg;
}

function plantillaDato(visual) {
  if (!esTextoValido(visual.cifra) || !esTextoValido(visual.texto)) return null;

  const svg = crearSvg(`0 0 ${ANCHO} ${ALTO_GRANDE}`);
  const cifra = visual.cifra.trim();
  const texto = visual.texto.trim();
  const maxAncho = ANCHO - 40;

  const tamanoCifra = tamanoParaCaber(cifra, maxAncho, { min: 32, max: 56 });
  const cifraRecortada = recortarALinea(cifra, maxAncho, tamanoCifra);
  svg.appendChild(
    crearTexto(ANCHO / 2, ALTO_GRANDE * 0.4, cifraRecortada, {
      tamano: tamanoCifra,
      ancla: 'middle',
      color: 'var(--acento)',
      peso: 700,
    })
  );

  const lineas = envolverLineas(texto, maxAncho, 15, 2);
  const yBase = ALTO_GRANDE * 0.72;
  const lineHeight = 19;
  lineas.forEach((linea, i) => {
    svg.appendChild(crearTexto(ANCHO / 2, yBase + i * lineHeight, linea, { tamano: 15, ancla: 'middle', color: 'var(--texto)' }));
  });

  return svg;
}

const PLANTILLAS = {
  formula: plantillaFormula,
  'linea-tiempo': plantillaLineaTiempo,
  barras: plantillaBarras,
  comparacion: plantillaComparacion,
  flujo: plantillaFlujo,
  dato: plantillaDato,
};

/** Dibuja `visual` (spec v0.1e §2) como SVG, o devuelve `null` si no hay nada
 * pintable: sin objeto, tipo desconocido, o datos que no pasan la
 * comprobación mínima de forma de su plantilla. `role="img"` +
 * `aria-label` = leyenda (spec v0.1e §4); el propio dibujo NUNCA pinta la
 * leyenda (eso lo hace construirBloqueVisual en app.js, en un <p> aparte,
 * igual que el pie de la imagen de Commons). */
export function construirVisual(visual) {
  if (!visual || typeof visual !== 'object') return null;
  const plantilla = PLANTILLAS[visual.tipo];
  if (!plantilla) return null;

  let svg = null;
  try {
    svg = plantilla(visual);
  } catch (err) {
    return null;
  }
  if (!svg) return null;

  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', esTextoValido(visual.leyenda) ? visual.leyenda.trim() : '');
  return svg;
}
