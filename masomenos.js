// ONE · masomenos.js — reglas puras de Más o menos (spec v0.3 §5.3 y §5.3.1): qué parejas de cifras se
// pueden comparar, cómo se evalúa Comparar, la racha y el premio cada 10, y la escala, la calificación y la
// racha de Afinar. Sin DOM ni red; la pantalla (masomenos-ui.js) solo traduce toques a estas funciones.
// Las cifras de Más o menos NO son preguntas del banco: nada de esto toca el radar.

export const RAZON_MAX = 4; // Comparar: la cifra mayor no pasa de ×4 la menor (spec §4: que no se resuelva a simple vista)
export const ANOS_MAX = 300; // Comparar con fechas: a lo sumo 300 años de diferencia
export const DIF_MIN = 0.05; // diferencia mínima del 5 % (o fechas distintas)
export const RANGO_AFINAR = 20; // Afinar: la barra va de 1/20 a 20 veces la referencia
export const ANOS_BARRA = 2000; // Afinar con fechas: ± 2.000 años
export const ANO_MIN = -3000;
export const ANO_MAX = 2026;
export const PREMIO_CADA = 10;
export const CLAVE_MASOMENOS = 'one.masomenos';
const MAX_RACHA = 99999;

/**
 * Cómo se dibuja cada categoría. `escala`: de la barra de Afinar; `foto`: cómo se escalan las fotos
 * (`alto` = el alto es proporcional a la cifra, `area` = el lado ∝ √cifra, `linea` = línea temporal);
 * `esFecha`: son años. `tope` (🔶 Provisional): máximo de la barra lineal; la spec pide de 1/20 a 20 veces la
 * referencia, pero 20 veces el Everest (177 km) o un rascacielos (16 km) no existen y dejaban 1.000 m
 * pegado al extremo izquierdo de una barra lineal: se recorta a lo que hay de verdad en la categoría.
 * El PIB se trata como magnitud de área (🔶 Provisional: la spec no dice cómo dibujar dinero a escala).
 */
export const CATEGORIAS = Object.freeze({
  'altitud-montana': Object.freeze({ escala: 'lin', foto: 'alto', esFecha: false, tope: 10000, area: 'geografia', unidad: 'm', minValor: 4000, maxValor: 9000 }),
  'altura-edificio': Object.freeze({ escala: 'lin', foto: 'alto', esFecha: false, tope: 1000, area: 'arte', unidad: 'm', minValor: 150, maxValor: 1000 }),
  'longitud-rio': Object.freeze({ escala: 'log', foto: 'alto', esFecha: false, area: 'geografia', unidad: 'km', minValor: 1000, maxValor: 8000 }),
  'poblacion-pais': Object.freeze({ escala: 'log', foto: 'area', esFecha: false, area: 'geografia', unidad: 'personas', minValor: 1, maxValor: 2e9 }),
  'poblacion-ciudad': Object.freeze({ escala: 'log', foto: 'area', esFecha: false, area: 'geografia', unidad: 'personas', minValor: 1e6, maxValor: 5e7 }),
  'superficie-pais': Object.freeze({ escala: 'log', foto: 'area', esFecha: false, area: 'geografia', unidad: 'km²', minValor: 1, maxValor: 2e7 }),
  'pib-pais': Object.freeze({ escala: 'log', foto: 'area', esFecha: false, area: 'economia', unidad: 'US$', minValor: 1, maxValor: 1e14 }),
  'ano-obra': Object.freeze({ escala: 'lin', foto: 'linea', esFecha: true, area: 'arte', unidad: 'año' }),
  'ano-hecho': Object.freeze({ escala: 'lin', foto: 'linea', esFecha: true, area: 'historia', unidad: 'año' }),
});

export const esFecha = (categoria) => CATEGORIAS[categoria]?.esFecha === true;

// --- Validación del banco (la usan tools/construir-cifras.js al construir y app.js al cargar) -------------------

export const MIN_CIFRAS_JUGABLES = 8; // con menos cifras válidas el modo avisa como si no hubiera banco

/**
 * ¿Es una cifra de producción? Categoría conocida con su área y su unidad, id y nombre reales (no un «Q513»
 * sin etiqueta), valor finito dentro del rango de su categoría (años: enteros entre −3000 y 2026; el resto, > 0)
 * y fuente https. Los años a. C. son negativos y sin año cero: 480 a. C. = −480.
 */
