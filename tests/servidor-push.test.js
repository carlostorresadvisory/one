// Tests de los avisos Web Push del servidor (v0.3.4 objetivo C): servidor/push.js, el gancho de
// servidor/cola.js (`alTerminar`, `suscribirATrabajo`) y las rutas GET /vapid y POST /suscribir de
// servidor/index.js. Sin red: el envío de web-push es una función falsa que apunta lo que se le manda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crearAlmacen } from '../servidor/almacen.js';
import { crearCola } from '../servidor/cola.js';
import { crearServidor } from '../servidor/index.js';
import { crearPush, normalizarSuscripcion, normalizarTema, normalizarUrlAviso } from '../servidor/push.js';

const TOKEN = 'token-de-prueba-0123456789abcdef0123456789abcdef';
const CLAVE_PUBLICA = 'BPublicaDePruebaPublicaDePruebaPublicaDePruebaPublicaDePruebaPublicaDePruebaPublicaDePrueba';

function suscripcion(n = 1, base = 'https://fcm.googleapis.com/fcm/send') {
  return { endpoint: `${base}/dispositivo-${n}`, expirationTime: null, keys: { p256dh: `clave_p256dh_${n}`, auth: `auth_${n}` } };
}

async function carpetaTmp() {
  return mkdtemp(path.join(os.tmpdir(), 'one-push-'));
}

async function hastaQue(condicion, { intentos = 2400, esperaMs = 5 } = {}) {
  for (let i = 0; i < intentos; i++) {
    if (await condicion()) return;
    await new Promise((resolver) => setTimeout(resolver, esperaMs));
  }
  throw new Error('hastaQue: la condición no se cumplió a tiempo');
}

function aprobada(i) {
  return { id: `srv-eco-${i}-${Math.random().toString(36).slice(2, 8)}`, area: 'economia', tipo: 'vf', nivel: 2, enunciado: `Enunciado ${i}`, explicacion: 'x', respuesta: true, visual: null };
}

function resultado(n, aprobadas, fallos = []) {
  return { aprobadas: Array.from({ length: aprobadas }, (_, i) => aprobada(i)), rechazadas: [], coste: 0, modelos: ['m'], fallos, pedidas: n, obtenidas: aprobadas };
}

/** Envío falso: apunta (suscripción, payload ya parseado); `fallos` = {endpoint: statusCode} para simular errores. */
function envioFalso(fallos = {}) {
  const enviados = [];
  const enviar = async (sub, texto) => {
    const codigo = fallos[sub.endpoint];
    if (codigo) throw Object.assign(new Error(`push ${codigo}`), { statusCode: codigo });
    enviados.push({ endpoint: sub.endpoint, payload: JSON.parse(texto) });
  };
  return { enviar, enviados };
}

// === Validación ===================================================================================

test('normalizarSuscripcion: acepta los servicios de push de los navegadores y quita lo que sobra', () => {
  for (const base of [
    'https://fcm.googleapis.com/fcm/send',
    'https://web.push.apple.com',
    'https://updates.push.services.mozilla.com/wpush/v2',
    'https://par02p.notify.windows.com/w',
  ]) {
    const limpia = normalizarSuscripcion({ ...suscripcion(1, base), extra: 'fuera' });
    assert.deepEqual(Object.keys(limpia).sort(), ['endpoint', 'keys']);
    assert.equal(limpia.endpoint, `${base}/dispositivo-1`);
  }
});

test('normalizarSuscripcion: rechaza http, hosts ajenos (SSRF), claves raras y formas inválidas', () => {
  assert.equal(normalizarSuscripcion(null), null);
  assert.equal(normalizarSuscripcion('texto'), null);
  assert.equal(normalizarSuscripcion({ endpoint: 'http://fcm.googleapis.com/x', keys: suscripcion().keys }), null);
  assert.equal(normalizarSuscripcion({ endpoint: 'https://evil.example.com/push', keys: suscripcion().keys }), null);
  assert.equal(normalizarSuscripcion({ endpoint: 'https://fcm.googleapis.com.evil.com/x', keys: suscripcion().keys }), null);
  assert.equal(normalizarSuscripcion({ endpoint: 'https://127.0.0.1/x', keys: suscripcion().keys }), null);
  assert.equal(normalizarSuscripcion({ endpoint: 'no es una url', keys: suscripcion().keys }), null);
  assert.equal(normalizarSuscripcion({ endpoint: suscripcion().endpoint }), null);
  assert.equal(normalizarSuscripcion({ endpoint: suscripcion().endpoint, keys: { p256dh: 'a b', auth: 'x' } }), null);
  assert.equal(normalizarSuscripcion({ endpoint: suscripcion().endpoint, keys: { p256dh: 'a'.repeat(300), auth: 'x' } }), null);
  assert.equal(normalizarSuscripcion({ endpoint: `https://fcm.googleapis.com/${'a'.repeat(700)}`, keys: suscripcion().keys }), null);
});

