// Pipeline puro de generación de preguntas del servidor (Tarea 1 del plan v0.2b1-servidor).
// Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.1 y §3.4.
//
// "La verificación nunca se salta, se esconde" (Carlos, 12-sep): nada entra en el colchón sin
// pasar (a) verificarBorradores por un modelo DISTINTO del generador, (b) validarPregunta, (c)
// resolverPregunta (explicación corta + visual, verificados por otro modelo). Este fichero solo
// produce -- no toca disco (eso es servidor/almacen.js y servidor/cola.js, Tareas 2-3).
//
// Todas las funciones aceptan `opciones.llamar` inyectable (por defecto tools/openrouter.js#llamar)
// para que los tests no hagan red, siguiendo el mismo patrón que tools/visualizar.js#resolverPregunta.
// OPENROUTER_API_KEY solo se lee dentro de tools/openrouter.js; aquí nunca se lee ni se registra.
//
// Ronda 1 (corrección del controlador, 14-sep-2026): la primera versión de esta tarea solo
// generaba tipo "vf" -- defecto del plan/brief, no una decisión de producto. Ahora `producirTanda`
// reparte `n` entre los 4 tipos con la misma proporción que MEZCLA de motor.js (import de solo
// lectura; motor.js no se toca) y `generarBorradores` acepta `tipo` para pedir cualquiera de los 4
// con su prompt y esquema correspondientes -- igual que hace hoy tools/generar-preguntas.js, sin
// duplicar su lógica de generación por área más allá de lo imprescindible (esquemaTipo/promptUsuario
// se reconstruyen aquí porque esa CLI no los exporta).
//
// Ronda 2 (revisión del controlador, 14-sep-2026): un tipo que agota su cascada de generación ya no
// aborta la tanda entera -- generarBorradores tolera el fallo de un lote suelto (no pierde lo que
// ya consiguió) y solo propaga el error si NINGÚN lote de ese tipo dio nada; producirTanda convierte
// eso en una entrada de `fallos` y sigue con los demás tipos. `promptUsuarioVF` (el prompt preciso
// del reparto 50/50 de "vf") se movió a tools/prompts-preguntas.js: es lógica de generación de
// preguntas, no del pipeline, y este fichero solo debía importar prompts, no definirlos.
import { llamar as llamarReal, extraerJson, MODELOS, esModeloGratis } from '../tools/openrouter.js';
import { validarPregunta } from '../tools/validar-banco.js';
import {
  resolverPregunta,
  GENERADOR_SOLO_PAGO,
  VERIFICADOR_SOLO_PAGO,
  GENERADOR_VISUAL,
  VERIFICADOR_VISUAL,
  GENERADOR_VISUAL_FONDO,
  VERIFICADOR_VISUAL_FONDO,
} from '../tools/visualizar.js';
import {
  promptSistemaGenerador,
  promptUsuarioVF,
  PROMPT_SISTEMA_VERIFICADOR,
  EJEMPLOS,
} from '../tools/prompts-preguntas.js';
import { HILOS_POR_AREA } from '../tools/criterio.js';
import { MEZCLA } from '../motor.js';

// Duplicado a propósito de PREFIJOS en tools/generar-preguntas.js: ese fichero es una CLI, no un
// módulo compartido (mismo motivo por el que tools/visualizar.js duplica AREAS de
// tools/validar-banco.js) -- son 8 literales, no vale la pena una dependencia cruzada por esto.
const PREFIJOS = {
  economia: 'eco',
  historia: 'his',
  ciencia: 'cie',
  tecnologia: 'tec',
  geografia: 'geo',
  filosofia: 'fil',
  arte: 'art',
  logica: 'log',
};

const TIPOS = ['vf', 'test4', 'ordenar', 'error'];

// Ronda final (revisión, 14-sep-2026) -- Menor (M4): lista blanca de campos de CONTENIDO al
// construir un borrador desde lo que devolvió el modelo. Antes `{...bruto}` copiaba cualquier
// campo que el modelo alucinara (o intentara colar) directamente al pipeline, a colchon.json y a la
// respuesta de la API -- id/area/tipo/generador/confianza/verificado los pone siempre este código,
// nunca el modelo, así que ni siquiera hace falta que estén en la lista.
// Nota: la lista original del brief de esta ronda ("id, area, tipo, nivel, enunciado, explicacion,
// opciones, correcta, respuesta, items, criterio, hilo, visual") se olvidaba de "tarjeta" y
// "sospechoso" -- los dos campos propios del tipo "error" (ver esquemaTipo más abajo). Sin ellos,
// producirTanda: cada tipo llega al verificador con su forma... (test ya existente) detectó la
// pérdida al momento: el borrador de tipo "error" llegaba sin tarjeta/sospechoso al verificador.
// Añadidos aquí para que los 4 tipos conserven todos sus campos de contenido.
const CAMPOS_CONTENIDO_PREGUNTA = [
  'nivel',
  'enunciado',
  'explicacion',
  'opciones',
  'correcta',
  'respuesta',
  'items',
  'criterio',
  'hilo',
  'visual',
  'tarjeta',
  'sospechoso',
];

function soloCamposContenido(bruto) {
  const limpio = {};
  for (const campo of CAMPOS_CONTENIDO_PREGUNTA) {
    if (bruto && bruto[campo] !== undefined) limpio[campo] = bruto[campo];
  }
  return limpio;
}

// Tamaños de lote de la spec §3.4: 5 preguntas por llamada de generación ("los gratis truncan con
// 10", mismo síntoma que TAMANO_SUBLOTE en generar-preguntas.js), 4 por llamada de verificación
// (idéntico a TAMANO_LOTE en verificar-preguntas.js). Los lotes de verificación pueden mezclar
// tipos (igual que la CLI mezcla áreas): se verifica la lista combinada de los 4 tipos.
const TAMANO_LOTE_GENERACION = 5;
const TAMANO_LOTE_VERIFICACION = 4;
const UMBRAL_CONFIANZA_DEFECTO = 0.7;

// v0.2b4.1 §4: topes de concurrencia de una tanda urgente. No son "cuanto más, mejor": cada
// llamada en vuelo consume de la MISMA cuota por minuto (8.000 tokens/min por modelo en Groq), así
// que pasarse de aquí no acelera, solo convierte el trabajo en 429 en cadena. 4 lotes = los 4 tipos
// de pregunta a la vez; 5 visuales = la mitad de una tanda de 10, repartidos entre dos proveedores.
export const MAX_LOTES_EN_VUELO = 4;
export const MAX_VISUALES_EN_VUELO = 5;
/** Timeout del visual dentro de una tanda urgente (spec §5): pasado esto, la pregunta se sirve sin
 * él y un trabajo de fondo lo completa después (Tarea 4). Nunca se aplica al colchón. */
