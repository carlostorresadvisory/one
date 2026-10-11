import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crearSaberMas, cerrarSaberMas, enlacesDe, posicionarPanel, promptPregunta, promptComparar, promptAfinar, MARGEN,
} from '../saber-mas.js';
import { ElementoFalso } from './dom-falso.js';

function entorno() {
  const doc = new ElementoFalso('document');
  doc.createElement = (t) => new ElementoFalso(t);
  doc.body = new ElementoFalso('body');
  doc.documentElement = new ElementoFalso('html');
  const temporizadores = [];
  const ventana = {
    setTimeout: (fn) => { temporizadores.push(fn); return temporizadores.length; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  return { doc, ventana, temporizadores };
}
const crear = (e, prompt = 'hola mundo?') => crearSaberMas({ prompt, documento: e.doc, ventana: e.ventana });

test('enlacesDe: tres destinos con el prompt codificado', () => {
  const [chatgpt, claude, gemini] = enlacesDe('¿a b?');
  assert.equal(chatgpt.href, 'https://chatgpt.com/?q=%C2%BFa%20b%3F');
  assert.equal(claude.href, 'https://claude.ai/new?q=%C2%BFa%20b%3F');
  assert.equal(gemini.href, 'https://www.google.com/search?udm=50&q=%C2%BFa%20b%3F');
});

test('cerrado: botón accesible y panel fuera del DOM', () => {
  const e = entorno();
  const s = crear(e);
  assert.equal(s.boton.getAttribute('aria-expanded'), 'false');
  assert.equal(s.boton.getAttribute('data-test'), 'saber-mas');
  assert.match(s.boton.getAttribute('aria-label'), /Saber más/);
  assert.equal(s.boton.getAttribute('aria-controls'), s.menu.getAttribute('id'));
  assert.equal(e.doc.body.children.length, 0);
});

test('tocar abre (panel en body, tres enlaces) y volver a tocar cierra', () => {
  const e = entorno();
  const s = crear(e);
  s.boton.disparar('click', { detail: 1 });
  assert.equal(s.boton.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(e.doc.body.children, [s.menu]);
  assert.equal(s.menu.children.length, 3);
  assert.deepEqual(s.menu.children.map((a) => a.getAttribute('data-test')), ['preguntar-chatgpt', 'preguntar-claude', 'preguntar-gemini']);
  for (const a of s.menu.children) {
    assert.equal(a.getAttribute('target'), '_blank');
    assert.equal(a.getAttribute('rel'), 'noopener');
  }
  s.boton.disparar('click', { detail: 1 });
  assert.equal(s.boton.getAttribute('aria-expanded'), 'false');
  assert.equal(e.doc.body.children.length, 0);
});

test('Escape cierra y devuelve el foco al botón', () => {
  const e = entorno();
  const s = crear(e);
  let foco = 0;
  s.boton.focus = () => { foco += 1; };
  s.boton.disparar('click', { detail: 1 });
  e.doc.disparar('keydown', { key: 'a' });
  assert.equal(s.estaAbierto(), true);
  e.doc.disparar('keydown', { key: 'Escape' });
  assert.equal(s.estaAbierto(), false);
  assert.equal(foco, 1);
});

test('con teclado (detail 0) el foco va al primer enlace', () => {
  const e = entorno();
  const s = crear(e);
  let foco = null;
  s.menu.children[0].focus = (op) => { foco = op; };
  s.boton.disparar('click', { detail: 0 });
  assert.deepEqual(foco, { preventScroll: true });
});

test('toque fuera: cierra y se consume; dentro no cierra', () => {
  const e = entorno();
  const s = crear(e);
  s.boton.disparar('click', { detail: 1 });
  let evitado = 0; let parado = 0;
  const evento = (target) => ({ target, preventDefault: () => { evitado += 1; }, stopPropagation: () => { parado += 1; } });
  e.doc.disparar('pointerdown', evento(s.menu));
  assert.equal(s.estaAbierto(), true);
  e.doc.disparar('pointerdown', evento(new ElementoFalso('button')));
  assert.equal(s.estaAbierto(), false);
  assert.equal(evitado, 1);
  assert.equal(parado, 1);
  // el click que sigue al toque se traga, y solo uno
  evitado = 0;
  e.doc.disparar('click', evento(new ElementoFalso('button')));
  assert.equal(evitado, 1);
  evitado = 0;
  e.doc.disparar('click', evento(new ElementoFalso('button')));
  assert.equal(evitado, 0);
});

test('un solo panel abierto a la vez', () => {
  const e = entorno();
  const a = crear(e, 'uno');
  const b = crear(e, 'dos');
  a.boton.disparar('click', { detail: 1 });
  b.boton.disparar('click', { detail: 1 });
  assert.equal(a.estaAbierto(), false);
  assert.equal(b.estaAbierto(), true);
  assert.deepEqual(e.doc.body.children, [b.menu]);
  cerrarSaberMas();
  assert.equal(b.estaAbierto(), false);
});

test('elegir una opción cierra tras la navegación', () => {
  const e = entorno();
  const s = crear(e);
  s.boton.disparar('click', { detail: 1 });
  s.menu.children[1].disparar('click');
  assert.equal(s.estaAbierto(), true);
  e.temporizadores.forEach((fn) => fn());
  assert.equal(s.estaAbierto(), false);
});

test('cerrar suelta los oyentes del documento', () => {
  const e = entorno();
  const s = crear(e);
  s.boton.disparar('click', { detail: 1 });
  assert.equal(e.doc._oyentes.pointerdown.length, 1);
  s.cerrar();
  assert.equal(e.doc._oyentes.pointerdown.length, 0);
  assert.equal(e.doc._oyentes.keydown.length, 0);
});

test('posicionarPanel: abajo si cabe con margen, arriba si no, y sin salirse por los lados', () => {
  const zona = { arriba: 0, abajo: 667, izquierda: 0, derecha: 375 };
  const panel = { ancho: 160, alto: 130 };
  const abajo = posicionarPanel({ top: 300, bottom: 344, left: 20 }, panel, zona);
  assert.equal(abajo.hacia, 'abajo');
  assert.equal(abajo.top, 348);
  const arriba = posicionarPanel({ top: 500, bottom: 544, left: 20 }, panel, zona);
  assert.equal(arriba.hacia, 'arriba');
  assert.ok(arriba.top + panel.alto <= 500);
  assert.ok(arriba.top >= MARGEN);
  const derecha = posicionarPanel({ top: 100, bottom: 144, left: 340 }, panel, zona);
  assert.equal(derecha.left, 375 - MARGEN - 160);
  assert.equal(posicionarPanel({ top: 100, bottom: 144, left: 0 }, panel, zona).left, MARGEN);
});

test('promptPregunta: enunciado, respuesta y explicación', () => {
  const p = promptPregunta({ tipo: 'vf', enunciado: '¿Roma?', respuesta: true, explicacion: 'Sí.' });
  assert.match(p, /Pregunta: «¿Roma\?»\. Respuesta correcta: «Verdadero»\. Explicación que me dio la app: «Sí\.»/);
});

const everest = { categoria: 'altitud-montana', unidad: 'm', nombre: 'Everest', valor: 8849, fecha: '2025-01-01' };
const k2 = { categoria: 'altitud-montana', unidad: 'm', nombre: 'K2', valor: 8611, fecha: '2025-01-01' };

test('promptComparar: las dos cifras con unidad y año del dato', () => {
  const p = promptComparar(everest, k2);
  assert.match(p, /Comparación: Everest \(8\.849 m, dato de 2025\) frente a K2 \(8\.611 m, dato de 2025\)\./);
  assert.match(p, /por qué hay tanta diferencia/);
});

test('promptAfinar: cifra, estimación y valor real; con fechas, años', () => {
  const p = promptAfinar(everest, 5000);
  assert.match(p, /Mi estimación: 5\.000 m; el valor real: 8\.849 m\./);
  const f = promptAfinar({ categoria: 'ano-hecho', unidad: 'año', nombre: 'Caída de Roma', valor: 476 }, 500);
  assert.match(f, /Caída de Roma \(año 476\)/);
  assert.match(f, /Mi estimación: 500; el valor real: 476\./);
});
