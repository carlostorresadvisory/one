// API HTTP del servidor de generación de ONE (Tarea 3 del plan v0.2b1-servidor).
// Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §0, §3.1, §3.3, §3.5.
//
// Node 22 sin dependencias, módulos ES, en español. Reutiliza por import relativo servidor/almacen.js
// (Tarea 1) y servidor/cola.js (Tarea 2) -- este fichero no toca disco por su cuenta salvo dos
// lecturas que almacen.js no expone como método genérico (llamadas.log para el gasto de hoy,
// ultimo-resumen.json para el relleno nocturno; ver comentarios en `gastoHoyEur`/`leerUltimoResumen`
// más abajo). Solo lee de `process.env` en el arranque directo: TOKEN_ONE, PUERTO, RUTA_DATOS,
// PERMITIR_PAGO, TOPE_EUR_DIA -- OPENROUTER_API_KEY NUNCA se lee aquí (solo dentro de
// tools/openrouter.js). Nada de este fichero imprime prompts, claves ni el token; los errores que
// llegan al cliente son siempre `{error: "texto en español"}`, nunca una traza.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { llamar as llamarReal, extraerJson, MODELOS } from '../tools/openrouter.js';
import { HILOS_POR_AREA, textoCriterio } from '../tools/criterio.js';
import { crearAlmacen } from './almacen.js';
import { crearCola } from './cola.js';
import { producirTanda } from './generacion.js';

const require = createRequire(import.meta.url);

const LIMITE_CUERPO_BYTES = 64 * 1024;
const LIMITE_PETICIONES_POR_MINUTO = 60;
const VENTANA_LIMITE_MS = 60 * 1000;
const ORIGENES_DEFECTO = ['https://carlostorresadvisory.github.io', 'http://localhost:8765'];
const HORA_NOCTURNA_INICIO = 2;
const HORA_NOCTURNA_FIN = 7; // exclusivo: 7:00 en punto ya no cuenta como nocturno.
const INTERVALO_NOCTURNO_MS = 60 * 60 * 1000;
const SEGUNDOS_ESTIMADOS_POR_PUESTO = 40; // heurística del controlador, ver README/informe de la tarea.
const MAX_ESTADO_DEFECTO = 10;
const SUBTEMAS_MIN = 4;
const SUBTEMAS_MAX = 6;
const LONGITUD_MAX_SUBTEMA = 40;

// === Utilidades pequeñas, sin estado =============================================================

// "corto ≤ 40 caracteres: hasta la primera coma/punto o recortado con '…'" (decisión del
// controlador, brief de la Tarea 3). Se corta en la primera coma o punto (lo que venga antes); si
// aun así el resultado (o el texto entero, si no había coma ni punto) supera los 40 caracteres, se
// recorta a 39 + "…" para no pasarse nunca del límite.
function acortarSubtema(texto) {
  const indiceCorte = texto.search(/[,.]/);
  let corto = (indiceCorte !== -1 ? texto.slice(0, indiceCorte) : texto).trim();
  if (corto.length > LONGITUD_MAX_SUBTEMA) {
    corto = `${corto.slice(0, LONGITUD_MAX_SUBTEMA - 1)}…`;
  }
  return corto;
}

// Filtra la cascada a solo modelos ':free' si no se permite pago -- mismo criterio que
// servidor/generacion.js#filtrarPorPago (no exportado desde allí, duplicado a propósito: ese
// fichero está en la lista de "no tocar" de esta tarea).
function filtrarModelosPago(modelos, permitirPago) {
  return permitirPago ? modelos : modelos.filter((id) => id.endsWith(':free'));
}

// Node a veces formatea la medianoche como "24" en vez de "0" con hour12:false según la build de
// ICU; `hourCycle: 'h23'` fuerza el rango 0-23 sin ese caso especial (comprobado en este entorno,
// ver informe de la tarea).
/**
 * ¿Es una hora "nocturna" (2:00-7:00, hora de Madrid, límite superior exclusivo) para el relleno
 * automático del colchón? Función pura, testeable sin esperar horas reales.
 * @param {Date} [fecha]
 * @returns {boolean}
 */