export function validarCifra(c) {
  if (!c || typeof c !== 'object') return false;
  const cat = CATEGORIAS[c.categoria];
  if (!cat || typeof c.id !== 'string' || !c.id) return false;
  if (typeof c.nombre !== 'string' || c.nombre.trim().length < 2 || c.nombre.length > 80 || /^Q\d+$/.test(c.nombre)) return false;
  if (c.area !== cat.area || c.unidad !== cat.unidad || !Number.isFinite(c.valor)) return false;
  if (cat.esFecha) {
    if (!Number.isInteger(c.valor) || c.valor < ANO_MIN || c.valor > ANO_MAX) return false;
  } else if (!(c.valor > 0) || c.valor < cat.minValor || c.valor > cat.maxValor) {
    return false;
  }
  return typeof c.fuente === 'string' && /^https:\/\//.test(c.fuente);
}

/** Las cifras válidas de una lista, sin repetir id ni nombre dentro de su categoría. */
export function validarBanco(lista) {
  const ids = new Set();
  const nombres = new Set();
  const salida = [];
  for (const c of Array.isArray(lista) ? lista : []) {
    if (!validarCifra(c)) continue;
    const nombre = `${c.categoria}|${c.nombre.trim().toLowerCase()}`;
    if (ids.has(c.id) || nombres.has(nombre)) continue;
    ids.add(c.id);
    nombres.add(nombre);
    salida.push(c);
  }
  return salida;
}

// --- Parejas ------------------------------------------------------------------------------------------------

/**
 * ¿Se pueden poner frente a frente? Misma categoría y unidad (misma forma de medir), cifras distintas con
 * ≥ 5 % de diferencia. Comparar: razón ≤ ×4 (fechas: ≤ 300 años). Afinar: lo que quepa en la barra
 * (1/20 ≤ razón ≤ 20; fechas ± 2.000 años), porque allí la foto pequeña se dibuja a 12 px con su etiqueta.
 */
export function sonComparables(a, b, { variante = 'comparar' } = {}) {
  if (!a || !b || a === b || a.id === b.id) return false;
  if (a.categoria !== b.categoria || a.unidad !== b.unidad || !CATEGORIAS[a.categoria]) return false;
  const x = a.valor;
  const y = b.valor;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return false;
  if (esFecha(a.categoria)) return Math.abs(x - y) <= (variante === 'afinar' ? ANOS_BARRA : ANOS_MAX);
  if (x <= 0 || y <= 0) return false;
  const max = Math.max(x, y);
  const min = Math.min(x, y);
  if ((max - min) / max < DIF_MIN) return false;
  return max / min <= (variante === 'afinar' ? RANGO_AFINAR : RAZON_MAX);
}

function barajar(lista, rng) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Una pareja `[arriba, abajo]`. Con `arriba` (la que sube tras un acierto) solo se busca `abajo`; sin ella se
 * elige primero la categoría y luego la pareja, para que ninguna categoría con muchas cifras se coma el
 * modo. `area` limita a un área; `excluir` son ids vistos hace poco (se evitan si hay alternativa).
 * `null` si no hay ninguna pareja comparable (aviso + volver a TODOS).
 */
export function elegirPareja(cifras, { area = null, arriba = null, variante = 'comparar', rng = Math.random, excluir = [] } = {}) {
  const vistas = new Set(excluir);
  const lista = (Array.isArray(cifras) ? cifras : []).filter((c) => (!area || c.area === area) && CATEGORIAS[c.categoria]);
  const parejaCon = (cima, candidatas) => {
    const posibles = candidatas.filter((c) => sonComparables(cima, c, { variante }));
    const nuevas = posibles.filter((c) => !vistas.has(c.id));
    const elegibles = nuevas.length > 0 ? nuevas : posibles;
    return elegibles.length > 0 ? elegibles[Math.min(elegibles.length - 1, Math.floor(rng() * elegibles.length))] : null;
  };
  if (arriba) {
    const abajo = parejaCon(arriba, lista);
    return abajo ? [arriba, abajo] : null;
  }
  const porCategoria = new Map();
  for (const c of lista) {
    if (!porCategoria.has(c.categoria)) porCategoria.set(c.categoria, []);
    porCategoria.get(c.categoria).push(c);
  }
  for (const categoria of barajar([...porCategoria.keys()], rng)) {
    const delante = barajar(porCategoria.get(categoria), rng);
    // Primero las que no se han visto; si ninguna tiene pareja, cualquiera.
    for (const cima of [...delante.filter((c) => !vistas.has(c.id)), ...delante.filter((c) => vistas.has(c.id))]) {
      const abajo = parejaCon(cima, porCategoria.get(categoria));
      if (abajo) return [cima, abajo];
    }
  }
  return null;
}

