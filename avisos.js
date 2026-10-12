// Avisos del iPhone (v0.3.4 objetivo C): notificación Web Push cuando una tanda de preguntas generadas termina,
// aunque la app esté cerrada. Plan: docs/superpowers/plans/2026-10-12-esfinx-v0.3.4-tandas.md (puntos 7-8).
//
// Reglas (adversarial del plan):
// - iOS solo entrega avisos a la app INSTALADA en la pantalla de inicio (`navigator.standalone`, o
//   `display-mode: standalone`). En Safari normal no se pide permiso: queda una línea explicativa.
// - El permiso se pide dentro del toque en «Generar preguntas» (iOS lo exige) y UNA sola vez: si el jugador dice
//   que no (o cierra el diálogo), se recuerda en `one.avisosPermiso` y no se vuelve a pedir.
// - La notificación lleva la URL del tema (`./?tema=...`); al tocarla, sw.js abre Esfinx y app.js la usa para
//   dejar Clásico con ese filtro (filtroDeUrl).
// Lógica pura + dependencias inyectables (`win`, `almacen`, `pedirClave`, `registrar`): todo se prueba con node:test.
import { normalizarFiltro } from './filtro.js';
import { pedirClaveVapid, registrarSuscripcion } from './sincronizacion.js';

export const CLAVE_AVISOS = 'one.avisosPermiso';
export const TEXTO_INSTALAR = 'Para recibir avisos, añade Esfinx a la pantalla de inicio';
const MAX_URL_TEMA = 1400; // el servidor admite 1500; con más, la notificación abre la app sin tema

/** ¿La app está abierta desde la pantalla de inicio (instalada)? Safari normal: false. */
export function appInstalada(win = globalThis) {
  try {
    if (win.navigator?.standalone === true) return true;
    return Boolean(win.matchMedia?.('(display-mode: standalone)')?.matches);
  } catch (err) {
    return false;
  }
}

/** ¿Este navegador puede recibir Web Push? (En Safari normal de iOS no existen `PushManager` ni `Notification`.) */
export function avisosSoportados(win = globalThis) {
  return Boolean(win.navigator && 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win);
}

function almacenDe(almacen) {
  return almacen ?? globalThis.localStorage;
}

export function permisoRechazado(almacen) {
  try {
    return almacenDe(almacen).getItem(CLAVE_AVISOS) === 'rechazado';
  } catch (err) {
    return false;
  }
}

function recordarRechazo(almacen) {
  try {
    almacenDe(almacen).setItem(CLAVE_AVISOS, 'rechazado');
  } catch (err) {
    /* sin almacenamiento: puede volver a preguntar, el sistema operativo ya no mostrará el diálogo si dijo que no */
  }
}

/** Qué hacer con el permiso al tocar «Generar»: 'pedir' (primera vez, app instalada), 'concedido', o 'nada'. */
export function decisionPermiso({ win = globalThis, almacen } = {}) {
  if (!avisosSoportados(win) || !appInstalada(win)) return 'nada';
  const permiso = win.Notification.permission;
  if (permiso === 'granted') return 'concedido';
  if (permiso === 'default' && !permisoRechazado(almacen)) return 'pedir';
  return 'nada';
}

/** ¿Enseñar «Para recibir avisos, añade Esfinx a la pantalla de inicio»? Solo si no está instalada. */
export function mostrarLineaInstalar(win = globalThis) {
  return !appInstalada(win);
}

/**
 * Paso 1, SÍNCRONO dentro del toque: si toca, abre el diálogo de permiso (iOS solo lo permite desde un gesto).
 * Devuelve una promesa con el permiso final ('granted' | 'denied' | 'default'), o `null` si no hay nada que pedir.
 * Un 'no' (o cerrar el diálogo) se recuerda para no insistir.
 */
export function pedirPermisoSiProcede({ win = globalThis, almacen } = {}) {
  if (decisionPermiso({ win, almacen }) !== 'pedir') return null;
  let promesa;
  try {
    promesa = Promise.resolve(win.Notification.requestPermission());
  } catch (err) {
    return Promise.resolve('denied');
  }
  return promesa
    .then((permiso) => {
      if (permiso !== 'granted') recordarRechazo(almacen);
      return permiso;
    })
    .catch(() => 'denied');
}

/** Clave pública VAPID (base64url) → bytes para `pushManager.subscribe`. */
export function claveAplicacion(base64url) {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const binario = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

function mismaClave(suscripcion, bytes) {
  const guardada = suscripcion?.options?.applicationServerKey;
  if (!guardada) return true; // no se puede comparar: se reutiliza
  const a = new Uint8Array(guardada);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}

/** Crea (o reutiliza) la suscripción de este dispositivo con la clave del servidor. Si quedó una con otra clave, se cambia. */
async function obtenerSuscripcion(win, clavePublica) {
  const registro = await win.navigator.serviceWorker.ready;
  const bytes = claveAplicacion(clavePublica);
  let suscripcion = await registro.pushManager.getSubscription();
  if (suscripcion && !mismaClave(suscripcion, bytes)) {
    await suscripcion.unsubscribe();
    suscripcion = null;
  }
  return suscripcion || registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
}

/**
 * URL que abrirá la notificación: `./?tema=<[area, ruta, etiquetas] en JSON>`. Si no cabe (rutas largas), `./`: la app
 * se abre igual y el aviso grande de dentro lleva a jugar la tanda.
 */
export function urlDeTema(filtro) {
  const f = normalizarFiltro(filtro);
  if (!f.area) return './';
  const url = `./?tema=${encodeURIComponent(JSON.stringify([f.area, f.ruta, f.etiquetas]))}`;
  return url.length > MAX_URL_TEMA ? './' : url;
}

/** Filtro `{area, ruta, etiquetas}` de una URL con `?tema=`; `null` si no hay tema o no es válido. */
export function filtroDeUrl(url, base = 'https://esfinx.invalid/') {
  try {
    const crudo = new URL(url, base).searchParams.get('tema');
    if (!crudo) return null;
    const [area, ruta, etiquetas] = JSON.parse(crudo);
    const filtro = normalizarFiltro({ area, ruta, etiquetas });
    return filtro.area ? filtro : null;
  } catch (err) {
    return null;
  }
}

/**
 * Paso 2, con el id de la tanda ya en la mano: si hay permiso, suscribe este dispositivo y se lo cuenta al servidor
 * junto al id de la tanda, el tema y la URL a abrir. `permisoPendiente` es lo que devolvió `pedirPermisoSiProcede`
 * (o `null`). Nunca lanza; devuelve true si el servidor quedó avisado de este dispositivo.
 */
export async function suscribirParaTanda({
  trabajoId, tema, filtro, permisoPendiente = null, win = globalThis,
  pedirClave = pedirClaveVapid, registrar = registrarSuscripcion,
} = {}) {
  try {
    if (!trabajoId || !avisosSoportados(win) || !appInstalada(win)) return false;
    if (permisoPendiente) await permisoPendiente;
    if (win.Notification.permission !== 'granted') return false;
    const clave = await pedirClave();
    if (!clave) return false;
    const suscripcion = await obtenerSuscripcion(win, clave);
    const datos = typeof suscripcion.toJSON === 'function' ? suscripcion.toJSON() : suscripcion;
    const respuesta = await registrar({ suscripcion: datos, trabajoId, tema, url: urlDeTema(filtro) });
    return Boolean(respuesta && respuesta.ok);
  } catch (err) {
    return false;
  }
}
