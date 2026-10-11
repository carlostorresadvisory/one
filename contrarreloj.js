// ONE · contrarreloj.js — reglas puras de Contrarreloj (spec v0.3 §5.4): preguntas cortas de nivel 3-5,
// tiempo lineal por pregunta, caída, cofre, «doble o nada» y récords. Sin DOM. La serie NO se persiste
// (spec §11): si iOS mata la app a mitad, se pierde sin contar como caída; solo los récords se guardan.

import { medirAncho } from './visuales.js';
import { sortearObjeto } from './mochila.js';
import { esJugableDificil } from './modos.js';

export const N_SERIE = 10;
export const CLAVE_CONTRARRELOJ = 'one.contrarreloj';
// Medidos en el DOM real (foto-pregunta a 390 px de ancho): el enunciado va sobre la foto con su relleno
// lateral; criterio de la spec §8: enunciado de ≤ 3 líneas y opciones de 1 línea.
export const TAMANO_ENUNCIADO = 20;
export const ANCHO_ENUNCIADO = 342;
export const TAMANO_OPCION = 17;
export const ANCHO_OPCION = 300;
const MAX_LINEAS_ENUNCIADO = 3;

/** V/F y test4 con enunciado de ≤ 3 líneas y opciones de 1 línea (`medir` inyectable para los tests). */
export function esCorta(pregunta, medir = medirAncho) {
  if (!pregunta || (pregunta.tipo !== 'vf' && pregunta.tipo !== 'test4')) return false;
  if (Math.ceil(medir(String(pregunta.enunciado ?? ''), TAMANO_ENUNCIADO) / ANCHO_ENUNCIADO) > MAX_LINEAS_ENUNCIADO) return false;
  if (pregunta.tipo === 'vf') return true;
  return Array.isArray(pregunta.opciones) && pregunta.opciones.every((op) => medir(String(op), TAMANO_OPCION) <= ANCHO_OPCION);
}

/** Nivel 3-5 (como Órdago) y corta. */
export function esJugableContrarreloj(pregunta, medir = medirAncho) {
  return esJugableDificil(pregunta) && esCorta(pregunta, medir);
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
    doblesGanados: entero(obj.doblesGanados, 1e6) ? obj.doblesGanados : 0,
  };
}

/** Se llama al acabar una serie (caída o 10 aciertos). */
export function actualizarRecords(records, serie) {
  const actual = normalizarRecords(records);
  if (serie.fase === 'doble') {
    return serie.viva && serie.terminada
      ? { ...actual, mejor: { fase: 'doble', aciertos: N_SERIE }, doblesGanados: actual.doblesGanados + 1 }
      : actual;
  }
  const aciertos = Math.min(N_SERIE, Math.max(0, serie.indice));
  return aciertos > actual.mejor.aciertos ? { ...actual, mejor: { fase: 'normal', aciertos } } : actual;
}

/** `'7/10'` o `'Doble ×2'`. */
export function marcaTexto(records) {
  const r = normalizarRecords(records);
  return r.doblesGanados > 0 ? `Doble ×${r.doblesGanados}` : `${r.mejor.aciertos}/${N_SERIE}`;
}

export function cargarRecords(almacen) {
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(CLAVE_CONTRARRELOJ);
    return crudo ? normalizarRecords(JSON.parse(crudo)) : crearRecords();
  } catch {
    return crearRecords();
  }
}

export function guardarRecords(records, almacen) {
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_CONTRARRELOJ, JSON.stringify(normalizarRecords(records)));
    return true;
  } catch {
    return false;
  }
}
