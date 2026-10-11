// escala.js (spec v0.3 §5.3.1): geometría de las fotos a escala y de la línea temporal + montaje con DOM falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../escala.js';
import { ElementoFalso } from './dom-falso.js';

const cerca = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('alto: el alto de cada foto es proporcional a su cifra y la mayor mide maxPx', () => {
  const t = E.tamanosFotos({ ref: 828, valor: 8848, modo: 'alto', maxPx: 200 });
  assert.equal(t.valor.px, 200);
  cerca(t.ref.px, 18.7, 0.1);
  assert.equal(t.ref.diminuta, false);
  assert.equal(t.valor.veces, 1);
  const al_reves = E.tamanosFotos({ ref: 8848, valor: 828, modo: 'alto', maxPx: 200 });
  assert.equal(al_reves.ref.px, 200);
  cerca(al_reves.valor.px, 18.7, 0.1);
});

test('area: el lado es proporcional a √cifra (así el área lo es a la cifra)', () => {
  const t = E.tamanosFotos({ ref: 4, valor: 1, modo: 'area', maxPx: 100 });
  assert.equal(t.ref.px, 100);
  assert.equal(t.valor.px, 50);
  const area = (px) => px * px;
  cerca(area(t.valor.px) / area(t.ref.px), 1 / 4, 1e-9);
});

test('por debajo de 12 px se dibuja a 12 px, diminuta y con «veces» más pequeña', () => {
  const t = E.tamanosFotos({ ref: 1, valor: 8848, modo: 'alto', maxPx: 200 });
  assert.equal(t.ref.px, 12);
  assert.equal(t.ref.diminuta, true);
  assert.equal(t.ref.veces, 8848);
  assert.equal(t.valor.diminuta, false);
  const a = E.tamanosFotos({ ref: 1, valor: 1e6, modo: 'area', maxPx: 100 }); // lado 0,1 px → 12
  assert.equal(a.ref.px, 12);
  assert.equal(a.ref.veces, 1000000);
});

test('tamanosFotos no revienta con cifras raras', () => {
  for (const malo of [0, -3, NaN, Infinity, undefined]) {
    const t = E.tamanosFotos({ ref: malo, valor: 10, modo: 'alto', maxPx: 100 });
    assert.ok(Number.isFinite(t.ref.px) && t.ref.px >= 12);
    assert.ok(Number.isFinite(t.valor.px));
  }
});

test('ventanaLinea: siglos sin zoom, décadas con todo el zoom; posicionEnLinea en extremos y centro', () => {
  const lejos = E.ventanaLinea(1500, 0);
  const cerca_ = E.ventanaLinea(1500, 1);
  assert.equal(lejos.paso, 100);
  assert.equal(cerca_.paso, 10);
  assert.ok(lejos.hasta - lejos.desde > cerca_.hasta - cerca_.desde);
  assert.equal(E.posicionEnLinea(lejos.desde, lejos), 0);
  assert.equal(E.posicionEnLinea(lejos.hasta, lejos), 1);
  assert.equal(E.posicionEnLinea(1500, cerca_), 0.5);
  assert.equal(E.posicionEnLinea(-9999, lejos), 0);
  assert.equal(E.posicionEnLinea(9999, lejos), 1);
  assert.equal(E.posicionEnLinea(NaN, lejos), 0);
});

test('ventanaLinea: pasos intermedios y ventana siempre dentro de [−3000, 2026]', () => {
  assert.deepEqual([0.3, 0.6].map((z) => E.ventanaLinea(1000, z).paso), [50, 20]);
  const borde = E.ventanaLinea(2020, 1);
  assert.ok(borde.hasta <= 2026 && borde.desde >= -3000);
  assert.equal(borde.hasta - borde.desde, 200); // se desliza en vez de encogerse
  const antiguo = E.ventanaLinea(-2990, 0);
  assert.equal(antiguo.desde, -3000);
});

test('zoomParaDistancia: cerca = décadas, lejos = siglos, y siempre caben la referencia y la estimación', () => {
  assert.equal(E.zoomParaDistancia(0), 1);
  assert.equal(E.zoomParaDistancia(30), 1);
  assert.ok(E.zoomParaDistancia(2000) < 0.2); // ± 2.000 años: casi todo el zoom de siglos
  assert.ok(E.zoomParaDistancia(400) > E.zoomParaDistancia(1200));
  for (const d of [10, 150, 400, 900, 1500, 2000]) {
    const v = E.ventanaLinea(1500 + d / 2, E.zoomParaDistancia(d));
    assert.ok(E.posicionEnLinea(1500, v) > 0 && E.posicionEnLinea(1500 + d, v) < 1 || v.hasta === 2026, `d=${d}`);
  }
});

