// Nota de calidad de imagen (tools/nota-imagen.js): sin red, con un modelo falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROMPT_NOTA, MODELOS_VISION, MODELO_VISION_PAGO, parsearNota, esBuena, puntuarImagen } from '../tools/nota-imagen.js';

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

test('PROMPT_NOTA penaliza capturas de web, texto/logos e imágenes que muestran la respuesta (máx. 2)', () => {
  for (const clave of [/MÁXIMA 2/, /capturas de pantalla o de una web/i, /texto, rótulos o logotipos/i, /MUESTRE la respuesta/]) {
    assert.match(PROMPT_NOTA, clave);
  }
});

// --- v0.3.5.1: respaldo de pago ultrabarato del juez ---------------------------------------------

test('MODELOS_VISION: sin inkling-small (403) y sin ningún modelo de pago de serie', () => {
  assert.ok(!MODELOS_VISION.some((m) => m.includes('inkling')));
  assert.ok(!MODELOS_VISION.includes(MODELO_VISION_PAGO));
  assert.equal(MODELO_VISION_PAGO, 'google/gemini-2.5-flash-lite');
});

test('puntuarImagen: gratis caídos -> el de pago va el ÚLTIMO, solo con permitirPago y tope > 0', async () => {
  const usados = [];
  const llamarModelo = async ({ modelo, permitirPago, topeEur, rutaLog }) => {
    usados.push({ modelo, permitirPago, topeEur, rutaLog });
    if (modelo !== MODELO_VISION_PAGO) throw new Error('HTTP 429');
    return '{"nota":4,"motivo":"ok"}';
  };
  const q = { url: 'u', pregunta: 'q' };
  const r = await puntuarImagen(q, { llamarModelo, modelos: ['a', 'b'], permitirPago: true, topeEur: 0.1, rutaLog: '/x/llamadas.log' });
  assert.equal(r.modelo, MODELO_VISION_PAGO);
  assert.deepEqual(usados.map((u) => u.modelo), ['a', 'b', MODELO_VISION_PAGO]);
  assert.deepEqual([usados[2].permitirPago, usados[2].topeEur, usados[2].rutaLog], [true, 0.1, '/x/llamadas.log']);

  for (const opciones of [{}, { permitirPago: true, topeEur: 0 }, { permitirPago: false, topeEur: 0.1 }]) {
    usados.length = 0;
    const sin = await puntuarImagen(q, { llamarModelo, modelos: ['a', 'b'], ...opciones });
    assert.equal(sin, null, 'sin permiso (o sin tope) de pago: null, que la cola trata como fallo técnico');
    assert.deepEqual(usados.map((u) => u.modelo), ['a', 'b']);
  }
});

// Cascada REAL (tools/openrouter.js#llamar) con fetch falso: los gratis dan 403, el de pago contesta y su coste
// queda en el log que cuenta el tope diario.
async function conRedFalsa(fn) {
  const fetchOriginal = globalThis.fetch;
  const entornoOriginal = { g: process.env.GEMINI_API_KEY_GRATIS, o: process.env.OPENROUTER_API_KEY };
  process.env.GEMINI_API_KEY_GRATIS = 'clave-falsa';
  process.env.OPENROUTER_API_KEY = 'clave-falsa';
  const peticiones = [];
  globalThis.fetch = async (url, init) => {
    const modelo = JSON.parse(init.body).model;
    peticiones.push(modelo);
    if (modelo !== MODELO_VISION_PAGO) return new Response('{}', { status: 403 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"nota":5,"motivo":"ok"}' } }], usage: { cost: 0.0002, prompt_tokens: 1800, completion_tokens: 20 } }), { status: 200 });
  };
  try {
    return await fn(peticiones);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of [['GEMINI_API_KEY_GRATIS', entornoOriginal.g], ['OPENROUTER_API_KEY', entornoOriginal.o]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const SILENCIO = (fn) => async () => {
  const original = console.error;
  console.error = () => {};
  try { await fn(); } finally { console.error = original; }
};

test('puntuarImagen con llamar real: gratis 403 -> gemini-2.5-flash-lite puntúa y el coste va al log', SILENCIO(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'one-juez-'));
  const rutaLog = path.join(dir, 'llamadas.log');
  await conRedFalsa(async (peticiones) => {
    const r = await puntuarImagen({ url: 'data:image/webp;base64,AAAA', pregunta: 'q' }, { modelos: ['gemini:gemini-flash-lite-latest'], permitirPago: true, topeEur: 0.1, rutaLog });
    assert.equal(r.nota, 5);
    assert.equal(r.modelo, MODELO_VISION_PAGO);
    assert.deepEqual(peticiones, ['gemini-flash-lite-latest', MODELO_VISION_PAGO]);
  });
  const lineas = (await readFile(rutaLog, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lineas.map((l) => [l.modelo, l.ok]), [['gemini:gemini-flash-lite-latest', false], [MODELO_VISION_PAGO, true]]);
  assert.equal(lineas[1].coste, 0.0002);
}));

test('puntuarImagen con llamar real: sin permiso de pago no se llama al de pago; con el tope del día superado tampoco', SILENCIO(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'one-juez-'));
  const rutaLog = path.join(dir, 'llamadas.log');
  await conRedFalsa(async (peticiones) => {
    const sin = await puntuarImagen({ url: 'data:image/webp;base64,AAAA', pregunta: 'q' }, { modelos: ['gemini:gemini-flash-lite-latest'], rutaLog });
    assert.equal(sin, null);
    assert.deepEqual(peticiones, ['gemini-flash-lite-latest']);

    peticiones.length = 0;
    await writeFile(rutaLog, `${JSON.stringify({ fecha: new Date().toISOString(), modelo: 'otro', coste: 0.1, tokens: 1, ok: true })}\n`);
    const topado = await puntuarImagen({ url: 'data:image/webp;base64,AAAA', pregunta: 'q' }, { modelos: ['gemini:gemini-flash-lite-latest'], permitirPago: true, topeEur: 0.1, rutaLog });
    assert.equal(topado, null, 'gastado hoy >= tope: null');
    assert.deepEqual(peticiones, ['gemini-flash-lite-latest'], 'el de pago ni se pide');
  });
}));
