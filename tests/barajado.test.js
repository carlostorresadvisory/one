// Barajado del orden de las opciones de un test4 (Clásico, Repaso y Órdago): el orden mostrado cambia,
// pero cada botón conserva su índice original para evaluar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barajarOrden } from '../motor.js';

test('barajarOrden: es una permutación de 0..n-1', () => {
  for (let k = 0; k < 50; k += 1) {
    const orden = barajarOrden(4);
    assert.deepEqual([...orden].sort(), [0, 1, 2, 3]);
  }
});

test('barajarOrden: con rng fijo es determinista y no deja siempre la correcta en primer lugar', () => {
  assert.deepEqual(barajarOrden(4, () => 0), [1, 2, 3, 0]);
  const primeras = new Set();
  for (let k = 0; k < 200; k += 1) primeras.add(barajarOrden(4)[0]);
  assert.equal(primeras.size, 4);
});
