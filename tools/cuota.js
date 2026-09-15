// Reparto por cuota entre los eslabones de una cascada (spec v0.2b4.1 §2).
//
// Por qué existe: una tanda de 10 con visuales gasta ~35.000 tokens y Groq da 8.000 tokens/MINUTO
// POR MODELO (spec §0). Con un solo modelo serían 4-5 minutos de espera forzada. La única forma de
// bajar de 60 s sin pagar es repartir entre modelos y proveedores -- y para repartir bien hay que
// saber a quién le queda hueco, que es justo lo que este módulo recuerda.
//
// PURO a propósito: no importa nada, no hace red ni disco, no lee `process.env`. Se alimenta SOLO
// de cabeceras que ya vienen en respuestas que alguien más pidió. Quien no manda cabeceras (Gemini,
// NVIDIA, Cerebras hoy) simplemente no tiene registro, y "sin registro" significa DISPONIBLE: este
// módulo nunca puede bloquear un eslabón del que no sabe nada.

const CABECERA_TOKENS_RESTANTES = 'x-ratelimit-remaining-tokens';
const CABECERA_PETICIONES_RESTANTES = 'x-ratelimit-remaining-requests';
const CABECERA_RESET_TOKENS = 'x-ratelimit-reset-tokens';
const CABECERA_RETRY_AFTER = 'retry-after';

/** Ventana de la cuota de tokens de Groq: 8.000 tokens por MINUTO (spec §0). */
export const VENTANA_TOKENS_MS = 60000;
/** Las peticiones/día no se recuperan hasta mañana: como "cuándo vuelve", un día entero. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;
/** Spec §2: "Estimación de tokens = longitud del prompt / 3,5 + maxTokens". */
const CARACTERES_POR_TOKEN = 3.5;

/**
 * Tokens que va a costar, más o menos, una llamada. No hace falta que sea exacto: solo decide si
 * cabe en lo que queda de la ventana del minuto, y errar por exceso es lo prudente.
 * @param {{content?: string}[]} mensajes
 * @param {number} [maxTokens] margen de salida reservado
 * @returns {number}
 */
export function estimarTokens(mensajes, maxTokens = 0) {
  const caracteres = (Array.isArray(mensajes) ? mensajes : []).reduce(
    (suma, m) => suma + (typeof m?.content === 'string' ? m.content.length : 0),
    0,
  );
  return Math.ceil(caracteres / CARACTERES_POR_TOKEN) + (Number(maxTokens) || 0);
}

/**
 * Convierte a milisegundos los formatos de duración que devuelven de verdad estas APIs:
 * `retry-after` de HTTP es un número de SEGUNDOS; Groq manda `x-ratelimit-reset-*` como `2.5s`,
 * `500ms` o `1m30s`. Lo que no se entiende devuelve `null` (nunca `NaN`, que envenenaría las
 * comparaciones de más abajo y haría que un eslabón pareciera bloqueado para siempre).
 * @param {string|null|undefined} valor
 * @returns {number|null}
 */
export function msDeCabecera(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().toLowerCase();
  if (!texto) return null;
  if (/^\d+(\.\d+)?$/.test(texto)) return Number(texto) * 1000;
  const partes = texto.match(/^(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?$/);
  if (partes && (partes[1] || partes[2])) {
    return (Number(partes[1] || 0) * 60 + Number(partes[2] || 0)) * 1000;
  }
  const enMs = texto.match(/^(\d+(?:\.\d+)?)ms$/);
  if (enMs) return Number(enMs[1]);
  return null;
}

// Marcador temporal (Step 3 del brief): el import de tests/cuota.test.js ya declara las cuatro
// exportaciones desde el principio (ESM resuelve los imports en estático, antes de ejecutar ningún
// test), así que `crearRegistroCuota` tiene que existir ya aunque los tests de este ciclo TDD
// todavía no la llamen. Se sustituye por la implementación real en el Step 8.
export function crearRegistroCuota() {
  throw new Error('cuota: crearRegistroCuota aún no implementado (llega en el siguiente ciclo TDD)');
}
