// ONE · imagen generada con IA, último recurso (spec v0.3 §7). Compartido por el servidor y tools/.
// Cascada: Cloudflare Workers AI (FLUX schnell, tramo gratis) -> Runware solo si Cloudflare agota el
// tramo, hay RUNWARE_API_KEY y el gasto del día no pasa de 0,10 EUR. Cupo propio de 100 imágenes/día.
// Las claves llegan por `entorno` (nunca se leen de disco ni se imprimen).
//
// POLLINATIONS NO SE INTEGRA (comprobado el 12-oct-2026, plan v0.3.4 punto 13): lo único sin clave es el
// endpoint antiguo image.pollinations.ai, y con él (a) la imagen sale con la marca «pollinations.ai» pintada
// abajo a la derecha aunque se pida nologo=true, (b) ignora model=flux y sirve «sana», (c) tras una imagen
// responde 402 durante ~30-40 s (≈1 imagen cada 40 s) y (d) es un camino heredado: la API vigente
// (gen.pollinations.ai, docs en github.com/pollinations/pollinations, APIDOCS.md) exige clave y saldo
// «Pollen» de pago. Sus condiciones (pollinations.ai/terms) no dan derechos sobre las salidas («las
// licencias de los modelos varían; verifica antes del uso comercial») y prohíben «evadir los límites de uso».
// Servir imágenes con marca ajena dentro de las preguntas no cumple la regla de calidad de Esfinx.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { iaPermitida, MAX_PIXELES } from './politica-imagen.js';

export const ESTILO_ONE = 'cinematic illustration, dark background, cyan and gold accents, dramatic lighting, no text, no letters';
export const CREDITO_IA = { fuente: 'IA', autor: null, licencia: null, texto: 'Imagen generada con IA' };
export const COSTE_RUNWARE_EUR = 0.0006;
export const TOPE_DIA_EUR = 0.1;
const MAX_WEBP_BYTES = 80 * 1024;
const TIMEOUT_MS = 60000;

const PROMPT_SISTEMA =
  'You write one image-generation prompt in English (max 40 words) that illustrates the TOPIC of a quiz question ' +
  'with a striking, concrete scene. You receive the question and its answer ONLY so you can avoid it: do NOT draw, ' +
  'name or hint at the answer, and never include text, letters, numbers, logos or captions in the scene. ' +
  'NEVER depict: maps, real or identifiable people (no portraits, no famous faces), specific artworks or ' +
  'paintings, or historical scenes presented as real. Prefer an atmospheric, symbolic or abstract scene ' +
  '(objects, landscapes, anonymous silhouettes). Reply with just the prompt, no quotes.';

/**
 * Prompt en inglés para el generador; el modelo gratis ve enunciado y respuesta solo para evitarla.
 * `null` si esta pregunta no admite IA (arte; historia o geografía con mapa, persona o hecho concreto).
 */
export async function escribirPrompt(pregunta, { llamarModelo }) {
  if (!iaPermitida(pregunta)) return null;
  const usuario = `Question: ${pregunta?.enunciado ?? ''}\nAnswer (do NOT depict it): ${pregunta?.explicacion ?? pregunta?.respuesta ?? ''}`;
  const texto = await llamarModelo({ mensajes: [{ role: 'system', content: PROMPT_SISTEMA }, { role: 'user', content: usuario }] });
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[.,;\s]+$/, '');
  return `${limpio}, ${ESTILO_ONE}`;
}

const diaDe = (fecha) => fecha.toISOString().slice(0, 10);

/**
 * Cupo diario persistido en `ruta` (JSON `{dia, n, gastoEur}`). El día lo da `ahora()`.
 * Nunca falla abierto: el contador vive también en memoria y `puede()` usa el mayor entre memoria y
 * disco, así que si no se puede escribir (disco lleno, solo lectura) el tope se sigue respetando
 * mientras el proceso viva. `reservar()` ocupa un hueco ANTES de llamar al proveedor (dos peticiones
 * a la vez no pueden pasarse del tope) y `liberar()` lo devuelve si la llamada falla.
 */
