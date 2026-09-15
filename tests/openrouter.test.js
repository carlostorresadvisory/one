import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { llamar, extraerJson, esModeloGratis, proveedorDe, MODELOS } from '../tools/openrouter.js';
import { crearRegistroCuota } from '../tools/cuota.js';

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

// REESCRITO (v0.2b4.1 §1, excepción declarada en Global Constraints): antes este test esperaba
// ['a/uno:free', 'a/uno:free', 'b/dos:free'] -- intento + reintento con 4 s de espera ANTES de
// saltar. Medido el 15-sep: esperar con eslabones por delante es siempre peor que saltar (Groq
// responde en 1,8 s; la espera sola son 4 s). Ahora se salta ya y el reintento con espera queda
// como último recurso, solo cuando no queda ningún eslabón por probar.
test('v0.2b4.1 §1: 429 en el primer eslabón salta al segundo SIN esperar ni reintentar', async () => {
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
  assert.deepEqual(llamadas, ['a/uno:free', 'b/dos:free'], 'un intento por eslabón, sin reintento intermedio');
  await limpiarLog();
});

test('v0.2b4.1 §1: si TODOS los eslabones se saturan, se espera una vez y se reintenta el primero', async () => {
  await limpiarLog();
  const llamadas = [];
  let esperas = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    llamadas.push(body.model);
    // El reintento final (4.ª llamada) sí responde: es el caso que justifica que exista.
    if (llamadas.length === 4) return respuestaOk(body.model);
    return respuestaError(body.model === 'b/dos:free' ? 503 : 429);
  };
  const r = await llamar({
    modelos: ['a/uno:free', 'b/dos:free', 'c/tres:free'],
    mensajes: [{ role: 'user', content: 'hola' }],
    fetchImpl,
    rutaLog: RUTA_LOG,
    reintentoMs: 0,
    alEsperar: () => { esperas += 1; },
    // Cuota propia (Tarea 2, v0.2b4.1 §2): ids genéricos como 'a/uno:free' se repiten en otros
    // tests de este fichero, y cuotaGlobal es compartida por proceso -- sin un registro propio,
    // una saturación anotada por otro test dejaría este id "bloqueado" y rompería el orden fijo
    // que este test verifica.
    cuota: crearRegistroCuota(),
  });
  assert.deepEqual(llamadas, ['a/uno:free', 'b/dos:free', 'c/tres:free', 'a/uno:free']);
  assert.equal(r.modelo, 'a/uno:free', 'el reintento vuelve al PRIMERO que se saturó, no al último');
  assert.equal(esperas, 1, 'se espera exactamente una vez, y solo al final');
  await limpiarLog();
});

test('v0.2b4.1 §1: 402/404/410 saltan en seco (nunca se reintentan, ni siendo el último eslabón)', async () => {
  for (const estado of [402, 404, 410]) {
    await limpiarLog();
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      llamadas.push(JSON.parse(opts.body).model);
      return respuestaError(estado);
    };
    await assert.rejects(
      llamar({
        modelos: ['a/uno:free'],
        mensajes: [{ role: 'user', content: 'hola' }],
        fetchImpl,
        rutaLog: RUTA_LOG,
        reintentoMs: 0,
      }),
      new RegExp(`HTTP ${estado}`),
    );
    assert.equal(llamadas.length, 1, `HTTP ${estado} no se reintenta: es un "no y no volverá a ser que sí"`);
  }
  await limpiarLog();
});

