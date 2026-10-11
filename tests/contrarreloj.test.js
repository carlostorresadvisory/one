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
test('jugable en Contrarreloj = corta y de nivel 1-5 (el suelo de 3 es solo de Órdago)', () => {
  const medir = (t) => t.length * 10;
  const corta = 'Roma se fundó en el 753 a. C.';
  for (const nivel of [1, 2, 3, 4, 5]) assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel, enunciado: corta }, medir), true);
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel: 0, enunciado: corta }, medir), false);
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel: 6, enunciado: corta }, medir), false);
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', enunciado: corta }, medir), false); // sin nivel no vale
  assert.equal(C.esJugableContrarreloj({ tipo: 'vf', nivel: 1, enunciado: 'x'.repeat(200) }, medir), false);
  assert.equal(C.esJugableContrarreloj({ tipo: 'ordenar', nivel: 1, enunciado: 'x' }, medir), false);
});
test('rampa: posición → nivel (1-2→1, 3-4→2, 5-6→3, 7-8→4, 9-10→5) y doble 4-5', () => {
  const esperado = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  esperado.forEach((n, i) => assert.equal(C.nivelObjetivoContrarreloj(i + 1), n, `posición ${i + 1}`));
  [4, 4, 4, 4, 4, 5, 5, 5, 5, 5].forEach((n, i) => assert.equal(C.nivelObjetivoContrarreloj(i + 1, true), n, `doble ${i + 1}`));
  assert.equal(C.nivelObjetivoContrarreloj(0), 1);
  assert.equal(C.nivelObjetivoContrarreloj(99), 5);
});
test('elegirPorNivel: el nivel pedido, o el más cercano con preferencia en el empate', () => {
  const q = (id, nivel) => ({ id, nivel });
  const ids = (l) => l.map((p) => p.id);
  const todas = [q('a', 1), q('b', 3), q('c', 3), q('d', 5)];
  assert.deepEqual(ids(C.elegirPorNivel(todas, 3)), ['b', 'c']);
  assert.deepEqual(ids(C.elegirPorNivel(todas, 2, 'inferior')), ['a']); // 1 y 3 a igual distancia
  assert.deepEqual(ids(C.elegirPorNivel(todas, 2, 'superior')), ['b', 'c']);
  assert.deepEqual(ids(C.elegirPorNivel(todas, 4, 'inferior')), ['b', 'c']);
  assert.deepEqual(ids(C.elegirPorNivel(todas, 4, 'superior')), ['d']);
  assert.deepEqual(ids(C.elegirPorNivel([q('x', 2)], 5)), ['x']); // solo hay uno: el más cercano aunque lejos
  assert.deepEqual(C.elegirPorNivel([], 3), []);
});
test('candidatasDeRampa: inferior en 1-6, superior en 7-10 y en el doble', () => {
  const ids = (l) => l.map((p) => p.id);
  const sinNivel2y4 = [{ id: 'n1', nivel: 1 }, { id: 'n3', nivel: 3 }, { id: 'n5', nivel: 5 }];
  assert.deepEqual(ids(C.candidatasDeRampa(sinNivel2y4, 3)), ['n1']); // objetivo 2: 1 y 3 empatan → inferior
  assert.deepEqual(ids(C.candidatasDeRampa(sinNivel2y4, 7)), ['n5']); // objetivo 4: 3 y 5 empatan → superior
  assert.deepEqual(ids(C.candidatasDeRampa(sinNivel2y4, 1, true)), ['n5']); // doble: objetivo 4 → superior
  assert.deepEqual(ids(C.candidatasDeRampa(sinNivel2y4, 1)), ['n1']);
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
test('récords: doblesGanados con tope de producto (999) y sin desbordar al sumar', () => {
  assert.equal(C.normalizarRecords({ doblesGanados: 999 }).doblesGanados, 999);
  assert.equal(C.normalizarRecords({ doblesGanados: 1000 }).doblesGanados, 0);
  const tope = { version: 1, mejor: { fase: 'doble', aciertos: 10 }, doblesGanados: 999 };
  const serie = { fase: 'doble', indice: 10, viva: true, cofre: [], terminada: true };
  assert.equal(C.actualizarRecords(tope, serie).doblesGanados, 999);
});
test('récords sin almacenamiento: viven en memoria hasta recargar (spec §9)', () => {
  const r = { version: 1, mejor: { fase: 'normal', aciertos: 10 }, doblesGanados: 0 };
  assert.equal(C.guardarRecords(r, almacenRoto()), false);
  assert.equal(C.cargarRecords(almacenRoto()).mejor.aciertos, 10);
  assert.equal(C.marcaTexto(C.cargarRecords(almacenRoto())), '10/10');
  C.guardarRecords(C.crearRecords(), almacenFalso()); // un almacén sano vuelve a mandar
  assert.deepEqual(C.cargarRecords(almacenRoto()), C.crearRecords());
});