export function crearCupo({ ruta, maxDia = 100, ahora = () => new Date() }) {
  let mem = { dia: null, n: 0, gastoEur: 0 };
  function leer() {
    const hoy = diaDe(ahora());
    if (mem.dia !== hoy) mem = { dia: hoy, n: 0, gastoEur: 0 };
    try {
      const e = JSON.parse(readFileSync(ruta, 'utf8'));
      if (e && e.dia === hoy) {
        mem.n = Math.max(mem.n, Number(e.n) || 0);
        mem.gastoEur = Math.max(mem.gastoEur, Number(e.gastoEur) || 0);
      }
    } catch {
      // ausente o corrupto: manda lo que hay en memoria
    }
    return mem;
  }
  function guardar(e, proveedor) {
    try {
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(ruta, JSON.stringify({ dia: e.dia, n: e.n, gastoEur: e.gastoEur, ultimo: proveedor }));
    } catch {
      // sin disco no se persiste, pero el contador en memoria sigue mandando
    }
  }
  const redondear = (x) => Math.round(x * 1e6) / 1e6;
  return {
    puede() {
      return leer().n < maxDia;
    },
    /** Ocupa un hueco del cupo; `false` si ya no queda. */
    reservar() {
      const e = leer();
      if (e.n >= maxDia) return false;
      e.n += 1;
      guardar(e, 'reserva');
      return true;
    },
    /** Devuelve un hueco reservado (y el gasto cargado) cuando la llamada al proveedor falla. */
    liberar(costeEur = 0) {
      const e = leer();
      e.n = Math.max(0, e.n - 1);
      e.gastoEur = Math.max(0, redondear(e.gastoEur - Number(costeEur || 0)));
      guardar(e, 'liberado');
    },
    /** Carga un gasto antes de llamar a un proveedor de pago; `false` si pasaría de `tope`. */
    cargarGasto(costeEur, tope) {
      const e = leer();
      if (e.gastoEur + costeEur > tope) return false;
      e.gastoEur = redondear(e.gastoEur + costeEur);
      guardar(e, 'gasto');
      return true;
    },
    apuntar(proveedor, costeEur = 0) {
      const e = leer();
      e.n += 1;
      e.gastoEur = redondear(e.gastoEur + Number(costeEur || 0));
      guardar(e, proveedor);
    },
    estadoHoy() {
      const e = leer();
      return { dia: e.dia, n: e.n, gastoHoyEur: e.gastoEur };
    },
  };
}

async function viaCloudflare(prompt, { fetchImpl, entorno }) {
  const cuenta = entorno.CLOUDFLARE_ACCOUNT_ID;
  const token = entorno.CLOUDFLARE_AI_TOKEN;
  if (!cuenta || !token) return { estado: 'sin-clave' };
  let r;
  try {
    r = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${cuenta}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { estado: 'error' };
  }
  let cuerpo = null;
  try {
    cuerpo = await r.json();
  } catch {
    // sin cuerpo
  }
  if (r.ok && cuerpo?.result?.image) return { estado: 'ok', buffer: Buffer.from(cuerpo.result.image, 'base64') };
  const texto = JSON.stringify(cuerpo?.errors ?? '');
  if (r.status === 429 || /quota|limit|neurons|exceed/i.test(texto)) return { estado: 'cuota' };
  return { estado: 'error' };
}

async function viaRunware(prompt, { fetchImpl, entorno }) {
  try {
    const r = await fetchImpl('https://api.runware.ai/v1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${entorno.RUNWARE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        taskType: 'imageInference',
        taskUUID: globalThis.crypto.randomUUID(),
        model: 'runware:100@1',
        positivePrompt: prompt,
        width: 1024,
        height: 1024,
        steps: 4,
        outputType: 'base64Data',
        outputFormat: 'JPG',
      }]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const b64 = (await r.json())?.data?.[0]?.imageBase64Data;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch {
    return null;
  }
}

/** `{ buffer, proveedor } | null`. Nunca lanza. Reserva el cupo antes de llamar y lo libera si falla. */
export async function generarImagen(prompt, { fetchImpl = fetch, entorno = process.env, cupo, ahora = () => new Date() } = {}) {
  void ahora;
  if (!prompt || !cupo.reservar()) return null;
  try {
    const cf = await viaCloudflare(prompt, { fetchImpl, entorno });
    if (cf.estado === 'ok') return { buffer: cf.buffer, proveedor: 'cloudflare' };
    if (cf.estado === 'cuota' && entorno.RUNWARE_API_KEY && cupo.cargarGasto(COSTE_RUNWARE_EUR, TOPE_DIA_EUR)) {
      const buffer = await viaRunware(prompt, { fetchImpl, entorno });
      if (buffer) return { buffer, proveedor: 'runware' };
      cupo.liberar(COSTE_RUNWARE_EUR);
      return null;
    }
  } catch {
    // cae a liberar
  }
  cupo.liberar();
  return null;
}

/** WebP de como mucho 768 px y 80 KB (calidad 80 -> 50; si aún no cabe, baja el ancho). */
export async function aWebp(buffer) {
  const { default: sharp } = await import('sharp');
  let ultimo = null;
  for (const ancho of [768, 640, 512]) {
    for (let calidad = 80; calidad >= 50; calidad -= 10) {
      ultimo = await sharp(buffer, { limitInputPixels: MAX_PIXELES }).resize({ width: ancho, height: ancho, fit: 'inside', withoutEnlargement: true }).webp({ quality: calidad }).toBuffer();
      if (ultimo.length <= MAX_WEBP_BYTES) return ultimo;
    }
  }
  return ultimo;
}
