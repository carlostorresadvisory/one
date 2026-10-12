// ONE · mochila.js — núcleo puro de la mochila y de la Tienda (spec v0.3 §6): objetos, cofre de la Tienda y títulos.
// Precios en UNA sola tabla (esta) para retocarlos. La mochila v2 añade `titulos` y `titulo` (el equipado) y lee la v1
// sin perder nada.

export const OBJETOS = Object.freeze({
  cincuenta: Object.freeze({
    id: 'cincuenta', nombre: '50/50', icono: '✂️', precio: 300, rareza: 'raro', descripcion: 'Quita 2 respuestas malas de un test',
    modos: Object.freeze(['clasico', 'repaso', 'ordago', 'contrarreloj']),
  }),
  salvavidas: Object.freeze({
    id: 'salvavidas', nombre: 'Salvavidas', icono: '🛟', precio: 500, rareza: 'epico', descripcion: 'Perdona un fallo: no cuenta',
    modos: Object.freeze(['clasico', 'repaso', 'ordago', 'masomenos', 'contrarreloj']),
  }),
  mas5: Object.freeze({
    id: 'mas5', nombre: '+5 s', icono: '⏱️', precio: 200, rareza: 'comun', descripcion: 'Suma 5 segundos en Contrarreloj',
    modos: Object.freeze(['contrarreloj']),
  }),
  // Cambia la pregunta en curso por otra sin registrar nada; en Órdago, solo antes de elegir ficha.
  saltar: Object.freeze({
    id: 'saltar', nombre: 'Saltar', icono: '⏭️', precio: 250, rareza: 'comun', descripcion: 'Cambia la pregunta por otra',
    modos: Object.freeze(['clasico', 'repaso', 'ordago', 'contrarreloj']),
  }),
  // Se arma antes de responder; si fallas un test4, tachas la opción y eliges otra vez (el radar anota el fallo).
  segunda: Object.freeze({
    id: 'segunda', nombre: 'Segunda oportunidad', icono: '🔁', precio: 400, rareza: 'raro', descripcion: 'Si fallas un test, eliges otra vez',
    modos: Object.freeze(['clasico', 'repaso', 'contrarreloj']),
  }),
  // Pasivo (sin modos: no va en la barra). Salva la racha de días: 1 escudo por día sin jugar (motor.js#actualizarRacha).
  escudo: Object.freeze({
    id: 'escudo', nombre: 'Escudo de racha', icono: '🧊', precio: 600, rareza: 'raro', descripcion: 'Salva tu racha 1 día sin jugar (máx. 2)',
    modos: Object.freeze([]),
  }),
});

/** El cofre de la Tienda no se guarda: se abre al comprarlo y da un objeto con las probabilidades de PROBABILIDADES_COFRE.tienda. */
export const COFRE_TIENDA = Object.freeze({ id: 'cofre', nombre: 'Cofre', icono: '🏺', precio: 250, rareza: 'comun' });

/** Títulos: se compran una vez, no se venden y uno equipado se ve bajo «Tienda» en el hub. Leyenda es el único dorado. */
export const TITULOS = Object.freeze([
  Object.freeze({ id: 'aprendiz', nombre: 'Aprendiz', icono: '📜', precio: 150, rareza: 'comun' }),
  Object.freeze({ id: 'curioso', nombre: 'Curioso', icono: '📜', precio: 300, rareza: 'comun' }),
  Object.freeze({ id: 'erudito', nombre: 'Erudito', icono: '📜', precio: 500, rareza: 'raro' }),
  Object.freeze({ id: 'oraculo', nombre: 'Oráculo', icono: '📜', precio: 750, rareza: 'raro' }),
  Object.freeze({ id: 'leyenda', nombre: 'Leyenda', icono: '📜', precio: 1000, rareza: 'epico' }),
]);

export const PROBABILIDADES_COFRE = Object.freeze({
  normal: Object.freeze([['mas5', 0.45], ['cincuenta', 0.35], ['salvavidas', 0.2]]),
  doble: Object.freeze([['mas5', 0.3], ['cincuenta', 0.35], ['salvavidas', 0.35]]),
  // Cofre comprado en la Tienda: valor esperado ≈ 292 > 250, así que no es una trampa. Los cofres de partida no cambian.
  tienda: Object.freeze([['mas5', 0.3], ['saltar', 0.25], ['cincuenta', 0.2], ['segunda', 0.15], ['salvavidas', 0.1]]),
});

export const CLAVE_MOCHILA = 'one.mochila';
const MAX_POR_OBJETO = 9999;
export const MAX_ESCUDOS = 2;
const tope = (id) => (id === 'escudo' ? MAX_ESCUDOS : MAX_POR_OBJETO);
const esTitulo = (id) => typeof id === 'string' && TITULOS.some((t) => t.id === id);

