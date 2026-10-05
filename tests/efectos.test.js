// Tests de efectos.js (spec v0.3 §7): partes puras + DOM falso; el confeti con librería inyectada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prefiereMenosMovimiento, pulsarClase, efectoAcierto, efectoFallo, destelloPantalla,
  suavizar, valorIntermedio, contarCifra, estadoBarraTiempo, pintarBarraTiempo,
  nivelLlama, pintarLlama, marcarDorada, lanzarConfeti, reiniciarConfetiParaTests, COLORES_CONFETI,
} from '../efectos.js';
import { ElementoFalso } from './dom-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';

const ventanaNormal = { matchMedia: () => ({ matches: false }) };
const ventanaReducida = { matchMedia: () => ({ matches: true }) };

test('prefiereMenosMovimiento: lee matchMedia y nunca lanza', () => {
  assert.equal(prefiereMenosMovimiento(ventanaReducida), true);
  assert.equal(prefiereMenosMovimiento(ventanaNormal), false);
  assert.equal(prefiereMenosMovimiento({}), false);
  assert.equal(prefiereMenosMovimiento({ matchMedia: () => { throw new Error('x'); } }), false);
});

test('pulsarClase pone la clase y la quita al vencer', () => {
  const t = temporizadorFalso();
  const nodo = new ElementoFalso('div');
  pulsarClase(nodo, 'efecto-acierto', { ms: 500, temporizador: t });
  assert.ok(nodo.classList.contains('efecto-acierto'));
  t.avanzar(499);
  assert.ok(nodo.classList.contains('efecto-acierto'));
  t.avanzar(1);
  assert.ok(!nodo.classList.contains('efecto-acierto'));
});

test('efectoAcierto/efectoFallo usan sus clases; nodo nulo no lanza', () => {
  const t = temporizadorFalso();
  const a = new ElementoFalso('div');
  const f = new ElementoFalso('div');
  efectoAcierto(a, { temporizador: t });
  efectoFallo(f, { temporizador: t });
  assert.ok(a.classList.contains('efecto-acierto'));
  assert.ok(f.classList.contains('efecto-fallo'));
  assert.equal(efectoAcierto(null), null);
});

test('destelloPantalla marca el tipo en la capa fija y la activa', () => {
  const t = temporizadorFalso();
  const capa = new ElementoFalso('div');
  const documento = { querySelector: (sel) => (sel === '[data-test="destello"]' ? capa : null) };
  destelloPantalla('ko', { documento, temporizador: t });
  assert.equal(capa.dataset.tipo, 'ko');
  assert.ok(capa.classList.contains('destello--activo'));
  assert.equal(destelloPantalla('ok', { documento: { querySelector: () => null } }), null);
});

test('suavizar y valorIntermedio: extremos exactos y monotonía', () => {
  assert.equal(suavizar(0), 0);
  assert.equal(suavizar(1), 1);
  assert.equal(suavizar(2), 1);
  assert.ok(suavizar(0.5) > 0.5); // ease-out
  assert.equal(valorIntermedio(10, 110, 1), 110);
  assert.equal(valorIntermedio(110, 10, 1), 10); // también cuenta hacia abajo
});

test('contarCifra anima con requestAnimationFrame y acaba en el valor final con formato', async () => {
  let ahora = 0;
  const marcos = [];
  const ventana = { ...ventanaNormal, performance: { now: () => ahora }, requestAnimationFrame: (fn) => marcos.push(fn) };
  const nodo = { textContent: '' };
  const fin = contarCifra(nodo, { desde: 0, hasta: 100, duracionMs: 600, formato: (n) => `${n} pts`, ventana });
  ahora = 300;
  marcos.shift()(ahora);
  const intermedio = Number.parseInt(nodo.textContent, 10);
  assert.ok(intermedio > 0 && intermedio < 100);
  ahora = 600;
  marcos.shift()(ahora);
  await fin;
  assert.equal(nodo.textContent, '100 pts');
});

test('contarCifra con reducir movimiento pinta el valor final al instante', async () => {
  const nodo = { textContent: '' };
  await contarCifra(nodo, { hasta: 7, ventana: { ...ventanaReducida, requestAnimationFrame: () => assert.fail('no debe animar') } });
  assert.equal(nodo.textContent, '7');
});

