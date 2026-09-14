// Tests de sincronizacion.js (Tarea 1 del plan v0.2b2-cliente-atomo): cliente del servidor de
// generación, sin red real (fetchImpl siempre falso) y con localStorage/history falsos (no existen
// como globales en Node, ver comentario de cabecera de sincronizacion.js). Contrato exacto en
// docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §4 y §3.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstado } from '../motor.js';
import {
  leerConfiguracion,
  guardarConfiguracionDesdeUrl,
  leerBancoExtra,
  fusionarBancoExtra,
  sincronizarEstado,
  pedirTanda,
  consultarTrabajo,
  pedirSubtemas,
  reportarAlServidor,
} from '../sincronizacion.js';

const URL_SERVIDOR = 'https://servidor.prueba';
const TOKEN = 'abc';
const HOY = '2026-09-14';

function crearLocalStorageFalso() {
  const mapa = new Map();
  return {
    getItem: (clave) => (mapa.has(clave) ? mapa.get(clave) : null),
    setItem: (clave, valor) => mapa.set(clave, String(valor)),
    removeItem: (clave) => mapa.delete(clave),
    clear: () => mapa.clear(),
  };
}

// beforeEach no hace falta (node:test lo tiene, pero el resto de tests/*.test.js de este repo no
// lo usa, ver tests/servidor-api.test.js): cada test monta su propio localStorage/history falsos.
function prepararGlobales({ conConfiguracion = false } = {}) {
  globalThis.localStorage = crearLocalStorageFalso();
  const llamadasReplaceState = [];
  globalThis.history = { replaceState: (...args) => llamadasReplaceState.push(args) };
  if (conConfiguracion) {
    globalThis.localStorage.setItem(
      'one.servidor',
      JSON.stringify({ url: URL_SERVIDOR, token: TOKEN })
    );
  }
  return { llamadasReplaceState };
}

function bancoMinimo() {
  return [
    { id: 'p1', area: 'economia', nivel: 1 },
    { id: 'p2', area: 'historia', nivel: 1 },
  ];
}

/** fetchImpl falso: cuenta llamadas, guarda la última petición y responde según `respuestas`
 * (una por llamada, en orden; la última se repite si se llama más veces de las que hay). */
function crearFetchFalso(respuestas) {
  const llamadas = [];
  const fn = async (url, opciones) => {
    llamadas.push({ url, opciones });
    const indice = Math.min(llamadas.length - 1, respuestas.length - 1);
    const r = respuestas[indice];
    if (r.lanza) throw r.lanza;
    return {
      ok: r.ok !== false,
      status: r.status || (r.ok !== false ? 200 : 500),
      json: async () => r.cuerpo,
    };
  };
  fn.llamadas = llamadas;
  return fn;
}

// === leerConfiguracion =============================================================================

test('leerConfiguracion: null sin nada guardado', () => {
  prepararGlobales();
  assert.equal(leerConfiguracion(), null);
});

test('leerConfiguracion: null con JSON corrupto', () => {
  prepararGlobales();
  globalThis.localStorage.setItem('one.servidor', '{esto no es json');
  assert.equal(leerConfiguracion(), null);
});

test('leerConfiguracion: null si falta url o token', () => {
  prepararGlobales();
  globalThis.localStorage.setItem('one.servidor', JSON.stringify({ url: URL_SERVIDOR }));
  assert.equal(leerConfiguracion(), null);
});

test('leerConfiguracion: devuelve {url, token} guardados', () => {
  prepararGlobales({ conConfiguracion: true });
  assert.deepEqual(leerConfiguracion(), { url: URL_SERVIDOR, token: TOKEN });
});

// === guardarConfiguracionDesdeUrl ===================================================================

test('guardarConfiguracionDesdeUrl: URL sin parámetros no guarda nada ni toca history', () => {
  const { llamadasReplaceState } = prepararGlobales();
  const guardo = guardarConfiguracionDesdeUrl({ search: '', pathname: '/' });
  assert.equal(guardo, false);
  assert.equal(leerConfiguracion(), null);
  assert.equal(llamadasReplaceState.length, 0);
});

