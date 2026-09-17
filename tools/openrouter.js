// Cliente mínimo de OpenRouter: cascada de modelos gratis → de pago barato,
// guarda anti-pago y log de coste. Sin dependencias.
import { appendFile, readFile } from 'node:fs/promises';
import { cuotaGlobal, estimarTokens } from './cuota.js';

const URL_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const RUTA_LOG_DEFECTO = 'datos/llamadas.log';
// Reintento único ante 429 (cuota agotada) o 503 (servicio saturado), visto en vivo tanto en
// modelos ':free' de OpenRouter como en Gemini gratis: a menudo el segundo intento sí responde.
// Inyectable como opción `reintentoMs` de `llamar` para que los tests no esperen 4s reales.
const REINTENTO_MS = 4000;
/**
 * T1 (minor, ola final v0.2b4.1): tope de la espera del último recurso. Si el proveedor mandó
 * `retry-after`, se le obedece (es la única fuente fiable de "cuándo vuelvo a estar"), pero nunca
 * más de esto: una tanda urgente entera cabe en 60 s, y un `retry-after: 60` no puede convertirse
 * en un minuto de pantalla parada -- para eso está el resto de la cascada.
 */
export const TOPE_ESPERA_REINTENTO_MS = 10000;
// Sin esto, una conexión colgada con un modelo ':free' bloquea el pipeline entero de
// forma indefinida (visto en la Tarea 4 contra la API real: más de 3 minutos sin
// respuesta ni error). 120s da margen de sobra a los modelos lentos observados
// (hasta ~90s) sin dejar que una llamada colgada pare todo el proceso.
const TIMEOUT_MS = 120000;

// Cascadas por papel. Todas 100 % gratis (spec §2: los de pago siguen prohibidos, PERMITIR_PAGO=0).
// Tiempos medidos el 15-sep-2026 con los prompts reales de ONE (spec §0), no estimados:
//   gemini-flash-lite-latest 1,3 s (y aguanta todo el día) · gemini-3.6-flash 1,2 s, pero agota su
//   cuota diaria por la tarde · groq gpt-oss-120b 1,8/1,5 s · gpt-oss-20b 1,0/0,95 s ·
//   groq qwen3.8-27b 5,8 s y 429 a la segunda · NVIDIA 35-72 s · Cerebras 402 mientras no active su
//   nivel gratuito · los ':free' de OpenRouter, minuto y medio o fallo.
// El orden no es una preferencia: una tanda de 10 con visuales son ~35.000 tokens y Groq da 8.000
// por minuto POR MODELO, así que la cascada reparte a propósito entre modelos y proveedores
// distintos, y tools/cuota.js remata el reparto con lo que va midiendo en vivo.
export const MODELOS = {
  generador: [
    'gemini:gemini-flash-lite-latest',
    'groq:openai/gpt-oss-120b',
    'groq:openai/gpt-oss-20b',
    'cerebras:gpt-oss-120b',
    'gemini:gemini-3.6-flash',
    // Ola final v0.2b4.1 (I2): 'nvidia/nemotron-3-ultra-550b-a55b:free' se quitó de aquí -- medido
    // el 15-sep, un parón de 118,9 s en ese eslabón DENTRO de una tanda urgente. Sigue en
    // `generadorFondo`, que es donde un eslabón de minuto y medio no le cuesta nada a nadie.
    'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
    // 17-sep-2026 (Carlos: "dejamos ONE funcionando"): con la cuota gratis del día agotada en
    // Gemini, Groq y gemma (429/503 en cadena, visto en /opt/one-datos/llamadas.log), los únicos
    // eslabones vivos eran nemotron de NVIDIA (28-100 s) y nex-n2.5 (gratis, ~20 s). Sin este
    // último recurso la tanda urgente se quedaba en "0 de 10" para siempre.
    'nex-agi/nex-n2.5-pro:free',
  ],
  // Nunca el mismo primer eslabón que `generador`: producirTanda excluye al modelo que generó el
  // lote, y si coincidieran, el verificador se quedaría empezando por su segundo eslabón siempre.
  verificador: [
    'groq:openai/gpt-oss-120b',
    'gemini:gemini-3.6-flash',
    'groq:qwen/qwen3.8-27b',
    'cerebras:gpt-oss-120b',
    'gemini:gemini-flash-lite-latest',
    'google/gemma-4-31b-it:free',
    'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
    // Mismo motivo que en `generador` (17-sep-2026): último recurso gratis DISTINTO de nemotron,
    // porque producirTanda excluye al modelo que generó el lote y, agotado todo lo demás, nemotron
    // era a la vez el único generador y el único verificador posible -> lote sin verificar.
    'nex-agi/nex-n2.5-pro:free',
  ],
  // Los subtemas del átomo son una lista corta de texto: no hace falta más cascada que dos
  // eslabones rápidos (v0.2b3 los pedía a MODELOS.generador entera, con su cola de pago detrás).
  subtemas: ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-20b'],
  // Colchón nocturno (2:00-7:00) y cualquier trabajo de fondo: nadie está esperando, así que se usa
  // lo LENTO a propósito -- NVIDIA y los ':free' -- y la cuota rápida de Groq/Gemini se reserva
  // intacta para las tandas del día, que son las que el jugador sí espera (spec §3).
  generadorFondo: [
    'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'gemini:gemini-flash-lite-latest',
    'groq:openai/gpt-oss-20b',
  ],
  verificadorFondo: [
    'nvidia:openai/gpt-oss-20b',
    'google/gemma-4-31b-it:free',
    'nex-agi/nex-n2.5-pro:free',
    'gemini:gemini-3.6-flash',
    'groq:openai/gpt-oss-120b',
  ],
};

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * T1 (minor, ola final v0.2b4.1): cuánto esperar antes del reintento del último recurso. Hasta
 * ahora eran 4 s fijos, decididos sin datos; si el eslabón saturado dijo en su `retry-after`
 * cuándo vuelve, esa cifra es mejor que cualquier constante -- más corta casi siempre (Groq suele
 * pedir 1-3 s) y, cuando es más larga, acotada a TOPE_ESPERA_REINTENTO_MS. Sin sugerencia real del
 * proveedor se conserva el valor de siempre.
 * @param {{esperaSugeridaMs?: (modelo: string) => number}} cuota registro de tools/cuota.js
 * @param {string} modelo eslabón saturado que se va a reintentar
 * @param {number} reintentoMs espera por defecto
 * @returns {number}
 */