export function esHoraNocturna(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(fecha);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
  return hora >= HORA_NOCTURNA_INICIO && hora < HORA_NOCTURNA_FIN;
}

// almacen.js no expone una lectura genérica de JSON arbitrario (solo los ficheros con nombre fijo
// que ya conoce: colchon/rechazadas/anillos/reportadas) -- ver servidor/almacen.js. Este fichero
// necesita leer "ultimo-resumen.json" (guardado por /estado vía almacen.escribirAtomico, que sí es
// genérico) para el relleno nocturno; se lee con fs directamente. Un fichero ausente o corrupto se
// trata como "todavía no hay resumen" (objeto vacío), sin lanzar -- el relleno nocturno debe poder
// correr aunque el móvil nunca haya llamado a /estado.
async function leerUltimoResumen(rutaDatos) {
  try {
    const texto = await readFile(path.join(rutaDatos, 'ultimo-resumen.json'), 'utf8');
    return JSON.parse(texto);
  } catch {
    return {};
  }
}

/**
 * Si `fecha` cae en la ventana nocturna, rellena el colchón hacia el objetivo con el último resumen
 * conocido (o uno vacío si aún no hay ninguno) y devuelve `true`; fuera de la ventana no hace nada y
 * devuelve `false`. Extraído como función independiente (en vez de vivir solo dentro del
 * `setInterval` de `crearServidor`) para poder probarlo sin esperar una hora real.
 * @param {object} params
 * @param {ReturnType<import('./cola.js').crearCola>} params.cola
 * @param {string} params.rutaDatos
 * @param {Date} [params.fecha]
 * @returns {Promise<boolean>}
 */
export async function rellenoNocturnoSiToca({ cola, rutaDatos, fecha = new Date() }) {
  if (!esHoraNocturna(fecha)) return false;
  const resumen = await leerUltimoResumen(rutaDatos);
  const rutasAtomo = Array.isArray(resumen?.rutasAtomo) ? resumen.rutasAtomo : [];
  await cola.rellenarHaciaObjetivo(resumen, rutasAtomo);
  return true;
}

// Igual formato de línea que escribe tools/openrouter.js#registrarLog: una línea JSON por llamada,
// `{fecha: ISO, coste, ...}`. costeAcumuladoHoy no está exportada desde ese módulo (uso interno de
// `llamar`), así que se reimplementa aquí -- "si no, súmalo leyendo llamadas.log" (brief de la
// tarea). Un fichero ausente o con líneas corruptas no rompe /salud: se ignoran y se sigue sumando
// el resto.
async function gastoHoyEur(rutaLog) {
  let contenido;
  try {
    contenido = await readFile(rutaLog, 'utf8');
  } catch {
    return 0;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  let total = 0;
  for (const linea of contenido.trim().split('\n')) {
    if (!linea) continue;
    try {
      const entrada = JSON.parse(linea);
      if (typeof entrada.fecha === 'string' && entrada.fecha.startsWith(hoy)) {
        total += Number(entrada.coste) || 0;
      }
    } catch {
      // línea corrupta: se ignora, igual que costeAcumuladoHoy en tools/openrouter.js.
    }
  }
  return total;
}

// crypto.timingSafeEqual exige buffers de la MISMA longitud (si no, lanza) -- de ahí la
// comprobación de longitud antes de llamarlo, tratada como "no coincide" y no como error.
function tokenValido(cabeceraAutorizacion, token) {
  if (typeof cabeceraAutorizacion !== 'string' || !cabeceraAutorizacion.startsWith('Bearer ')) return false;
  const recibido = Buffer.from(cabeceraAutorizacion.slice('Bearer '.length));
  const esperado = Buffer.from(token);
  if (recibido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(recibido, esperado);
}

// x-forwarded-for primero (el servidor real vive detrás de Caddy, spec §3.5), luego la IP directa
// del socket -- orden pedido explícitamente por el brief de esta tarea.
function ipDePeticion(req) {
  const cabecera = req.headers['x-forwarded-for'];
  if (typeof cabecera === 'string' && cabecera.trim()) return cabecera.split(',')[0].trim();
  return req.socket.remoteAddress || 'desconocida';
}

function responderJson(res, codigo, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

function responderError(res, codigo, mensaje) {
  responderJson(res, codigo, { error: mensaje });
}

// Acumula el cuerpo de la petición sin dejar crecer la memoria sin límite: en cuanto se supera
// `limite` se deja de guardar (y se rechaza), pero se SIGUE escuchando 'data' hasta 'end' -- no se
// llama a req.destroy(), que en Node cierra el socket entero y se llevaría por delante la respuesta
// 413 que queremos poder enviar todavía.
function leerCuerpo(req, limite) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let excedido = false;
    const trozos = [];
    req.on('data', (trozo) => {
      if (excedido) return;
      total += trozo.length;
      if (total > limite) {
        excedido = true;
        reject(Object.assign(new Error('El cuerpo de la petición supera el límite de 64 KB'), { codigo: 413 }));
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      if (!excedido) resolve(Buffer.concat(trozos).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!excedido) reject(err);
    });
  });
}

async function leerJsonCuerpo(req, limite) {
  const texto = await leerCuerpo(req, limite);
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw Object.assign(new Error('El cuerpo de la petición no es JSON válido'), { codigo: 400 });
  }
}

