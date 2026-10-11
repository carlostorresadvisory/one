// Tests de premium.js (spec v0.3.1 §7): activar (puntos una sola vez), recarga mensual, cupo diario y persistencia.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../premium.js';
import { cargarOrdago, olvidarMemoria } from '../ordago.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

beforeEach(() => { olvidarMemoria(); P.olvidarMemoriaPremium(); });

test('un respaldo sin la clave o con basura se lee como plan gratis', () => {
  assert.deepEqual(P.cargarPremium(almacenFalso()), { activo: false, desde: null, ultimaRecarga: null, bonificado: false });
  assert.deepEqual(P.cargarPremium(almacenFalso({ 'one.premium': 'no es json' })), P.crearPremium());
  assert.deepEqual(P.normalizarPremium({ activo: 'si', desde: 'ayer', ultimaRecarga: '2026-1', bonificado: 1 }), P.crearPremium());
  assert.deepEqual(P.cargarPremium(almacenRoto()), P.crearPremium());
});

test('activar: estado, 1.000 de bienvenida y el mes de activación ya cuenta como recargado', () => {
  const { estado, puntos } = P.activar(P.crearPremium(), '2026-10-11');
  assert.equal(puntos, 1000);
  assert.deepEqual(estado, { activo: true, desde: '2026-10-11', ultimaRecarga: '2026-10', bonificado: true });
  assert.equal(P.recargaMensual(estado, '2026-10-31').puntos, 0);
});

test('activarYGuardar: suma 1.000 al fondo de Órdago; doble toque, desactivar y reactivar no suman más', () => {
  const almacen = almacenFalso();
  assert.deepEqual(P.activarYGuardar('2026-10-11', almacen), { ok: true, puntos: 1000 });
  assert.equal(cargarOrdago(almacen).fondo, 2000);
  assert.deepEqual(P.activarYGuardar('2026-10-11', almacen), { ok: true, puntos: 0 }); // doble toque
  assert.equal(cargarOrdago(almacen).fondo, 2000);
  P.desactivarYGuardar(almacen);
  const apagado = P.cargarPremium(almacen);
  assert.equal(apagado.activo, false);
  assert.equal(apagado.bonificado, true, 'bonificado no vuelve a false');
  assert.deepEqual(P.activarYGuardar('2026-10-12', almacen), { ok: true, puntos: 0 });
  assert.equal(P.cargarPremium(almacen).activo, true);
  assert.equal(cargarOrdago(almacen).fondo, 2000);
});

test('activarYGuardar: si una escritura falla se deshacen las dos (ni plan ni puntos)', () => {
  const base = almacenFalso();
  const fallaOrdago = { ...base, setItem: (k, v) => { if (k === 'one.ordago') throw new Error('lleno'); base.setItem(k, v); } };
  const r = P.activarYGuardar('2026-10-11', fallaOrdago);
  assert.equal(r.ok, false);
  assert.equal(P.cargarPremium(base).activo, false);
  assert.equal(P.cargarPremium(base).bonificado, false);
});

test('recarga mensual: una por mes, cambio de año, sin acumular meses saltados, nada si el reloj va atrás', () => {
  const act = { activo: true, desde: '2026-10-11', ultimaRecarga: '2026-10', bonificado: true };
  assert.equal(P.recargaMensual(act, '2026-10-30').puntos, 0);
  const nov = P.recargaMensual(act, '2026-11-01');
  assert.equal(nov.puntos, 500);
  assert.equal(nov.estado.ultimaRecarga, '2026-11');
  assert.equal(P.recargaMensual(nov.estado, '2026-11-15').puntos, 0, 'no repite en el mismo mes');
  const salto = P.recargaMensual(act, '2027-03-02');
  assert.equal(salto.puntos, 500, 'meses saltados: una sola recarga');
  assert.equal(salto.estado.ultimaRecarga, '2027-03');
  const enero = P.recargaMensual({ ...act, ultimaRecarga: '2026-12' }, '2027-01-01');
  assert.equal(enero.puntos, 500, 'cambio de año');
  assert.equal(P.recargaMensual(act, '2026-09-30').puntos, 0, 'reloj hacia atrás');
  assert.equal(P.recargaMensual({ ...act, activo: false }, '2026-12-01').puntos, 0, 'plan apagado');
});

test('aplicarRecargaMensual: suma 500 al fondo una sola vez por mes', () => {
  const almacen = almacenFalso();
  P.activarYGuardar('2026-10-11', almacen);
  assert.equal(P.aplicarRecargaMensual('2026-10-20', almacen), 0);
  assert.equal(P.aplicarRecargaMensual('2026-11-02', almacen), 500);
  assert.equal(P.aplicarRecargaMensual('2026-11-03', almacen), 0);
  assert.equal(cargarOrdago(almacen).fondo, 2500);
  assert.equal(P.aplicarRecargaMensual('2026-11-03', almacenFalso()), 0, 'plan gratis: nada');
});

test('cupo diario gratis: 1 tanda al día, se reinicia al cambiar de día, Premium sin límite', () => {
  const gratis = P.crearPremium();
  const vacio = P.normalizarGeneradas(null);
  assert.equal(P.puedeGenerar(gratis, vacio, '2026-10-11'), true);
  const una = P.contarGenerada(vacio, '2026-10-11');
  assert.deepEqual(una, { dia: '2026-10-11', n: 1 });
  assert.equal(P.puedeGenerar(gratis, una, '2026-10-11'), false);
  assert.equal(P.puedeGenerar(gratis, una, '2026-10-12'), true, 'día nuevo');
  assert.deepEqual(P.contarGenerada(una, '2026-10-12'), { dia: '2026-10-12', n: 1 });
  assert.equal(P.puedeGenerar({ ...gratis, activo: true }, { dia: '2026-10-11', n: 50 }, '2026-10-11'), true);
});

test('generadas se persiste y una clave corrupta cuenta como 0', () => {
  const almacen = almacenFalso();
  P.guardarGeneradas({ dia: '2026-10-11', n: 1 }, almacen);
  assert.deepEqual(P.cargarGeneradas(almacen), { dia: '2026-10-11', n: 1 });
  assert.deepEqual(P.cargarGeneradas(almacenFalso({ 'one.premium.generadas': '{"dia":3,"n":-1}' })), { dia: null, n: 0 });
});
