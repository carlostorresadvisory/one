// ONE · contrarreloj.js — reglas puras de Contrarreloj (spec v0.3 §5.4 y v0.3.1 §6): preguntas cortas de nivel 1-5
// con rampa de dificultad (1-2 → nivel 1 … 9-10 → nivel 5), tiempo lineal por pregunta, caída, cofre, «doble o nada» y récords. Sin DOM. La serie NO se persiste
// (spec §11): si iOS mata la app a mitad, se pierde sin contar como caída; solo los récords se guardan.

import { medirAncho } from './visuales.js';
import { sortearObjeto } from './mochila.js';

export const N_SERIE = 10;
export const CLAVE_CONTRARRELOJ = 'one.contrarreloj';
// Medidos en el DOM real (foto-pregunta a 390 px: el enunciado, en negrita de 20 px, tiene 328 px de ancho
// útil entre el relleno de la foto; el texto de un botón de respuesta, de 16 px, 332 px). Al ancho del
// enunciado se le resta ~8 % por el salto de palabra, que añade líneas: con 300 px, sobre el banco real
// y medido con el canvas, solo 1 de 218 enunciados sale con 4 líneas en lugar de 3.
export const TAMANO_ENUNCIADO = 20;
export const ANCHO_ENUNCIADO = 300;
export const TAMANO_OPCION = 16;
export const ANCHO_OPCION = 330;
const MAX_LINEAS_ENUNCIADO = 3;

/** V/F y test4 con enunciado de ≤ 3 líneas y opciones de 1 línea. `medir(texto, tamano)` es inyectable: por
 * defecto la estimación conservadora de `visuales.js` (nunca deja pasar una larga); la app inyecta una
 * medida real con el canvas y los tests una a medida. */
export function esCorta(pregunta, medir = medirAncho) {
  if (!pregunta || (pregunta.tipo !== 'vf' && pregunta.tipo !== 'test4')) return false;
  if (Math.ceil(medir(String(pregunta.enunciado ?? ''), TAMANO_ENUNCIADO) / ANCHO_ENUNCIADO) > MAX_LINEAS_ENUNCIADO) return false;
  if (pregunta.tipo === 'vf') return true;
  return Array.isArray(pregunta.opciones) && pregunta.opciones.every((op) => medir(String(op), TAMANO_OPCION) <= ANCHO_OPCION);
}

/** V/F o test4 de nivel 1-5 y corta (Contrarreloj sube de nivel por rampa; el suelo de 3 es solo de Órdago). */
export function esJugableContrarreloj(pregunta, medir = medirAncho) {
  return Boolean(pregunta) && Number.isInteger(pregunta.nivel) && pregunta.nivel >= 1 && pregunta.nivel <= 5
    && esCorta(pregunta, medir);
}

/** Nivel que toca en la posición `posicion` (1-10) de la serie: 1-2 → 1, 3-4 → 2, 5-6 → 3, 7-8 → 4, 9-10 → 5.
 * En el doble o nada, solo 4-5 (1-5 → 4, 6-10 → 5). */
export function nivelObjetivoContrarreloj(posicion, doble = false) {
  const p = Math.min(N_SERIE, Math.max(1, Math.floor(Number(posicion)) || 1));
  return doble ? (p <= N_SERIE / 2 ? 4 : 5) : Math.ceil(p / 2);
}

/** De `candidatas` (con `nivel`), las del nivel `objetivo`; si no hay ninguna, las del nivel más cercano. En empate
 * de distancia gana el inferior con `preferencia: 'inferior'` y el superior con `'superior'`. [] si no hay candidatas. */
export function elegirPorNivel(candidatas, objetivo, preferencia = 'inferior') {
  const niveles = [...new Set(candidatas.map((p) => p.nivel))];
  if (niveles.length === 0) return [];
  const mejor = niveles.reduce((a, b) => {
    const da = Math.abs(a - objetivo);
    const db = Math.abs(b - objetivo);
    if (da !== db) return da < db ? a : b;
    return (preferencia === 'superior') === (a > b) ? a : b;
  });
  return candidatas.filter((p) => p.nivel === mejor);
}

/** Candidatas de la posición `posicion` de la serie según la rampa: preferencia inferior en las preguntas 1-6 y
 * superior en las 7-10 y en el doble (spec v0.3.1 §6). */
