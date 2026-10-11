// Tests de la barra de comodines (comodines-ui.js, spec v0.3 §4 y §6): qué se ve, doble toque y descuento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarComodines, descartesCincuenta, gastarComodin } from '../comodines-ui.js';
import { anadirObjeto, crearMochila, cargarMochila, guardarMochila } from '../mochila.js';
import { ElementoFalso } from './dom-falso.js';
import { almacenFalso } from './almacen-falso.js';

function barra() {
  const nodo = new ElementoFalso('div');
  nodo.querySelector = (sel) => nodo.buscarPorClase(sel.replace('.', ''));
  const documento = { createElement: (t) => new ElementoFalso(t) };
  return { nodo, documento };
}
const conObjetos = (objetos) => Object.entries(objetos).reduce((m, [id, n]) => anadirObjeto(m, id, n), crearMochila());

test('descartesCincuenta: dos incorrectas distintas, nunca la correcta; vacío si no es test4', () => {
  const p = { tipo: 'test4', opciones: ['a', 'b', 'c', 'd'], correcta: 2 };
  for (let i = 0; i < 50; i += 1) {
    const d = descartesCincuenta(p);
    assert.equal(d.length, 2);
    assert.notEqual(d[0], d[1]);
    assert.ok(!d.includes(2));
  }
  assert.deepEqual(descartesCincuenta({ tipo: 'vf', respuesta: true }), []);
});

test('la barra solo enseña los comodines que tienes y que valen en el modo y el tipo de pregunta', () => {
  const { nodo, documento } = barra();
  const m = conObjetos({ cincuenta: 1, salvavidas: 2, mas5: 1 });
  const b = montarComodines(nodo, { modo: 'ordago', mochila: m, tipoPregunta: 'test4', alUsar() {}, documento });
  assert.deepEqual(nodo.children.map((c) => c.getAttribute('data-test')), ['comodin-cincuenta', 'comodin-salvavidas']); // +5 s no vale en Órdago
  b.actualizar({ tipoPregunta: 'vf', usadosEnPregunta: [] });
  assert.deepEqual(nodo.children.map((c) => c.getAttribute('data-test')), ['comodin-salvavidas']); // 50/50 solo en test4
  b.actualizar({ tipoPregunta: 'test4' });
  assert.equal(nodo.children.length, 2);
  const c = barra();
  montarComodines(c.nodo, { modo: 'contrarreloj', mochila: m, tipoPregunta: 'vf', alUsar() {}, documento: c.documento });
  assert.deepEqual(c.nodo.children.map((x) => x.getAttribute('data-test')), ['comodin-mas5', 'comodin-salvavidas']);
});

test('mochila vacía: la barra queda oculta y no ocupa sitio', () => {
  const { nodo, documento } = barra();
  const b = montarComodines(nodo, { modo: 'clasico', mochila: crearMochila(), tipoPregunta: 'test4', alUsar() {}, documento });
  assert.equal(nodo.hidden, true);
  b.destruir();
  assert.equal(nodo.hidden, true);
});

test('doble toque = un solo uso; el comodín usado queda pulsado y deshabilitado hasta la pregunta siguiente', () => {
  const { nodo, documento } = barra();
  const usos = [];
  const b = montarComodines(nodo, { modo: 'ordago', mochila: conObjetos({ salvavidas: 3 }), tipoPregunta: 'test4', alUsar: (id) => usos.push(id), documento });
  const boton = nodo.children[0];
  boton.disparar('click');
  nodo.children[0].disparar('click');
  boton.disparar('click');
  assert.deepEqual(usos, ['salvavidas']);
  assert.equal(nodo.children[0].getAttribute('aria-pressed'), 'true');
  assert.equal(nodo.children[0].disabled, true);
  b.actualizar({ usadosEnPregunta: [] }); // pregunta nueva
  assert.equal(nodo.children[0].disabled, false);
  nodo.children[0].disparar('click');
  assert.deepEqual(usos, ['salvavidas', 'salvavidas']);
});

test('gastarComodin descuenta uno de la mochila guardada y nunca baja de 0', () => {
  const almacen = almacenFalso();
  guardarMochila(conObjetos({ mas5: 1 }), almacen);
  gastarComodin('mas5', almacen);
  gastarComodin('mas5', almacen);
  assert.equal(cargarMochila(almacen).objetos.mas5, 0);
});

test('visible(false) oculta la barra aunque haya comodines y visible(true) la devuelve', () => {
  const { nodo, documento } = barra();
  const b = montarComodines(nodo, { modo: 'masomenos', mochila: conObjetos({ salvavidas: 1 }), alUsar() {}, documento });
  assert.equal(nodo.hidden, false);
  b.visible(false);
  assert.equal(nodo.hidden, true);
  b.visible(true);
  assert.equal(nodo.hidden, false);
});

test('si alUsar devuelve false el comodín no se marca como usado y se puede volver a intentar', () => {
  const { nodo, documento } = barra();
  let surte = false;
  const b = montarComodines(nodo, { modo: 'contrarreloj', mochila: conObjetos({ mas5: 1 }), tipoPregunta: 'vf', alUsar: () => surte, documento });
  nodo.children[0].disparar('click');
  assert.equal(nodo.children[0].getAttribute('aria-pressed'), 'false');
  assert.equal(nodo.children[0].disabled, false);
  surte = true;
  nodo.children[0].disparar('click');
  assert.equal(nodo.children[0].getAttribute('aria-pressed'), 'true');
  b.destruir();
});
