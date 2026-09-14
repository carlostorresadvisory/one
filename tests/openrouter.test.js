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

// Adaptado en la Tarea 1 de v0.2b3: el 429 ahora se reintenta UNA vez (universal, no solo para
// Gemini) antes de pasar al siguiente modelo -- ver el bloque "reintento ante 429/503" más abajo.
// Antes este test esperaba una sola llamada a 'a/uno:free'; ahora espera dos (intento + reintento)
// porque ambas devuelven 429. reintentoMs:0 evita que el test tarde los 4s reales de producción.
test('primer modelo responde 429 → reintenta una vez y, si sigue fallando, usa el segundo', async () => {
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
    reintentoMs: 0,
  });
  assert.equal(r.modelo, 'b/dos:free');
  assert.deepEqual(llamadas, ['a/uno:free', 'a/uno:free', 'b/dos:free']);
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

// Ronda final (revisión, 14-sep-2026) -- Critical (C1): un fallo al escribir el log (carpeta
// inexistente, disco lleno...) no debe tumbar `llamar` si el modelo respondió bien.
test('C1: si registrarLog falla (carpeta inexistente), llamar devuelve la respuesta igual', async () => {
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return respuestaOk(body.model, 'contenido de la respuesta');
  };
  const r = await llamar({
    modelos: ['a/uno:free'],
    mensajes: [{ role: 'user', content: 'hola' }],
    fetchImpl,
    rutaLog: 'carpeta-de-prueba-que-no-existe-xyz/llamadas.log',
  });
  assert.equal(r.modelo, 'a/uno:free');
  assert.equal(r.texto, 'contenido de la respuesta');
});

// --- Gemini gratis en la cascada (Tarea 1, v0.2b3) --------------------------------------------
// Clave FICTICIA solo para estos tests: nunca se lee `.env` ni se usa la clave real. Se guarda y
// restaura process.env.GEMINI_API_KEY_GRATIS en cada test para no contaminar otros tests/procesos.
const CLAVE_GEMINI_TEST = 'clave-test-gemini';

function conClaveGeminiDeTest(valor, fn) {
  return async () => {
    const anterior = process.env.GEMINI_API_KEY_GRATIS;
    if (valor === undefined) delete process.env.GEMINI_API_KEY_GRATIS;
    else process.env.GEMINI_API_KEY_GRATIS = valor;
    try {
      await fn();
    } finally {
      if (anterior === undefined) delete process.env.GEMINI_API_KEY_GRATIS;
      else process.env.GEMINI_API_KEY_GRATIS = anterior;
    }
  };
}

// (a) URL, cabecera y body correctos; coste siempre 0 aunque la respuesta traiga usage.cost.
test(
  'gemini: se envía al endpoint OpenAI de Google, sin prefijo en el body y con Bearer de GEMINI_API_KEY_GRATIS',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    let urlRecibida;
    let opcionesRecibidas;
    const fetchImpl = async (url, opts) => {
      urlRecibida = url;
      opcionesRecibidas = opts;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          // Contenido JSON válido porque json:true hace que `llamar` valide con extraerJson.
          choices: [{ message: { content: '{"saludo":"hola desde gemini"}' } }],
          // usage.cost distinto de 0 a propósito: Gemini es gratis (proyecto sin facturación),
          // así que `llamar` debe forzar coste:0 sin fiarse de lo que traiga la respuesta.
          usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.05 },
        }),
      };
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest'],
      mensajes: [{ role: 'user', content: 'hola' }],
      json: true,
      fetchImpl,
      rutaLog: RUTA_LOG,
    });
    assert.equal(urlRecibida, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(opcionesRecibidas.headers.Authorization, `Bearer ${CLAVE_GEMINI_TEST}`);
    assert.equal(opcionesRecibidas.headers['HTTP-Referer'], undefined, 'HTTP-Referer es solo de OpenRouter');
    assert.equal(opcionesRecibidas.headers['X-Title'], undefined, 'X-Title es solo de OpenRouter');
    const body = JSON.parse(opcionesRecibidas.body);
    assert.equal(body.model, 'gemini-flash-lite-latest');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(r.texto, '{"saludo":"hola desde gemini"}');
    assert.equal(r.modelo, 'gemini:gemini-flash-lite-latest');
    assert.equal(r.coste, 0);
    await limpiarLog();
  }),
);

// (b) sin GEMINI_API_KEY_GRATIS: se salta con motivo y sigue con el siguiente modelo de la cascada.
test(
  'gemini: sin GEMINI_API_KEY_GRATIS en el entorno, se salta sin llamar a fetchImpl y sigue al siguiente',
  conClaveGeminiDeTest(undefined, async () => {
    await limpiarLog();
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      llamadas.push(body.model);
      return respuestaOk(body.model);
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest', 'b/dos:free'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.deepEqual(llamadas, ['b/dos:free'], 'gemini nunca debe llegar a fetchImpl sin clave');
    await limpiarLog();
  }),
);

