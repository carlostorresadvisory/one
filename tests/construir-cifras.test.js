// Banco de cifras (tools/construir-cifras.js): sin red; respuestas reales de Wikidata, Commons y el Banco
// Mundial guardadas en tests/fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../tools/construir-cifras.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const filas = fx('wikidata-filas.json');
const detalle = fx('wikidata-detalle.json');

test('las 9 categorías del plan, cada una con su área, su unidad y su prefijo único', () => {
  assert.deepEqual(Object.keys(C.CATEGORIAS), [
    'poblacion-pais', 'poblacion-ciudad', 'altitud-montana', 'altura-edificio', 'longitud-rio',
    'superficie-pais', 'ano-obra', 'ano-hecho', 'pib-pais',
  ]);
  assert.equal(new Set(Object.values(C.CATEGORIAS).map((c) => c.prefijo)).size, 9);
  assert.equal(C.CATEGORIAS['altura-edificio'].area, 'arte');
  assert.equal(C.CATEGORIAS['pib-pais'].area, 'economia');
  assert.equal(C.CATEGORIAS['ano-hecho'].area, 'historia');
  assert.equal(C.CATEGORIAS['longitud-rio'].unidad, 'km');
});

test('construirConsulta: SPARQL con la propiedad, la clase y el filtro de cada categoría', () => {
  const montana = C.construirConsulta('altitud-montana');
  assert.match(montana, /P2044/);
  assert.match(montana, /wd:Q8502/);
  assert.ok(montana.includes('FILTER(?valor > 3999)'));
  assert.ok(C.construirConsulta('longitud-rio').includes('FILTER(?valor > 999999)')); // 1.000 km en metros
  assert.match(C.construirConsulta('poblacion-pais'), /P1082[\s\S]*pq:P585/);
  assert.match(C.construirConsulta('ano-hecho'), /P585[\s\S]*timePrecision \?prec \. FILTER\(\?prec >= 9\)/);
  assert.ok(C.construirConsulta('poblacion-ciudad').includes('FILTER(?valor > 1000000)'));
  assert.ok(C.construirConsulta('ano-obra').includes('?e wdt:P195 ?col')); // solo las pinturas de los grandes museos
  assert.ok(!C.construirConsulta('ano-hecho').includes('P195'));
  assert.throws(() => C.construirConsulta('pib-pais'));
});

test('normalizarFilaWikidata: fila real → cifra con id estable, valor numérico y fecha', () => {
  const c = C.normalizarFilaWikidata(filas['poblacion-pais'][7], 'poblacion-pais');
  assert.deepEqual(c, { id: 'pp-Q142', qid: 'Q142', categoria: 'poblacion-pais', valor: 67063703, fecha: '2020-01-01', sitelinks: 428 });
  const monte = C.normalizarFilaWikidata(filas['altitud-montana'][0], 'altitud-montana');
  assert.equal(monte.valor, 8849); // 8848,86 → entero
  assert.equal(monte.fecha, null);
  assert.equal(C.normalizarFilaWikidata(filas['ano-hecho'][2], 'ano-hecho').valor, -479);
});

test('normalizarFilaWikidata: descarta filas rotas', () => {
  assert.equal(C.normalizarFilaWikidata({}, 'altitud-montana'), null);
  assert.equal(C.normalizarFilaWikidata({ e: { value: 'http://www.wikidata.org/entity/Q1' }, valor: { value: 'abc' } }, 'altitud-montana'), null);
  assert.equal(C.normalizarFilaWikidata({ e: { value: 'http://x/sin-q' }, valor: { value: '5' } }, 'altitud-montana'), null);
  assert.equal(C.normalizarFilaWikidata(filas['altitud-montana'][0], 'no-existe'), null);
});

test('los ríos y las superficies se pasan de metros y m² a km y km²', () => {
  const rio = C.normalizarFilaWikidata({ e: { value: 'http://www.wikidata.org/entity/Q3783' }, valor: { value: '6650000' }, sl: { value: '100' } }, 'longitud-rio');
  assert.equal(rio.valor, 6650);
  const pais = C.normalizarFilaWikidata({ e: { value: 'http://www.wikidata.org/entity/Q29' }, valor: { value: '505990000000' }, sl: { value: '300' } }, 'superficie-pais');
  assert.equal(pais.valor, 505990);
});