test('v0.2b4.1 §1: Cerebras con 402 (nivel gratuito sin activar) no rompe la cascada, la deja seguir', async () => {
  await limpiarLog();
  const llamadas = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    llamadas.push(body.model);
    if (url.includes('cerebras')) return respuestaError(402);
    return respuestaOk(body.model, '{"ok":true}');
  };
  const r = await conClavesDeTest(CLAVES_TEST, async () => {
    const salida = await llamar({
      modelos: ['cerebras:gpt-oss-120b', 'groq:openai/gpt-oss-20b'],
      mensajes: [{ role: 'user', content: 'hola' }],
      json: true,
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
    });
    assert.equal(salida.modelo, 'groq:openai/gpt-oss-20b');
  })();
  assert.deepEqual(llamadas, ['gpt-oss-120b', 'openai/gpt-oss-20b']);
  await limpiarLog();
  return r;
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

// (c) 429 siendo el ÚNICO eslabón: no hay a dónde saltar, así que se espera y se reintenta una vez
// (v0.2b4.1 §1: el salto en seco solo aplica mientras queden eslabones sin probar).
test(
  'gemini: 429 siendo el ÚNICO eslabón, se espera y se reintenta una vez',
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

// REESCRITO (v0.2b4.1 §1): con un eslabón detrás, el 429 salta ya -- ya no reintenta el mismo
// modelo antes de pasar al siguiente. Una llamada por eslabón, no dos.
test(
  'gemini: 429 en el primer eslabón pasa al siguiente modelo de la cascada sin reintentar',
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
      // Cuota propia: ver comentario igual en el test "si TODOS los eslabones se saturan".
      cuota: crearRegistroCuota(),
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.deepEqual(llamadas, ['gemini-flash-lite-latest', 'b/dos:free']);
    await limpiarLog();
  }),
);

// (d) 503 se comporta igual que 429: salta ya, una sola llamada por eslabón.
test(
  'gemini: 503 en el primer eslabón pasa al siguiente modelo de la cascada sin reintentar',
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
      // Cuota propia: ver comentario igual en el test "si TODOS los eslabones se saturan".
      cuota: crearRegistroCuota(),
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.deepEqual(llamadas, ['gemini-flash-lite-latest', 'b/dos:free']);
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

// (g) Ola final v0.2b4 -- Critical C1: los campos propios de OpenRouter (`reasoning` y compañía)
// NO pueden viajar en el body de Gemini. Google AI Studio valida el JSON del body de forma
// estricta y responde HTTP 400 `Invalid JSON payload received. Unknown name "reasoning"`
// (reproducido por el revisor el 15-sep-2026: flash-lite sin `reasoning` -> 200; con
// `reasoning` -> 400). Como `tools/visualizar.js` manda siempre `extra: SIN_RAZONAMIENTO`, los
// dos eslabones Gemini de la cascada visual estaban muertos: 491 s y 0/4 visuales en la tanda real.
test(
  'gemini: los campos propios de OpenRouter (reasoning) NO se envían en el body',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
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
      extra: { reasoning: { enabled: false, exclude: true } },
    });
    const body = JSON.parse(opcionesRecibidas.body);
    assert.equal('reasoning' in body, false, 'Google AI Studio da 400 si el body trae "reasoning"');
    assert.equal(body.model, 'gemini-flash-lite-latest');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hola' }]);
    await limpiarLog();
  }),
);

test(
  'openrouter: el mismo `extra.reasoning` SÍ viaja en el body de un id de OpenRouter',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    let opcionesRecibidas;
    const fetchImpl = async (url, opts) => {
      opcionesRecibidas = opts;
      return respuestaOk('a/uno:free');
    };
    await llamar({
      modelos: ['a/uno:free'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      extra: { reasoning: { enabled: false, exclude: true } },
    });
    const body = JSON.parse(opcionesRecibidas.body);
    assert.deepEqual(body.reasoning, { enabled: false, exclude: true });
    await limpiarLog();
  }),
);

// La misma cascada con los dos destinos: a Gemini se le quita `reasoning`, al ':free' de
// OpenRouter que va detrás se le mantiene (el `extra` es único para toda la cascada).
test(
  'cascada mixta: se limpia el body de Gemini sin perder `reasoning` para el siguiente de OpenRouter',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    const cuerpos = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      cuerpos.push(body);
      if (body.model === 'gemini-flash-lite-latest') return respuestaError(500);
      return respuestaOk(body.model);
    };
    const r = await llamar({
      modelos: ['gemini:gemini-flash-lite-latest', 'b/dos:free'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      extra: { reasoning: { enabled: false, exclude: true } },
      // Cuota propia: ver comentario igual en el test "si TODOS los eslabones se saturan".
      cuota: crearRegistroCuota(),
    });
    assert.equal(r.modelo, 'b/dos:free');
    assert.equal('reasoning' in cuerpos[0], false);
    assert.deepEqual(cuerpos[1].reasoning, { enabled: false, exclude: true });
    await limpiarLog();
  }),
);