/** `eleccion` es lo que dice el jugador de la cifra oculta (`abajo`): `'mas'` = mayor que la de arriba. */
export function evaluarComparar(arriba, abajo, eleccion) {
  if (eleccion !== 'mas' && eleccion !== 'menos') return false;
  return eleccion === 'mas' ? abajo.valor > arriba.valor : abajo.valor < arriba.valor;
}

/** En fechas «Después» = `'mas'` y «Antes» = `'menos'`. */
export function etiquetasBotones(categoria) {
  return esFecha(categoria) ? ['Después', 'Antes'] : ['Más', 'Menos'];
}

// --- Racha, récord y premio ------------------------------------------------------------------------------------

export function crearEstadoMasomenos() {
  return { version: 1, variante: 'comparar', comparar: { racha: 0, record: 0 }, afinar: { racha: 0, record: 0 } };
}

const entero = (n) => (Number.isInteger(n) && n >= 0 && n <= MAX_RACHA ? n : 0); // lo absurdo (1e99, negativos, decimales) vuelve a 0

/** Normaliza un estado cargado (respaldo viejo o manipulado): números absurdos a 0, variante conocida. */
export function normalizarMasomenos(obj) {
  const estado = crearEstadoMasomenos();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return estado;
  if (obj.variante === 'afinar' || obj.variante === 'comparar') estado.variante = obj.variante;
  for (const v of ['comparar', 'afinar']) {
    const parte = obj[v];
    if (parte && typeof parte === 'object') {
      estado[v].racha = entero(parte.racha);
      estado[v].record = Math.max(entero(parte.record), estado[v].racha);
    }
  }
  return estado;
}

/**
 * Aplica un resultado a la racha de la variante. `acierto` sube la racha (y el récord); un fallo la pone a 0,
 * salvo con `salvavidas`, que la mantiene. `premio`: la racha acaba de llegar a 10, 20, 30…
 * No muta el estado recibido.
 */
export function registrarResultado(estado, variante, { acierto, salvavidas = false }) {
  const base = normalizarMasomenos(estado);
  if (variante !== 'comparar' && variante !== 'afinar') return { estado: base, premio: false };
  const actual = base[variante];
  if (acierto) {
    const racha = Math.min(MAX_RACHA, actual.racha + 1);
    base[variante] = { racha, record: Math.max(actual.record, racha) };
    return { estado: base, premio: racha % PREMIO_CADA === 0 };
  }
  if (!salvavidas) base[variante] = { racha: 0, record: actual.record };
  return { estado: base, premio: false };
}

/** Texto del récord para el hub («Récord 12»); sin récord, cadena vacía. */
export function recordTexto(estado) {
  const e = normalizarMasomenos(estado);
  const mejor = Math.max(e.comparar.record, e.afinar.record);
  return mejor > 0 ? `Récord ${mejor}` : '';
}

// --- Afinar ---------------------------------------------------------------------------------------------------

/** La barra de una referencia: `{ tipo: 'log'|'lin', min, max }`. Fechas: ref ± 2.000 años recortado a [−3000, 2026]. */
export function escalaBarra(ref, categoria) {
  const config = CATEGORIAS[categoria];
  const valor = typeof ref === 'number' ? ref : ref?.valor;
  if (!config || !Number.isFinite(valor)) return { tipo: 'lin', min: 0, max: 1 };
  if (config.esFecha) {
    return { tipo: 'lin', min: Math.max(ANO_MIN, valor - ANOS_BARRA), max: Math.min(ANO_MAX, valor + ANOS_BARRA) };
  }
  const min = valor / RANGO_AFINAR;
  const max = config.escala === 'lin' ? Math.min(valor * RANGO_AFINAR, Math.max(config.tope ?? Infinity, valor)) : valor * RANGO_AFINAR;
  return { tipo: config.escala, min, max };
}

const limitar = (t) => Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));

// Una barra sin recorrido (max <= min) o logarítmica con un extremo <= 0 no se puede recorrer: queda en el centro.
const barraValida = (e) => Number.isFinite(e?.min) && Number.isFinite(e?.max) && e.max > e.min && (e.tipo !== 'log' || e.min > 0);

export function valorDesdePosicion(escala, t) {
  if (!barraValida(escala)) return Number.isFinite(escala?.min) ? escala.min : 0;
  const p = limitar(t);
  return escala.tipo === 'log' ? escala.min * (escala.max / escala.min) ** p : escala.min + (escala.max - escala.min) * p;
}

