import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../masomenos.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

const c = (id, categoria, valor, unidad = 'm', area = 'geografia') => ({ id, categoria, valor, unidad, area, nombre: id });

test('solo compara misma categoría y unidad, con diferencia ≥ 5 %, razón ≤ ×4 y fechas ≤ 300 años', () => {
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 8611)), false);
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 6000)), true);
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 8848), c('b', 'altura-edificio', 828)), false);
  assert.equal(M.sonComparables(c('a', 'ano-hecho', 1492, 'año'), c('b', 'ano-hecho', 1492, 'año')), false);
  assert.equal(M.sonComparables(c('a', 'ano-hecho', 1492, 'año'), c('b', 'ano-hecho', 1493, 'año')), true);
  // dificultad (spec §4): nada que se resuelva a simple vista
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 1000)), false); // ×8,8
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 4000), c('b', 'altitud-montana', 1000)), true); // ×4 exacto
  assert.equal(M.sonComparables(c('a', 'ano-hecho', 1492, 'año'), c('b', 'ano-hecho', 1100, 'año')), false); // 392 años
  assert.equal(M.sonComparables(c('a', 'ano-hecho', 1492, 'año'), c('b', 'ano-hecho', 1200, 'año')), true); // 292 años
  // en Afinar sí se admite ×8,8 (queda dentro de 1/20…20)
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 1000), { variante: 'afinar' }), true);
  assert.equal(M.sonComparables(c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 100), { variante: 'afinar' }), false); // ×88: fuera de la barra
  assert.equal(M.sonComparables(c('a', 'ano-hecho', 1492, 'año'), c('b', 'ano-hecho', 600, 'año'), { variante: 'afinar' }), true); // ± 2.000 años
});

test('sonComparables no se fía de datos rotos ni de la misma cifra contra sí misma', () => {
  const a = c('a', 'altitud-montana', 8848);
  assert.equal(M.sonComparables(a, a), false);
  assert.equal(M.sonComparables(a, null), false);
  assert.equal(M.sonComparables(a, c('b', 'altitud-montana', NaN)), false);
  assert.equal(M.sonComparables(a, c('b', 'altitud-montana', 0)), false);
  assert.equal(M.sonComparables(c('a', 'inventada', 5), c('b', 'inventada', 9)), false);
});

test('elegirPareja de Comparar nunca da una razón mayor que ×4 (200 sorteos)', () => {
  const cifras = [1000, 1500, 2500, 4000, 9000, 30000].map((v, i) => c('m' + i, 'altitud-montana', v));
  for (let i = 0; i < 200; i += 1) {
    const p = M.elegirPareja(cifras, { area: 'geografia', rng: Math.random });
    if (p) assert.ok(Math.max(p[0].valor, p[1].valor) / Math.min(p[0].valor, p[1].valor) <= 4);
  }
});

test('elegirPareja respeta el área y devuelve null sin parejas', () => {
  const cifras = [c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 6000), c('x', 'altura-edificio', 828, 'm', 'arte')];
  const [arriba, abajo] = M.elegirPareja(cifras, { area: 'geografia', rng: () => 0 });
  assert.ok(M.sonComparables(arriba, abajo));
  assert.equal(M.elegirPareja(cifras, { area: 'arte', rng: () => 0 }), null);
  assert.equal(M.elegirPareja([], {}), null);
  assert.equal(M.elegirPareja(null, {}), null);
});

test('elegirPareja con `arriba` conserva la de arriba y busca solo la de abajo; null si no hay ninguna', () => {
  const cifras = [c('a', 'altitud-montana', 8848), c('b', 'altitud-montana', 6000), c('z', 'altitud-montana', 100)];
  const p = M.elegirPareja(cifras, { arriba: cifras[1], rng: () => 0.99 });
  assert.equal(p[0], cifras[1]);
  assert.equal(p[1].id, 'a'); // 100 m queda a ×60 de 6000: no es comparable
  assert.equal(M.elegirPareja(cifras, { arriba: cifras[2] }), null);
});

test('elegirPareja reparte entre categorías y evita las ya vistas si hay alternativa', () => {
  const montes = [c('m1', 'altitud-montana', 8000), c('m2', 'altitud-montana', 6000), c('m3', 'altitud-montana', 5000)];
  const rios = [c('r1', 'longitud-rio', 6000, 'km'), c('r2', 'longitud-rio', 4000, 'km')];
  const cifras = [...montes, ...rios];
  const categorias = new Set();
  for (let i = 0; i < 100; i += 1) categorias.add(M.elegirPareja(cifras, { rng: Math.random })[0].categoria);
  assert.deepEqual([...categorias].sort(), ['altitud-montana', 'longitud-rio']);
  // m1 y m2 vistas: la pareja de montañas que sale es la única con una cifra sin ver (m3 contra una vista)
  for (let i = 0; i < 100; i += 1) {
    const par = M.elegirPareja(cifras, { rng: Math.random, excluir: ['m1', 'm2'] });
    if (par[0].categoria === 'altitud-montana') assert.equal(par[0].id, 'm3');
  }
  // Si todas están vistas, no se queda sin pareja.
  assert.ok(M.elegirPareja(cifras, { rng: Math.random, excluir: cifras.map((x) => x.id) }));
});

