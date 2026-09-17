// Tests de la parte PURA de la tercera capa de visual (spec v0.2a.2.1 §1.3): la tarjeta tipográfica
// que la app dibuja sola, sin modelo ni red, para garantizar que el 100% de las preguntas tengan
// visual. `modeloVisualClave` no toca el DOM (se prueba con node:test); `construirVisualClave`
// (Tarea 2) decide el HTML por tipo a partir de este modelo. Los ejemplos salen del banco real
// (datos/banco.json) para no inventar formas que el pipeline nunca produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modeloVisualClave } from '../visuales.js';

async function cargarPorId(id) {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  const pregunta = preguntas.find((p) => p.id === id);
  assert.ok(pregunta, `no se encontró ${id} en datos/banco.json`);
  return pregunta;
}

test('modeloVisualClave: ordenar -- lista COMPLETA en el orden correcto (eco-089, la captura del iPhone)', async () => {
  const p = await cargarPorId('eco-089');
  const m = modeloVisualClave(p);
  assert.equal(m.tipo, 'ordenar');
  assert.equal(m.titulo, 'Orden correcto');
  assert.equal(m.area, 'economia');
  // `items` ya viene en el orden correcto en el banco (motor.js#evaluar usa
  // items.map((_, i) => i) como objetivo): se devuelven TODOS, no el
  // "primero → último" de v0.2a.2 que Carlos calificó de "muy mala".
  assert.deepEqual(m.items, [
    'Salarios nominales',
    'Tipos de interés oficiales',
    'Precios de consumo',
    'Expectativas de inflación',
  ]);
});

test('modeloVisualClave: error -- etiqueta + valor de la fila sospechosa, sin corrección separada en el banco', async () => {
  const p = await cargarPorId('art-030'); // sospechoso: 1 -> "La Noche Estrellada" / "Pablo Picasso"
  const m = modeloVisualClave(p);
  assert.equal(m.tipo, 'error');
  assert.equal(m.titulo, 'Dato erróneo');
  assert.equal(m.etiqueta, 'La Noche Estrellada');
  assert.equal(m.valorErroneo, 'Pablo Picasso');
  assert.equal(m.valorCorrecto, ''); // ninguna de las 40 preguntas `error` del banco la trae
});

test('modeloVisualClave: error -- si la fila trae `correcto`, se devuelve como valorCorrecto', () => {
  const m = modeloVisualClave({
    tipo: 'error',
    area: 'ciencia',
    sospechoso: 0,
    tarjeta: { titulo: 'T', filas: [{ etiqueta: 'Agua', valor: 'Hierve a 50 °C', correcto: 'Hierve a 100 °C' }] },
  });
  assert.equal(m.valorErroneo, 'Hierve a 50 °C');
  assert.equal(m.valorCorrecto, 'Hierve a 100 °C');
});

test('modeloVisualClave: test4 -- correcta + las tres descartadas en el orden del banco', async () => {
  const p = await cargarPorId('art-011');
  const m = modeloVisualClave(p);
  assert.equal(m.tipo, 'test4');
  assert.equal(m.correcta, 'Joseph Kosuth');
  assert.deepEqual(m.descartadas, ['Marcel Duchamp', 'Sol LeWitt', 'Lawrence Weiner']);
});

test('modeloVisualClave: vf -- veredicto Cierto/Falso y la primera frase del enunciado', () => {
  const cierto = modeloVisualClave({ tipo: 'vf', area: 'arte', respuesta: true, enunciado: 'El Prado está en Madrid. Se fundó en 1819.' });
  assert.equal(cierto.veredicto, 'Cierto');
  assert.equal(cierto.frase, 'El Prado está en Madrid.');
  const falso = modeloVisualClave({ tipo: 'vf', area: 'arte', respuesta: false, enunciado: 'Sin puntuación de cierre' });
  assert.equal(falso.veredicto, 'Falso');
  assert.equal(falso.frase, 'Sin puntuación de cierre');
});

test('modeloVisualClave: un punto de miles ("1.000") no corta la frase (I3, heredado de primeraFrase)', () => {
  const m = modeloVisualClave({
    tipo: 'vf',
    area: 'ciencia',
    respuesta: true,
    enunciado: 'Afecta a 1 de cada 1.000 personas. Existe tratamiento.',
  });
  assert.equal(m.frase, 'Afecta a 1 de cada 1.000 personas.');
});

test('modeloVisualClave: tipo desconocido y entradas rotas -- nunca lanza, devuelve tipo "desconocido" conservando el área', () => {
  assert.doesNotThrow(() => {
    assert.equal(modeloVisualClave(null).tipo, 'desconocido');
    assert.equal(modeloVisualClave(undefined).tipo, 'desconocido');
    assert.equal(modeloVisualClave('texto').tipo, 'desconocido');
    assert.equal(modeloVisualClave({}).tipo, 'desconocido');
    assert.equal(modeloVisualClave({ tipo: 'inventado', area: 'arte' }).area, 'arte');
    assert.equal(modeloVisualClave({ tipo: 'test4', opciones: 'no es array', correcta: 0 }).tipo, 'desconocido');
    assert.equal(modeloVisualClave({ tipo: 'test4', opciones: ['A', 'B'], correcta: 9 }).tipo, 'desconocido');
    assert.equal(modeloVisualClave({ tipo: 'error', sospechoso: 0 }).tipo, 'desconocido');
    assert.equal(modeloVisualClave({ tipo: 'error', tarjeta: { filas: [] }, sospechoso: 0 }).tipo, 'desconocido');
    assert.equal(modeloVisualClave({ tipo: 'ordenar', items: [] }).tipo, 'desconocido');
    assert.equal(modeloVisualClave({ tipo: 'vf', respuesta: 'sí' }).tipo, 'desconocido');
  });
});

test('modeloVisualClave: ordenar con 2 y con 6 ítems -- devuelve todos, sin tope artificial', () => {
  const dos = modeloVisualClave({ tipo: 'ordenar', area: 'ciencia', items: ['Primero', 'Segundo'] });
  assert.equal(dos.items.length, 2);
  const seis = modeloVisualClave({ tipo: 'ordenar', area: 'ciencia', items: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.equal(seis.items.length, 6);
});
