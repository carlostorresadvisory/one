// Prompts compartidos entre las CLIs (tools/generar-preguntas.js, tools/verificar-preguntas.js) y
// el servidor de generación infinita (servidor/generacion.js). Extraídos en la Tarea 1 del plan
// v0.2b1 (docs/superpowers/plans/2026-09-14-one-v0.2b1-servidor.md) para no duplicar lógica de
// generación entre la CLI y el servidor (spec v0.2 §3.1: "nada de lógica de generación se
// duplica"). El texto base es idéntico al que ya vivía en esas dos CLIs; las únicas adiciones son
// las tres que pide el brief de la Tarea 1: la ruta del átomo y la lista `evitar` en el prompt del
// generador (ambas opcionales, sin efecto cuando no se pasan — por eso el texto no cambia para las
// dos CLIs cuando se llaman como siempre), y el campo "nivel" en la salida del verificador (esta sí
// es una adición permanente al texto de PROMPT_SISTEMA_VERIFICADOR, autorizada explícitamente por
// el brief).
import { textoCriterio } from './criterio.js';

/**
 * Prompt de sistema del generador de preguntas. Con solo `area` (sin `ruta`/`nivelObjetivo`/
 * `evitar`) es exactamente el mismo texto que devolvía `promptSistema(area)` en
 * tools/generar-preguntas.js antes de esta extracción.
 * @param {string} area
 * @param {object} [opciones]
 * @param {string[]} [opciones.ruta] ruta del átomo, de más general a más concreto (p. ej.
 *   [hilo, subtema, ...]); vacía (por defecto) = sin afinar, comportamiento igual que antes.
 * @param {number} [opciones.nivelObjetivo] 1-5; si se da, concentra la tanda en ese nivel.
 * @param {string[]} [opciones.evitar] enunciados recientes que no hay que repetir.
 * @returns {string}
 */
export function promptSistemaGenerador(area, { ruta = [], nivelObjetivo, evitar = [] } = {}) {
  let texto =
    'Eres un autor de preguntas de un juego de aprendizaje para un adulto con formación ' +
    'universitaria. Escribe en español. Devuelve SOLO un objeto JSON con la forma ' +
    '{"preguntas": [ ... ]}, sin texto alrededor. Cada pregunta debe ser factualmente ' +
    'correcta, inequívoca y con una sola respuesta válida. Nivel 1 = cultura general ' +
    'sólida; nivel 5 = experto. Evita trivialidades y evita preguntas de fechas exactas ' +
    'o cifras que cambien con el tiempo.\n\n' +
    `${textoCriterio(area)}\n\n` +
    'Cada pregunta debe indicar en qué hilo de los de arriba encaja, con el campo "hilo": ' +
    'número (1 = el primero de la lista de hilos del área, 2 = el segundo, etc.). Reparte las ' +
    'preguntas entre los hilos en vez de concentrarlas todas en uno. La "explicacion" tiene que ' +
    'decir siempre el POR QUÉ (el mecanismo o la razón, no solo repetir el dato) en 1-3 frases y, ' +
    'cuando encaje de forma natural, conectar con un hecho, debate o noticia reciente (2022-2026) ' +
    'sin que la pregunta dependa de esa fecha para seguir siendo válida dentro de dos años. No ' +
    'generes nada de lo que las reglas de utilidad de arriba prohíben.';

  // Ruta del átomo (spec v0.2 §3.4.1): cuando el jugador ha afinado hasta un hilo/subtema concreto
  // desde la pantalla Átomo, la tanda se centra ahí en vez de repartirse por toda el área.
  if (ruta.length > 0) {
    const linea =
      ruta.length === 1
        ? `Céntrate en el hilo "${ruta[0]}".`
        : `Céntrate en el subtema "${ruta[ruta.length - 1]}" dentro del hilo "${ruta[0]}".`;
    texto += `\n\n${linea}`;
  }

  if (Number.isInteger(nivelObjetivo)) {
    texto += `\n\nConcentra la mayoría de las preguntas nuevas en torno al nivel ${nivelObjetivo} de la escala de arriba.`;
  }

  // Lista de enunciados recientes a evitar (colchón/reportadas ya servidos): sin esto el modelo
  // repite temas entre tandas sucesivas de la misma ruta.
  if (evitar.length > 0) {
    texto +=
      '\n\nNO repitas ni te acerques a estos enunciados ya usados recientemente (mismo tema y ' +
      `redacción parecida cuentan como repetición): ${evitar.map((e) => `"${e}"`).join('; ')}.`;
  }

  return texto;
}

