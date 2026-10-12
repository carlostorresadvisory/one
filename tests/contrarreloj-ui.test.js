import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarContrarreloj } from '../contrarreloj-ui.js';
import { ElementoFalso } from './dom-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';
import { almacenFalso } from './almacen-falso.js';

const rng = () => 0.1; // el cofre sale 'mas5'

/** Contenedor con los data-test que busca la UI; `querySelector` los resuelve por data-test. */
function contenedorCon(ids) {
  const raiz = new ElementoFalso('section');
  const porId = {};
  for (const id of ids) {
    const n = new ElementoFalso('div');
    n.style.setProperty = (k, v) => { n.style[k] = v; };
    porId[id] = n;
    raiz.appendChild(n);
  }
  raiz.querySelector = (sel) => porId[/"(.+)"/.exec(sel)[1]] ?? null;
  raiz.porId = porId;
  return raiz;
}

function montar({ preguntas = 10, ...extra } = {}) {
  const documento = new ElementoFalso('document');
  documento.createElement = (t) => new ElementoFalso(t);
  documento.hidden = false;
  const juego = contenedorCon(['contrarreloj-puntos', 'contrarreloj-fase', 'contrarreloj-foto', 'contrarreloj-barra', 'contrarreloj-opciones']);
  const caida = contenedorCon(['caida-resumen', 'caida-explicacion', 'caida-reintentar']);
  const cofre = contenedorCon(['cofre-titulo', 'cofre-premio', 'cofre-nota', 'cofre-doble', 'cofre-plantarse', 'cofre-recoger']);
  const banco = Array.from({ length: preguntas }, (_, i) => ({
    id: `p${i}`, tipo: 'vf', nivel: 4, area: 'historia', enunciado: `Enunciado ${i}`, respuesta: true, explicacion: 'Porque sí.',
  }));
  let reloj = 0;
  const registro = { objetos: [], salidas: 0, sinPreguntas: 0, pedidas: [] };
  const t = temporizadorFalso();
  const instancia = montarContrarreloj(juego, {
    documento,
    contenedorCaida: caida,
    contenedorCofre: cofre,
    mostrarVista() {},
    elegirPregunta({ enSerie }) {
      registro.pedidas.push([...enSerie]);
      return banco.find((p) => !enSerie.has(p.id)) ?? null;
    },
    registrar() {},
    celebrarAcierto() {},
    lamentarFallo() {},
    celebrarPremio() {},
    reproducir() {},
    imagenDe: () => null,
    darObjetos: (ids) => registro.objetos.push(ids),
    alSalir: () => { registro.salidas += 1; },
    alSinPreguntas: () => { registro.sinPreguntas += 1; },
    almacen: almacenFalso(),
    rng,
    ahora: () => reloj,
    raf: () => 1,
    cancelarRaf() {},
    temporizador: t,
    ...extra,
  });
  return { instancia, juego, cofre, caida, registro, avanzarReloj: (ms) => { reloj += ms; }, t };
}

test('una serie no repite preguntas: la 10.ª pide excluyendo las 9 anteriores y sin otra distinta acaba', () => {
  const { instancia, registro } = montar({ preguntas: 10 });
  instancia.acertarParaTest(10);
  assert.equal(registro.pedidas[9].length, 9);
  assert.equal(new Set(registro.pedidas[9]).size, 9);
  const corto = montar({ preguntas: 3 });
  corto.instancia.acertarParaTest(5);
  assert.equal(corto.registro.sinPreguntas, 1);
});

test('«←» en el cofre es plantarse: destruir() entrega el cofre una sola vez', () => {
  const { instancia, registro } = montar();
  instancia.acertarParaTest(10);
  instancia.destruir();
  instancia.destruir();
  assert.deepEqual(registro.objetos, [['mas5']]);
});

test('si ya se plantó, destruir() no entrega otra vez', () => {
  const { instancia, cofre, registro, avanzarReloj } = montar();
  instancia.acertarParaTest(10);
  avanzarReloj(1000);
  cofre.porId['cofre-plantarse'].disparar('click');
  assert.equal(registro.salidas, 1);
  instancia.destruir();
  assert.deepEqual(registro.objetos, [['mas5']]);
});