test('evaluar Comparar y botones de fechas', () => {
  assert.equal(M.evaluarComparar(c('a', 'x', 10), c('b', 'x', 20), 'mas'), true);
  assert.equal(M.evaluarComparar(c('a', 'x', 10), c('b', 'x', 20), 'menos'), false);
  assert.equal(M.evaluarComparar(c('a', 'x', 10), c('b', 'x', 5), 'menos'), true);
  assert.equal(M.evaluarComparar(c('a', 'x', 10), c('b', 'x', 5), 'raro'), false);
  assert.deepEqual(M.etiquetasBotones('ano-hecho'), ['Después', 'Antes']);
  assert.deepEqual(M.etiquetasBotones('altitud-montana'), ['Más', 'Menos']);
});

test('premio cada 10 de racha; el salvavidas no corta', () => {
  let e = M.crearEstadoMasomenos();
  let premios = 0;
  for (let i = 0; i < 20; i += 1) { const r = M.registrarResultado(e, 'comparar', { acierto: true }); e = r.estado; if (r.premio) premios += 1; }
  assert.equal(premios, 2);
  e = M.registrarResultado(e, 'comparar', { acierto: false, salvavidas: true }).estado;
  assert.equal(e.comparar.racha, 20);
  e = M.registrarResultado(e, 'comparar', { acierto: false }).estado;
  assert.equal(e.comparar.racha, 0);
  assert.equal(e.comparar.record, 20);
});

test('registrarResultado no muta el estado y cada variante lleva su racha', () => {
  const e0 = M.crearEstadoMasomenos();
  const copia = JSON.stringify(e0);
  const r = M.registrarResultado(e0, 'afinar', { acierto: true });
  assert.equal(JSON.stringify(e0), copia);
  assert.equal(r.estado.afinar.racha, 1);
  assert.equal(r.estado.comparar.racha, 0);
  assert.equal(M.registrarResultado(e0, 'otra', { acierto: true }).premio, false);
});

test('Afinar: la racha solo sube con clavado/muy cerca y el salvavidas la salva ante cerca/lejos', () => {
  let e = M.crearEstadoMasomenos();
  for (const calif of ['muy-cerca', 'clavado']) e = M.registrarResultado(e, 'afinar', { acierto: M.cuentaParaRacha(calif) }).estado;
  assert.equal(e.afinar.racha, 2);
  e = M.registrarResultado(e, 'afinar', { acierto: M.cuentaParaRacha('lejos'), salvavidas: true }).estado;
  assert.equal(e.afinar.racha, 2);
  e = M.registrarResultado(e, 'afinar', { acierto: M.cuentaParaRacha('cerca') }).estado;
  assert.equal(e.afinar.racha, 0);
});

test('escala logarítmica de 1/20 a 20× y lineal para fechas recortada', () => {
  const esc = M.escalaBarra(c('r', 'poblacion-pais', 1e6, 'personas'), 'poblacion-pais');
  assert.equal(esc.tipo, 'log');
  assert.equal(Math.round(M.valorDesdePosicion(esc, 0)), 50000);
  assert.equal(Math.round(M.valorDesdePosicion(esc, 1)), 20000000);
  assert.ok(Math.abs(M.valorDesdePosicion(esc, 0.5) - 1e6) / 1e6 < 0.001);
  assert.ok(Math.abs(M.posicionDesdeValor(esc, 1e6) - 0.5) < 1e-9);
  const f = M.escalaBarra(c('r', 'ano-hecho', 1500, 'año'), 'ano-hecho');
  assert.deepEqual([f.min, f.max], [-500, 2026]);
  assert.equal(M.escalaBarra(c('r', 'ano-hecho', -2900, 'año'), 'ano-hecho').min, -3000);
});