/**
 * Prompt de usuario para pedir un lote de preguntas "vf" (verdadero/falso) con un reparto 50/50
 * exacto: `mitad` con "respuesta": true y `resto` con "respuesta": false. Movido aquí desde
 * servidor/generacion.js en la Ronda 2 de revisión de la Tarea 1 (14-sep-2026): es lógica de
 * generación de preguntas y este es el fichero de prompts compartidos, no el pipeline.
 * @param {number} n cuántas preguntas se piden en total (== mitad + resto)
 * @param {number} mitad cuántas deben llevar "respuesta": true
 * @param {number} resto cuántas deben llevar "respuesta": false
 * @param {number} numHilos hilos del área (para el campo "hilo": 1..numHilos)
 * @returns {string}
 */
export function promptUsuarioVF(n, mitad, resto, numHilos) {
  return (
    `Genera ${n} afirmaciones de verdadero/falso NUEVAS, EXACTAMENTE ${mitad} con "respuesta": true ` +
    `y ${resto} con "respuesta": false (nunca desequilibres esta proporción; las falsas deben ser ` +
    'plausibles -- un dato, fecha, autor o relación cambiados por otro verosímil -- nunca absurdas ' +
    'ni obvias). Repártelas entre los niveles 1 a 5. Responde con un objeto JSON ' +
    '{"preguntas": [ ... ]} donde cada elemento tiene exactamente este esquema: { "enunciado": ' +
    '"string", "explicacion": "string", "nivel": 1..5, "respuesta": true|false, "hilo": ' +
    `1..${numHilos} (número del hilo de la lista de arriba en el que encaja) }.\n` +
    `Ejemplos válidos (no los repitas, son solo formato): ${JSON.stringify(EJEMPLOS.vf)}`
  );
}

// Mismos 4 ejemplos que EJEMPLOS en tools/generar-preguntas.js (sin cambios).
export const EJEMPLOS = {
  // Dos ejemplos para V/F: sin uno falso el generador sesga a "verdadero" (69 % en el primer lote).
  vf: [
    { enunciado: 'El agua hierve a 100°C al nivel del mar.', respuesta: true, hilo: 1 },
    { enunciado: 'La Revolución Francesa comenzó en 1799.', respuesta: false, hilo: 1 },
  ],
  test4: {
    enunciado: '¿Cuál es la capital de Francia?',
    opciones: ['Madrid', 'París', 'Roma', 'Berlín'],
    correcta: 1,
    hilo: 1,
  },
  ordenar: {
    enunciado: 'Ordena de menor a mayor.',
    criterio: 'de menor a mayor',
    items: ['1', '10', '100', '1000'],
    hilo: 1,
  },
  error: {
    enunciado: 'Encuentra el dato erróneo en la tarjeta.',
    tarjeta: {
      titulo: 'Planetas',
      filas: [
        { etiqueta: 'Mercurio', valor: 'más cercano al Sol' },
        { etiqueta: 'Venus', valor: 'tiene lunas' },
        { etiqueta: 'Marte', valor: 'planeta rojo' },
      ],
    },
    sospechoso: 1,
    hilo: 1,
  },
};

// PROMPT_SISTEMA_VERIFICADOR: mismo texto que PROMPT_SISTEMA en tools/verificar-preguntas.js,
// ampliado con el campo "nivel" (spec v0.2 §3.1: "una sola llamada de verificación" que sustituye a
// las tres pasadas de la CLI — correcta/única/inequívoca/utilidad/nivel/confianza en una vez; el
// nivel que devuelve el verificador manda siempre sobre el que propuso el generador).
export const PROMPT_SISTEMA_VERIFICADOR =
  'Eres un verificador escéptico de preguntas de examen. Para cada pregunta, comprueba ' +
  'si la respuesta marcada es correcta, si es la única correcta entre las opciones y si ' +
  'el enunciado es inequívoco. Rechaza también (inequivoca=false) si el enunciado contiene o ' +
  'revela la respuesta, si hay dos opciones defendibles, o si una afirmación V/F depende de una ' +
  'interpretación. Sé estricto: ante la duda, rechaza.\n\n' +
  `${textoCriterio()}\n` +
  'Además de lo anterior, comprueba también la UTILIDAD: si la pregunta viola alguna de las ' +
  'reglas de utilidad de arriba (trivia de especialista, siglas, puertos, versiones, fechas ' +
  'sueltas, etc.), pon "cumpleUtilidad": false y haz que el motivo empiece por "utilidad: ". Si ' +
  'las cumple, pon "cumpleUtilidad": true.\n' +
  'Evalúa también el NIVEL (1-5) de la pregunta con la escala de arriba: tu "nivel" sustituye ' +
  'siempre al que haya propuesto quien la generó.\n' +
  'Devuelve SOLO JSON con la forma {"resultados":[{"id":"…","correcta":true,"unica":true,' +
  '"inequivoca":true,"cumpleUtilidad":true,"nivel":1,"confianza":0.9,"motivo":"…"}]}';
