// ONE · visuales.js — construirVisual(visual): dibuja el campo `visual` de una
// pregunta (spec v0.1e §2) como SVG inline, para pintarse en la misma caja que
// hoy ocupa la imagen de Wikimedia Commons (ver construirBloqueImagen /
// construirBloqueVisual en app.js: la imagen manda si existe, este visual es
// el respaldo, y si tampoco hay visual reconocible no se pinta nada — spec
// v0.1e §2 "un solo visual por pregunta").
//
// `visual` es SIEMPRE datos, nunca dibujo (spec v0.1e §2): esta es la única
// pieza que sabe convertir esos datos en trazos. Sin dependencias, sin canvas:
// solo nodos SVG creados a mano con createElementNS.
//
// Ronda 1 de revisión (hallazgos visuales del controlador sobre las capturas
// v0.1e-*-375.png, V1): el viewBox de cada plantilla ya NO es un 320×180 fijo
// para las seis — cada una calcula su propio alto según cuánto contenido
// tiene de verdad (filas de barras/hitos a 36 unidades cada una, líneas de
// texto reales de comparación/dato, líneas de la fórmula). El ancho (320) sí
// es fijo: es lo que determina la escala real en pantalla (ver ESCALA más
// abajo) y todas las plantillas comparten caja. Cada SVG lleva además
// `aspect-ratio` en línea igual a `ANCHO/alto` (mismo `crearSvg`), y en
// estilos.css `.visual-svg` usa `width:100%; height:auto; max-height:100%` en
// vez de forzar `height:100%`: así el dibujo ocupa exactamente lo que
// necesita, sin franjas de `--fondo` vacías arriba/abajo cuando la caja
// flexible da más alto del que hace falta (el CSS centra el bloque
// svg+leyenda en ese sobrante, ver `.zona-imagen--visual` en estilos.css).
//
// Ningún texto puede desbordar su línea: como el nodo aún no está en el DOM
// cuando se construye, no se puede medir con getComputedTextLength(), así que
// el ancho de cada texto se ESTIMA con un factor medio de caracter por
// tamaño de fuente (FACTOR_ANCHO_MEDIO) y, si no cabe, se recorta con "…"
// (recortarALinea) o se reparte en como mucho dos líneas (envolverLineas)
// antes de recortar la última. El factor es deliberadamente conservador
// (mejor recortar de más que desbordar la caja).
//
// Escala real en pantalla (V4, letra mínima 13px/título 15px): el ancho del
// viewBox (320) se estira al ancho real de la caja (~320-340px en un móvil
// típico, el mismo ancho que ocupa la imagen), así que 1 unidad de viewBox
// equivale aproximadamente a 1px real — un font-size de 13 en el viewBox se
// ve como ~13px en pantalla. Por eso los tamaños de fuente de aquí en
// adelante nunca bajan de 13 (texto normal) ni de 15 (títulos/cabeceras).

const NS = 'http://www.w3.org/2000/svg';

// Estimación conservadora del ancho medio de un carácter, como fracción del
// font-size, para la tipografía del sistema (-apple-system/system-ui). No es
// una medida real (eso exigiría el nodo ya insertado en el documento): es a
// propósito generosa, para errar del lado de recortar antes que desbordar.
const FACTOR_ANCHO_MEDIO = 0.58;

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
 * recortar o partir el texto (ver plantillaFormula/plantillaDato). */
function tamanoParaCaber(texto, maxAncho, { min = 13, max = 24 } = {}) {
  if (!texto) return max;
  if (medirAncho(texto, max) <= maxAncho) return max;
  const ajustado = maxAncho / (texto.length * FACTOR_ANCHO_MEDIO);
  return Math.max(min, Math.min(max, ajustado));
}

function esTextoValido(t) {
  return typeof t === 'string' && t.trim().length > 0;
}

/** `alto` es el YA CALCULADO por cada plantilla según su contenido (V1): no
 * hay un alto de viewBox compartido. `aspect-ratio` en línea (mismo valor que
 * el viewBox) es lo que permite a `.visual-svg` (estilos.css) usar
 * `height:auto` — el dibujo ocupa solo lo que necesita, nunca más. */
