// Tests de ordago.js (spec v0.3 §5.2): fichas, multiplicador, cobro, salvavidas, quiebra, máximo, persistencia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../ordago.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

test('fichas: porcentaje, mínimo 1 y nunca más que el fondo', () => {
  assert.equal(O.calcularFicha(1000, 0.1), 100);
  assert.equal(O.calcularFicha(1000, 1), 1000);
  assert.equal(O.calcularFicha(5, 0.1), 1);
  assert.equal(O.calcularFicha(1, 0.25), 1);
});
test('multiplicador combina nivel, dorada y racha sin aplicar dos veces el ×3', () => {
  assert.equal(O.multiplicador({ nivel: 1, dorada: false, racha: 0 }), 1);
  assert.equal(O.multiplicador({ nivel: 5, dorada: false, racha: 0 }), 2);
  assert.equal(O.multiplicador({ nivel: 1, dorada: true, racha: 0 }), 3);
  assert.equal(O.multiplicador({ nivel: 3, dorada: true, racha: 3 }), 1.5 * 3 * 1.5);
});
test('acierto cobra ficha × multiplicador y sube la racha', () => {
  const { estado, delta } = O.resolverRonda(O.crearOrdago(), { ficha: 100, correcta: true, nivel: 3, dorada: false });
  assert.equal(delta, 150);
  assert.equal(estado.fondo, 1150);
  assert.equal(estado.racha, 1);
  assert.deepEqual(estado.curva, [1000, 1150]);
});
test('racha ≥ 3 multiplica ×1,5 a partir de la cuarta', () => {
  const e = { ...O.crearOrdago(), racha: 3 };
  const r = O.resolverRonda(e, { ficha: 100, correcta: true, nivel: 1, dorada: false });
  assert.equal(r.delta, 150);
});
test('fallo pierde la ficha y corta la racha', () => {
  const e = { ...O.crearOrdago(), racha: 4 };
  const r = O.resolverRonda(e, { ficha: 250, correcta: false, nivel: 3, dorada: false });
  assert.equal(r.estado.fondo, 750);
  assert.equal(r.estado.racha, 0);
});
test('salvavidas en fallo recupera la mitad de la ficha y mantiene la racha', () => {
  const e = { ...O.crearOrdago(), racha: 2 };
  const r = O.resolverRonda(e, { ficha: 101, correcta: false, nivel: 3, dorada: false, salvavidas: true });
  assert.equal(r.delta, -51);
  assert.equal(r.estado.racha, 2);
});
test('órdago fallado = quiebra; fondo nuevo conserva el máximo y cuenta la quiebra', () => {
  const r = O.resolverRonda(O.crearOrdago(), { ficha: 1000, correcta: false, nivel: 3, dorada: false });
  assert.equal(r.quiebra, true);
  const nuevo = O.abrirFondoNuevo(r.estado);
  assert.equal(nuevo.fondo, 1000);
  assert.equal(nuevo.quiebras, 1);
  assert.equal(nuevo.maximo, 1000);
  assert.equal(nuevo.racha, 0);
});
test('nuevo máximo se informa solo al superar el histórico', () => {
  const e = { ...O.crearOrdago(), fondo: 900, maximo: 1200 };
  assert.equal(O.resolverRonda(e, { ficha: 100, correcta: true, nivel: 3, dorada: false }).nuevoMaximo, false);
  assert.equal(O.resolverRonda(e, { ficha: 400, correcta: true, nivel: 3, dorada: false }).nuevoMaximo, true);
});
test('pregunta dorada con probabilidad 1/7 (rng inyectado)', () => {
  assert.equal(O.esDorada(() => 0.14), true);
  assert.equal(O.esDorada(() => 0.15), false);
});
test('la curva no pasa de MAX_CURVA puntos', () => {
  let e = O.crearOrdago();
  for (let i = 0; i < 300; i += 1) e = O.resolverRonda(e, { ficha: 1, correcta: true, nivel: 3, dorada: false }).estado;
  assert.equal(e.curva.length, O.MAX_CURVA);
});
test('persistencia: corrupto, absurdo o bloqueado → valores por defecto sin lanzar', () => {
  assert.deepEqual(O.cargarOrdago(almacenFalso({ 'one.ordago': '{roto' })), O.crearOrdago());
  assert.deepEqual(O.cargarOrdago(almacenRoto()), O.crearOrdago());
  const raro = O.normalizarOrdago({ fondo: -5, maximo: 'x', curva: 'no', quiebras: 1.5, racha: NaN });
  assert.deepEqual(raro, O.crearOrdago());
  const e = { ...O.crearOrdago(), fondo: 2000, maximo: 2000 };
  const almacen = almacenFalso();
  assert.equal(O.guardarOrdago(e, almacen), true);
  assert.equal(O.cargarOrdago(almacen).fondo, 2000);
  assert.equal(O.guardarOrdago(e, almacenRoto()), false);
});
test('localStorage bloqueado (getter que lanza): cargar y guardar no lanzan', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(O.cargarOrdago(), O.crearOrdago());
    assert.equal(O.guardarOrdago(O.crearOrdago()), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
test('normalizar: números absurdos se acotan, el máximo nunca baja del fondo y la curva se recorta', () => {
  const e = O.normalizarOrdago({ fondo: 5000, maximo: 10, curva: Array.from({ length: 500 }, (_, i) => i), quiebras: 3, racha: 2 });
  assert.equal(e.maximo, 5000);
  assert.equal(e.curva.length, O.MAX_CURVA);
  assert.equal(O.normalizarOrdago({ fondo: 1e30 }).fondo, O.FONDO_INICIAL);
});
test('Review Focus 3: elegir ficha no toca lo guardado; solo resolverRonda cambia el fondo', () => {
  const almacen = almacenFalso();
  O.guardarOrdago(O.crearOrdago(), almacen);
  const ficha = O.calcularFicha(O.cargarOrdago(almacen).fondo, O.FICHAS[3].pct);
  assert.equal(ficha, 1000);
  assert.equal(O.cargarOrdago(almacen).fondo, 1000); // «recarga» antes de responder: la ficha sigue en el fondo
});
test('resolverRonda no confía en una ficha mayor que el fondo ni en una ficha absurda', () => {
  const r = O.resolverRonda(O.crearOrdago(), { ficha: 99999, correcta: false, nivel: 3, dorada: false });
  assert.equal(r.estado.fondo, 0);
  const s = O.resolverRonda(O.crearOrdago(), { ficha: NaN, correcta: false, nivel: 3, dorada: false });
  assert.equal(s.estado.fondo, 999);
});
