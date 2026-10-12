// Tests de filtro.js (spec v0.3 §4): filtro por modo, índice local ruta→ids, predicado, partida,
// y las piezas de DOM (chip y lista de áreas) con el DOM falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTRO_TODOS, MIN_JUGABLES, CLAVE_FILTROS, CLAVE_INDICE_RUTAS, normalizarFiltro, esTodos, etiquetaFiltro,
  claveRuta, filtroDeModo, guardarFiltroDeModo, leerIndiceRutas, registrarIdsRuta, idsDeRuta, crearPredicado,
  preguntasDelFiltro, contarJugables, filtroParaPartida, filtroParaRepaso, avisoFiltroCorto, pintarChip, construirListaAreas,
  CLAVE_ETIQUETAS_RUTAS, MAX_TEMAS_GENERADOS, leerEtiquetasRutas, registrarEtiquetasRuta, agruparTemasGenerados, construirFilaTemas,
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
  assert.equal(filtroDeModo('ordago', almacen).area, null);
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

test('avisoFiltroCorto: Contrarreloj necesita una serie entera (10), el resto 5', () => {
  const f = { area: 'geografia', ruta: [], etiquetas: [] };
  assert.equal(avisoFiltroCorto({ modo: 'contrarreloj', filtro: f, n: 10 }), null);
  assert.deepEqual(avisoFiltroCorto({ modo: 'contrarreloj', filtro: f, n: 7, nombreArea: () => 'Geografía' }),
    { texto: 'Solo hay 7 preguntas de Geografía', generar: true, jugar: null }); // una serie no repite: sin «Jugar las N»
  assert.equal(avisoFiltroCorto({ modo: 'ordago', filtro: f, n: 7 }), null);
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

test('migra el filtro guardado con la clave antigua apuesta a ordago', () => {
  const almacen = almacenFalso({ 'one.filtros': JSON.stringify({ apuesta: { area: 'historia', ruta: [], etiquetas: [] } }) });
  assert.equal(filtroDeModo('ordago', almacen).area, 'historia');
  assert.ok(!('apuesta' in JSON.parse(almacen.getItem('one.filtros'))));
  assert.equal(JSON.parse(almacen.getItem('one.filtros')).ordago.area, 'historia');
});

test('migración de apuesta: si ya hay ordago manda ese; con almacén roto no lanza', () => {
  const almacen = almacenFalso({ 'one.filtros': JSON.stringify({
    apuesta: { area: 'historia', ruta: [], etiquetas: [] }, ordago: { area: 'ciencia', ruta: [], etiquetas: [] },
  }) });
  assert.equal(filtroDeModo('ordago', almacen).area, 'ciencia');
  assert.ok(!('apuesta' in JSON.parse(almacen.getItem('one.filtros'))));
  assert.equal(filtroDeModo('ordago', almacenRoto()).area, null);
});

test('migración de apuesta: lee bien pero setItem lanza → no lanza y devuelve el filtro migrado en memoria', () => {
  const base = almacenFalso({ 'one.filtros': JSON.stringify({ apuesta: { area: 'historia', ruta: [], etiquetas: [] } }) });
  const almacen = { getItem: (c) => base.getItem(c), setItem: () => { throw new Error('cuota llena'); } };
  assert.equal(filtroDeModo('ordago', almacen).area, 'historia');
  assert.equal(guardarFiltroDeModo('ordago', { area: 'ciencia' }, almacen), false);
});

// --- Temas generados (v0.3.4 A: la fila «Tus temas» del inicio y la sección «Generados» del filtro) ---

const GRECIA = { area: 'historia', ruta: ['Grecia clásica'], etiquetas: ['Grecia'] };
const PUNICAS = { area: 'historia', ruta: ['Roma antigua y su imperio', 'Las guerras púnicas'], etiquetas: ['Roma', 'Púnicas'] };

test('etiquetas de ruta: se guardan por clave, se releen y lo roto se descarta; ruta vacía o desigual no se guarda', () => {
  const almacen = almacenFalso();
  assert.equal(registrarEtiquetasRuta('historia', ROMA.ruta, ROMA.etiquetas, almacen), true);
  assert.deepEqual(leerEtiquetasRutas(almacen)[claveRuta('historia', ROMA.ruta)], ['Roma']);
  assert.equal(registrarEtiquetasRuta('historia', [], [], almacen), false);
  assert.equal(registrarEtiquetasRuta('historia', ['a', 'b'], ['a'], almacen), false);
  assert.equal(registrarEtiquetasRuta('cocina', ['a'], ['a'], almacen), false);
  assert.deepEqual(leerEtiquetasRutas(almacenFalso({ [CLAVE_ETIQUETAS_RUTAS]: JSON.stringify({ a: 'no', b: [1], c: ['ok'] }) })), { c: ['ok'] });
  assert.deepEqual(leerEtiquetasRutas(almacenFalso({ [CLAVE_ETIQUETAS_RUTAS]: '{roto' })), {});
  assert.equal(registrarEtiquetasRuta('historia', ROMA.ruta, ROMA.etiquetas, almacenRoto()), false);
});

test('agruparTemasGenerados: recientes primero, n = ids del banco sin reportadas (con subnodos), sin tema vacío', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['srv-1', 'srv-2'], almacen);
  registrarIdsRuta('historia', GRECIA.ruta, ['h1'], almacen);
  registrarIdsRuta('ciencia', ['Física cuántica'], ['id-que-ya-no-esta'], almacen); // sin ninguna en el banco: se omite
  registrarIdsRuta('historia', ROMA.ruta, ['srv-3'], almacen); // Roma recibe otra tanda: pasa a ser la más reciente
  const bancoTemas = [...banco, { id: 'srv-3', area: 'historia' }];
  const temas = agruparTemasGenerados({ indice: leerIndiceRutas(almacen), banco: bancoTemas, reportadas: ['srv-2'], nombreArea });
  assert.deepEqual(temas.map((t) => [t.texto, t.n]), [['Roma antigua y su imperio', 2], ['Grecia clásica', 1]]);
  assert.deepEqual(temas[0].filtro, { area: 'historia', ruta: ROMA.ruta, etiquetas: ROMA.ruta });
});