export function candidatasDeRampa(candidatas, posicion, doble = false) {
  return elegirPorNivel(candidatas, nivelObjetivoContrarreloj(posicion, doble), doble || posicion >= 7 ? 'superior' : 'inferior');
}

/** Normal: 12 s → 6 s de la 1 a la 10. Doble: 6 s → 4 s. */
export function tiempoPreguntaMs(indice, fase) {
  return fase === 'doble'
    ? Math.round(6000 - (indice * 2000) / 9)
    : Math.round(12000 - (indice * 6000) / 9);
}

export function crearSerie() {
  return { fase: 'normal', indice: 0, viva: true, cofre: [], terminada: false };
}

/** Acierto: avanza. Fallo (o tiempo agotado = `correcta: false`): caes, salvo con salvavidas. */
export function responder(serie, { correcta, salvavidas = false }) {
  if (!serie.viva || serie.terminada) return serie;
  if (!correcta && !salvavidas) return { ...serie, viva: false };
  const indice = serie.indice + 1;
  return { ...serie, indice, terminada: indice >= N_SERIE };
}

export function abrirCofre(serie, rng = Math.random) {
  return { ...serie, cofre: [sortearObjeto(rng, 'normal')] };
}

export function aceptarDoble(serie) {
  return { fase: 'doble', indice: 0, viva: true, cofre: serie.cofre, terminada: false };
}

/** Objetos ganados: plantarse tras la normal se queda el cofre; doble superado, 2 con la tabla del doble. */
export function resultadoFinal(serie, rng = Math.random) {
  if (!serie.viva || !serie.terminada) return [];
  if (serie.fase === 'doble') return [sortearObjeto(rng, 'doble'), sortearObjeto(rng, 'doble')];
  return [...serie.cofre];
}

export function crearRecords() {
  return { version: 1, mejor: { fase: 'normal', aciertos: 0 }, doblesGanados: 0 };
}

const entero = (n, tope) => Number.isInteger(n) && n >= 0 && n <= tope;
const MAX_DOBLES = 999; // tope de producto: «Doble ×N» tiene que caber en la tarjeta del hub

export function normalizarRecords(obj) {
  const base = crearRecords();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return base;
  const mejor = obj.mejor && typeof obj.mejor === 'object' ? obj.mejor : {};
  return {
    version: 1,
    mejor: {
      fase: mejor.fase === 'doble' ? 'doble' : 'normal',
      aciertos: entero(mejor.aciertos, N_SERIE) ? mejor.aciertos : 0,
    },
    doblesGanados: entero(obj.doblesGanados, MAX_DOBLES) ? obj.doblesGanados : 0,
  };
}

/** Se llama al acabar una serie (caída o 10 aciertos). */
export function actualizarRecords(records, serie) {
  const actual = normalizarRecords(records);
  if (serie.fase === 'doble') {
    return serie.viva && serie.terminada
      ? { ...actual, mejor: { fase: 'doble', aciertos: N_SERIE }, doblesGanados: Math.min(MAX_DOBLES, actual.doblesGanados + 1) }
      : actual;
  }
  const aciertos = Math.min(N_SERIE, Math.max(0, serie.indice));
  return aciertos > actual.mejor.aciertos ? { ...actual, mejor: { fase: 'normal', aciertos } } : actual;
}

/** `'7/10'` o `'Doble ×2'`; cadena vacía si aún no hay marca. */
export function marcaTexto(records) {
  const r = normalizarRecords(records);
  if (r.doblesGanados > 0) return `Doble ×${r.doblesGanados}`;
  return r.mejor.aciertos > 0 ? `${r.mejor.aciertos}/${N_SERIE}` : '';
}

// Copia en memoria (spec §9): con el almacenamiento bloqueado los récords viven aquí hasta recargar.
let recordsEnMemoria = null;

export function cargarRecords(almacen) {
  if (recordsEnMemoria) return normalizarRecords(recordsEnMemoria); // la última escritura no llegó al almacén
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(CLAVE_CONTRARRELOJ);
    return crudo ? normalizarRecords(JSON.parse(crudo)) : crearRecords();
  } catch {
    return crearRecords();
  }
}

export function guardarRecords(records, almacen) {
  const normal = normalizarRecords(records);
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_CONTRARRELOJ, JSON.stringify(normal));
    recordsEnMemoria = null;
    return true;
  } catch {
    recordsEnMemoria = normal;
    return false;
  }
}
