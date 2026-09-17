// Tests de la mitad DOM de la tercera capa (`construirVisualClave`), ronda de corrección 1 (I4):
// hasta ahora `construirVisualClave` no tenía ningún test automatizado (justificado en el informe
// original por la ausencia de un DOM falso en el repo) y ahí es exactamente donde vivían los dos
// Critical de la revisión (C1: `secundario` se salía del viewBox; C2: podía lanzar). Este fichero
// instala un stub MÍNIMO de `document` (solo lo que `construirVisualClave`/`crearTexto`/`crearRect`
// usan: createElementNS, setAttribute, appendChild, textContent, classList.add, dataset, style) en
// `globalThis` SOLO dentro de cada test (nunca a nivel de módulo), para no filtrar un `document` de
// mentira al resto de la suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { construirVisualClave, modeloVisualClave, recortarALinea, medirAncho } from '../visuales.js';

// Mismo diccionario que NOMBRES_AREA en app.js (app.js:317-320) -- duplicado a propósito porque
// app.js no exporta nada (igual que ya reconoce el propio construirVisualClave en su JSDoc).
const NOMBRES_AREA = {
  economia: 'Economía', historia: 'Historia', ciencia: 'Ciencia', tecnologia: 'Tecnología',
  geografia: 'Geografía', filosofia: 'Filosofía', arte: 'Arte', logica: 'Lógica',
};
function nombreArea(area) {
  return NOMBRES_AREA[area] || (area ? area.charAt(0).toUpperCase() + area.slice(1) : '');
}

class ElementoFalso {
  constructor(tagName) {
    this.tagName = tagName;
    this.attrs = {};
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this._clases = new Set();
  }
  setAttribute(nombre, valor) {
    this.attrs[nombre] = String(valor);
  }
  getAttribute(nombre) {
    return this.attrs[nombre];
  }
  appendChild(hijo) {
    this.children.push(hijo);
    return hijo;
  }
  get classList() {
    const self = this;
    return { add: (...clases) => clases.forEach((c) => self._clases.add(c)) };
  }
  get clases() {
    return [...this._clases];
  }
}

/** Instala un `document.createElementNS` de mentira en `globalThis` y devuelve la función que lo
 * desinstala (restaura lo que había antes, o lo borra si no había nada) -- se llama explícitamente
 * dentro de cada test, nunca fuera. */
function instalarDomFalso() {
  const anterior = Object.prototype.hasOwnProperty.call(globalThis, 'document') ? globalThis.document : undefined;
  const habiaAntes = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  globalThis.document = { createElementNS: (_ns, tag) => new ElementoFalso(tag) };
  return () => {
    if (habiaAntes) globalThis.document = anterior;
    else delete globalThis.document;
  };
}

/** Recorre `nodo` y sus hijos recursivamente devolviendo todos los elementos `<text>`. */
function recolectarTextos(nodo, encontrados = []) {
  if (!nodo || !Array.isArray(nodo.children)) return encontrados;
  for (const hijo of nodo.children) {
    if (hijo.tagName === 'text') encontrados.push(hijo);
    recolectarTextos(hijo, encontrados);
  }
  return encontrados;
}

async function cargarPorId(id) {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  const pregunta = preguntas.find((p) => p.id === id);
  assert.ok(pregunta, `no se encontró ${id} en datos/banco.json`);
  return pregunta;
}

/** Reconstruye aquí (Tarea 1 de v0.2a.2.1) el mismo adaptador temporal que
 * `construirVisualClave` usa por dentro para pasar de `modeloVisualClave` (por tipo) al
 * `{ area, principal, secundario }` del SVG de v0.2a.2 -- `construirVisualClave` no expone
 * `datos`, así que este helper deja que el test compare contra el mismo dato que ve el SVG.
 * La Tarea 2 sustituye el adaptador entero por HTML por tipo, y con él este helper. */
function datosClaveAdaptados(pregunta) {
  const modelo = modeloVisualClave(pregunta) || { tipo: 'desconocido', area: '' };
  return {
    area: modelo.area,
    principal: modelo.tipo === 'ordenar' ? modelo.items.join(' → ')
      : modelo.tipo === 'error' ? modelo.etiqueta
      : modelo.tipo === 'test4' ? modelo.correcta
      : modelo.tipo === 'vf' ? modelo.veredicto
      : '',
    secundario: modelo.tipo === 'vf' ? modelo.frase : undefined,
  };
}

