import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../contrarreloj.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

const rng = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('tiempo lineal 12→6 s en la normal y 6→4 s en el doble', () => {
  assert.equal(C.tiempoPreguntaMs(0, 'normal'), 12000);
  assert.equal(C.tiempoPreguntaMs(9, 'normal'), 6000);
  assert.equal(C.tiempoPreguntaMs(0, 'doble'), 6000);
  assert.equal(C.tiempoPreguntaMs(9, 'doble'), 4000);
});
test('corta: V/F y test4 breves sí; ordenar o enunciado largo no', () => {
  const medir = (t) => t.length * 10;
  assert.equal(C.esCorta({ tipo: 'vf', enunciado: 'Roma se fundó en el 753 a. C.' }, medir), true);
  assert.equal(C.esCorta({ tipo: 'ordenar', enunciado: 'x' }, medir), false);
  assert.equal(C.esCorta({ tipo: 'vf', enunciado: 'x'.repeat(200) }, medir), false);
  assert.equal(C.esCorta({ tipo: 'test4', enunciado: 'x', opciones: ['a', 'b', 'c', 'y'.repeat(80)] }, medir), false);
});
test('jugable en Contrarreloj = corta y de nivel 3-5 (nunca nivel 1-2)', () => {
  const medir = (t) => t.length * 10;
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel: 3, enunciado: 'Roma se fundó en el 753 a. C.' }, medir), true);
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel: 2, enunciado: 'Roma se fundó en el 753 a. C.' }, medir), false);
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel: 4, enunciado: 'x'.repeat(200) }, medir), false);
});
test('fallo = caes; salvavidas te deja seguir', () => {
  const s = C.responder(C.crearSerie(), { correcta: false });
  assert.equal(s.viva, false);
  const t = C.responder(C.crearSerie(), { correcta: false, salvavidas: true });
  assert.equal(t.viva, true);
  assert.equal(t.indice, 1);
});
test('una serie caída o terminada ya no cambia', () => {
  const caida = C.responder(C.crearSerie(), { correcta: false });
  assert.deepEqual(C.responder(caida, { correcta: true }), caida);
});
test('10 aciertos → cofre de 1; plantarse se lo queda', () => {
  let s = C.crearSerie();
  for (let i = 0; i < 10; i += 1) s = C.responder(s, { correcta: true });
  assert.equal(s.terminada, true);
  s = C.abrirCofre(s, rng(0.1));
  assert.deepEqual(s.cofre, ['mas5']);
  assert.deepEqual(C.resultadoFinal(s, rng(0.1)), ['mas5']);
});
test('doble superado → 2 objetos con la tabla del doble; caer en el doble → nada', () => {
  let s = C.crearSerie();
  for (let i = 0; i < 10; i += 1) s = C.responder(s, { correcta: true });
  s = C.aceptarDoble(C.abrirCofre(s, rng(0.1)));
  let ganada = s;
  for (let i = 0; i < 10; i += 1) ganada = C.responder(ganada, { correcta: true });
  assert.deepEqual(C.resultadoFinal(ganada, rng(0.99, 0.31)), ['salvavidas', 'cincuenta']);
  const caida = C.responder(s, { correcta: false });
  assert.deepEqual(C.resultadoFinal(caida, rng(0.1)), []);
});
test('caer en la serie normal no da nada', () => {
  assert.deepEqual(C.resultadoFinal(C.responder(C.crearSerie(), { correcta: false }), rng(0.1)), []);
});
test('récords: mejor marca y dobles ganados; texto de marca', () => {
  let r = C.crearRecords();
  assert.equal(C.marcaTexto(r), ''); // sin marca todavía
  r = C.actualizarRecords(r, { fase: 'normal', indice: 7, viva: false, terminada: false });
  assert.equal(C.marcaTexto(r), '7/10');
  r = C.actualizarRecords(r, { fase: 'normal', indice: 3, viva: false, terminada: false });
  assert.equal(C.marcaTexto(r), '7/10'); // una marca peor no la pisa
  r = C.actualizarRecords(r, { fase: 'doble', indice: 10, viva: true, terminada: true });
  assert.equal(r.doblesGanados, 1);
  assert.equal(C.marcaTexto(r), 'Doble ×1');
  assert.deepEqual(C.cargarRecords(almacenRoto()), C.crearRecords());
  assert.deepEqual(C.cargarRecords(almacenFalso({ 'one.contrarreloj': '[]' })), C.crearRecords());
});
test('récords: persisten y con números absurdos se normalizan sin lanzar', () => {
  const almacen = almacenFalso();
  assert.equal(C.guardarRecords({ version: 1, mejor: { fase: 'normal', aciertos: 8 }, doblesGanados: 2 }, almacen), true);
  assert.equal(C.cargarRecords(almacen).doblesGanados, 2);
  const absurdo = almacenFalso({ 'one.contrarreloj': JSON.stringify({ mejor: { fase: 'x', aciertos: 99 }, doblesGanados: -4 }) });
  assert.deepEqual(C.cargarRecords(absurdo), C.crearRecords());
  assert.equal(C.guardarRecords(C.crearRecords(), almacenRoto()), false);
});
test('la serie no se persiste: solo se guardan los récords', () => {
  assert.equal(C.CLAVE_CONTRARRELOJ, 'one.contrarreloj');
  const almacen = almacenFalso();
  C.guardarRecords(C.crearRecords(), almacen);
  assert.deepEqual([...almacen.datos.keys()], ['one.contrarreloj']);
  assert.equal('viva' in JSON.parse(almacen.datos.get('one.contrarreloj')), false);
});
