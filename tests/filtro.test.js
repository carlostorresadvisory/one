// Tests de filtro.js (spec v0.3 §4): filtro por modo, índice local ruta→ids, predicado, partida,
// y las piezas de DOM (chip y lista de áreas) con el DOM falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTRO_TODOS, MIN_JUGABLES, CLAVE_FILTROS, CLAVE_INDICE_RUTAS, normalizarFiltro, esTodos, etiquetaFiltro,
  claveRuta, filtroDeModo, guardarFiltroDeModo, leerIndiceRutas, registrarIdsRuta, idsDeRuta, crearPredicado,
  preguntasDelFiltro, contarJugables, filtroParaPartida, filtroParaRepaso, avisoFiltroCorto, pintarChip, construirListaAreas,
} from '../filtro.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';
import { ElementoFalso, instalarDomFalso } from './dom-falso.js';

const NOMBRES = { historia: 'Historia', ciencia: 'Ciencia', economia: 'Economía' };
const nombreArea = (a) => NOMBRES[a] || a;
const ROMA = { area: 'historia', ruta: ['Roma antigua y su imperio'], etiquetas: ['Roma'] };
const banco = [
  { id: 'h1', area: 'historia' }, { id: 'h2', area: 'historia' }, { id: 'srv-1', area: 'historia' },
  { id: 'srv-2', area: 'historia' }, { id: 'c1', area: 'ciencia' },
];

test('normalizarFiltro: TODOS ante basura; área sola; ruta coherente', () => {
  assert.deepEqual(normalizarFiltro(null), { area: null, ruta: [], etiquetas: [] });
  assert.deepEqual(normalizarFiltro({ area: 'cocina' }), { area: null, ruta: [], etiquetas: [] });
  assert.deepEqual(normalizarFiltro({ area: 'historia' }), { area: 'historia', ruta: [], etiquetas: [] });
  assert.deepEqual(normalizarFiltro(ROMA), ROMA);
  // ruta y etiquetas de distinta longitud: se queda en el área (no inventa un nivel)
  assert.deepEqual(normalizarFiltro({ area: 'historia', ruta: ['a', 'b'], etiquetas: ['a'] }), { area: 'historia', ruta: [], etiquetas: [] });
  assert.equal(esTodos(FILTRO_TODOS), true);
  assert.equal(esTodos(ROMA), false);
});

test('etiquetaFiltro: TODOS · Área · Área · último nivel', () => {
  assert.equal(etiquetaFiltro(FILTRO_TODOS, nombreArea), 'TODOS');
  assert.equal(etiquetaFiltro({ area: 'historia' }, nombreArea), 'Historia');
  assert.equal(etiquetaFiltro(ROMA, nombreArea), 'Historia · Roma');
});

test('filtro por modo: cada modo recuerda el suyo', () => {
  const almacen = almacenFalso();
  assert.deepEqual(filtroDeModo('clasico', almacen), normalizarFiltro(null));
  guardarFiltroDeModo('clasico', ROMA, almacen);
  guardarFiltroDeModo('repaso', { area: 'ciencia' }, almacen);
  assert.deepEqual(filtroDeModo('clasico', almacen), ROMA);
  assert.equal(filtroDeModo('repaso', almacen).area, 'ciencia');
  assert.equal(filtroDeModo('apuesta', almacen).area, null);
});

test('Review Focus 2: one.filtros roto o almacén roto → TODOS, sin lanzar', () => {
  assert.equal(filtroDeModo('clasico', almacenFalso({ [CLAVE_FILTROS]: '{roto' })).area, null);
  assert.equal(filtroDeModo('clasico', almacenFalso({ [CLAVE_FILTROS]: '[1,2]' })).area, null);
  assert.equal(filtroDeModo('clasico', almacenRoto()).area, null);
  assert.equal(guardarFiltroDeModo('clasico', ROMA, almacenRoto()), false);
});