test('construirVisualClave: estructura básica -- role, aria-label, textos de área/principal presentes', async () => {
  const pregunta = await cargarPorId('art-009'); // test4, tiene principal + área
  const restaurar = instalarDomFalso();
  try {
    const svg = construirVisualClave(pregunta, { nombreArea });
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.attrs.viewBox, '0 0 320 180');
    assert.equal(svg.attrs.role, 'img');
    assert.deepEqual(svg.clases.sort(), ['visual-svg', 'visual-svg--clave']);
    assert.equal(svg.dataset.test, 'visual-clave');

    const datos = datosClaveAdaptados(pregunta);
    // Tarea 1: el adaptador temporal solo da `secundario` para tipo 'vf' -- `test4` ya no lo aporta,
    // así que el aria-label es solo el principal (ver `construirVisualClave`: `secundario ? … : principal`).
    assert.equal(datos.secundario, undefined);
    assert.equal(svg.attrs['aria-label'], datos.principal);

    const textos = recolectarTextos(svg);
    const area = textos.find((t) => t.attrs['font-size'] === '11');
    const principal = textos.find((t) => t.attrs['font-size'] === '26');
    const secundario = textos.find((t) => t.attrs['font-size'] === '13');

    assert.ok(area, 'falta el texto del área');
    assert.equal(area.textContent, 'ARTE');
    assert.ok(principal, 'falta el texto del principal');
    assert.equal(principal.textContent, 'La última cena');
    assert.equal(secundario, undefined, 'test4 ya no pinta secundario en el adaptador temporal de la Tarea 1');
  } finally {
    restaurar();
  }
});

test('construirVisualClave: C1 -- un secundario real de 89 caracteres se recorta a una línea que cabe en el viewBox (no se sale)', async () => {
  // Tarea 1: el adaptador temporal solo da `secundario` para tipo 'vf' (antes esta regresión (C1) se
  // probaba con el test4 real art-010; se reusa su mismo enunciado real de 118 caracteres forzando
  // `tipo: 'vf'` para seguir ejercitando la ruta que hoy SÍ pinta secundario).
  const original = await cargarPorId('art-010');
  const pregunta = { ...original, tipo: 'vf', respuesta: true };
  const restaurar = instalarDomFalso();
  try {
    const datos = datosClaveAdaptados(pregunta);
    assert.equal(datos.secundario.length, 89); // confirma que el caso de partida SIGUE siendo largo

    const svg = construirVisualClave(pregunta, { nombreArea });
    const secundario = recolectarTextos(svg).find((t) => t.attrs['font-size'] === '13');
    assert.ok(secundario, 'falta el texto del secundario');
    // Nunca más ancho del permitido (296 unidades a tamaño 13) -- exactamente lo que garantiza
    // recortarALinea y lo que el bug original (C1) violaba.
    assert.ok(
      medirAncho(secundario.textContent, 13) <= 296,
      `secundario se sale del viewBox: "${secundario.textContent}" (${medirAncho(secundario.textContent, 13)} > 296)`
    );
    assert.ok(secundario.textContent.length < datos.secundario.length, 'debería haberse recortado respecto al original');
    assert.equal(secundario.textContent, recortarALinea(datos.secundario, 296, 13));
  } finally {
    restaurar();
  }
});

test('construirVisualClave: principal largo envuelve en 2 líneas, ninguna supera 22 caracteres, y sin secundario (ordenar) no se pinta texto a 13', async () => {
  const pregunta = await cargarPorId('art-085'); // ordenar: sin secundario, principal largo
  const restaurar = instalarDomFalso();
  try {
    const svg = construirVisualClave(pregunta, { nombreArea });
    const textos = recolectarTextos(svg);
    const lineasPrincipal = textos.filter((t) => t.attrs['font-size'] === '22' || t.attrs['font-size'] === '26');
    assert.ok(lineasPrincipal.length >= 1);
    for (const linea of lineasPrincipal) {
      assert.ok(linea.textContent.length <= 22, `línea de principal >22 caracteres: "${linea.textContent}"`);
    }
    const secundario = textos.find((t) => t.attrs['font-size'] === '13');
    assert.equal(secundario, undefined, 'ordenar no tiene secundario -- no debería pintarse texto a 13');
  } finally {
    restaurar();
  }
});