test('«←» tras ganar el doble entrega los 2 objetos del doble, una vez', () => {
  const { instancia, cofre, registro, avanzarReloj } = montar();
  instancia.acertarParaTest(10);
  avanzarReloj(1000);
  cofre.porId['cofre-doble'].disparar('click');
  instancia.acertarParaTest(10);
  instancia.destruir();
  assert.equal(registro.objetos.length, 1);
  assert.equal(registro.objetos[0].length, 2);
});

test('destruir() fuera del cofre no entrega nada', () => {
  const { instancia, registro } = montar();
  instancia.acertarParaTest(3);
  instancia.destruir();
  assert.deepEqual(registro.objetos, []);
});

test('un toque con el plazo ya vencido cuenta como tiempo agotado, no como respuesta', () => {
  const { juego, caida, registro, avanzarReloj } = montar();
  avanzarReloj(12000); // el RAF aún no ha corrido; llega el click justo después del plazo
  juego.porId['contrarreloj-opciones'].children[0].disparar('click');
  assert.match(caida.porId['caida-resumen'].textContent, /Se acabó el tiempo/);
  assert.equal(registro.objetos.length, 0);
});

test('el vigía de «pensando» se reinicia en cada pregunta y se para al salir', () => {
  const eventos = [];
  const vigia = { reiniciar: () => eventos.push('r'), parar: () => eventos.push('p') };
  const { instancia } = montar({ vigia });
  instancia.acertarParaTest(1);
  instancia.destruir();
  assert.deepEqual(eventos.filter((e) => e === 'r').length >= 1, true);
  assert.equal(eventos.at(-1), 'p');
});

// --- Comodines (fase 9) ---------------------------------------------------------------------------------------------
import { guardarMochila, cargarMochila, crearMochila, anadirObjeto } from '../mochila.js';

// `montar` no crea el contenedor de la barra de comodines: estos tests lo añaden a mano.
function montarSalvavidas(objetos) {
  const almacen = almacenFalso();
  guardarMochila(Object.entries(objetos).reduce((m, [id, n]) => anadirObjeto(m, id, n), crearMochila()), almacen);
  const comodines = new ElementoFalso('div');
  comodines.querySelector = (sel) => comodines.buscarPorClase(sel.replace('.', ''));
  const juego = contenedorCon(['contrarreloj-puntos', 'contrarreloj-fase', 'contrarreloj-foto', 'contrarreloj-barra', 'contrarreloj-opciones']);
  const qs = juego.querySelector;
  juego.querySelector = (sel) => (sel.includes('contrarreloj-comodines') ? comodines : qs(sel));
  juego.porId['contrarreloj-comodines'] = comodines;
  return { almacen, comodines, juego };
}

test('Salvavidas armado: fallar no te hace caer, se descuenta una sola vez y la serie avanza', () => {
  const { almacen, comodines, juego } = montarSalvavidas({ salvavidas: 2 });
  const documento = new ElementoFalso('document');
  documento.createElement = (t) => new ElementoFalso(t);
  documento.hidden = false;
  const caida = contenedorCon(['caida-resumen', 'caida-explicacion', 'caida-reintentar']);
  const cofre = contenedorCon(['cofre-titulo', 'cofre-premio', 'cofre-nota', 'cofre-doble', 'cofre-plantarse', 'cofre-recoger']);
  const t = temporizadorFalso();
  const vistas = [];
  const instancia = montarContrarreloj(juego, {
    documento, contenedorCaida: caida, contenedorCofre: cofre, mostrarVista: (v) => vistas.push(v),
    elegirPregunta: ({ enSerie }) => ({ id: `p${enSerie.size}`, tipo: 'vf', nivel: 4, area: 'historia', enunciado: 'x', respuesta: true, explicacion: 'e' }),
    registrar() {}, celebrarAcierto() {}, lamentarFallo() {}, celebrarPremio() {}, reproducir() {}, imagenDe: () => null,
    darObjetos() {}, alSalir() {}, alSinPreguntas() {}, almacen, rng, ahora: () => 0, raf: () => 1, cancelarRaf() {}, temporizador: t,
  });
  const boton = comodines.children.find((c) => c.getAttribute('data-test') === 'comodin-salvavidas');
  boton.disparar('click');
  boton.disparar('click'); // doble toque
  assert.equal(cargarMochila(almacen).objetos.salvavidas, 2); // armado, aún no gastado
  assert.equal(instancia.responderParaTest(false), true);
  assert.equal(cargarMochila(almacen).objetos.salvavidas, 1); // gastado una vez, al perdonar el fallo
  assert.ok(!vistas.includes('caida'));
  assert.equal(juego.porId['contrarreloj-puntos'].getAttribute('aria-label'), 'Pregunta 2 de 10'); // la serie sigue, en la siguiente
  assert.equal(juego.porId['contrarreloj-puntos'].buscarTodosPorClase('contrarreloj-punto--llena').length, 1);
  instancia.responderParaTest(false); // sin armar otro: ahora sí cae
  assert.ok(vistas.includes('caida'));
  assert.equal(cargarMochila(almacen).objetos.salvavidas, 1);
});

