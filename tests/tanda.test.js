// Tests del estado puro de la tanda en curso (Tarea 1 del plan v0.2b4-generacion-clara).
// Sin DOM y sin red: `calcularRestanteSeg`/`formatearRestante` son funciones puras, y la
// persistencia usa un localStorage falso (mismo patrón que tests/sincronizacion.test.js).
// Spec: docs/superpowers/specs/2026-09-15-one-v0.2b4-generacion-clara-design.md §1 y §2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVE_TANDA,
  SEG_POR_PREGUNTA_DEFECTO,
  leerTanda,
  guardarTanda,
  borrarTanda,
  calcularRestanteSeg,
  formatearRestante,
  esperaSondeoMs,
  topeSondeos,
} from '../tanda.js';

// === calcularRestanteSeg ==========================================================================

// Ola final v0.2b4 (M8): el `segundosPorPregunta` del servidor manda siempre que venga, también
// con preguntas ya hechas. El ritmo propio ((ahora - inicio) / hechas) mide desde que se PIDIÓ la
// tanda, así que incluye el rato que estuvo esperando en cola sin que nadie generara nada: con una
// cola por delante daba estimaciones disparatadas ("~16 min" para lo que el servidor sabe que le
// quedan 30 s). El del servidor es tiempo de generación real. Ritmo propio, solo como respaldo.
test('calcularRestanteSeg: el `segundosPorPregunta` del servidor manda aunque haya preguntas hechas', () => {
  // 4 s/pregunta del servidor x 6 que faltan = 24 s (el ritmo propio diría 60 s: incluye la cola).
  const seg = calcularRestanteSeg({ inicio: 0, ahora: 40000, hechas: 4, pedidas: 10, segundosPorPregunta: 4 });
  assert.equal(seg, 24);
});

test('calcularRestanteSeg: sin dato del servidor y con >= 1 hecha, respaldo con el ritmo REAL medido', () => {
  // 40 s para 4 preguntas = 10 s/pregunta; faltan 6 => 60 s.
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 40000, hechas: 4, pedidas: 10 }), 60);
  // Un `segundosPorPregunta` inservible (0, negativo, no numérico) no cuenta como dato del servidor.
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 40000, hechas: 4, pedidas: 10, segundosPorPregunta: 0 }), 60);
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 40000, hechas: 4, pedidas: 10, segundosPorPregunta: -3 }), 60);
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 40000, hechas: 4, pedidas: 10, segundosPorPregunta: 'rápido' }), 60);
});

test('calcularRestanteSeg: con 0 hechas usa la estimación del servidor por pregunta', () => {
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 5000, hechas: 0, pedidas: 10, segundosPorPregunta: 4 }), 40);
});

test('calcularRestanteSeg: sin estimación del servidor cae al defecto de 20 s/pregunta', () => {
  const seg = calcularRestanteSeg({ inicio: 0, ahora: 0, hechas: 0, pedidas: 5 });
  assert.equal(seg, SEG_POR_PREGUNTA_DEFECTO * 5);
});

test('calcularRestanteSeg: tanda completa devuelve 0', () => {
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 90000, hechas: 10, pedidas: 10 }), 0);
});

test('calcularRestanteSeg: datos inservibles devuelven null en vez de NaN', () => {
  assert.equal(calcularRestanteSeg({ inicio: undefined, ahora: 1000, hechas: 1, pedidas: 10 }), null);
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 1000, hechas: 1, pedidas: 0 }), null);
  assert.equal(calcularRestanteSeg({}), null);
});

test('calcularRestanteSeg: `hechas` mayor que `pedidas` no produce un restante negativo', () => {
  assert.equal(calcularRestanteSeg({ inicio: 0, ahora: 10000, hechas: 12, pedidas: 10 }), 0);
});

// === formatearRestante ============================================================================

test('formatearRestante: por debajo del minuto redondea a decenas de segundos', () => {
  assert.equal(formatearRestante(38), '~40 s');
  assert.equal(formatearRestante(4), '~10 s');   // nunca "~0 s"
  assert.equal(formatearRestante(57), '~50 s');  // nunca "~60 s": eso ya es un minuto
});

test('formatearRestante: a partir de 60 s redondea a minutos', () => {
  assert.equal(formatearRestante(60), '~1 min');
  assert.equal(formatearRestante(115), '~2 min');
});

