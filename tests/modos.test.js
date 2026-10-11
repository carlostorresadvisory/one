// Tests de modos.js: registro del hub v0.3 (spec §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODOS, TIENDA, modoPorId, marcadorModo, esJugableDificil, NIVEL_MINIMO_DIFICIL } from '../modos.js';

test('MODOS: los cinco modos en el orden de la rejilla, todos disponibles', () => {
  assert.deepEqual(MODOS.map((m) => m.id), ['clasico', 'repaso', 'ordago', 'masomenos', 'contrarreloj']);
  assert.deepEqual(MODOS.filter((m) => m.disponible).map((m) => m.id), ['clasico', 'repaso', 'ordago', 'masomenos', 'contrarreloj']);
});

test('Más o menos filtra solo hasta el área; el resto, árbol completo', () => {
  assert.equal(modoPorId('masomenos').nivelFiltro, 'area');
  assert.equal(modoPorId('clasico').nivelFiltro, 'arbol');
});

test('cada imagen del hub (los 5 modos y la Tienda) es una WebP propia con crédito real', () => {
  for (const { imagen } of [...MODOS, TIENDA]) {
    assert.match(imagen.url, /^imagenes-hub\/[\w-]+\.webp$/);
    assert.ok(imagen.titulo && imagen.autor && imagen.licencia && imagen.fuente);
    if (imagen.fuente === 'IA') {
      assert.equal(imagen.pagina, null); // una ilustración generada no tiene página de origen
      assert.equal(imagen.credito, 'IA · Imagen generada con IA');
      continue;
    }
    assert.match(imagen.pagina, /^https:\/\//);
    assert.ok(imagen.credito.startsWith(imagen.fuente));
    assert.ok(imagen.credito.includes(imagen.licencia));
  }
  assert.equal(new Set([...MODOS, TIENDA].map((x) => x.imagen.url)).size, 6);
});

test('ya no existe el último modo jugado', async () => {
  const modos = await import('../modos.js');
  for (const nombre of ['cargarUltimoModo', 'guardarUltimoModo', 'CLAVE_ULTIMO_MODO']) assert.equal(nombre in modos, false);
});

test('marcadorModo: Hoy a/r, por repasar / Al día, Pronto', () => {
  const datos = { aciertosHoy: 4, respondidasHoy: 10, porRepasar: 15 };
  assert.equal(marcadorModo('clasico', datos), 'Hoy 4/10');
  assert.equal(marcadorModo('repaso', datos), '15 por repasar');
  assert.equal(marcadorModo('repaso', { ...datos, porRepasar: 0 }), 'Al día');
  assert.equal(marcadorModo('masomenos', datos), 'Sin récord');
  assert.equal(marcadorModo('ordago', { fondo: 1250 }), 'Fondo 1.250');
  assert.equal(marcadorModo('ordago', {}), 'Fondo 1.000');
});

test('Contrarreloj enseña su marca o «Sin marca»; Más o menos su récord de racha o «Sin récord»', () => {
  assert.equal(marcadorModo('contrarreloj', {}), 'Sin marca');
  assert.equal(marcadorModo('contrarreloj', { marca: '7/10' }), '7/10');
  assert.equal(marcadorModo('contrarreloj', { marca: 'Doble ×2' }), 'Doble ×2');
  assert.equal(marcadorModo('masomenos', {}), 'Sin récord');
  assert.equal(marcadorModo('masomenos', { recordMasomenos: 'Récord 12' }), 'Récord 12');
});

test('suelo de nivel 3: solo V/F y test4 de nivel 3-5 valen para Órdago y Contrarreloj', () => {
  assert.equal(NIVEL_MINIMO_DIFICIL, 3);
  assert.equal(esJugableDificil({ tipo: 'vf', nivel: 3 }), true);
  assert.equal(esJugableDificil({ tipo: 'test4', nivel: 5 }), true);
  assert.equal(esJugableDificil({ tipo: 'vf', nivel: 2 }), false);
  assert.equal(esJugableDificil({ tipo: 'vf' }), false);
  assert.equal(esJugableDificil({ tipo: 'ordenar', nivel: 4 }), false);
  assert.equal(esJugableDificil({ tipo: 'error', nivel: 4 }), false);
  assert.equal(esJugableDificil({ tipo: 'vf', nivel: 6 }), false);
  assert.equal(esJugableDificil(null), false);
});

test('el modo se llama Órdago con id ordago', () => {
  assert.equal(modoPorId('ordago').nombre, 'Órdago');
  assert.equal(modoPorId('apuesta'), null);
});