test('almacenamiento bloqueado: el getter de localStorage lanza y nada de filtro.js lanza', (t) => {
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
  assert.equal(filtroDeModo('clasico').area, null);
  assert.equal(guardarFiltroDeModo('clasico', ROMA), false);
  assert.deepEqual(leerIndiceRutas(), {});
  assert.equal(registrarIdsRuta('historia', ROMA.ruta, ['srv-1']), false);
});

test('índice de rutas: registra, deduplica y lee; claves basura se descartan', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1', 'srv-2'], almacen);
  registrarIdsRuta('historia', ROMA.ruta, ['srv-2', 'srv-3'], almacen);
  const indice = leerIndiceRutas(almacen);
  assert.deepEqual(indice[claveRuta('historia', ROMA.ruta)], ['srv-1', 'srv-2', 'srv-3']);
  const sucio = almacenFalso({ [CLAVE_INDICE_RUTAS]: JSON.stringify({ basura: ['x'], '["cocina",[]]': ['y'], '["historia",[]]': 'no-lista' }) });
  assert.deepEqual(leerIndiceRutas(sucio), {});
  assert.deepEqual(leerIndiceRutas(almacenFalso({ [CLAVE_INDICE_RUTAS]: '{roto' })), {});
  assert.equal(registrarIdsRuta('cocina', [], ['z'], almacen), false);
});

test('idsDeRuta incluye los subnodos de la ruta (prefijo), no los hermanos', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ['Roma antigua y su imperio'], ['srv-1'], almacen);
  registrarIdsRuta('historia', ['Roma antigua y su imperio', 'Las guerras púnicas'], ['srv-2'], almacen);
  registrarIdsRuta('historia', ['Grecia clásica'], ['srv-9'], almacen);
  const ids = idsDeRuta(leerIndiceRutas(almacen), 'historia', ['Roma antigua y su imperio']);
  assert.deepEqual([...ids].sort(), ['srv-1', 'srv-2']);
});

test('dos tandas que terminan seguidas (rutas distintas y la misma ruta) no se pisan: cada registro relee el índice', () => {
  const almacen = almacenFalso();
  // Tanda A (anticipada con 5) y tanda B intercaladas, como las verían dos sondeos consecutivos.
  registrarIdsRuta('historia', ['Roma antigua y su imperio'], ['a1', 'a2', 'a3', 'a4', 'a5'], almacen);
  registrarIdsRuta('historia', ['Grecia clásica'], ['b1', 'b2'], almacen);
  registrarIdsRuta('historia', ['Roma antigua y su imperio'], ['a1', 'a6'], almacen); // cierre de A con repetidas
  const indice = leerIndiceRutas(almacen);
  assert.deepEqual(indice[claveRuta('historia', ['Roma antigua y su imperio'])], ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  assert.deepEqual(indice[claveRuta('historia', ['Grecia clásica'])], ['b1', 'b2']);
});

test('ids del índice que ya no existen en el banco no entran en la partida ni rompen nada', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1', 'fantasma-1', 'fantasma-2'], almacen);
  const r = filtroParaPartida(ROMA, banco, leerIndiceRutas(almacen), { reportadas: [], tarjetas: {} }, nombreArea);
  assert.deepEqual(r.ids, ['srv-1']);
});

test('crearPredicado: TODOS, área y ruta', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1', 'srv-2'], almacen);
  const indice = leerIndiceRutas(almacen);
  assert.equal(banco.filter(crearPredicado(FILTRO_TODOS, indice)).length, 5);
  assert.equal(banco.filter(crearPredicado({ area: 'historia' }, indice)).length, 4);
  assert.deepEqual(banco.filter(crearPredicado(ROMA, indice)).map((p) => p.id), ['srv-1', 'srv-2']);
});

