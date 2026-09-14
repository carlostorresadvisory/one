// Tests del estado puro del átomo (Tarea 2 del plan v0.2b2-cliente-atomo, ampliado en la Tarea 3
// de v0.2b3): sin DOM, sin red.
// Decisión del controlador (14-sep-2026, resuelve la ambigüedad del brief de la tarea):
// `crearEstadoAtomo(area) -> {area, ruta: [], etiquetas: []}`; `avanzar(estado, subtema)` añade
// `subtema.completo` a `ruta` y `subtema.corto` a `etiquetas` (máximo 6 anillos, v0.2b3: en
// `ruta.length === 6` devuelve el MISMO objeto, sin copiar); `retroceder(estado)` quita el último
// elemento de ambos arrays (en `ruta` vacía devuelve el MISMO objeto). Inmutable: ni avanzar ni
// retroceder tocan el objeto que reciben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstadoAtomo, avanzar, retroceder, envolverTexto } from '../atomo.js';

function subtema(indice, corto, completo) {
  return { indice, corto, completo: completo || `Completo de ${corto}` };
}

// === crearEstadoAtomo ==============================================================================

test('crearEstadoAtomo: área con ruta y etiquetas vacías', () => {
  const estado = crearEstadoAtomo('economia');
  assert.deepEqual(estado, { area: 'economia', ruta: [], etiquetas: [] });
});

// === avanzar ========================================================================================

test('avanzar: añade completo a ruta y corto a etiquetas', () => {
  const inicial = crearEstadoAtomo('historia');
  const s = subtema(0, 'Guerras', 'Guerras y conflictos del siglo XX');
  const siguiente = avanzar(inicial, s);
  assert.deepEqual(siguiente, {
    area: 'historia',
    ruta: ['Guerras y conflictos del siglo XX'],
    etiquetas: ['Guerras'],
  });
});

test('avanzar: es inmutable, no toca el estado recibido', () => {
  const inicial = crearEstadoAtomo('ciencia');
  const copiaInicial = { ...inicial, ruta: [...inicial.ruta], etiquetas: [...inicial.etiquetas] };
  avanzar(inicial, subtema(0, 'Física', 'Física de partículas'));
  assert.deepEqual(inicial, copiaInicial);
});

test('avanzar: encadenado, cada anillo se apila en orden', () => {
  let estado = crearEstadoAtomo('geografia');
  estado = avanzar(estado, subtema(0, 'Ríos', 'Ríos y cuencas hidrográficas'));
  estado = avanzar(estado, subtema(1, 'Amazonas', 'El Amazonas y su cuenca'));
  assert.deepEqual(estado.ruta, ['Ríos y cuencas hidrográficas', 'El Amazonas y su cuenca']);
  assert.deepEqual(estado.etiquetas, ['Ríos', 'Amazonas']);
});

test('avanzar: máximo 6 anillos (v0.2b3), el séptimo no cambia nada y devuelve el MISMO objeto', () => {
  let estado = crearEstadoAtomo('arte');
  for (let i = 0; i < 6; i += 1) {
    estado = avanzar(estado, subtema(i, `Corto ${i}`, `Completo ${i}`));
  }
  assert.equal(estado.ruta.length, 6);
  const conSeis = estado;
  const intentoSeptimo = avanzar(conSeis, subtema(6, 'Corto 6', 'Completo 6'));
  assert.equal(intentoSeptimo, conSeis); // misma referencia, no una copia igual
  assert.equal(intentoSeptimo.ruta.length, 6);
});

// === retroceder ======================================================================================

test('retroceder: quita el último elemento de ruta y de etiquetas', () => {
  let estado = crearEstadoAtomo('tecnologia');
  estado = avanzar(estado, subtema(0, 'IA', 'Inteligencia artificial'));
  estado = avanzar(estado, subtema(1, 'LLM', 'Modelos de lenguaje'));
  const anterior = retroceder(estado);
  assert.deepEqual(anterior, { area: 'tecnologia', ruta: ['Inteligencia artificial'], etiquetas: ['IA'] });
});