// === Servidor =====================================================================================

/**
 * Crea el servidor HTTP de generación de ONE. No arranca a escuchar por su cuenta (eso lo decide
 * quien lo llama, con el puerto que quiera -- 0 en los tests); ver el bloque de arranque directo al
 * final de este fichero para el uso real con `process.env`.
 * @param {object} params
 * @param {ReturnType<import('./cola.js').crearCola>} params.cola
 * @param {ReturnType<import('./almacen.js').crearAlmacen>} params.almacen
 * @param {string} params.token `TOKEN_ONE`: se compara con `Authorization: Bearer <token>`.
 * @param {string} [params.rutaDatos] carpeta de datos del servidor; hace falta para dos lecturas
 *   que `almacen` no expone de forma genérica (`llamadas.log` para `gastoHoyEur`,
 *   `ultimo-resumen.json` para el relleno nocturno). Sin ella, `/salud` devuelve `gastoHoyEur: 0` y
 *   el temporizador nocturno no hace nada (se documenta, no se lanza).
 * @param {string[]} [params.origenesPermitidos] por defecto los dos fijados en la spec §3.1.
 * @param {string} [params.version] va en la respuesta de `/salud`.
 * @param {Function} [params.llamar] inyectable para tests; por defecto tools/openrouter.js#llamar.
 *   Solo lo usa `/subtemas` (anillo ≥ 2) -- el resto de rutas nunca llaman a un modelo directamente,
 *   pasan por `cola`/`almacen`.
 * @param {boolean} [params.permitirPago] igual semántica que en servidor/generacion.js.
 * @param {number} [params.topeEur] tope de gasto diario, pasado tal cual a `llamar`.
 * @returns {import('node:http').Server}
 */
