// Bancos libres (tools/bancos-libres.js): sin red; fetch simulado con respuestas reales guardadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buscarOpenverse, buscarMet, buscarAIC, buscarNASA, buscarEnBancos } from '../tools/bancos-libres.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/bancos/${n}`, import.meta.url), 'utf8'));
const respuesta = (cuerpo, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => cuerpo });

function servidor(mapa = {}) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    if (url.includes('openverse')) return respuesta(mapa.openverse ?? fx('openverse.json'));
    if (url.includes('v1.1/search')) return respuesta(fx('met-busqueda.json'));
    if (url.includes('/objects/')) return respuesta(mapa.met?.(url) ?? fx(`met-obj-${url.split('/').pop()}.json`));
    if (url.includes('artic.edu')) return respuesta(fx('aic.json'));
    if (url.includes('nasa.gov')) return respuesta(fx('nasa.json'));
    throw new Error(`url inesperada ${url}`);
  };
  return { fetchImpl, llamadas };
}

const FORMA = ['url', 'pagina', 'titulo', 'autor', 'licencia', 'fuente', 'ancho', 'alto'];

test('cada adaptador normaliza a la forma común y manda User-Agent', async () => {
  const { fetchImpl, llamadas } = servidor();
  for (const [f, fuente] of [[buscarOpenverse, 'Openverse'], [buscarMet, 'Met'], [buscarAIC, 'Art Institute of Chicago'], [buscarNASA, 'NASA']]) {
    const r = await f('Roman Colosseum', { fetchImpl, pausaMs: 0 });
    assert.ok(r.length > 0, fuente);
    for (const c of r) {
      assert.deepEqual(Object.keys(c).sort(), [...FORMA].sort(), fuente);
      assert.equal(c.fuente, fuente);
      assert.match(c.url, /^https:\/\//);
    }
  }
  assert.ok(llamadas.every((l) => /ONE-app/.test(l.opciones.headers['User-Agent'])));
});

test('Openverse: licencia CC BY con versión; las no libres se descartan', async () => {
  const base = fx('openverse.json');
  const mezcla = { ...base, results: [base.results[0], { ...base.results[1], license: 'by-nc', license_version: '2.0' }, { ...base.results[2], width: 300, height: 200 }] };
  const { fetchImpl } = servidor({ openverse: mezcla });
  const r = await buscarOpenverse('x', { fetchImpl });
  assert.equal(r.length, 1);
  assert.equal(r[0].licencia, 'CC BY 2.0');
});

test('Met: sin isPublicDomain se descarta', async () => {
  const { fetchImpl } = servidor({ met: (url) => ({ ...fx(`met-obj-${url.split('/').pop()}.json`), isPublicDomain: false }) });
  assert.deepEqual(await buscarMet('x', { fetchImpl, pausaMs: 0 }), []);
});

test('Met: dominio público -> CC0 con autor y página del museo', async () => {
  const r = await buscarMet('Colosseum', { fetchImpl: servidor().fetchImpl, pausaMs: 0 });
  assert.equal(r[0].licencia, 'CC0');
  assert.equal(r[0].autor, 'Bartholomeus Breenbergh');
  assert.match(r[0].pagina, /metmuseum\.org/);
});

test('AIC: solo dominio público y URL IIIF', async () => {
  const r = await buscarAIC('x', { fetchImpl: servidor().fetchImpl });
  assert.match(r[0].url, /\/iiif\/2\/.+\/full\/843,\/0\/default\.jpg$/);
});

test('buscarEnBancos: arte -> museos antes que Openverse; ciencia -> NASA primero; un banco caído se salta', async () => {
  const s = servidor();
  const arte = await buscarEnBancos('x', { area: 'arte', fetchImpl: s.fetchImpl, pausaMs: 0 });
  const fuentesArte = [...new Set(arte.map((c) => c.fuente))];
  assert.deepEqual(fuentesArte, ['Met', 'Art Institute of Chicago', 'Openverse']);
  const ciencia = await buscarEnBancos('x', { area: 'ciencia', fetchImpl: s.fetchImpl, pausaMs: 0 });
  assert.equal(ciencia[0].fuente, 'NASA');
  const otra = await buscarEnBancos('x', { area: 'economia', fetchImpl: s.fetchImpl, pausaMs: 0 });
  assert.ok(otra.every((c) => c.fuente === 'Openverse'));
  const caido = await buscarEnBancos('x', {
    area: 'arte',
    pausaMs: 0,
    fetchImpl: async (url, o) => {
      if (String(url).includes('metmuseum')) throw new Error('caído');
      return s.fetchImpl(url, o);
    },
  });
  assert.ok(caido.length > 0 && caido.every((c) => c.fuente !== 'Met'));
});
