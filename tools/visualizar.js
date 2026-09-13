// Pipeline v0.1e: un visual verificado + explicación corta (≤ 40 palabras) por pregunta.
// Spec: docs/superpowers/specs/2026-09-13-one-v0.1e-visual-en-todas-design.md §1-3.
//
// PRINCIPIO (§1): esto no es un retoque puntual del banco -- generarVisualYExplicacion y
// verificarVisualYExplicacion son las funciones que en v0.2 llamará el servidor de generación
// infinita por cada pregunta nueva. Por eso son puramente funcionales (reciben la pregunta y
// las opciones, no leen banco.json ni imagenes.json ellas mismas); la CLI de más abajo es solo
// un envoltorio que hoy las aplica a las 295 preguntas existentes.
//
// Cascada de modelos elegida hoy (13-sep-2026) contra GET https://openrouter.ai/api/v1/models:
//   - Generador: 2 modelos ':free' ya probados en este repo (tools/openrouter.js) + de pago
//     deepseek/deepseek-v4-flash. Es, con diferencia, el más barato de los candidatos sugeridos
//     por Carlos (prompt $0.04928/1M, completion $0.09856/1M -- frente a $0.25/$2 de
//     openai/gpt-5-mini o $0.06/$0.40 de z-ai/glm-4.7-flash) y ya se usa como verificador en
//     datos/banco.json (p. ej. art-001), señal de que produce JSON estructurado en español fiable.
//   - Verificador: otros 2 modelos ':free' distintos + de pago google/gemini-2.5-flash-lite
//     ($0.10/1M prompt, $0.40/1M completion). Deliberadamente de proveedor y familia distintos de
//     deepseek (regla fija de Carlos: la verificación la hace SIEMPRE un modelo distinto del que
//     generó la propuesta); además es barato y de calidad conocida para JSON estructurado.
// Solo process.env.OPENROUTER_API_KEY (dentro de tools/openrouter.js); nunca se imprime ni se lee
// aquí. Nunca se manda .env, credenciales ni datos/llamadas.log a ningún modelo.
//
// Uso CLI: node tools/visualizar.js [--solo-pendientes] [--area X] [--limite N] [--aplicar]
//          [--permitir-pago --tope-eur N]
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { llamar as llamarReal, extraerJson } from './openrouter.js';
import { textoCriterio } from './criterio.js';

const RUTA_BANCO = 'datos/banco.json';
const RUTA_IMAGENES = 'datos/imagenes.json';
const RUTA_EXPLICACIONES_LARGAS = 'datos/explicaciones-largas.json';
const RUTA_LOG = 'datos/visuales.log';
const RUTA_LOG_LLAMADAS = 'datos/llamadas.log'; // mismo log de coste que usa tools/openrouter.js

// Duplicado a propósito de validar-banco.js#AREAS: tools/validar-banco.js importa validarVisual
// de AQUÍ (ver más abajo), así que este fichero no puede importar de validar-banco.js sin crear
// un ciclo. Son 8 literales, no merece la pena una dependencia cruzada por esto.
const AREAS = ['economia', 'historia', 'ciencia', 'tecnologia', 'geografia', 'filosofia', 'arte', 'logica'];

const TAMANO_LOTE = 8;
const PAUSA_ENTRE_PREGUNTAS_MS = 1000; // cortesía con la cascada de modelos ':free', mismo espíritu que buscar-imagenes.js

export const GENERADOR_VISUAL = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'deepseek/deepseek-v4-flash',
];

// Solo 1 modelo ':free' antes de caer al de pago (a diferencia del generador, que prueba 2):
// visto en vivo el 13-sep-2026 en la ejecución real que 'nex-agi/nex-n2.5-pro:free' -- cuando
// responde en vez de fallar rápido -- tarda sistemáticamente 60-120s por llamada, y al ser el
// segundo de la cascada duplicaba el tiempo de CADA verificación (la mayoría de las preguntas
// necesitan 1-2 verificaciones). 'google/gemma-4-31b-it:free' falla rápido (HTTP 429 en <2s) o
// responde rápido; quitar el intermedio lento y caer directo al de pago (rápido, fiable, barato)
// respeta igual "que caiga al pago sin insistir demasiado" y evita la mayor causa de lentitud
// observada, sin tocar el presupuesto real (el sobrecoste es de decimas de céntimo).
export const VERIFICADOR_VISUAL = [
  'google/gemma-4-31b-it:free',
  'google/gemini-2.5-flash-lite',
];

// Visto en vivo el 13-sep-2026 (prueba en seco --limite 5 --tope-eur 0.05): con maxTokens:700 el
// JSON queda truncado ("Unexpected end of JSON input") en las tres preguntas de la cascada
// (incluido el modelo de pago) cuando "necesita_visual" es true -- el objeto visual + la
// explicación no caben, y algún modelo (nemotron-3-super) además antepone razonamiento en texto
// plano ("We need to...") antes del JSON. Mismo síntoma y mismo arreglo que EXTRA_VISION en
// tools/buscar-imagenes.js: desactivar el razonamiento oculto (los modelos que no reconocen el
// campo lo ignoran) y subir el margen de tokens de salida.
const SIN_RAZONAMIENTO = { reasoning: { enabled: false, exclude: true } };

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- validarVisual: esquema y límites del §2 de la spec --------------------------------------

