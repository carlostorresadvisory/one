// ONE · sincronizacion.js — cliente del servidor de generación (Tarea 1 del plan
// v0.2b2-cliente-atomo). Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md
// §4 (Entrega B2) y §3.3 (contrato de la API, servidor/index.js).
//
// Principios (brief de la tarea):
// - Módulo ES sin dependencias, en español, usable tanto desde app.js (navegador) como desde
//   `node --test` (sin red): todo lo que llama a la red recibe `fetchImpl` inyectable (por
//   defecto el `fetch` global, igual convención que tools/openrouter.js#llamar) y nunca lanza —
//   401/404/429/500/503/error de red/timeout devuelven siempre `null`, nunca una excepción.
// - `localStorage`/`history` se leen como globales de pared (bare globals), no como parámetros:
//   en el navegador son los del `window`; en los tests, quien los necesite los define en
//   `globalThis` antes de llamar (mismo patrón que `fetchImpl = fetch`). La única excepción es
//   `guardarConfiguracionDesdeUrl(location)`, que SÍ recibe `location` como parámetro (para poder
//   pasar uno falso en los tests) y usa el `history` global solo para limpiar la URL.
// - Token y URL del servidor viven SOLO en localStorage (`one.servidor`): nunca se registran con
//   console.*, nunca viajan a ningún sitio salvo al propio servidor configurado.
import { resumenProgreso, sumarDias } from './motor.js';

const CLAVE_SERVIDOR = 'one.servidor';
const CLAVE_BANCO_EXTRA = 'one.bancoExtra';
const CLAVE_RUTAS_ATOMO = 'one.rutasAtomo';
const TOPE_BANCO_EXTRA = 2000;
// "Últimos 7 días" (spec §4): ventana de 7 días naturales INCLUYENDO hoy, así que se resta 6.
const DIAS_RUTAS_ATOMO = 7;
// Mismo motivo que tools/openrouter.js#TIMEOUT_MS: una petición colgada no debe bloquear la app
// indefinidamente. 10 s (brief de la tarea) porque aquí el jugador está esperando delante de la
// pantalla, no un proceso de fondo — un valor mucho menor que los 120 s del generador en el VPS.
const TIMEOUT_MS = 10000;

// === Configuración (URL + token del servidor) ====================================================

/**
 * Lee `{url, token}` guardado en `localStorage` (clave `one.servidor`). `null` si no hay nada
 * guardado, si el JSON está corrupto, o si falta alguno de los dos campos — nunca lanza.
 * @returns {{url: string, token: string} | null}
 */
export function leerConfiguracion() {
  try {
    const guardado = localStorage.getItem(CLAVE_SERVIDOR);
    if (!guardado) return null;
    const datos = JSON.parse(guardado);
    if (!datos || typeof datos.url !== 'string' || typeof datos.token !== 'string') return null;
    if (!datos.url || !datos.token) return null;
    return { url: datos.url, token: datos.token };
  } catch {
    return null;
  }
}

/**
 * Lee `?servidor=<url>&token=<token>` de `location.search`; si ambos vienen y `servidor` empieza
 * por `https://`, los guarda en `localStorage` (clave `one.servidor`) y limpia esos dos parámetros
 * de la URL con `history.replaceState` (conserva cualquier otro parámetro y el hash — p. ej. no se
 * come `?test=1` en los e2e). Sin los dos parámetros, o con `servidor` que no sea `https://`, no
 * hace nada (no guarda, no toca la URL) y devuelve `false`.
 * @param {{search: string, pathname: string, hash?: string}} location
 * @returns {boolean} si se guardó una configuración nueva.
 */
export function guardarConfiguracionDesdeUrl(location) {
  const params = new URLSearchParams(location.search);
  const servidor = params.get('servidor');
  const token = params.get('token');
  if (!servidor || !token) return false;
  if (!servidor.startsWith('https://')) return false;

  try {
    localStorage.setItem(CLAVE_SERVIDOR, JSON.stringify({ url: servidor, token }));
  } catch {
    // localStorage llena o no disponible (modo privado, cuota...): no hay nada que limpiar de la
    // URL si la configuración no llegó a guardarse de verdad.
    return false;
  }

  params.delete('servidor');
  params.delete('token');
  const resto = params.toString();
  const urlLimpia = `${location.pathname}${resto ? `?${resto}` : ''}${location.hash || ''}`;
  try {
    history.replaceState(null, '', urlLimpia);
  } catch {
    // Sin `history` real (entorno de test sin ese global, o navegador muy antiguo): la
    // configuración ya quedó guardada, que es lo que de verdad importa para el resto de la app.
  }
  return true;
}

// === Banco extendido (preguntas recibidas del servidor) ===========================================

/**
 * Preguntas del servidor guardadas en `localStorage` (clave `one.bancoExtra`). `[]` si no hay
 * nada guardado o el JSON está corrupto — nunca lanza.
 * @returns {object[]}
 */