export function crearMochila() {
  const objetos = {};
  for (const id of Object.keys(OBJETOS)) objetos[id] = 0;
  return { version: 2, objetos, titulos: [], titulo: null };
}

/** Lee una mochila v1 o v2 (de la v1 solo faltan `titulos` y los objetos nuevos, que empiezan en 0); descarta lo inválido. */
export function normalizarMochila(obj) {
  const mochila = crearMochila();
  if (!obj || typeof obj !== 'object' || !obj.objetos || typeof obj.objetos !== 'object') return mochila;
  for (const id of Object.keys(mochila.objetos)) {
    const n = obj.objetos[id];
    if (Number.isInteger(n) && n >= 0 && n <= MAX_POR_OBJETO) mochila.objetos[id] = Math.min(n, tope(id));
  }
  if (Array.isArray(obj.titulos)) mochila.titulos = TITULOS.map((t) => t.id).filter((id) => obj.titulos.includes(id));
  if (esTitulo(obj.titulo) && mochila.titulos.includes(obj.titulo)) mochila.titulo = obj.titulo;
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
  nueva.objetos[id] = Math.min(tope(id), nueva.objetos[id] + n);
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

/** Compra con el fondo de Órdago: nunca lo deja negativo ni cambia nada si no llega. Con 2 escudos ya no se compra otro (`tope`). */
export function comprar(mochila, fondo, id) {
  if (!esObjeto(id)) return { ok: false, motivo: 'objeto-desconocido' };
  const { precio } = OBJETOS[id];
  if (normalizarMochila(mochila).objetos[id] >= tope(id)) return { ok: false, motivo: 'tope' };
  if (!(fondo >= precio)) return { ok: false, motivo: 'sin-fondos' };
  return { ok: true, mochila: anadirObjeto(mochila, id), fondo: fondo - precio };
}

/** Cofre de la Tienda: cobra su precio y el objeto sorteado entra en la mochila (el cofre no se guarda). `rng` inyectable. */
export function comprarCofre(mochila, fondo, rng = Math.random) {
  if (!(fondo >= COFRE_TIENDA.precio)) return { ok: false, motivo: 'sin-fondos' };
  const objeto = sortearObjeto(rng, 'tienda');
  return { ok: true, mochila: anadirObjeto(mochila, objeto), fondo: fondo - COFRE_TIENDA.precio, objeto };
}

/** Compra un título (una vez en la vida, no se vende). No lo equipa: eso lo hace `equiparTitulo`. */
export function comprarTitulo(mochila, fondo, id) {
  if (!esTitulo(id)) return { ok: false, motivo: 'titulo-desconocido' };
  const actual = normalizarMochila(mochila);
  if (actual.titulos.includes(id)) return { ok: false, motivo: 'ya-lo-tienes' };
  const { precio } = TITULOS.find((t) => t.id === id);
  if (!(fondo >= precio)) return { ok: false, motivo: 'sin-fondos' };
  return { ok: true, mochila: normalizarMochila({ ...actual, titulos: [...actual.titulos, id] }), fondo: fondo - precio };
}

/** Equipa un título ya comprado (el anterior sigue siendo tuyo). */
export function equiparTitulo(mochila, id) {
  const actual = normalizarMochila(mochila);
  if (!esTitulo(id) || !actual.titulos.includes(id)) return { ok: false, motivo: 'no-lo-tienes' };
  return { ok: true, mochila: { ...actual, titulo: id } };
}

/** Vende uno por el 50 % del precio (redondeado hacia abajo), que se suma al fondo. */
export function vender(mochila, fondo, id) {
  const actual = normalizarMochila(mochila);
  if (!esObjeto(id) || actual.objetos[id] < 1) return { ok: false, motivo: 'no-tienes' };
  actual.objetos[id] -= 1;
  return { ok: true, mochila: actual, fondo: fondo + Math.floor(OBJETOS[id].precio / 2) };
}

/** ¿Se puede usar ahora? Lo tienes, el modo lo admite, no hay otro igual en esta pregunta y el 50/50 y la Segunda
 * oportunidad solo valen en test4 (con dos opciones, en V/F o cifras, regalaría el acierto). */
export function puedeUsar(mochila, id, { modo, tipoPregunta, usadosEnPregunta = [] } = {}) {
  if (!esObjeto(id) || normalizarMochila(mochila).objetos[id] < 1) return false;
  if (!OBJETOS[id].modos.includes(modo) || usadosEnPregunta.includes(id)) return false;
  return (id !== 'cincuenta' && id !== 'segunda') || tipoPregunta === 'test4';
}

/** Gasta uno (nunca baja de 0). */
export function usar(mochila, id) {
  const actual = normalizarMochila(mochila);
  if (esObjeto(id)) actual.objetos[id] = Math.max(0, actual.objetos[id] - 1);
  return actual;
}
