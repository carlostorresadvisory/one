// Avisos Web Push del servidor (v0.3.4 objetivo C): cuando una tanda urgente termina, el iPhone (o el
// navegador) recibe «Preguntas listas · Roma · 100 ▶» aunque la app esté cerrada.
// Plan: docs/superpowers/plans/2026-10-12-esfinx-v0.3.4-tandas.md (puntos 7-8).
//
// - Las claves VAPID llegan por entorno (VAPID_PUBLICA, VAPID_PRIVADA, VAPID_CONTACTO; ver
//   tools/generar-vapid.js): NUNCA van en el repo. Sin ellas el servidor funciona igual y no envía nada.
// - El envío real (`web-push`, npm) se inyecta como `enviar(suscripcion, texto)`: así los tests no tocan la
//   red y el módulo no obliga a tener `web-push` instalado.
// - Las suscripciones viven en <RUTA_DATOS>/suscripciones.json, una por `endpoint` (= por dispositivo), con
//   tope; se borra la que el servicio de push da por muerta (404/410).
// - El aviso solo va a los dispositivos que se suscribieron CON el id de ese trabajo (cola.js): quien pide una
//   tanda recibe el aviso de SU tanda, no el de las demás.

export const MAX_SUSCRIPCIONES = 50;
const MAX_ENDPOINT = 600;
const MAX_CLAVE = 200;
export const MAX_TEMA = 60;
export const MAX_URL_AVISO = 1500;
// eslint-disable-next-line no-control-regex -- a propósito: se rechazan caracteres de control.
const CARACTER_CONTROL = /[\x00-\x1f\x7f]/;
const BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;

// El endpoint lo manda el cliente y el servidor le hace un POST: solo se admiten los servicios de push de
// los navegadores (Apple, Google, Mozilla, Microsoft), nunca una URL cualquiera (SSRF).
const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

/** `{endpoint, keys: {p256dh, auth}}` en la forma que da `PushSubscription.toJSON()`, o `null` si no vale. */
export function normalizarSuscripcion(crudo) {
  if (!crudo || typeof crudo !== 'object') return null;
  const { endpoint, keys } = crudo;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !HOSTS_PUSH.some((patron) => patron.test(url.hostname))) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  const clavesOk = [keys.p256dh, keys.auth].every((k) => k.length > 0 && k.length <= MAX_CLAVE && BASE64_URL.test(k));
  if (!clavesOk) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Texto del tema para la notificación: una cadena corta sin caracteres de control; vacía si no vale. */
export function normalizarTema(tema) {
  if (typeof tema !== 'string' || CARACTER_CONTROL.test(tema)) return '';
  return tema.trim().slice(0, MAX_TEMA);
}

/** URL a abrir al tocar el aviso: relativa al alcance de la app (`./` o `./?tema=...`); si no vale, `./`. */
export function normalizarUrlAviso(url) {
  if (typeof url !== 'string' || url.length > MAX_URL_AVISO || CARACTER_CONTROL.test(url) || /\s/.test(url)) return './';
  return /^\.\/(\?[^#]*)?$/.test(url) ? url : './';
}

/**
 * @param {object} params
 * @param {ReturnType<import('./almacen.js').crearAlmacen>} params.almacen
 * @param {string} [params.vapidPublica] clave pública VAPID (base64url); sin ella (o sin `enviar`) no hay avisos.
 * @param {(suscripcion: object, texto: string) => Promise<unknown>} [params.enviar] envío real (web-push) o simulado.
 * @param {number} [params.maxSuscripciones]
 */
export function crearPush({ almacen, vapidPublica = '', enviar = null, maxSuscripciones = MAX_SUSCRIPCIONES } = {}) {
  if (!almacen) throw new Error('crearPush: falta almacen');
  const activo = Boolean(vapidPublica) && typeof enviar === 'function';

  /** Guarda (o refresca) la suscripción de un dispositivo; con el tope lleno desaloja la más antigua. */
  async function suscribir(crudo) {
    const suscripcion = normalizarSuscripcion(crudo);
    if (!suscripcion) return null;
    await almacen.conCerrojo('suscripciones.json', async () => {
      const todas = await almacen.leerSuscripciones();
      todas[suscripcion.endpoint] = { subscription: suscripcion, creada: new Date().toISOString() };
      const claves = Object.keys(todas);
      if (claves.length > maxSuscripciones) {
        claves.sort((a, b) => String(todas[a].creada).localeCompare(String(todas[b].creada)));
        for (const clave of claves.slice(0, claves.length - maxSuscripciones)) delete todas[clave];
      }
      await almacen.guardarSuscripciones(todas);
    });
    return suscripcion.endpoint;
  }

  async function olvidar(endpoint) {
    await almacen.conCerrojo('suscripciones.json', async () => {
      const todas = await almacen.leerSuscripciones();
      if (!(endpoint in todas)) return;
      delete todas[endpoint];
      await almacen.guardarSuscripciones(todas);
    });
  }

  /**
   * Manda «Preguntas listas · <tema> · N ▶» a cada endpoint dado. Un fallo de un dispositivo no afecta a los
   * demás; 404/410 del servicio de push = suscripción muerta, se borra. Devuelve cuántos envíos salieron bien.
   */
  async function avisarTanda({ endpoints, tema, n, url, etiqueta }) {
    if (!activo || !Array.isArray(endpoints) || endpoints.length === 0) return 0;
    const todas = await almacen.leerSuscripciones();
    const nombre = normalizarTema(tema) || 'tu tema';
    const texto = JSON.stringify({
      titulo: `Preguntas listas · ${nombre} · ${n} ▶`,
      cuerpo: 'Toca para jugarlas',
      url: normalizarUrlAviso(url),
      etiqueta: typeof etiqueta === 'string' ? etiqueta.slice(0, 80) : 'esfinx-tanda',
    });
    let enviados = 0;
    for (const endpoint of endpoints) {
      const guardada = todas[endpoint];
      if (!guardada) continue;
      try {
        await enviar(guardada.subscription, texto);
        enviados += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await olvidar(endpoint).catch(() => {});
        } else {
          console.error(`servidor/push: no se pudo avisar a un dispositivo (${err?.statusCode || err?.message || err})`);
        }
      }
    }
    return enviados;
  }

  return { activo, vapidPublica, suscribir, avisarTanda };
}

/**
 * Envío real con `web-push` (import perezoso: si el paquete no está o las claves no valen, devuelve `null` y el
 * servidor sigue sin avisos). `contacto` es el `mailto:`/https que exige VAPID para que el servicio de push sepa
 * a quién escribir si algo va mal.
 */
export async function crearEnvioReal({ vapidPublica, vapidPrivada, contacto }) {
  if (!vapidPublica || !vapidPrivada) return null;
  try {
    const modulo = await import('web-push');
    const webpush = modulo.default || modulo;
    webpush.setVapidDetails(contacto, vapidPublica, vapidPrivada);
    return (suscripcion, texto) => webpush.sendNotification(suscripcion, texto, { TTL: 24 * 60 * 60, urgency: 'normal', timeout: 15000 });
  } catch (err) {
    console.error(`servidor/push: avisos desactivados (${err?.message || err})`);
    return null;
  }
}