export const TIMEOUT_VISUAL_MS = 20000;
/**
 * Ola final v0.2b4.1 (I1/I2): plazo máximo de CADA llamada dentro de una tanda urgente -- los
 * cuatro pasos (generación, verificación, visual y verificación del visual). El plazo general de
 * `tools/openrouter.js` son 120 s, pensados para el fondo; con un jugador mirando el indicador,
 * esperar dos minutos a un eslabón que va a fallar igual es lo peor que se puede hacer (medido en
 * vivo el 15-sep: 118,9 s parado en nvidia/nemotron-3-ultra:free DENTRO de una tanda urgente).
 * Pasados estos 30 s la cascada salta al siguiente eslabón, que normalmente responde en 1-2 s.
 */
export const TIMEOUT_LLAMADA_URGENTE_MS = 30000;
/**
 * Ola final v0.2b4.1 (I3): a partir de aqui, una tanda urgente ya NO intenta reponer lo que el
 * verificador rechazo. El objetivo es "10 verificadas en menos de 60 s": con 45 s ya gastados, una
 * ronda extra (generar + verificar + visual) se comeria el minuto entero, y el jugador prefiere 8
 * preguntas ya que 10 dentro de tres minutos.
 */
export const MS_MAX_REPOSICION = 45000;

/**
 * Ejecuta `fn` sobre `items` con como mucho `tope` en vuelo a la vez, devolviendo los resultados
 * EN EL ORDEN DE ENTRADA (no en el de terminación) y sin que un fallo cancele a los demás: cada
 * posición trae `{ok: true, valor}` o `{ok: false, error}`. Es el `Promise.all` con tope de la
 * spec §4, escrito aquí porque no hay dependencias en este repo y porque `Promise.all` a secas
 * lanzaría las 10 llamadas de golpe contra una cuota de 8.000 tokens/minuto.
 * @param {any[]} items
 * @param {number} tope
 * @param {(item: any, indice: number) => Promise<any>} fn
 * @returns {Promise<{ok: boolean, valor?: any, error?: string}[]>}
 */
export async function enParalelo(items, tope, fn) {
  const lista = Array.isArray(items) ? items : [];
  const resultados = new Array(lista.length);
  let siguiente = 0;
  const trabajador = async () => {
    for (;;) {
      const indice = siguiente++;
      if (indice >= lista.length) return;
      try {
        resultados[indice] = { ok: true, valor: await fn(lista[indice], indice) };
      } catch (err) {
        resultados[indice] = { ok: false, error: err?.message || String(err) };
      }
    }
  };
  // M5 (ronda de corrección 1): un `tope` no numérico (NaN, Infinity, undefined...) no debe colarse
  // en el cálculo de la longitud del array de workers -- `Array.from({length: NaN})` da longitud 0,
  // es decir CERO trabajadores y ningún item procesado nunca. Se trata como 1 (secuencial, la
  // opción segura), nunca como "sin límite" ni como "no hacer nada".
  const topeSeguro = Number.isFinite(tope) ? tope : 1;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, topeSeguro), lista.length) }, trabajador));
  return resultados;
}

/**
 * v0.2b4.1 §5: corre lo que devuelve `crearPromesa(signal)` con un límite de tiempo. Devuelve
 * `null` si se pasa. `ms <= 0` significa "sin límite" -- se devuelve la promesa tal cual, sin
 * envolverla (el `signal` se pasa igualmente, pero nadie lo va a disparar).
 *
 * Ola final v0.2b4.1 (#3, adversarial): además de dejar de esperar, ahora ABORTA. Antes la llamada
 * que se pasaba del plazo seguía viva contra el modelo: gastaba cuota de la ventana del minuto por
 * una respuesta que ya nadie iba a mirar y, con 5 visuales en vuelo (`enParalelo`), alimentaba
 * justo los 429 en cadena que la tanda intenta evitar. `crearPromesa` recibe el `signal` del
 * AbortController que esta función crea y lo baja hasta `tools/openrouter.js#llamar`, que lo
 * combina con su propio plazo; la reserva de cuota se libera en el `finally` de `llamar`, pase lo
 * que pase.
 *
 * El temporizador se cancela (`clearTimeout`) en cuanto CUALQUIERA de las dos partes gana la
 * carrera, y `unref()` evita que, si llegara a disparar, retenga el proceso vivo por su cuenta.
 * `Promise.race` deja un manejador puesto en la promesa huérfana, así que su rechazo posterior
 * (el abort) nunca sale como `unhandledRejection`.
 * @param {(signal: AbortSignal) => Promise<any>} crearPromesa
 * @param {number} ms
 * @returns {Promise<any|null>}
 */
