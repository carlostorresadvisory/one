// Tienda (tienda-ui.js): si falla la segunda escritura, la operación se deshace entera y el estado queda coherente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarTienda } from '../tienda-ui.js';
import { anadirObjeto, crearMochila, cargarMochila, guardarMochila } from '../mochila.js';
import { cargarOrdago, guardarOrdago, crearOrdago, olvidarMemoria } from '../ordago.js';
import { ElementoFalso } from './dom-falso.js';
import { almacenFalso } from './almacen-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';

function montar(almacen) {
  const raiz = new ElementoFalso('section');
  const nodos = {};
  for (const id of ['tienda-fondo', 'tienda-aviso', 'tienda-mochila']) nodos[id] = new ElementoFalso('div');
  raiz.querySelector = (sel) => nodos[/"(.+)"/.exec(sel)[1]] ?? null;
  const documento = { createElement: (t) => new ElementoFalso(t) };
  const gestos = [];
  const tienda = montarTienda(raiz, { documento, almacen, pedirGesto: (g) => gestos.push(g), ahora: () => 0, temporizador: temporizadorFalso() });
  const boton = (id) => nodos['tienda-mochila'].children.flatMap((f) => f.children[1].children).find((b) => b.getAttribute('data-test') === id);
  return { tienda, nodos, boton, gestos };
}

test('comprar con las dos escrituras bien: descuenta fondo y suma objeto', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  const { boton } = montar(almacen);
  boton('tienda-comprar-mas5').disparar('click');
  assert.equal(cargarOrdago(almacen).fondo, 800);
  assert.equal(cargarMochila(almacen).objetos.mas5, 1);
  olvidarMemoria();
});

test('si falla la escritura de Órdago tras guardar la mochila, se deshace la mochila y todo queda como estaba', () => {
  olvidarMemoria();
  const base = almacenFalso();
  guardarOrdago(crearOrdago(), base);
  guardarMochila(anadirObjeto(crearMochila(), 'salvavidas'), base);
  let escrituras = 0;
  const almacen = { getItem: (k) => base.getItem(k), removeItem: (k) => base.removeItem(k),
    setItem: (k, v) => { escrituras += 1; if (escrituras === 2) throw new Error('cuota'); base.setItem(k, v); } };
  const { boton, nodos, gestos } = montar(almacen);
  boton('tienda-vender-salvavidas').disparar('click'); // 1.ª escritura (mochila) bien, 2.ª (Órdago) lanza
  assert.equal(cargarMochila(almacen).objetos.salvavidas, 1, 'la mochila vuelve a como estaba');
  assert.equal(cargarOrdago(almacen).fondo, 1000, 'el fondo no cambia');
  assert.match(nodos['tienda-aviso'].textContent, /No se pudo guardar/);
  assert.deepEqual(gestos, []);
  olvidarMemoria();
});
