// Tests de la tercera capa de visual (spec v0.2 §8, tarea 1 de v0.2a.2): la
// tarjeta tipográfica que la app dibuja sola, sin modelo ni red, para
// garantizar que el 100% de las preguntas tengan visual.
//
// `textoVisualClave` es la parte PURA (solo texto, sin DOM) -- se prueba
// entera aquí con node:test, con ejemplos reales de datos/banco.json para
// los 4 tipos. `construirVisualClave` (DOM, crea el SVG) no tiene DOM falso
// disponible en este repo (a diferencia de otros ficheros, tests/visuales.js
// no monta un DOM de mentira -- construirVisual ya se deja sin probar aquí
// por el mismo motivo, ver cabecera de tests/visuales.test.js): queda
// verificada por el e2e de la Tarea 2 (Playwright, DOM real de navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textoVisualClave } from '../visuales.js';

async function cargarPorId(id) {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  const pregunta = preguntas.find((p) => p.id === id);
  assert.ok(pregunta, `no se encontró ${id} en datos/banco.json`);
  return pregunta;
}

test('textoVisualClave: test4 -- principal es el texto de la opción correcta, secundario la primera frase', async () => {
  const p1 = await cargarPorId('art-009'); // opciones[0] = "La última cena", correcta = 0
  assert.deepEqual(textoVisualClave(p1), {
    principal: 'La última cena',
    secundario: '¿Cuál de las siguientes obras es de Leonardo da Vinci?',
    area: 'arte',
  });

  const p2 = await cargarPorId('art-010'); // opciones[0] = "Veladura", correcta = 0, enunciado largo sin "." intermedio
  const r2 = textoVisualClave(p2);
  assert.equal(r2.principal, 'Veladura');
  assert.equal(r2.area, 'arte');
  // Único terminador de frase (.?!) es el "?" final, a 118 caracteres: se recorta a <=90 con "…".
  assert.equal(r2.secundario, '¿Qué técnica pictórica consiste en aplicar capas transparentes de pintura sobre una capa…');
  assert.ok(r2.secundario.length <= 90);
});

test('textoVisualClave: error -- principal es la etiqueta de la fila sospechosa (tarjeta.filas[sospechoso].etiqueta)', async () => {
  const p1 = await cargarPorId('art-030'); // sospechoso = 1 -> "La Noche Estrellada"
  assert.deepEqual(textoVisualClave(p1), {
    principal: 'La Noche Estrellada',
    secundario: 'Encuentra el dato erróneo en la tarjeta.',
    area: 'arte',
  });

  const p2 = await cargarPorId('art-031'); // sospechoso = 3 -> "Moisés"
  assert.deepEqual(textoVisualClave(p2), {
    principal: 'Moisés',
    secundario: 'Encuentra el dato erróneo en la tarjeta.',
    area: 'arte',
  });
});

test('textoVisualClave: ordenar -- principal es "<primero> → <último>" del orden correcto (items ya viene en orden), sin secundario', async () => {
  const p1 = await cargarPorId('art-085');
  assert.deepEqual(textoVisualClave(p1), {
    principal: 'Las Meninas (Diego Velázquez) → Guernica (Pablo Picasso)',
    secundario: undefined,
    area: 'arte',
  });

  const p2 = await cargarPorId('art-086');
  assert.deepEqual(textoVisualClave(p2), {
    principal: 'Renacimiento → Arte contemporáneo',
    secundario: undefined,
    area: 'arte',
  });
});

test('textoVisualClave: ordenar -- funciona con 2 y con 5 ítems (primero y último del array, no del tamaño fijo del banco)', () => {
  const con2 = textoVisualClave({ tipo: 'ordenar', area: 'ciencia', items: ['Primero', 'Segundo'] });
  assert.equal(con2.principal, 'Primero → Segundo');

  const con5 = textoVisualClave({
    tipo: 'ordenar',
    area: 'ciencia',
    items: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'],
  });
  assert.equal(con5.principal, 'Uno → Cinco');
});

