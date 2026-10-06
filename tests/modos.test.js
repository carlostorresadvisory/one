// Tests de modos.js: registro del hub v0.3 (spec §3) y último modo jugado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODOS, modoPorId, cargarUltimoModo, guardarUltimoModo, marcadorModo, CLAVE_ULTIMO_MODO, MODO_POR_DEFECTO } from '../modos.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

test('MODOS: los cinco modos en el orden de la rejilla; solo Clásico y Repaso disponibles', () => {
  assert.deepEqual(MODOS.map((m) => m.id), ['clasico', 'repaso', 'apuesta', 'masomenos', 'contrarreloj']);
  assert.deepEqual(MODOS.filter((m) => m.disponible).map((m) => m.id), ['clasico', 'repaso']);
});

test('Más o menos filtra solo hasta el área; el resto, árbol completo', () => {
  assert.equal(modoPorId('masomenos').nivelFiltro, 'area');
  assert.equal(modoPorId('clasico').nivelFiltro, 'arbol');
});

test('cada imagen es de Commons y lleva autor, licencia y página', () => {
  for (const { imagen } of MODOS) {
    assert.match(imagen.url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//);
    assert.match(imagen.pagina, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(imagen.autor && imagen.licencia && imagen.titulo);
  }
});

test('último modo: por defecto Clásico; guarda y lee; rechaza ids inválidos', () => {
  const almacen = almacenFalso();
  assert.equal(cargarUltimoModo(almacen), MODO_POR_DEFECTO);
  assert.equal(guardarUltimoModo('repaso', almacen), true);
  assert.equal(cargarUltimoModo(almacen), 'repaso');
  assert.equal(guardarUltimoModo('ruleta', almacen), false);
  assert.equal(cargarUltimoModo(almacenFalso({ [CLAVE_ULTIMO_MODO]: 'ruleta' })), 'clasico');
  assert.equal(cargarUltimoModo(almacenRoto()), 'clasico');
});

test('almacenamiento bloqueado: el getter de localStorage lanza y ni cargar ni guardar lanzan', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  assert.equal(cargarUltimoModo(), 'clasico');
  assert.equal(guardarUltimoModo('repaso'), false);
});

test('Review Focus 5: importar un v3 con ultimoModo inexistente, ausente o basura → Clásico, sin lanzar, resto íntegro', async () => {
  const { importarRespaldo, aplicarModos } = await import('../respaldo.js');
  const { crearEstado, exportar } = await import('../motor.js');
  const estado = crearEstado('2026-10-05');
  estado.xp = 123;
  for (const ultimo of ['ruleta', undefined, 42, '', null]) {
    const modos = { 'one.silencio': '1' };
    if (ultimo !== undefined) modos['one.ultimoModo'] = ultimo;
    const json = JSON.stringify({ version: 3, estado: JSON.parse(exportar(estado)), modos });
    const almacen = almacenFalso();
    const { estado: importado, modos: limpios } = importarRespaldo(json);
    aplicarModos(limpios, almacen);
    assert.equal(importado.xp, 123);
    assert.equal(almacen.getItem('one.silencio'), '1');
    // Texto inválido ('ruleta', '') se escribe tal cual y cargarUltimoModo lo rechaza; lo que no es
    // texto ni se escribe. En todos los casos: Clásico.
    assert.equal(cargarUltimoModo(almacen), 'clasico');
    assert.ok(!(CLAVE_ULTIMO_MODO in limpios) || typeof limpios[CLAVE_ULTIMO_MODO] === 'string');
  }
});

test('marcadorModo: Hoy a/r, por repasar / Al día, Próximamente', () => {
  const datos = { aciertosHoy: 4, respondidasHoy: 10, porRepasar: 15 };
  assert.equal(marcadorModo('clasico', datos), 'Hoy 4/10');
  assert.equal(marcadorModo('repaso', datos), '15 por repasar');
  assert.equal(marcadorModo('repaso', { ...datos, porRepasar: 0 }), 'Al día');
  for (const id of ['apuesta', 'masomenos', 'contrarreloj']) assert.equal(marcadorModo(id, datos), 'Próximamente');
});