test(
  'gemini: sin GEMINI_API_KEY_GRATIS y sin más modelos, lanza con "sin clave de Gemini" en el mensaje',
  conClaveGeminiDeTest(undefined, async () => {
    const fetchImpl = async () => respuestaOk('no debería llamarse');
    await assert.rejects(
      () =>
        llamar({
          modelos: ['gemini:gemini-flash-lite-latest'],
          mensajes: [{ role: 'user', content: 'hola' }],
          fetchImpl,
          rutaLog: RUTA_LOG,
        }),
      (err) => {
        assert.match(err.message, /gemini:gemini-flash-lite-latest: sin clave de Gemini/);
        return true;
      },
    );
  }),
);

// Defensivo (triaje adversarial, ronda final de arreglos, 14-sep-2026): un `.env` con espacios de
// sobra alrededor de la clave (copia-pega, salto de línea final del editor...) no debe colarse tal
// cual en la cabecera, ni una clave de solo espacios debe tratarse como "hay clave".
test(
  'gemini: GEMINI_API_KEY_GRATIS de solo espacios se trata como AUSENTE (se salta, no llama a fetchImpl)',
  conClaveGeminiDeTest('   ', async () => {
    await limpiarLog();
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      llamadas.push(body.model);
      return respuestaOk(body.model);
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest', 'b/dos:free'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.deepEqual(llamadas, ['b/dos:free'], 'gemini nunca debe llegar a fetchImpl con la clave vacía tras el trim');
    await limpiarLog();
  }),
);

test(
  'gemini: GEMINI_API_KEY_GRATIS con espacios alrededor se recorta (trim) antes de mandarla en Authorization',
  conClaveGeminiDeTest(`  ${CLAVE_GEMINI_TEST}  \n`, async () => {
    await limpiarLog();
    let opcionesRecibidas;
    const fetchImpl = async (url, opts) => {
      opcionesRecibidas = opts;
      return respuestaOk('gemini-flash-lite-latest');
    };
    await llamar({
      modelos: ['gemini:gemini-flash-lite-latest'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
    });
    assert.equal(opcionesRecibidas.headers.Authorization, `Bearer ${CLAVE_GEMINI_TEST}`);
    await limpiarLog();
  }),
);

// (c) 429 → reintento único tras reintentoMs → si el reintento también falla, pasa al siguiente.
test(
  'gemini: 429 reintenta una vez y, si el reintento responde 200, usa esa respuesta (mismo modelo)',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    let intentos = 0;
    const fetchImpl = async () => {
      intentos++;
      if (intentos === 1) return respuestaError(429);
      return respuestaOk('gemini-flash-lite-latest', 'ok al segundo intento');
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
    });
    assert.equal(intentos, 2);
    assert.equal(r.modelo, 'gemini:gemini-flash-lite-latest');
    assert.equal(r.texto, 'ok al segundo intento');
    await limpiarLog();
  }),
);

test(
  'gemini: 429 en el intento y en el reintento pasa al siguiente modelo de la cascada',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      llamadas.push(body.model);
      if (body.model === 'gemini-flash-lite-latest') return respuestaError(429);
      return respuestaOk(body.model);
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest', 'b/dos:free'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.deepEqual(llamadas, ['gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'b/dos:free']);
    await limpiarLog();
  }),
);

// (d) 503 se comporta igual que 429: reintento único y luego el siguiente modelo.
test(
  'gemini: 503 en el intento y en el reintento pasa al siguiente modelo de la cascada',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      llamadas.push(body.model);
      if (body.model === 'gemini-flash-lite-latest') return respuestaError(503);
      return respuestaOk(body.model);
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest', 'b/dos:free'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.deepEqual(llamadas, ['gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'b/dos:free']);
    await limpiarLog();
  }),
);

// (e) esModeloGratis(gemini:...) === true: no exige permitirPago para intentarlo (comprobado
// indirectamente vía comportamiento de `llamar`, ya que esModeloGratis no se exporta).
test(
  'gemini: se llama sin permitirPago (no se trata como modelo de pago)',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      return respuestaOk(body.model, 'respuesta gratis');
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      // permitirPago no se pasa (queda en su valor por defecto, false).
    });
    assert.equal(r.modelo, 'gemini:gemini-flash-lite-latest');
    assert.equal(r.texto, 'respuesta gratis');
    await limpiarLog();
  }),
);

// (f) registrarLog recibe coste:0 y el modelo con prefijo, aunque usage.cost venga a >0.
test(
  'gemini: registrarLog recibe coste 0 y el id con prefijo "gemini:"',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, cost: 0.02 },
      }),
    });
    await llamar({
      modelos: ['gemini:gemini-3.6-flash'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
    });
    const contenido = await readFile(RUTA_LOG, 'utf8');
    const lineas = contenido.trim().split('\n');
    const ultima = JSON.parse(lineas[lineas.length - 1]);
    assert.equal(ultima.modelo, 'gemini:gemini-3.6-flash');
    assert.equal(ultima.coste, 0);
    assert.equal(ultima.tokens, 6);
    assert.equal(ultima.ok, true);
    await limpiarLog();
  }),
);