test('formatearRestante: sin nada que decir devuelve cadena vacía', () => {
  assert.equal(formatearRestante(0), '');
  assert.equal(formatearRestante(null), '');
  assert.equal(formatearRestante(NaN), '');
});

// === persistencia en localStorage (clave one.atomoTrabajo) ========================================

function prepararLocalStorage() {
  const mapa = new Map();
  globalThis.localStorage = {
    getItem: (clave) => (mapa.has(clave) ? mapa.get(clave) : null),
    setItem: (clave, valor) => mapa.set(clave, String(valor)),
    removeItem: (clave) => mapa.delete(clave),
    clear: () => mapa.clear(),
  };
  return mapa;
}

const TANDA = { id: 't-abc-1', corto: 'Mercados y crisis', inicio: 1789000000000, pedidas: 10 };

test('guardarTanda + leerTanda: la tanda sobrevive a una recarga (el caso real de iOS)', () => {
  prepararLocalStorage();
  assert.equal(guardarTanda(TANDA), true);
  assert.deepEqual(leerTanda(), TANDA);
});

test('leerTanda: sin nada guardado devuelve null', () => {
  prepararLocalStorage();
  assert.equal(leerTanda(), null);
});

test('borrarTanda: deja la clave vacía (estado terminal o 404, spec §1)', () => {
  prepararLocalStorage();
  guardarTanda(TANDA);
  borrarTanda();
  assert.equal(leerTanda(), null);
});

test('leerTanda: una clave corrupta o incompleta se trata como "no hay tanda", nunca lanza', () => {
  const mapa = prepararLocalStorage();
  mapa.set(CLAVE_TANDA, '{no es json');
  assert.equal(leerTanda(), null);
  mapa.set(CLAVE_TANDA, JSON.stringify({ id: 't-1' })); // sin corto/inicio/pedidas
  assert.equal(leerTanda(), null);
  mapa.set(CLAVE_TANDA, JSON.stringify({ ...TANDA, pedidas: 0 }));
  assert.equal(leerTanda(), null);
});

test('guardarTanda: rechaza datos inservibles sin escribir nada', () => {
  prepararLocalStorage();
  assert.equal(guardarTanda({ id: '', corto: 'x', inicio: 1, pedidas: 10 }), false);
  assert.equal(guardarTanda({ id: 't-1', corto: 'x', inicio: 'ayer', pedidas: 10 }), false);
  assert.equal(leerTanda(), null);
});

// Ola final v0.2b4 (M11): este test deja un `localStorage` cuyo `setItem` LANZA. node:test no
// aísla globales entre tests, así que sin restaurarlo contaminaría cualquier test posterior que
// escribiera en localStorage (hoy es el último del fichero; mañana puede no serlo). `t.after` lo
// devuelve a un localStorage limpio pase lo que pase, incluso si la aserción falla.
test('guardarTanda: con localStorage lleno devuelve false y no lanza (la sesión sigue en memoria)', (t) => {
  const anterior = globalThis.localStorage;
  t.after(() => {
    globalThis.localStorage = anterior;
  });
  prepararLocalStorage();
  globalThis.localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.equal(guardarTanda(TANDA), false);
});