export function conLimite(crearPromesa, ms) {
  const controlador = new AbortController();
  const promesa = crearPromesa(controlador.signal);
  if (!(ms > 0)) return promesa;
  let idTimeout;
  const limite = new Promise((resolver) => {
    idTimeout = setTimeout(() => {
      controlador.abort();
      resolver(null);
    }, ms);
    idTimeout.unref?.();
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(idTimeout));
}

// Cascadas de pago barato para preguntas, análogas a GENERADOR_SOLO_PAGO/VERIFICADOR_SOLO_PAGO de
// tools/visualizar.js (spec §3.1: "un par análogo para preguntas"). Un solo modelo de pago cada
// una, de proveedores distintos entre sí (para que generador y verificador nunca coincidan sin
// necesidad de excluirModelo) y ya vetados en este repo: 'z-ai/glm-4.7-flash' es el escalón de pago
// más barato de MODELOS.generador; 'deepseek/deepseek-v4-flash' es el más barato de
// MODELOS.verificador (ver comentario de precios en tools/visualizar.js, 13-sep-2026). Aceptados
// por el controlador como valor por defecto en la ronda 1 de esta tarea (14-sep-2026) --
// PENDIENTE DE CONFIRMAR CON CARLOS antes de activar PERMITIR_PAGO=1 en producción.
export const GENERADOR_PREGUNTAS_SOLO_PAGO = ['z-ai/glm-4.7-flash'];
export const VERIFICADOR_PREGUNTAS_SOLO_PAGO = ['deepseek/deepseek-v4-flash'];

// Filtra la cascada a solo modelos gratis (`esModeloGratis`, tools/openrouter.js -- ':free' o
// prefijo "gemini:") cuando permitirPago es false. A diferencia de tools/openrouter.js#llamar (que
// se salta cada modelo de pago uno a uno según los va probando), aquí se filtra ANTES de llamar: el
// brief exige que, con permitirPago=false, nunca se pase un modelo de pago a `llamar`, ni siquiera
// como candidato descartado.
function filtrarPorPago(modelos, permitirPago) {
  return permitirPago ? modelos : modelos.filter(esModeloGratis);
}

function partirEnLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

// Ronda final (revisión, 14-sep-2026) -- Adversarial (A9): agrupa por `generador` ANTES de partir
// en lotes de verificación. Sin esto, un lote de 4 podía mezclar borradores de generadores
// distintos (posible si sub-lotes de generarBorradores cayeron a modelos distintos de la cascada, o
// si dos tipos usaron modelos distintos) y `excluirModelo` (más abajo) solo mira el generador del
// PRIMER borrador del lote -- los demás podían acabar verificados por su propio generador, la
// regla fija de Carlos que esto viola. Agrupando primero, cada lote es homogéneo: `excluirModelo`
// excluye correctamente al generador de TODOS los borradores de ese lote, no solo del primero.
function agruparPorGenerador(borradores) {
  const grupos = new Map();
  for (const b of borradores) {
    const clave = b.generador || '';
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(b);
  }
  return [...grupos.values()];
}

// Igual que repartirEnSublotes() en tools/generar-preguntas.js (duplicado a propósito: ese fichero
// es una CLI, no un módulo compartido).
function repartirEnSublotes(cantidad, tamano) {
  const partes = [];
  let restante = cantidad;
  while (restante > 0) {
    const parte = Math.min(tamano, restante);
    partes.push(parte);
    restante -= parte;
  }
  return partes;
}

/**
 * Reparte `n` preguntas entre los 4 tipos con la misma proporción que MEZCLA de motor.js (vf 3,
 * test4 4, ordenar 2, error 1 por cada 10). motor.js no se toca: tiene una función interna
 * `objetivoTipos()` que hace este mismo reparto proporcional con ajuste de resto, pero no está
 * exportada, así que se reconstruye aquí (mismo algoritmo: redondeo proporcional + reparte la
 * diferencia por orden de peso descendente). Garantía añadida por el controlador (ronda 1): al
 * menos 1 "test4" cuando n >= 2, para que ni siquiera una tanda pequeña del átomo se quede sin
 * variedad de tipos.
 * @param {number} n
 * @returns {{vf: number, test4: number, ordenar: number, error: number}}
 */
export function repartoPorTipo(n) {
  const tipos = Object.keys(MEZCLA);
  const total = Object.values(MEZCLA).reduce((a, b) => a + b, 0);
  const objetivo = {};
  let asignado = 0;
  for (const tipo of tipos) {
    objetivo[tipo] = Math.round((MEZCLA[tipo] / total) * n);
    asignado += objetivo[tipo];
  }

  let diferencia = n - asignado;
  const ordenPeso = [...tipos].sort((a, b) => MEZCLA[b] - MEZCLA[a]);
  let i = 0;
  while (diferencia !== 0 && ordenPeso.length > 0) {
    const tipo = ordenPeso[i % ordenPeso.length];
    if (diferencia > 0) {
      objetivo[tipo] += 1;
      diferencia -= 1;
    } else if (objetivo[tipo] > 0) {
      objetivo[tipo] -= 1;
      diferencia += 1;
    }
    i++;
  }

  // Al menos 1 test4 si n >= 2 (variedad mínima en tandas pequeñas del átomo, ronda 1 del
  // controlador): se resta 1 al tipo con más preguntas asignadas para no alterar la suma total.
  if (n >= 2 && objetivo.test4 === 0) {
    const donante = tipos.filter((t) => t !== 'test4' && objetivo[t] > 0).sort((a, b) => objetivo[b] - objetivo[a])[0];
    if (donante) {
      objetivo[donante] -= 1;
      objetivo.test4 += 1;
    }
  }

  return objetivo;
}

let contadorIdInterno = 0;
const LETRAS = 'abcdefghijklmnopqrstuvwxyz';

// Formato de la spec §3.2: srv-<prefijoArea>-<base36 de Date.now()><2 letras aleatorias>. Un lote
// se genera en un bucle síncrono, así que varias preguntas del mismo lote comparten Date.now() en
// milisegundos; sumamos un contador interno monótono a la marca de tiempo para que esa parte nunca
// choque dentro de este proceso (las 2 letras siguen siendo aleatorias, tal cual pide la spec, pero
// la unicidad real no depende de que no choquen).
function generarIdServidor(prefijo) {
  const marca = (Date.now() + contadorIdInterno++).toString(36);
  const l1 = LETRAS[Math.floor(Math.random() * LETRAS.length)];
  const l2 = LETRAS[Math.floor(Math.random() * LETRAS.length)];
  return `srv-${prefijo}-${marca}${l1}${l2}`;
}

// Mismo esquema por tipo que esquemaTipo() en tools/generar-preguntas.js (duplicado a propósito:
// esa CLI no lo exporta). El caso "vf" no se usa en la práctica (promptUsuarioPorTipo, más abajo,
// da a "vf" un prompt más preciso con el reparto 50/50 ya calculado); se deja aquí solo por
// fidelidad con la CLI.
function esquemaTipo(tipo, numHilos) {
  const hilo = `, "hilo": 1..${numHilos} (número del hilo de la lista de arriba en el que encaja)`;
  switch (tipo) {
    case 'vf':
      return (
        `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "respuesta": true|false${hilo} }. ` +
        'OBLIGATORIO: exactamente la mitad de las afirmaciones con "respuesta": false. Las falsas deben ser ' +
        'plausibles (un dato, fecha, autor o relación cambiados por otro verosímil), nunca absurdas ni obvias.'
      );
    case 'test4':
      return `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "opciones": ["s","s","s","s"], "correcta": 0..3${hilo} }`;
    case 'ordenar':
      return `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "criterio": "de menor a mayor …", "items": ["s","s","s","s"]${hilo} }`;
    case 'error':
      return `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "tarjeta": { "titulo": "s", "filas": [{"etiqueta":"s","valor":"s"}, …3..5] }, "sospechoso": índice${hilo} }`;
    default:
      return '';
  }
}

// Igual que promptUsuario(area, tipo, cantidad) en tools/generar-preguntas.js, para los 3 tipos
// que no son "vf" (ese sí tiene su propio prompt más preciso, ver promptUsuarioVF).
function promptUsuarioGenerico(area, tipo, cantidad, numHilos) {
  return (
    `Área: ${area}. Tipo de pregunta: ${tipo}. Genera ${cantidad} preguntas nuevas, ` +
    `repartidas entre los niveles 1 a 5 (una o dos por nivel). Responde con un objeto ` +
    `JSON {"preguntas": [ ... ]} donde cada elemento del array "preguntas" tiene ` +
    `exactamente este esquema:\n${esquemaTipo(tipo, numHilos)}\n` +
    `Ejemplo válido de un elemento (no lo repitas, es solo formato):\n${JSON.stringify(EJEMPLOS[tipo])}`
  );
}

function promptUsuarioPorTipo(area, tipo, cantidad, numHilos) {
  if (tipo === 'vf') {
    const mitad = Math.floor(cantidad / 2);
    const resto = cantidad - mitad;
    return promptUsuarioVF(cantidad, mitad, resto, numHilos);
  }
  return promptUsuarioGenerico(area, tipo, cantidad, numHilos);
}

/**
 * Genera `n` borradores de un tipo dado (por defecto "vf", verdadero/falso con reparto 50/50) para
 * un área, opcionalmente centrados en una ruta del átomo y evitando enunciados recientes. Una
 * función pura: no valida, no verifica y no toca disco -- solo llama al generador y da forma al
 * borrador (id, area, tipo, generador, confianza:null, verificado:false).
 * @param {object} params
 * @param {string} params.area una de validar-banco.js#AREAS
 * @param {string[]} [params.ruta] ruta del átomo (ver promptSistemaGenerador)
 * @param {number} [params.n] cuántos borradores pedir (por defecto 10)
 * @param {'vf'|'test4'|'ordenar'|'error'} [params.tipo] por defecto 'vf'
 * @param {number} [params.nivelObjetivo] 1-5, opcional
 * @param {string[]} [params.evitar] enunciados recientes a no repetir
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar] inyectable para tests; por defecto tools/openrouter.js#llamar
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {string[]} [opciones.modelos] cascada a usar; por defecto MODELOS.generador
 * @param {{coste: number}} [opciones.acumulador] si se pasa, se le suma el coste de cada llamada
 *   (así producirTanda puede sumar el coste total sin que este fichero cambie la forma exacta de
 *   retorno que pide el brief: `borradores[]`, un array plano).
 * @returns {Promise<object[]>}
 */
export async function generarBorradores(params, opciones = {}) {
  const { area, ruta = [], n = 10, tipo = 'vf', nivelObjetivo, evitar = [] } = params || {};
  const {
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    rutaLog,
    modelos = MODELOS.generador,
    acumulador,
    // I1/I2: plazo por llamada. `undefined` = el que trae por defecto tools/openrouter.js#llamar.
    timeoutMs,
  } = opciones;

  const prefijo = PREFIJOS[area];
  if (!prefijo) {
    throw new Error(`generarBorradores: área desconocida: ${area}`);
  }
  if (!TIPOS.includes(tipo)) {
    throw new Error(`generarBorradores: tipo desconocido: ${tipo}`);
  }
  if (n <= 0) return [];

  const numHilos = (HILOS_POR_AREA[area] || []).length || 1;
  const sistema = promptSistemaGenerador(area, { ruta, nivelObjetivo, evitar });
  const modelosFiltrados = filtrarPorPago(modelos, permitirPago);

  // Ronda 2 (controlador, 14-sep-2026): cada lote se intenta con su propio try/catch, igual que ya
  // hace verificarBorradores con los suyos -- si un lote falla (cascada agotada, red...) no se
  // pierden los borradores que YA se consiguieron en lotes anteriores de esta misma llamada. Solo
  // si TODOS los lotes de esta llamada fallan (borradores.length sigue en 0 al terminar) se
  // propaga el último error: eso es "la cascada se agota en este tipo", y producirTanda lo
  // convierte en una entrada de `fallos` en vez de abortar la tanda entera.
  const borradores = [];
  let ultimoError = null;
  for (const tamanoLote of repartirEnSublotes(n, TAMANO_LOTE_GENERACION)) {
    const mensajes = [
      { role: 'system', content: sistema },
      { role: 'user', content: promptUsuarioPorTipo(area, tipo, tamanoLote, numHilos) },
    ];

    let salida;
    try {
      salida = await llamarFn({
        modelos: modelosFiltrados,
        mensajes,
        json: true,
        permitirPago,
        topeEur,
        timeoutMs,
        ...(rutaLog ? { rutaLog } : {}),
      });
    } catch (err) {
      ultimoError = err;
      continue;
    }
    if (acumulador) acumulador.coste += salida.coste || 0;

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch (err) {
      ultimoError = err;
      continue;
    }
    const lista = Array.isArray(datos) ? datos : datos.preguntas || [];

    // Ola final v0.2b4.1 (C3): el modelo puede devolver MÁS de lo que se le pidió -- medido en
    // vivo el 15-sep-2026: un lote de fondo que pidió 4 produjo 14. Lo que sobra no es gratis: se
    // verifica (llamadas de lotes de 4), se resuelve con su visual (2 llamadas por pregunta) y se
    // guarda en el colchón, así que un solo lote desbocado puede triplicar el tiempo del trabajo y
    // dejar a un urgente esperando detrás. El tope es el de ESTE sub-lote, no el `n` de la llamada
    // entera (los sub-lotes siguientes traen los suyos).
    for (const bruto of lista.slice(0, tamanoLote)) {
      borradores.push({
        ...soloCamposContenido(bruto),
        id: generarIdServidor(prefijo),
        area,
        tipo,
        generador: salida.modelo,
        confianza: null,
        verificado: false,
      });
    }
  }

  if (borradores.length === 0 && ultimoError) {
    throw ultimoError;
  }

  return borradores;
}

// Igual que promptUsuario(lote) en tools/verificar-preguntas.js: cada tipo lleva al verificador
// solo los campos que le hacen falta para juzgarlo (duplicado a propósito, esa CLI no lo exporta).
function promptUsuarioVerificador(lote) {
  const resumen = lote.map((p) => {
    const base = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion };
    if (p.tipo === 'vf') base.respuesta = p.respuesta;
    if (p.tipo === 'test4') {
      base.opciones = p.opciones;
      base.correcta = p.correcta;
    }
    if (p.tipo === 'ordenar') {
      base.criterio = p.criterio;
      base.items = p.items;
    }
    if (p.tipo === 'error') {
      base.tarjeta = p.tarjeta;
      base.sospechoso = p.sospechoso;
    }
    return base;
  });
  return `Verifica estas ${lote.length} preguntas:\n${JSON.stringify(resumen)}`;
}

