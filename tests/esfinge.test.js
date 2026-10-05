// Tests de esfinge.js (spec v0.3 §7): DOM falso + reloj manual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEsfinge, EXPRESIONES, ANCLAJES, MS_REACCION, bocaPara, siguienteParpadeoMs } from '../esfinge.js';
import { ElementoFalso, instalarDomFalso } from './dom-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';

function buscarAnclaje(nodo, nombre) {
  for (const hijo of nodo.children || []) {
    if (hijo.getAttribute && hijo.getAttribute('data-anclaje') === nombre) return hijo;
    const dentro = buscarAnclaje(hijo, nombre);
    if (dentro) return dentro;
  }
  return null;
}

function montar(opciones = {}) {
  const desinstalar = instalarDomFalso();
  const contenedor = new ElementoFalso('div');
  const temporizador = temporizadorFalso();
  const esfinge = crearEsfinge(contenedor, { temporizador, rng: () => 0, ...opciones });
  return { desinstalar, contenedor, temporizador, esfinge };
}

test('crea un svg en el contenedor, neutral, con su tamaño', (t) => {
  const { desinstalar, contenedor, esfinge } = montar({ tamano: 'grande' });
  t.after(desinstalar);
  assert.equal(contenedor.children.length, 1);
  assert.equal(esfinge.nodo.tagName, 'svg');
  assert.equal(esfinge.nodo.getAttribute('viewBox'), '0 0 100 100');
  assert.equal(esfinge.expresion(), 'neutral');
  assert.ok(esfinge.nodo.classList.contains('esfinge--grande'));
  assert.ok(esfinge.nodo.classList.contains('esfinge--neutral'));
});

test('tiene los tres anclajes para accesorios futuros', (t) => {
  const { desinstalar, esfinge } = montar();
  t.after(desinstalar);
  for (const nombre of ANCLAJES) assert.ok(buscarAnclaje(esfinge.nodo, nombre), `falta ${nombre}`);
});

test('reaccionar cambia expresión, clase y boca, y vuelve sola a neutral', (t) => {
  const { desinstalar, esfinge, temporizador } = montar();
  t.after(desinstalar);
  esfinge.reaccionar('triste');
  assert.equal(esfinge.expresion(), 'triste');
  assert.ok(esfinge.nodo.classList.contains('esfinge--triste'));
  assert.ok(!esfinge.nodo.classList.contains('esfinge--neutral'));
  temporizador.avanzar(MS_REACCION);
  assert.equal(esfinge.expresion(), 'neutral');
});

test('una reacción nueva reinicia la vuelta a neutral', (t) => {
  const { desinstalar, esfinge, temporizador } = montar();
  t.after(desinstalar);
  esfinge.reaccionar('contenta');
  temporizador.avanzar(MS_REACCION - 100);
  esfinge.reaccionar('euforica');
  temporizador.avanzar(200);
  assert.equal(esfinge.expresion(), 'euforica');
  temporizador.avanzar(MS_REACCION);
  assert.equal(esfinge.expresion(), 'neutral');
});

test('una expresión desconocida cae a neutral', (t) => {
  const { desinstalar, esfinge } = montar();
  t.after(desinstalar);
  esfinge.reaccionar('furiosa');
  assert.equal(esfinge.expresion(), 'neutral');
});

test('parpadea sola: cierra los ojos y los vuelve a abrir', (t) => {
  const { desinstalar, esfinge, temporizador } = montar();
  t.after(desinstalar);
  const ojos = buscarAnclaje(esfinge.nodo, 'ojos');
  temporizador.avanzar(siguienteParpadeoMs(() => 0));
  assert.ok(ojos.classList.contains('esfinge-ojos--cerrados'));
  temporizador.avanzar(140);
  assert.ok(!ojos.classList.contains('esfinge-ojos--cerrados'));
  assert.ok(temporizador.pendientes() >= 1); // ya hay programado el siguiente parpadeo
});

test('destruir quita el svg y cancela todos los temporizadores', (t) => {
  const { desinstalar, contenedor, esfinge, temporizador } = montar();
  t.after(desinstalar);
  esfinge.reaccionar('contenta');
  esfinge.destruir();
  assert.equal(contenedor.children.length, 0);
  assert.equal(temporizador.pendientes(), 0);
  esfinge.reaccionar('triste'); // tras destruir no hace nada ni lanza
});

test('bocaPara: una boca distinta por expresión; desconocida = neutral', () => {
  const bocas = EXPRESIONES.map(bocaPara);
  assert.equal(new Set(bocas).size, 4);
  assert.equal(bocaPara('x'), bocaPara('neutral'));
});

test('siguienteParpadeoMs entre 2,5 y 6 s', () => {
  assert.equal(siguienteParpadeoMs(() => 0), 2500);
  assert.ok(siguienteParpadeoMs(() => 0.999) < 6000);
});