test('guardarConfiguracionDesdeUrl: guarda url+token y limpia la URL preservando otros parámetros', () => {
  const { llamadasReplaceState } = prepararGlobales();
  const guardo = guardarConfiguracionDesdeUrl({
    search: `?test=1&servidor=${encodeURIComponent(URL_SERVIDOR)}&token=${TOKEN}`,
    pathname: '/one/',
  });
  assert.equal(guardo, true);
  assert.deepEqual(leerConfiguracion(), { url: URL_SERVIDOR, token: TOKEN });
  assert.equal(llamadasReplaceState.length, 1);
  const [, , urlLimpia] = llamadasReplaceState[0];
  assert.equal(urlLimpia, '/one/?test=1');
});

test('guardarConfiguracionDesdeUrl: rechaza un servidor que no sea https://', () => {
  prepararGlobales();
  const guardo = guardarConfiguracionDesdeUrl({
    search: `?servidor=${encodeURIComponent('http://servidor.prueba')}&token=${TOKEN}`,
    pathname: '/',
  });
  assert.equal(guardo, false);
  assert.equal(leerConfiguracion(), null);
});

test('guardarConfiguracionDesdeUrl: falta uno de los dos parámetros → no guarda', () => {
  prepararGlobales();
  assert.equal(
    guardarConfiguracionDesdeUrl({ search: `?servidor=${encodeURIComponent(URL_SERVIDOR)}`, pathname: '/' }),
    false
  );
  assert.equal(guardarConfiguracionDesdeUrl({ search: `?token=${TOKEN}`, pathname: '/' }), false);
  assert.equal(leerConfiguracion(), null);
});

// === leerBancoExtra / fusionarBancoExtra ============================================================

test('leerBancoExtra: [] sin nada guardado ni con JSON corrupto', () => {
  prepararGlobales();
  assert.deepEqual(leerBancoExtra(), []);
  globalThis.localStorage.setItem('one.bancoExtra', 'no-es-json');
  assert.deepEqual(leerBancoExtra(), []);
});

test('fusionarBancoExtra: dedupe contra lo guardado y entre las propias nuevas', () => {
  prepararGlobales();
  globalThis.localStorage.setItem('one.bancoExtra', JSON.stringify([{ id: 'srv-1' }]));
  const estado = crearEstado(HOY);
  const resultado = fusionarBancoExtra(
    [{ id: 'srv-1' }, { id: 'srv-2' }, { id: 'srv-2' }, { id: 'srv-3' }],
    estado
  );
  assert.deepEqual(resultado, { anadidas: 2, total: 3 });
  assert.deepEqual(
    leerBancoExtra().map((p) => p.id),
    ['srv-1', 'srv-2', 'srv-3']
  );
});

test('fusionarBancoExtra: al pasar el tope de 2.000 descarta las consolidadas (caja 4) más antiguas que no estén pendientes', () => {
  prepararGlobales();
  // 2000 preguntas ya guardadas: las 5 primeras son "consolidadas y no pendientes" (descartables),
  // el resto no tiene tarjeta (no son descartables: no están consolidadas).
  const existentes = Array.from({ length: 2000 }, (_, i) => ({ id: `srv-${i}` }));
  globalThis.localStorage.setItem('one.bancoExtra', JSON.stringify(existentes));
  const estado = crearEstado(HOY);
  for (let i = 0; i < 5; i++) {
    estado.tarjetas[`srv-${i}`] = { caja: 4, pendiente: false };
  }
  // Una consolidada pero PENDIENTE (fallada después de consolidarse): no debe descartarse.
  estado.tarjetas['srv-5'] = { caja: 4, pendiente: true };

  const resultado = fusionarBancoExtra([{ id: 'srv-nueva-1' }, { id: 'srv-nueva-2' }], estado);
  assert.equal(resultado.anadidas, 2);
  assert.equal(resultado.total, 2000); // 2002 - 2 descartadas (las 2 primeras consolidadas)

  const idsFinales = new Set(leerBancoExtra().map((p) => p.id));
  assert.equal(idsFinales.has('srv-0'), false);
  assert.equal(idsFinales.has('srv-1'), false);
  assert.equal(idsFinales.has('srv-2'), true); // consolidada pero no hizo falta descartarla
  assert.equal(idsFinales.has('srv-5'), true); // consolidada y pendiente: nunca se descarta
  assert.equal(idsFinales.has('srv-nueva-1'), true);
  assert.equal(idsFinales.has('srv-nueva-2'), true);
});

