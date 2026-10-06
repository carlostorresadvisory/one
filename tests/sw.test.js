// Guarda del despliegue (v0.3): todo módulo que app.js carga -- import estático o import() perezoso,
// recorriendo también los imports de esos módulos -- tiene que estar en NUCLEO, o offline la app no
// arranca / se queda muda (mismo fallo que el hallazgo M1 de v0.1e, ver comentario en sw.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('sw: caché one-v21', () => {
  assert.match(sw, /const CACHE = 'one-v21';/);
});

test('sw: todo módulo que app.js carga está en NUCLEO', () => {
  const nucleo = new Set(lista('NUCLEO'));
  for (const fichero of modulosLocales('app.js')) assert.ok(nucleo.has(fichero), `${fichero} falta en NUCLEO de sw.js`);
});