test('agruparTemasGenerados: usa las etiquetas guardadas, cuenta los subnodos en el padre y rotula el área si la ruta es vacía', () => {
  const almacen = almacenFalso();
  registrarIdsRuta('historia', ROMA.ruta, ['h1'], almacen);
  registrarIdsRuta('historia', PUNICAS.ruta, ['h2'], almacen);
  registrarIdsRuta('ciencia', [], ['c1'], almacen);
  registrarEtiquetasRuta('historia', ROMA.ruta, ROMA.etiquetas, almacen);
  registrarEtiquetasRuta('historia', PUNICAS.ruta, PUNICAS.etiquetas, almacen);
  const temas = agruparTemasGenerados({ indice: leerIndiceRutas(almacen), etiquetas: leerEtiquetasRutas(almacen), banco, nombreArea });
  assert.deepEqual(temas.map((t) => [t.texto, t.n]), [['Ciencia', 1], ['Púnicas', 1], ['Roma', 2]]);
  assert.deepEqual(temas[1].filtro, PUNICAS); // lo que se pasa a guardarFiltroDeModo, ya normalizado
  assert.deepEqual(normalizarFiltro(temas[1].filtro), PUNICAS);
  assert.deepEqual(temas[0].filtro, { area: 'ciencia', ruta: [], etiquetas: [] });
});

test('agruparTemasGenerados: sin etiquetas guardadas corta el tramo largo; etiquetas de otra longitud se ignoran; respeta max', () => {
  const largo = 'Una ruta larguísima con muchas palabras que no cabe en un chip';
  const almacen = almacenFalso();
  registrarIdsRuta('historia', [largo], ['h1'], almacen);
  const temas = agruparTemasGenerados({ indice: leerIndiceRutas(almacen), etiquetas: { [claveRuta('historia', [largo])]: ['a', 'b'] }, banco });
  assert.equal(temas[0].texto.length <= 28, true);
  assert.equal(temas[0].texto.endsWith('…'), true);
  assert.deepEqual(normalizarFiltro(temas[0].filtro).ruta, [largo]); // coherente: se puede fijar como filtro
  for (let i = 0; i < 5; i += 1) registrarIdsRuta('historia', [`Tema ${i}`], ['h2'], almacen);
  assert.equal(agruparTemasGenerados({ indice: leerIndiceRutas(almacen), banco, max: 3 }).length, 3);
  assert.equal(MAX_TEMAS_GENERADOS >= 12, true);
  assert.deepEqual(agruparTemasGenerados({ indice: {}, banco }), []);
});

test('construirFilaTemas: un botón por tema con «Texto · n», título completo, marca el filtro puesto y avisa al tocar', () => {
  const desinstalar = instalarDomFalso();
  try {
    const almacen = almacenFalso();
    registrarIdsRuta('historia', ROMA.ruta, ['h1', 'h2'], almacen);
    registrarIdsRuta('historia', GRECIA.ruta, ['srv-1'], almacen);
    registrarEtiquetasRuta('historia', ROMA.ruta, ROMA.etiquetas, almacen);
    registrarEtiquetasRuta('historia', GRECIA.ruta, GRECIA.etiquetas, almacen);
    const temas = agruparTemasGenerados({ indice: leerIndiceRutas(almacen), etiquetas: leerEtiquetasRutas(almacen), banco, nombreArea });
    const elegidos = [];
    const fila = construirFilaTemas({ temas, nombreArea, filtroActual: ROMA, alElegir: (t) => elegidos.push(t.filtro) });
    assert.equal(fila.children.length, 2);
    assert.deepEqual(fila.children.map((b) => b.textContent), ['Grecia · 1', 'Roma · 2']);
    assert.equal(fila.children[1].title, 'Historia · Roma');
    assert.deepEqual(fila.children.map((b) => b.getAttribute('aria-pressed')), ['false', 'true']);
    assert.equal(fila.children[1].classList.contains('tema-chip--activo'), true);
    fila.children[0].disparar('click');
    assert.deepEqual(elegidos, [GRECIA]);
  } finally {
    desinstalar();
  }
});