test('deduplicar: una cifra por id; con fecha gana la más reciente', () => {
  const norm = filas['poblacion-pais'].map((f) => C.normalizarFilaWikidata(f, 'poblacion-pais'));
  const unicas = C.deduplicar(norm);
  assert.equal(unicas.length, 1);
  assert.equal(unicas[0].valor, 67063703); // 2020 es la fecha más reciente de las 14
});

test('deduplicar: sin fecha, valores parecidos (8848/8850) se quedan y los que discrepan se descartan', () => {
  const monte = filas['altitud-montana'].slice(0, 4).map((f) => C.normalizarFilaWikidata(f, 'altitud-montana'));
  assert.equal(C.deduplicar(monte).length, 1);
  const raro = [
    { id: 'am-Q1', categoria: 'altitud-montana', valor: 4000, fecha: null },
    { id: 'am-Q1', categoria: 'altitud-montana', valor: 5200, fecha: null },
  ];
  assert.deepEqual(C.deduplicar(raro), []);
  const anos = [
    { id: 'ah-Q1', categoria: 'ano-hecho', valor: 1492, fecha: null },
    { id: 'ah-Q1', categoria: 'ano-hecho', valor: 1493, fecha: null },
  ];
  assert.deepEqual(C.deduplicar(anos), []); // un año de diferencia ya es ambiguo
  const batalla = filas['ano-hecho'].slice(2, 4).map((f) => C.normalizarFilaWikidata(f, 'ano-hecho'));
  assert.equal(C.deduplicar(batalla).length, 1); // dos filas iguales
});

test('validarCifra: valor finito > 0, años entre −3000 y 2026, nombre real y fuente https', () => {
  const buena = { id: 'am-Q513', categoria: 'altitud-montana', nombre: 'Everest', valor: 8849, unidad: 'm', fuente: 'https://www.wikidata.org/wiki/Q513' };
  assert.equal(C.validarCifra(buena), true);
  assert.equal(C.validarCifra({ ...buena, valor: 0 }), false);
  assert.equal(C.validarCifra({ ...buena, valor: -5 }), false);
  assert.equal(C.validarCifra({ ...buena, valor: Infinity }), false);
  assert.equal(C.validarCifra({ ...buena, valor: 3999 }), false); // por debajo de los 4000 m
  assert.equal(C.validarCifra({ ...buena, nombre: 'Q513' }), false); // sin etiqueta en Wikidata
  assert.equal(C.validarCifra({ ...buena, fuente: 'wikidata' }), false);
  const hecho = { id: 'ah-Q1', categoria: 'ano-hecho', nombre: 'Batalla de Salamina', valor: -480, unidad: 'año', fuente: 'https://www.wikidata.org/wiki/Q1' };
  assert.equal(C.validarCifra(hecho), true);
  assert.equal(C.validarCifra({ ...hecho, valor: -3001 }), false);
  assert.equal(C.validarCifra({ ...hecho, valor: 2027 }), false);
  assert.equal(C.validarCifra({ ...hecho, valor: 1492.5 }), false);
  assert.equal(C.validarCifra(null), false);
});

test('ficheroDeP18 y p18Aceptable: se descartan mapas, banderas, escudos y SVG antes de pedirlos a Commons', () => {
  const f = C.ficheroDeP18('http://commons.wikimedia.org/wiki/Special:FilePath/Paris%20from%20the%20Arc%20de%20Triomphe.jpg');
  assert.equal(f, 'Paris from the Arc de Triomphe.jpg');
  assert.equal(C.ficheroDeP18('https://otra.cosa/x.jpg'), null);
  assert.equal(C.p18Aceptable(f), true);
  for (const malo of ['Spain location map.png', 'Flag of Spain.svg', 'Coat of arms of Spain.png', 'Mapa de Peru.jpg', 'Diagram of the river.png', 'Ciudad.svg']) {
    assert.equal(C.p18Aceptable(malo), false, malo);
  }
});

