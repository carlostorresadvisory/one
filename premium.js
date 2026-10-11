// ONE · premium.js — plan «Esfinx Premium» sin cobro real (spec v0.3.1 §7). Sin DOM. Estado en `one.premium`
// ({activo, desde, ultimaRecarga, bonificado}) y cupo diario del plan gratis en `one.premium.generadas` ({dia, n}).
// Los puntos son el fondo de Órdago (el dinero de la Tienda). Reglas: 1.000 de bienvenida SOLO la primera vez en
// la vida (`bonificado` no vuelve a false); +500 al abrir la app con el plan activo si el mes local ('AAAA-MM',
// comparación de cadenas) es mayor que `ultimaRecarga` (una sola aunque se salten meses; nada si el reloj va atrás).

import { cargarOrdagoResuelto, guardarOrdago, conFondo } from './ordago.js';

export const CLAVE_PREMIUM = 'one.premium';
export const CLAVE_GENERADAS = 'one.premium.generadas';
export const PUNTOS_BIENVENIDA = 1000;
export const PUNTOS_MENSUALES = 500;
export const TANDAS_GRATIS_AL_DIA = 1;
export const PRECIO_MES = '2 €';
export const PRECIO_ANIO = '15 €';

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RE_MES = /^\d{4}-\d{2}$/;

/** Mes ('AAAA-MM') de un día local 'AAAA-MM-DD'. */
export const mesDe = (dia) => String(dia).slice(0, 7);

export function crearPremium() {
  return { activo: false, desde: null, ultimaRecarga: null, bonificado: false };
}

export function normalizarPremium(obj) {
  const base = crearPremium();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return base;
  return {
    activo: obj.activo === true,
    desde: typeof obj.desde === 'string' && RE_DIA.test(obj.desde) ? obj.desde : null,
    ultimaRecarga: typeof obj.ultimaRecarga === 'string' && RE_MES.test(obj.ultimaRecarga) ? obj.ultimaRecarga : null,
    bonificado: obj.bonificado === true,
  };
}

/** Activa el plan en el día local `hoy`. Devuelve `{estado, puntos}`: los 1.000 de bienvenida solo si nunca se dieron. Ya activo: sin cambios. */
export function activar(estado, hoy) {
  const actual = normalizarPremium(estado);
  if (actual.activo) return { estado: actual, puntos: 0 };
  const puntos = actual.bonificado ? 0 : PUNTOS_BIENVENIDA;
  const mes = mesDe(hoy);
  const ultima = actual.ultimaRecarga && actual.ultimaRecarga > mes ? actual.ultimaRecarga : mes; // el mes de activación ya cuenta
  return { estado: { activo: true, desde: hoy, ultimaRecarga: ultima, bonificado: true }, puntos };
}

/** Desactiva (para pruebas). `bonificado` y `ultimaRecarga` se conservan: reactivar no regala más. */
export function desactivar(estado) {
  return { ...normalizarPremium(estado), activo: false };
}

/** +500 si el plan está activo y el mes de `hoy` es posterior a `ultimaRecarga`. Una sola aunque se hayan saltado meses. */
export function recargaMensual(estado, hoy) {
  const actual = normalizarPremium(estado);
  const mes = mesDe(hoy);
  if (!actual.activo || !RE_MES.test(mes) || (actual.ultimaRecarga !== null && mes <= actual.ultimaRecarga)) return { estado: actual, puntos: 0 };
  return { estado: { ...actual, ultimaRecarga: mes }, puntos: PUNTOS_MENSUALES };
}

export function normalizarGeneradas(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { dia: null, n: 0 };
  const n = Number.isInteger(obj.n) && obj.n >= 0 && obj.n <= 1e6 ? obj.n : 0;
  return typeof obj.dia === 'string' && RE_DIA.test(obj.dia) ? { dia: obj.dia, n } : { dia: null, n: 0 };
}

/** ¿Puede lanzar otra tanda? Con Premium siempre; con el plan gratis, 1 por día local (`hoy` se recalcula en cada toque). */
export function puedeGenerar(estado, generadas, hoy) {
  if (normalizarPremium(estado).activo) return true;
  const g = normalizarGeneradas(generadas);
  return g.dia !== hoy || g.n < TANDAS_GRATIS_AL_DIA;
}

/** Cuenta una tanda más hoy (el contador de otro día se reinicia). */
export function contarGenerada(generadas, hoy) {
  const g = normalizarGeneradas(generadas);
  return { dia: hoy, n: g.dia === hoy ? g.n + 1 : 1 };
}

// --- persistencia (almacén inyectable; con el almacenamiento bloqueado vive en memoria hasta recargar) ---

const memoria = { premium: null, generadas: null };

/** Solo para los tests. */
export function olvidarMemoriaPremium() {
  memoria.premium = null;
  memoria.generadas = null;
}

function leer(clave, normalizar, enMemoria, almacen) {
  if (enMemoria) return normalizar(enMemoria);
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(clave);
    return normalizar(crudo ? JSON.parse(crudo) : null);
  } catch {
    return normalizar(null);
  }
}

function escribir(clave, valor, almacen) {
  try {
    (almacen ?? globalThis.localStorage).setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

export const cargarPremium = (almacen) => leer(CLAVE_PREMIUM, normalizarPremium, memoria.premium, almacen);
export const cargarGeneradas = (almacen) => leer(CLAVE_GENERADAS, normalizarGeneradas, memoria.generadas, almacen);

export function guardarPremium(estado, almacen) {
  const normal = normalizarPremium(estado);
  const ok = escribir(CLAVE_PREMIUM, normal, almacen);
  memoria.premium = ok ? null : normal;
  return ok;
}

export function guardarGeneradas(generadas, almacen) {
  const normal = normalizarGeneradas(generadas);
  const ok = escribir(CLAVE_GENERADAS, normal, almacen);
  memoria.generadas = ok ? null : normal;
  return ok;
}

/** Aplica un cambio de plan y sus puntos como una sola operación: si una escritura falla se deshacen las dos. */
function aplicarConPuntos(nuevo, puntos, almacen) {
  const antesPremium = cargarPremium(almacen);
  const antesOrdago = cargarOrdagoResuelto(almacen);
  const premiumOk = guardarPremium(nuevo, almacen);
  const ordagoOk = puntos > 0 ? guardarOrdago(conFondo(antesOrdago, antesOrdago.fondo + puntos), almacen) : true;
  if (premiumOk && ordagoOk) return true;
  guardarPremium(antesPremium, almacen);
  guardarOrdago(antesOrdago, almacen);
  return false;
}

/** Activa el plan hoy y suma los 1.000 de bienvenida si toca. `{ok, puntos}`; un doble toque no suma dos veces. */
export function activarYGuardar(hoy, almacen) {
  const { estado, puntos } = activar(cargarPremium(almacen), hoy);
  if (puntos === 0 && cargarPremium(almacen).activo) return { ok: true, puntos: 0 };
  return { ok: aplicarConPuntos(estado, puntos, almacen), puntos };
}

export function desactivarYGuardar(almacen) {
  return guardarPremium(desactivar(cargarPremium(almacen)), almacen);
}

/** Al abrir la app: la recarga mensual de +500 si toca. Devuelve los puntos sumados (0 si nada). */
export function aplicarRecargaMensual(hoy, almacen) {
  const { estado, puntos } = recargaMensual(cargarPremium(almacen), hoy);
  if (puntos === 0) return 0;
  return aplicarConPuntos(estado, puntos, almacen) ? puntos : 0;
}
