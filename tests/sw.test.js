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

test('sw: caché one-v27', () => {
  assert.match(sw, /const CACHE = 'one-v27';/);
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

test('sw: las imágenes del banco no se precachean pero se cachean al verlas, con tope', () => {
  const precacheadas = [...lista('NUCLEO'), ...lista('SECUNDARIOS'), ...lista('AVATAR'), ...lista('AVATAR_GESTOS')];
  assert.ok(!precacheadas.some((r) => /imagenes-(ia|banco|hub)\//.test(r)), 'ninguna imagen del banco en el precaché');
  assert.ok(lista('SECUNDARIOS').includes('datos/imagenes.json'));
  assert.match(sw, /cache\.put\(claveCache/, 'el fetch guarda cualquier GET del mismo origen');
  assert.match(sw, /MAX_BYTES_IMAGENES = /);
  assert.doesNotMatch(sw, /MAX_IMAGENES_CACHE/, 'el tope ya no cuenta imágenes sino bytes');
});

test('sw: precaché + gestos + tope de imágenes por bytes <= 5 MB (medido)', () => {
  const tope = Number(sw.match(/MAX_BYTES_IMAGENES = ([\d* ]+);/)[1].split('*').reduce((a, b) => a * Number(b), 1));
  const rutas = [...lista('NUCLEO'), ...lista('SECUNDARIOS'), ...lista('AVATAR'), ...lista('AVATAR_GESTOS')].filter((r) => r !== './');
  const total = rutas.reduce((suma, ruta) => suma + statSync(new URL(`../${ruta}`, import.meta.url)).size, 0);
  assert.ok(total + tope <= 5 * 1024 * 1024, `${((total + tope) / 1048576).toFixed(2)} MB`);
});

// El tope por bytes se prueba ejecutando el sw.js real con una caché falsa.
test('sw: acotarImagenes borra las más antiguas hasta que las imágenes caben en el tope de bytes', async () => {
  const vm = await import('node:vm');
  const almacen = new Map();
  const cache = {
    keys: async () => [...almacen.keys()].map((url) => new Request(url)),
    match: async (r) => { const b = almacen.get(r.url); return b ? new Response(b) : undefined; },
    delete: async (r) => almacen.delete(r.url),
  };
  const contexto = vm.createContext({ self: { addEventListener() {}, location: { origin: 'https://x' } }, URL, Request, Response, caches: {}, fetch() {} });
  vm.runInContext(sw, contexto);
  const tope = vm.runInContext('MAX_BYTES_IMAGENES', contexto);
  const trozo = Math.floor(tope / 3) + 1; // 3 no caben: solo las 2 más nuevas
  for (const n of ['a', 'b', 'c']) almacen.set(`https://x/imagenes-ia/${n}.webp`, new Uint8Array(trozo));
  almacen.set('https://x/app.js', new Uint8Array(tope * 4)); // lo que no es imagen no cuenta ni se toca
  await vm.runInContext('acotarImagenes', contexto)(cache);
  assert.deepEqual([...almacen.keys()], ['https://x/imagenes-ia/b.webp', 'https://x/imagenes-ia/c.webp', 'https://x/app.js']);
});