test('textoVisualClave: vf -- principal "Cierto"/"Falso" según la respuesta correcta, secundario la primera frase', async () => {
  const pCierto = await cargarPorId('art-001'); // respuesta: true
  assert.deepEqual(textoVisualClave(pCierto), {
    principal: 'Cierto',
    secundario: 'La Mona Lisa fue pintada por Leonardo da Vinci.',
    area: 'arte',
  });

  const pFalso = await cargarPorId('art-002'); // respuesta: false
  assert.deepEqual(textoVisualClave(pFalso), {
    principal: 'Falso',
    secundario: 'El movimiento impresionista se originó en Italia a finales del siglo XIX.',
    area: 'arte',
  });
});

test('textoVisualClave: primera frase se corta en el primer "." "?" o "!" -- nunca coge la segunda frase', () => {
  const r = textoVisualClave({
    tipo: 'vf',
    area: 'ciencia',
    respuesta: true,
    enunciado: 'Primera frase corta. Segunda frase que no debería aparecer nunca.',
  });
  assert.equal(r.secundario, 'Primera frase corta.');
});

test('textoVisualClave: enunciado sin puntuación de cierre -- se recorta a máximo 90 caracteres con "…"', () => {
  const enunciadoLargo =
    'Un enunciado deliberadamente largo y sin ningún punto interrogación ni exclamación que sirva de cierre de frase para forzar el recorte por longitud máxima';
  assert.ok(enunciadoLargo.length > 90);
  const r = textoVisualClave({ tipo: 'test4', area: 'ciencia', opciones: ['A', 'B', 'C', 'D'], correcta: 0, enunciado: enunciadoLargo });
  assert.ok(r.secundario.length <= 90);
  assert.ok(r.secundario.endsWith('…'));
  assert.equal(r.secundario, `${enunciadoLargo.slice(0, 89).trimEnd()}…`);
});

test('textoVisualClave: enunciado corto sin puntuación se devuelve entero, sin "…" (no hace falta recortar)', () => {
  const r = textoVisualClave({ tipo: 'vf', area: 'arte', respuesta: false, enunciado: 'Enunciado corto sin cierre' });
  assert.equal(r.secundario, 'Enunciado corto sin cierre');
});

test('textoVisualClave: pregunta rota -- test4 sin opciones da principal vacío, sin lanzar', () => {
  assert.doesNotThrow(() => {
    const r = textoVisualClave({ tipo: 'test4', area: 'arte', enunciado: 'Algo.' });
    assert.equal(r.principal, '');
    assert.equal(r.area, 'arte');
  });
});

test('textoVisualClave: pregunta rota -- correcta fuera de rango, opciones no es array, error sin tarjeta, ordenar sin items, vf sin respuesta booleana: principal vacío, sin lanzar', () => {
  assert.doesNotThrow(() => {
    assert.equal(textoVisualClave({ tipo: 'test4', opciones: ['A', 'B'], correcta: 5 }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'test4', opciones: 'no es array', correcta: 0 }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'error', sospechoso: 0 }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'error', tarjeta: { filas: [] }, sospechoso: 0 }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'ordenar' }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'ordenar', items: [] }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'vf' }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'vf', respuesta: 'sí' }).principal, '');
  });
});

test('textoVisualClave: nunca lanza con entradas completamente inválidas (null, undefined, sin tipo, tipo desconocido)', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(textoVisualClave(null), { principal: '' });
    assert.deepEqual(textoVisualClave(undefined), { principal: '' });
    assert.deepEqual(textoVisualClave('texto'), { principal: '' });
    assert.equal(textoVisualClave({}).principal, '');
    assert.equal(textoVisualClave({ tipo: 'inventado', area: 'arte' }).principal, '');
    assert.equal(textoVisualClave({ tipo: 'inventado', area: 'arte' }).area, 'arte');
  });
});