// Los demás campos propios de OpenRouter (provider, transforms, route, models, plugins,
// include_reasoning) tampoco pueden colarse: Google rechaza cualquier nombre desconocido.
test(
  'gemini: ningún campo propio de OpenRouter sobrevive en el body; los estándar sí',
  conClaveGeminiDeTest(CLAVE_GEMINI_TEST, async () => {
    await limpiarLog();
    let opcionesRecibidas;
    const fetchImpl = async (url, opts) => {
      opcionesRecibidas = opts;
      return respuestaOk('gemini-3.6-flash');
    };
    await llamar({
      modelos: ['gemini:gemini-3.6-flash'],
      mensajes: [{ role: 'user', content: 'hola' }],
      fetchImpl,
      rutaLog: RUTA_LOG,
      extra: {
        reasoning: { enabled: false },
        include_reasoning: false,
        provider: { zdr: true },
        transforms: ['middle-out'],
        route: 'fallback',
        models: ['otro/modelo:free'],
        plugins: [{ id: 'web' }],
        // Estándar del protocolo OpenAI: Google sí lo entiende, no se toca.
        top_p: 0.9,
      },
    });
    const body = JSON.parse(opcionesRecibidas.body);
    for (const campo of ['reasoning', 'include_reasoning', 'provider', 'transforms', 'route', 'models', 'plugins']) {
      assert.equal(campo in body, false, `"${campo}" es propio de OpenRouter y no debe ir a Gemini`);
    }
    assert.equal(body.top_p, 0.9, 'top_p es estándar de OpenAI: debe llegar a Gemini');
    await limpiarLog();
  }),
);

// --- Proveedores gratis nuevos (Tarea 1, v0.2b4.1) --------------------------------------------
// Claves FICTICIAS solo para estos tests: nunca se lee `.env` ni se usa ninguna clave real. Mismo
// patrón (guardar -> poner -> finally restaurar) que conClaveGeminiDeTest, generalizado a las tres
// variables nuevas para no repetir el try/finally en cada test.
const CLAVES_TEST = {
  GEMINI_API_KEY_GRATIS: 'clave-test-gemini',
  GROQ_API_KEY: 'clave-test-groq',
  NVIDIA_API_KEY: 'clave-test-nvidia',
  CEREBRAS_API_KEY: 'clave-test-cerebras',
};