// --- DOM ---------------------------------------------------------------------------------------------------

function documentoFalso() {
  return { createElement: (tag) => new ElementoFalso(tag), createElementNS: (_ns, tag) => new ElementoFalso(tag) };
}
const cifra = (nombre, valor, imagen) => ({ nombre, valor, area: 'geografia', ...(imagen ? { imagen } : {}) });

test('escena: actualizar cambia el alto de la caja de la misteriosa y revelar fija la proporción real', () => {
  const documento = documentoFalso();
  const contenedor = new ElementoFalso('div');
  const escena = E.montarEscenaFotos(contenedor, {
    ref: cifra('Burj Khalifa', 828), misteriosa: cifra('Everest', 8848), modo: 'alto', colorArea: '#244', maxPx: 200, documento,
  });
  const raiz = contenedor.children[0];
  const cajaRef = raiz.buscarPorClase('escala-suelo').children[0].children[0];
  const cajaMis = raiz.buscarPorClase('escala-suelo').children[1].children[0];
  assert.equal(cajaMis.classList.contains('escala-caja--estimacion'), true); // contorno cian discontinuo
  assert.equal(cajaRef.style.height, '200px'); // al empezar, a la par de la referencia
  escena.actualizar(8000);
  assert.equal(cajaRef.style.height, '20.7px'); // la mayor (la estimación) ocupa maxPx y la referencia se encoge
  assert.equal(cajaMis.style.height, '200px');
  escena.actualizar(400);
  assert.equal(cajaRef.style.height, '200px');
  assert.equal(cajaMis.style.height, '96.62px');
  escena.revelar(8848, { duracionMs: 500 });
  assert.equal(cajaMis.style.height, '200px');
  assert.equal(cajaRef.style.height, '18.72px');
  assert.equal(cajaMis.style.transitionDuration, '500ms');
  assert.equal(cajaMis.classList.contains('escala-caja--estimacion'), false);
  assert.equal(cajaMis.classList.contains('escala-caja--real'), true);
  // el contorno de la estimación (400 m) queda en la escala real: 400/8848 de maxPx, no menos de 12 px
  const fantasma = raiz.buscarPorClase('escala-fantasma');
  assert.ok(fantasma);
  assert.equal(fantasma.style.height, '12px');
  // tras revelar, actualizar ya no mueve nada
  escena.actualizar(1);
  assert.equal(cajaMis.style.height, '200px');
});

test('escena: en modo área las cajas son cuadradas (lado ∝ √cifra)', () => {
  const contenedor = new ElementoFalso('div');
  E.montarEscenaFotos(contenedor, { ref: cifra('A', 4e6), misteriosa: cifra('B', 1e6), modo: 'area', maxPx: 100, documento: documentoFalso() }).revelar(1e6);
  const suelo = contenedor.children[0].buscarPorClase('escala-suelo');
  const [ref, mis] = [suelo.children[0].children[0], suelo.children[1].children[0]];
  assert.equal(ref.style.height, '100px');
  assert.equal(ref.style.width, '100px');
  assert.equal(mis.style.height, '50px');
  assert.equal(mis.style.width, '50px');
});

test('escena: la cifra diminuta lleva «real: N veces más pequeña» y la misteriosa no se desvela antes de revelar', () => {
  const contenedor = new ElementoFalso('div');
  const escena = E.montarEscenaFotos(contenedor, { ref: cifra('Hormiga', 1), misteriosa: cifra('Everest', 8848), modo: 'alto', maxPx: 200, documento: documentoFalso() });
  const raiz = contenedor.children[0];
  // la cifra real de la misteriosa (8848) no puede haberse usado para dimensionar nada antes de revelar
  const suelo = raiz.buscarPorClase('escala-suelo');
  assert.equal(suelo.children[1].children[0].style.height, '200px');
  assert.equal(suelo.children[0].children[0].style.height, '200px'); // a la par: 1 contra 1
  escena.actualizar(8848);
  const etiquetas = raiz.buscarPorClase('escala-etiquetas');
  assert.match(etiquetas.children[0].textContent, /^Hormiga · real: 8\.848 veces más pequeña$/);
  assert.equal(etiquetas.children[1].textContent, 'Everest');
});