test('normalizarTema y normalizarUrlAviso: texto corto sin control; la URL solo puede ser relativa al alcance de la app', () => {
  assert.equal(normalizarTema('  Roma  '), 'Roma');
  assert.equal(normalizarTema('x'.repeat(200)).length, 60);
  assert.equal(normalizarTema('mal\ntema'), '');
  assert.equal(normalizarTema(42), '');
  assert.equal(normalizarUrlAviso('./'), './');
  assert.equal(normalizarUrlAviso('./?tema=%5B%22historia%22%5D'), './?tema=%5B%22historia%22%5D');
  for (const mala of ['https://evil.example.com/', '//evil.example.com', '/otra', 'javascript:alert(1)', './?a b', `./?${'x'.repeat(1600)}`, undefined]) {
    assert.equal(normalizarUrlAviso(mala), './', String(mala).slice(0, 30));
  }
});

// === crearPush ====================================================================================

test('suscribir guarda una suscripción por endpoint en suscripciones.json y la repetida no se duplica', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const push = crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar: envioFalso().enviar });
  assert.equal(await push.suscribir(suscripcion(1)), suscripcion(1).endpoint);
  await push.suscribir(suscripcion(1));
  await push.suscribir(suscripcion(2));
  assert.equal(await push.suscribir({ endpoint: 'https://evil.example.com/x', keys: suscripcion().keys }), null);
  const enDisco = JSON.parse(await readFile(path.join(dir, 'suscripciones.json'), 'utf8'));
  assert.deepEqual(Object.keys(enDisco).sort(), [suscripcion(1).endpoint, suscripcion(2).endpoint].sort());
  assert.equal(enDisco[suscripcion(1).endpoint].subscription.keys.auth, 'auth_1');
});

test('suscribir respeta el tope: con el cupo lleno se desaloja la suscripción más antigua', async () => {
  const almacen = crearAlmacen(await carpetaTmp());
  const push = crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar: envioFalso().enviar, maxSuscripciones: 3 });
  for (let n = 1; n <= 5; n++) {
    await push.suscribir(suscripcion(n));
    await new Promise((resolver) => setTimeout(resolver, 3)); // `creada` distinta
  }
  const guardadas = Object.keys(await almacen.leerSuscripciones()).sort();
  assert.deepEqual(guardadas, [3, 4, 5].map((n) => suscripcion(n).endpoint));
});

test('suscripciones concurrentes no se pisan (cerrojo del fichero)', async () => {
  const almacen = crearAlmacen(await carpetaTmp());
  const push = crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar: envioFalso().enviar });
  await Promise.all([1, 2, 3, 4, 5, 6].map((n) => push.suscribir(suscripcion(n))));
  assert.equal(Object.keys(await almacen.leerSuscripciones()).length, 6);
});

test('avisarTanda manda «Preguntas listas · tema · N ▶» con la URL del tema, solo a los endpoints pedidos', async () => {
  const almacen = crearAlmacen(await carpetaTmp());
  const { enviar, enviados } = envioFalso();
  const push = crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar });
  await push.suscribir(suscripcion(1));
  await push.suscribir(suscripcion(2));
  const url = './?tema=%5B%22historia%22%2C%5B%22Roma%22%5D%2C%5B%22Roma%22%5D%5D';
  const n = await push.avisarTanda({ endpoints: [suscripcion(1).endpoint, 'https://fcm.googleapis.com/desconocido'], tema: 'Roma', n: 100, url, etiqueta: 't-1' });
  assert.equal(n, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].endpoint, suscripcion(1).endpoint);
  assert.deepEqual(enviados[0].payload, { titulo: 'Preguntas listas · Roma · 100 ▶', cuerpo: 'Toca para jugarlas', url, etiqueta: 't-1' });
});

