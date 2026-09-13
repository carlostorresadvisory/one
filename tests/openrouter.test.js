import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { llamar, extraerJson } from '../tools/openrouter.js';

const RUTA_LOG = 'datos/llamadas.test.log';

async function limpiarLog() {
  await rm(RUTA_LOG, { force: true });
}

function respuestaOk(modelo, texto = 'hola') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: texto } }],
      model: modelo,
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
    }),
  };
}

function respuestaError(status) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message: `error ${status}` } }),
  };
}

test('primer modelo responde 429 → usa el segundo y devuelve su id', async () => {
  await limpiarLog();
  const llamadas = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    llamadas.push(body.model);
    if (body.model === 'a/uno:free') return respuestaError(429);
    return respuestaOk(body.model);
  };
  const r = await llamar({
    modelos: ['a/uno:free', 'b/dos:free'],
    mensajes: [{ role: 'user', content: 'hola' }],
    fetchImpl,
    rutaLog: RUTA_LOG,
  });
  assert.equal(r.modelo, 'b/dos:free');
  assert.deepEqual(llamadas, ['a/uno:free', 'b/dos:free']);
  await limpiarLog();
});

test('todos los modelos fallan → lanza con ambos ids en el mensaje', async () => {
  await limpiarLog();
  const fetchImpl = async () => respuestaError(500);
  await assert.rejects(
    () =>
      llamar({
        modelos: ['a/uno:free', 'b/dos:free'],
        mensajes: [{ role: 'user', content: 'hola' }],
        fetchImpl,
        rutaLog: RUTA_LOG,
      }),
    (err) => {
      assert.match(err.message, /a\/uno:free/);
      assert.match(err.message, /b\/dos:free/);
      return true;
    },
  );
  await limpiarLog();
});

test('modelo de pago se salta sin llamar cuando no hay permitirPago', async () => {
  await limpiarLog();
  const invocados = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    invocados.push(body.model);
    return respuestaError(500);
  };
  await assert.rejects(
    () =>
      llamar({
        modelos: ['x/gratis:free', 'openai/gpt-5-mini'],
        mensajes: [{ role: 'user', content: 'hola' }],
        fetchImpl,
        rutaLog: RUTA_LOG,
      }),
    (err) => {
      assert.match(err.message, /pago desactivado/);
      return true;
    },
  );
  assert.deepEqual(invocados, ['x/gratis:free']);
  await limpiarLog();
});

test('con permitirPago y topeEur suficiente, sí llama al modelo de pago', async () => {
  await limpiarLog();
  const invocados = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    invocados.push(body.model);
    if (body.model === 'x/gratis:free') return respuestaError(500);
    return respuestaOk(body.model);
  };
  const r = await llamar({
    modelos: ['x/gratis:free', 'openai/gpt-5-mini'],
    mensajes: [{ role: 'user', content: 'hola' }],
    fetchImpl,
    permitirPago: true,
    topeEur: 0.5,
    rutaLog: RUTA_LOG,
  });
  assert.equal(r.modelo, 'openai/gpt-5-mini');
  assert.deepEqual(invocados, ['x/gratis:free', 'openai/gpt-5-mini']);
  await limpiarLog();
});

test('extraerJson quita los backticks y texto alrededor', () => {
  const r = extraerJson('texto ```json\n[1,2]\n``` más');
  assert.deepEqual(r, [1, 2]);
});

test('extraerJson corta en el primer objeto cuando el modelo duplica la salida', () => {
  // Visto en vivo el 13-sep-2026 (ejecución real, google/gemini-2.5-flash-lite): el modelo repitió
  // el objeto JSON dos veces seguidas, y el recorte ingenuo hasta el último "}" concatenaba
  // ambos, dando "Unexpected non-whitespace character after JSON".
  const r = extraerJson('{"explicacionOk":true,"visualOk":false,"motivo":"x"}\n{"explicacionOk":true,"visualOk":false,"motivo":"x"}');
  assert.deepEqual(r, { explicacionOk: true, visualOk: false, motivo: 'x' });
});

test('extraerJson ignora llaves dentro de una cadena al buscar el cierre', () => {
  const r = extraerJson('{"motivo":"contiene { y } dentro de comillas","ok":true}');
  assert.deepEqual(r, { motivo: 'contiene { y } dentro de comillas', ok: true });
});

test('extraerJson sigue funcionando con texto suelto alrededor de un único objeto', () => {
  const r = extraerJson('Aquí tienes: {"a":1,"b":[1,2,3]} -- espero que sirva');
  assert.deepEqual(r, { a: 1, b: [1, 2, 3] });
});

test('escribe una línea en el log con el coste de usage.cost', async () => {
  await limpiarLog();
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        model: body.model,
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 },
      }),
    };
  };
  await llamar({
    modelos: ['a/uno:free'],
    mensajes: [{ role: 'user', content: 'hola' }],
    fetchImpl,
    rutaLog: RUTA_LOG,
  });
  const contenido = await readFile(RUTA_LOG, 'utf8');
  const lineas = contenido.trim().split('\n');
  const ultima = JSON.parse(lineas[lineas.length - 1]);
  assert.equal(ultima.modelo, 'a/uno:free');
  assert.equal(ultima.coste, 0.0001);
  assert.equal(ultima.ok, true);
  assert.ok(ultima.fecha);
  await limpiarLog();
});
