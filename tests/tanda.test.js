// Tests del estado puro de la tanda en curso (Tarea 1 del plan v0.2b4-generacion-clara).
// Sin DOM y sin red: `calcularRestanteSeg`/`formatearRestante` son funciones puras, y la
// persistencia usa un localStorage falso (mismo patrón que tests/sincronizacion.test.js).
// Spec: docs/superpowers/specs/2026-09-15-one-v0.2b4-generacion-clara-design.md §1 y §2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVE_TANDA,
  SEG_POR_PREGUNTA_DEFECTO,
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
