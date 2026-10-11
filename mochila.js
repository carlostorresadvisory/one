// ONE · mochila.js — núcleo puro de la mochila (spec v0.3 §6). En las fases 1-2 solo hace falta
// guardar objetos ganados (premio de tanda en Clásico) y contarlos (tarjeta Tienda del hub).
// Usar comodines, cofres, tienda (comprar/canjear) llegan en las fases 4 y 6 sobre esta base.
// Precios en UNA sola tabla para retocarlos.

export const OBJETOS = Object.freeze({
  cincuenta: Object.freeze({
    id: 'cincuenta', nombre: '50/50', icono: '✂️', precio: 300, rareza: 'raro',
    modos: Object.freeze(['clasico', 'repaso', 'ordago', 'contrarreloj']),
  }),
  salvavidas: Object.freeze({
    id: 'salvavidas', nombre: 'Salvavidas', icono: '🛟', precio: 500, rareza: 'epico',
    modos: Object.freeze(['clasico', 'repaso', 'ordago', 'masomenos', 'contrarreloj']),
  }),
  mas5: Object.freeze({
    id: 'mas5', nombre: '+5 s', icono: '⏱️', precio: 200, rareza: 'comun',
    modos: Object.freeze(['contrarreloj']),
  }),
});

export const PROBABILIDADES_COFRE = Object.freeze({
  normal: Object.freeze([['mas5', 0.45], ['cincuenta', 0.35], ['salvavidas', 0.2]]),
  doble: Object.freeze([['mas5', 0.3], ['cincuenta', 0.35], ['salvavidas', 0.35]]),
});

export const CLAVE_MOCHILA = 'one.mochila';
const MAX_POR_OBJETO = 9999;

export function crearMochila() {
  return { version: 1, objetos: { cincuenta: 0, salvavidas: 0, mas5: 0 } };
}

export function normalizarMochila(obj) {
  const mochila = crearMochila();
  if (!obj || typeof obj !== 'object' || !obj.objetos || typeof obj.objetos !== 'object') return mochila;
  for (const id of Object.keys(mochila.objetos)) {
    const n = obj.objetos[id];
    if (Number.isInteger(n) && n >= 0 && n <= MAX_POR_OBJETO) mochila.objetos[id] = n;
  }
  return mochila;
}

export function sortearObjeto(rng = Math.random, tipo = 'normal') {
  const tabla = PROBABILIDADES_COFRE[tipo] || PROBABILIDADES_COFRE.normal;
  let resto = rng();
  for (const [id, p] of tabla) {
    if (resto < p) return id;
    resto -= p;
  }
  return tabla[tabla.length - 1][0];
}

export function anadirObjeto(mochila, id, n = 1) {
  if (!Object.prototype.hasOwnProperty.call(OBJETOS, id) || !Number.isInteger(n) || n < 1) return mochila;
  const nueva = normalizarMochila(mochila);
  nueva.objetos[id] = Math.min(MAX_POR_OBJETO, nueva.objetos[id] + n);
  return nueva;
}

export function contarObjetos(mochila) {
  return Object.values(normalizarMochila(mochila).objetos).reduce((suma, n) => suma + n, 0);
}

// Copia en memoria (spec §9): si el almacenamiento está bloqueado o lleno, la mochila vive aquí mientras
// dure la sesión (se pierde al recargar). Solo hay copia desde que una escritura falla hasta que otra tiene éxito.
let mochilaEnMemoria = null;

export function cargarMochila(almacen) {
  if (mochilaEnMemoria) return normalizarMochila(mochilaEnMemoria); // la última escritura no llegó al almacén: esta es la buena
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(CLAVE_MOCHILA);
    return crudo ? normalizarMochila(JSON.parse(crudo)) : crearMochila();
  } catch {
    return crearMochila();
  }
}

/** true si quedó en el almacenamiento; false si solo en memoria (el objeto vale esta sesión). */
export function guardarMochila(mochila, almacen) {
  const normal = normalizarMochila(mochila);
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_MOCHILA, JSON.stringify(normal));
    mochilaEnMemoria = null;
    return true;
  } catch {
    mochilaEnMemoria = normal;
    return false;
  }
}

/** Spec §5.1: terminar una tanda de 10 con 10/10 aciertos en Clásico da 1 objeto (Repaso nunca da premio). */
export function ganaPremioTanda({ respondidas, aciertos }) {
  return respondidas === 10 && aciertos === 10;
}

// --- Tienda y comodines (spec §6, fase 9) ---------------------------------------------------------------------
const esObjeto = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(OBJETOS, id);

/** Compra con el fondo de Órdago: nunca lo deja negativo ni cambia nada si no llega. */
export function comprar(mochila, fondo, id) {
  if (!esObjeto(id)) return { ok: false, motivo: 'objeto-desconocido' };
  const { precio } = OBJETOS[id];
  if (!(fondo >= precio)) return { ok: false, motivo: 'sin-fondos' };
  return { ok: true, mochila: anadirObjeto(mochila, id), fondo: fondo - precio };
}

/** Vende uno por el 50 % del precio (redondeado hacia abajo), que se suma al fondo. */
export function vender(mochila, fondo, id) {
  const actual = normalizarMochila(mochila);
  if (!esObjeto(id) || actual.objetos[id] < 1) return { ok: false, motivo: 'no-tienes' };
  actual.objetos[id] -= 1;
  return { ok: true, mochila: actual, fondo: fondo + Math.floor(OBJETOS[id].precio / 2) };
}

/** ¿Se puede usar ahora? Lo tienes, el modo lo admite, no hay otro igual en esta pregunta y el 50/50 solo vale en test4. */
export function puedeUsar(mochila, id, { modo, tipoPregunta, usadosEnPregunta = [] } = {}) {
  if (!esObjeto(id) || normalizarMochila(mochila).objetos[id] < 1) return false;
  if (!OBJETOS[id].modos.includes(modo) || usadosEnPregunta.includes(id)) return false;
  return id !== 'cincuenta' || tipoPregunta === 'test4';
}

/** Gasta uno (nunca baja de 0). */
export function usar(mochila, id) {
  const actual = normalizarMochila(mochila);
  if (esObjeto(id)) actual.objetos[id] = Math.max(0, actual.objetos[id] - 1);
  return actual;
}