test('construirVisualClave: pregunta rota (test4 sin opciones) -- SVG con solo el área, sin lanzar', () => {
  const restaurar = instalarDomFalso();
  try {
    const svg = construirVisualClave({ tipo: 'test4', area: 'arte', enunciado: 'Algo.' }, { nombreArea });
    assert.equal(svg.attrs.role, 'img');
    assert.equal(svg.attrs['aria-label'], 'Arte');
    const textos = recolectarTextos(svg);
    assert.equal(textos.length, 1, 'solo debería pintarse el texto del área');
    assert.equal(textos[0].textContent, 'ARTE');
  } finally {
    restaurar();
  }
});

test('construirVisualClave: C2 -- nunca lanza con null, {} o {tipo:"vf"} (sin respuesta/enunciado)', () => {
  const restaurar = instalarDomFalso();
  try {
    for (const pregunta of [null, undefined, {}, { tipo: 'vf' }]) {
      assert.doesNotThrow(() => {
        const svg = construirVisualClave(pregunta, { nombreArea });
        assert.equal(svg.attrs.role, 'img');
        assert.ok(svg.attrs['aria-label'] && svg.attrs['aria-label'].length > 0);
      }, `lanzó con ${JSON.stringify(pregunta)}`);
    }
  } finally {
    restaurar();
  }
});

test('construirVisualClave: C2 -- una `nombreArea` externa sin guardas (como capitalizar() de app.js) no lanza aunque `area` venga roto', () => {
  // Reproduce el bug original: nombreArea real de app.js es NOMBRES_AREA[area] || capitalizar(area),
  // y capitalizar hace texto.charAt(0) SIN guarda -- con area undefined lanzaba TypeError sin capturar.
  function nombreAreaSinGuardas(area) {
    return NOMBRES_AREA[area] || (area.charAt(0).toUpperCase() + area.slice(1)); // sin guarda, a propósito
  }
  const restaurar = instalarDomFalso();
  try {
    assert.doesNotThrow(() => {
      const svg = construirVisualClave({ tipo: 'test4' }, { nombreArea: nombreAreaSinGuardas }); // sin area
      assert.equal(svg.attrs.role, 'img');
      assert.equal(svg.attrs['aria-label'], 'Visual'); // ni área ni principal: SVG vacío
    });
  } finally {
    restaurar();
  }
});

test('construirVisualClave: C2 -- si la `nombreArea` externa lanza (con área válida), el catch cae a capitalizarArea, nunca propaga', async () => {
  const pregunta = await cargarPorId('art-001'); // vf, area: 'arte', principal/secundario válidos
  function nombreAreaQueLanza() {
    throw new Error('boom: fallo de red simulado en nombreArea');
  }
  const restaurar = instalarDomFalso();
  try {
    assert.doesNotThrow(() => {
      const svg = construirVisualClave(pregunta, { nombreArea: nombreAreaQueLanza });
      assert.equal(svg.attrs.role, 'img');
      // El catch reconstruye con capitalizarArea (interno), nunca con la nombreArea que lanzó.
      assert.equal(svg.attrs['aria-label'], 'Arte');
    });
  } finally {
    restaurar();
  }
});

test('construirVisualClave: barrido de las 295 preguntas reales del banco -- nunca lanza, principal <=22 car./línea, secundario nunca desborda el ancho de recortarALinea', async () => {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  assert.ok(preguntas.length >= 200, 'sanity: debería haber cargado el banco real, no un stub vacío');

  const restaurar = instalarDomFalso();
  try {
    let comprobadas = 0;
    for (const pregunta of preguntas) {
      let svg;
      assert.doesNotThrow(() => {
        svg = construirVisualClave(pregunta, { nombreArea });
      }, `construirVisualClave lanzó con ${pregunta.id}`);

      assert.equal(svg.attrs.role, 'img', `sin role="img" en ${pregunta.id}`);
      assert.ok(esTextoNoVacio(svg.attrs['aria-label']), `aria-label vacío en ${pregunta.id}`);

      for (const texto of recolectarTextos(svg)) {
        const tamano = Number(texto.attrs['font-size']);
        if (tamano === 26 || tamano === 22) {
          assert.ok(texto.textContent.length <= 22, `línea de principal >22 en ${pregunta.id}: "${texto.textContent}"`);
        } else if (tamano === 13) {
          assert.ok(
            medirAncho(texto.textContent, 13) <= 296,
            `secundario desborda en ${pregunta.id}: "${texto.textContent}" (${medirAncho(texto.textContent, 13)} > 296)`
          );
        }
      }
      comprobadas += 1;
    }
    assert.equal(comprobadas, preguntas.length);
  } finally {
    restaurar();
  }
});

function esTextoNoVacio(t) {
  return typeof t === 'string' && t.trim().length > 0;
}
