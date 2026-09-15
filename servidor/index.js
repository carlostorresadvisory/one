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
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { llamar as llamarReal, extraerJson, MODELOS, esModeloGratis } from '../tools/openrouter.js';
import { AREAS } from '../tools/validar-banco.js';
import { HILOS_POR_AREA, textoCriterio } from '../tools/criterio.js';
import { crearAlmacen } from './almacen.js';
import { crearCola } from './cola.js';
import { producirTanda, completarVisual } from './generacion.js';

const require = createRequire(import.meta.url);

const LIMITE_CUERPO_BYTES = 64 * 1024;
const LIMITE_PETICIONES_POR_MINUTO = 60;
const VENTANA_LIMITE_MS = 60 * 1000;
const ORIGENES_DEFECTO = ['https://carlostorresadvisory.github.io', 'http://localhost:8765'];
const HORA_NOCTURNA_INICIO = 2;
const HORA_NOCTURNA_FIN = 7; // exclusivo: 7:00 en punto ya no cuenta como nocturno.
const INTERVALO_NOCTURNO_MS = 60 * 60 * 1000;
const MAX_ESTADO_DEFECTO = 10;
const SUBTEMAS_MAX = 6;
const LONGITUD_MAX_SUBTEMA = 40;
const RUTA_MAX_ELEMENTOS = 6;
// Ronda final de arreglos (revisión, 14-sep-2026) -- Critical (C1): 80 se quedaba corto frente a
// los propios hilos de tools/criterio.js#HILOS_POR_AREA (hasta 112 caracteres, comprobado con un
// script en la revisión) -- cada elemento de `ruta` puede ser un hilo completo del anillo 1 (nunca
// se acorta antes de avanzar, ver app.js#avanzar), así que rechazarlo aquí dejaba el átomo en un
// callejón sin salida (400 en /subtemas y /generar) para 26 de los 50 hilos. 160 da margen sobre
// el `completo` más largo posible: un hilo estático (≤112) o un subtema que ya haya propuesto el
// modelo (≤ LONGITUD_MAX_SUBTEMA = 40). Exportada para que tests/servidor-api.test.js pueda
// comprobar que ningún hilo de HILOS_POR_AREA la supera, sin duplicar el número a mano.
export const RUTA_ELEMENTO_MAX_LONGITUD = 160;
// eslint-disable-next-line no-control-regex -- a propósito: se rechazan caracteres de control.
const RUTA_CARACTER_CONTROL = /[\x00-\x1f\x7f]/;
// Tarea 2 (v0.2b3, spec §9): mismo criterio que `ruta` pero con límites propios -- `excluir` lleva
// los "completos" ya mostrados en el anillo (pueden ser muchos más que los 6 de una ruta: cada
// toque de "Más…" añade otra página entera a la lista).
const EXCLUIR_MAX_ELEMENTOS = 30;
// Ronda final de arreglos (C1): mismo motivo y misma cifra que RUTA_ELEMENTO_MAX_LONGITUD de
// arriba -- `excluir` lleva los mismos "completos" (hilos o subtemas del modelo) que `ruta`, así
// que necesita el mismo margen. Cruzada con sincronizacion.js#EXCLUIR_ELEMENTO_MAX_LONGITUD
// (recorte del lado del cliente, acotarExcluir) -- deben mantenerse iguales.
const EXCLUIR_ELEMENTO_MAX_LONGITUD = 160;

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