test('fusionarBancoExtra: si no hay suficientes descartables, se queda por encima del tope (caso límite documentado)', () => {
  prepararGlobales();
  const existentes = Array.from({ length: 2000 }, (_, i) => ({ id: `srv-${i}` }));
  globalThis.localStorage.setItem('one.bancoExtra', JSON.stringify(existentes));
  const estado = crearEstado(HOY); // sin tarjetas: nada es "consolidado", nada es descartable.
  const resultado = fusionarBancoExtra([{ id: 'srv-nueva' }], estado);
  assert.equal(resultado.anadidas, 1);
  assert.equal(resultado.total, 2001);
});

// === sincronizarEstado ==============================================================================

test('sincronizarEstado: sin configuración, null y CERO peticiones', async () => {
  prepararGlobales();
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: { preguntas: [], enCola: 0 } }]);
  const resultado = await sincronizarEstado({ estado: crearEstado(HOY), banco: bancoMinimo(), hoy: HOY, fetchImpl: fetchFalso });
  assert.equal(resultado, null);
  assert.equal(fetchFalso.llamadas.length, 0);
});

test('sincronizarEstado: cabecera Authorization y cuerpo con resumen/idsConocidos/rutasAtomo', async () => {
  prepararGlobales({ conConfiguracion: true });
  globalThis.localStorage.setItem('one.bancoExtra', JSON.stringify([{ id: 'srv-conocida' }, { id: 'local-1' }]));
  globalThis.localStorage.setItem(
    'one.rutasAtomo',
    JSON.stringify([
      { area: 'economia', ruta: ['inflacion'], fecha: '2026-09-10' }, // dentro de los últimos 7 días
      { area: 'historia', ruta: ['edad-media'], fecha: '2026-08-01' }, // fuera de la ventana
    ])
  );
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: { preguntas: [], enCola: 3 } }]);
  const estado = crearEstado(HOY);

  const resultado = await sincronizarEstado({ estado, banco: bancoMinimo(), hoy: HOY, fetchImpl: fetchFalso });

  assert.deepEqual(resultado, { preguntas: [], enCola: 3 });
  assert.equal(fetchFalso.llamadas.length, 1);
  const { url, opciones } = fetchFalso.llamadas[0];
  assert.equal(url, `${URL_SERVIDOR}/estado`);
  assert.equal(opciones.method, 'POST');
  assert.equal(opciones.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(opciones.signal instanceof AbortSignal);

  const cuerpo = JSON.parse(opciones.body);
  assert.deepEqual(cuerpo.resumen.idsConocidos, ['srv-conocida']); // solo el id `srv-`
  assert.deepEqual(cuerpo.resumen.rutasAtomo, [{ area: 'economia', ruta: ['inflacion'] }]);
  assert.equal(cuerpo.resumen.areas.economia.nivel, 1);
  assert.equal(cuerpo.resumen.areas.economia.aciertoReciente, null);
});

for (const caso of [
  { nombre: '401', respuesta: { ok: false, status: 401, cuerpo: {} } },
  { nombre: '500', respuesta: { ok: false, status: 500, cuerpo: {} } },
  { nombre: 'red', respuesta: { lanza: new Error('fetch failed') } },
  { nombre: 'timeout', respuesta: { lanza: Object.assign(new Error('sin respuesta'), { name: 'TimeoutError' }) } },
]) {
  test(`sincronizarEstado: ${caso.nombre} devuelve null sin lanzar`, async () => {
    prepararGlobales({ conConfiguracion: true });
    const fetchFalso = crearFetchFalso([caso.respuesta]);
    const resultado = await sincronizarEstado({
      estado: crearEstado(HOY),
      banco: bancoMinimo(),
      hoy: HOY,
      fetchImpl: fetchFalso,
    });
    assert.equal(resultado, null);
  });
}

// === pedirTanda / consultarTrabajo / pedirSubtemas / reportarAlServidor ============================

test('pedirTanda: sin configuración, null y cero peticiones', async () => {
  prepararGlobales();
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: {} }]);
  const resultado = await pedirTanda({ area: 'economia', ruta: [], n: 10, fetchImpl: fetchFalso });
  assert.equal(resultado, null);
  assert.equal(fetchFalso.llamadas.length, 0);
});

