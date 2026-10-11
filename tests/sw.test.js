// Guarda del despliegue (v0.3): todo módulo que app.js carga -- import estático o import() perezoso,
// recorriendo también los imports de esos módulos -- tiene que estar en NUCLEO, o offline la app no
// arranca / se queda muda (mismo fallo que el hallazgo M1 de v0.1e, ver comentario en sw.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const leer = (fichero) => readFileSync(new URL(`../${fichero}`, import.meta.url), 'utf8');
const sw = leer('sw.js');

function lista(nombre) {
  const m = sw.match(new RegExp(String.raw`const ${nombre} = \[([^\]]*)\]`));
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function modulosLocales(fichero, vistos = new Set()) {
  if (vistos.has(fichero)) return vistos;
  vistos.add(fichero);
  const fuente = leer(fichero);
  for (const m of fuente.matchAll(/(?:import|export)\s[^'"]*?from\s+'\.\/([^']+)'|import\(\s*'\.\/([^']+)'\s*\)/g)) {
    modulosLocales(m[1] || m[2], vistos);
  }
  return vistos;
}

test('sw: caché one-v34', () => {
  assert.match(sw, /const CACHE = 'one-v34';/);
});

test('sw: todo módulo que app.js carga está en NUCLEO', () => {
  const nucleo = new Set(lista('NUCLEO'));
  // depurar-sonido.js es una herramienta de diagnóstico (?depurar=sonido) que se usa con red: no se precachea a propósito.
  const sinPrecache = new Set(['depurar-sonido.js']);
  for (const fichero of modulosLocales('app.js')) {
    if (sinPrecache.has(fichero)) continue;
    assert.ok(nucleo.has(fichero), `${fichero} falta en NUCLEO de sw.js`);
  }
});

test('sw: la caché de la app (con todos los clips del avatar) no pasa de 5 MB', () => {
  const rutas = [...lista('NUCLEO'), ...lista('SECUNDARIOS'), ...lista('AVATAR'), ...lista('AVATAR_GESTOS')].filter((r) => r !== './');
  const total = rutas.reduce((suma, ruta) => suma + statSync(new URL(`../${ruta}`, import.meta.url)).size, 0);
  assert.ok(total < 5 * 1024 * 1024, `caché de ${(total / 1048576).toFixed(2)} MB`);
});

test('sw: se precachea el reposo, las anclas y las imágenes fijas; los gestos solo al primer uso', () => {
  const avatar = lista('AVATAR');
  assert.ok(avatar.includes('avatar/reposo.mp4') && avatar.includes('avatar/anclas.json'));
  for (const f of ['neutral', 'contenta', 'triste', 'euforica']) assert.ok(avatar.includes(`avatar/${f}.webp`), f);
  const gestos = lista('AVATAR_GESTOS');
  assert.equal(gestos.length, 6);
  for (const g of gestos) assert.ok(!avatar.includes(g), `${g} no se precachea`);
  assert.match(sw, /\.\.\.SECUNDARIOS, \.\.\.AVATAR\]/);
  assert.doesNotMatch(sw, /AVATAR_GESTOS\.map|addAll\(\[[^\]]*AVATAR_GESTOS/);
});

test('sw: los puentes de anclas.json van en la precarga tolerante del avatar (y solo ésos)', () => {
  const anclas = JSON.parse(leer('avatar/anclas.json'));
  const declarados = Object.values(anclas.puentes).map((f) => `avatar/${f}`).sort();
  assert.ok(declarados.length >= 8, 'puntos de salida repartidos por el bucle');
  assert.deepEqual(lista('AVATAR').filter((r) => /puente-/.test(r)).sort(), declarados);
  for (const r of declarados) assert.ok(statSync(new URL(`../${r}`, import.meta.url)).size > 0, r);
  const peso = declarados.reduce((suma, r) => suma + statSync(new URL(`../${r}`, import.meta.url)).size, 0);
  assert.ok(peso <= 300 * 1024, `puentes: ${(peso / 1024).toFixed(0)} KB`);
});

test('sw: las fotos de preguntas no se precachean (van a una caché aparte con tope por bytes); las 6 del hub sí', () => {
  const precacheadas = [...lista('NUCLEO'), ...lista('SECUNDARIOS'), ...lista('AVATAR'), ...lista('AVATAR_GESTOS')];
  assert.ok(!precacheadas.some((r) => /imagenes-(ia|banco)\//.test(r)), 'ninguna foto de pregunta en el precaché');
  assert.equal(lista('SECUNDARIOS').filter((r) => r.startsWith('imagenes-hub/')).length, 6, 'las 6 fotos del hub, offline');
  assert.ok(lista('SECUNDARIOS').includes('datos/imagenes.json'));
  assert.match(sw, /CACHE_FOTOS = 'one-fotos'/);
  assert.doesNotMatch(sw, /MAX_FOTOS/);
  assert.match(sw, /MAX_BYTES_FOTOS = 8 \* 1024 \* 1024;/);
  assert.match(sw, /MAX_NUM_FOTOS = 120;/);
  assert.doesNotMatch(sw, /MAX_BYTES_IMAGENES|256 \* 1024|acotarImagenes/, 'el tope de 256 KB y su caché compartida ya no existen');
});

// Los tests de abajo ejecutan el sw.js real con cachés falsas.
async function montarSw({ red = async () => new Response(new Uint8Array(10)) } = {}) {
  const vm = await import('node:vm');
  const almacenes = new Map();
  const abrir = (nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
    const datos = almacenes.get(nombre);
    return {
      datos,
      keys: async () => [...datos.keys()].map((url) => new Request(url)),
      match: async (r) => { const b = datos.get(typeof r === 'string' ? r : r.url); return b ? new Response(b) : undefined; },
      put: async (r, resp) => { datos.set(typeof r === 'string' ? r : r.url, new Uint8Array(await resp.arrayBuffer())); },
      delete: async (r) => datos.delete(typeof r === 'string' ? r : r.url),
    };
  };
  const manejadores = {};
  const llamadas = [];
  const esperas = [];
  const plazos = []; // temporizadores de plazo de petición: no corren solos, el test los dispara
  const caches = {
    open: async (n) => abrir(n),
    keys: async () => [...almacenes.keys()],
    delete: async (n) => almacenes.delete(n),
  };
  const contexto = vm.createContext({
    self: { addEventListener: (t, f) => { manejadores[t] = f; }, location: { origin: 'https://x' }, skipWaiting() {}, clients: { claim() {} } },
    URL, Request, Response, caches,
    AbortController,
    clearTimeout: (id) => { const i = plazos.findIndex((p) => p.id === id); if (i >= 0) plazos.splice(i, 1); else clearTimeout(id); },
    setTimeout: (fn, ms) => {
      if (ms === 15000) { const id = `plazo${plazos.length}${Math.random()}`; plazos.push({ id, fn }); return id; }
      esperas.push(ms); return setTimeout(fn, 0);
    },
    fetch: async (r, opciones) => { llamadas.push([typeof r === 'string' ? r : r.url, opciones]); return red(r, opciones); },
  });
  vm.runInContext(sw, contexto);
  const pedir = (url, destination = 'image') => {
    let promesa = null;
    const peticion = new Request(url);
    Object.defineProperty(peticion, 'destination', { value: destination });
    manejadores.fetch({ request: peticion, respondWith: (p) => { promesa = p; }, waitUntil() {} });
    return promesa;
  };
  const pausa = () => new Promise((r) => setTimeout(r, 20));
  return { vm, contexto, almacenes, abrir, manejadores, llamadas, esperas, plazos, pedir, pausa };
}

test('sw: acotarFotos borra las más antiguas hasta que caben en el tope de bytes', async () => {
  const { abrir, vm, contexto } = await montarSw();
  const cache = abrir('x');
  const tope = vm.runInContext('MAX_BYTES_FOTOS', contexto);
  const trozo = Math.floor(tope / 3) + 1; // 3 no caben: solo las 2 más nuevas
  for (const n of ['a', 'b', 'c']) cache.datos.set(`https://x/imagenes-ia/${n}.webp`, new Uint8Array(trozo));
  await vm.runInContext('acotarFotos', contexto)(cache);
  assert.deepEqual([...cache.datos.keys()], ['https://x/imagenes-ia/b.webp', 'https://x/imagenes-ia/c.webp']);
});

test('sw: una foto propia va a one-fotos (no a la caché del núcleo) y la segunda vez sale de la caché', async () => {
  const sim = await montarSw();
  assert.equal((await sim.pedir('https://x/imagenes-banco/a.webp')).ok, true);
  await sim.pausa();
  assert.ok(sim.almacenes.get('one-fotos').has('https://x/imagenes-banco/a.webp'));
  assert.ok(!sim.almacenes.has('one-v34'), 'nada en la caché del núcleo');
  const antes = sim.llamadas.length;
  await sim.pedir('https://x/imagenes-banco/a.webp');
  assert.equal(sim.llamadas.length, antes, 'sin pedirla otra vez a la red');
});

test('sw: las fotos de Commons y las WebP del servidor se piden con CORS para guardarlas; si el origen lo niega, se enseñan sin guardar', async () => {
  const sim = await montarSw();
  await sim.pedir('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foto.jpg');
  await sim.pedir('https://servidor.ejemplo/imagenes/abc-1.webp');
  await sim.pausa();
  const fotos = sim.almacenes.get('one-fotos');
  assert.ok(fotos.has('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foto.jpg'));
  assert.ok(fotos.has('https://servidor.ejemplo/imagenes/abc-1.webp'));
  assert.ok(sim.llamadas.every(([, opciones]) => opciones?.mode === 'cors'));
  // Sin CORS: la primera petición falla, la segunda (opaca) se devuelve sin guardar.
  const sin = await montarSw({ red: async (r, opciones) => { if (opciones?.mode === 'cors') throw new TypeError('cors'); return Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaque' }); } });
  const respuesta = await sin.pedir('https://upload.wikimedia.org/wikipedia/commons/b/bc/Otra.jpg');
  assert.equal(respuesta.status, 200);
  await sin.pausa();
  assert.ok(!sin.almacenes.get('one-fotos')?.has('https://upload.wikimedia.org/wikipedia/commons/b/bc/Otra.jpg'));
});

test('sw: lo de otro origen que no es foto (otro dominio o destino que no es image) no se intercepta', async () => {
  const sim = await montarSw();
  assert.equal(sim.pedir('https://otro.com/logo.png'), null);
  assert.equal(sim.pedir('https://upload.wikimedia.org/x.json', 'empty'), null);
});

test('sw: al activar se borran las cachés viejas del núcleo pero nunca one-fotos', async () => {
  const sim = await montarSw();
  sim.abrir('one-v30'); sim.abrir('one-v34'); sim.abrir('one-fotos');
  let terminado = null;
  sim.manejadores.activate({ waitUntil: (p) => { terminado = p; } });
  await terminado;
  assert.deepEqual([...sim.almacenes.keys()].sort(), ['one-fotos', 'one-v34']);
});

test('sw: acotarFotos conserva como mucho 120 fotos (las más nuevas)', async () => {
  const { abrir, vm, contexto } = await montarSw();
  const cache = abrir('x');
  for (let n = 0; n < 125; n += 1) cache.datos.set(`https://x/imagenes-banco/${n}.webp`, new Uint8Array(10));
  await vm.runInContext('acotarFotos', contexto)(cache);
  assert.equal(cache.datos.size, 120);
  assert.ok(!cache.datos.has('https://x/imagenes-banco/0.webp') && cache.datos.has('https://x/imagenes-banco/124.webp'));
});

const COMMONS_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Foto.jpg';

test('sw: un 429 de Commons espera el Retry-After (máx. 2 s) y la segunda respuesta 200 se sirve y se guarda', async () => {
  let n = 0;
  const sim = await montarSw({ red: async () => (++n === 1 ? new Response('x', { status: 429, headers: { 'Retry-After': '1' } }) : new Response(new Uint8Array(10))) });
  const respuesta = await sim.pedir(COMMONS_URL);
  assert.equal(respuesta.status, 200);
  assert.deepEqual(sim.esperas, [1000]);
  await sim.pausa();
  assert.ok(sim.almacenes.get('one-fotos').has(COMMONS_URL));
});

test('sw: un 503 sin Retry-After espera 1 s; un Retry-After enorme se acota a 2 s', async () => {
  let n = 0;
  const sin = await montarSw({ red: async () => (++n === 1 ? new Response('x', { status: 503 }) : new Response(new Uint8Array(10))) });
  assert.equal((await sin.pedir('https://servidor.ejemplo/imagenes/a-1.webp')).status, 200);
  assert.deepEqual(sin.esperas, [1000]);
  let m = 0;
  const larga = await montarSw({ red: async () => (++m === 1 ? new Response('x', { status: 429, headers: { 'Retry-After': '120' } }) : new Response(new Uint8Array(10))) });
  await larga.pedir(COMMONS_URL);
  assert.deepEqual(larga.esperas, [2000]);
});

test('sw: dos 429 seguidos devuelven el error (un solo reintento) y no se guarda', async () => {
  const sim = await montarSw({ red: async () => new Response('x', { status: 429, headers: { 'Retry-After': '0' } }) });
  const respuesta = await sim.pedir(COMMONS_URL);
  assert.equal(respuesta.status, 429);
  assert.equal(sim.llamadas.length, 2);
  await sim.pausa();
  assert.ok(!sim.almacenes.get('one-fotos')?.has(COMMONS_URL));
});

test('sw: las peticiones a Commons van en cola de 2 a la vez', async () => {
  let activas = 0;
  let maximo = 0;
  const sim = await montarSw({ red: async () => { activas += 1; maximo = Math.max(maximo, activas); await new Promise((r) => setTimeout(r, 10)); activas -= 1; return new Response(new Uint8Array(10)); } });
  const respuestas = await Promise.all([1, 2, 3, 4, 5].map((i) => sim.pedir(`https://upload.wikimedia.org/wikipedia/commons/a/ab/F${i}.jpg`)));
  assert.ok(respuestas.every((r) => r.status === 200));
  assert.equal(maximo, 2);
  assert.equal(sim.llamadas.length, 5);
});

test('sw: una petición a Commons colgada se aborta al vencer su plazo (15 s), libera la plaza y la siguiente sale', async () => {
  const sim = await montarSw({ red: async (r, opciones) => {
    if (String(r).includes('Cuelga')) return new Promise((_, rechazar) => opciones.signal.addEventListener('abort', () => rechazar(new TypeError('abortada'))));
    return new Response(new Uint8Array(10));
  } });
  const colgadas = [1, 2].map((i) => sim.pedir(`https://upload.wikimedia.org/wikipedia/commons/a/ab/Cuelga${i}.jpg`));
  const tercera = sim.pedir('https://upload.wikimedia.org/wikipedia/commons/a/ab/Normal.jpg');
  await sim.pausa();
  assert.equal(sim.plazos.length, 2, 'dos colgadas ocupan las dos plazas; la tercera espera en cola');
  assert.equal(sim.llamadas.length, 2);
  sim.plazos.slice().forEach((p) => p.fn()); // vence el plazo de 15 s
  assert.equal((await tercera).status, 200, 'la tercera sale al liberarse una plaza');
  const resueltas = await Promise.all(colgadas); // las colgadas terminan (con la reserva opaca), no se quedan para siempre
  assert.equal(resueltas.length, 2);
});