// Ronda 1 (revisión, 14-sep-2026) -- Important: el modelo puede ignorar la instrucción de
// `promptSubtemas` de no repetir nada de `excluir` (o repetirse a sí mismo dentro de la propia
// respuesta) -- sin normalizar antes de comparar, "Guerra Fría" y "guerra fria" se tratarían como
// subtemas distintos. trim + minúsculas + sin acentos (NFD y se quitan las marcas combinantes) +
// espacios colapsados, para que solo importe el contenido.
function normalizarParaComparar(texto) {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// Prompt de usuario de /subtemas (spec §9, decisión de Carlos 14-sep 21:30 sobre v0.2b3): pide
// mezclar "ramas hermanas" amplias (otras líneas tan generales como la ruta actual) con "conceptos
// concretos" (autores, casos, experimentos, técnicas) -- así el átomo puede llegar a cualquier tema
// sin quedarse solo en subdivisiones cada vez más finas de la misma rama. Nunca repite nada de
// `excluir`; se llama tanto desde un anillo ≥ 2 como desde el anillo 1 cuando ya se agotó la lista
// estática de HILOS_POR_AREA (ver manejarSubtemas).
function promptSubtemas(area, ruta, excluir) {
  const contextoRuta =
    ruta.length > 0
      ? `Ruta ya elegida dentro del área "${area}": ${JSON.stringify(ruta)}.`
      : `Dentro del área "${area}", sin una ruta más concreta todavía.`;
  const contextoExcluir =
    excluir.length > 0
      ? ` No repitas ninguno de estos subtemas que el jugador ya ha visto: ${JSON.stringify(excluir)}.`
      : '';
  return (
    `${contextoRuta}${contextoExcluir} Propón exactamente ${SUBTEMAS_MAX} subtemas nuevos que mezclen ` +
    'ramas hermanas amplias (otras líneas tan generales como la ruta actual, para poder saltar a un tema ' +
    'distinto) y conceptos concretos (autores, casos, experimentos, técnicas) dentro de esa línea, para ' +
    `que el jugador siga afinando. Cada subtema de ${LONGITUD_MAX_SUBTEMA} caracteres o menos, en ` +
    'español. Responde solo con un objeto JSON {"subtemas": ["...", ...]}, sin explicaciones adicionales.'
  );
}

// Ronda final (revisión, 14-sep-2026) -- Adversarial (A5): `ruta` viaja tal cual dentro de prompts
// que se mandan al modelo (JSON.stringify(ruta) en /subtemas, y dentro de promptSistemaGenerador en
// servidor/generacion.js para /generar) y se guarda tal cual en colchon.json -- sin límite, un
// cliente podría mandar una `ruta` enorme (coste de tokens real en cada llamada) o con caracteres
// de control. Mismo criterio en /generar y /subtemas: como mucho 6 elementos, cada uno una cadena
// no vacía de hasta 80 caracteres sin caracteres de control.
function rutaValida(ruta) {
  if (!Array.isArray(ruta)) return false;
  if (ruta.length > RUTA_MAX_ELEMENTOS) return false;
  return ruta.every(
    (elemento) =>
      typeof elemento === 'string' &&
      elemento.length > 0 &&
      elemento.length <= RUTA_ELEMENTO_MAX_LONGITUD &&
      !RUTA_CARACTER_CONTROL.test(elemento),
  );
}

// `ruta` ausente (caso normal: anillo 1, o "toda el área") se trata como `[]`, válida sin más
// comprobación; si viene, tiene que pasar `rutaValida`.
function normalizarRuta(rutaCruda) {
  if (rutaCruda === undefined) return { ok: true, ruta: [] };
  if (!rutaValida(rutaCruda)) return { ok: false, ruta: null };
  return { ok: true, ruta: rutaCruda };
}

// Tarea 2 (v0.2b3): mismo criterio que `rutaValida`, límites propios (ver EXCLUIR_MAX_ELEMENTOS /
// EXCLUIR_ELEMENTO_MAX_LONGITUD más arriba) -- lista de "completos" ya mostrados en el anillo que
// el jugador no quiere volver a ver.
function excluirValido(excluir) {
  if (!Array.isArray(excluir)) return false;
  if (excluir.length > EXCLUIR_MAX_ELEMENTOS) return false;
  return excluir.every(
    (elemento) =>
      typeof elemento === 'string' &&
      elemento.length > 0 &&
      elemento.length <= EXCLUIR_ELEMENTO_MAX_LONGITUD &&
      !RUTA_CARACTER_CONTROL.test(elemento),
  );
}

// `excluir` ausente (caso normal: primera página de cualquier anillo) se trata como `[]`, válida
// sin más comprobación; si viene, tiene que pasar `excluirValido`.
function normalizarExcluir(excluirCrudo) {
  if (excluirCrudo === undefined) return { ok: true, excluir: [] };
  if (!excluirValido(excluirCrudo)) return { ok: false, excluir: null };
  return { ok: true, excluir: excluirCrudo };
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

// Ronda final (revisión, 14-sep-2026) -- Menor (M1): apagado ordenado. cola.js no expone una
// promesa "termina cuando el trabajo activo acabe" (concurrencia 1, un solo lote a la vez -- ver
// servidor/cola.js), así que se sondea `cola.estadisticas().activo` a intervalos cortos hasta que
// llegue a 0 o se agote `maxMs`. Exportada aparte para poder probarla sin un proceso real ni
// señales de verdad.
export function esperarInactividad(cola, maxMs, { intervaloMs = 200 } = {}) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const revisar = () => {
      if (cola.estadisticas().activo === 0 || Date.now() - inicio >= maxMs) {
        resolve();
        return;
      }
      setTimeout(revisar, intervaloMs);
    };
    revisar();
  });
}