function crearSvg(alto) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ANCHO} ${alto}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.aspectRatio = `${ANCHO} / ${alto}`;
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
// Alto de una fila de contenido tabular (barras, línea de tiempo) — V1,
// petición explícita de Carlos: "36 unidades por fila + cabecera". Con esto
// el alto del viewBox se calcula a partir del número real de filas/hitos, en
// vez de repartir un alto fijo entre ellas (que es justo lo que dejaba
// hueco vacío cuando había menos filas que el máximo de 5).
const ALTO_FILA = 36;

/** Parte una fórmula por el primer "=" (V2): izquierda se queda con el "="
 * pegado ("Superávit ="), derecha es el resto. Sin "=" en el texto (no
 * debería darse con las plantillas del §2, pero por si acaso), se parte por
 * la palabra más cercana a la mitad. */
function partirFormula(texto) {
  const idx = texto.indexOf('=');
  if (idx === -1) {
    const palabras = texto.split(' ');
    const mitad = Math.ceil(palabras.length / 2) || 1;
    return [palabras.slice(0, mitad).join(' '), palabras.slice(mitad).join(' ')];
  }
  return [texto.slice(0, idx + 1).trim(), texto.slice(idx + 1).trim()];
}

/** V2 (crítico): una fórmula de hasta 40 caracteres tiene que verse ENTERA y
 * grande, nunca recortada con "…" salvo que ni partida en dos líneas quepa
 * (caso extremo, no debería darse dentro de los límites del §2). Se intenta
 * primero en una sola línea con el mayor tamaño posible (16-30); solo si ni
 * al tamaño mínimo cabe se parte por el "=" en dos líneas, cada una con su
 * propio tamaño (el mayor que quepan las dos, para que se lean parejas). */
function plantillaFormula(visual) {
  if (!esTextoValido(visual.texto)) return null;
  const original = visual.texto.trim();
  const ANCHO_LINEA = 300;
  const MIN = 16;
  const MAX = 30;

  let lineas;
  let tamano;
  if (medirAncho(original, MIN) <= ANCHO_LINEA) {
    tamano = tamanoParaCaber(original, ANCHO_LINEA, { min: MIN, max: MAX });
    lineas = [original];
  } else {
    const partes = partirFormula(original);
    const masLarga = partes[0].length >= partes[1].length ? partes[0] : partes[1];
    tamano = tamanoParaCaber(masLarga, ANCHO_LINEA, { min: MIN, max: MAX });
    // Último recurso: si ni partida cabe al tamaño mínimo (no debería pasar
    // con 40 caracteres como máximo del §2), cada mitad se recorta por su
    // cuenta en vez de desbordar.
    lineas = partes.map((p) => recortarALinea(p, ANCHO_LINEA, tamano));
  }

  const dosLineas = lineas.length === 2;
  const alto = dosLineas ? 150 : 100;
  const svg = crearSvg(alto);

  if (!dosLineas) {
    const y = alto * 0.46;
    const anchoTexto = Math.min(ANCHO_LINEA, medirAncho(lineas[0], tamano));
    const mitad = anchoTexto / 2 + 6;
    svg.appendChild(crearLinea(ANCHO / 2 - mitad, y + tamano * 0.85, ANCHO / 2 + mitad, y + tamano * 0.85, 'var(--acento)', 2));
    svg.appendChild(crearTexto(ANCHO / 2, y, lineas[0], { tamano, ancla: 'middle', color: 'var(--texto)', peso: 700 }));
  } else {
    const y1 = alto * 0.32;
    const y2 = alto * 0.68;
    svg.appendChild(crearTexto(ANCHO / 2, y1, lineas[0], { tamano, ancla: 'middle', color: 'var(--texto)', peso: 700 }));
    svg.appendChild(crearTexto(ANCHO / 2, y2, lineas[1], { tamano, ancla: 'middle', color: 'var(--texto)', peso: 700 }));
    const anchoMax = Math.min(ANCHO_LINEA, Math.max(medirAncho(lineas[0], tamano), medirAncho(lineas[1], tamano)));
    const mitad = anchoMax / 2 + 6;
    const yLinea = y2 + tamano * 0.85;
    svg.appendChild(crearLinea(ANCHO / 2 - mitad, yLinea, ANCHO / 2 + mitad, yLinea, 'var(--acento)', 2));
  }
  return svg;
}