test('avisarTanda: sin tema usa «tu tema»; una URL ajena se sustituye por «./»', async () => {
  const almacen = crearAlmacen(await carpetaTmp());
  const { enviar, enviados } = envioFalso();
  const push = crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar });
  await push.suscribir(suscripcion(1));
  await push.avisarTanda({ endpoints: [suscripcion(1).endpoint], tema: undefined, n: 10, url: 'https://evil.example.com/' });
  assert.equal(enviados[0].payload.titulo, 'Preguntas listas · tu tema · 10 ▶');
  assert.equal(enviados[0].payload.url, './');
});

test('avisarTanda borra la suscripción si el servicio responde 404 o 410, y conserva la que falla por otra causa', async () => {
  const almacen = crearAlmacen(await carpetaTmp());
  const { enviar, enviados } = envioFalso({ [suscripcion(1).endpoint]: 410, [suscripcion(2).endpoint]: 404, [suscripcion(3).endpoint]: 500 });
  const push = crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar });
  for (const n of [1, 2, 3, 4]) await push.suscribir(suscripcion(n));
  const mudo = console.error;
  console.error = () => {};
  let enviadosOk;
  try {
    enviadosOk = await push.avisarTanda({ endpoints: [1, 2, 3, 4].map((n) => suscripcion(n).endpoint), tema: 'Roma', n: 10, url: './' });
  } finally {
    console.error = mudo;
  }
  assert.equal(enviadosOk, 1, 'el fallo de uno no impide avisar a los demás');
  assert.deepEqual(enviados.map((e) => e.endpoint), [suscripcion(4).endpoint]);
  assert.deepEqual(Object.keys(await almacen.leerSuscripciones()).sort(), [suscripcion(3).endpoint, suscripcion(4).endpoint].sort());
});

test('sin claves o sin envío el push está inactivo y no manda nada', async () => {
  const almacen = crearAlmacen(await carpetaTmp());
  const { enviar, enviados } = envioFalso();
  assert.equal(crearPush({ almacen, vapidPublica: '', enviar }).activo, false);
  assert.equal(crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar: null }).activo, false);
  const inactivo = crearPush({ almacen, vapidPublica: '', enviar });
  await inactivo.suscribir(suscripcion(1));
  assert.equal(await inactivo.avisarTanda({ endpoints: [suscripcion(1).endpoint], tema: 'x', n: 1, url: './' }), 0);
  assert.equal(enviados.length, 0);
});

// === Cola: el gancho de fin de tanda ================================================================

async function colaConAvisos({ producirTanda, alTerminar }) {
  const almacen = crearAlmacen(await carpetaTmp());
  return crearCola({ almacen, producirTanda, opciones: {}, alTerminar });
}

test('cola: una tanda urgente de 10 avisa UNA vez, al final (no entre sus dos lotes), con el nº de preguntas', async () => {
  const avisos = [];
  const cola = await colaConAvisos({ producirTanda: async ({ n }) => resultado(n, n), alTerminar: async (info) => { avisos.push(info); } });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  assert.equal(cola.suscribirATrabajo(trabajoId, 'https://fcm.googleapis.com/a', { tema: 'Roma', url: './' }), true);
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
  await hastaQue(() => avisos.length > 0);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].trabajoId, trabajoId);
  assert.equal(avisos[0].estado, 'lista');
  assert.equal(avisos[0].n, 10);
  assert.deepEqual(avisos[0].aviso, { tema: 'Roma', url: './' });
  assert.deepEqual(avisos[0].endpoints, ['https://fcm.googleapis.com/a']);
});

test('cola: una tanda que termina «parcial» (algún lote falló pero hay preguntas) también avisa, con lo que haya', async () => {
  const avisos = [];
  let lote = 0;
  const cola = await colaConAvisos({
    producirTanda: async ({ n }) => (++lote === 1 ? resultado(n, n) : resultado(n, Math.min(n, 2), [{ tipo: 'vf', motivo: 'cascada agotada' }])),
    alTerminar: async (info) => { avisos.push(info); },
  });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  cola.suscribirATrabajo(trabajoId, 'https://fcm.googleapis.com/a', { tema: 'Roma' });
  await hastaQue(() => avisos.length > 0);
  assert.equal(avisos[0].estado, 'parcial');
  assert.equal(avisos[0].n, 10, 'se siguió pidiendo hasta completar las 10 aprobadas');
  assert.equal(avisos.length, 1);
});

