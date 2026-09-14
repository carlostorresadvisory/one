// Cliente mínimo de OpenRouter: cascada de modelos gratis → de pago barato,
// guarda anti-pago y log de coste. Sin dependencias.
import { appendFile, readFile } from 'node:fs/promises';

const URL_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
// Endpoint compatible con OpenAI de Google AI Studio (clave GRATUITA, proyecto sin facturación:
// GEMINI_API_KEY_GRATIS). El `model` del body va SIN el prefijo "gemini:" que usamos en la
// cascada para distinguirlo de los ids de OpenRouter (ver destinoDe()).
const URL_GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const RUTA_LOG_DEFECTO = 'datos/llamadas.log';
const PAUSA_MS = 1500;
// Reintento único ante 429 (cuota agotada) o 503 (servicio saturado), visto en vivo tanto en
// modelos ':free' de OpenRouter como en Gemini gratis: a menudo el segundo intento sí responde.
// Inyectable como opción `reintentoMs` de `llamar` para que los tests no esperen 4s reales.
const REINTENTO_MS = 4000;
// Sin esto, una conexión colgada con un modelo ':free' bloquea el pipeline entero de
// forma indefinida (visto en la Tarea 4 contra la API real: más de 3 minutos sin
// respuesta ni error). 120s da margen de sobra a los modelos lentos observados
// (hasta ~90s) sin dejar que una llamada colgada pare todo el proceso.
const TIMEOUT_MS = 120000;

// Cascada de cada papel (pedida por Carlos, 12-sep): de gratis a de pago barato.
// Ids confirmados contra el catálogo público (GET /api/v1/models) el 12-sep-2026.
export const MODELOS = {
  // Cascada gratis → de pago barato → de pago (aprobada por Carlos 12-sep-2026, tope diario vía --tope-eur).
  // Gemini gratis (GEMINI_API_KEY_GRATIS, cableado 14-sep-2026) va primero: es el primer eslabón
  // gratis de la cascada, antes de los ':free' de OpenRouter.
  generador: [
    // 15-sep-2026 (tanda real tras publicar v0.2b3): Google retiró gemini-2.5-* para cuentas nuevas
    // (HTTP 404 "no longer available to new users"). Medido desde el VPS con la clave gratis:
    // gemini-flash-lite-latest 0,6 s; gemini-3.6-flash 1,2 s; gemini-flash-latest 18 s (piensa);
    // gemma-4-31b-it 32 s y mete <thought> en el JSON. Alias *-latest para sobrevivir retiradas.
    'gemini:gemini-flash-lite-latest',
    'gemini:gemini-3.6-flash',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'z-ai/glm-4.7-flash',
    'openai/gpt-5-mini',
    'google/gemini-2.5-flash',
  ],
  verificador: [
    'gemini:gemini-3.6-flash',
    'google/gemma-4-31b-it:free',
    'nex-agi/nex-n2.5-pro:free',
    'deepseek/deepseek-v4-flash',
    'z-ai/glm-4.7-flash',
    'openai/gpt-5-mini',
  ],
};

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Un id "gemini:<modelo>" es siempre gratis: es la clave de AI Studio sin facturación (el
// proyecto no puede cobrar; un exceso de cuota da 429, nunca un cargo).
// Exportada (Tarea 2, v0.2b3): servidor/generacion.js y servidor/index.js tenían cada uno su
// propio filtro "solo gratis" mirando solo ':free', así que los ids "gemini:*" nunca llegaban a
// `llamar` con permitirPago=false -- ver el informe de esa tarea.
export function esModeloGratis(id) {
  return id.endsWith(':free') || id.startsWith('gemini:');
}

// Defensivo (triaje adversarial, ronda final de arreglos, 14-sep-2026): un `.env` con espacios de
// sobra alrededor de la clave (copia-pega, salto de línea final del editor...) no debe colarse tal
// cual en la cabecera `Authorization` ni contar como "hay clave" si tras el trim queda vacía --
// `''` trim no es una clave, es ausencia de clave, aunque `process.env.GEMINI_API_KEY_GRATIS` sea
// una cadena (truthy) de solo espacios.
function claveGeminiGratis() {
  return (process.env.GEMINI_API_KEY_GRATIS || '').trim();
}

// Resuelve a qué API va cada modelo de la cascada: OpenRouter (por defecto) o el endpoint
// compatible con OpenAI de Google AI Studio para los ids "gemini:<modelo>". El body de Gemini
// lleva el nombre del modelo SIN el prefijo; las cabeceras HTTP-Referer/X-Title son propias de
// OpenRouter y no se mandan a Gemini.
function destinoDe(modelo) {
  if (modelo.startsWith('gemini:')) {
    return {
      url: URL_GEMINI_OPENAI,
      cabeceras: {
        Authorization: `Bearer ${claveGeminiGratis()}`,
        'Content-Type': 'application/json',
      },
      modelBody: modelo.slice('gemini:'.length),
    };
  }
  return {
    url: URL_CHAT,
    cabeceras: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/carlostorresadvisory/one',
      'X-Title': 'ONE',
    },
    modelBody: modelo,
  };
}