test('imagenDeWikidata: URL de Commons sin parámetros, autor y licencia; nota sin puntuar', () => {
  const paginas = Object.values(fx('commons-p18.json').query.pages);
  const everest = paginas.find((p) => /Everest/.test(p.title));
  const img = C.imagenDeWikidata(everest);
  assert.ok(img);
  assert.match(img.url, /^https:\/\/(upload|thumb)\.wikimedia\.org\//);
  assert.equal(img.url.includes('?'), false);
  assert.match(img.pagina, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.equal(img.fuente, 'Commons');
  assert.match(img.licencia, /^CC BY-SA/);
  assert.ok(img.autor.length > 0);
  assert.equal(img.nota, null);
  // Licencia no libre → fuera.
  const nolibre = JSON.parse(JSON.stringify(everest));
  nolibre.imageinfo[0].extmetadata.LicenseShortName.value = 'CC BY-NC 2.0';
  assert.equal(C.imagenDeWikidata(nolibre), null);
  // CC BY-SA sin autor → fuera (el crédito no estaría completo).
  const sinAutor = JSON.parse(JSON.stringify(everest));
  sinAutor.imageinfo[0].extmetadata.Artist.value = '';
  assert.equal(C.imagenDeWikidata(sinAutor), null);
  assert.equal(C.imagenDeWikidata({ title: 'File:X.jpg' }), null);
});

test('imagenesDeCommons: pide por lotes con usuario-agente propio y devuelve fichero → imagen', async () => {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => fx('commons-p18.json') };
  };
  const ficheros = ['Mount Everest as seen from Drukair2 PLW edit.jpg', 'Kodaki fuji frm shojinko refurb.jpg'];
  const mapa = await C.imagenesDeCommons(ficheros, { fetchImpl, pausaMs: 0 });
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].opciones.headers['User-Agent'], /ONE-app/);
  assert.match(decodeURIComponent(llamadas[0].url).replaceAll('+', ' '), /File:Mount Everest as seen from Drukair2 PLW edit\.jpg\|File:Kodaki/);
  assert.ok(mapa.get(ficheros[0]) && mapa.get(ficheros[1]));
});

test('detalleDeEntidades: nombre en español (si no en inglés), foto aceptable e ISO3', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: { bindings: detalle } }) });
  const mapa = await C.detalleDeEntidades(['Q142', 'Q513'], { fetchImpl, pausaMs: 0 });
  assert.equal(mapa.get('Q142').nombre, 'Francia');
  assert.equal(mapa.get('Q142').iso3, 'FRA');
  assert.match(mapa.get('Q142').fichero, /Arc de Triomphe/);
  assert.equal(mapa.get('Q513').nombre, 'Everest');
});

test('parsearPibBancoMundial: solo países (ISO3) con valor; fuera agregados regionales', () => {
  const mapa = C.parsearPibBancoMundial(fx('banco-mundial-pib.json'));
  assert.ok(mapa.has('ESP') && mapa.has('USA'));
  assert.ok(mapa.get('ESP').valor > 1e12);
  assert.match(mapa.get('ESP').fecha, /^\d{4}$/);
  assert.equal(C.parsearPibBancoMundial(null).size, 0);
  assert.equal(C.parsearPibBancoMundial([{}, [{ countryiso3code: 'XXX', value: null }]]).size, 0);
  assert.equal(C.parsearPibBancoMundial([{}, [{ countryiso3code: '', value: 5 }]]).size, 0); // agregado sin ISO3
});

test('cifrasDeFilas: normaliza, deduplica, descarta valores rotos y ordena por enlaces', () => {
  const k2 = { e: { value: 'http://www.wikidata.org/entity/Q43512' }, valor: { value: '8611' }, sl: { value: '120' } };
  const rotas = [...filas['altitud-montana'], k2, { e: { value: 'http://www.wikidata.org/entity/Q9' }, valor: { value: '-4' }, sl: { value: '50' } }];
  const cifras = C.cifrasDeFilas(rotas, 'altitud-montana');
  assert.deepEqual(cifras.map((c) => c.qid), ['Q513', 'Q43512']); // Fuji y Vesubio no llegan a 4000 m; el de más enlaces va primero
  assert.ok(!cifras.some((c) => c.qid === 'Q9'));
  assert.ok(cifras.every((c) => c.valor >= 4000));
});

