import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAVE_AVISO, MS_AVISO, crearColaAviso, puedeMostrarse, montarAviso } from '../aviso-generadas.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';
import { instalarDomFalso, ElementoFalso } from './dom-falso.js';

test('la cola persiste y sobrevive a recrearla con el mismo almacén', () => {
  const almacen = almacenFalso();
  crearColaAviso({ almacen }).encolar({ ids: ['a', 'b'], corto: 'Roma' });
  assert.deepEqual(crearColaAviso({ almacen }).pendiente(), { ids: ['a', 'b'], corto: 'Roma' });
});

test('descartar borra la clave', () => {
  const almacen = almacenFalso();
  const cola = crearColaAviso({ almacen });
  cola.encolar({ ids: ['a'], corto: 'Roma' });
  assert.ok(almacen.datos.has(CLAVE_AVISO));
  cola.descartar();
  assert.equal(almacen.datos.has(CLAVE_AVISO), false);
  assert.equal(cola.pendiente(), null);
});

test('con el almacén bloqueado vive en memoria y nada lanza', () => {
  const cola = crearColaAviso({ almacen: almacenRoto() });
  assert.doesNotThrow(() => cola.encolar({ ids: ['a'], corto: 'Roma' }));
  assert.deepEqual(cola.pendiente(), { ids: ['a'], corto: 'Roma' });
  assert.doesNotThrow(() => cola.descartar());
  assert.equal(cola.pendiente(), null);
});

test('JSON corrupto o con forma errónea -> null', () => {
  for (const crudo of ['{no es json', '{"ids":"a","corto":"x"}', '{"ids":["a"],"corto":3}', '{"ids":[],"corto":"x"}', 'null']) {
    const cola = crearColaAviso({ almacen: almacenFalso({ [CLAVE_AVISO]: crudo }) });
    assert.equal(cola.pendiente(), null, crudo);
  }
});

test('encolar ignora un aviso sin preguntas', () => {
  const cola = crearColaAviso({ almacen: almacenFalso() });
  cola.encolar({ ids: [], corto: 'Roma' });
  assert.equal(cola.pendiente(), null);
});

test('puedeMostrarse: no en pregunta, repaso, ordago, contrarreloj, caida, cofre, atomo-espera ni en segundo plano; sí en el resto', () => {
  for (const vista of ['pregunta', 'repaso', 'ordago', 'contrarreloj', 'caida', 'cofre', 'atomo-espera']) assert.equal(puedeMostrarse({ vista, visible: true }), false, vista);
  assert.equal(puedeMostrarse({ vista: 'progreso', visible: false }), false);
  for (const vista of ['progreso', 'resumen', 'atomo']) assert.equal(puedeMostrarse({ vista, visible: true }), true, vista);
});

function montar() {
  const desinstalar = instalarDomFalso();
  const temporizador = temporizadorFalso();
  const nodo = new ElementoFalso('div');
  const llamadas = { jugar: 0, cerrar: 0 };
  const montado = montarAviso(nodo, { ids: ['a', 'b', 'c'], corto: 'Roma' }, {
    alJugar: () => llamadas.jugar++,
    alCerrar: () => llamadas.cerrar++,
    temporizador,
  });
  return { nodo, temporizador, llamadas, montado, desinstalar };
}

test('montarAviso pinta el texto y se muestra', () => {
  const { nodo, desinstalar } = montar();
  try {
    assert.equal(nodo.hidden, false);
    assert.match(nodo.textoPlano, /Preguntas generadas/);
    assert.match(nodo.textoPlano, /Roma · 3/);
    assert.match(nodo.textoPlano, /Jugar ▶/);
  } finally {
    desinstalar();
  }
});

test('montarAviso se cierra solo a los 20 s llamando a alCerrar una vez', () => {
  const { nodo, temporizador, llamadas, desinstalar } = montar();
  try {
    temporizador.avanzar(MS_AVISO - 1);
    assert.equal(llamadas.cerrar, 0);
    temporizador.avanzar(1);
    assert.equal(llamadas.cerrar, 1);
    assert.equal(nodo.hidden, true);
  } finally {
    desinstalar();
  }
});

test('cerrar() antes limpia el temporizador y evita el alCerrar', () => {
  const { temporizador, llamadas, montado, desinstalar } = montar();
  try {
    montado.cerrar();
    assert.equal(temporizador.pendientes(), 0);
    temporizador.avanzar(MS_AVISO * 2);
    assert.equal(llamadas.cerrar, 0);
    assert.equal(llamadas.jugar, 0);
  } finally {
    desinstalar();
  }
});

test('tocar la banda juega una sola vez; ✕ tras jugar no hace nada; ✕ doble cierra una vez', () => {
  const a = montar();
  try {
    const jugar = a.nodo.buscarPorClase('aviso-generadas-jugar');
    jugar.disparar('click');
    jugar.disparar('click');
    a.nodo.buscarPorClase('aviso-generadas-cerrar').disparar('click');
    assert.deepEqual(a.llamadas, { jugar: 1, cerrar: 0 });
    assert.equal(a.temporizador.pendientes(), 0);
  } finally {
    a.desinstalar();
  }
  const b = montar();
  try {
    const cierre = b.nodo.buscarPorClase('aviso-generadas-cerrar');
    cierre.disparar('click');
    cierre.disparar('click');
    b.temporizador.avanzar(MS_AVISO);
    assert.deepEqual(b.llamadas, { jugar: 0, cerrar: 1 });
  } finally {
    b.desinstalar();
  }
});