function conClavesDeTest(valores, fn) {
  return async () => {
    const anteriores = {};
    for (const [nombre, valor] of Object.entries(valores)) {
      anteriores[nombre] = process.env[nombre];
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
    try {
      await fn();
    } finally {
      for (const [nombre, anterior] of Object.entries(anteriores)) {
        if (anterior === undefined) delete process.env[nombre];
        else process.env[nombre] = anterior;
      }
    }
  };
}

test('v0.2b4.1 §1: los tres proveedores nuevos se reconocen por prefijo y cuentan como gratis', () => {
  assert.equal(proveedorDe('groq:openai/gpt-oss-120b').variable, 'GROQ_API_KEY');
  assert.equal(proveedorDe('nvidia:nvidia/nemotron-3.5-lightning-30b-a3b').variable, 'NVIDIA_API_KEY');
  assert.equal(proveedorDe('cerebras:gpt-oss-120b').variable, 'CEREBRAS_API_KEY');
  assert.equal(proveedorDe('gemini:gemini-flash-lite-latest').variable, 'GEMINI_API_KEY_GRATIS');
  assert.equal(proveedorDe('z-ai/glm-4.7-flash'), null, 'un id sin prefijo sigue siendo de OpenRouter');

  // Gratis de verdad: son claves de nivel gratuito sin tarjeta (spec §0), un exceso da 429 o 402,
  // nunca un cargo. Sin esto, servidor/generacion.js#filtrarPorPago los descartaría con PERMITIR_PAGO=0.
  for (const id of ['groq:openai/gpt-oss-20b', 'nvidia:openai/gpt-oss-20b', 'cerebras:qwen-3.8-27b']) {
    assert.equal(esModeloGratis(id), true, `${id} debe contar como gratis`);
  }
  assert.equal(esModeloGratis('z-ai/glm-4.7-flash'), false);
});

test(
  'v0.2b4.1 §1: cada proveedor va a SU endpoint, con SU clave y el modelo sin prefijo en el body',
  conClavesDeTest(CLAVES_TEST, async () => {
    await limpiarLog();
    const casos = [
      ['groq:openai/gpt-oss-120b', 'https://api.groq.com/openai/v1/chat/completions', 'clave-test-groq', 'openai/gpt-oss-120b'],
      ['nvidia:openai/gpt-oss-20b', 'https://integrate.api.nvidia.com/v1/chat/completions', 'clave-test-nvidia', 'openai/gpt-oss-20b'],
      ['cerebras:gpt-oss-120b', 'https://api.cerebras.ai/v1/chat/completions', 'clave-test-cerebras', 'gpt-oss-120b'],
    ];
    for (const [id, url, clave, modelBody] of casos) {
      let urlRecibida;
      let opcionesRecibidas;
      const fetchImpl = async (u, opts) => {
        urlRecibida = u;
        opcionesRecibidas = opts;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"ok":true}' } }],
            // Coste distinto de 0 a propósito: un proveedor propio es gratis y `llamar` debe
            // forzar coste 0 sin fiarse de lo que traiga la respuesta.
            usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.05 },
          }),
        };
      };
      const r = await llamar({
        modelos: [id],
        mensajes: [{ role: 'user', content: 'hola' }],
        json: true,
        fetchImpl,
        rutaLog: RUTA_LOG,
        // `reasoning` es campo PROPIO de OpenRouter: Google devolvió HTTP 400 por él (v0.2b4 C1) y
        // no hay razón para creer que Groq/NVIDIA/Cerebras lo acepten. No debe viajar a ninguno.
        extra: { reasoning: { enabled: false }, temperature_extra_falso: 1 },
      });
      assert.equal(urlRecibida, url, `${id} debe ir a ${url}`);
      assert.equal(opcionesRecibidas.headers.Authorization, `Bearer ${clave}`);
      assert.equal(opcionesRecibidas.headers['HTTP-Referer'], undefined, 'HTTP-Referer es solo de OpenRouter');
      assert.equal(opcionesRecibidas.headers['X-Title'], undefined, 'X-Title es solo de OpenRouter');
      const body = JSON.parse(opcionesRecibidas.body);
      assert.equal(body.model, modelBody, 'el prefijo del proveedor nunca viaja en el body');
      assert.equal(body.reasoning, undefined, 'los campos propios de OpenRouter no viajan aquí');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(r.modelo, id, 'el id devuelto conserva el prefijo (es la clave de la cascada)');
      assert.equal(r.coste, 0);
    }
    await limpiarLog();
  }),
);

test(
  'v0.2b4.1 §1: sin la clave del proveedor, el eslabón se salta SIN llamar y sigue la cascada',
  conClavesDeTest({ ...CLAVES_TEST, GROQ_API_KEY: undefined, CEREBRAS_API_KEY: '   ' }, async () => {
    await limpiarLog();
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      llamadas.push(JSON.parse(opts.body).model);
      return respuestaOk('gemini-flash-lite-latest', '{"ok":true}');
    };
    const r = await llamar({
      // Groq sin variable y Cerebras con una cadena de solo espacios: las dos son "sin clave".
      modelos: ['groq:openai/gpt-oss-120b', 'cerebras:gpt-oss-120b', 'gemini:gemini-flash-lite-latest'],
      mensajes: [{ role: 'user', content: 'hola' }],
      json: true,
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
    });
    assert.deepEqual(llamadas, ['gemini-flash-lite-latest'], 'los dos sin clave no llegan a la red');
    assert.equal(r.modelo, 'gemini:gemini-flash-lite-latest');
    await limpiarLog();
  }),
);