test('v0.3: guardarTanda/leerTanda conservan área y ruta cuando vienen y son válidas', (t) => {
  const anterior = globalThis.localStorage;
  const datos = new Map();
  globalThis.localStorage = { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
  t.after(() => { globalThis.localStorage = anterior; });
  assert.equal(guardarTanda({ id: 't1', corto: 'Roma', inicio: 1, pedidas: 10, area: 'historia', ruta: ['Roma antigua'] }), true);
  assert.deepEqual(leerTanda(), { id: 't1', corto: 'Roma', inicio: 1, pedidas: 10, area: 'historia', ruta: ['Roma antigua'] });
});

test('v0.3.4: la tanda conserva las etiquetas cortas de la ruta si coinciden en longitud; si no, se descartan', (t) => {
  const anterior = globalThis.localStorage;
  const datos = new Map();
  globalThis.localStorage = { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
  t.after(() => { globalThis.localStorage = anterior; });
  assert.equal(guardarTanda({ id: 't6', corto: 'Roma', inicio: 1, pedidas: 10, area: 'historia', ruta: ['Roma antigua y su imperio'], etiquetas: ['Roma'] }), true);
  assert.deepEqual(leerTanda().etiquetas, ['Roma']);
  assert.equal(guardarTanda({ id: 't7', corto: 'Roma', inicio: 1, pedidas: 10, area: 'historia', ruta: ['Roma antigua y su imperio'], etiquetas: ['Roma', 'sobra'] }), true);
  assert.equal('etiquetas' in leerTanda(), false);
});

test('v0.3: una tanda guardada por v0.2 (sin área ni ruta) se sigue leyendo igual', (t) => {
  const anterior = globalThis.localStorage;
  const datos = new Map([[CLAVE_TANDA, JSON.stringify({ id: 't2', corto: 'Economía', inicio: 5, pedidas: 10 })]]);
  globalThis.localStorage = { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
  t.after(() => { globalThis.localStorage = anterior; });
  assert.deepEqual(leerTanda(), { id: 't2', corto: 'Economía', inicio: 5, pedidas: 10 });
});

test('v0.3: área o ruta inválidas no se guardan (la tanda sí)', (t) => {
  const anterior = globalThis.localStorage;
  const datos = new Map();
  globalThis.localStorage = { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
  t.after(() => { globalThis.localStorage = anterior; });
  guardarTanda({ id: 't3', corto: 'X', inicio: 1, pedidas: 10, area: 'historia', ruta: [42] });
  assert.deepEqual(leerTanda(), { id: 't3', corto: 'X', inicio: 1, pedidas: 10 });
});

test('v0.3: un área que no está en AREAS se descarta al leer y al guardar (la tanda sí se conserva)', (t) => {
  const anterior = globalThis.localStorage;
  const datos = new Map([[CLAVE_TANDA, JSON.stringify({ id: 't4', corto: 'X', inicio: 1, pedidas: 10, area: 'cocina', ruta: ['a'] })]]);
  globalThis.localStorage = { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
  t.after(() => { globalThis.localStorage = anterior; });
  assert.deepEqual(leerTanda(), { id: 't4', corto: 'X', inicio: 1, pedidas: 10 });
  assert.equal(guardarTanda({ id: 't5', corto: 'X', inicio: 1, pedidas: 10, area: 'cocina', ruta: ['a'] }), true);
  assert.deepEqual(leerTanda(), { id: 't5', corto: 'X', inicio: 1, pedidas: 10 });
});

// === sondeo con espera creciente y tope proporcional (v0.3.4) ======================================

test('esperaSondeoMs: la tanda normal (10) sondea siempre cada 5 s', () => {
  for (const sinNovedades of [0, 1, 5, 40]) assert.equal(esperaSondeoMs({ pedidas: 10, sinNovedades }), 5000);
  assert.equal(esperaSondeoMs({ pedidas: 3, sinNovedades: 20 }), 5000);
  assert.equal(esperaSondeoMs(), 5000);
});

test('esperaSondeoMs: la de 100 se espacia de 5 s a 30 s mientras no llegan preguntas y no pasa de 30 s', () => {
  const serie = Array.from({ length: 12 }, (_, k) => esperaSondeoMs({ pedidas: 100, sinNovedades: k }));
  assert.deepEqual(serie, [5000, 5000, 10000, 10000, 15000, 15000, 20000, 20000, 25000, 25000, 30000, 30000]);
  assert.equal(esperaSondeoMs({ pedidas: 100, sinNovedades: 1000 }), 30000);
});

test('esperaSondeoMs: al llegar preguntas nuevas (sinNovedades vuelve a 0) la espera vuelve a 5 s', () => {
  assert.equal(esperaSondeoMs({ pedidas: 100, sinNovedades: 9 }), 25000);
  assert.equal(esperaSondeoMs({ pedidas: 100, sinNovedades: 0 }), 5000);
});

test('esperaSondeoMs: un contador inservible cuenta como 0', () => {
  for (const raro of [-3, NaN, undefined, 'x', Infinity]) assert.ok(esperaSondeoMs({ pedidas: 100, sinNovedades: raro }) <= 30000);
  assert.equal(esperaSondeoMs({ pedidas: 100, sinNovedades: -3 }), 5000);
  assert.equal(esperaSondeoMs({ pedidas: 100, sinNovedades: NaN }), 5000);
});

test('topeSondeos: 120 para la de 10 (como siempre) y proporcional a n para la grande (400 con 100)', () => {
  assert.equal(topeSondeos(10), 120);
  assert.equal(topeSondeos(5), 120);
  assert.equal(topeSondeos(undefined), 120);
  assert.equal(topeSondeos(100), 400);
  assert.equal(topeSondeos(200), 800);
});