test('Review Focus 3: contarJugables ignora reportadas e ids del índice que ya no están en el banco', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1', 'srv-2', 'srv-borrada'], almacen);
  const indice = leerIndiceRutas(almacen);
  assert.equal(contarJugables(banco, ROMA, indice, ['srv-2']), 1);
  assert.deepEqual(preguntasDelFiltro(banco, ROMA, indice, []).map((p) => p.id), ['srv-1', 'srv-2']);
  assert.equal(MIN_JUGABLES, 5);
});

test('filtroParaPartida: null para TODOS, {area} para un área, {ids, etiqueta} para una ruta', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1', 'srv-2'], almacen);
  const indice = leerIndiceRutas(almacen);
  const estado = { reportadas: [], tarjetas: { 'srv-1': { proximo: '2026-10-01' } } };
  assert.equal(filtroParaPartida(FILTRO_TODOS, banco, indice, estado), null);
  assert.deepEqual(filtroParaPartida({ area: 'ciencia' }, banco, indice, estado), { area: 'ciencia' });
  // sin jugar primero (srv-2), después la ya jugada
  assert.deepEqual(filtroParaPartida(ROMA, banco, indice, estado, nombreArea), { ids: ['srv-2', 'srv-1'], etiqueta: 'Historia · Roma' });
});

test('filtroParaPartida con ruta: como mucho 10 ids', () => {
  const muchos = Array.from({ length: 14 }, (_, i) => ({ id: `srv-${i}`, area: 'historia' }));
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, muchos.map((p) => p.id), almacen);
  const r = filtroParaPartida(ROMA, muchos, leerIndiceRutas(almacen), { reportadas: [], tarjetas: {} });
  assert.equal(r.ids.length, 10);
});

test('filtroParaRepaso: pendientes en su orden, filtradas, sin reportadas, máx. 10; null si no queda ninguna', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1'], almacen);
  const indice = leerIndiceRutas(almacen);
  const pend = [{ id: 'c1', area: 'ciencia' }, { id: 'srv-1', area: 'historia' }, { id: 'h2', area: 'historia' }];
  assert.deepEqual(filtroParaRepaso(pend, FILTRO_TODOS, indice), { ids: ['c1', 'srv-1', 'h2'], etiqueta: 'Repaso' });
  assert.deepEqual(filtroParaRepaso(pend, { area: 'historia' }, indice, ['h2'], nombreArea), { ids: ['srv-1'], etiqueta: 'Repaso · Historia' });
  assert.deepEqual(filtroParaRepaso(pend, ROMA, indice, [], nombreArea).ids, ['srv-1']);
  assert.equal(filtroParaRepaso([], FILTRO_TODOS, indice), null);
  assert.equal(filtroParaRepaso(pend, { area: 'arte' }, indice), null);
  const muchas = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, area: 'ciencia' }));
  assert.equal(filtroParaRepaso(muchas, FILTRO_TODOS, indice).ids.length, 10);
});

test('pintarChip: texto, title y aria-label', () => {
  const boton = new ElementoFalso('button');
  pintarChip(boton, 'Historia · Roma');
  assert.equal(boton.textContent, 'Historia · Roma');
  assert.equal(boton.title, 'Historia · Roma');
  assert.equal(boton.getAttribute('aria-label'), 'Filtro: Historia · Roma. Toca para cambiarlo');
});

test('construirListaAreas: TODOS + un botón por área, marca el actual y avisa al elegir', (t) => {
  t.after(instalarDomFalso());
  const elegidas = [];
  const lista = construirListaAreas({
    areas: ['historia', 'ciencia'], nombreArea, emojiArea: () => '•', filtroActual: { area: 'ciencia' },
    alElegir: (area) => elegidas.push(area),
  });
  const botones = lista.children;
  assert.deepEqual(botones.map((b) => b.dataset.test), ['filtro-todos', 'filtro-area-historia', 'filtro-area-ciencia']);
  assert.equal(botones[2].getAttribute('aria-pressed'), 'true');
  assert.equal(botones[0].getAttribute('aria-pressed'), 'false');
  botones[0].disparar('click');
  botones[1].disparar('click');
  assert.deepEqual(elegidas, [null, 'historia']);
});

