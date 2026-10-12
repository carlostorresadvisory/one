// Tests del núcleo puro de mochila.js (spec v0.3 §6; tienda/cofres/uso en fases 4 y 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJETOS, PROBABILIDADES_COFRE, CLAVE_MOCHILA, crearMochila, normalizarMochila, sortearObjeto,
  anadirObjeto, contarObjetos, cargarMochila, guardarMochila, ganaPremioTanda, comprar, vender, puedeUsar, usar,
  TITULOS, COFRE_TIENDA, MAX_ESCUDOS, comprarTitulo, equiparTitulo, comprarCofre,
} from '../mochila.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

test('OBJETOS: precios y rarezas de la tabla de la spec §6', () => {
  assert.deepEqual(
    Object.values(OBJETOS).map((o) => [o.id, o.nombre, o.precio, o.rareza]),
    [['cincuenta', '50/50', 300, 'raro'], ['salvavidas', 'Salvavidas', 500, 'epico'], ['mas5', '+5 s', 200, 'comun'],
      ['saltar', 'Saltar', 250, 'comun'], ['segunda', 'Segunda oportunidad', 400, 'raro'], ['escudo', 'Escudo de racha', 600, 'raro']]
  );
});

test('PROBABILIDADES_COFRE: suman 1 en normal y en doble', () => {
  for (const tabla of Object.values(PROBABILIDADES_COFRE)) {
    assert.ok(Math.abs(tabla.reduce((s, [, p]) => s + p, 0) - 1) < 1e-9);
  }
});

test('sortearObjeto normal: +5 s 45 % · 50/50 35 % · Salvavidas 20 %', () => {
  assert.equal(sortearObjeto(() => 0), 'mas5');
  assert.equal(sortearObjeto(() => 0.449), 'mas5');
  assert.equal(sortearObjeto(() => 0.45), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.799), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.8), 'salvavidas');
  assert.equal(sortearObjeto(() => 0.9999), 'salvavidas');
});

test('sortearObjeto doble: 30 % · 35 % · 35 %; tipo desconocido = normal', () => {
  assert.equal(sortearObjeto(() => 0.29, 'doble'), 'mas5');
  assert.equal(sortearObjeto(() => 0.3, 'doble'), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.65, 'doble'), 'salvavidas');
  assert.equal(sortearObjeto(() => 0.5, 'raro'), 'cincuenta');
});

test('anadirObjeto es inmutable, suma y rechaza ids o cantidades inválidas', () => {
  const vacia = crearMochila();
  const una = anadirObjeto(vacia, 'salvavidas');
  assert.equal(vacia.objetos.salvavidas, 0);
  assert.equal(una.objetos.salvavidas, 1);
  assert.equal(anadirObjeto(una, 'salvavidas', 2).objetos.salvavidas, 3);
  assert.equal(anadirObjeto(una, 'cohete'), una);
  assert.equal(anadirObjeto(una, 'mas5', 0), una);
});

test('contarObjetos suma todos los objetos', () => {
  const m = anadirObjeto(anadirObjeto(crearMochila(), 'mas5', 2), 'cincuenta');
  assert.equal(contarObjetos(m), 3);
  assert.equal(contarObjetos(null), 0);
});

test('normalizarMochila descarta negativos, decimales, ids desconocidos y basura', () => {
  const m = normalizarMochila({ objetos: { mas5: -1, cincuenta: 2.5, salvavidas: 4, cohete: 9 } });
  assert.deepEqual(m, { version: 2, objetos: { cincuenta: 0, salvavidas: 4, mas5: 0, saltar: 0, segunda: 0, escudo: 0 }, titulos: [], titulo: null });
  assert.deepEqual(normalizarMochila('basura'), crearMochila());
});

test('persistencia: guardar + cargar ida y vuelta', () => {
  const almacen = almacenFalso();
  assert.equal(guardarMochila(anadirObjeto(crearMochila(), 'mas5'), almacen), true);
  assert.equal(cargarMochila(almacen).objetos.mas5, 1);
});

test('Review Focus 2: JSON roto o almacén roto → mochila vacía, sin lanzar', () => {
  assert.deepEqual(cargarMochila(almacenFalso({ [CLAVE_MOCHILA]: '{roto' })), crearMochila());
  assert.deepEqual(cargarMochila(almacenRoto()), crearMochila());
  assert.equal(guardarMochila(crearMochila(), almacenRoto()), false);
});

