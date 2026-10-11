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

// --- Etiquetas de la línea temporal (geometría pura, en píxeles) -------------------------------------------------

export const FILAS_ETIQUETAS = 3; // filas de etiquetas de marca sobre el eje (referencia, estimación y real)
export const SEPARACION_ETIQUETAS = 6; // hueco mínimo entre dos etiquetas de la misma fila
export const MARGEN_ETIQUETA = 10; // lo que una etiqueta puede sobresalir del eje: cabe en el relleno de la banda
const ANCHO_EJE_DEFECTO = 300; // si el eje aún no se puede medir (vista oculta)
const PASOS_ETIQUETA = [1, 2, 5, 10, 20, 50];

/** Ancho aproximado de un texto en píxeles: algo por encima del real, así que dos etiquetas colocadas con él nunca se pisan. */
export const anchoTexto = (texto, px = 12) => Math.ceil(String(texto).length * px * 0.62) + 4;

/** Recorta un texto con «…» hasta que quepa en `maxPx`. */
export function recortarTexto(texto, maxPx, px = 12) {
  const t = String(texto);
  if (anchoTexto(t, px) <= maxPx) return t;
  let n = t.length;
  while (n > 1 && anchoTexto(`${t.slice(0, n)}…`, px) > maxPx) n -= 1;
  return `${t.slice(0, n).trimEnd()}…`;
}

/**
 * De cuántos en cuántos tics va escrito el año para que las etiquetas quepan con su ancho: devuelve `k` (1, 2, 5, 10…);
 * se escribe el año en los múltiplos de `k × paso`.
 */
export function cadaCuantosTics(ventana, anchoEje, px = 11) {
  const anos = ventana.hasta - ventana.desde;
  if (!(anos > 0) || !(anchoEje > 0)) return PASOS_ETIQUETA[PASOS_ETIQUETA.length - 1];
  const porAno = anchoEje / anos;
  const hueco = anchoTexto('3.000 a. C.', px) + 10;
  return PASOS_ETIQUETA.find((k) => k * ventana.paso * porAno >= hueco) ?? PASOS_ETIQUETA[PASOS_ETIQUETA.length - 1];
}

/** Dónde queda el centro de una etiqueta de ancho `ancho` para una marca en `x`: centrada, pero dentro del eje (más el margen). */
export function centrarEnEje(x, ancho, anchoEje) {
  if (ancho >= anchoEje + 2 * MARGEN_ETIQUETA) return anchoEje / 2;
  return Math.min(anchoEje + MARGEN_ETIQUETA - ancho / 2, Math.max(-MARGEN_ETIQUETA + ancho / 2, x));
}

/**
 * Reparte las etiquetas de las marcas (en orden de prioridad) en filas sobre el eje: cada una va en la fila más baja
 * donde no pisa a otra, centrada en su marca pero sin salirse del eje. `etiquetas`: `[{ id, x, ancho }]`.
 * Devuelve `Map<id, { fila, centro }>` (`centro` en px desde el inicio del eje).
 */
export function colocarEtiquetas(etiquetas, anchoEje) {
  const filas = Array.from({ length: FILAS_ETIQUETAS }, () => []);
  const salida = new Map();
  for (const e of etiquetas) {
    const centro = centrarEnEje(e.x, e.ancho, anchoEje);
    const izq = centro - e.ancho / 2 - SEPARACION_ETIQUETAS / 2;
    const der = centro + e.ancho / 2 + SEPARACION_ETIQUETAS / 2;
    let fila = filas.findIndex((ocupadas) => ocupadas.every(([a, b]) => der <= a || izq >= b));
    if (fila < 0) fila = FILAS_ETIQUETAS - 1; // no cabe en ninguna: la última (con tres marcas y tres filas no pasa)
    filas[fila].push([izq, der]);
    salida.set(e.id, { fila, centro });
  }
  return salida;
}

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
 * `estimacion: false` (Comparar, donde nadie ha estimado nada) no pinta el contorno cian de «tu estimación» ni su rastro.
 */
