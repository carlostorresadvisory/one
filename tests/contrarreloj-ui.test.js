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
  const juego = contenedorCon(['contrarreloj-numero', 'contrarreloj-fase', 'contrarreloj-foto', 'contrarreloj-barra', 'contrarreloj-opciones']);
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
