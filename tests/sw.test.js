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

test('sw: caché one-v25', () => {
  assert.match(sw, /const CACHE = 'one-v25';/);
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
