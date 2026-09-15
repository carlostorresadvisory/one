// Tests del estado puro de la tanda en curso (Tarea 1 del plan v0.2b4-generacion-clara).
// Sin DOM y sin red: `calcularRestanteSeg`/`formatearRestante` son funciones puras, y la
// persistencia usa un localStorage falso (mismo patrón que tests/sincronizacion.test.js).
// Spec: docs/superpowers/specs/2026-09-15-one-v0.2b4-generacion-clara-design.md §1 y §2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVE_TANDA,
  SEG_POR_PREGUNTA_DEFECTO,
  leerTanda,
  guardarTanda,
  borrarTanda,
  calcularRestanteSeg,
  formatearRestante,
} from '../tanda.js';

// === calcularRestanteSeg ==========================================================================

test('calcularRestanteSeg: con >= 1 hecha usa el ritmo REAL medido, no la estimación del servidor', () => {
  // 40 s para 4 preguntas = 10 s/pregunta; faltan 6 => 60 s. `segundosPorPregunta` se ignora.
  const seg = calcularRestanteSeg({ inicio: 0, ahora: 40000, hechas: 4, pedidas: 10, segundosPorPregunta: 99 });
  assert.equal(seg, 60);
});

test('calcularRestanteSeg: con 0 hechas usa la estimación del servidor por pregunta', () => {
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 5000, hechas: 0, pedidas: 10, segundosPorPregunta: 4 }), 40);
});

test('calcularRestanteSeg: sin estimación del servidor cae al defecto de 20 s/pregunta', () => {
  const seg = calcularRestanteSeg({ inicio: 0, ahora: 0, hechas: 0, pedidas: 5 });
  assert.equal(seg, SEG_POR_PREGUNTA_DEFECTO * 5);
});

test('calcularRestanteSeg: tanda completa devuelve 0', () => {
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 90000, hechas: 10, pedidas: 10 }), 0);
});

test('calcularRestanteSeg: datos inservibles devuelven null en vez de NaN', () => {
  assert.equal(calcularRestanteSeg({ inicio: undefined, ahora: 1000, hechas: 1, pedidas: 10 }), null);
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 1000, hechas: 1, pedidas: 0 }), null);
  assert.equal(calcularRestanteSeg({}), null);
});

test('calcularRestanteSeg: `hechas` mayor que `pedidas` no produce un restante negativo', () => {
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 10000, hechas: 12, pedidas: 10 }), 0);
});

// === formatearRestante ============================================================================

test('formatearRestante: por debajo del minuto redondea a decenas de segundos', () => {
  assert.equal(formatearRestante(38), '~40 s');
  assert.equal(formatearRestante(4), '~10 s');   // nunca "~0 s"
  assert.equal(formatearRestante(57), '~50 s');  // nunca "~60 s": eso ya es un minuto
});

test('formatearRestante: a partir de 60 s redondea a minutos', () => {
  assert.equal(formatearRestante(60), '~1 min');
  assert.equal(formatearRestante(115), '~2 min');
});

test('formatearRestante: sin nada que decir devuelve cadena vacía', () => {
  assert.equal(formatearRestante(0), '');
  assert.equal(formatearRestante(null), '');
  assert.equal(formatearRestante(NaN), '');
});

// === persistencia en localStorage (clave one.atomoTrabajo) ========================================

function prepararLocalStorage() {
  const mapa = new Map();
  globalThis.localStorage = {
    getItem: (clave) => (mapa.has(clave) ? mapa.get(clave) : null),
    setItem: (clave, valor) => mapa.set(clave, String(valor)),
    removeItem: (clave) => mapa.delete(clave),
    clear: () => mapa.clear(),
  };
  return mapa;
}

const TANDA = { id: 't-abc-1', corto: 'Mercados y crisis', inicio: 1789000000000, pedidas: 10 };

test('guardarTanda + leerTanda: la tanda sobrevive a una recarga (el caso real de iOS)', () => {
  prepararLocalStorage();
  assert.equal(guardarTanda(TANDA), true);
  assert.deepEqual(leerTanda(), TANDA);
});

test('leerTanda: sin nada guardado devuelve null', () => {
  prepararLocalStorage();
  assert.equal(leerTanda(), null);
});

test('borrarTanda: deja la clave vacía (estado terminal o 404, spec §1)', () => {
  prepararLocalStorage();
  guardarTanda(TANDA);
  borrarTanda();
  assert.equal(leerTanda(), null);
});

test('leerTanda: una clave corrupta o incompleta se trata como "no hay tanda", nunca lanza', () => {
  const mapa = prepararLocalStorage();
  mapa.set(CLAVE_TANDA, '{no es json');
  assert.equal(leerTanda(), null);
  mapa.set(CLAVE_TANDA, JSON.stringify({ id: 't-1' })); // sin corto/inicio/pedidas
  assert.equal(leerTanda(), null);
  mapa.set(CLAVE_TANDA, JSON.stringify({ ...TANDA, pedidas: 0 }));
  assert.equal(leerTanda(), null);
});

test('guardarTanda: rechaza datos inservibles sin escribir nada', () => {
  prepararLocalStorage();
  assert.equal(guardarTanda({ id: '', corto: 'x', inicio: 1, pedidas: 10 }), false);
  assert.equal(guardarTanda({ id: 't-1', corto: 'x', inicio: 'ayer', pedidas: 10 }), false);
  assert.equal(leerTanda(), null);
});

test('guardarTanda: con localStorage lleno devuelve false y no lanza (la sesión sigue en memoria)', () => {
  prepararLocalStorage();
  globalThis.localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.equal(guardarTanda(TANDA), false);
});