test('estadoBarraTiempo: fracción acotada, crítico en los 3 últimos segundos, agotado en 0', () => {
  assert.deepEqual(estadoBarraTiempo(12000, 12000), { fraccion: 1, critico: false, agotado: false });
  assert.deepEqual(estadoBarraTiempo(3000, 12000), { fraccion: 0.25, critico: true, agotado: false });
  assert.deepEqual(estadoBarraTiempo(0, 12000), { fraccion: 0, critico: false, agotado: true });
  assert.deepEqual(estadoBarraTiempo(-50, 6000), { fraccion: 0, critico: false, agotado: true });
  assert.equal(estadoBarraTiempo(5000, 0).fraccion, 0);
});

test('pintarBarraTiempo escribe transform, --fraccion y la clase crítica', () => {
  const nodo = new ElementoFalso('div');
  nodo.style.setProperty = (k, v) => { nodo.style[k] = v; };
  pintarBarraTiempo(nodo, 2000, 8000);
  assert.equal(nodo.style.transform, 'scaleX(0.25)');
  assert.equal(nodo.style['--fraccion'], '0.25');
  assert.ok(nodo.classList.contains('barra-tiempo--critica'));
});

test('nivelLlama: nada por debajo de 3; crece cada 3 hasta 3', () => {
  assert.deepEqual([0, 2, 3, 5, 6, 8, 9, 40].map(nivelLlama), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(nivelLlama(-1), 0);
  assert.equal(nivelLlama(2.5), 0);
});

test('pintarLlama oculta por debajo de 3 y enseña la racha con su nivel', () => {
  const nodo = new ElementoFalso('span');
  assert.equal(pintarLlama(nodo, 2), 0);
  assert.equal(nodo.hidden, true);
  assert.equal(pintarLlama(nodo, 7), 2);
  assert.equal(nodo.hidden, false);
  assert.equal(nodo.dataset.nivel, '2');
  assert.equal(nodo.textContent, '🔥 7');
});

test('marcarDorada pone y quita tarjeta--dorada', () => {
  const nodo = new ElementoFalso('div');
  marcarDorada(nodo, true);
  assert.ok(nodo.classList.contains('tarjeta--dorada'));
  marcarDorada(nodo, false);
  assert.ok(!nodo.classList.contains('tarjeta--dorada'));
});

test('COLORES_CONFETI: cian, dorado, blanco y verde; sin magenta', () => {
  assert.deepEqual(COLORES_CONFETI, ['#4cc9f0', '#f2c14e', '#e8edf2', '#3ddc84']);
});

test('lanzarConfeti crea UN lienzo fijo y reutiliza el disparador; sin worker', async () => {
  reiniciarConfetiParaTests();
  const body = new ElementoFalso('body');
  const documento = { body, createElement: (tag) => new ElementoFalso(tag) };
  const creaciones = [];
  const disparos = [];
  const cargar = async () => ({ create: (lienzo, op) => { creaciones.push(op); return (o) => disparos.push(o); } });
  assert.equal(await lanzarConfeti({ documento, ventana: ventanaNormal, cargar }), true);
  assert.equal(await lanzarConfeti({ documento, ventana: ventanaNormal, cargar }), true);
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].dataset.test, 'confeti');
  assert.deepEqual(creaciones, [{ resize: true, useWorker: false }]);
  assert.equal(disparos.length, 2);
  assert.deepEqual(disparos[0].colors, COLORES_CONFETI);
});

test('lanzarConfeti con reducir movimiento no carga nada y devuelve false', async () => {
  reiniciarConfetiParaTests();
  const cargar = async () => assert.fail('no debe cargar la librería');
  assert.equal(await lanzarConfeti({ documento: { body: new ElementoFalso('body') }, ventana: ventanaReducida, cargar }), false);
});

test('lanzarConfeti con la librería rota devuelve false sin lanzar', async () => {
  reiniciarConfetiParaTests();
  const documento = { body: new ElementoFalso('body'), createElement: (t) => new ElementoFalso(t) };
  assert.equal(await lanzarConfeti({ documento, ventana: ventanaNormal, cargar: async () => { throw new Error('404'); } }), false);
});