test('ganaPremioTanda: tanda de 10 con 10/10 aciertos', () => {
  assert.equal(ganaPremioTanda({ respondidas: 10, aciertos: 10 }), true);
  assert.equal(ganaPremioTanda({ respondidas: 10, aciertos: 9 }), false);
  assert.equal(ganaPremioTanda({ respondidas: 10, aciertos: 8 }), false);
  assert.equal(ganaPremioTanda({ respondidas: 9, aciertos: 9 }), false);
});

test('localStorage bloqueado (getter que lanza): cargar y guardar no lanzan', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(cargarMochila(), crearMochila());
    assert.equal(guardarMochila(crearMochila()), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('los comodines nombran ordago, no apuesta', () => {
  assert.ok(OBJETOS.salvavidas.modos.includes('ordago'));
  assert.ok(OBJETOS.cincuenta.modos.includes('ordago'));
  assert.ok(!OBJETOS.salvavidas.modos.includes('apuesta'));
  assert.ok(!OBJETOS.cincuenta.modos.includes('apuesta'));
});

test('sin almacenamiento la mochila vive en memoria; con almacén sano vuelve a mandar el almacén', () => {
  const roto = almacenRoto();
  const mochila = anadirObjeto(cargarMochila(roto), 'mas5');
  assert.equal(guardarMochila(mochila, roto), false); // false = no persistió
  assert.equal(contarObjetos(cargarMochila(roto)), 1);
  assert.equal(guardarMochila(crearMochila(), almacenFalso()), true);
  assert.equal(contarObjetos(cargarMochila(roto)), 0);
});

// --- Tienda y uso de comodines (spec §6, fase 9) ---------------------------------------------------------------

test('comprar: descuenta el precio, suma uno y es inmutable; con fondo justo deja 0', () => {
  const vacia = crearMochila();
  const r = comprar(vacia, 300, 'cincuenta');
  assert.deepEqual([r.ok, r.fondo, r.mochila.objetos.cincuenta], [true, 0, 1]);
  assert.equal(vacia.objetos.cincuenta, 0);
  assert.equal(comprar(vacia, 1000, 'mas5').fondo, 800);
});

test('comprar: sin fondos o con id desconocido no cambia nada', () => {
  const m = crearMochila();
  assert.deepEqual(comprar(m, 299, 'cincuenta'), { ok: false, motivo: 'sin-fondos' });
  assert.deepEqual(comprar(m, 1000, 'cohete'), { ok: false, motivo: 'objeto-desconocido' });
  assert.deepEqual(comprar(m, 1000, '__proto__'), { ok: false, motivo: 'objeto-desconocido' });
  assert.deepEqual(comprar(m, NaN, 'mas5'), { ok: false, motivo: 'sin-fondos' });
});

test('vender: devuelve la mitad del precio (entera); sin tenerlo → no-tienes', () => {
  const m = anadirObjeto(crearMochila(), 'cincuenta');
  const r = vender(m, 10, 'cincuenta');
  assert.deepEqual([r.ok, r.fondo, r.mochila.objetos.cincuenta], [true, 160, 0]);
  assert.equal(m.objetos.cincuenta, 1);
  assert.deepEqual(vender(crearMochila(), 10, 'cincuenta'), { ok: false, motivo: 'no-tienes' });
  assert.deepEqual(vender(m, 10, 'cohete'), { ok: false, motivo: 'no-tienes' });
});

test('puedeUsar: lo tienes, el modo lo admite, no repetido en la pregunta, 50/50 solo en test4', () => {
  const m = anadirObjeto(anadirObjeto(anadirObjeto(crearMochila(), 'cincuenta'), 'salvavidas'), 'mas5');
  const base = { modo: 'ordago', tipoPregunta: 'test4', usadosEnPregunta: [] };
  assert.equal(puedeUsar(m, 'cincuenta', base), true);
  assert.equal(puedeUsar(m, 'cincuenta', { ...base, tipoPregunta: 'vf' }), false);
  assert.equal(puedeUsar(m, 'mas5', { ...base, modo: 'clasico' }), false);
  assert.equal(puedeUsar(m, 'mas5', { ...base, modo: 'contrarreloj' }), true);
  assert.equal(puedeUsar(m, 'cincuenta', { ...base, usadosEnPregunta: ['cincuenta'] }), false);
  assert.equal(puedeUsar(m, 'salvavidas', { ...base, modo: 'masomenos', tipoPregunta: undefined }), true);
  assert.equal(puedeUsar(crearMochila(), 'salvavidas', base), false);
  assert.equal(puedeUsar(m, 'cohete', base), false);
  assert.equal(puedeUsar(m, 'cincuenta', { modo: 'ordago', tipoPregunta: 'test4' }), true);
});

test('usar: descuenta uno, nunca baja de 0 y es inmutable', () => {
  const m = anadirObjeto(crearMochila(), 'mas5', 2);
  assert.equal(usar(m, 'mas5').objetos.mas5, 1);
  assert.equal(m.objetos.mas5, 2);
  assert.equal(usar(crearMochila(), 'mas5').objetos.mas5, 0);
  assert.equal(usar(m, 'cohete').objetos.mas5, 2);
});

// --- Mochila v2 y Tienda ampliada (plan v0.3.3) -------------------------------------------------------------------

test('TITULOS y COFRE_TIENDA: precios del plan v0.3.3; solo Leyenda es épico (dorado)', () => {
  assert.deepEqual(TITULOS.map((t) => [t.id, t.nombre, t.precio, t.rareza]), [
    ['aprendiz', 'Aprendiz', 150, 'comun'], ['curioso', 'Curioso', 300, 'comun'], ['erudito', 'Erudito', 500, 'raro'],
    ['oraculo', 'Oráculo', 750, 'raro'], ['leyenda', 'Leyenda', 1000, 'epico'],
  ]);
  assert.deepEqual([COFRE_TIENDA.precio, COFRE_TIENDA.icono], [250, '🏺']);
});

test('mochila v2: lee una v1 guardada sin perder nada y la vuelve a guardar como v2', () => {
  const almacen = almacenFalso({ [CLAVE_MOCHILA]: JSON.stringify({ version: 1, objetos: { cincuenta: 2, salvavidas: 1, mas5: 3 } }) });
  const m = cargarMochila(almacen);
  assert.deepEqual(m, { version: 2, objetos: { cincuenta: 2, salvavidas: 1, mas5: 3, saltar: 0, segunda: 0, escudo: 0 }, titulos: [], titulo: null });
  guardarMochila(m, almacen);
  assert.equal(JSON.parse(almacen.getItem(CLAVE_MOCHILA)).version, 2);
  assert.equal(cargarMochila(almacen).objetos.mas5, 3);
});

test('mochila v2: títulos sin repetir ni inventados; el equipado tiene que estar comprado; el escudo se recorta al tope', () => {
  const m = normalizarMochila({ objetos: { escudo: 7 }, titulos: ['curioso', 'curioso', 'rey', 5], titulo: 'curioso' });
  assert.deepEqual([m.titulos, m.titulo, m.objetos.escudo], [['curioso'], 'curioso', MAX_ESCUDOS]);
  assert.equal(normalizarMochila({ objetos: {}, titulos: ['curioso'], titulo: 'leyenda' }).titulo, null);
  assert.equal(normalizarMochila({ objetos: {}, titulos: 'x', titulo: 3 }).titulos.length, 0);
});

test('escudo: tope de 2 al comprar (motivo «tope») y al añadir; comprar uno cuesta 600', () => {
  assert.equal(MAX_ESCUDOS, 2);
  let r = comprar(crearMochila(), 2000, 'escudo');
  assert.deepEqual([r.ok, r.fondo, r.mochila.objetos.escudo], [true, 1400, 1]);
  r = comprar(r.mochila, r.fondo, 'escudo');
  assert.deepEqual([r.ok, r.fondo, r.mochila.objetos.escudo], [true, 800, 2]);
  assert.deepEqual(comprar(r.mochila, r.fondo, 'escudo'), { ok: false, motivo: 'tope' });
  assert.equal(anadirObjeto(r.mochila, 'escudo').objetos.escudo, 2);
  const v = vender(r.mochila, 0, 'escudo'); // vender devuelve la mitad y libera hueco
  assert.deepEqual([v.fondo, v.mochila.objetos.escudo], [300, 1]);
});

test('el escudo no se usa en partida (pasivo) y Saltar / Segunda oportunidad respetan modo y tipo', () => {
  const m = ['escudo', 'saltar', 'segunda'].reduce((acc, id) => anadirObjeto(acc, id), crearMochila());
  const base = { modo: 'clasico', tipoPregunta: 'test4', usadosEnPregunta: [] };
  assert.equal(puedeUsar(m, 'escudo', base), false);
  assert.equal(puedeUsar(m, 'saltar', base), true);
  assert.equal(puedeUsar(m, 'saltar', { ...base, tipoPregunta: 'vf' }), true);
  assert.equal(puedeUsar(m, 'saltar', { ...base, modo: 'masomenos' }), false);
  assert.equal(puedeUsar(m, 'segunda', base), true);
  assert.equal(puedeUsar(m, 'segunda', { ...base, tipoPregunta: 'vf' }), false);
  assert.equal(puedeUsar(m, 'segunda', { ...base, tipoPregunta: 'ordenar' }), false);
  assert.equal(puedeUsar(m, 'segunda', { ...base, modo: 'ordago' }), false);
  assert.equal(puedeUsar(m, 'segunda', { ...base, modo: 'contrarreloj' }), true);
  assert.equal(puedeUsar(m, 'saltar', { ...base, modo: 'ordago' }), true);
});

test('comprarTitulo: descuenta, no se repite, no llega sin fondos y no se vende', () => {
  const m = crearMochila();
  const r = comprarTitulo(m, 1000, 'erudito');
  assert.deepEqual([r.ok, r.fondo, r.mochila.titulos], [true, 500, ['erudito']]);
  assert.deepEqual(m.titulos, []);
  assert.deepEqual(comprarTitulo(r.mochila, 1000, 'erudito'), { ok: false, motivo: 'ya-lo-tienes' });
  assert.deepEqual(comprarTitulo(m, 999, 'leyenda'), { ok: false, motivo: 'sin-fondos' });
  assert.deepEqual(comprarTitulo(m, 999, 'rey'), { ok: false, motivo: 'titulo-desconocido' });
  assert.deepEqual(comprarTitulo(m, 999, '__proto__'), { ok: false, motivo: 'titulo-desconocido' });
  assert.deepEqual(vender(r.mochila, 0, 'erudito'), { ok: false, motivo: 'no-tienes' }); // los títulos no son objetos
});

test('equiparTitulo: solo uno comprado; cambiar de título deja el anterior comprado', () => {
  const m = comprarTitulo(comprarTitulo(crearMochila(), 5000, 'curioso').mochila, 4000, 'leyenda').mochila;
  assert.deepEqual(equiparTitulo(m, 'oraculo'), { ok: false, motivo: 'no-lo-tienes' });
  const a = equiparTitulo(m, 'curioso');
  assert.deepEqual([a.ok, a.mochila.titulo], [true, 'curioso']);
  const b = equiparTitulo(a.mochila, 'leyenda');
  assert.deepEqual([b.mochila.titulo, b.mochila.titulos], ['leyenda', ['curioso', 'leyenda']]);
  assert.equal(m.titulo, null);
});

test('PROBABILIDADES_COFRE.tienda: 30/25/20/15/10 con valor esperado por encima del precio; los cofres de partida no cambian', () => {
  assert.deepEqual(PROBABILIDADES_COFRE.tienda, [['mas5', 0.3], ['saltar', 0.25], ['cincuenta', 0.2], ['segunda', 0.15], ['salvavidas', 0.1]]);
  const esperado = PROBABILIDADES_COFRE.tienda.reduce((s, [id, p]) => s + OBJETOS[id].precio * p, 0);
  assert.ok(esperado > COFRE_TIENDA.precio, `valor esperado ${esperado}`);
  assert.deepEqual(PROBABILIDADES_COFRE.normal, [['mas5', 0.45], ['cincuenta', 0.35], ['salvavidas', 0.2]]);
  assert.deepEqual(PROBABILIDADES_COFRE.doble, [['mas5', 0.3], ['cincuenta', 0.35], ['salvavidas', 0.35]]);
  assert.equal(sortearObjeto(() => 0.29, 'tienda'), 'mas5');
  assert.equal(sortearObjeto(() => 0.3, 'tienda'), 'saltar');
  assert.equal(sortearObjeto(() => 0.55, 'tienda'), 'cincuenta');
  assert.equal(sortearObjeto(() => 0.75, 'tienda'), 'segunda');
  assert.equal(sortearObjeto(() => 0.9, 'tienda'), 'salvavidas');
});

test('comprarCofre: cobra 250, mete el objeto sorteado en la mochila y no guarda el cofre', () => {
  const m = crearMochila();
  const r = comprarCofre(m, 1000, () => 0.3); // saltar
  assert.deepEqual([r.ok, r.fondo, r.objeto, r.mochila.objetos.saltar], [true, 750, 'saltar', 1]);
  assert.equal(contarObjetos(r.mochila), 1);
  assert.equal(m.objetos.saltar, 0);
  assert.deepEqual(comprarCofre(m, 249, () => 0), { ok: false, motivo: 'sin-fondos' });
  assert.equal(comprarCofre(m, 250, () => 0.95).fondo, 0);
});
