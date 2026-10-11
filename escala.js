// ONE · escala.js — fotos a escala real y línea temporal de Afinar (spec v0.3 §5.3.1; Carlos, 10-oct:
// sustituye a las siluetas, formas y puntos). Dos partes:
//   · geometría pura (`tamanosFotos`, `ventanaLinea`, `posicionEnLinea`), probada con node --test;
//   · montaje DOM (`montarEscenaFotos`, `montarLineaTemporal`) con el `documento` inyectable.
// Nada de lo que se dibuja aquí lleva emoji ni siluetas: la cifra es siempre una FOTO (o el color del área).
// Los tamaños se fijan por `style` y el movimiento lo pone el CSS (`.escala-*` en estilos.css), que con
// `prefers-reduced-motion` salta directo al tamaño real.

export const ALTO_MINIMO_PX = 12;
const ANO_MIN = -3000;
const ANO_MAX = 2026;

// --- Geometría pura -----------------------------------------------------------------------------------------

const medidaDe = (modo, v) => (Number.isFinite(v) && v > 0 ? (modo === 'area' ? Math.sqrt(v) : v) : 0);
const redondear = (n) => Math.round(n * 100) / 100;

/**
 * Tamaño en píxeles de las dos fotos: `modo: 'alto'` (alturas y longitudes) → el ALTO de cada foto es proporcional
 * a su cifra; `modo: 'area'` (superficie, población, dinero) → el LADO es proporcional a √cifra, así el ÁREA lo es
 * a la cifra. La mayor ocupa `maxPx` y la otra se escala en proporción; si quedara por debajo de 12 px se dibuja a
 * 12 px con `diminuta: true` y `veces` (cuántas veces es más pequeña, para «real: N veces más pequeña»).
 */
export function tamanosFotos({ ref, valor, modo = 'alto', maxPx = 160 }) {
  const a = medidaDe(modo, ref);
  const b = medidaDe(modo, valor);
  const grande = Math.max(a, b);
  const hacer = (medida, cifra, otra) => {
    const px = grande > 0 ? (maxPx * medida) / grande : 0;
    const diminuta = px < ALTO_MINIMO_PX;
    const mayor = Math.max(cifra, otra);
    const veces = cifra > 0 && mayor > cifra ? Math.round(Math.min(1e9, mayor / cifra)) : 1;
    return { px: redondear(diminuta ? ALTO_MINIMO_PX : px), diminuta, veces };
  };
  return { ref: hacer(a, ref, valor), valor: hacer(b, valor, ref) };
}

const PASOS = [100, 50, 20, 10]; // años entre marcas, de siglos a décadas
const SPAN_ALEJADO = 4000; // años visibles sin zoom (la barra de Afinar llega a ± 2.000 de la referencia)
const SPAN_CERCANO = 200; // años visibles con todo el zoom

/** Ventana de la línea temporal: `zoom ∈ [0, 1]` (0 = siglos, 1 = décadas) centrada en `centro`. */
export function ventanaLinea(centro, zoom) {
  const z = Math.min(1, Math.max(0, Number.isFinite(zoom) ? zoom : 0));
  const span = SPAN_ALEJADO * (SPAN_CERCANO / SPAN_ALEJADO) ** z;
  const paso = z < 0.25 ? PASOS[0] : z < 0.5 ? PASOS[1] : z < 0.75 ? PASOS[2] : PASOS[3];
  let desde = centro - span / 2;
  let hasta = centro + span / 2;
  // La ventana no se sale de los años que existen en el banco.
  if (desde < ANO_MIN) { hasta += ANO_MIN - desde; desde = ANO_MIN; }
  if (hasta > ANO_MAX) { desde -= hasta - ANO_MAX; hasta = ANO_MAX; }
  return { desde: Math.max(ANO_MIN, Math.round(desde)), hasta: Math.min(ANO_MAX, Math.round(hasta)), paso };
}

/** Posición `t ∈ [0, 1]` de un año dentro de la ventana (recortada). */
export function posicionEnLinea(valor, ventana) {
  const ancho = ventana.hasta - ventana.desde;
  if (!(ancho > 0) || !Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, (valor - ventana.desde) / ancho));
}

/** Zoom que deja a la vista la referencia y la estimación: más cerca, más décadas. */
export function zoomParaDistancia(distanciaAnos) {
  const necesario = Math.max(SPAN_CERCANO, Math.abs(distanciaAnos) * 1.3 + 60);
  return Math.min(1, Math.max(0, Math.log(SPAN_ALEJADO / necesario) / Math.log(SPAN_ALEJADO / SPAN_CERCANO)));
}

const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const textoAno = (a) => (a < 0 ? `${miles(Math.abs(a))} a. C.` : String(Math.round(a)));

// --- DOM ------------------------------------------------------------------------------------------------------