async function costeAcumuladoHoy(rutaLog) {
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
      // línea corrupta: se ignora
    }
  }
  return total;
}

// Ronda final (revisión, 14-sep-2026) -- Critical (C1): si `appendFile` falla (carpeta ausente,
// disco lleno, permisos...) esto NO debe tumbar `llamar` -- antes, un log que no se podía escribir
// hacía que `llamar` lanzara aunque el modelo hubiera respondido bien, y ni siquiera se probaba el
// siguiente de la cascada. El fallo se traga aquí con un único `console.error` (sin volcar la
// entrada entera: ya lleva modelo/coste/tokens, nada confidencial, pero tampoco hace falta
// imprimirla dos veces) y `llamar` sigue su curso normal.
async function registrarLog(rutaLog, entrada) {
  try {
    await appendFile(rutaLog, `${JSON.stringify(entrada)}\n`, 'utf8');
  } catch (err) {
    console.error(`tools/openrouter: no se pudo escribir en el log de llamadas (${err?.message || err})`);
  }
}

// Busca dónde termina el primer valor JSON completo (objeto o array) que empieza en `inicio`,
// contando profundidad de { }/[ ] y respetando comillas/escapes de las cadenas. Devuelve el
// índice del carácter de cierre, o -1 si el texto se corta antes de cerrar del todo.
function encontrarFinValorJson(texto, inicio) {
  let profundidad = 0;
  let dentroString = false;
  let escapando = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (dentroString) {
      if (escapando) escapando = false;
      else if (c === '\\') escapando = true;
      else if (c === '"') dentroString = false;
      continue;
    }
    if (c === '"') {
      dentroString = true;
      continue;
    }
    if (c === '{' || c === '[') profundidad++;
    else if (c === '}' || c === ']') {
      profundidad--;
      if (profundidad === 0) return i;
    }
  }
  return -1;
}

/**
 * Extrae un JSON de un texto que puede traer ``` alrededor o texto suelto.
 * @param {string} texto
 * @returns {any}
 */
