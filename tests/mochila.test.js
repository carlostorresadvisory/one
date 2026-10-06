// Tests del núcleo puro de mochila.js (spec v0.3 §6; tienda/cofres/uso en fases 4 y 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJETOS, PROBABILIDADES_COFRE, CLAVE_MOCHILA, crearMochila, normalizarMochila, sortearObjeto,
  anadirObjeto, contarObjetos, cargarMochila, guardarMochila, ganaPremioTanda,
} from '../mochila.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

test('OBJETOS: precios y rarezas de la tabla de la spec §6', () => {
  assert.deepEqual(
    Object.values(OBJETOS).map((o) => [o.id, o.nombre, o.precio, o.rareza]),
    [['cincuenta', '50/50', 300, 'raro'], ['salvavidas', 'Salvavidas', 500, 'epico'], ['mas5', '+5 s', 200, 'comun']]
  );
});

test('PROBABILIDADES_COFRE: suman 1 en normal y en doble', () => {
  for (const tabla of Object.values(PROBABILIDADES_COFRE)) {
    assert.ok(Math.abs(tabla.reduce((s, [, p]) => s + p, 0) - 1) < 1e-9);
  }
});

test('sortearObjeto normal: +5 s 45 % · 50/50 35 % · Salvavidas 20 %', () => {
  assert.equal(sortearObjeto(() => 0), 'mas5');
  assert.equal(sortearObjeto(() => 0.449), 'mas5');
  assert.equal(sortearObjeto(() => 0.45), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.799), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.8), 'salvavidas');
  assert.equal(sortearObjeto(() => 0.9999), 'salvavidas');
});

test('sortearObjeto doble: 30 % · 35 % · 35 %; tipo desconocido = normal', () => {
  assert.equal(sortearObjeto(() => 0.29, 'doble'), 'mas5');
  assert.equal(sortearObjeto(() => 0.3, 'doble'), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.65, 'doble'), 'salvavidas');
  assert.equal(sortearObjeto(() => 0.5, 'raro'), 'cincuenta');
});

test('anadirObjeto es inmutable, suma y rechaza ids o cantidades inválidas', () => {
  const vacia = crearMochila();
  const una = anadirObjeto(vacia, 'salvavidas');
  assert.equal(vacia.objetos.salvavidas, 0);
  assert.equal(una.objetos.salvavidas, 1);
  assert.equal(anadirObjeto(una, 'salvavidas', 2).objetos.salvavidas, 3);
  assert.equal(anadirObjeto(una, 'cohete'), una);
  assert.equal(anadirObjeto(una, 'mas5', 0), una);
});

test('contarObjetos suma todos los objetos', () => {
  const m = anadirObjeto(anadirObjeto(crearMochila(), 'mas5', 2), 'cincuenta');
  assert.equal(contarObjetos(m), 3);
  assert.equal(contarObjetos(null), 0);
});

test('normalizarMochila descarta negativos, decimales, ids desconocidos y basura', () => {
  const m = normalizarMochila({ objetos: { mas5: -1, cincuenta: 2.5, salvavidas: 4, cohete: 9 } });
  assert.deepEqual(m, { version: 1, objetos: { cincuenta: 0, salvavidas: 4, mas5: 0 } });
  assert.deepEqual(normalizarMochila('basura'), crearMochila());
});

test('persistencia: guardar + cargar ida y vuelta', () => {
  const almacen = almacenFalso();
  assert.equal(guardarMochila(anadirObjeto(crearMochila(), 'mas5'), almacen), true);
  assert.equal(cargarMochila(almacen).objetos.mas5, 1);
});

test('Review Focus 2: JSON roto o almacén roto → mochila vacía, sin lanzar', () => {
  assert.deepEqual(cargarMochila(almacenFalso({ [CLAVE_MOCHILA]: '{roto' })), crearMochila());
  assert.deepEqual(cargarMochila(almacenRoto()), crearMochila());
  assert.equal(guardarMochila(crearMochila(), almacenRoto()), false);
});

test('ganaPremioTanda: tanda de 10 con 8 o más aciertos', () => {
  assert.equal(ganaPremioTanda({ respondidas: 10, aciertos: 8 }), true);
  assert.equal(ganaPremioTanda({ respondidas: 10, aciertos: 10 }), true);
  assert.equal(ganaPremioTanda({ respondidas: 10, aciertos: 7 }), false);
  assert.equal(ganaPremioTanda({ respondidas: 9, aciertos: 9 }), false);
});