/**
 * Verifica una lista de borradores (de cualquiera de los 4 tipos, pueden venir mezclados en el
 * mismo lote, igual que la CLI mezcla áreas) con un modelo DISTINTO del que generó cada lote (lotes
 * de 4, `excluirModelo` = borrador.generador). Una sola llamada por lote que devuelve
 * correcta/unica/inequivoca/cumpleUtilidad/nivel/confianza/motivo (spec §3.1: sustituye a las tres
 * pasadas de la CLI).
 * @param {object[]} borradores
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar]
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {number} [opciones.umbral] confianza mínima para aprobar; por defecto 0.7
 * @param {string[]} [opciones.modelos] cascada a usar; por defecto MODELOS.verificador
 * @param {{coste: number}} [opciones.acumulador]
 * @returns {Promise<{id: string, ok: boolean, nivel: number|null, motivo: string, modelo: string|null}[]>}
 */
export async function verificarBorradores(borradores, opciones = {}) {
  const {
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    rutaLog,
    umbral = UMBRAL_CONFIANZA_DEFECTO,
    modelos = MODELOS.verificador,
    acumulador,
    timeoutMs, // I1/I2, igual que en generarBorradores
  } = opciones;

  const resultados = [];
  // A9: agrupar por generador ANTES de partir en lotes de 4 -- ver agruparPorGenerador más arriba.
  const lotes = agruparPorGenerador(borradores).flatMap((grupo) => partirEnLotes(grupo, TAMANO_LOTE_VERIFICACION));

  for (const lote of lotes) {
    if (lote.length === 0) continue;

    // excluirModelo = el generador del lote (spec §3.4.2). Si el lote mezclara generadores
    // distintos (posible si un sub-lote de generarBorradores cayó a otro modelo de la cascada, o
    // si dos tipos distintos usaron modelos distintos), se usa el del primer borrador -- caso raro
    // y sin mejor heurística sin complicar el contrato.
    const excluirModelo = lote[0]?.generador || null;
    let candidatos = excluirModelo ? modelos.filter((m) => m !== excluirModelo) : modelos.slice();

    // Ronda final (revisión, 14-sep-2026) -- Adversarial (A1), regla fija de Carlos: "el
    // verificador NUNCA es el generador". La primera versión, si excluir al generador dejaba la
    // cascada vacía, revertía a la cascada COMPLETA -- lo que podía devolver a incluir al propio
    // generador, justo lo que esta regla prohíbe (nunca debía haberse aceptado así). Ahora: con
    // `permitirPago`, se usa el par dedicado de pago barato (VERIFICADOR_PREGUNTAS_SOLO_PAGO, de
    // un proveedor distinto por diseño del generador de pago barato -- ver comentario de la
    // constante más arriba); sin `permitirPago`, no hay ningún verificador legítimo que probar y el
    // lote se rechaza entero, sin llamar a nadie.
    if (candidatos.length === 0) {
      candidatos = permitirPago ? VERIFICADOR_PREGUNTAS_SOLO_PAGO.filter((m) => m !== excluirModelo) : [];
      if (candidatos.length === 0) {
        for (const b of lote) {
          resultados.push({ id: b.id, ok: false, nivel: null, confianza: null, motivo: 'sin verificador distinto del generador', modelo: null });
        }
        continue;
      }
    }
    const modelosFiltrados = filtrarPorPago(candidatos, permitirPago);

    const mensajes = [
      { role: 'system', content: PROMPT_SISTEMA_VERIFICADOR },
      { role: 'user', content: promptUsuarioVerificador(lote) },
    ];

    let salida;
    try {
      salida = await llamarFn({
        modelos: modelosFiltrados,
        mensajes,
        json: true,
        permitirPago,
        topeEur,
        timeoutMs,
        ...(rutaLog ? { rutaLog } : {}),
      });
    } catch (err) {
      for (const b of lote) {
        resultados.push({ id: b.id, ok: false, nivel: null, confianza: null, motivo: `lote fallido: ${err.message}`, modelo: null });
      }
      continue;
    }
    if (acumulador) acumulador.coste += salida.coste || 0;

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch (err) {
      for (const b of lote) {
        resultados.push({ id: b.id, ok: false, nivel: null, confianza: null, motivo: `JSON inválido: ${err.message}`, modelo: salida.modelo });
      }
      continue;
    }

    const listaResultados = Array.isArray(datos) ? datos : datos.resultados || [];
    const idsDelLote = new Set(lote.map((b) => b.id));
    const vistos = new Set();

    for (const r of listaResultados) {
      if (!idsDelLote.has(r.id)) continue;
      vistos.add(r.id);
      const nivel = Number.isInteger(r.nivel) ? r.nivel : null;
      // Ronda final (revisión, 14-sep-2026) -- Adversarial (A2): `cumpleUtilidad !== false` dejaba
      // pasar un campo AUSENTE (undefined !== false -- true) igual que un `false` explícito del
      // verificador debía rechazar -- inconsistente con los otros tres booleanos, que sí exigen
      // `=== true`. Un verificador que no responde ese campo no ha confirmado nada: se trata igual
      // que si hubiera dicho que no.
      const ok =
        r.correcta === true &&
        r.unica === true &&
        r.inequivoca === true &&
        r.cumpleUtilidad === true &&
        Number(r.confianza) >= umbral;
      // Ronda final (revisión, 14-sep-2026) -- Menor (M5): se expone `confianza` en el veredicto
      // para que producirTanda pueda copiarla a la pregunta final (antes se calculaba para decidir
      // `ok` y se descartaba, perdiendo un dato real del verificador).
      const confianza = Number.isFinite(Number(r.confianza)) ? Number(r.confianza) : null;
      resultados.push({
        id: r.id,
        ok,
        nivel,
        confianza,
        motivo: ok ? '' : r.motivo || 'no aprobada por el verificador',
        modelo: salida.modelo,
      });
    }
    for (const b of lote) {
      if (!vistos.has(b.id)) {
        resultados.push({ id: b.id, ok: false, nivel: null, confianza: null, motivo: 'sin resultado del verificador', modelo: salida.modelo });
      }
    }
  }

  return resultados;
}

