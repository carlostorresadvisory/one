// Tests del estado puro del átomo (Tarea 2 del plan v0.2b2-cliente-atomo): sin DOM, sin red.
// Decisión del controlador (14-sep-2026, resuelve la ambigüedad del brief de la tarea):
// `crearEstadoAtomo(area) -> {area, ruta: [], etiquetas: []}`; `avanzar(estado, subtema)` añade
// `subtema.completo` a `ruta` y `subtema.corto` a `etiquetas` (máximo 4 anillos: en `ruta.length
// === 4` devuelve el MISMO objeto, sin copiar); `retroceder(estado)` quita el último elemento de
// ambos arrays (en `ruta` vacía devuelve el MISMO objeto). Inmutable: ni avanzar ni retroceder
// tocan el objeto que reciben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstadoAtomo, avanzar, retroceder } from '../atomo.js';

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

test('avanzar: máximo 4 anillos, el quinto no cambia nada y devuelve el MISMO objeto', () => {
  let estado = crearEstadoAtomo('arte');
  for (let i = 0; i < 4; i += 1) {
    estado = avanzar(estado, subtema(i, `Corto ${i}`, `Completo ${i}`));
  }
  assert.equal(estado.ruta.length, 4);
  const conCuatro = estado;
  const intentoQuinto = avanzar(conCuatro, subtema(4, 'Corto 4', 'Completo 4'));
  assert.equal(intentoQuinto, conCuatro); // misma referencia, no una copia igual
  assert.equal(intentoQuinto.ruta.length, 4);
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
