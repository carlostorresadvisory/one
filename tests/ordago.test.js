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
  O.olvidarMemoria();
});
test('sin almacenamiento el fondo vive en memoria; con un almacén sano vuelve a mandar el almacén', () => {
  O.olvidarMemoria();
  const roto = almacenRoto();
  assert.equal(O.guardarOrdago(O.conFondo(O.cargarOrdago(roto), 700), roto), false);
  assert.equal(O.cargarOrdago(roto).fondo, 700);
  assert.equal(O.guardarOrdago(O.crearOrdago(), almacenFalso()), true);
  assert.equal(O.cargarOrdago(roto).fondo, 1000);
  O.olvidarMemoria();
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
test('formatearCifra: punto de miles desde 4 cifras y signo menos tipográfico', () => {
  assert.equal(O.formatearCifra(1000), '1.000');
  assert.equal(O.formatearCifra(1250), '1.250');
  assert.equal(O.formatearCifra(999), '999');
  assert.equal(O.formatearCifra(1234567), '1.234.567');
  assert.equal(O.formatearCifra(-250), '−250');
  assert.equal(O.formatearCifra(NaN), '0');
});
test('elegirPreguntaOrdago: no repite hasta agotar, prefiere las nunca jugadas y evita la última', () => {
  const lista = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(O.elegirPreguntaOrdago([], {}), null);
  assert.equal(O.elegirPreguntaOrdago(lista, { usados: new Set(['a', 'b']), rng: () => 0 }).id, 'c');
  assert.equal(O.elegirPreguntaOrdago(lista, { vistas: new Set(['a', 'b']), rng: () => 0 }).id, 'c');
  const agotadas = O.elegirPreguntaOrdago(lista, { usados: new Set(['a', 'b', 'c']), ultima: 'c', rng: () => 0.99 });
  assert.notEqual(agotadas.id, 'c');
  assert.equal(O.elegirPreguntaOrdago([{ id: 'x' }], { usados: new Set(['x']), ultima: 'x' }).id, 'x');
});
test('puntosMinicurva: sube hacia arriba, el máximo marca el techo y un solo punto no rompe', () => {
  const { puntos, yMaximo } = O.puntosMinicurva([1000, 500, 1500], 1500);
  assert.equal(puntos, '0,12 30,22 60,2');
  assert.equal(yMaximo, 2);
  const uno = O.puntosMinicurva([1000], 1000);
  assert.equal(uno.puntos.split(' ').length, 2);
  assert.ok(Number.isFinite(O.puntosMinicurva([], 0).yMaximo));
});
test('conFondo (Tienda): cambia el fondo, suma el punto a la curva y no toca racha ni quiebras; sin cambio, igual', () => {
  const base = { ...O.crearOrdago(), racha: 4, quiebras: 2 };
  const n = O.conFondo(base, 700);
  assert.deepEqual([n.fondo, n.racha, n.quiebras, n.curva.at(-1)], [700, 4, 2, 700]);
  assert.equal(base.fondo, 1000);
  assert.equal(O.conFondo(base, 1000).curva.length, 1);
  assert.equal(O.conFondo(base, -5).fondo, 0);
  assert.equal(O.conFondo(base, 'x').fondo, 0);
});