function crear(documento, etiqueta, clase, texto) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** La caja de una cifra: el color del área (con su nombre, sin emoji) y encima su foto, si la hay y carga. */
function montarCaja(documento, cifra, colorArea, area) {
  const caja = crear(documento, 'div', 'escala-caja');
  if (area) caja.setAttribute('data-area', area);
  if (colorArea) caja.style.background = colorArea;
  const nombre = crear(documento, 'span', 'escala-caja-nombre', cifra.nombre);
  caja.appendChild(nombre);
  const imagen = cifra.imagen;
  if (imagen && typeof imagen.url === 'string' && imagen.url) {
    const img = crear(documento, 'img', 'escala-img');
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = imagen.url;
    img.addEventListener('error', () => {
      img.remove(); // sin foto: queda el color del área con el nombre
      caja.classList.add('escala-caja--sin-foto');
    });
    caja.appendChild(img);
  } else {
    caja.classList.add('escala-caja--sin-foto');
  }
  return caja;
}

function ponerTamano(caja, px, modo, anchoCaja) {
  caja.style.height = `${px}px`;
  caja.style.width = modo === 'area' ? `${px}px` : anchoCaja;
}

/**
 * Las dos fotos una al lado de la otra y apoyadas en la misma línea de suelo. `ref` y `misteriosa` son cifras
 * (`nombre`, `valor`, `imagen?`); `modo` es `'alto'` o `'area'`; `maxPx` es lo que mide la mayor. Devuelve
 * `{ actualizar(valorEstimado), revelar(valorReal, { duracionMs }), destruir() }`:
 * al deslizar, la foto de la misteriosa crece o encoge en tiempo real con un contorno cian discontinuo («tu
 * estimación»); `revelar` pasa las dos a su tamaño relativo verdadero y deja el contorno donde estaba la estimación.
 * 🔶 Provisional (la spec no fija el ancho): en `'alto'` cada caja tiene un ancho fijo (la mitad menos el hueco).
 */
export function montarEscenaFotos(contenedor, { ref, misteriosa, modo = 'alto', colorArea = null, maxPx = 160, documento = contenedor.ownerDocument ?? globalThis.document }) {
  const raiz = crear(documento, 'div', 'escala escala--vivo');
  raiz.setAttribute('data-test', 'escala');
  raiz.setAttribute('data-modo', modo);
  const suelo = crear(documento, 'div', 'escala-suelo');
  const itemRef = crear(documento, 'div', 'escala-item');
  const itemMis = crear(documento, 'div', 'escala-item');
  const cajaRef = montarCaja(documento, ref, colorArea, ref.area);
  const cajaMis = montarCaja(documento, misteriosa, colorArea, misteriosa.area);
  cajaRef.setAttribute('data-test', 'escala-ref');
  cajaMis.setAttribute('data-test', 'escala-misteriosa');
  cajaMis.classList.add('escala-caja--estimacion');
  itemRef.appendChild(cajaRef);
  itemMis.appendChild(cajaMis);
  suelo.append(itemRef, itemMis);
  const etiquetaRef = crear(documento, 'span', 'escala-etiqueta');
  const etiquetaMis = crear(documento, 'span', 'escala-etiqueta');
  etiquetaRef.setAttribute('data-test', 'escala-etiqueta-ref');
  etiquetaMis.setAttribute('data-test', 'escala-etiqueta-misteriosa');
  const etiquetas = crear(documento, 'div', 'escala-etiquetas');
  etiquetas.append(etiquetaRef, etiquetaMis);
  raiz.append(suelo, etiquetas);
  contenedor.appendChild(raiz);

  const anchoCaja = 'var(--escala-ancho, 46%)';
  let revelada = false;
  let ultimaEstimacion = ref.valor; // la barra empieza a la par de la referencia (y la cifra misteriosa no se toca hasta revelar)
  let fantasma = null;

  const etiquetaDe = (cifra, t) => (t.diminuta ? `${cifra.nombre} · real: ${miles(t.veces)} veces más pequeña` : cifra.nombre);

  function pintar(valorMis) {
    const t = tamanosFotos({ ref: ref.valor, valor: valorMis, modo, maxPx });
    ponerTamano(cajaRef, t.ref.px, modo, anchoCaja);
    ponerTamano(cajaMis, t.valor.px, modo, anchoCaja);
    cajaRef.classList.toggle('escala-caja--diminuta', t.ref.diminuta);
    cajaMis.classList.toggle('escala-caja--diminuta', t.valor.diminuta);
    etiquetaRef.textContent = etiquetaDe(ref, t.ref);
    etiquetaMis.textContent = etiquetaDe(misteriosa, t.valor);
    return t;
  }

  pintar(ref.valor);

  return {
    /** Redimensiona la foto de la misteriosa con la estimación en vivo (`valorEstimado` > 0). */
    actualizar(valorEstimado) {
      if (revelada || !(valorEstimado > 0)) return;
      ultimaEstimacion = valorEstimado;
      pintar(valorEstimado);
    },
    /** Las pasa a su tamaño relativo verdadero; el contorno discontinuo queda marcando tu estimación. */
    revelar(valorReal, { duracionMs = 700 } = {}) {
      if (revelada) return;
      revelada = true;
      raiz.classList.remove('escala--vivo');
      cajaRef.style.transitionDuration = `${duracionMs}ms`;
      cajaMis.style.transitionDuration = `${duracionMs}ms`;
      // El contorno de la estimación se queda en su escala nueva (la de la comparación real), recortado a maxPx.
      const grande = Math.max(medidaDe(modo, ref.valor), medidaDe(modo, valorReal));
      const pxEstimacion = Math.min(maxPx, Math.max(ALTO_MINIMO_PX, grande > 0 ? (maxPx * medidaDe(modo, ultimaEstimacion)) / grande : ALTO_MINIMO_PX));
      fantasma = crear(documento, 'div', 'escala-fantasma');
      fantasma.setAttribute('data-test', 'escala-fantasma');
      ponerTamano(fantasma, redondear(pxEstimacion), modo, anchoCaja);
      itemMis.appendChild(fantasma);
      cajaMis.classList.remove('escala-caja--estimacion');
      cajaMis.classList.add('escala-caja--real');
      pintar(valorReal);
    },
    destruir() {
      raiz.remove();
    },
  };
}