test('retroceder: es inmutable, no toca el estado recibido', () => {
  let estado = crearEstadoAtomo('logica');
  estado = avanzar(estado, subtema(0, 'Silogismos', 'Silogismos clásicos'));
  const copia = { ...estado, ruta: [...estado.ruta], etiquetas: [...estado.etiquetas] };
  retroceder(estado);
  assert.deepEqual(estado, copia);
});

test('retroceder: en ruta vacía (anillo 1) no cambia nada y devuelve el MISMO objeto', () => {
  const estado = crearEstadoAtomo('filosofia');
  const resultado = retroceder(estado);
  assert.equal(resultado, estado); // misma referencia
});

test('avanzar y retroceder: ida y vuelta deja el mismo contenido (aunque no la misma referencia)', () => {
  const inicial = crearEstadoAtomo('economia');
  const avanzado = avanzar(inicial, subtema(0, 'Mercados', 'Mercados y crisis financieras'));
  const vuelta = retroceder(avanzado);
  assert.deepEqual(vuelta, inicial);
});

// === envolverTexto ===================================================================================
// Ronda final de arreglos (revisión, 14-sep-2026) -- Minor visible (M1): una palabra ya más larga
// que `maxPorLinea` se colocaba entera sin partir (salvo que cayera en la última línea), así que
// desbordaba el círculo del nodo -- "Reestructuraciones" (18 caracteres) frente a maxPorLinea=11,
// visible en la captura v0.2b3-atomo-mas-375.png. Cada línea debe medir como mucho `maxPorLinea`
// caracteres, sea cual sea su origen (palabra normal, guion, o recorte final con "…").

test('envolverTexto: una palabra de 18 caracteres se parte con guion, sin desbordar maxPorLinea', () => {
  const lineas = envolverTexto('Reestructuraciones', 11, 3);
  assert.deepEqual(lineas, ['Reestructu-', 'raciones']);
  for (const linea of lineas) {
    assert.ok(linea.length <= 11, `"${linea}" mide ${linea.length} caracteres, por encima de maxPorLinea (11)`);
  }
});

test('envolverTexto: reproduce el caso real de la revisión ("Reestructuraciones e insolvencia: cómo …") sin ninguna línea por encima de maxPorLinea', () => {
  const lineas = envolverTexto('Reestructuraciones e insolvencia: cómo …', 11, 3);
  assert.equal(lineas.length, 3);
  for (const linea of lineas) {
    assert.ok(linea.length <= 11, `"${linea}" mide ${linea.length} caracteres, por encima de maxPorLinea (11)`);
  }
  // La última línea sigue recortándose con "…" si queda contenido sin colocar (comportamiento ya
  // existente, sin cambios) -- aquí queda texto de sobra, así que debe terminar en "…".
  assert.ok(lineas[lineas.length - 1].endsWith('…'));
});

test('envolverTexto: una palabra larga que no cabe en un solo trozo de guion sigue partiéndose (varios trozos, nunca entera)', () => {
  // 19 caracteres: no cabe en un trozo de maxPorLinea-1=10 -- debe partirse en tantos trozos con
  // guion como haga falta (aquí, dos), nunca colocarse entera sin más.
  const lineas = envolverTexto('Extraordinariamente', 11, 3);
  for (const linea of lineas) {
    assert.ok(linea.length <= 11, `"${linea}" mide ${linea.length} caracteres, por encima de maxPorLinea (11)`);
  }
});

test('envolverTexto: palabras normales (ninguna supera maxPorLinea) siguen envolviendo igual que antes', () => {
  assert.deepEqual(envolverTexto('Mercados y crisis', 11, 3), ['Mercados y', 'crisis']);
});

test('envolverTexto: texto vacío devuelve una sola línea vacía', () => {
  assert.deepEqual(envolverTexto('', 11, 3), ['']);
});