test('barra lineal de alturas: recortada a lo que existe (🔶), y toda pareja de Afinar cabe en ella', () => {
  const esc = M.escalaBarra(c('r', 'altitud-montana', 8848), 'altitud-montana');
  assert.equal(esc.tipo, 'lin');
  assert.equal(esc.min, 8848 / 20);
  assert.equal(esc.max, 10000);
  assert.ok(M.posicionDesdeValor(esc, 4000) > 0 && M.posicionDesdeValor(esc, 4000) < 1);
  const edificio = M.escalaBarra(c('r', 'altura-edificio', 828), 'altura-edificio');
  assert.equal(edificio.max, 1000);
  // referencia por encima del tope: la barra no se queda vacía
  const alto = M.escalaBarra(c('r', 'altura-edificio', 1500), 'altura-edificio');
  assert.ok(alto.max >= 1500 && alto.max > alto.min);
});

test('valorDesdePosicion y posicionDesdeValor se invierten y se recortan a [0, 1]', () => {
  for (const esc of [{ tipo: 'log', min: 10, max: 1e5 }, { tipo: 'lin', min: -500, max: 2026 }]) {
    for (const t of [0, 0.25, 0.5, 0.9, 1]) assert.ok(Math.abs(M.posicionDesdeValor(esc, M.valorDesdePosicion(esc, t)) - t) < 1e-9);
    assert.equal(M.valorDesdePosicion(esc, -4), esc.min);
    assert.equal(M.valorDesdePosicion(esc, 7), esc.max);
    assert.equal(M.posicionDesdeValor(esc, esc.max * 10), 1);
    assert.equal(M.posicionDesdeValor(esc, NaN), 0);
  }
});

test('calificar por error relativo y por años', () => {
  assert.equal(M.calificar(100, 105, 'altitud-montana'), 'clavado');
  assert.equal(M.calificar(100, 120, 'altitud-montana'), 'muy-cerca');
  assert.equal(M.calificar(100, 140, 'altitud-montana'), 'cerca');
  assert.equal(M.calificar(100, 300, 'altitud-montana'), 'lejos');
  assert.equal(M.calificar(1492, 1497, 'ano-hecho'), 'clavado');
  assert.equal(M.calificar(1492, 1530, 'ano-hecho'), 'cerca');
  assert.equal(M.calificar(1492, 1600, 'ano-hecho'), 'lejos');
  assert.equal(M.calificar(1492, 1480, 'ano-hecho'), 'muy-cerca');
});

test('formato de cifras y de años', () => {
  assert.equal(M.formatearValor(8849, 'altitud-montana'), '8.849');
  assert.equal(M.formatearValor(67063703, 'poblacion-pais'), '67.063.703');
  assert.equal(M.formatearValor(12.34, 'longitud-rio'), '12,3');
  assert.equal(M.formatearValor(1941, 'ano-hecho'), '1941');
  assert.equal(M.formatearValor(-479, 'ano-hecho'), '479 a. C.');
  assert.equal(M.valorConUnidad(c('a', 'altitud-montana', 8849)), '8.849 m');
  assert.equal(M.valorConUnidad(c('a', 'ano-hecho', 1941, 'año')), '1941');
  assert.equal(M.formatearValor(NaN, 'x'), '');
});

test('formato compacto: millones desde un millón para que la cifra quepa en la tarjeta', () => {
  const pais = (valor, categoria = 'poblacion-pais', unidad = 'personas') => M.valorConUnidad({ valor, categoria, unidad });
  assert.equal(pais(8980000), '8,98 millones de personas');
  assert.equal(pais(67063703), '67,1 millones de personas');
  assert.equal(pais(1450000000), '1.450 millones de personas');
  assert.equal(pais(1000000), '1 millón de personas');
  assert.equal(pais(950000), '950.000 personas');
  assert.equal(pais(17098246, 'superficie-pais', 'km²'), '17,1 millones de km²');
  assert.equal(pais(391026962800, 'pib-pais', 'US$'), '391.027 millones US$');
  assert.equal(pais(2.92e13, 'pib-pais', 'US$'), '29,2 billones US$');
  assert.equal(pais(8849, 'altitud-montana', 'm'), '8.849 m');
});

test('los años a. C. no tienen año cero: −480 se escribe 480 a. C. y −1 es 1 a. C.', () => {
  assert.equal(M.formatearValor(-480, 'ano-hecho'), '480 a. C.');
  assert.equal(M.formatearValor(-1, 'ano-hecho'), '1 a. C.');
});