export function extraerJson(texto) {
  let limpio = texto.trim();
  const conFences = limpio.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (conFences) {
    limpio = conFences[1].trim();
  } else {
    const inicio = limpio.search(/[[{]/);
    if (inicio !== -1) {
      // Corta en el cierre del PRIMER valor JSON completo, no en el último "}"/"]" del texto:
      // visto en vivo el 13-sep-2026 (ejecución real, google/gemini-2.5-flash-lite) que el modelo
      // a veces duplica el objeto de salida ("{...}\n{...}") y el recorte ingenuo hasta el último
      // cierre concatenaba ambos, dando "Unexpected non-whitespace character after JSON".
      const fin = encontrarFinValorJson(limpio, inicio);
      if (fin !== -1) {
        limpio = limpio.slice(inicio, fin + 1);
      } else {
        // No llegó a cerrar (respuesta truncada): mejor esfuerzo igual que antes, para no
        // regresar peor de lo que ya estaba en ese caso.
        const finArray = limpio.lastIndexOf(']');
        const finObjeto = limpio.lastIndexOf('}');
        const fin2 = Math.max(finArray, finObjeto);
        if (fin2 > inicio) limpio = limpio.slice(inicio, fin2 + 1);
      }
    }
  }
  return JSON.parse(limpio);
}

/**
 * Llama a OpenRouter recorriendo una cascada de modelos.
 * @param {object} opciones
 * @param {object} [opciones.extra] Campos adicionales para el body (p. ej. `reasoning` para
 *   modelos de razonamiento que necesitan desactivarlo explícitamente). Se aplican igual a
 *   todos los modelos de la cascada; un modelo que no reconozca el campo lo ignora.
 * @returns {Promise<{texto: string, modelo: string, coste: number, usage: object}>}
 */
export async function llamar({
  modelos,
  mensajes,
  json = false,
  temperatura = 0.7,
  maxTokens = 4000,
  permitirPago = false,
  topeEur = 0,
  fetchImpl = fetch,
  rutaLog = RUTA_LOG_DEFECTO,
  extra = {},
  reintentoMs = REINTENTO_MS,
}) {
  const errores = [];
  let primeraLlamada = true;

  for (const modelo of modelos) {
    if (!esModeloGratis(modelo) && !permitirPago) {
      errores.push(`${modelo}: pago desactivado (falta --permitir-pago)`);
      continue;
    }

    if (!esModeloGratis(modelo) && permitirPago) {
      const acumulado = await costeAcumuladoHoy(rutaLog);
      // Estimación conservadora previa a la llamada: si ya se ha superado el tope, no se llama.
      if (acumulado >= topeEur) {
        errores.push(`${modelo}: tope de gasto superado (${acumulado} >= ${topeEur})`);
        continue;
      }
    }

    const esGemini = modelo.startsWith('gemini:');
    if (esGemini && !claveGeminiGratis()) {
      errores.push(`${modelo}: sin clave de Gemini`);
      continue;
    }

    if (!primeraLlamada) {
      await esperar(PAUSA_MS);
    }
    primeraLlamada = false;

    const { url, cabeceras, modelBody } = destinoDe(modelo);
    const body = {
      model: modelBody,
      messages: mensajes,
      temperature: temperatura,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...extra,
    };

    // Reintento único ante 429/503 (cuota agotada o servicio saturado): se ve a menudo tanto en
    // los ':free' de OpenRouter como en Gemini gratis, y un segundo intento suele bastar.
    let respuesta;
    let motivoRed = null;
    let yaReintentado = false;
    for (;;) {
      try {
        respuesta = await fetchImpl(url, {
          method: 'POST',
          headers: cabeceras,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        motivoRed = err.name === 'TimeoutError' ? `sin respuesta en ${TIMEOUT_MS / 1000}s` : err.message;
        respuesta = null;
        break;
      }
      if (respuesta.ok) break;
      if (!yaReintentado && (respuesta.status === 429 || respuesta.status === 503)) {
        yaReintentado = true;
        await esperar(reintentoMs);
        continue;
      }
      break;
    }

    if (motivoRed) {
      errores.push(`${modelo}: error de red (${motivoRed})`);
      await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste: 0, tokens: 0, ok: false, motivo: `red: ${motivoRed}` });
      continue;
    }

    if (!respuesta.ok) {
      errores.push(`${modelo}: HTTP ${respuesta.status}`);
      await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste: 0, tokens: 0, ok: false, motivo: `HTTP ${respuesta.status}` });
      continue;
    }

    let datos;
    try {
      datos = await respuesta.json();
    } catch (err) {
      errores.push(`${modelo}: respuesta no es JSON (${err.message})`);
      await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste: 0, tokens: 0, ok: false, motivo: 'respuesta no es JSON' });
      continue;
    }

    const texto = datos?.choices?.[0]?.message?.content ?? '';
    const usage = datos?.usage ?? {};
    // Gemini gratis (GEMINI_API_KEY_GRATIS) es un proyecto sin facturación: coste siempre 0 aunque
    // la respuesta traiga usage.cost. Los tokens sí se registran si vienen, por informativos.
    const coste = esGemini ? 0 : Number(usage.cost) || 0;
    const tokens = (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);

    if (json) {
      try {
        extraerJson(texto);
      } catch (err) {
        errores.push(`${modelo}: JSON inválido (${err.message})`);
        await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste, tokens, ok: false, motivo: `JSON inválido: ${String(err.message).slice(0, 80)}` });
        continue;
      }
    }

    await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste, tokens, ok: true });

    return { texto, modelo, coste, usage };
  }

  throw new Error(`Ningún modelo respondió. Detalle: ${errores.join(' | ')}`);
}
