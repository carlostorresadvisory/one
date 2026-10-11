// Lógica de decisión del lote de mejora del banco (tools/mejorar-imagenes.js). Sin red ni disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirRama } from '../tools/mejorar-imagenes.js';

const buena = { nota: 5 };
const mediocre = { nota: 3 };

test('(a) imagen con nota >= 4 y no marcada mala -> mantener', () => {
  assert.equal(decidirRama({ actual: buena, marcadaMala: false }), 'mantener');
  assert.equal(decidirRama({ actual: { nota: 4 }, marcadaMala: false }), 'mantener');
});

test('marcada mala se sustituye aunque tuviera 4-5', () => {
  assert.equal(decidirRama({ actual: buena, marcadaMala: true }), 'buscar-commons');
});

test('(b) Commons: se busca primero y, si hay candidata buena, gana', () => {
  assert.equal(decidirRama({ actual: mediocre }), 'buscar-commons');
  assert.equal(decidirRama({ actual: mediocre, candidatasCommons: [{ nota: 4 }], candidatasBancos: [{ nota: 5 }] }), 'commons');
});

test('(c) sin buena en Commons -> bancos libres', () => {
  assert.equal(decidirRama({ actual: null, candidatasCommons: [] }), 'buscar-bancos');
  assert.equal(decidirRama({ actual: null, candidatasCommons: [], candidatasBancos: [{ nota: 4 }] }), 'bancos');
});

test('(d) nada en bancos -> IA si queda cupo; (e) sin cupo -> sin imagen', () => {
  assert.equal(decidirRama({ actual: mediocre, candidatasCommons: [], candidatasBancos: [], cupoLibre: true }), 'ia');
  assert.equal(decidirRama({ actual: mediocre, candidatasCommons: [], candidatasBancos: [], cupoLibre: false }), 'sin-imagen');
});

test('una imagen sin nota todavía no se mantiene', () => {
  assert.equal(decidirRama({ actual: {}, marcadaMala: false }), 'buscar-commons');
});
