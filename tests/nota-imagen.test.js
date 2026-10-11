// Nota de calidad de imagen (tools/nota-imagen.js): sin red, con un modelo falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_NOTA, MODELOS_VISION, parsearNota, esBuena, puntuarImagen } from '../tools/nota-imagen.js';

test('parsearNota: JSON, texto libre y basura', () => {
  assert.deepEqual(parsearNota('{"nota":4,"motivo":"ok"}'), { nota: 4, motivo: 'ok' });
  assert.equal(parsearNota('Nota: 2 porque está borrosa').nota, 2);
  assert.equal(parsearNota('```json\n{"nota": 5, "motivo": "protagonista claro"}\n```').nota, 5);
  assert.equal(parsearNota('7'), null);
  assert.equal(parsearNota('{"nota":0}'), null);
  assert.equal(parsearNota(''), null);
  assert.equal(parsearNota(null), null);
});

test('esBuena: 4 o más', () => {
  assert.equal(esBuena(3), false);
  assert.equal(esBuena(4), true);
  assert.equal(esBuena(5), true);
  assert.equal(esBuena(null), false);
});

test('PROMPT_NOTA fija el criterio de la spec', () => {
  for (const clave of [/protagonista/i, /color/i, /encuadre/i, /mapa/i, /escane/i, /borros/i, /revel/i]) {
    assert.match(PROMPT_NOTA, clave);
  }
  assert.ok(MODELOS_VISION.length >= 3);
});

test('puntuarImagen: si el primer modelo falla usa el segundo', async () => {
  const llamados = [];
  const llamarModelo = async ({ modelo }) => {
    llamados.push(modelo);
    if (llamados.length === 1) throw new Error('429');
    return '{"nota":4,"motivo":"buena"}';
  };
  const r = await puntuarImagen({ url: 'https://x/y.jpg', pregunta: { enunciado: '¿Quién?' } }, { llamarModelo, modelos: ['a', 'b', 'c'] });
  assert.deepEqual(r, { nota: 4, motivo: 'buena', modelo: 'b' });
  assert.deepEqual(llamados, ['a', 'b']);
});

test('puntuarImagen: respuesta ilegible pasa al siguiente; todos fallan -> null', async () => {
  let n = 0;
  const r = await puntuarImagen({ url: 'u', pregunta: 'q' }, { llamarModelo: async () => (++n === 1 ? 'no sé' : '{"nota":2,"motivo":"x"}'), modelos: ['a', 'b'] });
  assert.equal(r.modelo, 'b');
  const nada = await puntuarImagen({ url: 'u', pregunta: 'q' }, { llamarModelo: async () => { throw new Error('x'); }, modelos: ['a', 'b'] });
  assert.equal(nada, null);
});

test('puntuarImagen: el mensaje lleva la imagen y el enunciado', async () => {
  let visto;
  await puntuarImagen({ url: 'https://x/y.jpg', pregunta: { enunciado: '¿Dónde está la Mona Lisa?', explicacion: 'En el Louvre' } }, {
    llamarModelo: async (p) => { visto = p; return '{"nota":3,"motivo":"m"}'; },
    modelos: ['a'],
  });
  const partes = visto.mensajes.at(-1).content;
  assert.ok(partes.some((p) => p.type === 'image_url' && p.image_url.url === 'https://x/y.jpg'));
  assert.ok(partes.some((p) => p.type === 'text' && p.text.includes('Mona Lisa')));
});
