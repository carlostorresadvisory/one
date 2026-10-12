// Tests de visuales.js (cliente): construirVisual dibuja SVG en el navegador (necesita DOM, se
// prueba en tests/e2e.spec.js); esVisualImprescindible y esVisualDeRespaldo son puras y se prueban aquí con node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esVisualImprescindible, esVisualDeRespaldo } from '../visuales.js';

test('esVisualImprescindible: solo la fórmula de matemáticas o ciencia', () => {
  const v = (tipo) => ({ tipo, leyenda: 'L', texto: 'a = b' });
  assert.equal(esVisualImprescindible({ area: 'matematicas', visual: v('formula') }), true);
  assert.equal(esVisualImprescindible({ area: 'ciencia', visual: v('formula') }), true);
  assert.equal(esVisualImprescindible({ area: 'historia', visual: v('formula') }), false);
  for (const tipo of ['linea-tiempo', 'barras', 'comparacion', 'flujo', 'dato']) {
    assert.equal(esVisualImprescindible({ area: 'ciencia', visual: v(tipo) }), false, tipo);
  }
  assert.equal(esVisualImprescindible({ area: 'ciencia' }), false);
  assert.equal(esVisualImprescindible(null), false);
});

test('esVisualDeRespaldo (v0.3.5): lo imprescindible y, en una pregunta del servidor, cualquier visual', () => {
  const ev = { tipo: 'formula', texto: 'EV = Cap. Bursátil + Deuda Neta', leyenda: 'Suma deuda y resta caja a la capitalización' };
  assert.equal(esVisualDeRespaldo({ id: 'srv-eco-1', area: 'economia', visual: ev }), true, 'la pregunta de Enterprise Value');
  assert.equal(esVisualDeRespaldo({ id: 'srv-his-1', area: 'historia', visual: { tipo: 'linea-tiempo' } }), true);
  assert.equal(esVisualDeRespaldo({ id: 'eco-001', area: 'economia', visual: ev }), false, 'una del banco sigue con el color del área');
  assert.equal(esVisualDeRespaldo({ id: 'mat-001', area: 'matematicas', visual: ev }), true, 'lo imprescindible no cambia');
  assert.equal(esVisualDeRespaldo({ id: 'srv-eco-2', area: 'economia' }), false, 'sin visual no hay nada que dibujar');
  assert.equal(esVisualDeRespaldo({ id: 'srv-eco-3', area: 'economia', visual: null }), false);
  assert.equal(esVisualDeRespaldo(null), false);
});