test('avisoFiltroCorto: null con TODOS o con 5 o más; textos y botones por modo y número', () => {
  const ECO = { area: 'economia', ruta: [], etiquetas: [] };
  assert.equal(avisoFiltroCorto({ modo: 'clasico', filtro: FILTRO_TODOS, n: 0 }), null);
  assert.equal(avisoFiltroCorto({ modo: 'clasico', filtro: ECO, n: MIN_JUGABLES, nombreArea }), null);
  assert.deepEqual(avisoFiltroCorto({ modo: 'clasico', filtro: ECO, n: 2, nombreArea }),
    { texto: 'Solo hay 2 preguntas de Economía', generar: true, jugar: 'Jugar las 2' });
  assert.deepEqual(avisoFiltroCorto({ modo: 'clasico', filtro: ECO, n: 1, nombreArea }),
    { texto: 'Solo hay 1 pregunta de Economía', generar: true, jugar: 'Jugar la 1' });
  assert.deepEqual(avisoFiltroCorto({ modo: 'clasico', filtro: ROMA, n: 0, nombreArea }),
    { texto: 'Aún no hay preguntas de Historia · Roma', generar: true, jugar: null });
  assert.deepEqual(avisoFiltroCorto({ modo: 'repaso', filtro: { area: 'ciencia' }, n: 1, nombreArea }),
    { texto: 'Solo hay 1 pendiente de Ciencia', generar: false, jugar: 'Repasar la 1' });
  assert.deepEqual(avisoFiltroCorto({ modo: 'repaso', filtro: { area: 'ciencia' }, n: 3, nombreArea }),
    { texto: 'Solo hay 3 pendientes de Ciencia', generar: false, jugar: 'Repasar las 3' });
  assert.deepEqual(avisoFiltroCorto({ modo: 'repaso', filtro: { area: 'ciencia' }, n: 0, nombreArea }),
    { texto: 'Nada por repasar de Ciencia', generar: false, jugar: null });
});

test('filtroParaPartida con ruta y 0 candidatas devuelve {ids: [], etiqueta}, no null', () => {
  const r = filtroParaPartida(ROMA, banco, {}, { reportadas: [], tarjetas: {} }, nombreArea);
  assert.deepEqual(r, { ids: [], etiqueta: 'Historia · Roma' });
});

test('filtroParaPartida con área sin ruta: {area} si hay nuevas o vencidas; si no, {ids} ordenados (repaso adelantado)', () => {
  const indice = {};
  const hoy = '2026-10-06';
  const nuevas = { reportadas: [], tarjetas: { h1: { proximo: '2026-10-20' } } }; // h2, srv-1, srv-2 sin jugar
  assert.deepEqual(filtroParaPartida({ area: 'historia' }, banco, indice, nuevas, nombreArea, hoy), { area: 'historia' });
  const vencida = { reportadas: [], tarjetas: { h1: { proximo: '2026-10-01' }, h2: { proximo: '2026-10-20' }, 'srv-1': { proximo: '2026-10-20' }, 'srv-2': { proximo: '2026-10-20' } } };
  assert.deepEqual(filtroParaPartida({ area: 'historia' }, banco, indice, vencida, nombreArea, hoy), { area: 'historia' });
  const todasAlDia = { reportadas: [], tarjetas: { h1: { proximo: '2026-10-09' }, h2: { proximo: '2026-10-08' }, 'srv-1': { proximo: '2026-10-20' }, 'srv-2': { proximo: '2026-10-07' } } };
  const r = filtroParaPartida({ area: 'historia' }, banco, indice, todasAlDia, nombreArea, hoy);
  assert.deepEqual(r, { ids: ['srv-2', 'h2', 'h1', 'srv-1'], etiqueta: 'Historia' });
  assert.equal(r.ids.length, contarJugables(banco, { area: 'historia' }, indice, [])); // contar y jugar coinciden
});