/**
 * Pipeline completo de una tanda: reparte `n` entre los 4 tipos (repartoPorTipo, misma proporción
 * que MEZCLA de motor.js) → genera cada tipo con generarBorradores → junta todo → verifica →
 * validarPregunta → resolverPregunta (spec §3.4). La verificación nunca se salta: nada llega a
 * `aprobadas` sin pasar por las tres.
 * @param {object} params
 * @param {string} params.area
 * @param {string[]} [params.ruta]
 * @param {number} [params.n] por defecto 10
 * @param {number} [params.nivelObjetivo]
 * @param {string[]} [params.evitar]
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar]
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {boolean} [opciones.urgente] con permitirPago, antepone las cascadas de pago barato
 *   (GENERADOR_PREGUNTAS_SOLO_PAGO/VERIFICADOR_PREGUNTAS_SOLO_PAGO y, para el visual,
 *   GENERADOR_SOLO_PAGO/VERIFICADOR_SOLO_PAGO de tools/visualizar.js) a las normales -- Ronda final
 *   (revisión, 14-sep-2026) -- Important (I2): antes las SUSTITUÍA, así que si el único modelo de
 *   pago barato de ese papel fallaba (agotado, red...), la tanda urgente se quedaba sin ningún
 *   modelo más que probar aunque `permitirPago` siguiera activo y la cascada normal (gratis + pago)
 *   tuviera más candidatos detrás. Ahora la cascada efectiva es `[...pago barato, ...normal]`: se
 *   sigue intentando primero lo rápido/barato pensado para "el jugador está esperando", pero nunca
 *   se pierde el resto de la cascada normal como red de seguridad.
 * @param {number} [opciones.timeoutVisualMs] v0.2b4.1 §5: por defecto TIMEOUT_VISUAL_MS (20 s).
 *   Solo se aplica con `urgente: true` -- un trabajo de fondo nunca tiene prisa, ver `limiteVisual`
 *   más abajo. Pasado este tiempo, el visual de esa candidata se descarta (la llamada sigue viva,
 *   su resultado se ignora) y la pregunta sale con `visual: null, visualPendiente: true`.
 * @returns {Promise<{
 *   aprobadas: object[], rechazadas: {borrador: object, motivo: string}[], coste: number,
 *   modelos: string[], fallos: {tipo: string, motivo: string}[], pedidas: number, obtenidas: number,
 * }>} `fallos` lleva un elemento por tipo cuya generación agotó del todo su cascada (ver
 *   generarBorradores); `pedidas` es el `n` pedido y `obtenidas` los borradores que sí se
 *   generaron (antes de verificar/validar) -- así la cola (Task 2) puede marcar el trabajo
 *   "parcial" u homogéneo sin tener que adivinarlo a partir de `aprobadas`. Cada elemento de
 *   `aprobadas` lleva `visualPendiente: boolean` (v0.2b4.1 §5): `true` cuando el visual no llegó a
 *   tiempo (o su cascada falló del todo) y queda para que un trabajo de fondo lo complete.
 *
 * Nota sobre permitirPago=false: generarBorradores/verificarBorradores (código de esta tarea)
 * filtran su cascada a solo ':free' antes de llamar. El paso de visual (resolverPregunta, ya
 * existente en tools/visualizar.js, fuera de esta tarea) no filtra por su cuenta -- sigue confiando
 * en que tools/openrouter.js#llamar se salte cada modelo de pago uno a uno, como ya hacía antes de
 * este plan; ese comportamiento tiene sus propios tests en tests/visualizar.test.js y no se toca.
 */