test(
  'v0.2b4.1 §1: Groq gpt-oss recibe reasoning_effort low y NVIDIA el interruptor de "no pensar"',
  conClavesDeTest(CLAVES_TEST, async () => {
    await limpiarLog();
    const cuerpos = {};
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      cuerpos[body.model] = body;
      return respuestaOk(body.model, '{"ok":true}');
    };
    const pedir = (id) =>
      llamar({
        modelos: [id],
        mensajes: [
          { role: 'system', content: 'Eres un autor de preguntas.' },
          { role: 'user', content: 'hola' },
        ],
        json: true,
        fetchImpl,
        rutaLog: RUTA_LOG,
        reintentoMs: 0,
      });

    await pedir('groq:openai/gpt-oss-120b');
    assert.equal(cuerpos['openai/gpt-oss-120b'].reasoning_effort, 'low', 'spec §0: gpt-oss lo exige');

    // groq/compound NO admite reasoning_effort (spec §0): el extra es por modelo, no por proveedor.
    await pedir('groq:groq/compound-mini');
    assert.equal(cuerpos['groq/compound-mini'].reasoning_effort, undefined);

    await pedir('nvidia:nvidia/nemotron-3.5-lightning-30b-a3b');
    const nvidia = cuerpos['nvidia/nemotron-3.5-lightning-30b-a3b'];
    assert.deepEqual(nvidia.chat_template_kwargs, { thinking: false, enable_thinking: false });
    assert.ok(
      nvidia.messages[0].content.startsWith('/no_think\ndetailed thinking off\n'),
      'el prefijo va DENTRO del sistema, delante del criterio, sin borrarlo',
    );
    assert.ok(nvidia.messages[0].content.includes('Eres un autor de preguntas.'));
    assert.equal(nvidia.messages[1].content, 'hola', 'el mensaje de usuario no se toca');

    // Gemini y OpenRouter no reciben nada de esto.
    await pedir('gemini:gemini-flash-lite-latest');
    assert.equal(cuerpos['gemini-flash-lite-latest'].reasoning_effort, undefined);
    assert.equal(cuerpos['gemini-flash-lite-latest'].chat_template_kwargs, undefined);
    await limpiarLog();
  }),
);

test('v0.2b4.1 §1: las tres claves nuevas están documentadas en servidor/.env.ejemplo y en DESPLIEGUE.md', async () => {
  const ejemplo = await readFile('servidor/.env.ejemplo', 'utf8');
  const despliegue = await readFile('servidor/DESPLIEGUE.md', 'utf8');
  for (const variable of ['GEMINI_API_KEY_GRATIS', 'GROQ_API_KEY', 'NVIDIA_API_KEY', 'CEREBRAS_API_KEY']) {
    assert.match(ejemplo, new RegExp(`^${variable}=`, 'm'), `${variable} falta en servidor/.env.ejemplo`);
    assert.ok(despliegue.includes(variable), `${variable} falta en servidor/DESPLIEGUE.md`);
  }
  // Nunca un valor: este fichero se versiona en git.
  for (const linea of ejemplo.split('\n')) {
    if (linea.startsWith('#') || !linea.includes('=')) continue;
    assert.equal(linea.split('=')[1].trim(), '', `servidor/.env.ejemplo lleva un valor en "${linea.split('=')[0]}"`);
  }
});

// --- Cuota por cabeceras x-ratelimit (Tarea 2, v0.2b4.1 §2) ------------------------------------

test(
  'v0.2b4.1 §2: `llamar` consulta la cuota ANTES de cada intento y se salta el eslabón sin hueco',
  conClavesDeTest(CLAVES_TEST, async () => {
    await limpiarLog();
    const cuota = crearRegistroCuota({ reloj: () => 5000 });
    // El 120b acaba de decir que le quedan 300 tokens: una llamada grande no cabe ahí.
    cuota.registrarRespuesta('groq:openai/gpt-oss-120b', {
      status: 200,
      headers: new Headers({ 'x-ratelimit-remaining-tokens': '300' }),
    });
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      llamadas.push(JSON.parse(opts.body).model);
      return respuestaOk('ok', '{"ok":true}');
    };
    const r = await llamar({
      modelos: ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'],
      mensajes: [{ role: 'user', content: 'x'.repeat(3500) }], // 1.000 tokens + maxTokens
      json: true,
      maxTokens: 1500,
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
      cuota,
    });
    assert.deepEqual(llamadas, ['openai/gpt-oss-20b'], 'el 120b ni se intenta: no cabe');
    assert.equal(r.modelo, 'groq:openai/gpt-oss-20b');
    await limpiarLog();
  }),
);

test(
  'v0.2b4.1 §2: `llamar` alimenta la cuota con las cabeceras de la respuesta que recibe',
  conClavesDeTest(CLAVES_TEST, async () => {
    await limpiarLog();
    const cuota = crearRegistroCuota({ reloj: () => 5000 });
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-ratelimit-remaining-tokens': '120', 'x-ratelimit-remaining-requests': '17' }),
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }),
    });
    await llamar({
      modelos: ['groq:openai/gpt-oss-120b'],
      mensajes: [{ role: 'user', content: 'hola' }],
      json: true,
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
      cuota,
    });
    assert.equal(cuota.hayHueco('groq:openai/gpt-oss-120b', 100), true);
    assert.equal(cuota.hayHueco('groq:openai/gpt-oss-120b', 5000), false, 'ya sabe que solo le quedan 120');
    await limpiarLog();
  }),
);