export function montarEscenaFotos(contenedor, { ref, misteriosa, modo = 'alto', colorArea = null, maxPx = 160, formato = null, estimacion = true, documento = contenedor.ownerDocument ?? globalThis.document }) {
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
  if (estimacion) cajaMis.classList.add('escala-caja--estimacion');
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

  // `formato(valor)` (opcional) escribe la cifra en la etiqueta; la de la misteriosa es «?» hasta revelar.
  let valorRevelado = null;
  const etiquetaDe = (cifra, t, valor) => {
    const cifraTexto = formato && valor !== null ? ` · ${valor === undefined ? '?' : formato(valor)}` : '';
    return `${cifra.nombre}${cifraTexto}${t.diminuta ? ` · real: ${miles(t.veces)} veces más pequeña` : ''}`;
  };

  function pintar(valorMis) {
    const t = tamanosFotos({ ref: ref.valor, valor: valorMis, modo, maxPx });
    ponerTamano(cajaRef, t.ref.px, modo, anchoCaja);
    ponerTamano(cajaMis, t.valor.px, modo, anchoCaja);
    cajaRef.classList.toggle('escala-caja--diminuta', t.ref.diminuta);
    cajaMis.classList.toggle('escala-caja--diminuta', t.valor.diminuta);
    etiquetaRef.textContent = etiquetaDe(ref, t.ref, ref.valor);
    etiquetaMis.textContent = etiquetaDe(misteriosa, t.valor, valorRevelado ?? undefined);
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
      valorRevelado = valorReal;
      raiz.classList.remove('escala--vivo');
      cajaRef.style.transitionDuration = `${duracionMs}ms`;
      cajaMis.style.transitionDuration = `${duracionMs}ms`;
      // El contorno de la estimación se queda en su escala nueva (la de la comparación real), recortado a maxPx.
      if (estimacion) {
        const grande = Math.max(medidaDe(modo, ref.valor), medidaDe(modo, valorReal));
        const pxEstimacion = Math.min(maxPx, Math.max(ALTO_MINIMO_PX, grande > 0 ? (maxPx * medidaDe(modo, ultimaEstimacion)) / grande : ALTO_MINIMO_PX));
        fantasma = crear(documento, 'div', 'escala-fantasma');
        fantasma.setAttribute('data-test', 'escala-fantasma');
        ponerTamano(fantasma, redondear(pxEstimacion), modo, anchoCaja);
        itemMis.appendChild(fantasma);
      }
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

  // Las etiquetas se colocan con el ancho medido del eje: pocas marcas con año escrito (las que caben), las de las
  // marcas en filas distintas cuando chocan, y todas dentro de la banda. Si cambia el tamaño, se vuelve a pintar.
  function pintar() {
    const anchoEje = eje.clientWidth > 0 ? eje.clientWidth : ANCHO_EJE_DEFECTO;
    const aPx = (ano) => posicionEnLinea(ano, actual) * anchoEje;
    const hijos = [];
    const k = cadaCuantosTics(actual, anchoEje);
    const primera = Math.ceil(actual.desde / actual.paso) * actual.paso;
    for (let a = primera; a <= actual.hasta; a += actual.paso) {
      const conAno = a % (k * actual.paso) === 0;
      const t = crear(documento, 'div', conAno ? 'escala-tic escala-tic--grande' : 'escala-tic');
      t.style.left = `${(posicionEnLinea(a, actual) * 100).toFixed(2)}%`;
      if (conAno) {
        const texto = textoAno(a);
        const marcaAno = crear(documento, 'span', 'escala-tic-texto', texto);
        marcaAno.style.left = `${centrarEnEje(aPx(a), anchoTexto(texto, 11), anchoEje) - aPx(a)}px`;
        t.appendChild(marcaAno);
      }
      hijos.push(t);
    }
    const marcas = [
      { clase: 'escala-marca--ref', ano: ref.valor, texto: recortarTexto(`${ref.nombre} · ${textoAno(ref.valor)}`, anchoEje * 0.8), test: 'escala-marca-ref' },
      ...(estimacion !== null ? [{ clase: 'escala-marca--estimacion', ano: estimacion, texto: `? · ${textoAno(estimacion)}`, test: 'escala-marca-estimacion' }] : []),
      ...(real !== null ? [{ clase: 'escala-marca--real', ano: real, texto: textoAno(real), test: 'escala-marca-real' }] : []),
    ];
    const sitio = colocarEtiquetas(marcas.map((m) => ({ id: m.test, x: aPx(m.ano), ancho: anchoTexto(m.texto, 12) })), anchoEje);
    for (const m of marcas) {
      const nodo = crear(documento, 'div', `escala-marca ${m.clase}`);
      nodo.style.left = `${(posicionEnLinea(m.ano, actual) * 100).toFixed(2)}%`;
      nodo.setAttribute('data-test', m.test);
      const texto = crear(documento, 'span', 'escala-marca-texto', m.texto);
      const { fila, centro } = sitio.get(m.test);
      texto.style.left = `${centro - aPx(m.ano)}px`;
      texto.style.bottom = `${18 + 17 * fila}px`;
      nodo.appendChild(texto);
      hijos.push(nodo);
    }
    eje.replaceChildren(...hijos);
  }

  pintar();
  const Observador = documento.defaultView?.ResizeObserver;
  const observador = Observador ? new Observador(() => pintar()) : null;
  observador?.observe(eje);

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
      observador?.disconnect();
      banda.remove();
    },
  };
}