export async function producirTanda(params, opciones = {}) {
  const { area, ruta = [], n = 10, nivelObjetivo, evitar = [] } = params || {};
  const {
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    rutaLog,
    urgente = false,
    onProgreso,
    // v0.2b4.1 §5: timeout del visual SOLO para una tanda urgente (ver `limiteVisual` en fase 2).
    timeoutVisualMs = TIMEOUT_VISUAL_MS,
    // Ola final v0.2b4.1 (C2): "¿hay alguien esperando ahora mismo?". La inyecta servidor/cola.js
    // (`() => colaUrgente.length > 0`) y SOLO se consulta en modo fondo -- ver `cortarPorUrgente`.
    hayUrgente = null,
    // Ola final v0.2b4.1 (I3): cuanto tiempo puede llevar ya el lote para que todavia merezca la
    // pena una ronda de reposicion. `reloj` es inyectable solo para los tests (aqui no hay red).
    msMaxReposicion = MS_MAX_REPOSICION,
    reloj = () => Date.now(),
  } = opciones;

  const usaPagoBarato = urgente && permitirPago;
  // v0.2b4.1 §3: quién espera decide qué cascada se usa. Urgente = el jugador mirando el indicador,
  // así que lo rápido y gratis (Gemini flash-lite + Groq). Fondo = colchón nocturno, nadie espera:
  // NVIDIA y los ':free', para llegar a la mañana siguiente con la cuota rápida entera.
  const cascadas = urgente
    ? {
        generador: MODELOS.generador,
        verificador: MODELOS.verificador,
        visualGenerador: GENERADOR_VISUAL,
        visualVerificador: VERIFICADOR_VISUAL,
      }
    : {
        generador: MODELOS.generadorFondo,
        verificador: MODELOS.verificadorFondo,
        visualGenerador: GENERADOR_VISUAL_FONDO,
        visualVerificador: VERIFICADOR_VISUAL_FONDO,
      };
  // v0.2b4.1 §4 (ronda de corrección 1 -- I1): la concurrencia también depende de quién espera, no
  // solo los modelos. Una tanda urgente sigue paralela (MAX_LOTES_EN_VUELO/MAX_VISUALES_EN_VUELO);
  // el colchón nocturno procesa SECUENCIAL (tope 1) -- si no, dispara 4 generaciones + 5 visuales de
  // golpe contra NVIDIA y los ':free', justo los eslabones con menos margen y sin nadie esperando.
  const topeLotes = urgente ? MAX_LOTES_EN_VUELO : 1;
  const topeVisuales = urgente ? MAX_VISUALES_EN_VUELO : 1;
  // I1/I2: en una tanda urgente, ninguna llamada de ningún paso puede llevarse más de 30 s (ver
  // TIMEOUT_LLAMADA_URGENTE_MS). `undefined` deja el plazo por defecto de `llamar` (120 s), que es
  // el que quiere el fondo: ahí nadie espera y un eslabón lento sigue siendo mejor que ninguno.
  const timeoutLlamadaMs = urgente ? TIMEOUT_LLAMADA_URGENTE_MS : undefined;
  const acumulador = { coste: 0 };
  const modelosUsados = new Set();
  const rechazadas = [];
  const aprobadas = [];
  const fallos = [];
  // I3: `obtenidas` y los enunciados ya vistos se acumulan entre las dos pasadas (ver `pasada`).
  let obtenidas = 0;
  const enunciadosGenerados = [];
  const inicio = reloj();

  // --- helpers compartidos por las dos pasadas (ver `pasada` e I3, mas abajo) --------------------

  // v0.2b4.1 6 (ronda de correccion 1 -- I2): el indicador del movil debe poder mostrar 1..10, no
  // 0/5/10. `avisarProgreso` se llama DENTRO de `fn` (mas abajo), al terminar cada candidata
  // individual -- NUNCA en un `.forEach` posterior a `await enParalelo(...)`, que corre sincrono
  // DESPUES de que las `topeVisuales` promesas ya se resolvieron todas (ese era el bug: con las 5
  // llamadas terminando "a la vez" en el mismo tick de after-await, GET /trabajo/:id nunca veia
  // valores intermedios reales, solo 0 -> 5 -> 10). El contador es una variable compartida por
  // closure: el incremento es sincrono, sin ningun `await` de por medio, asi que no hay condicion
  // de carrera aunque varias candidatas "terminen" en el mismo tick de JS (single-threaded).
  // I3: las repuestas de la ronda extra cuentan igual -- son preguntas de esta misma tanda.
  const progreso = { verificadas: 0 };
  function avisarProgreso() {
    progreso.verificadas = Math.min(progreso.verificadas + 1, n);
    try {
      onProgreso?.({ verificadas: progreso.verificadas, pedidas: n });
    } catch {
      // Un fallo en el callback de quien llama nunca puede tumbar la tanda a medias.
    }
  }

  // v0.2b4.1 5: en una tanda URGENTE el visual tiene `timeoutVisualMs` (20 s por defecto);
  // pasados, la pregunta se sirve sin el, marcada `visualPendiente`, y un trabajo de fondo lo
  // completa despues (servidor/cola.js#completarVisualesPendientes). Nunca al reves: el jugador
  // prefiere 10 preguntas jugables en 60 s a 10 completas en 5 minutos. En un trabajo de FONDO no
  // hay limite: nadie espera y el visual sale entero a la primera.
  const limiteVisual = urgente ? timeoutVisualMs : 0;

  // Ola final v0.2b4.1 (C2): ha llegado un urgente mientras este lote de FONDO trabajaba? Medido
  // en vivo el 15-sep: un urgente espero 5 m 23 s detras de UN solo lote de fondo -- el trabajador
  // ya cede entre lotes (servidor/cola.js), pero un lote con concurrencia 1 y cascadas lentas dura
  // minutos el solo. Se consulta en el UNICO punto donde cortar no pierde nada: la fase de
  // visuales. Cada candidata ya esta generada, verificada y validada, asi que la que se corta sale
  // con `visualPendiente: true` y el trabajo de fondo de la cola le pone el visual despues. La
  // guarda esta dentro de `fn`, asi que se evalua ANTES DEL PRIMER visual (el corte "entre fases":
  // si el urgente ya estaba ahi, no se empieza ninguno) y ANTES DE CADA UNO DE LOS SIGUIENTES (el
  // corte "entre visuales"). Cortar ANTES -- entre generacion y verificacion -- si perderia
  // trabajo ya pagado: el lote se cierra igual en `hechas` (ejecutarUnLote, `finally`), asi que
  // esos borradores no volverian a intentarse nunca. Un urgente NUNCA cede (seria cederse a si
  // mismo): la guarda exige `!urgente`.
  const cortarPorUrgente = () => !urgente && typeof hayUrgente === 'function' && hayUrgente() === true;

  /**
   * UNA pasada completa del pipeline para `cuantas` preguntas: generar (los 4 tipos en paralelo) ->
   * verificar -> validar -> visual. Acumula en `aprobadas`/`rechazadas`/`fallos`/`modelosUsados`/
   * `acumulador` (no devuelve nada nuevo: la forma de retorno de producirTanda no cambia). Es una
   * funcion porque I3 la llama DOS veces: la segunda para reponer lo que el verificador rechazo.
   * @param {number} cuantas
   * @param {string[]} evitarAhora enunciados a no repetir (los de la peticion + los ya generados)
   */
  async function pasada(cuantas, evitarAhora) {
    const reparto = repartoPorTipo(cuantas);
    const tipos = Object.keys(reparto).filter((tipo) => reparto[tipo] > 0);
    // v0.2b4.1 4: los cuatro tipos ya no se generan uno detras de otro. Son llamadas
    // independientes (cada una con su prompt y su sub-lote) y a proveedores que aguantan
    // concurrencia: en serie costaban 4 x 1,8 s solo de generacion. El tope evita disparar de
    // golpe contra la cuota.
    const porTipo = await enParalelo(tipos, topeLotes, (tipo) =>
      generarBorradores(
        { area, ruta, n: reparto[tipo], tipo, nivelObjetivo, evitar: evitarAhora },
        {
          llamar: llamarFn,
          permitirPago,
          topeEur,
          rutaLog,
          acumulador,
          timeoutMs: timeoutLlamadaMs,
          modelos: usaPagoBarato ? [...GENERADOR_PREGUNTAS_SOLO_PAGO, ...cascadas.generador] : cascadas.generador,
        },
      ),
    );

    let borradores = [];
    porTipo.forEach((resultado, i) => {
      // Misma semantica que el try/catch de antes: un tipo que agota su cascada se anota en
      // `fallos` y NO se lleva por delante a los otros tres (una tanda parcial es mejor que
      // ninguna).
      if (resultado.ok) borradores = borradores.concat(resultado.valor);
      else fallos.push({ tipo: tipos[i], motivo: resultado.error });
    });
    obtenidas += borradores.length;
    for (const b of borradores) {
      if (b.generador) modelosUsados.add(b.generador);
      if (typeof b.enunciado === 'string' && b.enunciado) enunciadosGenerados.push(b.enunciado);
    }

    // Se verifica la lista COMBINADA de los 4 tipos: los lotes de 4 pueden mezclar tipos, igual que
    // la CLI mezcla areas dentro de un mismo lote de verificacion.
    const veredictos = await verificarBorradores(borradores, {
      llamar: llamarFn,
      permitirPago,
      topeEur,
      rutaLog,
      acumulador,
      timeoutMs: timeoutLlamadaMs,
      modelos: usaPagoBarato ? [...VERIFICADOR_PREGUNTAS_SOLO_PAGO, ...cascadas.verificador] : cascadas.verificador,
    });
    const veredictoPorId = new Map(veredictos.map((v) => [v.id, v]));

    // Fase 1 (sincrona, sin red): aplicar veredictos y validar. Lo que sobrevive pasa a la fase 2.
    const candidatas = [];
    for (const borrador of borradores) {
      const veredicto = veredictoPorId.get(borrador.id);
      if (!veredicto) {
        rechazadas.push({ borrador, motivo: 'sin veredicto del verificador' });
        continue;
      }
      if (veredicto.modelo) modelosUsados.add(veredicto.modelo);
      if (!veredicto.ok) {
        rechazadas.push({ borrador, motivo: veredicto.motivo || 'no aprobada por el verificador' });
        continue;
      }
      const candidata = {
        ...borrador,
        nivel: Number.isInteger(veredicto.nivel) ? veredicto.nivel : borrador.nivel,
        confianza: typeof veredicto.confianza === 'number' ? veredicto.confianza : borrador.confianza,
        verificado: true,
        verificador: veredicto.modelo,
      };
      const erroresValidacion = validarPregunta(candidata);
      if (erroresValidacion.length > 0) {
        rechazadas.push({ borrador: candidata, motivo: `validarPregunta: ${erroresValidacion.join('; ')}` });
        continue;
      }
      candidatas.push(candidata);
    }

    // Fase 2: el visual de cada candidata, EN PARALELO (spec 4). Era el bucle secuencial mas caro
    // de la tanda: 10 preguntas x (generar + verificar + a veces reintento) una detras de otra. La
    // pausa de 1 s entre preguntas desaparece de aqui -- PAUSA_ENTRE_PREGUNTAS_MS sigue viva en la
    // CLI offline de tools/visualizar.js, que es donde tiene sentido ser cortes con la cascada.
    const resueltas = await enParalelo(candidatas, topeVisuales, async (candidata) => {
      try {
        // C2: hay un jugador esperando -- esta pregunta sale ya, sin visual y marcada pendiente.
        if (cortarPorUrgente()) return null;
        const resolucion = await conLimite(
          (senal) => resolverPregunta(candidata, {
            llamar: llamarFn,
            permitirPago,
            topeEur,
            rutaLog,
            timeoutMs: timeoutLlamadaMs,
            // #3: si el plazo del visual vence, esta señal corta las llamadas que sigan en vuelo.
            signal: senal,
            necesitaVisual: true,
            saltarAcortado: true,
            modelosGenerador: usaPagoBarato ? [...GENERADOR_SOLO_PAGO, ...cascadas.visualGenerador] : cascadas.visualGenerador,
            modelosVerificador: usaPagoBarato
              ? [...VERIFICADOR_SOLO_PAGO, ...cascadas.visualVerificador]
              : cascadas.visualVerificador,
          }),
          limiteVisual,
        );
        return resolucion; // `null` si se paso del limite (solo posible con `urgente`)
      } finally {
        // Se avisa cuando la candidata esta DE VERDAD terminada -- con su visual resuelto,
        // descartado, o pasado el limite de tiempo -- tanto si `resolverPregunta` acabo bien como
        // si lanzo. Las tres ramas siguen (mas abajo) dejando la pregunta en `aprobadas`, asi que
        // las tres cuentan como "una mas" para el indicador de progreso del movil.
        avisarProgreso();
      }
    });

    resueltas.forEach((resultado, i) => {
      const candidata = candidatas[i];
      // `resultado.ok === false` = la cascada de visuales lanzo (agotada); `resultado.valor ===
      // null` = `conLimite` se paso del tiempo. Los dos casos entran sin visual y marcados
      // `visualPendiente` -- reintentar un visual que fallo por cascada agotada es exactamente lo
      // que el trabajo de fondo sabe hacer bien (cascada distinta, sin prisa), igual que el que no
      // llego a tiempo.
      const resolucion = resultado.ok ? resultado.valor : null;
      if (resolucion) {
        acumulador.coste += resolucion.coste || 0;
        if (resolucion.modeloGenerador) modelosUsados.add(resolucion.modeloGenerador);
        if (resolucion.modeloVerificador) modelosUsados.add(resolucion.modeloVerificador);
        aprobadas.push({
          ...candidata,
          explicacion: resolucion.explicacion,
          visual: resolucion.visual,
          // Un visual que el verificador RECHAZO no esta pendiente: esta decidido que no lo lleva.
          // Solo se marca pendiente lo que no llego a tiempo o lo que fallo del todo (ver arriba).
          visualPendiente: false,
        });
      } else {
        // Ola final v0.2b4.1 (M2), documentado a propósito: de un visual que se pasó del plazo (o
        // cuya cascada falló) NO se contabiliza nada en `coste` ni en `modelos`, ni siquiera las
        // llamadas que SÍ habían respondido antes del abort. `resolverPregunta` acumula su coste
        // dentro y solo lo devuelve al terminar entera, así que al abortarla ese dato se pierde
        // con ella. Hoy no tiene consecuencia práctica -- las cascadas de visual son 100 % gratis
        // (coste 0) y `modelos` es informativo --, y arreglarlo de verdad exigiría cambiar la
        // forma de retorno de resolverPregunta (tools/visualizar.js, fuera del alcance de esta
        // ola). Queda anotado aquí para que nadie lea `coste` como "todo lo que se llamó".
        aprobadas.push({ ...candidata, visual: null, visualPendiente: true });
      }
    });
  }

  await pasada(n, evitar);

  // Ola final v0.2b4.1 (I3) -- ruling del controlador: "10 preguntas" significa 10 VERIFICADAS, no
  // "las que sobrevivan". El verificador rechaza de verdad (medido el 15-sep: tandas de 10 que
  // entregaban 8-9), y hasta ahora lo rechazado simplemente faltaba en la tanda del jugador. UNA
  // sola ronda extra, y solo si sobra tiempo: reponer es mejor que entregar de menos, pero nunca a
  // costa de convertir una tanda de 40 s en una de tres minutos -- por eso el tope de tiempo y el
  // "una y no mas" (sin el, un verificador que rechaza todo seria un bucle infinito). Solo en modo
  // urgente: en el fondo nadie espera y el colchon vuelve a pedir lo que falte en la pasada
  // siguiente.
  const faltan = n - aprobadas.length;
  if (urgente && faltan > 0 && reloj() - inicio < msMaxReposicion) {
    await pasada(faltan, [...evitar, ...enunciadosGenerados]);
  }

  return {
    aprobadas,
    rechazadas,
    coste: acumulador.coste,
    modelos: [...modelosUsados],
    fallos,
    pedidas: n,
    obtenidas,
  };
}

