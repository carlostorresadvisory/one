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

// Exportada (ronda de corrección 1, I4): permite al test de cobertura DOM comprobar el ancho
// estimado real del `secundario` recortado sin duplicar FACTOR_ANCHO_MEDIO como constante mágica.
export function medirAncho(texto, tamano) {
  return texto.length * tamano * FACTOR_ANCHO_MEDIO;
}

/** Recorta `texto` a una sola línea que quepa en `maxAncho` al tamaño dado,
 * añadiendo "…" si hace falta cortar. Nunca devuelve más ancho del permitido.
 * Exportada (ronda de corrección 1, C1): la usa `construirVisualClave` para el `secundario` de la
 * tarjeta tipográfica, y así el test de cobertura DOM (`tests/visuales-clave-dom.test.js`) puede
 * verificar el ancho real sin duplicar la estimación de `medirAncho`/`FACTOR_ANCHO_MEDIO`. */
export function recortarALinea(texto, maxAncho, tamano) {
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

/** `alto` es el YA CALCULADO por cada plantilla según su contenido; `altoObjetivo` (spec
 * v0.2a.2.1 §1.5) es el que pide la ZONA de la tarjeta revelada, para que el dibujo la llene en
 * vez de quedarse centrado con bandas vacías arriba y abajo. Un objetivo menor que el natural se
 * ignora: antes se encoge la caja que el contenido. */
function crearSvg(altoContenido, altoObjetivo = 0) {
  const alto = Math.max(ALTO_MINIMO, altoContenido, altoObjetivo > 0 ? altoObjetivo : 0);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ANCHO} ${alto}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.aspectRatio = `${ANCHO} / ${alto}`;
  svg.classList.add('visual-svg');
  svg.dataset.test = 'visual';
  return svg;
}

/** Reparte `n` filas en el alto objetivo (spec §1.5): la fila crece desde su alto natural
 * (ALTO_FILA) hasta lo que quepa, y la tipografía sube con ella dentro de los límites de la spec
 * (mínimo 13, máximo 18 unidades de viewBox ≈ px reales, porque el ancho del viewBox, 320, se
 * estira a los ~309px reales de la zona). Sin objetivo, devuelve exactamente lo de siempre. */
function repartirFilas(n, alturaFija, altoObjetivo) {
  const base = ALTO_FILA;
  if (!Number.isFinite(altoObjetivo) || altoObjetivo <= 0 || n <= 0) return { altoFila: base, tamano: 13 };
  const altoFila = Math.max(base, (altoObjetivo - alturaFija) / n);
  const tamano = Math.round(Math.min(18, Math.max(13, altoFila * 0.4)));
  return { altoFila, tamano };
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
// Alto mínimo del viewBox (hallazgo adversarial v0.1e #5): con poco contenido
// (p. ej. 2 barras sin título = 84) el SVG quedaba por debajo de los 90 px reales
// que la cascada de encaje da por sentados (spec v0.1d §4). A ~305 px de ancho
// de tarjeta, 100 unidades ≈ 95 px reales.
const ALTO_MINIMO = 100;

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
function plantillaFormula(visual, altoObjetivo = 0) {
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
  const altoNatural = dosLineas ? 150 : 100;
  const alto = Math.max(altoNatural, altoObjetivo > 0 ? altoObjetivo : 0);
  const svg = crearSvg(alto, altoObjetivo);

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

function plantillaLineaTiempo(visual, altoObjetivo = 0) {
  if (!Array.isArray(visual.hitos)) return null;
  const hitos = visual.hitos
    .filter((h) => h && esTextoValido(h.ano) && esTextoValido(h.texto))
    .slice(0, 5);
  if (!hitos.length) return null;

  const n = hitos.length;
  const margen = 16; // 8 arriba + 8 abajo
  const { altoFila, tamano } = repartirFilas(n, margen, altoObjetivo);
  const alto = margen + n * altoFila; // V1: alto = filas reales, sin sobrante
  const svg = crearSvg(alto, altoObjetivo);
  const xLinea = 26;

  svg.appendChild(crearLinea(xLinea, margen / 2, xLinea, alto - margen / 2, 'var(--texto-suave)', 2, 0.4));

  hitos.forEach((h, i) => {
    const y = margen / 2 + i * altoFila + altoFila / 2;
    const circulo = document.createElementNS(NS, 'circle');
    circulo.setAttribute('cx', String(xLinea));
    circulo.setAttribute('cy', String(y));
    circulo.setAttribute('r', String(Math.max(5, Math.min(8, altoFila * 0.1))));
    circulo.setAttribute('fill', 'var(--acento)');
    svg.appendChild(circulo);

    const xAno = xLinea + 14;
    const anoTexto = recortarALinea(h.ano.trim(), 70, tamano);
    svg.appendChild(crearTexto(xAno, y, anoTexto, { tamano, color: 'var(--acento)', peso: 700 }));

    const xTexto = xLinea + 88;
    const maxAnchoTexto = ANCHO - xTexto - 10;
    const textoTexto = recortarALinea(h.texto.trim(), maxAnchoTexto, tamano);
    svg.appendChild(crearTexto(xTexto, y, textoTexto, { tamano, color: 'var(--texto)' }));
  });

  return svg;
}

function formatearValor(v) {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 100) / 100);
}