// Ronda final (revisión, 14-sep-2026) -- Critical (C1/C2): prueba REAL de que se puede escribir en
// `rutaDatos` -- crea la carpeta si hace falta, escribe un fichero de prueba y lo borra. Se usa en
// dos sitios: al arrancar (bootstrap directo, más abajo -- si falla, `process.exit(1)` con un
// mensaje claro ANTES de aceptar ninguna petición) y en cada `/salud` (C2 -- si el disco se queda
// de solo lectura o sin espacio DESPUÉS de arrancar, `/salud` debe dejar de mentir "ok:true").
// Nunca deja basura: el nombre incluye el pid y un sufijo aleatorio para no chocar con otra
// instancia corriendo a la vez sobre el mismo `rutaDatos`.
export async function comprobarEscritura(rutaDatos) {
  await mkdir(rutaDatos, { recursive: true });
  const rutaPrueba = path.join(
    rutaDatos,
    `.prueba-escritura-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await writeFile(rutaPrueba, 'ok', 'utf8');
  await unlink(rutaPrueba);
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

// Ronda final (revisión, 14-sep-2026) -- Important (I3): se usa la ÚLTIMA IP de x-forwarded-for,
// no la primera. El único proxy de confianza delante de este proceso es Caddy (spec §3.5) y su
// Caddyfile fija `header_up X-Forwarded-For {remote_host}` (ver servidor/Caddyfile) -- pero un
// cliente malicioso puede mandar su propia cabecera `X-Forwarded-For: 6.6.6.6` y, según cómo
// encadene el proxy esa cabecera, acabar viéndose como `6.6.6.6, <ip real>`. La PRIMERA entrada la
// pone siempre el cliente (nunca verificada, trivial de falsear para saltarse el rate limit
// rotando IPs falsas); la ÚLTIMA es la que añade el salto más cercano a este proceso (Caddy), la
// única en la que se puede confiar aquí. Si no hay cabecera, se usa la IP directa del socket.
function ipDePeticion(req) {
  const cabecera = req.headers['x-forwarded-for'];
  if (typeof cabecera === 'string' && cabecera.trim()) {
    const partes = cabecera
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (partes.length > 0) return partes[partes.length - 1];
  }
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
 *   Solo lo usa `/subtemas` -- en un anillo ≥ 2, o en el anillo 1 cuando ya se agotó la lista
 *   estática de HILOS_POR_AREA (Tarea 2, v0.2b3) -- el resto de rutas nunca llaman a un modelo
 *   directamente, pasan por `cola`/`almacen`.
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
    // Ronda final (C2): antes /salud podía decir "ok:true" con el disco de datos ya inservible (de
    // solo lectura, sin espacio...) porque solo LEÍA colchon.json/llamadas.log -- una lectura sobre
    // un fichero que ya existe no detecta un disco que ya no admite ESCRITURAS nuevas. Prueba real
    // de escritura antes de nada más; si falla, 503 con un mensaje corto (nunca la ruta ni la traza)
    // y se registra el detalle en el log del propio proceso para quien opere el VPS.
    if (rutaDatos) {
      try {
        await comprobarEscritura(rutaDatos);
      } catch (err) {
        console.error(`servidor: /salud detectó que RUTA_DATOS no admite escritura: ${err?.message || err}`);
        responderJson(res, 503, { ok: false, error: 'El disco de datos del servidor no admite escritura' });
        return;
      }
    }

    const colchon = await almacen.leerColchon();
    const disponibles = colchon.filter((p) => !p.servida);
    const porArea = {};
    for (const p of disponibles) porArea[p.area] = (porArea[p.area] || 0) + 1;
    const gasto = await gastoHoyEur(rutaLog);
    const estadisticasCola = cola.estadisticas();
    responderJson(res, 200, {
      ok: true,
      version,
      colchon: { total: colchon.length, listas: disponibles.length, porArea },
      cola: estadisticasCola.enCola,
      gastoHoyEur: gasto,
      // Ronda final (C2): señal de salud del trabajador, no solo "el proceso HTTP sigue vivo".
      ultimoError: estadisticasCola.ultimoError ?? null,
      ultimaGeneracionOk: estadisticasCola.ultimaGeneracionOk ?? null,
    });
  }

  // v0.2b4.1 §5 (Minor 4, ronda de corrección 1): valida `cuerpo.desde` antes de pasarlo a
  // `cola.actualizadas`. `undefined`/`null` (el campo no viene en el cuerpo) es la única forma de
  // "primera sincronización" -- cualquier otra cosa tiene que ser una fecha ISO o un epoch en
  // milisegundos (número finito) de verdad, normalizada siempre a ISO. Nunca lanza: devuelve
  // `{ok:false}` para que quien llama decida el 400.
  function normalizarDesde(valor) {
    if (valor === undefined || valor === null) return { ok: true, desde: null };
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return { ok: true, desde: new Date(valor).toISOString() };
    }
    if (typeof valor === 'string' && valor.length > 0 && Number.isFinite(new Date(valor).getTime())) {
      return { ok: true, desde: valor };
    }
    return { ok: false, desde: null };
  }

  async function manejarEstado(req, res) {
    const cuerpo = await leerJsonCuerpo(req, LIMITE_CUERPO_BYTES);
    const resumen = cuerpo.resumen && typeof cuerpo.resumen === 'object' ? cuerpo.resumen : {};
    const max = Number.isInteger(cuerpo.max) && cuerpo.max > 0 ? cuerpo.max : MAX_ESTADO_DEFECTO;
    const idsConocidos = Array.isArray(resumen.idsConocidos) ? resumen.idsConocidos : [];
    const rutasAtomo = Array.isArray(resumen.rutasAtomo) ? resumen.rutasAtomo : [];
    // v0.2b4.1 §5 (Minor 4, ronda de corrección 1): marca de agua del cliente (última vez que
    // preguntó por actualizaciones). Solo AUSENTE significa "primera sincronización" -- un `desde`
    // presente pero que no es una fecha válida antes se colaba tal cual hasta
    // `cola.js#actualizadas`, que hace `new Date(desde).getTime()` -> `NaN` -> se trataba exactamente
    // igual que "sin `desde`" (devolvía TODO): un fail-open silencioso ante cualquier basura como
    // `desde`. Ahora se valida aquí; presente-pero-inválido es un 400 explícito, nunca un fail-open.
    const { ok: desdeOk, desde } = normalizarDesde(cuerpo.desde);
    if (!desdeOk) {
      responderError(res, 400, 'desde inválido: debe ser una fecha ISO o un epoch en milisegundos');
      return;
    }

    // Ronda final (revisión, 14-sep-2026) -- Important (I1): `cola.servir()` ya ha marcado
    // `servida` (y persistido) las preguntas devueltas -- ese trabajo real no debe perderse por un
    // fallo al guardar "ultimo-resumen.json" (un fichero secundario, solo para el relleno nocturno).
    // Antes, si `escribirAtomico` lanzaba aquí, la respuesta nunca llegaba a mandarse: el móvil no
    // recibía las preguntas que el servidor ya había dado por entregadas ("quemadas" sin que nadie
    // las viera). Se responde primero; guardar el resumen (como el relleno de después) pasa a ser
    // efecto de fondo con su propio manejo de errores.
    const preguntas = await cola.servir({ idsConocidos, resumen, max });
    // v0.2b4.1 §5: un fallo leyendo lo actualizado NUNCA puede impedir la respuesta -- mismo
    // razonamiento que I1 arriba: `servir()` ya marcó esas preguntas en disco, así que perder la
    // respuesta las quemaría sin que el móvil las haya visto. `actualizadas()` es de solo lectura
    // (no cambia nada en disco), así que esperarla aquí -- a diferencia del resumen/relleno de
    // abajo, que sí son efecto de fondo puro -- no arriesga ese trabajo ya hecho.
    let actualizadas = [];
    try {
      actualizadas = await cola.actualizadas({ idsConocidos, desde });
    } catch (err) {
      console.error(`servidor: fallo al calcular las actualizadas de /estado: ${err?.message || err}`);
    }
    responderJson(res, 200, { preguntas, enCola: cola.estadisticas().enCola, actualizadas });

    almacen.escribirAtomico('ultimo-resumen.json', resumen).catch((err) => {
      console.error(`servidor: fallo al guardar ultimo-resumen.json: ${err?.message || err}`);
    });

    // "responde y DESPUÉS dispara rellenarHaciaObjetivo sin esperarlo" (brief de la tarea): la
    // respuesta ya se envió arriba: esto es efecto de fondo puro, con su propio manejo de errores
    // para que un fallo aquí no se convierta en un unhandledRejection.
    cola.rellenarHaciaObjetivo(resumen, rutasAtomo).catch((err) => {
      console.error(`servidor: fallo al rellenar el colchón desde /estado: ${err?.message || err}`);
    });

    // v0.2b4.1 §5: y de paso se empuja el trabajo de fondo de los visuales pendientes. La cola lo
    // ignora si ya hay uno en marcha o si no hay nada pendiente (ver completarVisualesPendientes),
    // así que es barato pedirlo aquí: sin este empujón, un colchón con visuales a medias esperaría
    // a que el trabajador se quedara sin trabajos por su cuenta (procesarCola).
    cola.completarVisualesPendientes?.().catch((err) => {
      console.error(`servidor: fallo al completar visuales pendientes desde /estado: ${err?.message || err}`);
    });
  }

  async function manejarGenerar(req, res) {
    const cuerpo = await leerJsonCuerpo(req, LIMITE_CUERPO_BYTES);
    if (!cuerpo.area || typeof cuerpo.area !== 'string') {
      responderError(res, 400, 'Falta el área');
      return;
    }
    // Ronda 1 (revisión, 14-sep-2026) -- Important: sin esto, un área inexistente se encolaba
    // igual (cola.js#encolar solo comprueba que `area` no esté vacío) y fallaba en silencio más
    // tarde dentro del pipeline real (generarBorradores lanza "área desconocida", pero eso ocurre
    // varios pasos después, dentro del trabajador, sin que quien llamó a /generar se entere nunca:
    // el trabajo simplemente termina "fallida"). Se valida aquí, contra la misma lista que ya usa
    // el resto del pipeline (tools/validar-banco.js#AREAS), para devolver 400 al momento.
    if (!AREAS.includes(cuerpo.area)) {
      responderError(res, 400, 'Área desconocida');
      return;
    }
    // Ronda final (revisión, 14-sep-2026) -- Adversarial (A5): ver rutaValida/normalizarRuta.
    const { ok: rutaOk, ruta } = normalizarRuta(cuerpo.ruta);
    if (!rutaOk) {
      responderError(res, 400, 'Ruta inválida');
      return;
    }
    const n = Number.isInteger(cuerpo.n) && cuerpo.n > 0 ? cuerpo.n : undefined;
    const urgente = !!cuerpo.urgente;

    const resultado = cola.encolar({ area: cuerpo.area, ruta, n, urgente });
    if (!resultado) {
      responderError(res, 503, 'La cola de fondo está llena, inténtalo más tarde');
      return;
    }
    // Ronda final (revisión, 14-sep-2026) -- Menor (M3): `enCola` de /generar también cuenta el
    // trabajo activo (el que está corriendo ahora mismo) -- antes solo contaba los que esperan
    // turno, así que un móvil que consultara justo después de encolar podía ver "0 en cola" con un
    // trabajo ya corriendo delante del suyo.
    const estadisticasCola = cola.estadisticas();
    const segPorPregunta = estadisticasCola.segundosPorPregunta;
    responderJson(res, 200, {
      trabajoId: resultado.trabajoId,
      enCola: estadisticasCola.enCola + estadisticasCola.activo,
      // v0.2b4 §6c: ya no es "90 s por puesto" a ciegas (heurística de v0.2b1, medida una sola vez
      // con la cascada gratis saturada): media móvil REAL de las últimas 5 tandas x las preguntas
      // que hay por delante en la cola más las que pide este trabajo.
      estimadoSeg: Math.max(1, Math.round(segPorPregunta * (resultado.preguntasPorDelante + resultado.pedidas))),
      segundosPorPregunta: segPorPregunta,
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
    // Ronda final (revisión, 14-sep-2026) -- Adversarial (A5): `area ∈ AREAS` (la misma lista
    // canónica que ya usa /generar desde la Ronda 1), no la comprobación indirecta de que
    // HILOS_POR_AREA[area] exista -- ambas listas coinciden hoy, pero AREAS es la fuente de verdad
    // del resto del pipeline (validarPregunta, generarBorradores...).
    if (!area || typeof area !== 'string' || !AREAS.includes(area)) {
      responderError(res, 400, 'Área desconocida');
      return;
    }
    const { ok: rutaOk, ruta } = normalizarRuta(cuerpo.ruta);
    if (!rutaOk) {
      responderError(res, 400, 'Ruta inválida');
      return;
    }
    const { ok: excluirOk, excluir } = normalizarExcluir(cuerpo.excluir);
    if (!excluirOk) {
      responderError(res, 400, 'Exclusión inválida');
      return;
    }

    // Anillo 1: pagina primero HILOS_POR_AREA de SUBTEMAS_MAX en SUBTEMAS_MAX, sin llamar al
    // modelo (spec §9). Sin `excluir` esto ya da la primera página (los 6 primeros hilos, igual
    // que antes de esta tarea); con `excluir`, la página siguiente son los hilos que aún no se
    // han mostrado. Solo cuando ya no queda ningún hilo estático sin excluir se cae al bloque de
    // "pedir al modelo" de más abajo -- idéntico al de un anillo ≥ 2.
    if (ruta.length === 0) {
      const excluidos = new Set(excluir);
      // Defensivo (triaje adversarial, ronda final de arreglos, 14-sep-2026): `area` ya pasó
      // `AREAS.includes(area)` unas líneas arriba, así que HOY siempre existe en HILOS_POR_AREA
      // (las dos listas coinciden) -- pero si algún día dejaran de coincidir (un área nueva en
      // AREAS sin sus hilos, o un renombrado a medias), `HILOS_POR_AREA[area]` sería `undefined` y
      // `.filter` lanzaría un 500 en vez de caer, con normalidad, al bloque de "pedir al modelo" de
      // más abajo (que no depende de ningún hilo estático).
      const hilos = HILOS_POR_AREA[area] || [];
      const restantes = hilos.filter((completo) => !excluidos.has(completo));
      if (restantes.length > 0) {
        const subtemas = restantes.slice(0, SUBTEMAS_MAX).map((completo, indice) => ({
          indice,
          corto: acortarSubtema(completo),
          completo,
        }));
        responderJson(res, 200, { subtemas });
        return;
      }
    }

    // Anillos siguientes (o anillo 1 con todos sus hilos estáticos ya excluidos): cacheados en
    // anillos.json. Sin exclusión la clave sigue siendo exactamente [area, ruta] -- la de siempre,
    // para no invalidar un anillos.json ya escrito; con exclusión se añade `excluir.length`, así
    // que cada "profundidad" de paginación (cada toque de "Más…") tiene su propia entrada de caché
    // y una sola llamada al modelo por profundidad, para siempre.
    // ONE es de un solo jugador y la exclusión crece por páginas sucesivas, así que igual longitud
    // ≈ misma página; riesgo asumido por el controlador (14-sep).
    const clave = excluir.length > 0 ? JSON.stringify([area, ruta, excluir.length]) : JSON.stringify([area, ruta]);
    const anillos = await almacen.leerAnillos();
    if (Array.isArray(anillos[clave])) {
      responderJson(res, 200, { subtemas: anillos[clave] });
      return;
    }

    // v0.2b4.1 §3: cascada propia y corta para los subtemas (dos eslabones rápidos). Antes usaba
    // MODELOS.generador entera, arrastrando su cola de eslabones lentos a una petición que el
    // jugador está mirando en el átomo con el dedo encima. `filtrarPorPago` ya no hace falta aquí:
    // MODELOS.subtemas es 100 % gratis por construcción (tests en tests/openrouter.test.js).
    const modelos = MODELOS.subtemas.filter(esModeloGratis);
    const mensajes = [
      { role: 'system', content: textoCriterio(area) },
      { role: 'user', content: promptSubtemas(area, ruta, excluir) },
    ];

    // Ronda 1 (revisión, 14-sep-2026) -- Minor: las tres formas de fallo de aquí abajo son un
    // proveedor externo que no entrega (cascada agotada, JSON inválido, o una lista vacía tras
    // filtrar), nunca un bug de este código -- 503 (mismo código y mensaje que "la cola de fondo
    // está llena" en /generar), no 500. 500 queda solo para lo que de verdad es inesperado y llega
    // al `catch` de `manejarPeticion`.
    let salida;
    try {
      salida = await llamarFn({ modelos, mensajes, json: true, permitirPago, topeEur, rutaLog });
    } catch {
      responderError(res, 503, 'Modelo no disponible, prueba en un momento');
      return;
    }

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch {
      responderError(res, 503, 'Modelo no disponible, prueba en un momento');
      return;
    }

    // Ronda 1 (revisión, 14-sep-2026) -- Important: el modelo puede ignorar la instrucción de no
    // repetir `excluir` (o repetirse a sí mismo dentro de la propia respuesta) -- se filtra y
    // deduplica aquí, comparando de forma normalizada, en vez de confiar ciegamente en el prompt.
    // Solo se cachea (más abajo) la lista YA filtrada: nunca un subtema ya visto.
    const lista = Array.isArray(datos) ? datos : Array.isArray(datos?.subtemas) ? datos.subtemas : [];
    const excluidosNormalizados = new Set(excluir.map(normalizarParaComparar));
    const vistosNormalizados = new Set();
    const completosFiltrados = [];
    for (const s of lista) {
      if (typeof s !== 'string' || !s.trim()) continue;
      const completo = s.trim();
      const normalizado = normalizarParaComparar(completo);
      if (excluidosNormalizados.has(normalizado)) continue; // ya mostrado antes (excluir)
      if (vistosNormalizados.has(normalizado)) continue; // el propio modelo se repite
      vistosNormalizados.add(normalizado);
      completosFiltrados.push(completo);
    }
    const subtemas = completosFiltrados.map((completo, indice) => ({ indice, corto: acortarSubtema(completo), completo }));

    if (subtemas.length === 0) {
      responderError(res, 503, 'Modelo no disponible, prueba en un momento');
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
    // Ronda final (revisión, 14-sep-2026) -- Menor (M6): el motivo se guarda junto al id (recortado
    // a 200 caracteres dentro de almacen.js) -- antes se aceptaba en el body y se descartaba.
    const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo : undefined;
    const resultado = await cola.reportar(cuerpo.id, motivo);
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

  // Ronda final (revisión, 14-sep-2026) -- Important (I2): PERMITIR_PAGO=1 sin (o con) un
  // TOPE_EUR_DIA de 0 desactivaría de hecho el único freno de gasto real -- tools/openrouter.js#llamar
  // solo compara "gastado hoy >= topeEur" ANTES de cada llamada de pago, así que topeEur=0 nunca
  // llega a bloquear nada (0 >= 0 sí, pero el primer euro ya se ha gastado en la llamada que lo
  // comprueba). Mejor no arrancar que arrancar con el gasto sin freno de verdad.
  if (permitirPago && !(topeEur > 0)) {
    console.error(
      'servidor: PERMITIR_PAGO=1 exige TOPE_EUR_DIA > 0 (freno de gasto real), no se puede arrancar.',
    );
    process.exit(1);
  }

  // Ronda final (revisión, 14-sep-2026) -- Critical (C1): comprobar ANTES de arrancar a escuchar
  // que se puede escribir de verdad en RUTA_DATOS -- sin esto, el contenedor podía arrancar "bien"
  // (el proceso HTTP sigue vivo) sobre un volumen sin montar, de solo lectura o sin permisos, y
  // fallar en silencio en el primer intento real de generar (o de guardar el colchón). Mensaje
  // claro y `process.exit(1)`: mejor que el contenedor no arranque a que arranque mintiendo.
  try {
    await comprobarEscritura(rutaDatos);
  } catch (err) {
    console.error(`servidor: RUTA_DATOS (${rutaDatos}) no admite escritura, no se puede arrancar: ${err?.message || err}`);
    process.exit(1);
  }

  const almacenReal = crearAlmacen(rutaDatos);
  const colaReal = crearCola({
    almacen: almacenReal,
    producirTanda,
    completarVisual,
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

  // Ronda final (revisión, 14-sep-2026) -- Menor (M1): apagado ordenado ante `docker compose down`
  // / `docker stop` (SIGTERM) o Ctrl+C en local (SIGINT). Deja de aceptar peticiones nuevas, espera
  // como mucho 20 s a que el lote de generación en curso termine (así se guarda en disco lo que ya
  // estaba a medias, en vez de perderlo a mitad de un guardado) y sale. Riesgo aceptado, documentado
  // en servidor/DESPLIEGUE.md: los `trabajoId` en curso viven solo en memoria -- tras el reinicio,
  // `GET /trabajo/:id` de un trabajo que estaba en marcha da 404 (la Entrega B2 del cliente deberá
  // tratar ese caso).
  let apagando = false;
  async function apagarOrdenado(señal) {
    if (apagando) return;
    apagando = true;
    console.error(`servidor: recibido ${señal}, cerrando de forma ordenada...`);
    servidor.closeAllConnections?.();
    await new Promise((resolve) => servidor.close(() => resolve()));
    await esperarInactividad(colaReal, 20000);
    process.exit(0);
  }
  process.on('SIGTERM', () => apagarOrdenado('SIGTERM'));
  process.on('SIGINT', () => apagarOrdenado('SIGINT'));
}