/**
 * v0.2b4.1 §5: completa el visual de UNA pregunta que salió de una tanda urgente sin él
 * (`visualPendiente: true`). Es el "produce" testeable del trabajo de fondo de servidor/cola.js
 * (`completarVisualesPendientes`): sin timeout corto (nadie espera), con las cascadas de FONDO
 * (para no gastar la cuota rápida del día) y sin tocar la explicación -- ya la verificó
 * `verificarBorradores` cuando nació la pregunta (`saltarAcortado: true`, igual que en la fase 2 de
 * `producirTanda`). Nunca lanza: una cascada agotada devuelve `visual: null` y el trabajo de fondo
 * lo volverá a intentar en otra pasada.
 * @param {object} pregunta pregunta del colchón, con su explicación ya buena
 * @param {object} [opciones] `llamar`, `permitirPago`, `topeEur`, `rutaLog`
 * @returns {Promise<{visual: object|null, explicacion: string, coste: number}>}
 */
export async function completarVisual(pregunta, opciones = {}) {
  const { llamar: llamarFn = llamarReal, permitirPago = false, topeEur = 0, rutaLog } = opciones;
  try {
    const resolucion = await resolverPregunta(pregunta, {
      llamar: llamarFn,
      permitirPago,
      topeEur,
      rutaLog,
      necesitaVisual: true,
      saltarAcortado: true, // la explicación ya cumple: aquí solo se pide el visual
      modelosGenerador: GENERADOR_VISUAL_FONDO,
      modelosVerificador: VERIFICADOR_VISUAL_FONDO,
    });
    return { visual: resolucion.visual, explicacion: resolucion.explicacion, coste: resolucion.coste || 0 };
  } catch {
    // Cascada entera agotada (o cualquier otro fallo): nunca se propaga -- el trabajo de fondo
    // (servidor/cola.js) simplemente deja `visualPendiente` como estaba y lo reintenta más tarde.
    return { visual: null, explicacion: pregunta.explicacion, coste: 0 };
  }
}
