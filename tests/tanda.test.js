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