test(
  'v0.2b4.1 §2: si ningún eslabón tiene hueco, se intenta igual el que antes vuelve (nunca se falla sin llamar)',
  conClavesDeTest(CLAVES_TEST, async () => {
    await limpiarLog();
    let ahora = 5000;
    const cuota = crearRegistroCuota({ reloj: () => ahora });
    cuota.registrarRespuesta('groq:openai/gpt-oss-120b', { status: 429, headers: new Headers({ 'retry-after': '40' }) });
    cuota.registrarRespuesta('groq:openai/gpt-oss-20b', { status: 429, headers: new Headers({ 'retry-after': '5' }) });
    const llamadas = [];
    const fetchImpl = async (url, opts) => {
      llamadas.push(JSON.parse(opts.body).model);
      return respuestaOk('ok', '{"ok":true}');
    };
    const r = await llamar({
      modelos: ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'],
      mensajes: [{ role: 'user', content: 'hola' }],
      json: true,
      fetchImpl,
      rutaLog: RUTA_LOG,
      reintentoMs: 0,
      cuota,
    });
    assert.equal(llamadas[0], 'openai/gpt-oss-20b', 'la cuota reordena: 5 s de espera es mejor que 40');
    assert.equal(r.modelo, 'groq:openai/gpt-oss-20b');
    await limpiarLog();
  }),
);

test('v0.2b4.1 §3: las cascadas de preguntas son todas gratis, rápidas primero y con papeles distintos', () => {
  const { generador, verificador, subtemas, generadorFondo, verificadorFondo } = MODELOS;

  // Tanda urgente: el jugador está esperando. Los tiempos son los medidos el 15-sep (spec §0).
  assert.equal(generador[0], 'gemini:gemini-flash-lite-latest'); // 1,3 s y no se agota en todo el día
  assert.deepEqual(generador.slice(1, 4), ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b', 'cerebras:gpt-oss-120b']);
  assert.equal(verificador[0], 'groq:openai/gpt-oss-120b'); // 1,5 s
  assert.equal(subtemas[0], 'gemini:gemini-flash-lite-latest');
  assert.deepEqual(subtemas, ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-20b']);

  // Regla fija de Carlos: el verificador NUNCA es el generador. Con primeros eslabones distintos,
  // `excluirModelo` (servidor/generacion.js) nunca deja al verificador sin cascada.
  assert.notEqual(generador[0], verificador[0]);
  assert.notEqual(generadorFondo[0], verificadorFondo[0]);

  // Colchón nocturno: empieza por NVIDIA y los ':free' para NO gastar la cuota rápida de día.
  assert.equal(generadorFondo[0], 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b');
  assert.ok(generadorFondo.some((m) => m.endsWith(':free')));
  assert.ok(verificadorFondo.some((m) => m.endsWith(':free')));
  // ...y Groq/Gemini solo detrás, como red de seguridad (spec §3).
  const primerRapidoFondo = generadorFondo.findIndex((m) => m.startsWith('groq:') || m.startsWith('gemini:'));
  assert.ok(primerRapidoFondo >= 3, 'en el colchón, Groq/Gemini van al final, no en cabeza');

  // Nada de pago en ninguna de las cinco (spec §2: PERMITIR_PAGO=0 sigue siendo el modo real).
  for (const [nombre, cascada] of Object.entries(MODELOS)) {
    assert.ok(cascada.length > 0, `${nombre} vacía`);
    for (const m of cascada) assert.equal(esModeloGratis(m), true, `${nombre}: ${m} no es gratis`);
  }

  // NVIDIA y los ':free' de OpenRouter, solo al FINAL de las cascadas urgentes (spec §3: 35-90 s).
  for (const cascada of [generador, verificador]) {
    const primerLento = cascada.findIndex((m) => m.startsWith('nvidia') || m.endsWith(':free'));
    assert.ok(primerLento === -1 || primerLento >= 3, 'lo lento va al final de una cascada urgente');
  }
});
