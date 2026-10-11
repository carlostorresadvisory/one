// ONE · ordago.js — reglas puras de Órdago (spec v0.3 §5.2): fondo, fichas, multiplicador, salvavidas,
// quiebra, máximo histórico y persistencia. Sin DOM. Órdago no da objetos: lo que se gana es el fondo
// (el dinero de la Tienda). La ficha solo se descuenta al RESOLVER una ronda (`resolverRonda`): elegir
// ficha no toca el estado, así que si iOS mata la app antes de responder, la ronda no existió.

export const FONDO_INICIAL = 1000;
export const PROB_DORADA = 1 / 7;
export const CLAVE_ORDAGO = 'one.ordago';
export const MAX_CURVA = 200;
const MAX_VALOR = 1e12; // tope contra respaldos manipulados y rachas absurdas

export const FICHAS = Object.freeze([
  Object.freeze({ id: '10', pct: 0.1, texto: '10 %' }),
  Object.freeze({ id: '25', pct: 0.25, texto: '25 %' }),
  Object.freeze({ id: '50', pct: 0.5, texto: '50 %' }),
  Object.freeze({ id: 'ordago', pct: 1, texto: 'Órdago' }),
]);

export function crearOrdago() {
  return { version: 1, fondo: FONDO_INICIAL, curva: [FONDO_INICIAL], maximo: FONDO_INICIAL, quiebras: 0, racha: 0 };
}

const esEntero = (n, tope = MAX_VALOR) => Number.isInteger(n) && n >= 0 && n <= tope;

export function normalizarOrdago(obj) {
  const base = crearOrdago();
  if (!obj || typeof obj !== 'object') return base;
  const fondo = esEntero(obj.fondo) ? obj.fondo : base.fondo;
  const curva = Array.isArray(obj.curva) ? obj.curva.filter((n) => esEntero(n)).slice(-MAX_CURVA) : [];
  return {
    version: 1,
    fondo,
    curva: curva.length > 0 ? curva : [fondo],
    maximo: esEntero(obj.maximo) ? obj.maximo : Math.max(base.maximo, fondo), // lo alcanzado jugando: no se fuerza ≥ fondo
    quiebras: esEntero(obj.quiebras, 1e6) ? obj.quiebras : 0,
    racha: esEntero(obj.racha, 1e6) ? obj.racha : 0,
  };
}

export function calcularFicha(fondo, pct) {
  return Math.min(fondo, Math.max(1, Math.floor(fondo * pct)));
}

/** `nivel` es el de la pregunta (fórmula general 1-5; en Órdago la pantalla solo sirve 3-5). */
export function multiplicador({ nivel, dorada, racha }) {
  return (1 + (nivel - 1) * 0.25) * (dorada ? 3 : 1) * (racha >= 3 ? 1.5 : 1);
}

export function esDorada(rng = Math.random) {
  return rng() < PROB_DORADA;
}

/** Lo que se ganaría al acertar con esta ficha (mismo cálculo que `resolverRonda`; la pantalla de fichas lo enseña). */
export function gananciaFicha({ fondo, pct, nivel, dorada, racha }) {
  return Math.floor(calcularFicha(fondo, pct) * multiplicador({ nivel, dorada, racha }));
}

/** Una ronda: devuelve el estado nuevo, el cambio del fondo y si hay nuevo máximo o quiebra. */
export function resolverRonda(estado, { ficha, correcta, nivel, dorada, salvavidas = false }) {
  const actual = normalizarOrdago(estado);
  const apuesta = Math.min(actual.fondo, Math.max(1, Math.floor(Number(ficha)) || 1));
  let delta;
  let racha;
  if (correcta) {
    delta = Math.floor(apuesta * multiplicador({ nivel, dorada, racha: actual.racha }));
    racha = actual.racha + 1;
  } else if (salvavidas) {
    delta = -(apuesta - Math.floor(apuesta / 2));
    racha = actual.racha;
  } else {
    delta = -apuesta;
    racha = 0;
  }
  const fondo = Math.min(MAX_VALOR, Math.max(0, actual.fondo + delta));
  delta = fondo - actual.fondo;
  const nuevoMaximo = fondo > actual.maximo;
  return {
    estado: {
      ...actual,
      fondo,
      racha,
      maximo: nuevoMaximo ? fondo : actual.maximo,
      curva: [...actual.curva, fondo].slice(-MAX_CURVA),
    },
    delta,
    nuevoMaximo,
    quiebra: fondo < 1,
  };
}