export function leerBancoExtra() {
  try {
    const guardado = localStorage.getItem(CLAVE_BANCO_EXTRA);
    if (!guardado) return [];
    const datos = JSON.parse(guardado);
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

// Decisión del implementador (sin fijar en el brief): "más antiguas" no puede leerse de una fecha
// de creación real — `servidor/cola.js#CAMPOS_PUBLICOS_PREGUNTA` nunca manda `creada` al cliente
// (es un campo de gestión interna del colchón, ver ese fichero) — así que se usa el ORDEN del
// propio array como proxy de antigüedad: `fusionarBancoExtra` siempre añade las nuevas al final,
// así que las primeras posiciones son siempre las que llevan más tiempo en `bancoExtra`.
function descartarConsolidadasAntiguas(lista, estado, exceso) {
  const tarjetas = (estado && estado.tarjetas) || {};
  const descartables = lista.filter((p) => {
    const tarjeta = tarjetas[p.id];
    return !!tarjeta && tarjeta.caja === 4 && tarjeta.pendiente !== true;
  });
  const idsADescartar = new Set(descartables.slice(0, exceso).map((p) => p.id));
  if (idsADescartar.size === 0) return lista;
  return lista.filter((p) => !idsADescartar.has(p.id));
}

/**
 * Fusiona `nuevas` (preguntas `srv-` recibidas del servidor) en el banco extendido guardado en
 * `localStorage`, con dedupe por id (ni contra lo ya guardado ni entre las propias `nuevas`).
 * Si el total supera el tope de 2.000, se descartan las consolidadas (caja 4 del Leitner) más
 * antiguas que no estén pendientes — para eso hace falta `estado` (sus `tarjetas`, ver
 * motor.js#registrarRespuesta); si no alcanzan las descartables para bajar del tope, se queda por
 * encima (caso límite documentado, no debería darse en la práctica: 2.000 preguntas son ~7 meses
 * de colchón nocturno a 30/día).
 * Persiste el resultado en `localStorage` (mismo criterio que `guardarEstado` en app.js: si
 * `localStorage` no admite la escritura, se seguiría en memoria la próxima vez que se lea, sin
 * lanzar aquí).
 * @param {object[]} nuevas
 * @param {object} estado
 * @returns {{anadidas: number, total: number}}
 */
export function fusionarBancoExtra(nuevas, estado) {
  const actuales = leerBancoExtra();
  const idsActuales = new Set(actuales.map((p) => p.id));
  const vistos = new Set();
  const aAnadir = (Array.isArray(nuevas) ? nuevas : []).filter((p) => {
    if (!p || typeof p.id !== 'string' || idsActuales.has(p.id) || vistos.has(p.id)) return false;
    vistos.add(p.id);
    return true;
  });

  let combinado = actuales.concat(aAnadir);
  if (combinado.length > TOPE_BANCO_EXTRA) {
    combinado = descartarConsolidadasAntiguas(combinado, estado, combinado.length - TOPE_BANCO_EXTRA);
  }

  try {
    localStorage.setItem(CLAVE_BANCO_EXTRA, JSON.stringify(combinado));
  } catch {
    // Ver comentario de guardarEstado en app.js: localStorage llena o no disponible no debe
    // tumbar la sincronización, se pierde solo la persistencia de esta tanda.
  }

  return { anadidas: aAnadir.length, total: combinado.length };
}

// === Peticiones al servidor =========================================================================

function cabeceras(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Único punto que toca la red: siempre con timeout de 10 s y siempre `null` en vez de lanzar
// (cuerpo no-JSON, HTTP no-ok, red caída, timeout...) — así cada función pública de arriba puede
// limitarse a comprobar `datos === null` sin su propio try/catch repetido.
async function peticionJson(fetchImpl, url, opciones) {
  try {
    const respuesta = await fetchImpl(url, { ...opciones, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!respuesta.ok) return null;
    return await respuesta.json();
  } catch {
    return null;
  }
}

function areasParaServidor(estado, banco, hoy) {
  const resumen = resumenProgreso(estado, banco, hoy);
  const areas = {};
  for (const fila of resumen.porArea) {
    areas[fila.area] = { nivel: fila.nivel, aciertoReciente: fila.aciertoReciente };
  }
  return areas;
}

function leerRutasAtomoRecientes(hoy) {
  let datos;
  try {
    const guardado = localStorage.getItem(CLAVE_RUTAS_ATOMO);
    if (!guardado) return [];
    datos = JSON.parse(guardado);
  } catch {
    return [];
  }
  if (!Array.isArray(datos)) return [];
  const limite = hoy ? sumarDias(hoy, -(DIAS_RUTAS_ATOMO - 1)) : null;
  return datos
    .filter(
      (r) =>
        r &&
        typeof r.area === 'string' &&
        Array.isArray(r.ruta) &&
        (!limite || (typeof r.fecha === 'string' && r.fecha >= limite))
    )
    .map((r) => ({ area: r.area, ruta: r.ruta }));
}

/**
 * "Modo normal" (spec §4): `POST /estado` con el resumen de progreso, los ids `srv-` que el móvil
 * ya conoce y las rutas del átomo de los últimos 7 días. Sin configuración guardada, no hace
 * ninguna petición (devuelve `null` directamente) — silencioso por diseño, la app debe funcionar
 * exactamente igual sin servidor. `null` también ante cualquier error HTTP/red/timeout.
 * @param {{estado: object, banco: object[], hoy: string, fetchImpl?: Function}} params
 * @returns {Promise<{preguntas: object[], enCola: number} | null>}
 */
export async function sincronizarEstado({ estado, banco, hoy, fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion) return null;

  const cuerpo = {
    resumen: {
      areas: areasParaServidor(estado, banco, hoy),
      idsConocidos: leerBancoExtra()
        .map((p) => p.id)
        .filter((id) => typeof id === 'string' && id.startsWith('srv-')),
      rutasAtomo: leerRutasAtomoRecientes(hoy),
    },
  };

  const datos = await peticionJson(fetchImpl, `${configuracion.url}/estado`, {
    method: 'POST',
    headers: cabeceras(configuracion.token),
    body: JSON.stringify(cuerpo),
  });
  if (!datos || !Array.isArray(datos.preguntas)) return null;
  return { preguntas: datos.preguntas, enCola: datos.enCola };
}

/**
 * Botón "Generar" del átomo (spec §4): `POST /generar` siempre `urgente: true` (es la única vía
 * de esta función — la generación de fondo la decide el propio servidor vía `/estado`).
 * @param {{area: string, ruta?: string[], n?: number, fetchImpl?: Function}} params
 * @returns {Promise<{trabajoId: string, estimadoSeg: number} | null>}
 */
export async function pedirTanda({ area, ruta = [], n, fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion || !area) return null;
  const datos = await peticionJson(fetchImpl, `${configuracion.url}/generar`, {
    method: 'POST',
    headers: cabeceras(configuracion.token),
    body: JSON.stringify({ area, ruta, n, urgente: true }),
  });
  if (!datos || typeof datos.trabajoId !== 'string') return null;
  return { trabajoId: datos.trabajoId, estimadoSeg: datos.estimadoSeg };
}

/**
 * `GET /trabajo/:id`: estado de una tanda pedida con `pedirTanda` (el átomo la sondea cada 5 s
 * mientras espera). Devuelve el objeto tal cual lo manda el servidor
 * (`{estado, hechas, pedidas, preguntas, motivo}`) o `null` si no hay configuración, el id no es
 * válido, o cualquier error (404 incluido: un trabajo que ya no existe -- p. ej. tras reiniciar el
 * servidor -- no es distinto de cualquier otro fallo para quien llama).
 * @param {string} id
 * @param {{fetchImpl?: Function}} [opciones]
 * @returns {Promise<object | null>}
 */
export async function consultarTrabajo(id, { fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion || typeof id !== 'string' || !id) return null;
  const datos = await peticionJson(fetchImpl, `${configuracion.url}/trabajo/${encodeURIComponent(id)}`, {
    headers: cabeceras(configuracion.token),
  });
  if (!datos || typeof datos.estado !== 'string') return null;
  return datos;
}

const cacheSubtemas = new Map();

/**
 * `POST /subtemas`: anillos del átomo. Cacheada en memoria por `[area, ruta]` (spec §4: "una sola
 * llamada al modelo por combinación, para siempre" en el servidor -- aquí, para no repetir ni
 * siquiera la llamada HTTP mientras dure la sesión). La caché nunca se llena de fallos: solo se
 * guarda una respuesta buena.
 * @param {{area: string, ruta?: string[], fetchImpl?: Function}} params
 * @returns {Promise<object[] | null>}
 */
export async function pedirSubtemas({ area, ruta = [], fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion || !area) return null;
  const clave = JSON.stringify([area, ruta]);
  if (cacheSubtemas.has(clave)) return cacheSubtemas.get(clave);

  const datos = await peticionJson(fetchImpl, `${configuracion.url}/subtemas`, {
    method: 'POST',
    headers: cabeceras(configuracion.token),
    body: JSON.stringify({ area, ruta }),
  });
  if (!datos || !Array.isArray(datos.subtemas)) return null;
  cacheSubtemas.set(clave, datos.subtemas);
  return datos.subtemas;
}

/**
 * `POST /reportar`: además de anotar localmente en `estado.reportadas` (ver
 * app.js#manejarClicEstaMal), una pregunta `srv-` se reporta también al servidor para que salga
 * del colchón y no se le sirva a nadie más. `null` sin configuración o ante cualquier error (no
 * hay nada más que hacer del lado del cliente: la pregunta ya quedó anotada localmente igual).
 * @param {{id: string, motivo?: string, fetchImpl?: Function}} params
 * @returns {Promise<{ok: boolean} | null>}
 */
export async function reportarAlServidor({ id, motivo, fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion || typeof id !== 'string' || !id) return null;
  return peticionJson(fetchImpl, `${configuracion.url}/reportar`, {
    method: 'POST',
    headers: cabeceras(configuracion.token),
    body: JSON.stringify({ id, motivo }),
  });
}