test('Salvavidas armado pero acertando: no se gasta', () => {
  const { almacen, comodines, juego } = montarSalvavidas({ salvavidas: 1 });
  const documento = new ElementoFalso('document');
  documento.createElement = (t) => new ElementoFalso(t);
  documento.hidden = false;
  const instancia = montarContrarreloj(juego, {
    documento, contenedorCaida: contenedorCon(['caida-resumen', 'caida-explicacion', 'caida-reintentar']),
    contenedorCofre: contenedorCon(['cofre-titulo', 'cofre-premio', 'cofre-nota', 'cofre-doble', 'cofre-plantarse', 'cofre-recoger']),
    mostrarVista() {}, elegirPregunta: ({ enSerie }) => ({ id: `p${enSerie.size}`, tipo: 'vf', nivel: 4, area: 'historia', enunciado: 'x', respuesta: true, explicacion: 'e' }),
    registrar() {}, celebrarAcierto() {}, lamentarFallo() {}, celebrarPremio() {}, reproducir() {}, imagenDe: () => null,
    darObjetos() {}, alSalir() {}, alSinPreguntas() {}, almacen, rng, ahora: () => 0, raf: () => 1, cancelarRaf() {}, temporizador: temporizadorFalso(),
  });
  comodines.children[0].disparar('click');
  instancia.responderParaTest(true);
  assert.equal(cargarMochila(almacen).objetos.salvavidas, 1);
});

test('progreso: 10 puntos que se van llenando, con aria-label «Pregunta n de 10»', () => {
  const m = montar();
  const puntos = m.juego.porId['contrarreloj-puntos'];
  assert.equal(puntos.children.length, 10);
  assert.equal(puntos.getAttribute('aria-label'), 'Pregunta 1 de 10');
  assert.equal(puntos.buscarTodosPorClase('contrarreloj-punto--llena').length, 0);
  assert.equal(puntos.buscarTodosPorClase('contrarreloj-punto--actual').length, 1);
  m.instancia.acertarParaTest(1);
  assert.equal(puntos.getAttribute('aria-label'), 'Pregunta 2 de 10');
  assert.equal(puntos.buscarTodosPorClase('contrarreloj-punto--llena').length, 1);
  assert.equal(puntos.classList.contains('contrarreloj-puntos--doble'), false);
  m.instancia.acertarParaTest(9); // cofre
  m.avanzarReloj(1000);
  m.cofre.porId['cofre-doble'].disparar('click');
  assert.equal(puntos.classList.contains('contrarreloj-puntos--doble'), true, 'dorados durante el doble o nada');
  assert.equal(puntos.buscarTodosPorClase('contrarreloj-punto--llena').length, 0);
});

test('progreso: al acertar la décima los 10 puntos se ven llenos antes de pasar al cofre', () => {
  const m = montar();
  const puntos = m.juego.porId['contrarreloj-puntos'];
  m.instancia.acertarParaTest(10);
  assert.equal(puntos.buscarTodosPorClase('contrarreloj-punto--llena').length, 10);
  assert.equal(puntos.getAttribute('aria-label'), 'Pregunta 10 de 10');
});

