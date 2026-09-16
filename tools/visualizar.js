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
const RUTA_VISUALES_EXCLUIDOS = 'datos/visuales-excluidos.json'; // lista de exclusión manual (M5, ver aplicarExclusionVisual)

// Duplicado a propósito de validar-banco.js#AREAS: tools/validar-banco.js importa validarVisual
// de AQUÍ (ver más abajo), así que este fichero no puede importar de validar-banco.js sin crear
// un ciclo. Son 8 literales, no merece la pena una dependencia cruzada por esto.
const AREAS = ['economia', 'historia', 'ciencia', 'tecnologia', 'geografia', 'filosofia', 'arte', 'logica'];

const TAMANO_LOTE = 8;
const PAUSA_ENTRE_PREGUNTAS_MS = 1000; // cortesía con la cascada de modelos ':free', mismo espíritu que buscar-imagenes.js

// v0.2b4.1 §3: el paso de visual es el que MÁS llamadas hace de toda la tanda (17 de 24 en la tanda
// real del 15-sep), así que su cascada empieza por el modelo más rápido medido -- groq gpt-oss-20b,
// 1,0 s -- y no por el más potente. Gemini flash-lite detrás como segundo rápido de otro proveedor,
// para que una cuota agotada en uno no pare el paso entero.
export const GENERADOR_VISUAL = [
  'groq:openai/gpt-oss-20b',
  'gemini:gemini-flash-lite-latest',
  'groq:qwen/qwen3.8-27b',
  'cerebras:qwen-3.8-27b',
  // Ola final v0.2b4.1 (I2): el último eslabón era 'nvidia/nemotron-3-ultra-550b-a55b:free' --
  // minuto y medio largo por llamada (medido: un parón de 118,9 s dentro de una tanda urgente), y
  // el visual es el paso que MÁS llamadas hace. Se queda solo en las cascadas de fondo. Como red
  // gratis de último recurso urgente entra 'nex-agi/nex-n2.5-pro:free', más ligero.
  'nex-agi/nex-n2.5-pro:free',
];

// Id DISTINTO del primero del generador (regla fija de Carlos: verifica siempre otro modelo), así
// `excluirModelo` nunca deja esta cascada sin primer eslabón.
export const VERIFICADOR_VISUAL = [
  'groq:openai/gpt-oss-120b',
  'gemini:gemini-flash-lite-latest',
  'gemini:gemini-3.6-flash',
  'google/gemma-4-31b-it:free',
];

// Cascadas del colchón nocturno y del trabajo de fondo que completa visuales pendientes (Tarea 4):
// nadie espera, así que se usa lo lento y se deja intacta la cuota rápida para el día (spec §3).
export const GENERADOR_VISUAL_FONDO = [
  'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'gemini:gemini-flash-lite-latest',
];
export const VERIFICADOR_VISUAL_FONDO = [
  'nvidia:openai/gpt-oss-20b',
  'google/gemma-4-31b-it:free',
  'gemini:gemini-3.6-flash',
];

// Cascadas SOLO de pago (--sin-gratis): fijado por el controlador el 13-sep-2026 -- con los
// modelos ':free' saturados todo el día (429/timeout en cadena), la ejecución masiva llevaba más
// de 25 minutos sin resolver una sola pregunta. Mismos dos modelos de pago que ya usan las
// cascadas normales como último escalón (nunca coinciden entre sí, así que no hace falta
// excluirModelo para garantizar que el verificador es distinto del generador).
export const GENERADOR_SOLO_PAGO = ['deepseek/deepseek-v4-flash'];
export const VERIFICADOR_SOLO_PAGO = ['google/gemini-2.5-flash-lite'];

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

// --- Ronda de corrección 1 (13-sep-2026): guardarraíl de "fuente" endurecido -------------------
// La revisión (controlador + revisor adversarial) encontró ~45% de falsos positivos en
// "barras"/"dato": el guardarraíl anterior solo exigía que "fuente" existiera y tuviera
// contenido, y eso dejaba pasar "Concepto físico estándar", "Datos geográficos estándar",
// "Cálculo propio sobre enunciado" -- frases con forma de fuente pero sin año ni institución real
// (el controlador retiró 12 de 28 a mano tras verlas en producción). Ahora "fuente" es obligatoria
// en código, con formato: 8-40 caracteres, un año de 4 dígitos, y algo de texto además del año
// (el nombre de la institución/publicación); se rechaza si contiene una frase que delata una
// cifra genérica/ilustrativa en vez de un dato real con procedencia.

const REGEX_ANIO_FUENTE = /\b(18|19|20)\d{2}\b/;

