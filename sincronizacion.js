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

// Ronda final de revisión (adversarial A1): `AbortSignal.timeout` no existe en iOS < 16.4 --
// sin este polyfill, `peticionJson` lanzaría "AbortSignal.timeout is not a function" en vez de
// devolver `null`, tumbando la app entera en un iPhone con Safari viejo. Mismo contrato que el
// nativo: un `AbortSignal` que se aborta solo pasados `ms` milisegundos.
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function timeout(ms) {
    const controlador = new AbortController();
    setTimeout(() => controlador.abort(new Error('TimeoutError')), ms);
    return controlador.signal;
  };
}

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
 *
 * Ronda final de revisión (adversarial A6+A13): reutiliza `sanearToken`/`sanearServidor` (las
 * mismas que ya usa `guardarConfiguracionDesdeUrl`) en vez de solo comprobar que sean strings no
 * vacíos -- antes, un `one.servidor` corrupto a mano (o un token de una versión antigua sin el
 * saneado de la Ronda 1) se leía tal cual y viajaba en cada petición futura. Devuelve el `url` ya
 * normalizado a su origin, igual que al guardar.
 * @returns {{url: string, token: string} | null}
 */
export function leerConfiguracion() {
  try {
    const guardado = localStorage.getItem(CLAVE_SERVIDOR);
    if (!guardado) return null;
    const datos = JSON.parse(guardado);
    if (!datos) return null;
    const token = sanearToken(datos.token);
    const origen = sanearServidor(datos.url);
    if (!token || !origen) return null;
    return { url: origen, token };
  } catch {
    return null;
  }
}

// Ronda 1 (revisión, Important #1): sin saneado, un token capturado a medias (con espacios
// alrededor por un copia-pega torpe) o un servidor con ruta/query/hash colgando se guardaban tal
// cual y viajaban en cada petición futura. Límites de longitud (16-128) acordes al token real de
// 32 bytes en hex = 64 caracteres que genera el despliegue (spec §3.5, `openssl rand -hex 32`),
// con margen a ambos lados sin ser tan laxo como para aceptar cualquier cadena corta.
const TOKEN_LONGITUD_MIN = 16;
const TOKEN_LONGITUD_MAX = 128;
// Espacios (cualquiera, incluido tab/salto de línea) y caracteres de control -- mismo criterio que
// RUTA_CARACTER_CONTROL en servidor/index.js.
// eslint-disable-next-line no-control-regex -- a propósito: se rechazan caracteres de control.
const TOKEN_CARACTER_INVALIDO = /[\s\x00-\x1f\x7f]/;

/** `null` si `tokenCrudo` no es un token válido; si no, el propio token ya recortado (trim). */
function sanearToken(tokenCrudo) {
  if (typeof tokenCrudo !== 'string') return null;
  const token = tokenCrudo.trim();
  if (!token) return null; // vacío o solo espacios
  if (TOKEN_CARACTER_INVALIDO.test(token)) return null; // espacio interior o carácter de control
  if (token.length < TOKEN_LONGITUD_MIN || token.length > TOKEN_LONGITUD_MAX) return null;
  return token;
}

/**
 * `null` si `servidorCrudo` no es una URL de servidor válida; si no, su `origin` (sin barra
 * final, sin ruta/query/hash). Válido: `https://` con cualquier host, o `http://localhost` con
 * cualquier puerto (para pruebas locales, spec §3.1 CORS ya trata `http://localhost:8765` como
 * origen legítimo del e2e) — nunca otro esquema ni otro host por `http://`. La ruta debe ser
 * exactamente `/` (o ausente): ni subrutas ni query ni hash, que viajarían sin sentido en cada
 * petición a `${url}/estado`, etc.
 */