// --- Saltar y Segunda oportunidad (plan v0.3.3) ---------------------------------------------------------------------

/** Contrarreloj con test4 de respuesta correcta 0 (el fallo de responderParaTest es la opción 1) y la mochila indicada. */
function montarConComodines(objetos, { preguntas = 10, tipo = 'test4' } = {}) {
  const base = montarSalvavidas(objetos);
  const { almacen, comodines, juego } = base;
  const opciones = juego.porId['contrarreloj-opciones'];
  opciones.querySelectorAll = () => opciones.children;
  const documento = new ElementoFalso('document');
  documento.createElement = (t) => new ElementoFalso(t);
  documento.hidden = false;
  const caida = contenedorCon(['caida-resumen', 'caida-explicacion', 'caida-reintentar']);
  const banco = Array.from({ length: preguntas }, (_, i) => (tipo === 'test4'
    ? { id: `p${i}`, tipo, nivel: 4, area: 'historia', enunciado: `E${i}`, opciones: ['a', 'b', 'c', 'd'], correcta: 0, explicacion: 'e' }
    : { id: `p${i}`, tipo, nivel: 4, area: 'historia', enunciado: `E${i}`, respuesta: true, explicacion: 'e' }));
  let reloj = 0;
  const registro = { registrados: [], vistas: [], sinPreguntas: 0 };
  const instancia = montarContrarreloj(juego, {
    documento, contenedorCaida: caida,
    contenedorCofre: contenedorCon(['cofre-titulo', 'cofre-premio', 'cofre-nota', 'cofre-doble', 'cofre-plantarse', 'cofre-recoger']),
    mostrarVista: (v) => registro.vistas.push(v),
    elegirPregunta: ({ enSerie }) => banco.find((p) => !enSerie.has(p.id)) ?? null,
    registrar: (p, correcta, valor) => registro.registrados.push([p.id, correcta, valor]),
    celebrarAcierto() {}, lamentarFallo() {}, celebrarPremio() {}, reproducir() {}, imagenDe: () => null,
    darObjetos() {}, alSalir() {}, alSinPreguntas: () => { registro.sinPreguntas += 1; },
    almacen, rng, ahora: () => reloj, raf: () => 1, cancelarRaf() {}, temporizador: temporizadorFalso(),
  });
  const boton = (id) => comodines.children.find((c) => c.getAttribute('data-test') === `comodin-${id}`);
  const mochila = (id) => cargarMochila(almacen).objetos[id];
  const puntos = () => juego.porId['contrarreloj-puntos'].getAttribute('aria-label');
  return { instancia, boton, mochila, registro, puntos, opciones, caida, avanzarReloj: (ms) => { reloj += ms; } };
}

test('Saltar: otra pregunta de la misma posición sin registrar nada, el contador no avanza, se gasta uno y el doble toque es un solo uso', () => {
  const { instancia, boton, mochila, registro, puntos, avanzarReloj } = montarConComodines({ saltar: 3 });
  assert.equal(instancia.preguntaActual().id, 'p0');
  avanzarReloj(2000);
  const saltar = boton('saltar');
  saltar.disparar('click');
  assert.equal(instancia.preguntaActual().id, 'p1');
  saltar.disparar('click'); // doble toque dentro del antirrebote: no salta otra vez
  boton('saltar')?.disparar('click');
  assert.equal(instancia.preguntaActual().id, 'p1');
  assert.equal(mochila('saltar'), 2);
  assert.equal(puntos(), 'Pregunta 1 de 10');
  assert.deepEqual(registro.registrados, []);
  assert.equal(registro.sinPreguntas, 0);
  avanzarReloj(400); // pasado el antirrebote, otro Saltar sí vale
  boton('saltar').disparar('click');
  assert.equal(instancia.preguntaActual().id, 'p2');
  assert.equal(mochila('saltar'), 1);
});