const TIPOS_VISUAL = ['formula', 'linea-tiempo', 'barras', 'comparacion', 'flujo', 'dato'];

function esTextoNoVacio(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function limite(errores, cond, mensaje) {
  if (!cond) errores.push(mensaje);
}

/**
 * Valida un objeto `visual` contra el esquema y los límites de la spec §2. Nunca lanza: siempre
 * devuelve `{ ok, errores[] }`. También la usa tools/validar-banco.js.
 * @param {any} visual
 * @returns {{ok: boolean, errores: string[]}}
 */
export function validarVisual(visual) {
  const errores = [];
  if (!visual || typeof visual !== 'object' || Array.isArray(visual)) {
    return { ok: false, errores: ['visual no es un objeto'] };
  }
  if (!TIPOS_VISUAL.includes(visual.tipo)) {
    return { ok: false, errores: [`tipo de visual desconocido: ${JSON.stringify(visual.tipo)}`] };
  }
  limite(errores, esTextoNoVacio(visual.leyenda) && visual.leyenda.length <= 60, `leyenda inválida (1-60 caracteres): ${JSON.stringify(visual.leyenda)}`);

  switch (visual.tipo) {
    case 'formula': {
      limite(errores, esTextoNoVacio(visual.texto) && visual.texto.length <= 40, 'formula.texto inválido (1-40 caracteres)');
      break;
    }
    case 'linea-tiempo': {
      if (!Array.isArray(visual.hitos) || visual.hitos.length < 3 || visual.hitos.length > 5) {
        errores.push('linea-tiempo.hitos debe tener 3-5 elementos');
      } else {
        visual.hitos.forEach((h, i) => {
          limite(errores, h && esTextoNoVacio(h.ano) && h.ano.length <= 9, `linea-tiempo.hitos[${i}].ano inválido (1-9 caracteres)`);
          limite(errores, h && esTextoNoVacio(h.texto) && h.texto.length <= 22, `linea-tiempo.hitos[${i}].texto inválido (1-22 caracteres)`);
        });
      }
      break;
    }
    case 'barras': {
      if (!Array.isArray(visual.items) || visual.items.length < 2 || visual.items.length > 5) {
        errores.push('barras.items debe tener 2-5 elementos');
      } else {
        visual.items.forEach((it, i) => {
          limite(errores, it && esTextoNoVacio(it.etiqueta) && it.etiqueta.length <= 16, `barras.items[${i}].etiqueta inválida (1-16 caracteres)`);
          limite(errores, it && typeof it.valor === 'number' && Number.isFinite(it.valor), `barras.items[${i}].valor debe ser numérico`);
          if (it && it.unidad !== undefined && it.unidad !== null) {
            limite(errores, typeof it.unidad === 'string' && it.unidad.length <= 6, `barras.items[${i}].unidad inválida (máx. 6 caracteres)`);
          }
        });
      }
      // "fuente" opcional (fijado por Carlos, 13-sep-2026, tras ver en producción un "barras" con
      // porcentajes inventados para ilustrar una técnica pictórica): de dónde sale el dato real.
      // La app no la pinta -- la usa el verificador para distinguir un dato real de uno
      // ilustrativo/inventado. Opcional AQUÍ (validación de esquema); el verificador es quien la
      // exige de facto para aceptar el visual (ver promptSistemaVerificador).
      if (visual.fuente !== undefined && visual.fuente !== null) {
        limite(errores, typeof visual.fuente === 'string' && visual.fuente.length > 0 && visual.fuente.length <= 40, 'barras.fuente inválida (1-40 caracteres)');
      }
      break;
    }
    case 'comparacion': {
      if (!Array.isArray(visual.columnas) || visual.columnas.length !== 2) {
        errores.push('comparacion.columnas debe tener exactamente 2 elementos');
      } else {
        visual.columnas.forEach((c, i) => {
          limite(errores, c && esTextoNoVacio(c.titulo) && c.titulo.length <= 16, `comparacion.columnas[${i}].titulo inválido (1-16 caracteres)`);
          if (!c || !Array.isArray(c.puntos) || c.puntos.length < 2 || c.puntos.length > 3) {
            errores.push(`comparacion.columnas[${i}].puntos debe tener 2-3 elementos`);
          } else {
            c.puntos.forEach((p, j) => {
              limite(errores, esTextoNoVacio(p) && p.length <= 28, `comparacion.columnas[${i}].puntos[${j}] inválido (1-28 caracteres)`);
            });
          }
        });
      }
      break;
    }
    case 'flujo': {
      if (!Array.isArray(visual.pasos) || visual.pasos.length < 2 || visual.pasos.length > 4) {
        errores.push('flujo.pasos debe tener 2-4 elementos');
      } else {
        visual.pasos.forEach((p, i) => {
          limite(errores, esTextoNoVacio(p) && p.length <= 18, `flujo.pasos[${i}] inválido (1-18 caracteres)`);
        });
      }
      break;
    }
    case 'dato': {
      limite(errores, esTextoNoVacio(visual.cifra) && visual.cifra.length <= 8, 'dato.cifra inválida (1-8 caracteres)');
      limite(errores, esTextoNoVacio(visual.texto) && visual.texto.length <= 40, 'dato.texto inválido (1-40 caracteres)');
      // "fuente" opcional, mismo motivo que en "barras" (ver arriba).
      if (visual.fuente !== undefined && visual.fuente !== null) {
        limite(errores, typeof visual.fuente === 'string' && visual.fuente.length > 0 && visual.fuente.length <= 40, 'dato.fuente inválida (1-40 caracteres)');
      }
      break;
    }
    default:
      break;
  }

  return { ok: errores.length === 0, errores };
}

/** Cuenta palabras separadas por espacio (colapsando espacios múltiples). No string → 0. */
export function contarPalabras(texto) {
  if (typeof texto !== 'string') return 0;
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  return partes.length;
}

// --- Prompts ----------------------------------------------------------------------------------

// Igual que conceptoCorrecto() en tools/buscar-imagenes.js (no se importa de allí para no tocar
// ese fichero, que está fuera de alcance de esta tarea): da la respuesta correcta exacta según
// el tipo, para que el modelo nunca ilustre una opción incorrecta.
function resumirPregunta(p) {
  const base = { id: p.id, area: p.area, tipo: p.tipo, enunciado: p.enunciado, explicacion_actual: p.explicacion };
  if (p.tipo === 'vf') base.respuesta_correcta = p.respuesta ? 'Verdadero' : 'Falso';
  if (p.tipo === 'test4') base.respuesta_correcta = p.opciones?.[p.correcta] ?? '';
  if (p.tipo === 'ordenar') base.respuesta_correcta = `orden correcto (${p.criterio}): ${(p.items || []).join(' → ')}`;
  if (p.tipo === 'error') {
    const fila = p.tarjeta?.filas?.[p.sospechoso];
    base.respuesta_correcta = fila ? `dato erróneo (lo que NO hay que ilustrar): "${fila.etiqueta}: ${fila.valor}"` : '';
  }
  return base;
}

function promptSistemaGenerador(criterioTexto) {
  return (
    `${criterioTexto}\n\n` +
    'Tu tarea ahora NO es generar preguntas nuevas: es reescribir la EXPLICACIÓN de una pregunta ya ' +
    'existente y, si se te pide, proponer un VISUAL de apoyo para la tarjeta de respuesta.\n\n' +
    'EXPLICACIÓN: LÍMITE DURO de 40 palabras -- una propuesta de más de 40 se RECHAZA automáticamente ' +
    'aunque el contenido sea perfecto, así que apunta a 30-32 palabras como objetivo real (cuenta las ' +
    'palabras que llevas antes de terminar la frase; si te pasas, recorta, no añadas "..."). Español ' +
    'impecable, en 2 frases: (1) el porqué -- el mecanismo o la razón, no solo repetir el enunciado; ' +
    '(2) un gancho memorable: una anécdota, un dato sorprendente o su conexión con la actualidad ' +
    '(2022-2026) si existe, sin que la pregunta dependa de él. No pierdas el hecho clave de la ' +
    'explicación original.\n\n' +
    'VISUAL (solo si "necesita_visual" es true): un objeto de DATOS -- nunca un dibujo, la app lo ' +
    'pinta con plantillas propias -- que ilustre la "respuesta_correcta" indicada (nunca una opción ' +
    'incorrecta ni el dato erróneo cuando se te avisa de cuál es). Elige el tipo más natural para el ' +
    'tema (economía → formula/barras; historia → linea-tiempo; filosofía → comparacion/flujo; lógica → ' +
    'flujo/comparacion; ciencia → formula/flujo; geografía/tecnología → barras/dato) y respeta ' +
    'EXACTAMENTE uno de estos esquemas y límites (todos los datos deben ser reales y comprobables, ' +
    'nunca inventados):\n' +
    '  - formula: {"tipo":"formula","texto":"…","leyenda":"…"} texto ≤ 40 caracteres, notación plana ' +
    '(×, −, /, =), SIN LaTeX. Ej.: "PIB = C + I + G + (X − M)".\n' +
    '  - linea-tiempo: {"tipo":"linea-tiempo","hitos":[{"ano":"…","texto":"…"}, …],"leyenda":"…"} 3-5 ' +
    'hitos, "ano" ≤ 9 caracteres, "texto" ≤ 22.\n' +
    '  - barras: {"tipo":"barras","titulo":"…","items":[{"etiqueta":"…","valor":0,"unidad":"…"}, …],' +
    '"leyenda":"…","fuente":"…"} 2-5 items, "etiqueta" ≤ 16, "valor" NUMÉRICO real (nunca inventado), ' +
    '"unidad" ≤ 6 (opcional), "titulo" opcional.\n' +
    '  - comparacion: {"tipo":"comparacion","columnas":[{"titulo":"…","puntos":["…"]}, …],"leyenda":' +
    '"…"} EXACTAMENTE 2 columnas, 2-3 puntos cada una, "titulo" ≤ 16, cada punto ≤ 28.\n' +
    '  - flujo: {"tipo":"flujo","pasos":["…", …],"leyenda":"…"} 2-4 pasos, ≤ 18 caracteres cada uno.\n' +
    '  - dato: {"tipo":"dato","cifra":"…","texto":"…","leyenda":"…","fuente":"…"} "cifra" ≤ 8 ' +
    'caracteres, "texto" ≤ 40. Último recurso cuando nada más encaja.\n' +
    '"leyenda" ≤ 60 caracteres en todos los tipos.\n\n' +
    'REGLA DURA sobre "barras" y "dato" (nunca la rompas): sus números son SIEMPRE hechos reales, ' +
    'publicados y reconocibles -- años, población, PIB, distancias, temperaturas, porcentajes de una ' +
    'estadística real, fechas. PROHIBIDO inventar un porcentaje o una cifra "para ilustrar" un ' +
    'concepto (ejemplo de lo que NUNCA hay que hacer: inventarte "40 % / 60 %" para representar el ' +
    'efecto de una técnica pictórica -- eso no es un dato, es una ilustración inventada, y se ' +
    'rechaza siempre). Si el concepto es CUALITATIVO (una técnica artística, una idea filosófica, ' +
    'una falacia lógica, un proceso, una corriente de pensamiento) usa "comparacion", "flujo", ' +
    '"linea-tiempo" o "formula" -- NUNCA "barras" ni "dato" para eso. Cuando SÍ uses "barras" o ' +
    '"dato", añade siempre "fuente" (≤ 40 caracteres): de dónde sale el dato real, con año si aplica ' +
    '(ejemplos: "Banco Mundial 2023", "INE 2024", "NASA", "Eurostat 2022"); la app no la pinta, pero ' +
    'sin ella el visual se rechaza. Si no tienes un dato real y verificable con fuente, NO propongas ' +
    'barras/dato: usa otro tipo.\n' +
    'Si "necesita_visual" es false, no incluyas la clave "visual" (o ponla a null).\n\n' +
    'Devuelve SOLO JSON con la forma exacta: {"explicacion":"…","visual":{...}|null}'
  );
}

function promptUsuarioGenerador(pregunta, necesitaVisual, motivoRechazo) {
  const payload = { ...resumirPregunta(pregunta), necesita_visual: necesitaVisual };
  let texto = `Pregunta:\n${JSON.stringify(payload)}`;
  if (motivoRechazo) {
    texto +=
      `\n\nIMPORTANTE: ya propusiste un visual para esta pregunta y fue RECHAZADO por este motivo: ` +
      `"${motivoRechazo}". Corrígelo en este intento (puedes cambiar de tipo de visual si hace falta).`;
  }
  return texto;
}

function promptSistemaVerificador(criterioTexto) {
  return (
    `${criterioTexto}\n\n` +
    'Verificas, de forma ESCÉPTICA e independiente de quien la propuso, una explicación corta y (si ' +
    'se te da) un visual de apoyo para una pregunta de quiz ya existente.\n' +
    '"explicacionOk" es true SOLO si la propuesta conserva el hecho clave de la "explicacion_actual", ' +
    'no introduce ningún error factual ni de redacción/concordancia, y no se pasa claramente de 40 ' +
    'palabras.\n' +
    '"visualOk" (solo si se te da "visual_propuesto", si no lo hay pon true) es true SOLO si los ' +
    'datos son reales y comprobables (nunca inventados ni aproximados sin base), ilustran la ' +
    '"respuesta_correcta" indicada (nunca una opción incorrecta ni el dato erróneo cuando se avisa de ' +
    'cuál es), y el tipo de visual elegido es razonable para el tema.\n' +
    'COMPROBACIÓN OBLIGATORIA cuando el tipo sea "barras" o "dato": pregúntate explícitamente -- ' +
    '¿estos números son un hecho verificable con la fuente indicada, o son cifras ilustrativas o ' +
    'inventadas para representar la idea (p. ej. un "60 % / 40 %" inventado para ilustrar el efecto ' +
    'de una técnica artística, en vez de una estadística real)? Si son ilustrativos/inventados, o si ' +
    'falta el campo "fuente" en un "barras"/"dato", "visualOk" es false con motivo "cifras no ' +
    'verificables" (aunque el resto del visual esté bien formado).\n' +
    'Ante la duda, false. Devuelve SOLO JSON con la forma exacta: {"explicacionOk":true|false,' +
    '"visualOk":true|false,"motivo":"…"} ("motivo" explica cualquier false, breve y en español; puede ' +
    'ir vacío si todo es true).'
  );
}

function promptUsuarioVerificador(pregunta, propuesta) {
  const payload = {
    ...resumirPregunta(pregunta),
    explicacion_propuesta: propuesta.explicacion,
    visual_propuesto: propuesta.visual || null,
  };
  return `Verifica esta propuesta:\n${JSON.stringify(payload)}`;
}

// --- Funciones "produce" (las que reutilizará el servidor de v0.2, spec §1) --------------------

/**
 * Genera una explicación corta (≤ 40 palabras) y, si se pide, un visual de apoyo para UNA
 * pregunta. Una sola llamada a la cascada generador (gratis → pago barato).
 * @param {object} pregunta pregunta del banco (o, en v0.2, recién generada)
 * @param {object} opciones
 * @param {Function} [opciones.llamar] inyectable para tests; por defecto tools/openrouter.js#llamar
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.criterio] texto de criterio; por defecto textoCriterio(pregunta.area)
 * @param {boolean} [opciones.necesitaVisual] por defecto true
 * @param {string} [opciones.motivoRechazo] si se pasa, se incluye como feedback de un intento previo
 * @param {string[]} [opciones.modelos] cascada a usar; por defecto GENERADOR_VISUAL
 * @param {string} [opciones.rutaLog]
 * @returns {Promise<{explicacion: string, visual: object|null, modelo: string, coste: number}>}
 */
export async function generarVisualYExplicacion(pregunta, opciones = {}) {
  const {
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    criterio = textoCriterio(pregunta.area),
    necesitaVisual = true,
    motivoRechazo = null,
    modelos = GENERADOR_VISUAL,
    rutaLog,
  } = opciones;

  const mensajes = [
    { role: 'system', content: promptSistemaGenerador(criterio) },
    { role: 'user', content: promptUsuarioGenerador(pregunta, necesitaVisual, motivoRechazo) },
  ];

  const salida = await llamarFn({
    modelos,
    mensajes,
    json: true,
    temperatura: 0.6,
    maxTokens: 1500,
    permitirPago,
    topeEur,
    extra: SIN_RAZONAMIENTO,
    ...(rutaLog ? { rutaLog } : {}),
  });

  const datos = extraerJson(salida.texto);
  const explicacion = typeof datos.explicacion === 'string' ? datos.explicacion.trim() : '';
  const visual = necesitaVisual && datos.visual && typeof datos.visual === 'object' ? datos.visual : null;

  return { explicacion, visual, modelo: salida.modelo, coste: salida.coste };
}

/**
 * Verifica, con un modelo DISTINTO del que generó, una propuesta de explicación + visual.
 * @param {object} pregunta
 * @param {{explicacion: string, visual: object|null, modelo: string}} propuesta
 * @param {object} opciones
 * @param {Function} [opciones.llamar]
 * @param {string} [opciones.excluirModelo] modelo a excluir de la cascada (el que generó)
 * @param {boolean} [opciones.necesitaVisual] por defecto true
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.criterio]
 * @param {string[]} [opciones.modelos] cascada a usar; por defecto VERIFICADOR_VISUAL
 * @param {string} [opciones.rutaLog]
 * @returns {Promise<{explicacionOk: boolean, visualOk: boolean, motivo: string, modelo: string, coste: number}>}
 */
export async function verificarVisualYExplicacion(pregunta, propuesta, opciones = {}) {
  const {
    llamar: llamarFn = llamarReal,
    excluirModelo = null,
    necesitaVisual = true,
    permitirPago = false,
    topeEur = 0,
    criterio = textoCriterio(pregunta.area),
    modelos = VERIFICADOR_VISUAL,
    rutaLog,
  } = opciones;

  const listaModelos = excluirModelo ? modelos.filter((m) => m !== excluirModelo) : modelos;
  if (listaModelos.length === 0) {
    throw new Error('verificarVisualYExplicacion: no quedan modelos en la cascada tras excluir el generador');
  }

  const mensajes = [
    { role: 'system', content: promptSistemaVerificador(criterio) },
    { role: 'user', content: promptUsuarioVerificador(pregunta, propuesta) },
  ];

  const salida = await llamarFn({
    modelos: listaModelos,
    mensajes,
    json: true,
    temperatura: 0.2,
    maxTokens: 800,
    permitirPago,
    topeEur,
    extra: SIN_RAZONAMIENTO,
    ...(rutaLog ? { rutaLog } : {}),
  });

  const datos = extraerJson(salida.texto);
  const motivoModelo = typeof datos.motivo === 'string' ? datos.motivo : '';

  // Comprobación en código, no solo criterio del modelo: visto en vivo el 13-sep-2026 (primera
  // pregunta de la ejecución completa, art-001) que el verificador puede dar explicacionOk:true a
  // una propuesta de 54 palabras (el límite de 40 es un dato objetivo y contable, igual que los
  // límites de validarVisual -- no debe depender solo de que el modelo cuente bien).
  const dentroDelLimite = contarPalabras(propuesta.explicacion) <= 40;
  const explicacionOk = datos.explicacionOk === true && dentroDelLimite;
  let motivoExplicacion = '';
  if (!explicacionOk) {
    motivoExplicacion = !dentroDelLimite
      ? `explicación de ${contarPalabras(propuesta.explicacion)} palabras (> 40)`
      : motivoModelo || 'explicación rechazada sin motivo';
  }

  let visualOk;
  let motivoVisual = '';
  if (!necesitaVisual) {
    visualOk = true;
  } else if (!propuesta.visual) {
    visualOk = false;
    motivoVisual = motivoModelo || 'el generador no devolvió ningún visual';
  } else {
    const esquema = validarVisual(propuesta.visual);
    // Guardarraíl en código, no solo criterio del modelo (mismo principio que el límite de 40
    // palabras): fijado por Carlos el 13-sep-2026 tras ver en producción un "barras" con
    // porcentajes inventados (40 %/60 %) para ilustrar una técnica pictórica. "barras"/"dato" sin
    // "fuente" se rechazan siempre, sin depender de que el modelo se acuerde de comprobarlo.
    const esBarrasODato = propuesta.visual.tipo === 'barras' || propuesta.visual.tipo === 'dato';
    const sinFuente = esBarrasODato && !esTextoNoVacio(propuesta.visual.fuente);
    visualOk = datos.visualOk === true && esquema.ok && !sinFuente;
    if (!visualOk) {
      motivoVisual = !esquema.ok
        ? `esquema inválido: ${esquema.errores.join('; ')}`
        : sinFuente
          ? 'cifras no verificables: falta fuente'
          : motivoModelo || 'visual rechazado sin motivo';
    }
  }

  // Un solo campo "motivo" en la interfaz (contrato del brief), pero visto en vivo el 13-sep-2026
  // (art-010) que si se sobrescribe sin más, el motivo del visual tapaba el de la explicación
  // cuando fallaban los dos a la vez -- el log mostraba "explicación conservada" con un motivo que
  // en realidad hablaba del visual. Se combinan etiquetados para que nunca se pierda ninguno.
  const motivo =
    [!explicacionOk && `explicación: ${motivoExplicacion}`, !visualOk && necesitaVisual && `visual: ${motivoVisual}`]
      .filter(Boolean)
      .join(' | ') || motivoModelo;

  return { explicacionOk, visualOk, motivo, motivoExplicacion, motivoVisual, modelo: salida.modelo, coste: salida.coste };
}

/**
 * Flujo completo por pregunta: generar → verificar → (si el visual falla) reintentar UNA vez → si
 * vuelve a fallar, visual queda null. La explicación nunca se reintenta: si explicacionOk es
 * false se conserva la original. La verificación nunca se salta.
 * @param {object} pregunta
 * @param {object} opciones mismas que generarVisualYExplicacion/verificarVisualYExplicacion
 * @returns {Promise<{
 *   explicacion: string, explicacionCambiada: boolean, motivoExplicacionRechazo: string|null,
 *   visual: object|null, motivoVisualRechazo: string|null,
 *   modeloGenerador: string, modeloVerificador: string, coste: number,
 * }>}
 */
export async function resolverPregunta(pregunta, opciones = {}) {
  const necesitaVisual = opciones.necesitaVisual !== false;
  let coste = 0;

  const propuesta = await generarVisualYExplicacion(pregunta, { ...opciones, necesitaVisual });
  coste += propuesta.coste;

  const verif = await verificarVisualYExplicacion(pregunta, propuesta, {
    ...opciones,
    excluirModelo: propuesta.modelo,
    necesitaVisual,
  });
  coste += verif.coste;

  let visualFinal = null;
  let motivoVisualRechazo = null;
  let modeloVisual = propuesta.modelo;
  let modeloVerificadorVisual = verif.modelo;

  if (necesitaVisual) {
    if (verif.visualOk) {
      visualFinal = propuesta.visual;
    } else {
      const motivoPrevio = verif.motivoVisual || verif.motivo || 'visual rechazado sin motivo';
      const reintento = await generarVisualYExplicacion(pregunta, {
        ...opciones,
        necesitaVisual: true,
        motivoRechazo: motivoPrevio,
      });
      coste += reintento.coste;
      const verif2 = await verificarVisualYExplicacion(pregunta, reintento, {
        ...opciones,
        excluirModelo: reintento.modelo,
        necesitaVisual: true,
      });
      coste += verif2.coste;
      modeloVisual = reintento.modelo;
      modeloVerificadorVisual = verif2.modelo;
      if (verif2.visualOk) {
        visualFinal = reintento.visual;
      } else {
        visualFinal = null;
        motivoVisualRechazo = verif2.motivoVisual || verif2.motivo || motivoPrevio;
      }
    }
  }

  const explicacionCambiada = verif.explicacionOk === true;

  return {
    explicacion: explicacionCambiada ? propuesta.explicacion : pregunta.explicacion,
    explicacionCambiada,
    motivoExplicacionRechazo: explicacionCambiada ? null : verif.motivoExplicacion || verif.motivo || 'explicación rechazada sin motivo',
    visual: visualFinal,
    motivoVisualRechazo,
    modeloGenerador: propuesta.modelo,
    modeloVerificador: verif.modelo,
    modeloVisual,
    modeloVerificadorVisual,
    coste,
  };
}

// --- CLI ----------------------------------------------------------------------------------------

function parsearArgs(argv) {
  const args = { soloPendientes: false, area: null, limite: 0, aplicar: false, permitirPago: false, topeEur: 0, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--solo-pendientes') args.soloPendientes = true;
    else if (a === '--area') args.area = argv[++i];
    else if (a === '--limite') args.limite = Number(argv[++i]);
    else if (a === '--aplicar') args.aplicar = true;
    else if (a === '--permitir-pago') args.permitirPago = true;
    else if (a === '--tope-eur') args.topeEur = Number(argv[++i]);
  }
  return args;
}

function imprimirAyuda() {
  console.log(`Uso: node tools/visualizar.js [--solo-pendientes] [--area X] [--limite N] [--aplicar]
       node tools/visualizar.js --aplicar --permitir-pago --tope-eur 0.5

Genera una explicación corta (≤ 40 palabras) y, para las preguntas sin imagen de Commons, un
visual verificado (datos, nunca dibujo) para cada pregunta de datos/banco.json.

Opciones:
  --area <area>       Solo esta área (${AREAS.join(', ')}).
  --solo-pendientes   Solo preguntas sin visual (y sin imagen) o con explicación > 40 palabras.
  --limite <n>        Procesa como mucho N preguntas.
  --aplicar           Escribe datos/banco.json, datos/explicaciones-largas.json y datos/visuales.log.
                       Sin esto, solo informa (pero las llamadas a la API SÍ se hacen y SÍ cuestan).
  --permitir-pago     Permite caer a un modelo de pago barato si los gratis fallan.
  --tope-eur <n>      Tope de gasto en euros hoy (solo con --permitir-pago).
  --ayuda             Muestra esta ayuda y sale.
`);
}

function partirEnLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

// Duplicado deliberado de costeAcumuladoHoy() en tools/openrouter.js (no exportada allí): solo
// para el corte proactivo de esta CLI (parar ANTES de intentar la siguiente pregunta si el tope
// ya está agotado), no sustituye la comprobación real que hace openrouter.js antes de cada
// llamada de pago -- esa es la que de verdad impide gastar de más.
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
      const e = JSON.parse(linea);
      if (typeof e.fecha === 'string' && e.fecha.startsWith(hoy)) total += Number(e.coste) || 0;
    } catch {
      // línea corrupta: se ignora
    }
  }
  return total;
}

