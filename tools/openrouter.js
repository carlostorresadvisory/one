// Cliente mínimo de OpenRouter: cascada de modelos gratis → de pago barato,
// guarda anti-pago y log de coste. Sin dependencias.
import { appendFile, readFile } from 'node:fs/promises';

const URL_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const RUTA_LOG_DEFECTO = 'datos/llamadas.log';
// TODO(Step 23, v0.2b4.1): esta pausa entre eslabones se elimina en el paso que reestructura
// `llamar` para saltar en seco ante 429/503 -- se mantiene aquí solo para que el fichero cargue
// mientras los pasos intermedios (1-20) siguen usándola.
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

// Proveedores con API compatible con OpenAI y nivel gratuito SIN tarjeta, cada uno con su clave
// propia (spec §1). Generaliza el mecanismo que v0.2b3 hizo a medida para Gemini: el id de la
// cascada lleva el prefijo del proveedor ("groq:openai/gpt-oss-120b"), y el `model` del body va
// SIEMPRE sin él. Un id sin prefijo conocido es de OpenRouter, como siempre.
// Medido el 15-sep-2026 con los prompts reales (spec §0): Groq gpt-oss-120b 1,8 s, gpt-oss-20b
// 1,0 s; Gemini flash-lite 1,3 s; NVIDIA 35-72 s (último recurso); Cerebras 402 mientras no active
// su nivel gratuito -- se integra igual y la cascada lo salta solo.
const PROVEEDORES = {
  'gemini:': {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    variable: 'GEMINI_API_KEY_GRATIS',
    etiqueta: 'Gemini',
  },
  'groq:': { url: 'https://api.groq.com/openai/v1/chat/completions', variable: 'GROQ_API_KEY', etiqueta: 'Groq' },
  'nvidia:': {
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    variable: 'NVIDIA_API_KEY',
    etiqueta: 'NVIDIA',
  },
  'cerebras:': { url: 'https://api.cerebras.ai/v1/chat/completions', variable: 'CEREBRAS_API_KEY', etiqueta: 'Cerebras' },
};

/** Proveedor propio de un id de cascada, o `null` si el id es de OpenRouter. */
export function proveedorDe(modelo) {
  if (typeof modelo !== 'string') return null;
  for (const [prefijo, datos] of Object.entries(PROVEEDORES)) {
    if (modelo.startsWith(prefijo)) return { prefijo, ...datos };
  }
  return null;
}

// Defensivo (heredado de claveGeminiGratis, triaje adversarial 14-sep-2026): un `.env` con espacios
// de sobra alrededor de la clave no debe colarse en la cabecera `Authorization` ni contar como
// "hay clave" si tras el trim queda vacía.
function claveDe(variable) {
  return (process.env[variable] || '').trim();
}

// Un id con prefijo de proveedor propio es siempre gratis: son claves de nivel gratuito sin tarjeta
// (Gemini AI Studio sin facturación; Groq/NVIDIA/Cerebras free tier). Un exceso de cuota devuelve
// 429 o 402, nunca un cargo. Exportada y compartida por servidor/generacion.js y servidor/index.js.
export function esModeloGratis(id) {
  return typeof id === 'string' && (id.endsWith(':free') || proveedorDe(id) !== null);
}

// Campos de body que son EXTENSIONES de OpenRouter sobre el protocolo de OpenAI, no estándar.
// Google AI Studio valida el JSON del body de forma estricta y rechaza con HTTP 400
// `Invalid JSON payload received. Unknown name "reasoning"` cualquier nombre que no conozca, así
// que estos campos se retiran del body cuando el destino es Gemini (ola final v0.2b4, Critical C1:
// `tools/visualizar.js` manda siempre `extra: SIN_RAZONAMIENTO` y eso mataba los dos eslabones
// Gemini de la cascada visual -- 491 s y 0/4 visuales en la tanda real del 15-sep-2026).
// Lista de https://openrouter.ai/docs/api-reference/overview; los campos estándar de OpenAI
// (`temperature`, `top_p`, `response_format`, `stop`...) NO se tocan: Google los entiende.
const CAMPOS_PROPIOS_OPENROUTER = [
  'reasoning',
  'include_reasoning',
  'provider',
  'transforms',
  'route',
  'models',
  'plugins',
];

// Extras que cada proveedor necesita para NO razonar en voz alta (spec §0 y §1). No son preferencias
// de estilo: sin ellos, el modelo antepone su razonamiento al JSON y `extraerJson` falla o la
// respuesta se trunca -- exactamente el síntoma que ya obligó a SIN_RAZONAMIENTO en visualizar.js.
const EXTRA_GROQ_GPT_OSS = { reasoning_effort: 'low' };
const EXTRA_NVIDIA = { chat_template_kwargs: { thinking: false, enable_thinking: false } };
// NVIDIA necesita además el interruptor dentro del propio texto del sistema: con el
// chat_template_kwargs solo, nemotron seguía devolviendo <think> en la prueba del 15-sep.
const PREFIJO_SISTEMA_NVIDIA = '/no_think\ndetailed thinking off\n';

