// Tests de respaldo.js (spec v0.3 §9): exportar v3 con modos; importar v3 y el antiguo v1/v2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtroDeModo } from '../filtro.js';
import { exportarRespaldo, importarRespaldo, aplicarModos, VERSION_RESPALDO, CLAVES_RESPALDO } from '../respaldo.js';
import { crearEstado, exportar } from '../motor.js';
import { CLAVE_MOCHILA, cargarMochila, guardarMochila, comprarTitulo, equiparTitulo, anadirObjeto, crearMochila } from '../mochila.js';
import { CLAVE_SILENCIO } from '../sonido.js';
import { CLAVE_ORDAGO, cargarOrdago, crearOrdago } from '../ordago.js';
import { CLAVE_CONTRARRELOJ, cargarRecords, crearRecords } from '../contrarreloj.js';
import { CLAVE_MASOMENOS, cargarMasomenos, crearEstadoMasomenos, olvidarMemoria } from '../masomenos.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

const HOY = '2026-10-05';

test('CLAVES_RESPALDO: las claves de v0.3 de estas fases', () => {
  assert.deepEqual([...CLAVES_RESPALDO], ['one.mochila', 'one.filtros', 'one.silencio', 'one.indiceRutas', 'one.ordago', 'one.contrarreloj', 'one.imagenesMalas', 'one.masomenos', 'one.premium']);
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
  const json = exportarRespaldo(estado, almacenFalso({ 'one.silencio': '1' }));
  const { estado: importado, modos } = importarRespaldo(json);
  assert.equal(importado.xp, 77);
  assert.deepEqual(modos, { 'one.silencio': '1' });
});