function tieneVisualValido(p) {
  return p && p.visual && validarVisual(p.visual).ok;
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    return;
  }
  if (args.area && !AREAS.includes(args.area)) {
    console.error(`Área desconocida: ${args.area}. Válidas: ${AREAS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const lineasLog = [];
  const registrar = async (linea) => {
    console.log(linea);
    lineasLog.push(linea);
  };

  const banco = JSON.parse(await readFile(RUTA_BANCO, 'utf8'));
  const imagenes = JSON.parse(await readFile(RUTA_IMAGENES, 'utf8').catch(() => '{}'));
  let explicacionesLargas = JSON.parse(await readFile(RUTA_EXPLICACIONES_LARGAS, 'utf8').catch(() => '{}'));

  let candidatas = args.area ? banco.filter((p) => p.area === args.area) : banco.slice();
  if (args.soloPendientes) {
    const antes = candidatas.length;
    candidatas = candidatas.filter((p) => {
      const sinVisualNiImagen = !tieneVisualValido(p) && !(p.id in imagenes);
      const explicacionLarga = contarPalabras(p.explicacion) > 40;
      return sinVisualNiImagen || explicacionLarga;
    });
    await registrar(`--solo-pendientes: ${antes - candidatas.length} ya resueltas, ${candidatas.length} pendientes.`);
  }
  if (args.limite > 0) candidatas = candidatas.slice(0, args.limite);

  await registrar(
    `\n=== visualizar ${new Date().toISOString()} — ${candidatas.length} preguntas candidatas` +
      `${args.aplicar ? '' : ' (SIN --aplicar: solo informa)'} ` +
      `${args.permitirPago ? `(pago permitido, tope ${args.topeEur} €)` : '(solo modelos gratis)'} ===`,
  );

  if (candidatas.length === 0) {
    console.log('Nada que procesar.');
    return;
  }

  const porId = new Map(banco.map((p) => [p.id, p]));
  const resultados = new Map(); // id -> resultado de resolverPregunta
  const fallos = new Map(); // id -> motivo (fallo de red/cascada completa, no rechazo de verificación)
  let costeAcumulado = await costeAcumuladoHoy(RUTA_LOG_LLAMADAS);
  const costeInicial = costeAcumulado;
  let detenidoPorTope = false;

  const lotes = partirEnLotes(candidatas, TAMANO_LOTE);
  for (let i = 0; i < lotes.length && !detenidoPorTope; i++) {
    const lote = lotes[i];
    await registrar(`\n-- lote ${i + 1}/${lotes.length} (${lote.length} preguntas) --`);

    for (const pregunta of lote) {
      if (args.permitirPago && args.topeEur > 0 && costeAcumulado >= args.topeEur) {
        await registrar(`\nTope de gasto alcanzado (${costeAcumulado.toFixed(4)} € >= ${args.topeEur} €): se detiene aquí. Progreso ya guardado.`);
        detenidoPorTope = true;
        break;
      }

      const necesitaVisual = !(pregunta.id in imagenes);
      let resultado;
      try {
        resultado = await resolverPregunta(pregunta, {
          permitirPago: args.permitirPago,
          topeEur: args.topeEur,
          necesitaVisual,
        });
      } catch (err) {
        fallos.set(pregunta.id, err.message);
        await registrar(`  ${pregunta.id}: FALLO — ${err.message}`);
        await esperar(PAUSA_ENTRE_PREGUNTAS_MS);
        continue;
      }

      costeAcumulado += resultado.coste;
      resultados.set(pregunta.id, resultado);

      const trazaVisual = !necesitaVisual
        ? 'ya tiene imagen'
        : resultado.visual
          ? `visual ${resultado.visual.tipo} OK (${resultado.modeloVisual})`
          : `sin visual (${resultado.motivoVisualRechazo || 'rechazado'})`;
      const trazaExplicacion = resultado.explicacionCambiada ? 'explicación actualizada' : `explicación conservada (${resultado.motivoExplicacionRechazo})`;
      await registrar(`  ${pregunta.id}: ${trazaExplicacion}; ${trazaVisual}`);
      // Detalle completo (útil para auditar la calidad real, no solo el estado): antes/después de
      // la explicación y el JSON del visual, cuando los hay.
      if (resultado.explicacionCambiada) {
        await registrar(`    explicación antes: ${pregunta.explicacion}`);
        await registrar(`    explicación después: ${resultado.explicacion}`);
      }
      if (resultado.visual) {
        await registrar(`    visual: ${JSON.stringify(resultado.visual)}`);
      }

      await esperar(PAUSA_ENTRE_PREGUNTAS_MS);
    }

    // Progreso por lote: se escribe tras cada lote para que un corte no pierda nada ya resuelto.
    if (args.aplicar) {
      for (const [id, resultado] of resultados) {
        const pregunta = porId.get(id);
        if (!pregunta) continue;
        if (resultado.explicacionCambiada && pregunta.explicacion !== resultado.explicacion) {
          if (!(id in explicacionesLargas)) explicacionesLargas[id] = pregunta.explicacion;
          pregunta.explicacion = resultado.explicacion;
        }
        if (resultado.visual) pregunta.visual = resultado.visual;
      }
      const bancoActualizado = banco.map((p) => porId.get(p.id) || p);
      await writeFile(RUTA_BANCO, JSON.stringify(bancoActualizado, null, 2), 'utf8');
      await writeFile(RUTA_EXPLICACIONES_LARGAS, JSON.stringify(explicacionesLargas, null, 2), 'utf8');
      await appendFile(RUTA_LOG, `${lineasLog.splice(0).join('\n')}\n`, 'utf8');
    } else {
      lineasLog.length = 0;
    }
  }

  // --- Resumen ---
  await registrar('\n=== Resumen ===');
  const porArea = new Map();
  for (const area of AREAS) porArea.set(area, { candidatas: 0, explicacionOk: 0, visualGenerado: 0, porTipo: {} });
  const rechazosVisual = []; // {id, motivo}
  const rechazosExplicacion = []; // {id, motivo}

  for (const pregunta of candidatas) {
    const r = resultados.get(pregunta.id);
    const acc = porArea.get(pregunta.area);
    if (!acc) continue;
    acc.candidatas++;
    if (!r) continue;
    if (r.explicacionCambiada) acc.explicacionOk++;
    else rechazosExplicacion.push({ id: pregunta.id, motivo: r.motivoExplicacionRechazo });
    if (r.visual) {
      acc.visualGenerado++;
      acc.porTipo[r.visual.tipo] = (acc.porTipo[r.visual.tipo] || 0) + 1;
    } else if (!(pregunta.id in imagenes)) {
      rechazosVisual.push({ id: pregunta.id, motivo: r.motivoVisualRechazo || 'sin visual' });
    }
  }

  for (const area of AREAS) {
    const acc = porArea.get(area);
    if (acc.candidatas === 0) continue;
    const tipos = Object.entries(acc.porTipo).map(([t, n]) => `${t}:${n}`).join(', ') || 'ninguno';
    await registrar(`  ${area}: ${acc.candidatas} procesadas, ${acc.explicacionOk} explicación actualizada, ${acc.visualGenerado} visual generado (${tipos})`);
  }

  const sinVisualNiImagenFinal = banco.filter((p) => !(p.id in imagenes) && !tieneVisualValido(p));
  await registrar(`\nTotal candidatas: ${candidatas.length}`);
  await registrar(`Resueltas: ${resultados.size}`);
  await registrar(`Fallos de cascada (red/todos los modelos): ${fallos.size}`);
  await registrar(`Rechazadas por verificación (explicación): ${rechazosExplicacion.length}`);
  await registrar(`Rechazadas por verificación (visual, tras reintento): ${rechazosVisual.length}`);
  await registrar(`Preguntas del banco COMPLETO sin visual ni imagen ahora mismo: ${sinVisualNiImagenFinal.length}`);
  if (rechazosVisual.length > 0) {
    await registrar('\nDetalle rechazos de visual (motivo):');
    for (const { id, motivo } of rechazosVisual) await registrar(`  ${id}: ${motivo}`);
  }
  if (rechazosExplicacion.length > 0) {
    await registrar('\nDetalle rechazos de explicación (motivo):');
    for (const { id, motivo } of rechazosExplicacion) await registrar(`  ${id}: ${motivo}`);
  }
  if (fallos.size > 0) {
    await registrar('\nDetalle fallos de cascada:');
    for (const [id, motivo] of fallos) await registrar(`  ${id}: ${motivo}`);
  }
  const costeTotalEjecucion = costeAcumulado - costeInicial;
  await registrar(`\nCoste real de esta ejecución (suma de 'coste' de las respuestas de la API): ${costeTotalEjecucion.toFixed(6)} $`);
  if (detenidoPorTope) {
    await registrar('AVISO: ejecución detenida por tope de gasto antes de terminar. Progreso ya guardado.');
  }

  if (!args.aplicar) {
    console.log('\n(sin --aplicar: no se ha escrito datos/banco.json, datos/explicaciones-largas.json ni datos/visuales.log)');
    return;
  }
  if (lineasLog.length > 0) await appendFile(RUTA_LOG, `${lineasLog.splice(0).join('\n')}\n`, 'utf8');
  console.log(`\nEscrito ${RUTA_BANCO}, ${RUTA_EXPLICACIONES_LARGAS} y ${RUTA_LOG}.`);
}

const esCLI = process.argv[1] && process.argv[1].endsWith('visualizar.js');
if (esCLI) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
