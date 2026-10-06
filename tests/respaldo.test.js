// Tests de respaldo.js (spec v0.3 §9): exportar v3 con modos; importar v3 y el antiguo v1/v2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportarRespaldo, importarRespaldo, aplicarModos, VERSION_RESPALDO, CLAVES_RESPALDO } from '../respaldo.js';
import { crearEstado, exportar } from '../motor.js';
import { CLAVE_MOCHILA } from '../mochila.js';
import { CLAVE_SILENCIO } from '../sonido.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

const HOY = '2026-10-05';

test('CLAVES_RESPALDO: las claves de v0.3 de estas fases', () => {
  assert.deepEqual([...CLAVES_RESPALDO], ['one.mochila', 'one.ultimoModo', 'one.filtros', 'one.silencio', 'one.indiceRutas']);
});

test('CLAVES_RESPALDO incluye las claves que usan mochila.js y sonido.js (test cruzado)', () => {
  assert.ok(CLAVES_RESPALDO.includes(CLAVE_MOCHILA));
  assert.ok(CLAVES_RESPALDO.includes(CLAVE_SILENCIO));
});

test('exportarRespaldo: versión 3, estado v2 dentro y solo las claves de la lista blanca', () => {
  const almacen = almacenFalso({ 'one.mochila': '{"version":1,"objetos":{"mas5":1}}', 'one.silencio': '1', 'one.estado': 'NO', otra: 'x' });
  const obj = JSON.parse(exportarRespaldo(crearEstado(HOY), almacen));
  assert.equal(obj.version, VERSION_RESPALDO);
  assert.equal(obj.estado.version, 2);
  assert.deepEqual(Object.keys(obj.modos).sort(), ['one.mochila', 'one.silencio']);
});

test('exportarRespaldo con almacén roto exporta el estado sin modos', () => {
  const obj = JSON.parse(exportarRespaldo(crearEstado(HOY), almacenRoto()));
  assert.deepEqual(obj.modos, {});
});

test('ida y vuelta v3: mismo estado y mismos modos', () => {
  const estado = crearEstado(HOY);
  estado.xp = 77;
  const json = exportarRespaldo(estado, almacenFalso({ 'one.ultimoModo': 'repaso' }));
  const { estado: importado, modos } = importarRespaldo(json);
  assert.equal(importado.xp, 77);
  assert.deepEqual(modos, { 'one.ultimoModo': 'repaso' });
});

test('Review Focus 5: un respaldo v2 antiguo (motor.exportar) se importa sin modos', () => {
  const estado = crearEstado(HOY);
  estado.racha = { dias: 7, ultimaFecha: HOY };
  const { estado: importado, modos } = importarRespaldo(exportar(estado));
  assert.equal(importado.racha.dias, 7);
  assert.deepEqual(modos, {});
});

test('Review Focus 5: v3 con basura en modos -- se ignoran claves ajenas y valores no texto', () => {
  const json = JSON.stringify({
    version: 3,
    estado: JSON.parse(exportar(crearEstado(HOY))),
    modos: { 'one.mochila': 42, 'one.estado': '{}', 'one.silencio': '1', __proto__x: 'y' },
  });
  assert.deepEqual(importarRespaldo(json).modos, { 'one.silencio': '1' });
  const sinModos = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: 'nada' });
  assert.deepEqual(importarRespaldo(sinModos).modos, {});
});

test('importarRespaldo lanza con JSON roto, v3 sin estado o versión desconocida', () => {
  assert.throws(() => importarRespaldo('{roto'), /JSON inválido/);
  assert.throws(() => importarRespaldo('{"version":3}'), /estado/);
  assert.throws(() => importarRespaldo('{"version":9}'), /Versión/);
});

test('aplicarModos escribe solo claves de la lista blanca y aguanta un almacén roto', () => {
  const almacen = almacenFalso();
  assert.equal(aplicarModos({ 'one.silencio': '1', 'one.estado': 'x', 'one.mochila': 5 }, almacen), 1);
  assert.equal(almacen.getItem('one.silencio'), '1');
  assert.equal(almacen.getItem('one.estado'), null);
  assert.equal(aplicarModos({ 'one.silencio': '1' }, almacenRoto()), 0);
});

test('localStorage bloqueado (getter que lanza): exportar y aplicar no lanzan', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(JSON.parse(exportarRespaldo(crearEstado(HOY))).modos, {});
    assert.equal(aplicarModos({ 'one.silencio': '1' }), 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
