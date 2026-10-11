// Tests de visuales.js (cliente): construirVisual dibuja SVG en el navegador (necesita DOM, se
// prueba en tests/e2e.spec.js); esVisualImprescindible es pura y se prueba aquí con node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esVisualImprescindible } from '../visuales.js';

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
