// Tests de visuales.js (cliente): construirVisual dibuja SVG en el navegador (necesita DOM, se
// prueba en tests/e2e.spec.js); esVisualValido es pura -- sin dependencias, sin DOM -- así que se
// prueba entera aquí con node:test. Mismo esquema que tools/visualizar.js#validarVisual
// (v0.2b4.1 §5, I2, ronda de corrección 1): duplicado a propósito porque sincronizacion.js no puede
// importar tools/visualizar.js (dependencias de Node, fs/promises incluido) desde un módulo que
// también corre en el navegador. Ver sincronizacion.js#aplicarActualizaciones para el uso real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { esVisualValido } from '../visuales.js';
import { validarVisual } from '../tools/visualizar.js';

test('esVisualValido: acepta un visual de cada tipo con forma correcta', () => {
  assert.equal(esVisualValido({ tipo: 'formula', texto: 'a = b', leyenda: 'Leyenda' }), true);
  assert.equal(
    esVisualValido({
      tipo: 'linea-tiempo',
      leyenda: 'L',
      hitos: [
        { ano: '2020', texto: 'Uno' },
        { ano: '2021', texto: 'Dos' },
        { ano: '2022', texto: 'Tres' },
      ],
    }),
    true
  );
  assert.equal(
    esVisualValido({
      tipo: 'barras',
      leyenda: 'L',
      items: [
        { etiqueta: 'A', valor: 1 },
        { etiqueta: 'B', valor: 2 },
      ],
      fuente: 'INE 2024',
    }),
    true
  );
  assert.equal(
    esVisualValido({
      tipo: 'comparacion',
      leyenda: 'L',
      columnas: [
        { titulo: 'A', puntos: ['uno', 'dos'] },
        { titulo: 'B', puntos: ['tres', 'cuatro'] },
      ],
    }),
    true
  );
  assert.equal(esVisualValido({ tipo: 'flujo', leyenda: 'L', pasos: ['Uno', 'Dos'] }), true);
  assert.equal(esVisualValido({ tipo: 'dato', leyenda: 'L', cifra: '42%', texto: 'Texto', fuente: 'INE 2024' }), true);
});

test('esVisualValido: rechaza sin objeto, tipo desconocido, array, o sin leyenda -- nunca lanza', () => {
  assert.equal(esVisualValido(null), false);
  assert.equal(esVisualValido(undefined), false);
  assert.equal(esVisualValido('texto'), false);
  assert.equal(esVisualValido([]), false);
  assert.equal(esVisualValido({ tipo: 'inventado', leyenda: 'L' }), false);
  assert.equal(esVisualValido({ tipo: 'formula', texto: 'a = b' }), false, 'sin leyenda');
});

test('esVisualValido: formula rechaza LaTeX crudo ("\\" o "$")', () => {
  assert.equal(esVisualValido({ tipo: 'formula', texto: '\\frac{a}{b}', leyenda: 'L' }), false);
  assert.equal(esVisualValido({ tipo: 'formula', texto: '$a=b$', leyenda: 'L' }), false);
});

test('esVisualValido: barras/dato exigen fuente con año e institución, rechaza frases genéricas', () => {
  assert.equal(esVisualValido({ tipo: 'dato', leyenda: 'L', cifra: '1', texto: 'T', fuente: 'Concepto estándar' }), false);
  assert.equal(esVisualValido({ tipo: 'dato', leyenda: 'L', cifra: '1', texto: 'T', fuente: 'sin año aquí' }), false);
  assert.equal(esVisualValido({ tipo: 'dato', leyenda: 'L', cifra: '1', texto: 'T' }), false, 'fuente obligatoria');
});

test('esVisualValido: linea-tiempo rechaza años repetidos', () => {
  assert.equal(
    esVisualValido({
      tipo: 'linea-tiempo',
      leyenda: 'L',
      hitos: [
        { ano: '2020', texto: 'Uno' },
        { ano: '2020', texto: 'Dos' },
        { ano: '2021', texto: 'Tres' },
      ],
    }),
    false
  );
});

test('esVisualValido: barras rechaza valor <= 0', () => {
  assert.equal(
    esVisualValido({
      tipo: 'barras',
      leyenda: 'L',
      items: [
        { etiqueta: 'A', valor: 0 },
        { etiqueta: 'B', valor: 2 },
      ],
      fuente: 'INE 2024',
    }),
    false
  );
});

// v0.2b4.1 §5 (I2, ronda de corrección 1): esVisualValido es un duplicado A PROPÓSITO del esquema
// de validarVisual. Este test es la red de seguridad real: si el esquema cambia en un sitio y se
// olvida el otro, falla aquí, contra los 98 visuales reales de datos/banco.json, no solo contra
// fixtures escritos a mano que podrían compartir el mismo error de comprensión del esquema.
test('esVisualValido coincide al 100% con validarVisual sobre los visuales reales de datos/banco.json', async () => {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const conVisual = banco.filter((p) => p.visual);
  assert.ok(conVisual.length > 50, 'el banco debería traer bastantes visuales reales para que este test signifique algo');
  const discrepancias = [];
  for (const p of conVisual) {
    const propio = esVisualValido(p.visual);
    const oficial = validarVisual(p.visual).ok;
    if (propio !== oficial) discrepancias.push({ id: p.id, propio, oficial, errores: validarVisual(p.visual).errores });
  }
  assert.deepEqual(discrepancias, [], `esVisualValido y validarVisual discrepan en: ${JSON.stringify(discrepancias, null, 2)}`);
});