/**
 * Aplica al body los extras que exige el proveedor de `modelo`. Recibe y devuelve el body ENTERO
 * (incluidos `messages`) porque NVIDIA no solo añade campos: también reescribe el mensaje de
 * sistema. Un modelo sin proveedor propio (OpenRouter) sale tal cual entró.
 * @param {string} modelo id con prefijo, tal cual va en la cascada
 * @param {object} body body ya construido (model sin prefijo, messages, temperature...)
 * @returns {object} body nuevo (nunca muta el recibido)
 */
export function ajustarPeticion(modelo, body) {
  const proveedor = proveedorDe(modelo);
  if (!proveedor) return body;
  if (proveedor.prefijo === 'groq:' && String(body.model).includes('gpt-oss')) {
    return { ...body, ...EXTRA_GROQ_GPT_OSS };
  }
  if (proveedor.prefijo === 'nvidia:') {
    const mensajes = Array.isArray(body.messages) ? body.messages : [];
    const primero = mensajes[0];
    const conNoThink =
      primero && primero.role === 'system'
        ? [{ ...primero, content: PREFIJO_SISTEMA_NVIDIA + primero.content }, ...mensajes.slice(1)]
        : [{ role: 'system', content: PREFIJO_SISTEMA_NVIDIA.trim() }, ...mensajes];
    return { ...body, ...EXTRA_NVIDIA, messages: conNoThink };
  }
  return body;
}

// Resuelve a qué API va cada eslabón de la cascada: OpenRouter (por defecto) o el endpoint
// compatible con OpenAI del proveedor propio del prefijo. El body lleva el nombre del modelo SIN el
// prefijo; las cabeceras HTTP-Referer/X-Title y los campos de `camposPropiosOpenRouter` son propios
// de OpenRouter y no se mandan a ningún otro destino.
function destinoDe(modelo) {
  const proveedor = proveedorDe(modelo);
  if (proveedor) {
    const clave = claveDe(proveedor.variable);
    return {
      url: proveedor.url,
      cabeceras: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      modelBody: modelo.slice(proveedor.prefijo.length),
      // `propio` sustituye al antiguo `esGemini`: todos estos destinos son gratis (coste 0) y
      // ninguno entiende las extensiones de OpenRouter.
      propio: true,
      prefijo: proveedor.prefijo,
      clave,
      variable: proveedor.variable,
      etiqueta: proveedor.etiqueta,
      camposPropiosOpenRouter: CAMPOS_PROPIOS_OPENROUTER,
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
    propio: false,
    prefijo: '',
    clave: process.env.OPENROUTER_API_KEY || '',
    variable: 'OPENROUTER_API_KEY',
    etiqueta: 'OpenRouter',
    camposPropiosOpenRouter: [],
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
 *   modelos de razonamiento que necesitan desactivarlo explícitamente). Se aplican a todos los
 *   modelos de la cascada EXCEPTO los campos propios de OpenRouter (`CAMPOS_PROPIOS_OPENROUTER`),
 *   que se retiran del body cuando el destino es Gemini. No es cierto que "un modelo que no
 *   reconozca el campo lo ignora": Google AI Studio responde HTTP 400 `Invalid JSON payload
 *   received. Unknown name "reasoning"` (reproducido el 15-sep-2026, ver Critical C1).
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

    const destino = destinoDe(modelo);
    if (destino.propio && !destino.clave) {
      errores.push(`${modelo}: sin clave de ${destino.etiqueta} (${destino.variable})`);
      continue;
    }

    if (!primeraLlamada) {
      await esperar(PAUSA_MS);
    }
    primeraLlamada = false;

    const { url, cabeceras, modelBody, camposPropiosOpenRouter } = destino;
    const body = {
      model: modelBody,
      messages: mensajes,
      temperature: temperatura,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...extra,
    };
    // El `extra` es único para toda la cascada, pero no todos los destinos entienden lo mismo:
    // los campos propios de OpenRouter se retiran aquí para el destino que no los conoce (Gemini),
    // sin que quien llama tenga que saber a qué API va cada eslabón (Critical C1).
    for (const campo of camposPropiosOpenRouter) {
      delete body[campo];
    }
    // Los extras del proveedor se aplican DESPUÉS del borrado: `reasoning_effort` y
    // `chat_template_kwargs` son campos estándar del proveedor de destino, no extensiones de
    // OpenRouter, y no deben caer en el mismo filtro.
    const bodyFinal = ajustarPeticion(modelo, body);

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
          body: JSON.stringify(bodyFinal),
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
    // Todo destino propio es un nivel gratuito sin facturación: coste 0 aunque la respuesta traiga
    // usage.cost. Los tokens sí se registran si vienen, por informativos.
    const coste = destino.propio ? 0 : Number(usage.cost) || 0;
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