test('validarCifra: la misma validación en el tool y en la app (unidad, área, rango, id y nombre)', () => {
  const buena = { id: 'am-Q513', area: 'geografia', categoria: 'altitud-montana', unidad: 'm', nombre: 'Everest', valor: 8849, fuente: 'https://www.wikidata.org/wiki/Q513' };
  assert.equal(M.validarCifra(buena), true);
  for (const cambio of [{ unidad: 'km' }, { area: 'arte' }, { valor: 3999 }, { valor: 12000 }, { valor: 0 }, { valor: NaN }, { nombre: 'Q513' }, { nombre: 'x'.repeat(81) }, { id: '' }, { fuente: 'http://x' }, { categoria: 'otra' }]) {
    assert.equal(M.validarCifra({ ...buena, ...cambio }), false, JSON.stringify(cambio));
  }
  const hecho = { id: 'ah-Q1', area: 'historia', categoria: 'ano-hecho', unidad: 'año', nombre: 'Batalla de las Termópilas', valor: -480, fuente: 'https://www.wikidata.org/wiki/Q1' };
  assert.equal(M.validarCifra(hecho), true);
  for (const valor of [-3001, 2027, 1492.5, Infinity]) assert.equal(M.validarCifra({ ...hecho, valor }), false);
  assert.equal(M.validarCifra(null), false);
});

test('validarBanco: descarta lo roto y repite ni id ni nombre dentro de la categoría', () => {
  const m = (id, nombre, valor = 5000) => ({ id, area: 'geografia', categoria: 'altitud-montana', unidad: 'm', nombre, valor, fuente: 'https://x.org/' });
  const banco = M.validarBanco([m('a', 'Uno'), m('a', 'Otro'), m('b', 'uno'), m('c', 'Tres', 10), m('d', 'Cuatro'), null, 'x']);
  assert.deepEqual(banco.map((x) => x.id), ['a', 'd']);
  assert.deepEqual(M.validarBanco('no'), []);
});

test('barras degeneradas: rango sin recorrido → centro; valores ≤ 0 en logarítmica → extremo bajo; real 0 sin división por cero', () => {
  assert.equal(M.posicionDesdeValor({ tipo: 'lin', min: 5, max: 5 }, 5), 0.5);
  assert.equal(M.posicionDesdeValor({ tipo: 'log', min: 10, max: 2 }, 5), 0.5);
  assert.equal(M.posicionDesdeValor({ tipo: 'log', min: 0, max: 100 }, 5), 0.5);
  assert.equal(M.valorDesdePosicion({ tipo: 'lin', min: 5, max: 5 }, 0.7), 5);
  assert.equal(M.valorDesdePosicion({ tipo: 'log', min: -1, max: 100 }, 0.5), -1);
  const log = { tipo: 'log', min: 1, max: 100 };
  assert.equal(M.posicionDesdeValor(log, 0), 0);
  assert.equal(M.posicionDesdeValor(log, -7), 0);
  assert.ok(Number.isFinite(M.valorDesdePosicion(log, 0.5)));
  assert.equal(M.calificar(0, 0, 'altitud-montana'), 'clavado');
  assert.equal(M.calificar(0, 3, 'altitud-montana'), 'lejos');
  assert.equal(M.calificar(100, NaN, 'altitud-montana'), 'lejos');
});

test('persistencia: ida y vuelta, datos corruptos, números absurdos y almacenamiento bloqueado', () => {
  M.olvidarMemoria();
  const almacen = almacenFalso();
  assert.deepEqual(M.cargarMasomenos(almacen), M.crearEstadoMasomenos());
  const estado = { version: 1, variante: 'afinar', comparar: { racha: 3, record: 12 }, afinar: { racha: 1, record: 5 } };
  assert.equal(M.guardarMasomenos(estado, almacen), true);
  assert.deepEqual(M.cargarMasomenos(almacen), estado);
  for (const crudo of ['{no json', 'null', '[]', '"x"', '{"variante":"otra","comparar":"no","afinar":{"racha":-4,"record":"x"}}']) {
    assert.deepEqual(M.cargarMasomenos(almacenFalso({ [M.CLAVE_MASOMENOS]: crudo })), M.crearEstadoMasomenos(), crudo);
  }
  // absurdo: racha 1e99, decimales, récord menor que la racha
  const absurdo = M.normalizarMasomenos({ variante: 'comparar', comparar: { racha: 1e99, record: 1.5 }, afinar: { racha: 7, record: 3 } });
  assert.equal(absurdo.comparar.racha, 0);
  assert.equal(absurdo.afinar.record, 7); // el récord nunca queda por debajo de la racha
  // bloqueado: nada lanza y vive en memoria hasta recargar
  const roto = almacenRoto();
  assert.equal(M.guardarMasomenos(estado, roto), false);
  assert.deepEqual(M.cargarMasomenos(roto), estado);
  M.olvidarMemoria();
  assert.deepEqual(M.cargarMasomenos(roto), M.crearEstadoMasomenos());
});

test('recordTexto: el mejor de las dos variantes', () => {
  assert.equal(M.recordTexto(M.crearEstadoMasomenos()), '');
  assert.equal(M.recordTexto({ comparar: { racha: 0, record: 12 }, afinar: { racha: 0, record: 20 } }), 'Récord 20');
  assert.equal(M.recordTexto(null), '');
});