export function posicionDesdeValor(escala, valor) {
  if (!barraValida(escala)) return 0.5;
  if (!Number.isFinite(valor) || (escala.tipo === 'log' && valor <= 0)) return 0; // un valor imposible va al extremo bajo
  const t = escala.tipo === 'log'
    ? Math.log(valor / escala.min) / Math.log(escala.max / escala.min)
    : (valor - escala.min) / (escala.max - escala.min);
  return limitar(t);
}

/** `'clavado'|'muy-cerca'|'cerca'|'lejos'` por error relativo (< 10 / 25 / 50 %); fechas por años (≤ 5 / 15 / 40). */
export function calificar(real, estimado, categoria) {
  if (esFecha(categoria)) {
    const anos = Math.abs(estimado - real);
    if (anos <= 5) return 'clavado';
    if (anos <= 15) return 'muy-cerca';
    return anos <= 40 ? 'cerca' : 'lejos';
  }
  if (!Number.isFinite(real) || !Number.isFinite(estimado)) return 'lejos';
  if (real === 0) return estimado === 0 ? 'clavado' : 'lejos'; // sin referencia no hay error relativo
  const error = Math.abs(estimado - real) / Math.abs(real);
  if (error < 0.1) return 'clavado';
  if (error < 0.25) return 'muy-cerca';
  return error < 0.5 ? 'cerca' : 'lejos';
}

/** La racha de Afinar cuenta «Muy cerca» o mejor. */
export const cuentaParaRacha = (calificacion) => calificacion === 'clavado' || calificacion === 'muy-cerca';

export const TEXTO_CALIFICACION = Object.freeze({ clavado: '¡Clavado!', 'muy-cerca': 'Muy cerca', cerca: 'Cerca', lejos: 'Lejos' });

/** Cifra con separador de miles desde 4 cifras («8.849»), con decimales solo si los trae. */
export function formatearValor(valor, categoria) {
  if (!Number.isFinite(valor)) return '';
  if (esFecha(categoria)) return valor < 0 ? `${Math.abs(Math.round(valor))} a. C.` : String(Math.round(valor));
  const redondo = Math.abs(valor) >= 100 ? Math.round(valor) : Math.round(valor * 10) / 10;
  const [entera, decimal] = String(Math.abs(redondo)).split('.');
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${redondo < 0 ? '−' : ''}${miles}${decimal ? `,${decimal}` : ''}`;
}

const coma = (n) => String(n).replace('.', ',');

/**
 * Con unidad: «8.849 m», «1941», y desde un millón en formato compacto para que la cifra quepa en la tarjeta:
 * «8,98 millones de personas», «17,1 millones de km²», «391.027 millones US$», «29,2 billones US$» (billón = 10¹²,
 * como en español). Tres cifras significativas por debajo de 1.000 millones.
 */
export function valorConUnidad(cifra) {
  if (esFecha(cifra.categoria)) return formatearValor(cifra.valor, cifra.categoria);
  const v = cifra.valor;
  if (Number.isFinite(v) && Math.abs(v) >= 1e6) {
    if (cifra.unidad === 'US$' && Math.abs(v) >= 1e12) return `${coma(Number((v / 1e12).toPrecision(3)))} billones US$`;
    const m = v / 1e6;
    const texto = Math.abs(m) >= 1000 ? formatearValor(Math.round(m), 'x') : coma(Number(m.toPrecision(3)));
    return `${texto} ${texto === '1' ? 'millón' : 'millones'}${cifra.unidad === 'US$' ? '' : ' de'} ${cifra.unidad}`;
  }
  return `${formatearValor(v, cifra.categoria)} ${cifra.unidad}`;
}

// --- Persistencia (con el almacenamiento bloqueado nada lanza; spec §9) ------------------------------------------

let estadoEnMemoria = null;

export function cargarMasomenos(almacen) {
  if (estadoEnMemoria) return normalizarMasomenos(estadoEnMemoria); // la última escritura no llegó al almacén
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(CLAVE_MASOMENOS);
    return crudo ? normalizarMasomenos(JSON.parse(crudo)) : crearEstadoMasomenos();
  } catch {
    return crearEstadoMasomenos();
  }
}

/** true si quedó en el almacenamiento; false si solo en memoria (vale esta sesión). */
export function guardarMasomenos(estado, almacen) {
  const normal = normalizarMasomenos(estado);
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_MASOMENOS, JSON.stringify(normal));
    estadoEnMemoria = null;
    return true;
  } catch {
    estadoEnMemoria = normal;
    return false;
  }
}

/** Solo para los tests: olvida la copia en memoria. */
export function olvidarMemoria() {
  estadoEnMemoria = null;
}
