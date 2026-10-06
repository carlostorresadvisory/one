// ONE · mochila.js — núcleo puro de la mochila (spec v0.3 §6). En las fases 1-2 solo hace falta
// guardar objetos ganados (premio de tanda en Clásico) y contarlos (tarjeta Esfinge del hub).
// Usar comodines, cofres, tienda (comprar/canjear) llegan en las fases 4 y 6 sobre esta base.
// Precios en UNA sola tabla para retocarlos.

export const OBJETOS = Object.freeze({
  cincuenta: Object.freeze({
    id: 'cincuenta', nombre: '50/50', icono: '✂️', precio: 300, rareza: 'raro',
    modos: Object.freeze(['clasico', 'repaso', 'apuesta', 'contrarreloj']),
  }),
  salvavidas: Object.freeze({
    id: 'salvavidas', nombre: 'Salvavidas', icono: '🛟', precio: 500, rareza: 'epico',
    modos: Object.freeze(['clasico', 'repaso', 'apuesta', 'masomenos', 'contrarreloj']),
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

export function cargarMochila(almacen = globalThis.localStorage) {
  try {
    const crudo = almacen.getItem(CLAVE_MOCHILA);
    return crudo ? normalizarMochila(JSON.parse(crudo)) : crearMochila();
  } catch {
    return crearMochila();
  }
}

export function guardarMochila(mochila, almacen = globalThis.localStorage) {
  try {
    almacen.setItem(CLAVE_MOCHILA, JSON.stringify(normalizarMochila(mochila)));
    return true;
  } catch {
    return false;
  }
}

/** Spec §5.1: terminar una tanda de 10 con ≥ 8 aciertos da 1 objeto. */
export function ganaPremioTanda({ respondidas, aciertos }) {
  return respondidas === 10 && aciertos >= 8;
}