/** Tras una quiebra: fondo de 1.000, el máximo histórico se conserva y la quiebra se cuenta. */
export function abrirFondoNuevo(estado) {
  const actual = normalizarOrdago(estado);
  return {
    ...actual,
    fondo: FONDO_INICIAL,
    quiebras: actual.quiebras + 1,
    racha: 0,
    curva: [...actual.curva, FONDO_INICIAL].slice(-MAX_CURVA),
  };
}

/** Estado con otro fondo (compras y ventas de la Tienda): no toca racha, quiebras, máximo ni curva (no son partidas). */
export function conFondo(estado, fondo) {
  const actual = normalizarOrdago(estado);
  const nuevo = Math.min(MAX_VALOR, Math.max(0, Math.trunc(Number(fondo)) || 0));
  if (nuevo === actual.fondo) return actual;
  return { ...actual, fondo: nuevo };
}

// Copia en memoria (spec §9): con el almacenamiento bloqueado o lleno el fondo vive aquí hasta recargar, así la Tienda
// y Órdago ven el mismo dinero durante la sesión.
let ordagoEnMemoria = null;

/** Solo para los tests: olvida la copia en memoria. */
export function olvidarMemoria() {
  ordagoEnMemoria = null;
}

export function cargarOrdago(almacen) {
  if (ordagoEnMemoria) return normalizarOrdago(ordagoEnMemoria); // la última escritura no llegó al almacén
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(CLAVE_ORDAGO);
    return crudo ? normalizarOrdago(JSON.parse(crudo)) : crearOrdago();
  } catch {
    return crearOrdago();
  }
}

export function guardarOrdago(estado, almacen) {
  const normal = normalizarOrdago(estado);
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_ORDAGO, JSON.stringify(normal));
    ordagoEnMemoria = null;
    return true;
  } catch {
    ordagoEnMemoria = normal;
    return false;
  }
}

/** Cifras con punto de miles también de 4 cifras («1.250»); `toLocaleString('es-ES')` las deja pegadas. */
export function formatearCifra(n) {
  const entero = Math.trunc(Number(n));
  if (!Number.isFinite(entero)) return '0';
  return String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/^/, entero < 0 ? '−' : '');
}

/** Siguiente pregunta: entre las `candidatas` (ya filtradas por tema y nivel 3-5) las no usadas en esta
 * sesión, las que aún no se han jugado nunca (`vistas`) primero; agotadas, se repite alguna menos la
 * última. `null` si no hay ninguna. */
export function elegirPreguntaOrdago(candidatas, { usados = new Set(), vistas = new Set(), ultima = null, rng = Math.random } = {}) {
  const libres = candidatas.filter((p) => !usados.has(p.id));
  const base = libres.length > 0 ? libres : candidatas.filter((p) => p.id !== ultima);
  const reserva = base.length > 0 ? base : candidatas;
  const nuevas = reserva.filter((p) => !vistas.has(p.id));
  const lista = nuevas.length > 0 ? nuevas : reserva;
  return lista.length > 0 ? lista[Math.min(lista.length - 1, Math.floor(rng() * lista.length))] : null;
}

/** Puntos de la minicurva (viewBox `ancho`×`alto`, con margen) y la altura del máximo histórico. */
export function puntosMinicurva(curva, maximo, { ancho = 60, alto = 24, margen = 2 } = {}) {
  const base = Array.isArray(curva) && curva.length > 0 ? curva : [0];
  const valores = base.length === 1 ? [base[0], base[0]] : base;
  const techo = Math.max(maximo, ...valores);
  const suelo = Math.min(...valores);
  const rango = techo - suelo || 1;
  const redondear = (n) => Math.round(n * 10) / 10;
  const y = (v) => redondear(alto - margen - ((v - suelo) / rango) * (alto - 2 * margen));
  const paso = ancho / (valores.length - 1);
  return { puntos: valores.map((v, i) => `${redondear(i * paso)},${y(v)}`).join(' '), yMaximo: y(maximo) };
}