test('escena: sin foto es el color del área con el nombre, sin emoji; una foto que no carga cae igual', () => {
  const contenedor = new ElementoFalso('div');
  const imagen = { url: 'https://upload.wikimedia.org/x.jpg' };
  E.montarEscenaFotos(contenedor, { ref: cifra('Sin foto', 100), misteriosa: cifra('Con foto', 200, imagen), modo: 'alto', colorArea: '#123456', maxPx: 100, documento: documentoFalso() });
  const suelo = contenedor.children[0].buscarPorClase('escala-suelo');
  const sin = suelo.children[0].children[0];
  const con = suelo.children[1].children[0];
  assert.equal(sin.classList.contains('escala-caja--sin-foto'), true);
  assert.equal(sin.style.background, '#123456');
  assert.equal(sin.buscarPorClase('escala-caja-nombre').textContent, 'Sin foto');
  assert.equal(con.classList.contains('escala-caja--sin-foto'), false);
  const img = con.buscarPorClase('escala-img');
  assert.equal(img.src, imagen.url);
  img.disparar('error');
  assert.equal(con.classList.contains('escala-caja--sin-foto'), true);
  assert.equal(con.buscarPorClase('escala-img'), null);
  assert.doesNotMatch(contenedor.children[0].textoPlano, /\p{Extended_Pictographic}/u);
});

test('escena: destruir quita todo del contenedor', () => {
  const contenedor = new ElementoFalso('div');
  const escena = E.montarEscenaFotos(contenedor, { ref: cifra('A', 1), misteriosa: cifra('B', 2), documento: documentoFalso() });
  assert.equal(contenedor.children.length, 1);
  escena.destruir();
  assert.equal(contenedor.children.length, 0);
});

test('línea temporal: referencia clavada en su año, estimación arrastrable y zoom al acercarse', () => {
  const contenedor = new ElementoFalso('div');
  const linea = E.montarLineaTemporal(contenedor, { ref: { nombre: 'Waterloo', valor: 1815 }, documento: documentoFalso() });
  const banda = contenedor.children[0];
  assert.ok(banda.buscarPorClase('escala-marca--ref'));
  assert.equal(banda.buscarPorClase('escala-marca--estimacion'), null);
  assert.match(banda.buscarPorClase('escala-marca--ref').textoPlano, /Waterloo · 1815/);
  const lejos = linea.ventana();
  linea.arrastrar(1000);
  const alejada = linea.ventana();
  linea.arrastrar(1820);
  const cercana = linea.ventana();
  assert.ok(cercana.hasta - cercana.desde < alejada.hasta - alejada.desde, 'más zoom al acercarse');
  assert.equal(cercana.paso, 10);
  assert.ok(alejada.paso >= 50);
  assert.ok(lejos.hasta - lejos.desde >= alejada.hasta - alejada.desde);
  const est = banda.buscarPorClase('escala-marca--estimacion');
  assert.match(est.textoPlano, /\? · 1820/);
  assert.ok(Number.parseFloat(banda.buscarPorClase('escala-marca--ref').style.left) > 0);
  linea.revelar(1815);
  assert.match(banda.buscarPorClase('escala-marca--real').textoPlano, /1815/);
  linea.destruir();
  assert.equal(contenedor.children.length, 0);
});

test('línea temporal: los años anteriores a Cristo se escriben «a. C.» y nada lanza con años raros', () => {
  const contenedor = new ElementoFalso('div');
  const linea = E.montarLineaTemporal(contenedor, { ref: { nombre: 'Maratón', valor: -490 }, documento: documentoFalso() });
  assert.match(contenedor.children[0].textoPlano, /490 a\. C\./);
  linea.arrastrar(NaN);
  linea.arrastrar(-2900);
  linea.arrastrar(5000);
  linea.revelar(NaN);
  assert.ok(contenedor.children[0].children.length > 0);
});

test('escena: con `formato`, las etiquetas llevan la cifra (la misteriosa «?» hasta revelar)', () => {
  const contenedor = new ElementoFalso('div');
  const escena = E.montarEscenaFotos(contenedor, {
    ref: cifra('Burj Khalifa', 828), misteriosa: cifra('Everest', 8848), modo: 'alto', maxPx: 200, formato: (v) => `${v} m`, documento: documentoFalso(),
  });
  const textos = () => contenedor.children[0].buscarPorClase('escala-etiquetas').children.map((e) => e.textContent);
  assert.match(textos()[0], /Burj Khalifa · 828 m/);
  assert.match(textos()[1], /Everest · \?/);
  escena.revelar(8848, { duracionMs: 0 });
  assert.match(textos()[1], /Everest · 8848 m/);
});