test('cola: una tanda sin ninguna pregunta (fallida) no avisa', async () => {
  const avisos = [];
  const cola = await colaConAvisos({ producirTanda: async ({ n }) => resultado(n, 0), alTerminar: async (info) => { avisos.push(info); } });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  cola.suscribirATrabajo(trabajoId, 'https://fcm.googleapis.com/a', {});
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'fallida');
  await new Promise((resolver) => setTimeout(resolver, 30));
  assert.equal(avisos.length, 0);
});

test('cola: sin dispositivos suscritos no hay aviso; los trabajos de fondo o desconocidos no admiten suscripción', async () => {
  const avisos = [];
  const cola = await colaConAvisos({ producirTanda: async ({ n }) => resultado(n, n), alTerminar: async (info) => { avisos.push(info); } });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  const fondo = cola.encolar({ area: 'historia', n: 10, urgente: false });
  assert.equal(cola.suscribirATrabajo(fondo.trabajoId, 'https://fcm.googleapis.com/a', {}), false);
  assert.equal(cola.suscribirATrabajo('no-existe', 'https://fcm.googleapis.com/a', {}), false);
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
  await new Promise((resolver) => setTimeout(resolver, 30));
  assert.equal(avisos.length, 0);
});

test('cola: suscribirse cuando la tanda ya terminó avisa en el acto, y el mismo dispositivo no recibe dos avisos', async () => {
  const avisos = [];
  const cola = await colaConAvisos({ producirTanda: async ({ n }) => resultado(n, n), alTerminar: async (info) => { avisos.push(info); } });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
  assert.equal(cola.suscribirATrabajo(trabajoId, 'https://fcm.googleapis.com/a', { tema: 'Roma' }), true);
  await hastaQue(() => avisos.length > 0);
  cola.suscribirATrabajo(trabajoId, 'https://fcm.googleapis.com/a', { tema: 'Roma' });
  cola.suscribirATrabajo(trabajoId, 'https://fcm.googleapis.com/b', { tema: 'Roma' });
  await hastaQue(() => avisos.length > 1);
  assert.deepEqual(avisos.map((a) => a.endpoints), [['https://fcm.googleapis.com/a'], ['https://fcm.googleapis.com/b']]);
});

test('cola: el tope de dispositivos por tanda es 5; y un fallo del aviso no rompe la cola', async () => {
  const cola = await colaConAvisos({ producirTanda: async ({ n }) => resultado(n, n), alTerminar: async () => { throw new Error('push caído'); } });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  const aceptadas = [1, 2, 3, 4, 5, 6, 7].map((n) => cola.suscribirATrabajo(trabajoId, `https://fcm.googleapis.com/${n}`, {}));
  assert.deepEqual(aceptadas, [true, true, true, true, true, false, false]);
  const mudo = console.error;
  console.error = () => {};
  try {
    await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
    await new Promise((resolver) => setTimeout(resolver, 30));
  } finally {
    console.error = mudo;
  }
  const otra = cola.encolar({ area: 'economia', n: 10, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(otra.trabajoId).estado === 'lista');
});

// === API: GET /vapid y POST /suscribir =============================================================

async function servidorDePrueba({ conPush = true, fallos = {}, producirTanda } = {}) {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const { enviar, enviados } = envioFalso(fallos);
  const push = conPush ? crearPush({ almacen, vapidPublica: CLAVE_PUBLICA, enviar }) : crearPush({ almacen });
  const cola = crearCola({
    almacen,
    producirTanda: producirTanda || (async ({ n }) => resultado(n, n)),
    opciones: {},
    alTerminar: ({ n, aviso, endpoints, trabajoId }) => push.avisarTanda({ endpoints, tema: aviso.tema, n, url: aviso.url, etiqueta: trabajoId }),
  });
  const servidor = crearServidor({ cola, almacen, token: TOKEN, rutaDatos: dir, push });
  await new Promise((resolver) => servidor.listen(0, resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cabeceras = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  return {
    base, cabeceras, almacen, enviados, cola,
    post: (ruta, cuerpo) => fetch(`${base}${ruta}`, { method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo) }),
    cerrar: () => new Promise((resolver) => { servidor.closeAllConnections?.(); servidor.close(() => resolver()); }),
  };
}

test('GET /vapid: pide token; con claves devuelve la pública; sin claves dice «activa: false»', async () => {
  const con = await servidorDePrueba();
  const sin = await servidorDePrueba({ conPush: false });
  try {
    assert.equal((await fetch(`${con.base}/vapid`)).status, 401);
    const resp = await fetch(`${con.base}/vapid`, { headers: con.cabeceras });
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { activa: true, publica: CLAVE_PUBLICA });
    const respSin = await fetch(`${sin.base}/vapid`, { headers: sin.cabeceras });
    assert.equal(respSin.status, 200);
    assert.deepEqual(await respSin.json(), { activa: false });
  } finally {
    await con.cerrar();
    await sin.cerrar();
  }
});

test('POST /suscribir: sin token 401; suscripción inválida 400; sin claves en el servidor no guarda nada', async () => {
  const con = await servidorDePrueba();
  const sin = await servidorDePrueba({ conPush: false });
  try {
    const sinToken = await fetch(`${con.base}/suscribir`, { method: 'POST', body: '{}' });
    assert.equal(sinToken.status, 401);
    assert.equal((await con.post('/suscribir', { suscripcion: { endpoint: 'https://evil.example.com/x', keys: suscripcion().keys } })).status, 400);
    assert.equal((await con.post('/suscribir', {})).status, 400);
    const resp = await sin.post('/suscribir', { suscripcion: suscripcion(1) });
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { ok: false, activa: false });
    assert.deepEqual(await sin.almacen.leerSuscripciones(), {});
  } finally {
    await con.cerrar();
    await sin.cerrar();
  }
});