/**
 * La línea temporal de Afinar con fechas, en su propia banda oscura (se lee sobre la foto), con la referencia
 * clavada en su año. `arrastrar(año)` coloca el evento misterioso y hace zoom (siglos → décadas) al acercarse;
 * `revelar(año)` clava una marca verde en el año real; `ventana()` devuelve la ventana visible.
 */
export function montarLineaTemporal(contenedor, { ref, documento = contenedor.ownerDocument ?? globalThis.document }) {
  const banda = crear(documento, 'div', 'escala-linea');
  banda.setAttribute('data-test', 'escala-linea');
  const eje = crear(documento, 'div', 'escala-linea-eje');
  banda.appendChild(eje);
  contenedor.appendChild(banda);

  let actual = ventanaLinea(ref.valor, 0);
  let estimacion = null;
  let real = null;

  function marca(clase, ano, texto, test) {
    const m = crear(documento, 'div', `escala-marca ${clase}`);
    m.style.left = `${(posicionEnLinea(ano, actual) * 100).toFixed(2)}%`;
    if (test) m.setAttribute('data-test', test);
    m.appendChild(crear(documento, 'span', 'escala-marca-texto', texto));
    return m;
  }

  function pintar() {
    const hijos = [];
    const primera = Math.ceil(actual.desde / actual.paso) * actual.paso;
    const cadaN = actual.paso === 100 ? 5 : actual.paso === 50 ? 4 : 2; // una de cada N lleva el año escrito
    let i = 0;
    for (let a = primera; a <= actual.hasta; a += actual.paso, i += 1) {
      const t = crear(documento, 'div', i % cadaN === 0 ? 'escala-tic escala-tic--grande' : 'escala-tic');
      t.style.left = `${(posicionEnLinea(a, actual) * 100).toFixed(2)}%`;
      if (i % cadaN === 0) t.appendChild(crear(documento, 'span', 'escala-tic-texto', textoAno(a)));
      hijos.push(t);
    }
    hijos.push(marca('escala-marca--ref', ref.valor, `${ref.nombre} · ${textoAno(ref.valor)}`, 'escala-marca-ref'));
    if (estimacion !== null) hijos.push(marca('escala-marca--estimacion', estimacion, `? · ${textoAno(estimacion)}`, 'escala-marca-estimacion'));
    if (real !== null) hijos.push(marca('escala-marca--real', real, textoAno(real), 'escala-marca-real'));
    eje.replaceChildren(...hijos);
  }

  pintar();

  return {
    arrastrar(ano) {
      if (!Number.isFinite(ano)) return;
      estimacion = ano;
      const centro = (ref.valor + ano) / 2;
      actual = ventanaLinea(centro, zoomParaDistancia(ano - ref.valor));
      pintar();
    },
    revelar(ano) {
      if (!Number.isFinite(ano)) return;
      real = ano;
      const extremos = [ref.valor, estimacion ?? ref.valor, ano];
      const centro = (Math.min(...extremos) + Math.max(...extremos)) / 2;
      actual = ventanaLinea(centro, zoomParaDistancia(Math.max(...extremos) - Math.min(...extremos)));
      pintar();
    },
    ventana: () => ({ ...actual }),
    destruir() {
      banda.remove();
    },
  };
}