// Comparación sin distinguir mayúsculas ni tildes (pedido explícitamente): "estándar" debe pillar
// también "Estandar", "ESTÁNDAR", etc.
function normalizarTexto(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const FRASES_FUENTE_NO_VERIFICABLE = [
  'estandar',
  'concepto',
  'aproximad',
  'tipic',
  'generic',
  'de manual',
  'calculo propio',
  'estimacion propia',
  'analisis',
];

/**
 * Valida el campo `fuente` obligatorio de un visual `barras`/`dato` (ronda de corrección 1,
 * 13-sep-2026): 8-40 caracteres, año de 4 dígitos, nombre de institución/publicación reconocible,
 * y ninguna frase que delate una cifra genérica o ilustrativa disfrazada de fuente real.
 * @param {any} fuente
 * @returns {{ok: boolean, motivo: string}} `motivo`, si no ok, empieza tras "fuente " (p. ej.
 *   "fuente obligatoria", "fuente sin año...").
 */
export function validarFuente(fuente) {
  if (!esTextoNoVacio(fuente)) {
    return { ok: false, motivo: 'obligatoria' };
  }
  if (fuente.length < 8 || fuente.length > 40) {
    return { ok: false, motivo: 'inválida (8-40 caracteres)' };
  }
  if (!REGEX_ANIO_FUENTE.test(fuente)) {
    return { ok: false, motivo: 'sin año (debe incluir un año de 4 dígitos, p. ej. "2023")' };
  }
  const normalizada = normalizarTexto(fuente);
  const fraseProhibida = FRASES_FUENTE_NO_VERIFICABLE.find((f) => normalizada.includes(f));
  if (fraseProhibida) {
    return { ok: false, motivo: `genérica o no verificable (contiene "${fraseProhibida}")` };
  }
  // Debe quedar el nombre de una institución/publicación además del año: quita el año y toda la
  // puntuación/dígitos, y exige al menos 3 letras reales (p. ej. "INE" en "INE 2024").
  const soloLetras = fuente.replace(REGEX_ANIO_FUENTE, '').replace(/[^\p{L}]/gu, '');
  if (soloLetras.length < 3) {
    return { ok: false, motivo: 'sin nombre de institución o publicación reconocible' };
  }
  return { ok: true, motivo: '' };
}

// Mismo hallazgo, otro disfraz (controlador, revisión humana 13-sep-2026): "típica"/"aproximada"/
// "estimada" en el TÍTULO o la LEYENDA de un "barras"/"dato" son la misma cifra ilustrativa que la
// del campo "fuente", solo que en el texto visible de la tarjeta en vez de en la procedencia.
const FRASES_ILUSTRATIVO_EN_TEXTO = ['tipic', 'aproximad', 'estimad'];

function contieneFraseIlustrativa(texto) {
  if (!esTextoNoVacio(texto)) return false;
  const normalizado = normalizarTexto(texto);
  return FRASES_ILUSTRATIVO_EN_TEXTO.some((f) => normalizado.includes(f));
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
      // Fijado por Carlos tras la pasada adversarial del 13-sep-2026: LaTeX crudo ("\frac{}",
      // "$...$") se pintaría literal en el SVG de la app -- la notación es siempre plana.
      if (esTextoNoVacio(visual.texto) && /[\\$]/.test(visual.texto)) {
        errores.push('formula.texto no puede contener "\\" ni "$" (notación plana, sin LaTeX)');
      }
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
        // Fijado tras la pasada adversarial: "ano" repetido no tiene sentido en una línea de
        // tiempo (dos hitos en el mismo punto) y el generador lo produce alguna vez.
        const anos = visual.hitos.map((h) => h && h.ano).filter((a) => typeof a === 'string');
        if (new Set(anos).size !== anos.length) {
          errores.push('linea-tiempo.hitos tiene "ano" repetido');
        }
      }
      break;
    }
    case 'barras': {
      if (!Array.isArray(visual.items) || visual.items.length < 2 || visual.items.length > 5) {
        errores.push('barras.items debe tener 2-5 elementos');
      } else {
        visual.items.forEach((it, i) => {
          limite(errores, it && esTextoNoVacio(it.etiqueta) && it.etiqueta.length <= 16, `barras.items[${i}].etiqueta inválida (1-16 caracteres)`);
          // > 0, no solo numérico/finito (fijado tras la pasada adversarial, 13-sep-2026): son
          // magnitudes comparables en un gráfico de barras -- un cero o un negativo rompen el
          // dibujo (barra de altura nula o invertida). Mismo hallazgo que hizo el revisor de la
          // Tarea 2 en visuales.js del lado del pintado.
          limite(errores, it && typeof it.valor === 'number' && Number.isFinite(it.valor) && it.valor > 0, `barras.items[${i}].valor debe ser numérico y > 0`);
          if (it && it.unidad !== undefined && it.unidad !== null) {
            limite(errores, typeof it.unidad === 'string' && it.unidad.length <= 6, `barras.items[${i}].unidad inválida (máx. 6 caracteres)`);
          }
        });
      }
      // "fuente" OBLIGATORIA (endurecido en la ronda de corrección 1, 13-sep-2026: antes era
      // opcional en el esquema y solo se exigía "no vacía" en el verificador -- eso dejaba pasar
      // "Concepto físico estándar", "Datos geográficos estándar", "Cálculo propio sobre
      // enunciado"... con pinta de fuente pero sin año ni institución real). Ver validarFuente().
      const resultadoFuenteBarras = validarFuente(visual.fuente);
      if (!resultadoFuenteBarras.ok) errores.push(`barras.fuente ${resultadoFuenteBarras.motivo}`);
      // Mismo hallazgo, otro disfraz: "típica"/"aproximada"/"estimada" en el título o la leyenda
      // son la misma cifra ilustrativa, esta vez en el texto visible en vez de en la fuente.
      if (contieneFraseIlustrativa(visual.titulo)) errores.push('barras.titulo sugiere una cifra ilustrativa ("típica"/"aproximada"/"estimada")');
      if (contieneFraseIlustrativa(visual.leyenda)) errores.push('barras.leyenda sugiere una cifra ilustrativa ("típica"/"aproximada"/"estimada")');
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
      // "fuente" OBLIGATORIA, mismo motivo y misma regla que en "barras" (ver arriba).
      const resultadoFuenteDato = validarFuente(visual.fuente);
      if (!resultadoFuenteDato.ok) errores.push(`dato.fuente ${resultadoFuenteDato.motivo}`);
      if (contieneFraseIlustrativa(visual.leyenda)) errores.push('dato.leyenda sugiere una cifra ilustrativa ("típica"/"aproximada"/"estimada")');
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

// Ola final v0.2b4 (M3): ÚNICA fuente del límite de palabras de la explicación. Antes el 40 estaba
// además escrito a mano en los prompts, en el corte del reintento y en la comprobación en código
// del verificador -- cambiar el límite en un sitio y olvidarlo en otro daba un generador pidiendo
// una cosa y un verificador rechazando otra.
const LIMITE_PALABRAS_EXPLICACION = 40;

/** v0.2b4 §6b: ¿la explicación que YA trae la pregunta cabe en el límite? Si la respuesta es sí, no
 * tiene sentido gastar una llamada en reescribirla: el verificador de preguntas
 * (servidor/generacion.js#verificarBorradores) ya la dio por buena factualmente, y "reescribir para
 * acortar" era el único motivo de ese paso. */
export function explicacionYaCumple(texto) {
  const palabras = contarPalabras(texto);
  return palabras > 0 && palabras <= LIMITE_PALABRAS_EXPLICACION;
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

function promptSistemaGenerador(criterioTexto, { soloVisual = false } = {}) {
  // v0.2b4 §6b: cuando la explicación que trae la pregunta ya cabe en el límite de palabras
  // (`explicacionYaCumple`), no tiene sentido pedirle al modelo que la reescriba -- ya la verificó
  // verificarBorradores, y esta llamada existía solo para acortarla. `soloVisual` sustituye ese
  // párrafo por una instrucción explícita de NO tocarla, y solo se pide el VISUAL.
  const bloqueExplicacion = soloVisual
    ? 'La EXPLICACIÓN de esta pregunta ya es correcta y ya cabe en el límite de palabras: NO la ' +
      'reescribas y NO la devuelvas. Tu única tarea en esta llamada es el VISUAL.\n\n'
    : `EXPLICACIÓN: DE 25 A ${LIMITE_PALABRAS_EXPLICACION} PALABRAS -- por debajo de 25 se queda coja ` +
      `y por encima de ${LIMITE_PALABRAS_EXPLICACION} se ` +
      'RECHAZA automáticamente aunque el contenido sea perfecto, así que apunta a 32-36 palabras como ' +
      'objetivo real (cuenta las palabras que llevas antes de terminar la frase; si te pasas, recorta, ' +
      'no añadas "..."). Español ' +
      // M2: "en 2 frases" era una talla única que empujaba a alargar explicaciones que cabían en una.
      'impecable, en 1-2 frases: (1) el porqué -- el mecanismo o la razón, no solo repetir el enunciado; ' +
      '(2) un gancho memorable: una anécdota, un dato sorprendente o su conexión con la actualidad ' +
      '(2022-2026) si existe, sin que la pregunta dependa de él. No pierdas el hecho clave de la ' +
      'explicación original.\n\n';
  // Ola final v0.2b4 (M1): con `soloVisual`, la frase de entrada tampoco puede hablar de
  // "reescribir la EXPLICACIÓN" -- contradecía al párrafo siguiente ("NO la reescribas") y era una
  // invitación a devolverla igualmente. La forma exacta del JSON pedido ya excluye "explicacion"
  // en ese modo (ver el final de esta función).
  const introduccion = soloVisual
    ? 'Tu tarea ahora NO es generar preguntas nuevas: es proponer un VISUAL de apoyo para la ' +
      'tarjeta de respuesta de una pregunta ya existente.\n\n'
    : 'Tu tarea ahora NO es generar preguntas nuevas: es reescribir la EXPLICACIÓN de una pregunta ya ' +
      'existente y, si se te pide, proponer un VISUAL de apoyo para la tarjeta de respuesta.\n\n';
  return (
    `${criterioTexto}\n\n` +
    introduccion +
    bloqueExplicacion +
    'VISUAL (solo si "necesita_visual" es true): un objeto de DATOS -- nunca un dibujo, la app lo ' +
    'pinta con plantillas propias -- que ilustre la "respuesta_correcta" indicada (nunca una opción ' +
    'incorrecta ni el dato erróneo cuando se te avisa de cuál es). Elige el tipo más natural para el ' +
    'tema (economía → formula/comparacion; historia → linea-tiempo; filosofía → comparacion/flujo; ' +
    'lógica → flujo/comparacion; ciencia → formula/flujo; geografía/tecnología → formula/comparacion; ' +
    '"barras"/"dato" NUNCA son el tipo por defecto de ningún área -- son el ÚLTIMO RECURSO, ver la ' +
    'REGLA DURA más abajo) y respeta EXACTAMENTE uno de estos esquemas y límites (todos los datos ' +
    'deben ser reales y comprobables, nunca inventados):\n' +
    '  - formula: {"tipo":"formula","texto":"…","leyenda":"…"} texto ≤ 40 caracteres, notación plana ' +
    '(×, −, /, =), SIN LaTeX -- nunca "\\" ni "$", se pintaría literal. Ej.: "PIB = C + I + G + (X − ' +
    'M)".\n' +
    '  - linea-tiempo: {"tipo":"linea-tiempo","hitos":[{"ano":"…","texto":"…"}, …],"leyenda":"…"} 3-5 ' +
    'hitos EN ORDEN CRONOLÓGICO ASCENDENTE (el más antiguo primero), "ano" ≤ 9 caracteres y NUNCA ' +
    'repetido entre hitos, "texto" ≤ 22.\n' +
    '  - barras: {"tipo":"barras","titulo":"…","items":[{"etiqueta":"…","valor":0,"unidad":"…"}, …],' +
    '"leyenda":"…","fuente":"…"} 2-5 items, "etiqueta" ≤ 16, "valor" NUMÉRICO real y POSITIVO (> 0; ' +
    'nunca inventado, nunca cero ni negativo -- si el dato real es una caída a cero o un cambio de ' +
    'signo, usa otro tipo de visual), "unidad" ≤ 6 (opcional), "titulo" opcional.\n' +
    '  - comparacion: {"tipo":"comparacion","columnas":[{"titulo":"…","puntos":["…"]}, …],"leyenda":' +
    '"…"} EXACTAMENTE 2 columnas, 2-3 puntos cada una, "titulo" ≤ 16, cada punto ≤ 28.\n' +
    '  - flujo: {"tipo":"flujo","pasos":["…", …],"leyenda":"…"} 2-4 pasos, ≤ 18 caracteres cada uno.\n' +
    '  - dato: {"tipo":"dato","cifra":"…","texto":"…","leyenda":"…","fuente":"…"} "cifra" ≤ 8 ' +
    'caracteres, "texto" ≤ 40. Último recurso cuando nada más encaja.\n' +
    '"leyenda" ≤ 60 caracteres en todos los tipos.\n\n' +
    'REGLA DURA sobre "barras" y "dato" (nunca la rompas -- endurecida en la ronda de corrección 1, ' +
    '13-sep-2026, tras encontrar en producción cifras inventadas o "típicas" coladas como reales): ' +
    'son el ÚLTIMO RECURSO, nunca la opción por defecto. Solo valen para magnitudes PUBLICADAS y ' +
    'AMPLIAMENTE CONOCIDAS: población, PIB, superficie, latitud/longitud, fechas, densidades ' +
    'físicas (densidad, punto de fusión/ebullición...), emisiones de CO2 de fuentes oficiales (p. ' +
    'ej. tablas del IPCC) o cuotas de mercado de informes ya publicados. PROHIBIDO usar "barras" o ' +
    '"dato" para: múltiplos de valoración de empresas (PER, EV/EBITDA...), márgenes "típicos" de un ' +
    'sector, repartos porcentuales de los ingresos de una empresa concreta, efectos estimados de ' +
    'una política económica, o cualquier ranking/orden (1, 2, 3...) -- para todo eso usa ' +
    '"comparacion", "flujo" o "formula", NUNCA "barras"/"dato". Igual si el concepto es CUALITATIVO ' +
    '(una técnica artística, una idea filosófica, una falacia lógica, un proceso, una corriente de ' +
    'pensamiento): "comparacion", "flujo", "linea-tiempo" o "formula", NUNCA "barras" ni "dato". ' +
    'PROHIBIDO inventar un porcentaje o una cifra "para ilustrar" un concepto (ejemplo de lo que ' +
    'NUNCA hay que hacer: inventarte "40 % / 60 %" para representar el efecto de una técnica ' +
    'pictórica -- eso no es un dato, es una ilustración inventada, y se rechaza siempre). Cuando SÍ ' +
    'uses "barras" o "dato", "fuente" es OBLIGATORIA y tiene un formato ESTRICTO que se comprueba en ' +
    'código: 8-40 caracteres, con un año de 4 dígitos Y el nombre de la institución o publicación ' +
    'concreta (ejemplos válidos: "Banco Mundial 2023", "INE 2024", "NASA 2023", "Eurostat 2022"); ' +
    'NUNCA "estándar", "concepto", "aproximado", "típico", "genérico", "de manual", "cálculo ' +
    'propio", "estimación propia" ni "análisis" -- esas frases se RECHAZAN siempre, aunque el dato ' +
    'en sí sea correcto. Si no tienes un dato real, publicado y verificable con esa fuente exacta, ' +
    'NO propongas barras/dato: usa otro tipo.\n' +
    'Si "necesita_visual" es false, no incluyas la clave "visual" (o ponla a null).\n\n' +
    (soloVisual
      ? 'Devuelve SOLO JSON con la forma exacta: {"visual":{...}|null}'
      : 'Devuelve SOLO JSON con la forma exacta: {"explicacion":"…","visual":{...}|null}')
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

function promptSistemaVerificador(criterioTexto, { soloVisual = false } = {}) {
  // v0.2b4 §6b: cuando la explicación no se ha reescrito (resolverPregunta#saltarAcortado), no se
  // le pide al verificador que la juzgue -- no hay nada nuevo que verificar ahí, y el párrafo solo
  // añadiría ruido (o peor, una excusa para rechazar algo que no se tocó).
  const bloqueExplicacion = soloVisual
    ? 'Verificas, de forma ESCÉPTICA e independiente de quien lo propuso, un visual de apoyo para ' +
      'una pregunta de quiz ya existente. La explicación de esta pregunta NO se ha tocado (ya estaba ' +
      'verificada de antes): no la juzgues, céntrate solo en el visual.\n'
    : 'Verificas, de forma ESCÉPTICA e independiente de quien la propuso, una explicación corta y (si ' +
      'se te da) un visual de apoyo para una pregunta de quiz ya existente.\n' +
      '"explicacionOk" es true SOLO si la propuesta conserva el hecho clave de la "explicacion_actual", ' +
      'no introduce ningún error factual ni de redacción/concordancia, y no se pasa claramente de ' +
      `${LIMITE_PALABRAS_EXPLICACION} palabras.\n`;
  return (
    `${criterioTexto}\n\n` +
    bloqueExplicacion +
    '"visualOk" (solo si se te da "visual_propuesto", si no lo hay pon true) es true SOLO si los ' +
    'datos son reales y comprobables (nunca inventados ni aproximados sin base), ilustran la ' +
    '"respuesta_correcta" indicada (nunca una opción incorrecta ni el dato erróneo cuando se avisa de ' +
    'cuál es), y el tipo de visual elegido es razonable para el tema.\n' +
    'COMPROBACIÓN OBLIGATORIA cuando el tipo sea "barras" o "dato" -- AUTOVERIFICACIÓN FORZADA, no ' +
    'una impresión general (ronda de corrección 1, 13-sep-2026: "¿parece inventado?" dejaba pasar ' +
    'demasiadas cifras "típicas"): para CADA cifra de "barras"/"dato", reconstruye TÚ MISMO, con tu ' +
    'propio conocimiento, el valor que esperarías para ese dato concreto con esa fuente y ese año. ' +
    'Si no puedes reproducirlo con confianza razonable (±15 %), o el valor propuesto difiere ' +
    'claramente de tu propia reconstrucción, "visualOk" es false con motivo "cifra no reproducible: ' +
    '<cuál>" (aunque el resto del visual esté bien formado y tenga "fuente"). Una serie de índices u ' +
    'órdenes ORDINALES inventados (1, 2, 3, 4 sin unidad real detrás) es SIEMPRE false. Una ' +
    'proyección o cifra de una tecnología futura o aún no comercializada (p. ej. "baterías de ' +
    'estado sólido: 500 Wh/kg") es SIEMPRE false salvo que sea una cifra concreta ya publicada por ' +
    'la institución citada en "fuente" (no una expectativa genérica del sector).\n' +
    'COMPROBACIÓN OBLIGATORIA cuando el tipo sea "linea-tiempo": comprueba que los "hitos" están en ' +
    'orden cronológico ascendente (el año más antiguo primero); si están desordenados, "visualOk" es ' +
    'false con motivo "hitos desordenados cronológicamente".\n' +
    'Ante la duda, false. Devuelve SOLO JSON con la forma exacta: ' +
    (soloVisual
      ? '{"visualOk":true|false,"motivo":"…"}'
      : '{"explicacionOk":true|false,"visualOk":true|false,"motivo":"…"}') +
    ' ("motivo" explica cualquier false, breve y en español; puede ir vacío si todo es true).'
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
    // Ola final v0.2b4.1 (I1/I2): plazo por llamada. `undefined` = el de siempre (120 s, ver
    // tools/openrouter.js); servidor/generacion.js pasa 30 s en las tandas urgentes.
    timeoutMs,
    // Ola final v0.2b4.1 (#3): señal para abortar la llamada si quien espera ya se rindió (el
    // plazo del visual de una tanda urgente, ver servidor/generacion.js#conLimite).
    signal,
    // v0.2b4 §6b: cuando la explicación ya cumple el límite (ver resolverPregunta#saltarAcortado),
    // esta llamada solo pide el VISUAL -- una sola vuelta, sin reintentos de "explicacion" que no
    // se ha pedido.
    soloVisual = false,
  } = opciones;

  // Hasta 3 intentos (endurecido en la ronda de corrección 1, 13-sep-2026 -- antes eran 2 y solo
  // reintentaban una "explicacion" ausente/vacía): el primer intento normal; si falla por vacía O
  // por pasarse de 40 palabras, un segundo intento con feedback específico; si el segundo sigue
  // fallando, un TERCER intento con la instrucción más estricta posible ("máximo 32 palabras, dos
  // frases"). Si tras los 3 sigue sin cumplir, se devuelve igualmente la última propuesta no vacía
  // (o '' si nunca llegó ninguna) -- quien llama (verificarVisualYExplicacion) la rechaza siempre
  // que siga > 40 palabras o vacía, y resolverPregunta conserva la explicación original del banco.
  let explicacion = '';
  let visual = null;
  let modeloUsado = '';
  let costeTotal = 0;
  const INTENTOS_EXPLICACION = 3;
  const intentosExplicacion = soloVisual ? 1 : INTENTOS_EXPLICACION;
  let notaReintento = '';

  for (let intento = 0; intento < intentosExplicacion; intento++) {
    const mensajes = [
      { role: 'system', content: promptSistemaGenerador(criterio, { soloVisual }) },
      { role: 'user', content: promptUsuarioGenerador(pregunta, necesitaVisual, motivoRechazo) + notaReintento },
    ];

    const salida = await llamarFn({
      modelos,
      mensajes,
      json: true,
      temperatura: 0.6,
      maxTokens: 1500,
      permitirPago,
      topeEur,
      timeoutMs,
      signal,
      extra: SIN_RAZONAMIENTO,
      ...(rutaLog ? { rutaLog } : {}),
    });
    costeTotal += salida.coste;
    modeloUsado = salida.modelo;

    const datos = extraerJson(salida.texto);

    if (soloVisual) {
      // La explicación se devuelve tal cual llegó: este modo no la juzga ni la toca (no se le pidió
      // al modelo, así que "datos.explicacion" ni siquiera debería venir).
      explicacion = pregunta.explicacion;
      visual = necesitaVisual && datos.visual && typeof datos.visual === 'object' ? datos.visual : null;
      break;
    }

    const explicacionCandidata = typeof datos.explicacion === 'string' ? datos.explicacion.trim() : '';
    const palabras = contarPalabras(explicacionCandidata);

    if (explicacionCandidata) {
      explicacion = explicacionCandidata;
      visual = necesitaVisual && datos.visual && typeof datos.visual === 'object' ? datos.visual : null;
    }
    if (explicacionCandidata && palabras <= LIMITE_PALABRAS_EXPLICACION) {
      break; // válida: no gasta el/los intento(s) que quedaran
    }

    // Prepara la nota del siguiente intento, si queda alguno.
    if (intento === 0) {
      notaReintento = explicacionCandidata
        ? `\n\nIMPORTANTE: en el intento anterior tu "explicacion" tenía ${palabras} palabras (> ${LIMITE_PALABRAS_EXPLICACION}, se habría rechazado). Recórtala sin perder el hecho clave.`
        : '\n\nIMPORTANTE: en el intento anterior no devolviste "explicacion" (vacía o ausente). Esta vez inclúyela SIEMPRE, no vacía.';
    } else if (intento === 1) {
      notaReintento =
        '\n\nIMPORTANTE: este es tu ÚLTIMO intento. Escribe "explicacion" en MÁXIMO 32 palabras, exactamente ' +
        'dos frases, sin perder el hecho clave. Cuenta las palabras antes de terminar.';
    }
  }

  return { explicacion, visual, modelo: modeloUsado, coste: costeTotal };
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
 * @param {boolean} [opciones.soloVisual] v0.2b4 §6b: no juzga la explicación (fuerza explicacionOk:
 *   true), ni al modelo ni en código -- para cuando no se le pidió reescribirla.
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
    timeoutMs, // I1/I2, igual que en generarVisualYExplicacion
    signal, // #3, igual que en generarVisualYExplicacion
    // v0.2b4 §6b: cuando la explicación no se ha tocado (soloVisual, ver generarVisualYExplicacion),
    // no se juzga -- ni al modelo (el prompt omite el párrafo) ni en código.
    soloVisual = false,
  } = opciones;

  const listaModelos = excluirModelo ? modelos.filter((m) => m !== excluirModelo) : modelos;
  if (listaModelos.length === 0) {
    throw new Error('verificarVisualYExplicacion: no quedan modelos en la cascada tras excluir el generador');
  }

  const mensajes = [
    { role: 'system', content: promptSistemaVerificador(criterio, { soloVisual }) },
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
    timeoutMs,
    signal,
    extra: SIN_RAZONAMIENTO,
    ...(rutaLog ? { rutaLog } : {}),
  });

  const datos = extraerJson(salida.texto);
  const motivoModelo = typeof datos.motivo === 'string' ? datos.motivo : '';

  let explicacionOk;
  let motivoExplicacion = '';
  if (soloVisual) {
    // No se ha pedido reescribirla: no hay nada nuevo que rechazar.
    explicacionOk = true;
  } else {
    // Comprobación en código, no solo criterio del modelo: visto en vivo el 13-sep-2026 (primera
    // pregunta de la ejecución completa, art-001) que el verificador puede dar explicacionOk:true a
    // una propuesta de 54 palabras (el límite de 40 es un dato objetivo y contable, igual que los
    // límites de validarVisual -- no debe depender solo de que el modelo cuente bien).
    const dentroDelLimite = contarPalabras(propuesta.explicacion) <= LIMITE_PALABRAS_EXPLICACION;
    // Igual de objetivo: una explicación vacía nunca es válida, tras el reintento de
    // generarVisualYExplicacion o no (fijado tras la pasada adversarial del 13-sep-2026).
    const explicacionVacia = !esTextoNoVacio(propuesta.explicacion);
    explicacionOk = datos.explicacionOk === true && dentroDelLimite && !explicacionVacia;
    if (!explicacionOk) {
      motivoExplicacion = explicacionVacia
        ? 'el generador no produjo una explicación válida (vacía tras reintentar)'
        : !dentroDelLimite
          ? `explicación de ${contarPalabras(propuesta.explicacion)} palabras (> ${LIMITE_PALABRAS_EXPLICACION})`
          : motivoModelo || 'explicación rechazada sin motivo';
    }
  }

  let visualOk;
  let motivoVisual = '';
  if (!necesitaVisual) {
    visualOk = true;
  } else if (!propuesta.visual) {
    visualOk = false;
    motivoVisual = motivoModelo || 'el generador no devolvió ningún visual';
  } else {
    // Guardarraíl en código, no solo criterio del modelo (mismo principio que el límite de 40
    // palabras): fijado por Carlos el 13-sep-2026 tras ver en producción un "barras" con
    // porcentajes inventados (40 %/60 %) para ilustrar una técnica pictórica. validarVisual()
    // exige "fuente" con formato estricto en "barras"/"dato" (ver validarFuente, ronda de
    // corrección 1) -- esquema.ok ya cubre esto solo, así que el verificador SIEMPRE lo aplica sin
    // depender de que el modelo se acuerde de comprobarlo (antes había aquí una comprobación
    // ad-hoc duplicada de "fuente no vacía"; ahora validarVisual es la única fuente de verdad).
    const esquema = validarVisual(propuesta.visual);
    visualOk = datos.visualOk === true && esquema.ok;
    if (!visualOk) {
      motivoVisual = !esquema.ok ? `esquema inválido: ${esquema.errores.join('; ')}` : motivoModelo || 'visual rechazado sin motivo';
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
 * @param {boolean} [opciones.saltarAcortado] v0.2b4 §6b: opt-in, por defecto `false`. Cuando es
 *   `true` Y `pregunta.explicacion` ya cabe en el límite de palabras (`explicacionYaCumple`), esta
 *   llamada NO reescribe la explicación -- solo pide/verifica el visual (una llamada al generador +
 *   una al verificador, en vez de las dos rondas normales). Lo activa servidor/generacion.js, donde
 *   la explicación acaba de salir del generador de preguntas ya con el límite de 25-40 y ya la
 *   verificó verificarBorradores. Por defecto `false`: la CLI de este mismo fichero existe
 *   justamente para reescribir explicaciones del banco, y sus tests (y su utilidad) no deben
 *   cambiar sin pedirlo explícitamente.
 * @returns {Promise<{
 *   explicacion: string, explicacionCambiada: boolean, motivoExplicacionRechazo: string|null,
 *   visual: object|null, motivoVisualRechazo: string|null,
 *   modeloGenerador: string, modeloVerificador: string, coste: number,
 * }>}
 */
export async function resolverPregunta(pregunta, opciones = {}) {
  const necesitaVisual = opciones.necesitaVisual !== false;
  const saltarAcortado = opciones.saltarAcortado === true && explicacionYaCumple(pregunta.explicacion);
  let coste = 0;

  // opciones.modelosGenerador/modelosVerificador (distintos de "modelos" a secas) permiten forzar
  // una cascada concreta para cada papel sin que se mezclen entre sí -- los usa la CLI con
  // --sin-gratis para saltar del todo los modelos ':free' cuando están saturados (fijado por el
  // controlador el 13-sep-2026: la cascada gratis llevaba 25+ min sin resolver una sola pregunta).
  const opcionesGenerador = {
    ...opciones,
    necesitaVisual,
    soloVisual: saltarAcortado,
    ...(opciones.modelosGenerador ? { modelos: opciones.modelosGenerador } : {}),
  };
  const opcionesVerificador = {
    ...opciones,
    necesitaVisual,
    soloVisual: saltarAcortado,
    ...(opciones.modelosVerificador ? { modelos: opciones.modelosVerificador } : {}),
  };

  const propuesta = await generarVisualYExplicacion(pregunta, opcionesGenerador);
  coste += propuesta.coste;

  const verif = await verificarVisualYExplicacion(pregunta, propuesta, {
    ...opcionesVerificador,
    excluirModelo: propuesta.modelo,
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
        ...opcionesGenerador,
        motivoRechazo: motivoPrevio,
      });
      coste += reintento.coste;
      const verif2 = await verificarVisualYExplicacion(pregunta, reintento, {
        ...opcionesVerificador,
        excluirModelo: reintento.modelo,
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

  // saltarAcortado nunca cuenta como "cambiada": verif.explicacionOk viene forzado a true (soloVisual
  // no la juzga), pero la explicación es literalmente la misma que ya traía la pregunta -- ni una
  // palabra tocada.
  const explicacionCambiada = !saltarAcortado && verif.explicacionOk === true;

  return {
    explicacion: explicacionCambiada ? propuesta.explicacion : pregunta.explicacion,
    explicacionCambiada,
    motivoExplicacionRechazo: saltarAcortado
      ? null
      : explicacionCambiada
        ? null
        : verif.motivoExplicacion || verif.motivo || 'explicación rechazada sin motivo',
    visual: visualFinal,
    motivoVisualRechazo,
    modeloGenerador: propuesta.modelo,
    modeloVerificador: verif.modelo,
    modeloVisual,
    modeloVerificadorVisual,
    coste,
  };
}

/**
 * Ronda de corrección 1 (13-sep-2026), modo `--reverificar-visuales`: pasa por el verificador (con
 * las reglas ACTUALES, incluido el guardarraíl de "fuente" endurecido) los visuales YA guardados en
 * el banco, SIN regenerar nada -- solo confirma si el visual existente se sostiene o no. Es la
 * función "produce" testeable de ese modo; la CLI (ejecutarReverificarVisuales) hace la I/O de
 * disco y aplica los `null` resultantes a datos/banco.json.
 * @param {object[]} preguntas normalmente el banco completo
 * @param {object} opciones
 * @param {string[]} [opciones.tipos] tipos de visual a revisar; por defecto ['barras','dato']
 * @param {Function} [opciones.llamar] inyectable para tests
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {boolean} [opciones.sinGratis] usa VERIFICADOR_SOLO_PAGO en vez de VERIFICADOR_VISUAL
 * @param {number} [opciones.costeAcumuladoInicial] coste ya gastado hoy, para el corte proactivo
 *   por tope (el mismo que usa la CLI normal); 0 en tests.
 * @param {number} [opciones.pausaMs] pausa entre llamadas; 0 en tests para no ralentizarlos.
 * @param {Function} [opciones.onProgreso] callback(linea) opcional, para que la CLI vaya
 *   imprimiendo/logueando en vivo sin que esta función toque consola ni disco.
 * @returns {Promise<{revisadas: number, mantenidos: string[], retirados: {id:string,tipo:string,motivo:string}[], fallos: Map<string,string>, costeTotal: number, detenidoPorTope: boolean}>}
 */
export async function reverificarVisualesGuardados(preguntas, opciones = {}) {
  const {
    tipos = ['barras', 'dato'],
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    sinGratis = false,
    costeAcumuladoInicial = 0,
    pausaMs = PAUSA_ENTRE_PREGUNTAS_MS,
    onProgreso,
  } = opciones;

  const avisar = (linea) => {
    if (typeof onProgreso === 'function') onProgreso(linea);
  };

  const candidatas = (preguntas || []).filter((p) => p && p.visual && tipos.includes(p.visual.tipo));
  const mantenidos = [];
  const retirados = [];
  const fallos = new Map();
  let costeAcumulado = costeAcumuladoInicial;
  let detenidoPorTope = false;

  for (const pregunta of candidatas) {
    if (permitirPago && topeEur > 0 && costeAcumulado >= topeEur) {
      avisar(`\nTope de gasto alcanzado (${costeAcumulado.toFixed(4)} € >= ${topeEur} €): se detiene aquí. Progreso ya guardado.`);
      detenidoPorTope = true;
      break;
    }

    let verif;
    try {
      verif = await verificarVisualYExplicacion(
        pregunta,
        { explicacion: pregunta.explicacion, visual: pregunta.visual, modelo: null },
        {
          llamar: llamarFn,
          necesitaVisual: true,
          permitirPago,
          topeEur,
          ...(sinGratis ? { modelos: VERIFICADOR_SOLO_PAGO } : {}),
        },
      );
    } catch (err) {
      fallos.set(pregunta.id, err.message);
      avisar(`  ${pregunta.id}: FALLO — ${err.message}`);
      if (pausaMs > 0) await esperar(pausaMs);
      continue;
    }

    costeAcumulado += verif.coste;
    if (verif.visualOk) {
      mantenidos.push(pregunta.id);
      avisar(`  ${pregunta.id} [${pregunta.visual.tipo}]: mantenido`);
    } else {
      const motivo = verif.motivoVisual || verif.motivo || 'rechazado en re-verificación';
      retirados.push({ id: pregunta.id, tipo: pregunta.visual.tipo, motivo });
      avisar(`  ${pregunta.id} [${pregunta.visual.tipo}]: RETIRADO — ${motivo}`);
    }
    if (pausaMs > 0) await esperar(pausaMs);
  }

  return {
    revisadas: candidatas.length,
    mantenidos,
    retirados,
    fallos,
    costeTotal: costeAcumulado - costeAcumuladoInicial,
    detenidoPorTope,
  };
}

// --- CLI ----------------------------------------------------------------------------------------

function parsearArgs(argv) {
  const args = {
    soloPendientes: false,
    area: null,
    limite: 0,
    aplicar: false,
    permitirPago: false,
    topeEur: 0,
    sinGratis: false,
    ayuda: false,
    reverificarVisuales: false,
    tipos: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--solo-pendientes') args.soloPendientes = true;
    else if (a === '--area') args.area = argv[++i];
    else if (a === '--limite') args.limite = Number(argv[++i]);
    else if (a === '--aplicar') args.aplicar = true;
    else if (a === '--permitir-pago') args.permitirPago = true;
    else if (a === '--tope-eur') args.topeEur = Number(argv[++i]);
    else if (a === '--sin-gratis') args.sinGratis = true;
    else if (a === '--reverificar-visuales') args.reverificarVisuales = true;
    else if (a === '--tipos') {
      args.tipos = (argv[++i] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return args;
}

function imprimirAyuda() {
  console.log(`Uso: node tools/visualizar.js [--solo-pendientes] [--area X] [--limite N] [--aplicar]
       node tools/visualizar.js --aplicar --permitir-pago --tope-eur 0.5
       node tools/visualizar.js --reverificar-visuales [--tipos barras,dato] --aplicar --permitir-pago --sin-gratis --tope-eur 0.3

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
  --sin-gratis        Salta del todo la cascada ':free' (generador y verificador van directos al
                       modelo de pago barato). Requiere --permitir-pago. Pensado para cuando los
                       modelos gratis están saturados y frenan la ejecución masiva.
  --reverificar-visuales
                       Modo aparte (ronda de corrección 1, 13-sep-2026): NO genera nada nuevo --
                       pasa los visuales YA guardados en datos/banco.json (de los tipos en
                       --tipos, por defecto barras,dato) otra vez por el verificador con las
                       reglas actuales; los que fallen quedan en visual:null + motivo en
                       datos/visuales.log. Respeta --aplicar/--permitir-pago/--tope-eur/--sin-gratis.
  --tipos <lista>     Con --reverificar-visuales: tipos separados por comas (por defecto barras,dato).
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

/**
 * Hallazgo M5 (revisión final v0.1e): seis visuales retirados a mano por el controlador tras
 * revisión humana (datos/visuales.log, "revisión humana") volvían a aparecer en pasadas
 * posteriores del pipeline -- el generador no sabe que un id concreto ya falló para un tipo
 * concreto, así que lo vuelve a proponer, y puede volver a pasar la verificación automática
 * (mismo motivo por el que hizo falta ojo humano la primera vez). `exclusiones` es el contenido
 * de datos/visuales-excluidos.json: `{ [id]: { tipos: string[], motivo: string } }`.
 *
 * Función PURA (sin I/O): recibe el id de la pregunta, el visual ya resuelto (o null) y el mapa
 * de exclusiones ya cargado, y decide si ese visual concreto se descarta.
 * - Si el id no tiene entrada en `exclusiones`, no hay nada que filtrar: se devuelve tal cual.
 * - Si la tiene y `tipos` incluye el tipo del visual propuesto, se descarta (null).
 * - Si `tipos` está vacío (`[]`), NINGÚN visual vale para ese id -- no solo los tipos listados --
 *   así que también se descarta cualquier tipo.
 * @param {string} id
 * @param {object|null} visual visual ya resuelto por resolverPregunta (o null si no hubo)
 * @param {Record<string, {tipos: string[], motivo?: string}>} exclusiones
 * @returns {object|null} el mismo `visual`, o `null` si está excluido
 */
export function aplicarExclusionVisual(id, visual, exclusiones) {
  if (!visual) return visual;
  const entrada = exclusiones && exclusiones[id];
  if (!entrada) return visual;
  const tipos = Array.isArray(entrada.tipos) ? entrada.tipos : [];
  if (tipos.length === 0) return null; // sin tipos permitidos = ningún visual para este id
  return tipos.includes(visual.tipo) ? null : visual;
}

// CLI del modo --reverificar-visuales (ronda de corrección 1, 13-sep-2026): hace la I/O de disco y
// delega toda la lógica de decisión en reverificarVisualesGuardados (arriba), que es la función
// testeable sin tocar datos/banco.json ni datos/visuales.log de verdad.
async function ejecutarReverificarVisuales(args) {
  const tiposObjetivo = args.tipos.length > 0 ? args.tipos : ['barras', 'dato'];
  const tipoDesconocido = tiposObjetivo.find((t) => !TIPOS_VISUAL.includes(t));
  if (tipoDesconocido) {
    console.error(`--tipos: tipo de visual desconocido "${tipoDesconocido}". Válidos: ${TIPOS_VISUAL.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const lineasLog = [];
  const registrar = (linea) => {
    console.log(linea);
    lineasLog.push(linea);
  };

  const banco = JSON.parse(await readFile(RUTA_BANCO, 'utf8'));

  registrar(
    `\n=== reverificar-visuales ${new Date().toISOString()} — tipos [${tiposObjetivo.join(', ')}] ` +
      `${args.aplicar ? '' : '(SIN --aplicar: solo informa) '}` +
      `${args.permitirPago ? `(pago permitido, tope ${args.topeEur} €)` : '(solo modelos gratis)'} ===`,
  );

  const costeInicial = await costeAcumuladoHoy(RUTA_LOG_LLAMADAS);
  const resultado = await reverificarVisualesGuardados(banco, {
    tipos: tiposObjetivo,
    permitirPago: args.permitirPago,
    topeEur: args.topeEur,
    sinGratis: args.sinGratis,
    costeAcumuladoInicial: costeInicial,
    onProgreso: registrar,
  });

  registrar('\n=== Resumen reverificar-visuales ===');
  registrar(`Visuales guardados de tipo [${tiposObjetivo.join(', ')}]: ${resultado.revisadas}`);
  registrar(`Mantenidos: ${resultado.mantenidos.length}`);
  registrar(`Retirados: ${resultado.retirados.length}`);
  if (resultado.detenidoPorTope) registrar('AVISO: ejecución detenida por tope de gasto antes de terminar.');
  if (resultado.fallos.size > 0) {
    registrar(`Fallos de cascada: ${resultado.fallos.size}`);
    for (const [id, motivo] of resultado.fallos) registrar(`  ${id}: ${motivo}`);
  }
  registrar(`\nCoste real de esta ejecución (suma de 'coste' de las respuestas de la API): ${resultado.costeTotal.toFixed(6)} $`);

  if (!args.aplicar) {
    console.log('\n(sin --aplicar: no se ha escrito datos/banco.json ni datos/visuales.log)');
    return;
  }

  if (resultado.retirados.length > 0) {
    const porId = new Map(banco.map((p) => [p.id, p]));
    for (const { id } of resultado.retirados) {
      const p = porId.get(id);
      if (p) p.visual = null;
    }
    await writeFile(RUTA_BANCO, JSON.stringify(banco, null, 2), 'utf8');
  }
  await appendFile(RUTA_LOG, `${lineasLog.splice(0).join('\n')}\n`, 'utf8');
  console.log(`\nEscrito ${resultado.retirados.length > 0 ? RUTA_BANCO + ' y ' : ''}${RUTA_LOG}.`);
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    return;
  }
  // Fijado en la ronda de corrección 1 (13-sep-2026): --sin-gratis solo tiene sentido si hay un
  // modelo de pago al que caer -- sin --permitir-pago se quedaría sin ningún modelo posible
  // (esModeloGratis() los descarta a todos) y fallaría tarde, a mitad de la primera pregunta, tras
  // ya haber leído/impreso candidatas. Se corta aquí, antes de tocar nada.
  if (args.sinGratis && !args.permitirPago) {
    console.error('--sin-gratis requiere --permitir-pago (sin él no quedaría ningún modelo posible en la cascada).');
    process.exitCode = 1;
    return;
  }
  if (args.area && !AREAS.includes(args.area)) {
    console.error(`Área desconocida: ${args.area}. Válidas: ${AREAS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (args.reverificarVisuales) {
    await ejecutarReverificarVisuales(args);
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
  // M5: lista de exclusión manual (ver aplicarExclusionVisual) -- sin fichero, {} (nada excluido).
  const exclusionesVisual = JSON.parse(await readFile(RUTA_VISUALES_EXCLUIDOS, 'utf8').catch(() => '{}'));

  let candidatas = args.area ? banco.filter((p) => p.area === args.area) : banco.slice();
  if (args.soloPendientes) {
    const antes = candidatas.length;
    candidatas = candidatas.filter((p) => {
      const sinVisualNiImagen = !tieneVisualValido(p) && !(p.id in imagenes);
      const explicacionLarga = contarPalabras(p.explicacion) > LIMITE_PALABRAS_EXPLICACION;
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
  let procesadas = 0; // candidatas ya intentadas (éxito o fallo), para el aviso de progreso cada 50

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
          ...(args.sinGratis ? { modelosGenerador: GENERADOR_SOLO_PAGO, modelosVerificador: VERIFICADOR_SOLO_PAGO } : {}),
        });
      } catch (err) {
        fallos.set(pregunta.id, err.message);
        await registrar(`  ${pregunta.id}: FALLO — ${err.message}`);
        procesadas++;
        if (procesadas % 50 === 0) await registrar(`\n[progreso] ${procesadas}/${candidatas.length} candidatas intentadas, coste acumulado hoy ${costeAcumulado.toFixed(4)} €.`);
        await esperar(PAUSA_ENTRE_PREGUNTAS_MS);
        continue;
      }

      costeAcumulado += resultado.coste;

      // M5: la lista de exclusión manual gana sobre lo que diga la verificación automática --
      // un tipo/id ya rechazado a mano (datos/visuales-excluidos.json) no debe volver a colarse
      // solo porque esta pasada lo verificó "ok" (es justo el fallo que produjo la lista).
      if (resultado.visual) {
        const visualFiltrado = aplicarExclusionVisual(pregunta.id, resultado.visual, exclusionesVisual);
        if (!visualFiltrado) {
          const entrada = exclusionesVisual[pregunta.id];
          resultado = {
            ...resultado,
            visual: null,
            motivoVisualRechazo: `excluido por revisión humana (datos/visuales-excluidos.json${entrada && entrada.motivo ? `: ${entrada.motivo}` : ''})`,
          };
        }
      }

      resultados.set(pregunta.id, resultado);
      procesadas++;

      // Aviso pedido por el controlador (13-sep-2026): si una sola pregunta cuesta más de
      // 0,0015 €, avisar antes de seguir (no bloquea -- el tope global sigue siendo la barrera
      // real, esto es solo una señal de que algo se sale de lo esperado por pregunta).
      if (resultado.coste > 0.0015) {
        await registrar(`  AVISO: ${pregunta.id} costó ${resultado.coste.toFixed(6)} € (> 0,0015 € esperado por pregunta).`);
      }

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
      if (procesadas % 50 === 0) {
        await registrar(`\n[progreso] ${procesadas}/${candidatas.length} candidatas procesadas, coste acumulado hoy ${costeAcumulado.toFixed(4)} €.`);
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
