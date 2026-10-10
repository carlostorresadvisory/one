// Tests de modos.js: registro del hub v0.3 (spec §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODOS, modoPorId, marcadorModo } from '../modos.js';

test('MODOS: los cinco modos en el orden de la rejilla; solo Clásico y Repaso disponibles', () => {
  assert.deepEqual(MODOS.map((m) => m.id), ['clasico', 'repaso', 'ordago', 'masomenos', 'contrarreloj']);
  assert.deepEqual(MODOS.filter((m) => m.disponible).map((m) => m.id), ['clasico', 'repaso']);
});

test('Más o menos filtra solo hasta el área; el resto, árbol completo', () => {
  assert.equal(modoPorId('masomenos').nivelFiltro, 'area');
  assert.equal(modoPorId('clasico').nivelFiltro, 'arbol');
});

test('cada imagen es de Commons y lleva autor, licencia y página', () => {
  for (const { imagen } of MODOS) {
    assert.match(imagen.url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//);
    assert.match(imagen.pagina, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(imagen.autor && imagen.licencia && imagen.titulo);
  }
});

test('ya no existe el último modo jugado', async () => {
  const modos = await import('../modos.js');
  for (const nombre of ['cargarUltimoModo', 'guardarUltimoModo', 'CLAVE_ULTIMO_MODO']) assert.equal(nombre in modos, false);
});

test('marcadorModo: Hoy a/r, por repasar / Al día, Pronto', () => {
  const datos = { aciertosHoy: 4, respondidasHoy: 10, porRepasar: 15 };
  assert.equal(marcadorModo('clasico', datos), 'Hoy 4/10');
  assert.equal(marcadorModo('repaso', datos), '15 por repasar');
  assert.equal(marcadorModo('repaso', { ...datos, porRepasar: 0 }), 'Al día');
  for (const id of ['ordago', 'masomenos', 'contrarreloj']) assert.equal(marcadorModo(id, datos), 'Pronto');
});

test('modos no disponibles marcan «Pronto»', () => {
  assert.equal(marcadorModo('contrarreloj', {}), 'Pronto');
});

test('el modo se llama Órdago con id ordago', () => {
  assert.equal(modoPorId('ordago').nombre, 'Órdago');
  assert.equal(modoPorId('apuesta'), null);
});