test('importar un respaldo v3 viejo con one.ultimoModo no lanza y la ignora', () => {
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.ultimoModo': 'repaso', 'one.silencio': '1' } });
  const r = importarRespaldo(json);
  assert.ok(r);
  assert.deepEqual(r.modos, { 'one.silencio': '1' });
  const almacen = almacenFalso();
  aplicarModos(r.modos, almacen);
  assert.equal(almacen.getItem('one.ultimoModo'), null);
  assert.equal(almacen.getItem('one.silencio'), '1');
  // Aunque alguien llame a aplicarModos con la clave vieja, no se escribe.
  aplicarModos({ 'one.ultimoModo': 'repaso' }, almacen);
  assert.equal(almacen.getItem('one.ultimoModo'), null);
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

test('Review Focus 4: one.ordago viaja en el respaldo y, con números absurdos, se normaliza sin lanzar', () => {
  assert.ok(CLAVES_RESPALDO.includes(CLAVE_ORDAGO));
  const bueno = JSON.stringify({ version: 1, fondo: 2500, curva: [1000, 2500], maximo: 2500, quiebras: 1, racha: 2 });
  const ida = importarRespaldo(exportarRespaldo(crearEstado(HOY), almacenFalso({ 'one.ordago': bueno })));
  assert.deepEqual(ida.modos, { 'one.ordago': bueno });
  const absurdo = JSON.stringify({ fondo: -9, maximo: 'x', curva: 'no', quiebras: 1.5, racha: 1e99 });
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.ordago': absurdo } });
  const almacen = almacenFalso();
  aplicarModos(importarRespaldo(json).modos, almacen);
  assert.deepEqual(cargarOrdago(almacen), crearOrdago());
});

test('Review Focus 4: one.contrarreloj viaja en el respaldo y, con números absurdos, se normaliza sin lanzar', () => {
  assert.ok(CLAVES_RESPALDO.includes(CLAVE_CONTRARRELOJ));
  const bueno = JSON.stringify({ version: 1, mejor: { fase: 'normal', aciertos: 8 }, doblesGanados: 1 });
  const ida = importarRespaldo(exportarRespaldo(crearEstado(HOY), almacenFalso({ 'one.contrarreloj': bueno })));
  assert.deepEqual(ida.modos, { 'one.contrarreloj': bueno });
  const absurdo = JSON.stringify({ mejor: { fase: 1, aciertos: 1e99 }, doblesGanados: 'x' });
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.contrarreloj': absurdo } });
  const almacen = almacenFalso();
  aplicarModos(importarRespaldo(json).modos, almacen);
  assert.deepEqual(cargarRecords(almacen), crearRecords());
});

test('Review Focus 4: un respaldo v3 con one.filtros que trae apuesta importa sin lanzar y el filtro sale como ordago', () => {
  const filtros = JSON.stringify({ apuesta: { area: 'historia', ruta: [], etiquetas: [] } });
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.filtros': filtros } });
  const r = importarRespaldo(json);
  assert.ok(r);
  const almacen = almacenFalso();
  aplicarModos(r.modos, almacen);
  assert.equal(filtroDeModo('ordago', almacen).area, 'historia');
  assert.ok(!('apuesta' in JSON.parse(almacen.getItem('one.filtros'))));
});

test('Review Focus 4: one.masomenos viaja en el respaldo y, con números absurdos, se normaliza sin lanzar', () => {
  assert.ok(CLAVES_RESPALDO.includes(CLAVE_MASOMENOS));
  const bueno = JSON.stringify({ version: 1, variante: 'afinar', comparar: { racha: 2, record: 9 }, afinar: { racha: 0, record: 4 } });
  const ida = importarRespaldo(exportarRespaldo(crearEstado(HOY), almacenFalso({ 'one.masomenos': bueno })));
  assert.deepEqual(ida.modos, { 'one.masomenos': bueno });
  const absurdo = JSON.stringify({ variante: 'x', comparar: { racha: 1e99, record: -3 }, afinar: 'no' });
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.masomenos': absurdo } });
  const almacen = almacenFalso();
  aplicarModos(importarRespaldo(json).modos, almacen);
  olvidarMemoria();
  assert.deepEqual(cargarMasomenos(almacen), crearEstadoMasomenos());
});

test('plan v0.3.3: la mochila v2 (objetos nuevos, títulos y el equipado) entra y sale de Exportar/Importar', () => {
  let m = anadirObjeto(anadirObjeto(crearMochila(), 'escudo', 2), 'segunda', 3);
  m = equiparTitulo(comprarTitulo(m, 1000, 'erudito').mochila, 'erudito').mochila;
  const origen = almacenFalso();
  guardarMochila(m, origen);
  const { modos } = importarRespaldo(exportarRespaldo(crearEstado(HOY), origen));
  const destino = almacenFalso();
  aplicarModos(modos, destino);
  assert.deepEqual(cargarMochila(destino), m);
  assert.deepEqual([cargarMochila(destino).objetos.escudo, cargarMochila(destino).titulo, cargarMochila(destino).titulos], [2, 'erudito', ['erudito']]);
});

test('plan v0.3.3: un respaldo con la mochila v1 se lee bien (los objetos nuevos empiezan en 0, sin títulos)', () => {
  const v1 = JSON.stringify({ version: 1, objetos: { cincuenta: 2, salvavidas: 1, mas5: 4 } });
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.mochila': v1 } });
  const destino = almacenFalso();
  aplicarModos(importarRespaldo(json).modos, destino);
  assert.deepEqual(cargarMochila(destino), {
    version: 2, objetos: { cincuenta: 2, salvavidas: 1, mas5: 4, saltar: 0, segunda: 0, escudo: 0 }, titulos: [], titulo: null,
  });
});

test('plan v0.3.3: una mochila v2 con basura (escudos de más, título sin comprar) se normaliza al importar', () => {
  const sucia = JSON.stringify({ version: 2, objetos: { escudo: 50, saltar: -3 }, titulos: ['rey', 'curioso'], titulo: 'leyenda' });
  const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(crearEstado(HOY))), modos: { 'one.mochila': sucia } });
  const destino = almacenFalso();
  aplicarModos(importarRespaldo(json).modos, destino);
  const m = cargarMochila(destino);
  assert.deepEqual([m.objetos.escudo, m.objetos.saltar, m.titulos, m.titulo], [2, 0, ['curioso'], null]);
});