test('notas curiosas: texto usable, V/F para el verificador y solo pasan las verificadas', async () => {
  assert.equal(C.notaValida('El Everest crece unos 4 mm al año por el choque de placas.'), true);
  assert.equal(C.notaValida('corta'), false);
  assert.equal(C.notaValida('Fue la mayor derrota del ejército de Napoleón en toda la campaña.'), false); // superlativo
  assert.equal(C.notaValida('En -215 los romanos sufrieron una gran derrota en el sur de Italia.'), false); // año suelto con signo
  assert.equal(C.notaValida('mira https://x.com para ver la nota completa del dato'), false);
  const cifras = [
    { id: 'am-Q513', nombre: 'Everest', valor: 8849, unidad: 'm', fuente: 'https://www.wikidata.org/wiki/Q513' },
    { id: 'am-Q524', nombre: 'Vesubio', valor: 4300, unidad: 'm', fuente: 'https://www.wikidata.org/wiki/Q524' },
  ];
  const q = C.preguntaDeNota(cifras[0], ' El Everest crece unos 4 mm al año. ');
  assert.equal(q.tipo, 'vf');
  assert.equal(q.respuesta, true);
  assert.match(q.enunciado, /^Everest: El Everest crece/);
  const notas = { 'am-Q513': 'El Everest crece unos 4 mm al año por el choque de placas.', 'am-Q524': 'El Vesubio sepultó Pompeya en el año 79 de nuestra era.' };
  const llamarModelo = async ({ mensajes }) => {
    const ids = JSON.parse(mensajes[1].content.split('\n')[1]).map((p) => p.id);
    return { modelo: 'falso', texto: JSON.stringify(ids.map((id) => ({ id, correcta: id === 'am-Q513', unica: true, inequivoca: true, confianza: 0.9, motivo: '' }))) };
  };
  const buenas = await C.verificarNotas(cifras, notas, { llamarModelo });
  assert.deepEqual(Object.keys(buenas), ['am-Q513']); // la del Vesubio no verifica → sin nota
});

test('escribirNotas descarta las notas no válidas', async () => {
  const llamarModelo = async () => ({ texto: JSON.stringify({ a: 'Una frase correcta y comprobable de más de veinte letras.', b: 'x', c: 'con enlace https://x.org en medio de la frase larga' }) });
  const r = await C.escribirNotas([{ id: 'a', nombre: 'A', valor: 1, unidad: 'm' }], { llamarModelo });
  assert.deepEqual(Object.keys(r), ['a']);
});

test('serializar: una cifra por línea, ordenado por categoría y nombre', () => {
  const t = C.serializar([
    { id: 'b', categoria: 'altitud-montana', nombre: 'Zeta' },
    { id: 'a', categoria: 'poblacion-pais', nombre: 'Alfa' },
    { id: 'c', categoria: 'altitud-montana', nombre: 'Beta' },
  ]);
  const lineas = t.trim().split('\n');
  assert.equal(lineas.length, 5);
  assert.deepEqual(JSON.parse(t).map((c) => c.id), ['a', 'c', 'b']);
});

test('capitalizar: los nombres de Wikidata en minúscula empiezan en mayúscula', () => {
  assert.equal(C.capitalizar('batalla de Adua'), 'Batalla de Adua');
  assert.equal(C.capitalizar('  ataque a Pearl Harbor '), 'Ataque a Pearl Harbor');
  assert.equal(C.capitalizar(null), '');
});

test('el banco cabe: tope total de cifras razonable y objetivo de la spec (≥ 400)', () => {
  const total = Object.values(C.CATEGORIAS).reduce((suma, c) => suma + c.maxCifras, 0);
  assert.ok(total >= 400 && total <= 600, String(total));
});

test('verificarNotas: hacen falta las dos listas de modelos; si la segunda la rechaza, sin nota', async () => {
  const cifras = [{ id: 'a', nombre: 'A', valor: 1, unidad: 'm', fuente: 'https://x.org' }, { id: 'b', nombre: 'B', valor: 2, unidad: 'm', fuente: 'https://x.org' }];
  const notas = { a: 'Una nota correcta de la cosa A que se puede comprobar.', b: 'Una nota correcta de la cosa B que se puede comprobar.' };
  const llamadas = [];
  const llamarModelo = async ({ modelos, mensajes }) => {
    llamadas.push(modelos);
    const ids = JSON.parse(mensajes[1].content.split('\n')[1]).map((p) => p.id);
    const segunda = llamadas.length === 2;
    return { texto: JSON.stringify(ids.map((id) => ({ id, correcta: !(segunda && id === 'b'), unica: true, inequivoca: true, confianza: 0.95 }))) };
  };
  const buenas = await C.verificarNotas(cifras, notas, { llamarModelo, listas: [['m1'], ['m2']] });
  assert.deepEqual(Object.keys(buenas), ['a']);
  assert.deepEqual(llamadas, [['m1'], ['m2']]);
  // Si la primera lista no aprueba ninguna, no se llama a la segunda.
  llamadas.length = 0;
  const nada = await C.verificarNotas(cifras, notas, { llamarModelo: async () => ({ texto: '[]' }), listas: [['m1'], ['m2']] });
  assert.deepEqual(nada, {});
});