function sanearServidor(servidorCrudo) {
  if (typeof servidorCrudo !== 'string' || !servidorCrudo) return null;
  let url;
  try {
    url = new URL(servidorCrudo);
  } catch {
    return null;
  }
  const esquemaValido = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  if (!esquemaValido) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/**
 * Lee `?servidor=<url>&token=<token>` de `location.search`. Sin los dos parámetros presentes, no
 * hace nada (no guarda, no toca la URL) y devuelve `false` — es el caso normal de abrir la app sin
 * ese enlace especial. Con los dos presentes: se sanean (`sanearToken`/`sanearServidor`, Ronda 1 de
 * revisión — Important #1) y, si ambos son válidos, se guardan en `localStorage` (clave
 * `one.servidor`, con `url` ya normalizada a su origin). Se hayan guardado o no, se limpian
 * `servidor`/`token` de la URL con `history.replaceState` (conserva cualquier otro parámetro y el
 * hash — p. ej. no se come `?test=1` en los e2e): un intento de configurar con datos inválidos no
 * debe dejar el token o el host del servidor colgando en el historial del navegador.
 * @param {{search: string, pathname: string, hash?: string}} location
 * @returns {boolean} si se guardó una configuración nueva (válida).
 */
export function guardarConfiguracionDesdeUrl(location) {
  const params = new URLSearchParams(location.search);
  const servidorCrudo = params.get('servidor');
  const tokenCrudo = params.get('token');
  if (!servidorCrudo || !tokenCrudo) return false;

  const token = sanearToken(tokenCrudo);
  const origen = sanearServidor(servidorCrudo);
  let guardado = false;
  if (token && origen) {
    try {
      localStorage.setItem(CLAVE_SERVIDOR, JSON.stringify({ url: origen, token }));
      guardado = true;
    } catch {
      // localStorage llena o no disponible (modo privado, cuota...): no se guardó nada, pero la
      // URL se limpia igual (ver comentario de cabecera de esta función).
      guardado = false;
    }
  }

  params.delete('servidor');
  params.delete('token');
  const resto = params.toString();
  const urlLimpia = `${location.pathname}${resto ? `?${resto}` : ''}${location.hash || ''}`;
  try {
    history.replaceState(null, '', urlLimpia);
  } catch {
    // Ronda final de revisión (adversarial A2): sin `history.replaceState` (navegador muy viejo,
    // o el global no existe), el token/host quedarían colgando en la barra de direcciones -- un
    // riesgo real (capturas de pantalla, historial compartido). Último recurso: navegar de verdad
    // a la URL limpia con `location.replace` (no añade una entrada nueva al historial, igual que
    // `replaceState`). Si tampoco existe (entorno de test sin `location` global), no queda nada
    // más que hacer del lado del cliente -- la configuración, si era válida, ya se guardó arriba,
    // que es lo que de verdad importa para el resto de la app.
    try {
      // `globalThis.location`, NUNCA el parámetro `location` de esta función (que solo trae
      // `{search, pathname, hash}`, sin `.replace` -- lo shadowea por nombre, no es el mismo
      // objeto): el fallback navega de verdad, así que tiene que ser el `location` real del
      // navegador.
      globalThis.location.replace(urlLimpia);
    } catch {
      // Ningún mecanismo de navegación disponible: ver comentario de arriba.
    }
  }
  return guardado;
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
 * `localStorage`, con dedupe por id (ni contra lo ya guardado ni entre las propias `nuevas`) y
 * excluyendo también las reportadas (`estado.reportadas` — Ronda 1 de revisión, Important #2: una
 * pregunta que el jugador ya marcó "está mal" en una sesión anterior no debe poder volver a
 * colarse en `bancoExtra` si el servidor la sirve otra vez antes de que `/reportar` la retire de
 * su colchón) y las que colisionen con `idsLocales` (Set opcional de ids de `datos/banco.json` —
 * en teoría nunca debería pasar, los ids del servidor van siempre prefijados `srv-`, pero es una
 * comprobación barata que evita que una pregunta del servidor pise silenciosamente a una del
 * banco local si esa garantía de prefijo llegara a romperse alguna vez).
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
 * @param {Set<string>} [idsLocales]
 * @returns {{anadidas: number, total: number}}
 */
export function fusionarBancoExtra(nuevas, estado, idsLocales) {
  const reportadas = new Set((estado && estado.reportadas) || []);
  // Ronda final de revisión (Minor #12): purga también las que YA estaban en `bancoExtra` y
  // ahora están en `estado.reportadas` -- antes el filtro de `reportadas` solo actuaba sobre
  // `nuevas`, así que una pregunta reportada DESPUÉS de haber entrado en el banco (p. ej. el
  // jugador la marca "está mal" en una sesión, y en la siguiente sincronización el servidor
  // todavía no ha procesado el `/reportar`) se quedaba viva en `bancoExtra` indefinidamente.
  const actuales = leerBancoExtra().filter((p) => !(p && reportadas.has(p.id)));
  const idsActuales = new Set(actuales.map((p) => p.id));
  const vistos = new Set();
  const aAnadir = (Array.isArray(nuevas) ? nuevas : []).filter((p) => {
    if (!p || typeof p.id !== 'string') return false;
    if (idsActuales.has(p.id) || vistos.has(p.id)) return false;
    if (reportadas.has(p.id)) return false;
    if (idsLocales && idsLocales.has(p.id)) return false;
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

/** Solo la ruta (sin origin) y el código -- nunca cuerpo, cabeceras, ni el token (Authorization
 * viaja ahí). Ronda final de revisión (Minor #10): antes un fallo era enteramente silencioso, sin
 * ni una línea en consola -- para depurar en vivo hace falta al menos un rastro mínimo y seguro. */
function avisarFalloPeticion(url, motivo) {
  try {
    const ruta = new URL(url).pathname;
    console.warn(`ONE servidor: ${ruta} ${motivo}`);
  } catch {
    // Si ni siquiera se puede parsear la URL para sacar la ruta, mejor no avisar que arriesgarse
    // a filtrar la URL completa (con el token en query, si algún día lo llevara).
  }
}

// Único punto que toca la red: siempre con timeout de 10 s y siempre `null` en vez de lanzar
// (cuerpo no-JSON, HTTP no-ok, red caída, timeout...) — así cada función pública de arriba puede
// limitarse a comprobar `datos === null` sin su propio try/catch repetido.
async function peticionJson(fetchImpl, url, opciones) {
  try {
    const respuesta = await fetchImpl(url, { ...opciones, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!respuesta.ok) {
      avisarFalloPeticion(url, String(respuesta.status));
      return null;
    }
    return await respuesta.json();
  } catch {
    avisarFalloPeticion(url, 'red');
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
const N_TANDA_DEFECTO = 10;

export async function pedirTanda({ area, ruta = [], n, fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion || !area) return null;
  // Ronda final de revisión (adversarial A12): `n` inválido (undefined, NaN, negativo, decimal...)
  // se sanea aquí a 10 en vez de mandarlo tal cual -- el servidor ya lo saneaba a su vez
  // (servidor/index.js#manejarGenerar), pero es una petición más clara de leer en el log/red, y no
  // depende de que el saneado del servidor no cambie nunca.
  const nValido = Number.isInteger(n) && n > 0 ? n : N_TANDA_DEFECTO;
  const datos = await peticionJson(fetchImpl, `${configuracion.url}/generar`, {
    method: 'POST',
    headers: cabeceras(configuracion.token),
    body: JSON.stringify({ area, ruta, n: nValido, urgente: true }),
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
// Ronda final de revisión (adversarial A4): tope 50 -- una sesión muy larga explorando muchas
// rutas distintas del átomo no debe acumular memoria sin límite. `Map` conserva el orden de
// inserción, así que la PRIMERA clave es siempre la más antigua (se borra ella, no una al azar).
const TOPE_CACHE_SUBTEMAS = 50;

/**
 * `POST /subtemas`: anillos del átomo. Cacheada en memoria por `[area, ruta, excluir]` (spec §4:
 * "una sola llamada al modelo por combinación, para siempre" en el servidor -- aquí, para no
 * repetir ni siquiera la llamada HTTP mientras dure la sesión). La caché nunca se llena de fallos:
 * solo se guarda una respuesta buena.
 *
 * `excluir` (v0.2b3 Tarea 3, nodo "Más…"): los `completo` de los subtemas ya mostrados en ESE
 * anillo, para que el servidor pagine la siguiente tanda sin repetir. Siempre viaja en el body
 * (`[]` por defecto, nunca se omite) y entra en la clave de caché -- misma `[area, ruta]` con un
 * `excluir` distinto es una página distinta, no la misma petición.
 * @param {{area: string, ruta?: string[], excluir?: string[], fetchImpl?: Function}} params
 * @returns {Promise<object[] | null>}
 */
export async function pedirSubtemas({ area, ruta = [], excluir = [], fetchImpl = fetch } = {}) {
  const configuracion = leerConfiguracion();
  if (!configuracion || !area) return null;
  const clave = JSON.stringify([area, ruta, excluir]);
  if (cacheSubtemas.has(clave)) return cacheSubtemas.get(clave);

  const datos = await peticionJson(fetchImpl, `${configuracion.url}/subtemas`, {
    method: 'POST',
    headers: cabeceras(configuracion.token),
    body: JSON.stringify({ area, ruta, excluir }),
  });
  if (!datos || !Array.isArray(datos.subtemas)) return null;
  if (cacheSubtemas.size >= TOPE_CACHE_SUBTEMAS) {
    cacheSubtemas.delete(cacheSubtemas.keys().next().value);
  }
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