test('flujo completo: /generar → /suscribir con el id → al terminar llega «Preguntas listas · Roma · 10 ▶» con la URL del tema', async () => {
  let soltar;
  const puerta = new Promise((resolver) => { soltar = resolver; });
  const srv = await servidorDePrueba({ producirTanda: async ({ n }) => { await puerta; return resultado(n, n); } });
  try {
    const gen = await (await srv.post('/generar', { area: 'economia', ruta: [], n: 10, urgente: true })).json();
    const url = './?tema=%5B%22economia%22%2C%5B%5D%2C%5B%5D%5D';
    const resp = await srv.post('/suscribir', { suscripcion: suscripcion(1), trabajoId: gen.trabajoId, tema: 'Roma', url });
    assert.deepEqual(await resp.json(), { ok: true, trabajo: true });
    assert.deepEqual(Object.keys(await srv.almacen.leerSuscripciones()), [suscripcion(1).endpoint]);
    assert.equal(srv.enviados.length, 0, 'todavía no ha terminado');
    soltar();
    await hastaQue(() => srv.enviados.length > 0);
    assert.equal(srv.enviados.length, 1);
    assert.deepEqual(srv.enviados[0].payload, { titulo: 'Preguntas listas · Roma · 10 ▶', cuerpo: 'Toca para jugarlas', url, etiqueta: gen.trabajoId });
  } finally {
    soltar();
    await srv.cerrar();
  }
});

test('POST /suscribir con un trabajoId que no existe guarda el dispositivo pero no lo apunta a ninguna tanda', async () => {
  const srv = await servidorDePrueba();
  try {
    const resp = await srv.post('/suscribir', { suscripcion: suscripcion(1), trabajoId: 'inventado' });
    assert.deepEqual(await resp.json(), { ok: true, trabajo: false });
    assert.equal(Object.keys(await srv.almacen.leerSuscripciones()).length, 1);
    const sinId = await srv.post('/suscribir', { suscripcion: suscripcion(2) });
    assert.deepEqual(await sinId.json(), { ok: true, trabajo: false });
  } finally {
    await srv.cerrar();
  }
});

test('flujo: si el servicio de push responde 410 al avisar, la suscripción desaparece de suscripciones.json', async () => {
  const srv = await servidorDePrueba({ fallos: { [suscripcion(1).endpoint]: 410 } });
  try {
    const gen = await (await srv.post('/generar', { area: 'economia', ruta: [], n: 10, urgente: true })).json();
    await srv.post('/suscribir', { suscripcion: suscripcion(1), trabajoId: gen.trabajoId, tema: 'Roma' });
    await hastaQue(async () => Object.keys(await srv.almacen.leerSuscripciones()).length === 0);
  } finally {
    await srv.cerrar();
  }
});
