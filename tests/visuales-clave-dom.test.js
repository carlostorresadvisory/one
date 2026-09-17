// Tests de la mitad DOM de la tercera capa (`construirVisualClave`), v0.2a.2.1 §1.3: desde la
// Tarea 2, `construirVisualClave` ya no dibuja el SVG de v0.2a.2 -- construye un bloque HTML por
// tipo (`ordenar`/`error`/`test4`/`vf`/desconocido) a partir del modelo puro de `modeloVisualClave`
// (Tarea 1, probado aparte en `visuales-clave.test.js`, sin DOM). Aquí solo se prueba la mitad DOM:
// que el HTML resultante tenga los nodos, clases y textos correctos para cada tipo. El DOM falso
// (`tests/dom-falso.js`) se instala SOLO dentro de cada test (nunca a nivel de módulo) para no
// filtrar un `document` de mentira al resto de la suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instalarDomFalso } from './dom-falso.js';
import { construirVisualClave } from '../visuales.js';

const NOMBRES_AREA = {
  economia: 'Economía', historia: 'Historia', ciencia: 'Ciencia', tecnologia: 'Tecnología',
  geografia: 'Geografía', filosofia: 'Filosofía', arte: 'Arte', logica: 'Lógica',
};
function nombreArea(area) {
  return NOMBRES_AREA[area] || (area ? area.charAt(0).toUpperCase() + area.slice(1) : '');
}

async function cargarPorId(id) {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  const pregunta = preguntas.find((p) => p.id === id);
  assert.ok(pregunta, `no se encontró ${id} en datos/banco.json`);
  return pregunta;
}

function conDom(fn) {
  const desinstalar = instalarDomFalso();
  try { return fn(); } finally { desinstalar(); }
}

test('construirVisualClave: ordenar -- lista numerada COMPLETA, con su título y el área', async () => {
  const p = await cargarPorId('eco-089');
  const caja = conDom(() => construirVisualClave(p, { nombreArea }));
  assert.equal(caja.tagName, 'div');
  assert.equal(caja.dataset.test, 'visual-clave');
  assert.ok(caja.classList.contains('visual-clave--ordenar'));
  const items = caja.buscarTodosPorClase('visual-clave-item');
  assert.equal(items.length, 4);
  assert.equal(items[0].textContent, 'Salarios nominales');
  assert.equal(items[3].textContent, 'Expectativas de inflación');
  assert.equal(caja.buscarPorClase('visual-clave-titulo').textContent, 'Orden correcto');
  assert.equal(caja.buscarPorClase('visual-clave-area').textContent, 'ECONOMÍA');
  assert.equal(caja.getAttribute('role'), 'img');
  assert.match(caja.getAttribute('aria-label'), /Orden correcto/);
});

test('construirVisualClave: test4 -- la correcta grande y las tres descartadas apagadas', async () => {
  const p = await cargarPorId('art-011');
  const caja = conDom(() => construirVisualClave(p, { nombreArea }));
  assert.equal(caja.buscarPorClase('visual-clave-correcta').textContent, 'Joseph Kosuth');
  assert.equal(caja.buscarTodosPorClase('visual-clave-descartada').length, 3);
});

test('construirVisualClave: error -- etiqueta + valor; sin corrección no se tacha nada', async () => {
  const p = await cargarPorId('art-030');
  const caja = conDom(() => construirVisualClave(p, { nombreArea }));
  assert.equal(caja.buscarPorClase('visual-clave-titulo').textContent, 'Dato erróneo');
  assert.equal(caja.buscarPorClase('visual-clave-etiqueta').textContent, 'La Noche Estrellada');
  assert.equal(caja.buscarPorClase('visual-clave-valor').textContent, 'Pablo Picasso');
  assert.equal(caja.buscarPorClase('visual-clave-valor').tagName, 'p'); // no <s>: no hay valor correcto que poner al lado
  assert.equal(caja.buscarPorClase('visual-clave-correccion'), null);
});