export function esperaDeReintento(cuota, modelo, reintentoMs) {
  const sugerida = typeof cuota?.esperaSugeridaMs === 'function' ? cuota.esperaSugeridaMs(modelo) : 0;
  if (!Number.isFinite(sugerida) || sugerida <= 0) return reintentoMs;
  return Math.min(sugerida, TOPE_ESPERA_REINTENTO_MS);
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

// Un 402 (sin plan), 404 (id retirado) o 410 (id desaparecido) es un "no" definitivo de ESE
// eslabón: reintentarlo es tiempo tirado. Un 429/503 es un "ahora no": se salta igual, pero el
// eslabón queda apuntado por si al final de la cascada no hubo suerte con ninguno.
const ESTADOS_SATURADO = new Set([429, 503]);

/**
 * Llama a OpenRouter recorriendo una cascada de modelos.
 * @param {object} opciones
 * @param {object} [opciones.extra] Campos adicionales para el body (p. ej. `reasoning` para
 *   modelos de razonamiento que necesitan desactivarlo explícitamente). Se aplican a todos los
 *   modelos de la cascada EXCEPTO los campos propios de OpenRouter (`CAMPOS_PROPIOS_OPENROUTER`),
 *   que se retiran del body cuando el destino es propio (Gemini/Groq/NVIDIA/Cerebras). No es
 *   cierto que "un modelo que no reconozca el campo lo ignora": Google AI Studio responde HTTP 400
 *   `Invalid JSON payload received. Unknown name "reasoning"` (reproducido el 15-sep-2026, ver
 *   Critical C1).
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
  // Ola final v0.2b4.1 (I1/I2): plazo máximo de ESTA llamada. Por defecto los 120 s de siempre (el
  // fondo no tiene prisa); las cascadas urgentes pasan 60 s, porque ahí hay un jugador mirando el
  // indicador y esperar dos minutos a un eslabón que va a fallar igual es peor que saltar al
  // siguiente (medido el 15-sep: 118,9 s parado en nvidia/nemotron-3-ultra:free dentro de una
  // tanda urgente). Un valor no finito o <= 0 cae al defecto: "sin plazo" nunca es una opción.
  timeoutMs = TIMEOUT_MS,
  // Ola final v0.2b4.1 (#3, adversarial): señal de quien llama para cancelar la llamada entera
  // (servidor/generacion.js#conLimite la dispara cuando el visual se pasa de su plazo). Se combina
  // con el plazo propio de cada intento: lo que llegue antes, aborta el `fetch`. Un abort de FUERA
  // detiene la cascada entera -- si nadie espera ya el resultado, probar el siguiente eslabón solo
  // gastaría cuota; el plazo propio, en cambio, sigue saltando de eslabón en eslabón como siempre.
  signal = null,
  // Solo para los tests: contar que la espera del último recurso ocurre UNA vez (con reintentoMs:0
  // no se puede medir por reloj) y con cuántos ms. En producción no lo pasa nadie.
  alEsperar = () => {},
  // Registro de cuota por eslabón (spec §2): por defecto el compartido del proceso, para que una
  // tanda entera reparta con lo que ya aprendió de llamadas anteriores. Inyectable para que cada
  // test tenga el suyo y no se contaminen entre sí (nunca `cuotaGlobal.olvidar()` desde un test).
  cuota = cuotaGlobal,
}) {
  const errores = [];
  const saturados = [];
  const msLimite = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : TIMEOUT_MS;
  const abortadoFuera = () => signal?.aborted === true;

  // Plazo propio de ESTE intento combinado con la señal de quien llama. `AbortSignal.any` existe en
  // Node 20+; el controlador propio es la red por si el entorno no lo trae.
  function senalDelIntento() {
    const porPlazo = AbortSignal.timeout(msLimite);
    if (!signal) return porPlazo;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([porPlazo, signal]);
    const controlador = new AbortController();
    const abortar = () => controlador.abort();
    if (signal.aborted) abortar();
    else signal.addEventListener('abort', abortar, { once: true });
    porPlazo.addEventListener('abort', abortar, { once: true });
    return controlador.signal;
  }

  // Devuelve {ok:true, salida} | {ok:false, saturado}. Nunca lanza: todo fallo se anota en
  // `errores` y se decide fuera si queda algo que probar.
  async function intentarModelo(modelo) {
    if (!esModeloGratis(modelo) && !permitirPago) {
      errores.push(`${modelo}: pago desactivado (falta --permitir-pago)`);
      return { ok: false, saturado: false };
    }
    if (!esModeloGratis(modelo) && permitirPago) {
      const acumulado = await costeAcumuladoHoy(rutaLog);
      if (acumulado >= topeEur) {
        errores.push(`${modelo}: tope de gasto superado (${acumulado} >= ${topeEur})`);
        return { ok: false, saturado: false };
      }
    }

    const destino = destinoDe(modelo);
    if (destino.propio && !destino.clave) {
      errores.push(`${modelo}: sin clave de ${destino.etiqueta} (${destino.variable})`);
      return { ok: false, saturado: false };
    }

    const body = {
      model: destino.modelBody,
      messages: mensajes,
      temperature: temperatura,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...extra,
    };
    for (const campo of destino.camposPropiosOpenRouter) delete body[campo];
    const bodyFinal = ajustarPeticion(modelo, body);

    let respuesta;
    try {
      respuesta = await fetchImpl(destino.url, {
        method: 'POST',
        headers: destino.cabeceras,
        body: JSON.stringify(bodyFinal),
        signal: senalDelIntento(),
      });
    } catch (err) {
      const motivo = abortadoFuera()
        ? 'abortada por quien llamó'
        : err.name === 'TimeoutError'
          ? `sin respuesta en ${msLimite / 1000}s`
          : err.message;
      errores.push(`${modelo}: error de red (${motivo})`);
      await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste: 0, tokens: 0, ok: false, motivo: `red: ${motivo}` });
      return { ok: false, saturado: false };
    }

    // La cuota se alimenta de TODA respuesta, buena o mala: un 200 dice cuánto queda, un 429 dice
    // cuánto hay que esperar. Va antes del `if (!respuesta.ok)` para que también se registren las
    // saturaciones, que son justo las que más información dan.
    cuota.registrarRespuesta(modelo, respuesta);

    if (!respuesta.ok) {
      errores.push(`${modelo}: HTTP ${respuesta.status}`);
      await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste: 0, tokens: 0, ok: false, motivo: `HTTP ${respuesta.status}` });
      return { ok: false, saturado: ESTADOS_SATURADO.has(respuesta.status) };
    }

    let datos;
    try {
      datos = await respuesta.json();
    } catch (err) {
      errores.push(`${modelo}: respuesta no es JSON (${err.message})`);
      await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste: 0, tokens: 0, ok: false, motivo: 'respuesta no es JSON' });
      return { ok: false, saturado: false };
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
        return { ok: false, saturado: false };
      }
    }

    await registrarLog(rutaLog, { fecha: new Date().toISOString(), modelo, coste, tokens, ok: true });
    return { ok: true, salida: { texto, modelo, coste, usage } };
  }

  // Un intento por eslabón, sin ninguna pausa entre ellos: saltar es SIEMPRE más rápido que
  // esperar mientras queden candidatos (spec §1). La pausa de cortesía de 1,5 s de v0.2b1 se
  // elimina: costaba hasta 9 s por cascada agotada y no evitaba ningún 429 medible.
  //
  // Spec §2: "llamar lo consulta antes de cada intento". No es reordenar la cascada una vez al
  // principio -- entre el eslabón 1 y el 3 pueden haber pasado dos respuestas que cambian quién
  // tiene hueco, y `elegirModelo` ve siempre el estado del momento.
  const tokensEstimados = estimarTokens(mensajes, maxTokens);
  const pendientes = [...modelos];
  while (pendientes.length > 0) {
    // #3: si quien llamó ya no espera la respuesta, no se empieza ningún eslabón más.
    if (abortadoFuera()) break;
    const modelo = cuota.elegirModelo(pendientes, tokensEstimados);
    pendientes.splice(pendientes.indexOf(modelo), 1);
    // v0.2b4.1 §2 (M2, ronda de corrección 1): reserva ANTES del intento, se libera SIEMPRE al
    // terminar (en el `finally`, pase lo que pase -- éxito, HTTP de error, o una excepción de red).
    // Sin esto, una ráfaga de `llamar` concurrentes que comparten `cuota` (producirTanda con
    // `enParalelo`) elegían todas el mismo primer eslabón, porque `elegirModelo`/`hayHueco` solo
    // sabían de respuestas YA recibidas -- ninguna de las llamadas en vuelo había respondido
    // todavía cuando las demás decidían.
    cuota.reservar(modelo, tokensEstimados);
    let resultado;
    try {
      resultado = await intentarModelo(modelo);
    } finally {
      cuota.liberar(modelo, tokensEstimados);
    }
    if (resultado.ok) return resultado.salida;
    if (resultado.saturado) saturados.push(modelo);
  }

  // Último recurso: ya no queda ningún eslabón sin probar. SOLO aquí tiene sentido esperar, y solo
  // para los que dijeron "ahora no" (429/503) -- un 402/404/410 no cambia por esperar.
  if (saturados.length > 0 && !abortadoFuera()) {
    const msEspera = esperaDeReintento(cuota, saturados[0], reintentoMs);
    alEsperar(msEspera);
    await esperar(msEspera);
    const resultado = await intentarModelo(saturados[0]);
    if (resultado.ok) return resultado.salida;
  }

  if (abortadoFuera()) {
    throw new Error(`Llamada abortada por quien la pidió. Detalle: ${errores.join(' | ')}`);
  }
  throw new Error(`Ningún modelo respondió. Detalle: ${errores.join(' | ')}`);
}
