// Tienda (tienda-ui.js): si falla la segunda escritura, la operación se deshace entera y el estado queda coherente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarTienda } from '../tienda-ui.js';
import { anadirObjeto, crearMochila, cargarMochila, guardarMochila, comprarTitulo } from '../mochila.js';
import { cargarOrdago, guardarOrdago, crearOrdago, conFondo, olvidarMemoria } from '../ordago.js';
import { ElementoFalso } from './dom-falso.js';
import { almacenFalso } from './almacen-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';

/** Busca por data-test en todo el árbol (la lista tiene grupos dentro de grupos). */
function buscar(nodo, id) {
  for (const hijo of nodo.children) {
    if (hijo.getAttribute('data-test') === id) return hijo;
    const dentro = buscar(hijo, id);
    if (dentro) return dentro;
  }
  return null;
}

function montar(almacen, { rng, ahora = () => 0 } = {}) {
  const raiz = new ElementoFalso('section');
  const nodos = {};
  for (const id of ['tienda-fondo', 'tienda-aviso', 'tienda-mochila', 'tienda-titulo-equipado']) nodos[id] = new ElementoFalso('div');
  raiz.querySelector = (sel) => nodos[/"(.+)"/.exec(sel)[1]] ?? null;
  const documento = { createElement: (t) => new ElementoFalso(t) };
  const gestos = [];
  const tienda = montarTienda(raiz, { documento, almacen, rng, pedirGesto: (g) => gestos.push(g), ahora, temporizador: temporizadorFalso() });
  const boton = (id) => buscar(nodos['tienda-mochila'], id);
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

// --- Tienda ampliada (plan v0.3.3) ---------------------------------------------------------------------------------

test('tres grupos en este orden: Comodines (6 objetos), Cofre y Títulos (5)', () => {
  const { nodos } = montar(almacenFalso());
  const grupos = nodos['tienda-mochila'].children;
  assert.deepEqual(grupos.map((g) => g.getAttribute('data-test')), ['tienda-grupo-comodines', 'tienda-grupo-cofre', 'tienda-grupo-titulos']);
  assert.deepEqual(grupos.map((g) => g.children[0].textContent), ['Comodines', 'Cofre', 'Títulos']);
  assert.deepEqual(grupos.map((g) => g.children[1].children.length), [6, 1, 5]);
});

test('el cofre enseña sus probabilidades, cobra 250 y anuncia el objeto con el gesto de acierto', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  const { boton, nodos, gestos } = montar(almacen, { rng: () => 0.3 }); // saltar
  assert.match(buscar(nodos['tienda-mochila'], 'tienda-cofre-probabilidades').textContent, /\+5 s 30 % · Saltar 25 % · 50\/50 20 % · Segunda oportunidad 15 % · Salvavidas 10 %/);
  boton('tienda-comprar-cofre').disparar('click');
  assert.equal(cargarOrdago(almacen).fondo, 750);
  assert.equal(cargarMochila(almacen).objetos.saltar, 1);
  assert.match(nodos['tienda-aviso'].textContent, /Cofre abierto: ⏭️ Saltar · −250/);
  assert.deepEqual(gestos, ['acierto']);
  olvidarMemoria();
});

test('el cofre se desactiva sin fondos', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  guardarOrdago(conFondo(crearOrdago(), 249), almacen);
  const { boton } = montar(almacen);
  assert.equal(boton('tienda-comprar-cofre').disabled, true);
  olvidarMemoria();
});

test('escudo: con 2 el botón de comprar se desactiva', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  guardarOrdago(conFondo(crearOrdago(), 5000), almacen);
  const { boton, nodos } = montar(almacen, { ahora: (() => { let t = 0; return () => (t += 1000); })() });
  assert.equal(buscar(nodos['tienda-mochila'], 'tienda-cantidad-escudo').textContent, 'Tienes 0');
  boton('tienda-comprar-escudo').disparar('click');
  boton('tienda-comprar-escudo').disparar('click');
  assert.equal(cargarMochila(almacen).objetos.escudo, 2);
  assert.equal(cargarOrdago(almacen).fondo, 3800);
  assert.equal(boton('tienda-comprar-escudo').disabled, true);
  boton('tienda-comprar-escudo').disparar('click'); // desactivado en pantalla, pero aunque llegara el toque
  assert.equal(cargarMochila(almacen).objetos.escudo, 2);
  olvidarMemoria();
});

test('títulos: Comprar · precio → Equipar → Equipado; se ve bajo el título de la Tienda y no se vende', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  const reloj = (() => { let t = 0; return () => (t += 1000); })();
  const { boton, nodos, gestos } = montar(almacen, { ahora: reloj });
  assert.equal(boton('tienda-titulo-erudito').textContent, 'Comprar · 500');
  assert.equal(nodos['tienda-titulo-equipado'].hidden, true);
  boton('tienda-titulo-erudito').disparar('click');
  assert.equal(cargarOrdago(almacen).fondo, 500);
  assert.deepEqual(cargarMochila(almacen).titulos, ['erudito']);
  assert.equal(cargarMochila(almacen).titulo, null); // comprar no equipa
  assert.equal(boton('tienda-titulo-erudito').textContent, 'Equipar');
  boton('tienda-titulo-erudito').disparar('click');
  assert.equal(cargarMochila(almacen).titulo, 'erudito');
  assert.equal(cargarOrdago(almacen).fondo, 500); // equipar es gratis
  assert.equal(boton('tienda-titulo-erudito').textContent, 'Equipado');
  assert.equal(boton('tienda-titulo-erudito').disabled, true);
  assert.equal(nodos['tienda-titulo-equipado'].hidden, false);
  assert.equal(nodos['tienda-titulo-equipado'].textContent, '📜 Erudito');
  assert.deepEqual(gestos, ['acierto']); // solo la compra celebra
  assert.equal(buscar(nodos['tienda-mochila'], 'tienda-vender-erudito'), null);
  olvidarMemoria();
});

test('título sin fondos: el botón está desactivado; Leyenda equipada se marca dorada', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  guardarOrdago(conFondo(crearOrdago(), 999), almacen);
  const { boton, nodos } = montar(almacen);
  assert.equal(boton('tienda-titulo-leyenda').disabled, true);
  assert.equal(boton('tienda-titulo-aprendiz').disabled, false);
  const dueno = comprarTitulo(crearMochila(), 5000, 'leyenda').mochila;
  guardarMochila({ ...dueno, titulo: 'leyenda' }, almacen);
  const otra = montar(almacen);
  assert.equal(otra.nodos['tienda-titulo-equipado'].classList.contains('titulo-equipado--leyenda'), true);
  assert.equal(nodos['tienda-titulo-equipado'].classList.contains('titulo-equipado--leyenda'), false);
  olvidarMemoria();
});

test('un doble toque en Comprar es una sola compra (antirrebote)', () => {
  olvidarMemoria();
  const almacen = almacenFalso();
  const { boton } = montar(almacen, { ahora: () => 10 });
  boton('tienda-comprar-mas5').disparar('click');
  boton('tienda-comprar-mas5').disparar('click');
  assert.equal(cargarMochila(almacen).objetos.mas5, 1);
  assert.equal(cargarOrdago(almacen).fondo, 800);
  olvidarMemoria();
});