test('pedirTanda: POST /generar con urgente:true siempre, devuelve trabajoId/estimadoSeg', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: { trabajoId: 't-1', enCola: 1, estimadoSeg: 90 } }]);
  const resultado = await pedirTanda({ area: 'economia', ruta: ['inflacion'], n: 10, fetchImpl: fetchFalso });
  assert.deepEqual(resultado, { trabajoId: 't-1', estimadoSeg: 90 });
  const { url, opciones } = fetchFalso.llamadas[0];
  assert.equal(url, `${URL_SERVIDOR}/generar`);
  assert.equal(opciones.headers.Authorization, `Bearer ${TOKEN}`);
  const cuerpo = JSON.parse(opciones.body);
  assert.deepEqual(cuerpo, { area: 'economia', ruta: ['inflacion'], n: 10, urgente: true });
});

test('pedirTanda: error del servidor → null', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([{ ok: false, status: 503, cuerpo: { error: 'La cola está llena' } }]);
  const resultado = await pedirTanda({ area: 'economia', fetchImpl: fetchFalso });
  assert.equal(resultado, null);
});

test('consultarTrabajo: GET /trabajo/:id con el id codificado, devuelve el objeto tal cual', async () => {
  prepararGlobales({ conConfiguracion: true });
  const cuerpo = { estado: 'parcial', hechas: 5, pedidas: 10, preguntas: [], motivo: null };
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo }]);
  const resultado = await consultarTrabajo('t 1', { fetchImpl: fetchFalso });
  assert.deepEqual(resultado, cuerpo);
  assert.equal(fetchFalso.llamadas[0].url, `${URL_SERVIDOR}/trabajo/${encodeURIComponent('t 1')}`);
});

test('consultarTrabajo: 404 (trabajo no encontrado) → null', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([{ ok: false, status: 404, cuerpo: { error: 'Trabajo no encontrado' } }]);
  assert.equal(await consultarTrabajo('inexistente', { fetchImpl: fetchFalso }), null);
});

test('pedirSubtemas: cachea en memoria por [area, ruta] — la segunda llamada no repite la petición', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: { subtemas: [{ indice: 0, corto: 'A', completo: 'A' }] } }]);
  const clave = { area: 'economia', ruta: ['ronda-final-de-la-tarea-1'] }; // ruta única: sin choque de caché con otros tests
  const r1 = await pedirSubtemas({ ...clave, fetchImpl: fetchFalso });
  const r2 = await pedirSubtemas({ ...clave, fetchImpl: fetchFalso });
  assert.deepEqual(r1, [{ indice: 0, corto: 'A', completo: 'A' }]);
  assert.deepEqual(r2, r1);
  assert.equal(fetchFalso.llamadas.length, 1);
});

test('pedirSubtemas: error del servidor → null y no se cachea (la siguiente llamada reintenta)', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([
    { ok: false, status: 503, cuerpo: {} },
    { ok: true, cuerpo: { subtemas: [{ indice: 0, corto: 'B', completo: 'B' }] } },
  ]);
  const clave = { area: 'historia', ruta: ['sin-cachear-el-fallo-tarea-1'] };
  assert.equal(await pedirSubtemas({ ...clave, fetchImpl: fetchFalso }), null);
  const segundo = await pedirSubtemas({ ...clave, fetchImpl: fetchFalso });
  assert.deepEqual(segundo, [{ indice: 0, corto: 'B', completo: 'B' }]);
  assert.equal(fetchFalso.llamadas.length, 2);
});

test('reportarAlServidor: sin configuración, null y cero peticiones', async () => {
  prepararGlobales();
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: { ok: true } }]);
  assert.equal(await reportarAlServidor({ id: 'srv-1', fetchImpl: fetchFalso }), null);
  assert.equal(fetchFalso.llamadas.length, 0);
});

test('reportarAlServidor: POST /reportar con id+motivo, devuelve {ok:true}', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([{ ok: true, cuerpo: { ok: true } }]);
  const resultado = await reportarAlServidor({ id: 'srv-1', motivo: 'está mal', fetchImpl: fetchFalso });
  assert.deepEqual(resultado, { ok: true });
  const { url, opciones } = fetchFalso.llamadas[0];
  assert.equal(url, `${URL_SERVIDOR}/reportar`);
  assert.deepEqual(JSON.parse(opciones.body), { id: 'srv-1', motivo: 'está mal' });
});

test('reportarAlServidor: error del servidor → null', async () => {
  prepararGlobales({ conConfiguracion: true });
  const fetchFalso = crearFetchFalso([{ ok: false, status: 500, cuerpo: {} }]);
  assert.equal(await reportarAlServidor({ id: 'srv-1', fetchImpl: fetchFalso }), null);
});