test('construirVisualClave: error CON corrección -- valor erróneo en <s> y el correcto al lado', () => {
  const caja = conDom(() => construirVisualClave({
    tipo: 'error', area: 'ciencia', sospechoso: 0,
    tarjeta: { titulo: 'T', filas: [{ etiqueta: 'Agua', valor: 'Hierve a 50 °C', correcto: 'Hierve a 100 °C' }] },
  }, { nombreArea }));
  assert.equal(caja.buscarPorClase('visual-clave-valor').tagName, 's');
  assert.equal(caja.buscarPorClase('visual-clave-correccion').textContent, 'Hierve a 100 °C');
});

test('construirVisualClave: vf -- veredicto grande con su clase de color y la frase debajo', () => {
  const caja = conDom(() => construirVisualClave(
    { tipo: 'vf', area: 'arte', respuesta: false, enunciado: 'El Prado está en Sevilla. Se fundó en 1819.' },
    { nombreArea }
  ));
  const veredicto = caja.buscarPorClase('visual-clave-veredicto');
  assert.equal(veredicto.textContent, 'Falso');
  assert.ok(veredicto.classList.contains('visual-clave-veredicto--falso'));
  assert.equal(caja.buscarPorClase('visual-clave-frase').textContent, 'El Prado está en Sevilla.');
});

test('construirVisualClave: tipo desconocido -- solo el área, nunca lanza', () => {
  const caja = conDom(() => construirVisualClave({ tipo: 'inventado', area: 'logica' }, { nombreArea }));
  assert.equal(caja.buscarPorClase('visual-clave-area').textContent, 'LÓGICA');
  assert.equal(caja.buscarPorClase('visual-clave-cuerpo').children.length, 0);
});

test('construirVisualClave: entradas rotas y `nombreArea` que lanza -- devuelve bloque mínimo sin propagar el error', () => {
  conDom(() => {
    assert.doesNotThrow(() => {
      assert.equal(construirVisualClave(null).dataset.test, 'visual-clave');
      assert.equal(construirVisualClave(undefined).dataset.test, 'visual-clave');
      const rota = construirVisualClave({ tipo: 'test4', area: 'arte', opciones: null }, {
        nombreArea: () => { throw new Error('nombreArea rota'); },
      });
      assert.equal(rota.dataset.test, 'visual-clave');
    });
  });
});

// Ronda de corrección 1 (IMPORTANT): la suite de v0.2a.2 barría las 295 preguntas reales del banco
// comprobando que construirVisualClave nunca lanza; al reescribir este fichero contra el HTML nuevo
// ese barrido se perdió sin sustituto. Lo repone: recorre TODO datos/banco.json (nunca lanza) y,
// además, para las preguntas de un tipo CONOCIDO (ordenar/error/test4/vf) comprueba que el cuerpo
// tiene contenido real -- las cuatro ramas de construirVisualClave siempre añaden al menos un hijo a
// `.visual-clave-cuerpo` cuando el modelo resuelve a su tipo, así que un cuerpo vacío ahí solo puede
// significar que modeloVisualClave degradó en silencio a "desconocido" (datos del banco que no
// encajan con la forma que su propio `tipo` promete) -- justo lo que este test quiere pillar.
test('construirVisualClave: barrido de las 295 preguntas reales del banco -- nunca lanza, y las de tipo conocido nunca degradan a "solo área"', async () => {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  assert.ok(preguntas.length >= 200, 'sanity: debería haber cargado el banco real, no un stub vacío');

  const TIPOS_CONOCIDOS = ['ordenar', 'error', 'test4', 'vf'];
  const degradadas = [];
  conDom(() => {
    for (const pregunta of preguntas) {
      let caja;
      assert.doesNotThrow(() => {
        caja = construirVisualClave(pregunta, { nombreArea });
      }, `construirVisualClave lanzó con ${pregunta.id}`);
      assert.equal(caja.dataset.test, 'visual-clave', `sin data-test="visual-clave" en ${pregunta.id}`);
      if (TIPOS_CONOCIDOS.includes(pregunta.tipo)) {
        const cuerpo = caja.buscarPorClase('visual-clave-cuerpo');
        if (!cuerpo || cuerpo.children.length === 0) degradadas.push(pregunta.id);
      }
    }
  });
  assert.deepEqual(
    degradadas, [],
    `${degradadas.length} pregunta(s) de tipo conocido degradaron a "solo área": ${degradadas.join(', ')}`
  );
});