function plantillaLineaTiempo(visual) {
  if (!Array.isArray(visual.hitos)) return null;
  const hitos = visual.hitos
    .filter((h) => h && esTextoValido(h.ano) && esTextoValido(h.texto))
    .slice(0, 5);
  if (!hitos.length) return null;

  const n = hitos.length;
  const margen = 16; // 8 arriba + 8 abajo
  const alto = margen + n * ALTO_FILA; // V1: alto = filas reales, sin sobrante
  const svg = crearSvg(alto);
  const xLinea = 26;

  svg.appendChild(crearLinea(xLinea, margen / 2, xLinea, alto - margen / 2, 'var(--texto-suave)', 2, 0.4));

  hitos.forEach((h, i) => {
    const y = margen / 2 + i * ALTO_FILA + ALTO_FILA / 2;
    const circulo = document.createElementNS(NS, 'circle');
    circulo.setAttribute('cx', String(xLinea));
    circulo.setAttribute('cy', String(y));
    circulo.setAttribute('r', '5');
    circulo.setAttribute('fill', 'var(--acento)');
    svg.appendChild(circulo);

    const xAno = xLinea + 14;
    const anoTexto = recortarALinea(h.ano.trim(), 70, 13);
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

  const n = items.length;
  const tieneTitulo = esTextoValido(visual.titulo);
  const cabecera = tieneTitulo ? 26 : 6; // V1: alto = cabecera real + filas reales
  const margenInferior = 6;
  const alto = cabecera + n * ALTO_FILA + margenInferior;
  const svg = crearSvg(alto);

  if (tieneTitulo) {
    const tituloTexto = recortarALinea(visual.titulo.trim(), ANCHO - 20, 15);
    svg.appendChild(crearTexto(10, 14, tituloTexto, { tamano: 15, color: 'var(--texto-suave)', peso: 600 }));
  }

  // V4 (letra mínima 13px reales): etiqueta y valor suben de 11 a 13, con más
  // ancho reservado para que quepan sin recortar de más — la barra en sí se
  // encoge un poco (el dato importante es el texto, no el pixel exacto de
  // la barra).
  const xEtiqueta = 4;
  const anchoEtiqueta = 124;
  const xBarra = xEtiqueta + anchoEtiqueta + 6;
  const anchoBarraMax = 72;
  const xValor = xBarra + anchoBarraMax + 6;
  const anchoValor = Math.max(20, ANCHO - xValor - 4);
  const maxValor = Math.max(...items.map((it) => Math.abs(it.valor)), 1e-9);

  items.forEach((it, i) => {
    const y = cabecera + i * ALTO_FILA + ALTO_FILA / 2;
    const altoBarra = 14;

    const etiquetaTexto = recortarALinea(it.etiqueta.trim(), anchoEtiqueta, 13);
    svg.appendChild(crearTexto(xEtiqueta, y, etiquetaTexto, { tamano: 13, color: 'var(--texto)' }));

    svg.appendChild(crearRect(xBarra, y - altoBarra / 2, anchoBarraMax, altoBarra, 'var(--texto-suave)', 0.2));
    const anchoBarra = Math.max(3, (Math.abs(it.valor) / maxValor) * anchoBarraMax);
    svg.appendChild(crearRect(xBarra, y - altoBarra / 2, anchoBarra, altoBarra, 'var(--acento)', 1));

    const unidad = esTextoValido(it.unidad) ? ` ${it.unidad.trim()}` : '';
    const valorTexto = recortarALinea(`${formatearValor(it.valor)}${unidad}`, anchoValor, 13);
    svg.appendChild(crearTexto(xValor, y, valorTexto, { tamano: 13, color: 'var(--texto)' }));
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

  const anchoColumna = ANCHO / 2 - 20;
  const TAMANO_TITULO = 15; // V4: títulos a 15px reales
  const TAMANO_PUNTO = 13; // V4: texto normal, mínimo 13px reales
  const LINE_HEIGHT = 17;
  const GAP_PUNTO = 8;
  const Y_TITULO = 18;
  const Y_INICIO_PUNTOS = 42;
  const MARGEN_INFERIOR = 10;

  // V1: el alto del viewBox se calcula a partir de las líneas REALES que
  // necesita la columna más alta (envolverLineas ya decide cuántas líneas
  // hace falta cada punto) — nunca un 180 fijo con hueco de sobra si el
  // contenido pide menos.
  const columnasLayout = columnas.map((col) => {
    const puntosLineas = col.puntos.map((p) => envolverLineas(`• ${p}`, anchoColumna, TAMANO_PUNTO, 2));
    const alturaPuntos = puntosLineas.reduce((acc, lineas) => acc + lineas.length * LINE_HEIGHT + GAP_PUNTO, 0);
    return { titulo: col.titulo, puntosLineas, alturaPuntos };
  });
  const alturaMaxPuntos = Math.max(...columnasLayout.map((c) => c.alturaPuntos));
  const alto = Y_INICIO_PUNTOS + alturaMaxPuntos + MARGEN_INFERIOR;

  const svg = crearSvg(alto);
  const xDivisor = ANCHO / 2;
  svg.appendChild(crearLinea(xDivisor, 8, xDivisor, alto - 8, 'var(--texto-suave)', 1, 0.35));

  const centros = [ANCHO * 0.27, ANCHO * 0.73];
  columnasLayout.forEach((col, ci) => {
    const cx = centros[ci];
    const xIzquierda = cx - anchoColumna / 2;
    const tituloTexto = recortarALinea(col.titulo, anchoColumna, TAMANO_TITULO);
    svg.appendChild(
      crearTexto(cx, Y_TITULO, tituloTexto, { tamano: TAMANO_TITULO, ancla: 'middle', color: 'var(--acento)', peso: 700 })
    );

    let y = Y_INICIO_PUNTOS;
    col.puntosLineas.forEach((lineas) => {
      lineas.forEach((linea, li) => {
        svg.appendChild(
          crearTexto(xIzquierda, y + li * LINE_HEIGHT, linea, { tamano: TAMANO_PUNTO, ancla: 'start', color: 'var(--texto)' })
        );
      });
      y += lineas.length * LINE_HEIGHT + GAP_PUNTO;
    });
  });

  return svg;
}

function plantillaFlujo(visual) {
  if (!Array.isArray(visual.pasos)) return null;
  const pasos = visual.pasos.filter(esTextoValido).map((p) => p.trim()).slice(0, 4);
  if (!pasos.length) return null;

  const n = pasos.length;
  const margen = 8;
  const filaFlujo = 50; // caja (36) + hueco para la flecha (14)
  const alto = margen * 2 + n * filaFlujo - 14; // sin flecha colgando tras la última caja
  const svg = crearSvg(alto);
  const anchoCaja = 220;
  const xCaja = (ANCHO - anchoCaja) / 2;
  const altoCaja = 36;

  pasos.forEach((texto, i) => {
    const yFila = margen + i * filaFlujo;
    const yCaja = yFila;

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
      const yFlecha = yCaja + altoCaja + (filaFlujo - altoCaja) / 2 - 4;
      svg.appendChild(crearFlechaAbajo(ANCHO / 2, yFlecha, 5));
    }
  });

  return svg;
}

function plantillaDato(visual) {
  if (!esTextoValido(visual.cifra) || !esTextoValido(visual.texto)) return null;

  const cifra = visual.cifra.trim();
  const texto = visual.texto.trim();
  const maxAncho = ANCHO - 40;

  const tamanoCifra = tamanoParaCaber(cifra, maxAncho, { min: 32, max: 56 });
  const cifraRecortada = recortarALinea(cifra, maxAncho, tamanoCifra);
  const lineas = envolverLineas(texto, maxAncho, 15, 2);

  // V1: alto calculado a partir de la cifra (según su tamaño real) + las
  // líneas de texto reales, no un 180 fijo.
  const margenTop = 18;
  const alturaCifra = tamanoCifra * 1.15;
  const gapCifraTexto = 14;
  const lineHeightTexto = 19;
  const margenInferior = 14;
  const alto = margenTop + alturaCifra + gapCifraTexto + lineas.length * lineHeightTexto + margenInferior;

  const svg = crearSvg(alto);
  const yCifra = margenTop + alturaCifra / 2;
  svg.appendChild(
    crearTexto(ANCHO / 2, yCifra, cifraRecortada, { tamano: tamanoCifra, ancla: 'middle', color: 'var(--acento)', peso: 700 })
  );

  const yTextoBase = margenTop + alturaCifra + gapCifraTexto + lineHeightTexto / 2;
  lineas.forEach((linea, i) => {
    svg.appendChild(
      crearTexto(ANCHO / 2, yTextoBase + i * lineHeightTexto, linea, { tamano: 15, ancla: 'middle', color: 'var(--texto)' })
    );
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