test('Saltar desarma el Salvavidas armado sin gastarlo', () => {
  const { instancia, boton, mochila, registro, avanzarReloj } = montarConComodines({ saltar: 1, salvavidas: 1 });
  boton('salvavidas').disparar('click');
  avanzarReloj(400);
  boton('saltar').disparar('click');
  avanzarReloj(400);
  instancia.responderParaTest(false); // sin Salvavidas armado: cae
  assert.ok(registro.vistas.includes('caida'));
  assert.equal(mochila('salvavidas'), 1);
});

test('Saltar sin otra pregunta distinta: no se gasta ni se acaba la partida', () => {
  const { instancia, boton, mochila, registro, avanzarReloj } = montarConComodines({ saltar: 1 }, { preguntas: 1 });
  avanzarReloj(400);
  boton('saltar').disparar('click');
  assert.equal(instancia.preguntaActual().id, 'p0');
  assert.equal(mochila('saltar'), 1);
  assert.equal(registro.sinPreguntas, 0);
});

test('Segunda oportunidad: el fallo se anota una vez, la opción se tacha y el segundo intento acertado cuenta sin volver a registrarse', () => {
  const { instancia, boton, mochila, registro, puntos, opciones, avanzarReloj } = montarConComodines({ segunda: 2 });
  boton('segunda').disparar('click');
  assert.equal(mochila('segunda'), 2); // armada, aún sin gastar
  avanzarReloj(400);
  instancia.responderParaTest(false); // opción 1
  assert.ok(!registro.vistas.includes('caida'));
  assert.equal(mochila('segunda'), 1);
  assert.deepEqual(registro.registrados, [['p0', false, 1]]);
  const tachada = opciones.children.find((o) => o.getAttribute('data-original') === '1');
  assert.equal(tachada.disabled, true);
  assert.equal(tachada.classList.contains('opcion-tachada'), true);
  assert.equal(puntos(), 'Pregunta 1 de 10'); // la serie no ha avanzado aún
  avanzarReloj(400);
  instancia.responderParaTest(true);
  assert.equal(puntos(), 'Pregunta 2 de 10'); // el segundo intento cuenta como acierto
  assert.deepEqual(registro.registrados, [['p0', false, 1]]); // y no se vuelve a registrar
});

test('Segunda oportunidad: si el segundo intento también falla (sin Salvavidas) caes y el radar solo tiene el primer fallo', () => {
  const { instancia, boton, registro, avanzarReloj } = montarConComodines({ segunda: 1 });
  boton('segunda').disparar('click');
  avanzarReloj(400);
  instancia.responderParaTest(false);
  avanzarReloj(400);
  instancia.responderParaTest(false);
  assert.ok(registro.vistas.includes('caida'));
  assert.equal(registro.registrados.length, 1);
});

test('Segunda oportunidad + Salvavidas: primero actúa la Segunda; el Salvavidas solo se gasta si el segundo intento también falla', () => {
  const { instancia, boton, mochila, registro, puntos, avanzarReloj } = montarConComodines({ segunda: 1, salvavidas: 1 });
  boton('segunda').disparar('click');
  boton('salvavidas').disparar('click');
  avanzarReloj(400);
  instancia.responderParaTest(false); // primer fallo: actúa la Segunda
  assert.equal(mochila('segunda'), 0);
  assert.equal(mochila('salvavidas'), 1);
  avanzarReloj(400);
  instancia.responderParaTest(false); // segundo fallo: ahora el Salvavidas
  assert.equal(mochila('salvavidas'), 0);
  assert.ok(!registro.vistas.includes('caida'));
  assert.equal(puntos(), 'Pregunta 2 de 10');
});

test('Segunda oportunidad armada y acierto a la primera: no se gasta; en V/F ni siquiera aparece', () => {
  const a = montarConComodines({ segunda: 1 });
  a.boton('segunda').disparar('click');
  a.instancia.responderParaTest(true);
  assert.equal(a.mochila('segunda'), 1);
  const b = montarConComodines({ segunda: 1 }, { tipo: 'vf' });
  assert.equal(b.boton('segunda'), undefined);
});