export function crearServidor({
  cola,
  almacen,
  token,
  rutaDatos,
  origenesPermitidos = ORIGENES_DEFECTO,
  version = '0.2b1',
  llamar: llamarFn = llamarReal,
  permitirPago = false,
  topeEur = 0,
} = {}) {
  if (!cola) throw new Error('crearServidor: falta cola');
  if (!almacen) throw new Error('crearServidor: falta almacen');
  if (!token) throw new Error('crearServidor: falta token');

  const rutaLog = rutaDatos ? path.join(rutaDatos, 'llamadas.log') : 'llamadas.log';

  // Rate limit por IP: ventana fija de 60 s por IP (no deslizante -- primera petición de la IP en
  // la ventana la abre, las 60 siguientes pasan, la 61 recibe 429). El Map se limpia cada minuto
  // (brief de la tarea) quitando las entradas cuya ventana ya venció, para no crecer sin límite con
  // IPs que ya no vuelven a llamar.
  const limitesPorIp = new Map();
  const idLimpiezaLimites = setInterval(() => {
    const ahora = Date.now();
    for (const [ip, info] of limitesPorIp) {
      if (info.expiraEn <= ahora) limitesPorIp.delete(ip);
    }
  }, VENTANA_LIMITE_MS);
  idLimpiezaLimites.unref?.();

  function superaLimite(ip) {
    const ahora = Date.now();
    const info = limitesPorIp.get(ip);
    if (!info || info.expiraEn <= ahora) {
      limitesPorIp.set(ip, { cuenta: 1, expiraEn: ahora + VENTANA_LIMITE_MS });
      return false;
    }
    info.cuenta += 1;
    return info.cuenta > LIMITE_PETICIONES_POR_MINUTO;
  }

  // Colchón nocturno: temporizador cada hora: rellenoNocturnoSiToca ya decide por su cuenta si la
  // hora actual cae en la ventana 2:00-7:00 (Europe/Madrid). Sin cron del host (spec §3.5).
  const idNocturno = setInterval(() => {
    if (!rutaDatos) return;
    rellenoNocturnoSiToca({ cola, rutaDatos }).catch((err) => {
      console.error(`servidor: fallo en el relleno nocturno: ${err?.message || err}`);
    });
  }, INTERVALO_NOCTURNO_MS);
  idNocturno.unref?.();

  // === Manejadores de ruta, uno por endpoint de la spec §3.3 =====================================

  async function manejarSalud(req, res) {
    const colchon = await almacen.leerColchon();
    const disponibles = colchon.filter((p) => !p.servida);
    const porArea = {};
    for (const p of disponibles) porArea[p.area] = (porArea[p.area] || 0) + 1;
    const gasto = await gastoHoyEur(rutaLog);
    responderJson(res, 200, {
      ok: true,
      version,
      colchon: { total: colchon.length, listas: disponibles.length, porArea },
      cola: cola.estadisticas().enCola,
      gastoHoyEur: gasto,
    });
  }

  async function manejarEstado(req, res) {
    const cuerpo = await leerJsonCuerpo(req, LIMITE_CUERPO_BYTES);
    const resumen = cuerpo.resumen && typeof cuerpo.resumen === 'object' ? cuerpo.resumen : {};
    const max = Number.isInteger(cuerpo.max) && cuerpo.max > 0 ? cuerpo.max : MAX_ESTADO_DEFECTO;
    const idsConocidos = Array.isArray(resumen.idsConocidos) ? resumen.idsConocidos : [];
    const rutasAtomo = Array.isArray(resumen.rutasAtomo) ? resumen.rutasAtomo : [];

    const preguntas = await cola.servir({ idsConocidos, resumen, max });
    await almacen.escribirAtomico('ultimo-resumen.json', resumen);
    responderJson(res, 200, { preguntas, enCola: cola.estadisticas().enCola });

    // "responde y DESPUÉS dispara rellenarHaciaObjetivo sin esperarlo" (brief de la tarea): la
    // respuesta ya se envió arriba: esto es efecto de fondo puro, con su propio manejo de errores
    // para que un fallo aquí no se convierta en un unhandledRejection.
    cola.rellenarHaciaObjetivo(resumen, rutasAtomo).catch((err) => {
      console.error(`servidor: fallo al rellenar el colchón desde /estado: ${err?.message || err}`);
    });
  }

  async function manejarGenerar(req, res) {
    const cuerpo = await leerJsonCuerpo(req, LIMITE_CUERPO_BYTES);
    if (!cuerpo.area || typeof cuerpo.area !== 'string') {
      responderError(res, 400, 'Falta el área');
      return;
    }
    const ruta = Array.isArray(cuerpo.ruta) ? cuerpo.ruta : [];
    const n = Number.isInteger(cuerpo.n) && cuerpo.n > 0 ? cuerpo.n : undefined;
    const urgente = !!cuerpo.urgente;

    const resultado = cola.encolar({ area: cuerpo.area, ruta, n, urgente });
    if (!resultado) {
      responderError(res, 503, 'La cola de fondo está llena, inténtalo más tarde');
      return;
    }
    responderJson(res, 200, {
      trabajoId: resultado.trabajoId,
      enCola: cola.estadisticas().enCola,
      // Heurística simple (no fijada por la spec): ~40 s por puesto de espera delante del trabajo
      // nuevo, con la cascada gratis. Documentado en el informe de la tarea para que el controlador
      // la ajuste si hace falta.
      estimadoSeg: (resultado.posicion + 1) * SEGUNDOS_ESTIMADOS_POR_PUESTO,
    });
  }

  function manejarTrabajo(req, res, id) {
    const estado = cola.estadoTrabajo(id);
    if (!estado) {
      responderError(res, 404, 'Trabajo no encontrado');
      return;
    }
    responderJson(res, 200, estado);
  }

  async function manejarSubtemas(req, res) {
    const cuerpo = await leerJsonCuerpo(req, LIMITE_CUERPO_BYTES);
    const area = cuerpo.area;
    if (!area || !HILOS_POR_AREA[area]) {
      responderError(res, 400, 'Área desconocida');
      return;
    }
    const ruta = Array.isArray(cuerpo.ruta) ? cuerpo.ruta : [];

    // Anillo 1: fijo, tal cual textoCriterio; nunca llama al modelo.
    if (ruta.length === 0) {
      const subtemas = HILOS_POR_AREA[area].map((completo, indice) => ({
        indice,
        corto: acortarSubtema(completo),
        completo,
      }));
      responderJson(res, 200, { subtemas });
      return;
    }

    // Anillos siguientes: cacheados en anillos.json por [area, ruta] -- una sola llamada al modelo
    // por combinación, para siempre (hasta que alguien borre el fichero).
    const clave = JSON.stringify([area, ruta]);
    const anillos = await almacen.leerAnillos();
    if (Array.isArray(anillos[clave])) {
      responderJson(res, 200, { subtemas: anillos[clave] });
      return;
    }

    const modelos = filtrarModelosPago(MODELOS.generador, permitirPago);
    const mensajes = [
      { role: 'system', content: textoCriterio(area) },
      {
        role: 'user',
        content:
          `Ruta ya elegida dentro del área "${area}": ${JSON.stringify(ruta)}. Propón entre ${SUBTEMAS_MIN} y ` +
          `${SUBTEMAS_MAX} subtemas concretos dentro de esa ruta (para que el jugador siga afinando), cada uno ` +
          `de ${LONGITUD_MAX_SUBTEMA} caracteres o menos. Responde solo con un objeto JSON ` +
          '{"subtemas": ["...", ...]}, sin explicaciones adicionales.',
      },
    ];

    let salida;
    try {
      salida = await llamarFn({ modelos, mensajes, json: true, permitirPago, topeEur, rutaLog });
    } catch {
      responderError(res, 500, 'No se pudieron generar los subtemas');
      return;
    }

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch {
      responderError(res, 500, 'No se pudieron generar los subtemas');
      return;
    }

    const lista = Array.isArray(datos) ? datos : Array.isArray(datos?.subtemas) ? datos.subtemas : [];
    const subtemas = lista
      .filter((s) => typeof s === 'string' && s.trim())
      .map((texto, indice) => ({ indice, corto: acortarSubtema(texto.trim()), completo: texto.trim() }));

    if (subtemas.length === 0) {
      responderError(res, 500, 'No se pudieron generar los subtemas');
      return;
    }

    await almacen.guardarAnillo(clave, subtemas);
    responderJson(res, 200, { subtemas });
  }

  async function manejarReportar(req, res) {
    const cuerpo = await leerJsonCuerpo(req, LIMITE_CUERPO_BYTES);
    if (!cuerpo.id || typeof cuerpo.id !== 'string') {
      responderError(res, 400, 'Falta el id');
      return;
    }
    const resultado = await cola.reportar(cuerpo.id);
    responderJson(res, 200, resultado);
  }

  // === Enrutado + capas transversales (CORS, rate limit, auth) ===================================

  async function manejarPeticion(req, res) {
    const origen = req.headers.origin;
    const origenPermitido = typeof origen === 'string' && origenesPermitidos.includes(origen);
    if (origenPermitido) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      if (origenPermitido) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (superaLimite(ipDePeticion(req))) {
      responderError(res, 429, 'Demasiadas peticiones, inténtalo dentro de un minuto');
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const ruta = url.pathname;

    if (req.method === 'GET' && ruta === '/salud') {
      await manejarSalud(req, res);
      return;
    }

    // Todo lo que no sea /salud exige token -- "sin token o token incorrecto → 401 sin cuerpo"
    // (spec §3.1), antes de leer nada del cuerpo de la petición.
    if (!tokenValido(req.headers.authorization, token)) {
      res.writeHead(401);
      res.end();
      return;
    }

    if (req.method === 'POST' && ruta === '/estado') {
      await manejarEstado(req, res);
      return;
    }
    if (req.method === 'POST' && ruta === '/generar') {
      await manejarGenerar(req, res);
      return;
    }
    if (req.method === 'GET' && ruta.startsWith('/trabajo/')) {
      const id = decodeURIComponent(ruta.slice('/trabajo/'.length));
      if (!id) {
        responderError(res, 404, 'Trabajo no encontrado');
        return;
      }
      manejarTrabajo(req, res, id);
      return;
    }
    if (req.method === 'POST' && ruta === '/subtemas') {
      await manejarSubtemas(req, res);
      return;
    }
    if (req.method === 'POST' && ruta === '/reportar') {
      await manejarReportar(req, res);
      return;
    }

    responderError(res, 404, 'Ruta no encontrada');
  }

  const servidor = http.createServer((req, res) => {
    manejarPeticion(req, res).catch((err) => {
      const codigo = Number.isInteger(err?.codigo) ? err.codigo : 500;
      if (!res.headersSent) {
        responderError(res, codigo, codigo === 500 ? 'Error interno del servidor' : err.message);
      }
      // Solo el mensaje, nunca err.stack -- "nunca trazas ni rutas internas" (spec §3.3).
      if (codigo === 500) console.error(`servidor: error no controlado: ${err?.message || err}`);
    });
  });

  servidor.on('close', () => {
    clearInterval(idLimpiezaLimites);
    clearInterval(idNocturno);
  });

  return servidor;
}

// === Arranque directo (`node servidor/index.js`) =================================================
// Solo se ejecuta si el fichero se invoca directamente (no al importarlo en tests), igual que
// tools/servir.js. Lee de process.env exactamente lo que fija el brief de la tarea: TOKEN_ONE,
// PUERTO, RUTA_DATOS, PERMITIR_PAGO, TOPE_EUR_DIA -- nunca OPENROUTER_API_KEY (eso es cosa de
// tools/openrouter.js, que la lee por su cuenta cuando `llamar` hace una petición real).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = process.env.TOKEN_ONE;
  if (!token) {
    console.error('servidor: falta TOKEN_ONE en el entorno, no se puede arrancar.');
    process.exit(1);
  }

  const puerto = Number(process.env.PUERTO) || 8787;
  const rutaDatos = process.env.RUTA_DATOS || '/datos-servidor';
  const permitirPago = process.env.PERMITIR_PAGO === '1';
  const topeEur = Number(process.env.TOPE_EUR_DIA) || 0;

  const almacenReal = crearAlmacen(rutaDatos);
  const colaReal = crearCola({
    almacen: almacenReal,
    producirTanda,
    opciones: { permitirPago, topeEur, rutaLog: path.join(rutaDatos, 'llamadas.log') },
  });

  let version = '0.2b1';
  try {
    version = require('../package.json').version || version;
  } catch {
    // Sin package.json accesible (no debería pasar dentro del contenedor): se sigue con el
    // valor por defecto, /salud sigue funcionando igual.
  }

  const servidor = crearServidor({
    cola: colaReal,
    almacen: almacenReal,
    token,
    rutaDatos,
    permitirPago,
    topeEur,
    version,
  });

  servidor.listen(puerto, () => {
    console.log(`ONE servidor de generación escuchando en el puerto ${puerto}.`);
  });
}