function plantillaBarras(visual, altoObjetivo = 0) {
  if (!Array.isArray(visual.items)) return null;
  const items = visual.items
    .filter((it) => it && esTextoValido(it.etiqueta) && typeof it.valor === 'number' && Number.isFinite(it.valor) && it.valor > 0) // magnitudes comparables: ceros y negativos no se dibujan (adversarial v0.1e #4)
    .slice(0, 5);
  if (!items.length) return null;

  const n = items.length;
  const tieneTitulo = esTextoValido(visual.titulo);
  const cabecera = tieneTitulo ? 26 : 6; // V1: alto = cabecera real + filas reales
  const margenInferior = 6;
  const { altoFila, tamano } = repartirFilas(n, cabecera + margenInferior, altoObjetivo);
  const alto = cabecera + n * altoFila + margenInferior;
  const svg = crearSvg(alto, altoObjetivo);

  if (tieneTitulo) {
    const tamanoTitulo = Math.min(18, tamano + 2);
    const tituloTexto = recortarALinea(visual.titulo.trim(), ANCHO - 20, tamanoTitulo);
    svg.appendChild(crearTexto(10, 14, tituloTexto, { tamano: tamanoTitulo, color: 'var(--texto-suave)', peso: 600 }));
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
  const maxValor = Math.max(...items.map((it) => it.valor));

  items.forEach((it, i) => {
    const y = cabecera + i * altoFila + altoFila / 2;
    // La barra engorda con la fila (hasta 26) para que no quede un hilo en medio de una fila alta.
    const altoBarra = Math.max(14, Math.min(26, altoFila * 0.34));

    const etiquetaTexto = recortarALinea(it.etiqueta.trim(), anchoEtiqueta, tamano);
    svg.appendChild(crearTexto(xEtiqueta, y, etiquetaTexto, { tamano, color: 'var(--texto)' }));

    svg.appendChild(crearRect(xBarra, y - altoBarra / 2, anchoBarraMax, altoBarra, 'var(--texto-suave)', 0.2));
    const anchoBarra = Math.max(3, (it.valor / maxValor) * anchoBarraMax);
    svg.appendChild(crearRect(xBarra, y - altoBarra / 2, anchoBarra, altoBarra, 'var(--acento)', 1));

    const unidad = esTextoValido(it.unidad) ? ` ${it.unidad.trim()}` : '';
    const valorTexto = recortarALinea(`${formatearValor(it.valor)}${unidad}`, anchoValor, tamano);
    svg.appendChild(crearTexto(xValor, y, valorTexto, { tamano, color: 'var(--texto)' }));
  });

  return svg;
}

function plantillaComparacion(visual, altoObjetivo = 0) {
  if (!Array.isArray(visual.columnas) || visual.columnas.length !== 2) return null;
  const columnas = visual.columnas.map((c) => ({
    titulo: c && esTextoValido(c.titulo) ? c.titulo.trim() : '',
    puntos: c && Array.isArray(c.puntos) ? c.puntos.filter(esTextoValido).map((p) => p.trim()).slice(0, 3) : [],
  }));
  if (columnas.some((c) => !c.titulo || !c.puntos.length)) return null;

  const anchoColumna = ANCHO / 2 - 20;
  const Y_TITULO = 18;
  const Y_INICIO_PUNTOS = 42;
  const MARGEN_INFERIOR = 10;

  // V1: el alto del viewBox se calcula a partir de las líneas REALES que
  // necesita la columna más alta (envolverLineas ya decide cuántas líneas
  // hace falta cada punto) — nunca un 180 fijo con hueco de sobra si el
  // contenido pide menos. Con `altoObjetivo` (spec §1.5), el reparto va por
  // tamaño de letra, en dos pasadas: envolver depende del tamaño, así que
  // subir la letra puede cambiar cuántas líneas hace falta cada punto.
  let tamanoPunto = 13;
  let lineHeight = 17;
  let gapPunto = 8;

  const medirColumnas = (tamano, lh, gap) => columnas.map((col) => {
    const puntosLineas = col.puntos.map((p) => envolverLineas(`• ${p}`, anchoColumna, tamano, 2));
    const alturaPuntos = puntosLineas.reduce((acc, lineas) => acc + lineas.length * lh + gap, 0);
    return { titulo: col.titulo, puntosLineas, alturaPuntos };
  });

  let columnasLayout = medirColumnas(tamanoPunto, lineHeight, gapPunto);
  let alturaMaxPuntos = Math.max(...columnasLayout.map((c) => c.alturaPuntos));
  const disponible = Number.isFinite(altoObjetivo) && altoObjetivo > 0 ? altoObjetivo - Y_INICIO_PUNTOS - MARGEN_INFERIOR : 0;
  if (disponible > alturaMaxPuntos) {
    // Segunda pasada: sube la letra proporcionalmente (tope 18, spec §1.5) y vuelve a envolver,
    // porque con más tamaño caben menos palabras por línea.
    tamanoPunto = Math.round(Math.min(18, Math.max(13, 13 * (disponible / alturaMaxPuntos))));
    lineHeight = Math.round(tamanoPunto * 1.3);
    columnasLayout = medirColumnas(tamanoPunto, lineHeight, gapPunto);
    alturaMaxPuntos = Math.max(...columnasLayout.map((c) => c.alturaPuntos));
    // Lo que aún sobre se reparte como aire entre los puntos, no como hueco muerto al final.
    const puntosMax = Math.max(1, Math.max(...columnasLayout.map((c) => c.puntosLineas.length)));
    const sobra = disponible - alturaMaxPuntos;
    if (sobra > 0) {
      gapPunto += sobra / puntosMax;
      columnasLayout = medirColumnas(tamanoPunto, lineHeight, gapPunto);
      alturaMaxPuntos = Math.max(...columnasLayout.map((c) => c.alturaPuntos));
    }
  }
  const tamanoTitulo = Math.min(18, tamanoPunto + 2);
  const alto = Math.max(Y_INICIO_PUNTOS + alturaMaxPuntos + MARGEN_INFERIOR, altoObjetivo > 0 ? altoObjetivo : 0);

  const svg = crearSvg(alto, altoObjetivo);
  const xDivisor = ANCHO / 2;
  svg.appendChild(crearLinea(xDivisor, 8, xDivisor, alto - 8, 'var(--texto-suave)', 1, 0.35));

  const centros = [ANCHO * 0.27, ANCHO * 0.73];
  columnasLayout.forEach((col, ci) => {
    const cx = centros[ci];
    const xIzquierda = cx - anchoColumna / 2;
    const tituloTexto = recortarALinea(col.titulo, anchoColumna, tamanoTitulo);
    svg.appendChild(
      crearTexto(cx, Y_TITULO, tituloTexto, { tamano: tamanoTitulo, ancla: 'middle', color: 'var(--acento)', peso: 700 })
    );

    let y = Y_INICIO_PUNTOS;
    col.puntosLineas.forEach((lineas) => {
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

function plantillaFlujo(visual, altoObjetivo = 0) {
  if (!Array.isArray(visual.pasos)) return null;
  const pasos = visual.pasos.filter(esTextoValido).map((p) => p.trim()).slice(0, 4);
  if (!pasos.length) return null;

  const n = pasos.length;
  const margen = 8;
  const FLECHA = 14;
  // El alto natural es margen*2 + n*50 - 14 (la última caja no arrastra flecha): al repartir, la
  // "fila" sigue siendo caja + hueco de flecha.
  const filaNatural = 50;
  const disponible = Number.isFinite(altoObjetivo) && altoObjetivo > 0 ? altoObjetivo - margen * 2 + FLECHA : 0;
  const filaFlujo = disponible > 0 ? Math.max(filaNatural, disponible / n) : filaNatural;
  const altoCaja = Math.max(36, filaFlujo - FLECHA);
  const tamano = Math.round(Math.min(18, Math.max(13, altoCaja * 0.36)));
  const alto = margen * 2 + n * filaFlujo - FLECHA; // sin flecha colgando tras la última caja
  const svg = crearSvg(alto, altoObjetivo);
  const anchoCaja = 220;
  const xCaja = (ANCHO - anchoCaja) / 2;

  pasos.forEach((texto, i) => {
    const yFila = margen + i * filaFlujo;
    const yCaja = yFila;

    const rect = crearRect(xCaja, yCaja, anchoCaja, altoCaja, 'var(--acento)', 0.15);
    rect.setAttribute('stroke', 'var(--acento)');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('rx', '8');
    svg.appendChild(rect);

    const textoRecortado = recortarALinea(texto, anchoCaja - 20, tamano);
    svg.appendChild(
      crearTexto(ANCHO / 2, yCaja + altoCaja / 2, textoRecortado, { tamano, ancla: 'middle', color: 'var(--texto)', peso: 600 })
    );

    if (i < n - 1) {
      const yFlecha = yCaja + altoCaja + (filaFlujo - altoCaja) / 2 - 4;
      svg.appendChild(crearFlechaAbajo(ANCHO / 2, yFlecha, 5));
    }
  });

  return svg;
}

function plantillaDato(visual, altoObjetivo = 0) {
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
  const altoNatural = margenTop + alturaCifra + gapCifraTexto + lineas.length * lineHeightTexto + margenInferior;
  const alto = Math.max(altoNatural, altoObjetivo > 0 ? altoObjetivo : 0);

  const svg = crearSvg(alto, altoObjetivo);
  // Con un viewBox más alto que el natural, el bloque cifra+texto se centra en vez de quedarse
  // pegado arriba con el hueco debajo.
  const dy = (alto - altoNatural) / 2;
  const yCifra = dy + margenTop + alturaCifra / 2;
  svg.appendChild(
    crearTexto(ANCHO / 2, yCifra, cifraRecortada, { tamano: tamanoCifra, ancla: 'middle', color: 'var(--acento)', peso: 700 })
  );

  const yTextoBase = dy + margenTop + alturaCifra + gapCifraTexto + lineHeightTexto / 2;
  lineas.forEach((linea, i) => {
    svg.appendChild(
      crearTexto(ANCHO / 2, yTextoBase + i * lineHeightTexto, linea, { tamano: 15, ancla: 'middle', color: 'var(--texto)' })
    );
  });

  return svg;
}

// === esVisualValido: mismo esquema que tools/visualizar.js#validarVisual (v0.2b4.1 §5, I2, ronda de
// corrección 1) ===================================================================================
// Duplicado A PROPÓSITO, no importado: este fichero corre en el navegador sin dependencias, y
// tools/visualizar.js las tiene (fs/promises, tools/openrouter.js...) -- importarlo desde aquí
// rompería la carga del cliente. Las plantillas de arriba (plantillaFormula, etc.) validan solo su
// "forma mínima" para poder dibujar (ver comentario de cabecera del fichero); esto es el esquema
// COMPLETO de la spec §2, el mismo que usa el pipeline para aceptar un visual en datos/banco.json.
// Lo usa `sincronizacion.js#aplicarActualizaciones` (I2): un visual truthy pero mal formado que
// llegara del servidor NO debe pisar uno bueno ni apagar `visualPendiente` para siempre. Un test
// (tests/visuales.test.js) comprueba que el veredicto coincide al 100% con `validarVisual` sobre los
// visuales reales de datos/banco.json -- si el esquema cambia en un sitio y no en el otro, ese test
// avisa.
const TIPOS_VISUAL_VALIDO = ['formula', 'linea-tiempo', 'barras', 'comparacion', 'flujo', 'dato'];
const REGEX_ANIO_FUENTE_VALIDACION = /\b(18|19|20)\d{2}\b/;
const FRASES_FUENTE_NO_VERIFICABLE_VALIDACION = [
  'estandar',
  'concepto',
  'aproximad',
  'tipic',
  'generic',
  'de manual',
  'calculo propio',
  'estimacion propia',
  'analisis',
];
const FRASES_ILUSTRATIVO_EN_TEXTO_VALIDACION = ['tipic', 'aproximad', 'estimad'];

function normalizarTextoValidacion(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Mismas reglas que tools/visualizar.js#validarFuente, sin el detalle del motivo (aquí solo hace
// falta el booleano; el motivo textual solo lo necesita el pipeline de generación para su log).
function validarFuenteVisual(fuente) {
  if (!esTextoValido(fuente)) return false;
  if (fuente.length < 8 || fuente.length > 40) return false;
  if (!REGEX_ANIO_FUENTE_VALIDACION.test(fuente)) return false;
  const normalizada = normalizarTextoValidacion(fuente);
  if (FRASES_FUENTE_NO_VERIFICABLE_VALIDACION.some((f) => normalizada.includes(f))) return false;
  const soloLetras = fuente.replace(REGEX_ANIO_FUENTE_VALIDACION, '').replace(/[^\p{L}]/gu, '');
  return soloLetras.length >= 3;
}

function contieneFraseIlustrativaVisual(texto) {
  if (!esTextoValido(texto)) return false;
  const normalizado = normalizarTextoValidacion(texto);
  return FRASES_ILUSTRATIVO_EN_TEXTO_VALIDACION.some((f) => normalizado.includes(f));
}

/**
 * v0.2b4.1 §5 (I2): ¿pasa `visual` el esquema completo de la spec §2 (el mismo que
 * `tools/visualizar.js#validarVisual`)? Nunca lanza. A diferencia de `construirVisual` (que dibuja
 * con lo que tenga, con su propia comprobación mínima de forma), esto es estricto: un `barras`/`dato`
 * sin `fuente` verificable, una `formula` con LaTeX crudo, una `linea-tiempo` con años repetidos...
 * todo lo que el pipeline de generación rechazaría, esto también lo rechaza.
 * @param {any} visual
 * @returns {boolean}
 */
export function esVisualValido(visual) {
  if (!visual || typeof visual !== 'object' || Array.isArray(visual)) return false;
  if (!TIPOS_VISUAL_VALIDO.includes(visual.tipo)) return false;
  if (!esTextoValido(visual.leyenda) || visual.leyenda.length > 60) return false;

  switch (visual.tipo) {
    case 'formula': {
      if (!esTextoValido(visual.texto) || visual.texto.length > 40) return false;
      // Fijado por Carlos tras la pasada adversarial del 13-sep-2026: LaTeX crudo se pintaría
      // literal en el SVG -- la notación es siempre plana.
      return !/[\\$]/.test(visual.texto);
    }
    case 'linea-tiempo': {
      if (!Array.isArray(visual.hitos) || visual.hitos.length < 3 || visual.hitos.length > 5) return false;
      for (const h of visual.hitos) {
        if (!h || !esTextoValido(h.ano) || h.ano.length > 9) return false;
        if (!esTextoValido(h.texto) || h.texto.length > 22) return false;
      }
      const anos = visual.hitos.map((h) => h && h.ano).filter((a) => typeof a === 'string');
      return new Set(anos).size === anos.length; // "ano" repetido: dos hitos en el mismo punto.
    }
    case 'barras': {
      if (!Array.isArray(visual.items) || visual.items.length < 2 || visual.items.length > 5) return false;
      for (const it of visual.items) {
        if (!it || !esTextoValido(it.etiqueta) || it.etiqueta.length > 16) return false;
        // > 0, no solo numérico/finito: son magnitudes comparables en un gráfico de barras -- un
        // cero o un negativo rompen el dibujo.
        if (typeof it.valor !== 'number' || !Number.isFinite(it.valor) || it.valor <= 0) return false;
        if (it.unidad !== undefined && it.unidad !== null) {
          if (typeof it.unidad !== 'string' || it.unidad.length > 6) return false;
        }
      }
      // "fuente" OBLIGATORIA para barras/dato: sin ella (o con pinta de cifra ilustrativa) no es un
      // dato real con procedencia.
      if (!validarFuenteVisual(visual.fuente)) return false;
      if (contieneFraseIlustrativaVisual(visual.titulo)) return false;
      if (contieneFraseIlustrativaVisual(visual.leyenda)) return false;
      return true;
    }
    case 'comparacion': {
      if (!Array.isArray(visual.columnas) || visual.columnas.length !== 2) return false;
      for (const c of visual.columnas) {
        if (!c || !esTextoValido(c.titulo) || c.titulo.length > 16) return false;
        if (!Array.isArray(c.puntos) || c.puntos.length < 2 || c.puntos.length > 3) return false;
        for (const p of c.puntos) {
          if (!esTextoValido(p) || p.length > 28) return false;
        }
      }
      return true;
    }
    case 'flujo': {
      if (!Array.isArray(visual.pasos) || visual.pasos.length < 2 || visual.pasos.length > 4) return false;
      for (const p of visual.pasos) {
        if (!esTextoValido(p) || p.length > 18) return false;
      }
      return true;
    }
    case 'dato': {
      if (!esTextoValido(visual.cifra) || visual.cifra.length > 8) return false;
      if (!esTextoValido(visual.texto) || visual.texto.length > 40) return false;
      if (!validarFuenteVisual(visual.fuente)) return false;
      return !contieneFraseIlustrativaVisual(visual.leyenda);
    }
    default:
      return false; // inalcanzable: ya filtrado por TIPOS_VISUAL_VALIDO arriba.
  }
}

const PLANTILLAS = {
  formula: plantillaFormula,
  'linea-tiempo': plantillaLineaTiempo,
  barras: plantillaBarras,
  comparacion: plantillaComparacion,
  flujo: plantillaFlujo,
  dato: plantillaDato,
};

/** Dibuja `visual` (spec v0.1e §2) como SVG, o `null` si no hay nada pintable. `alto` (spec
 * v0.2a.2.1 §1.5) es el alto de viewBox OBJETIVO que pide la zona de la tarjeta revelada: cada
 * plantilla reparte sus filas y sube su tipografía para llenarlo. Sin `alto`, todo se comporta
 * como hasta ahora (lo usan el resumen y cualquier llamada que no mida la zona). `role="img"` +
 * `aria-label` = leyenda (spec v0.1e §4); el propio dibujo NUNCA pinta la leyenda (eso lo hace
 * construirBloqueVisual en app.js, en un <p> aparte, igual que el pie de la imagen de Commons). */
export function construirVisual(visual, { alto } = {}) {
  if (!visual || typeof visual !== 'object') return null;
  const plantilla = PLANTILLAS[visual.tipo];
  if (!plantilla) return null;
  const altoObjetivo = Number.isFinite(alto) && alto > 0 ? Math.round(alto) : 0;

  let svg = null;
  try {
    svg = plantilla(visual, altoObjetivo);
  } catch (err) {
    return null;
  }
  if (!svg) return null;

  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', esTextoValido(visual.leyenda) ? visual.leyenda.trim() : `Visual: ${visual.tipo}`); // nunca vacío (adversarial v0.1e #9)
  return svg;
}

// === Tercera capa: tarjeta tipográfica (spec v0.2 §8, "Tres capas") ===============================
// A diferencia de `construirVisual` (dibuja el campo `visual`, cuando existe, generado por el
// pipeline), esta capa la dibuja la APP SOLA, sin modelo ni red, para garantizar que el 100% de las
// preguntas tengan visual: la clave de la respuesta correcta en grande sobre un fondo radial cian
// oscuro, con el nombre del área. Sirve también para toda pregunta `srv-` que llegue sin visual.
//
// `modeloVisualClave` es la parte PURA (solo modelo, sin DOM) para poder probarla con node:test sin
// necesitar el navegador; `construirVisualClave` la convierte en HTML con el mismo estilo de
// creación (`createElementNS`/DOM) que las plantillas de arriba.

/** Primera frase de `enunciado`: hasta el primer terminador ('.', '?' o '!') inclusive; sin
 * terminador (o si la frase resultante supera los 90 caracteres) se recorta a 90 caracteres como
 * máximo con "…" -- nunca se coge la segunda frase ni se desborda la longitud.
 *
 * I3 (ronda de corrección 1): un '.'/'.'/'!' solo cuenta como cierre de frase si va seguido de
 * espacio o de fin de texto -- así un punto decimal o de miles ("1.000") nunca corta la frase a
 * mitad, porque va seguido de un dígito, no de espacio ni de fin. Confirmado con dato real del banco
 * (`log-040`: "...afecta a 1 de cada 1.000 personas. Existe..." antes cortaba en "...cada 1."). */
function primeraFrase(enunciado) {
  if (!esTextoValido(enunciado)) return '';
  const texto = enunciado.trim();
  const coincidencia = texto.match(/[.?!](?=\s|$)/);
  let frase = coincidencia ? texto.slice(0, coincidencia.index + 1) : texto;
  if (frase.length > 90) {
    frase = `${frase.slice(0, 89).trimEnd()}…`;
  }
  return frase;
}

/**
 * Modelo de la tarjeta tipográfica (spec v0.2a.2.1 §1.3), PURO -- sin DOM, testeable con node:test.
 * Sustituye a `textoVisualClave` de v0.2a.2 (principal/secundario): aquella forma única servía para
 * un SVG de una sola línea grande y era justo lo que Carlos calificó de "muy mala" en `ordenar`
 * (mostraba "primero → último" en vez del orden entero). Ahora cada tipo tiene su propio modelo,
 * y `construirVisualClave` decide el layout HTML a partir de `tipo`.
 *
 * NUNCA lanza: cualquier forma rota (tipo desconocido, faltan opciones/tarjeta/items, índices fuera
 * de rango, `null`…) devuelve `{ tipo: 'desconocido', area }` y la capa de dibujo pinta solo el área.
 *
 * @param {any} pregunta
 * @returns {{tipo: string, area: string, titulo?: string, [clave: string]: any}}
 */
export function modeloVisualClave(pregunta) {
  if (!pregunta || typeof pregunta !== 'object') return { tipo: 'desconocido', area: '' };
  const area = esTextoValido(pregunta.area) ? pregunta.area.trim() : '';
  const desconocido = { tipo: 'desconocido', area };

  try {
    switch (pregunta.tipo) {
      case 'ordenar': {
        // `items` YA viene en el orden correcto (motor.js#evaluar compara contra
        // items.map((_, i) => i)): la lista se pinta tal cual, entera.
        const items = Array.isArray(pregunta.items)
          ? pregunta.items.filter(esTextoValido).map((t) => t.trim())
          : [];
        if (!items.length) return desconocido;
        return { tipo: 'ordenar', area, titulo: 'Orden correcto', items };
      }
      case 'error': {
        const filas = pregunta.tarjeta && Array.isArray(pregunta.tarjeta.filas) ? pregunta.tarjeta.filas : null;
        const idx = pregunta.sospechoso;
        const fila = filas && Number.isInteger(idx) && idx >= 0 && idx < filas.length ? filas[idx] : null;
        if (!fila || !esTextoValido(fila.etiqueta)) return desconocido;
        // Hoy NINGUNA de las 40 preguntas `error` del banco trae el valor correcto aparte
        // (comprobado el 17-sep-2026 sobre datos/banco.json): `valorCorrecto` queda vacío y la
        // capa de dibujo enseña la fila tal cual, sin tachar nada (spec §1.3, rama "si la
        // tarjeta de datos no tiene valor correcto separado"). Los dos campos opcionales se
        // leen igualmente para que el pipeline pueda empezar a rellenarlos sin tocar esto.
        const correccion = esTextoValido(fila.correcto)
          ? fila.correcto.trim()
          : esTextoValido(pregunta.correccion)
            ? pregunta.correccion.trim()
            : '';
        return {
          tipo: 'error',
          area,
          titulo: 'Dato erróneo',
          etiqueta: fila.etiqueta.trim(),
          valorErroneo: esTextoValido(fila.valor) ? fila.valor.trim() : '',
          valorCorrecto: correccion,
        };
      }
      case 'test4': {
        const opciones = Array.isArray(pregunta.opciones) ? pregunta.opciones : null;
        const idx = pregunta.correcta;
        if (!opciones || !Number.isInteger(idx) || idx < 0 || idx >= opciones.length || !esTextoValido(opciones[idx])) {
          return desconocido;
        }
        return {
          tipo: 'test4',
          area,
          titulo: '',
          correcta: opciones[idx].trim(),
          descartadas: opciones.filter((_, i) => i !== idx).filter(esTextoValido).map((t) => t.trim()),
        };
      }
      case 'vf': {
        if (pregunta.respuesta !== true && pregunta.respuesta !== false) return desconocido;
        return {
          tipo: 'vf',
          area,
          titulo: '',
          veredicto: pregunta.respuesta ? 'Cierto' : 'Falso',
          frase: primeraFrase(pregunta.enunciado),
        };
      }
      default:
        return desconocido;
    }
  } catch (err) {
    return desconocido; // contrato de la capa: nunca lanza, ni con datos del servidor mal formados
  }
}

/** Primera letra en mayúscula -- mismo fallback que `nombreArea` en app.js (NOMBRES_AREA no está
 * exportado porque app.js no exporta nada: este fichero corre también sin app.js, ver cabecera). */
function capitalizarArea(texto) {
  if (!esTextoValido(texto)) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Un `<p>` del bloque tipográfico, con su clase y su texto. Envolver esto evita repetir cuatro
 * líneas idénticas por cada pieza de los cinco layouts de abajo. */
function crearParrafoClave(clase, texto, etiquetaHtml = 'p') {
  const el = document.createElement(etiquetaHtml);
  el.className = clase;
  el.textContent = texto;
  return el;
}

/**
 * Tercera capa (spec v0.2a.2.1 §1.3): tarjeta tipográfica en HTML, ya no en SVG. El motivo del
 * cambio es que el texto tiene que ENVOLVER y el alto es variable (una lista de 4 ítems ocupa más
 * que un "Cierto"), y un `viewBox` fijo obliga a recortar por caracteres y a dejar hueco muerto.
 * En HTML el layout lo resuelve el navegador y el bloque llena la zona de borde a borde.
 *
 * Un layout por tipo, todos dentro de `.visual-clave-cuerpo`:
 *  - `ordenar`: lista numerada COMPLETA en el orden correcto (la de v0.2a.2 enseñaba solo
 *    "primero → último": Carlos, 17-sep, "muy mala").
 *  - `error`: la fila sospechosa; con corrección, valor erróneo en `<s>` y el correcto al lado.
 *  - `test4`: la opción correcta grande y las tres descartadas apagadas.
 *  - `vf`: "Cierto"/"Falso" grande y la primera frase del enunciado debajo.
 *  - desconocido: solo el área.
 *
 * NUNCA lanza (contrato de la capa, garantiza el 100 % de tarjetas con visual): todo el cuerpo va
 * en un `try/catch` -- incluida la llamada a `nombreArea`, que viene de app.js y no tiene por qué
 * ser defensiva -- y el `catch` reconstruye un bloque mínimo usando solo `capitalizarArea`.
 *
 * @param {any} pregunta
 * @param {{ nombreArea?: (area: string) => string }} [opciones]
 * @returns {HTMLElement}
 */
export function construirVisualClave(pregunta, { nombreArea } = {}) {
  let modelo;
  try {
    modelo = modeloVisualClave(pregunta) || { tipo: 'desconocido', area: '' };
  } catch (err) {
    modelo = { tipo: 'desconocido', area: '' };
  }
  const areaId = typeof modelo.area === 'string' && modelo.area ? modelo.area : '';

  try {
    const areaTexto = areaId ? (typeof nombreArea === 'function' ? nombreArea(areaId) || '' : capitalizarArea(areaId)) : '';
    const caja = document.createElement('div');
    caja.className = `visual-clave visual-clave--${modelo.tipo}`;
    caja.dataset.test = 'visual-clave';

    if (esTextoValido(areaTexto)) caja.appendChild(crearParrafoClave('visual-clave-area', areaTexto.trim().toUpperCase()));
    if (esTextoValido(modelo.titulo)) caja.appendChild(crearParrafoClave('visual-clave-titulo', modelo.titulo));

    const cuerpo = document.createElement('div');
    cuerpo.className = 'visual-clave-cuerpo';

    if (modelo.tipo === 'ordenar') {
      const lista = document.createElement('ol');
      lista.className = 'visual-clave-lista';
      for (const texto of modelo.items) {
        const li = crearParrafoClave('visual-clave-item', texto, 'li');
        lista.appendChild(li);
      }
      cuerpo.appendChild(lista);
    } else if (modelo.tipo === 'error') {
      cuerpo.appendChild(crearParrafoClave('visual-clave-etiqueta', modelo.etiqueta));
      // Sin valor correcto que poner al lado, tachar el erróneo dejaría la tarjeta diciendo solo
      // "esto está mal" sin decir qué es lo bueno: se muestra la fila tal cual (spec §1.3).
      cuerpo.appendChild(crearParrafoClave('visual-clave-valor', modelo.valorErroneo, modelo.valorCorrecto ? 's' : 'p'));
      if (modelo.valorCorrecto) cuerpo.appendChild(crearParrafoClave('visual-clave-correccion', modelo.valorCorrecto));
    } else if (modelo.tipo === 'test4') {
      cuerpo.appendChild(crearParrafoClave('visual-clave-correcta', modelo.correcta));
      for (const texto of modelo.descartadas) cuerpo.appendChild(crearParrafoClave('visual-clave-descartada', texto));
    } else if (modelo.tipo === 'vf') {
      const veredicto = crearParrafoClave('visual-clave-veredicto', modelo.veredicto);
      veredicto.classList.add(modelo.veredicto === 'Cierto' ? 'visual-clave-veredicto--cierto' : 'visual-clave-veredicto--falso');
      cuerpo.appendChild(veredicto);
      if (esTextoValido(modelo.frase)) cuerpo.appendChild(crearParrafoClave('visual-clave-frase', modelo.frase));
    }

    caja.appendChild(cuerpo);
    caja.setAttribute('role', 'img');
    caja.setAttribute('aria-label', etiquetaAccesibleClave(modelo, areaTexto));
    return caja;
  } catch (err) {
    const areaSegura = areaId ? capitalizarArea(areaId) : '';
    const caja = document.createElement('div');
    caja.className = 'visual-clave visual-clave--desconocido';
    caja.dataset.test = 'visual-clave';
    if (esTextoValido(areaSegura)) caja.appendChild(crearParrafoClave('visual-clave-area', areaSegura.trim().toUpperCase()));
    const cuerpo = document.createElement('div');
    cuerpo.className = 'visual-clave-cuerpo';
    caja.appendChild(cuerpo);
    caja.setAttribute('role', 'img');
    caja.setAttribute('aria-label', esTextoValido(areaSegura) ? areaSegura.trim() : 'Visual');
    return caja;
  }
}

/** `aria-label` del bloque: un lector de pantalla tiene que oír la clave, no "imagen". */
function etiquetaAccesibleClave(modelo, areaTexto) {
  switch (modelo.tipo) {
    case 'ordenar':
      return `Orden correcto: ${modelo.items.join(', ')}`;
    case 'error':
      return modelo.valorCorrecto
        ? `Dato erróneo: ${modelo.etiqueta}, ${modelo.valorErroneo}; lo correcto es ${modelo.valorCorrecto}`
        : `Dato erróneo: ${modelo.etiqueta}, ${modelo.valorErroneo}`;
    case 'test4':
      return `Respuesta correcta: ${modelo.correcta}`;
    case 'vf':
      return modelo.frase ? `${modelo.veredicto}: ${modelo.frase}` : modelo.veredicto;
    default:
      return esTextoValido(areaTexto) ? areaTexto.trim() : 'Visual';
  }
}
