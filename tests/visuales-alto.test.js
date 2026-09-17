// `construirVisual(visual, { alto })` (spec v0.2a.2.1 §1.5): con el hueco nuevo (50-60 % de la
// tarjeta) un gráfico calculado para su alto "natural" deja bandas vacías arriba y abajo. Estos
// tests comprueban el reparto, no el dibujo: que el viewBox acabe midiendo lo pedido y que las
// filas y la tipografía crezcan con él.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instalarDomFalso } from './dom-falso.js';
import { construirVisual } from '../visuales.js';

function conDom(fn) {
  const desinstalar = instalarDomFalso();
  try { return fn(); } finally { desinstalar(); }
}

const BARRAS = {
  tipo: 'barras',
  titulo: 'Abundancia en la corteza terrestre',
  leyenda: 'Porcentaje en masa',
  items: [
    { etiqueta: 'Oxígeno', valor: 46.6, unidad: '%' },
    { etiqueta: 'Silicio', valor: 27.7, unidad: '%' },
    { etiqueta: 'Aluminio', valor: 8.1, unidad: '%' },
  ],
};

const LINEA = {
  tipo: 'linea-tiempo',
  leyenda: 'Hitos',
  hitos: [
    { ano: '1914', texto: 'Empieza la Gran Guerra' },
    { ano: '1918', texto: 'Armisticio' },
    { ano: '1939', texto: 'Empieza la Segunda' },
  ],
};

const COMPARACION = {
  tipo: 'comparacion',
  leyenda: 'Dos modelos',
  columnas: [
    { titulo: 'Keynes', puntos: ['Demanda agregada', 'Gasto público'] },
    { titulo: 'Hayek', puntos: ['Orden espontáneo', 'Precios como señal'] },
  ],
};

function altoViewBox(svg) {
  return Number(svg.getAttribute('viewBox').split(' ')[3]);
}

test('construirVisual sin `alto`: el viewBox es el natural de la plantilla (comportamiento de hoy)', () => {
  conDom(() => {
    const svg = construirVisual(BARRAS);
    assert.ok(svg);
    // 3 filas de 36 + cabecera de 26 + 6 de margen = 140
    assert.equal(altoViewBox(svg), 140);
  });
});

test('construirVisual con `alto`: el viewBox mide exactamente lo pedido en barras, línea temporal y comparación', () => {
  conDom(() => {
    for (const visual of [BARRAS, LINEA, COMPARACION]) {
      const svg = construirVisual(visual, { alto: 330 });
      assert.ok(svg, `${visual.tipo} devolvió null`);
      assert.equal(altoViewBox(svg), 330, `${visual.tipo} no llenó el alto pedido`);
      assert.equal(svg.style.aspectRatio, '320 / 330');
    }
  });
});

test('construirVisual con `alto`: la tipografía sube con la fila, entre 13 y 18 unidades', () => {
  conDom(() => {
    const natural = construirVisual(BARRAS);
    const grande = construirVisual(BARRAS, { alto: 330 });
    const tamanos = (svg) => svg.children.filter((h) => h.tagName === 'text').map((t) => Number(t.getAttribute('font-size')));
    const maxNatural = Math.max(...tamanos(natural));
    const maxGrande = Math.max(...tamanos(grande));
    assert.ok(maxGrande > maxNatural, `la letra no creció (${maxNatural} -> ${maxGrande})`);
    assert.ok(Math.max(...tamanos(grande)) <= 18, 'la letra no debe pasar de 18 unidades de viewBox');
    assert.ok(Math.min(...tamanos(grande)) >= 13, 'la letra no debe bajar de 13 unidades de viewBox');
  });
});

test('construirVisual con `alto` menor que el natural: se ignora, nunca encoge el contenido', () => {
  conDom(() => {
    const svg = construirVisual(BARRAS, { alto: 80 });
    assert.equal(altoViewBox(svg), 140);
  });
});

test('construirVisual con `alto` inválido o ausente no lanza y sigue devolviendo null con datos rotos', () => {
  conDom(() => {
    assert.doesNotThrow(() => {
      assert.ok(construirVisual(BARRAS, { alto: NaN }));
      assert.ok(construirVisual(BARRAS, { alto: -5 }));
      assert.ok(construirVisual(BARRAS, {}));
      assert.equal(construirVisual({ tipo: 'barras', items: [] }, { alto: 330 }), null);
      assert.equal(construirVisual(null, { alto: 330 }), null);
    });
  });
});

// C2 (ola final, regresión de la Tarea 6): al repartir el tamaño de letra por `alto` (hasta 18
// unidades, spec §1.5), `envolverLineas` trataba "• " como una palabra más del propio punto -- la
// primera palabra dejaba de caber junto a la viñeta, esta se quedaba sola en la línea 1 y el
// texto bajaba entero a la línea 2, cortándose a media palabra al agotar el presupuesto de 2
// líneas. Arreglo: la viñeta se dibuja aparte del texto (indentación colgante). Barrido de TODAS
// las `comparacion` reales del banco a los dos altos límite que mide la revisión final (290 =
// zona a 375×667 con vf/error sin imagen; 384 = zona a 390×844 con la mayoría de casos con
// imagen), comprobando el síntoma exacto del hallazgo: ninguna viñeta sin texto detrás, ninguna
// primera línea que sea solo "•", y ningún punto por encima de las 2 líneas que pide la spec.
test('construirVisual comparacion: TODAS las del banco real a alto 290 y 384 -- sin viñeta huérfana, máximo 2 líneas por punto (C2)', async () => {
  const banco = JSON.parse(await readFile(new URL('../datos/banco.json', import.meta.url), 'utf8'));
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  const comparaciones = preguntas.filter((p) => p.visual && p.visual.tipo === 'comparacion');
  assert.ok(comparaciones.length >= 30, `sanity: se esperaban ~33 "comparacion" reales, hubo ${comparaciones.length}`);

  const fallos = [];
  conDom(() => {
    for (const alto of [290, 384]) {
      for (const pregunta of comparaciones) {
        const svg = construirVisual(pregunta.visual, { alto });
        if (!svg) {
          fallos.push(`${pregunta.id} alto=${alto}: construirVisual devolvió null`);
          continue;
        }
        // Los textos de los PUNTOS (viñeta + líneas) van con `ancla: 'start'`; los títulos de
        // columna, centrados (`ancla: 'middle'`) -- así se excluyen sin tener que reproducir el
        // resto del layout interno de plantillaComparacion.
        const textosPunto = svg.children.filter((h) => h.tagName === 'text' && h.getAttribute('text-anchor') === 'start');
        // Cada punto empieza con su viñeta "•" (un único carácter, nodo propio); lo que sigue hasta
        // la próxima viñeta son sus 1-2 líneas de texto.
        const grupos = [];
        let grupoActual = null;
        for (const nodo of textosPunto) {
          if (nodo.textContent === '•') {
            grupoActual = { lineas: [] };
            grupos.push(grupoActual);
          } else if (grupoActual) {
            grupoActual.lineas.push(nodo.textContent);
          }
        }
        for (const [i, grupo] of grupos.entries()) {
          if (grupo.lineas.length === 0) {
            fallos.push(`${pregunta.id} alto=${alto} punto ${i}: viñeta sin ninguna línea de texto detrás`);
          } else if (grupo.lineas[0].trim() === '•') {
            fallos.push(`${pregunta.id} alto=${alto} punto ${i}: la primera línea es solo "•"`);
          }
          if (grupo.lineas.length > 2) {
            fallos.push(`${pregunta.id} alto=${alto} punto ${i}: ${grupo.lineas.length} líneas (máximo 2, spec §1.3/§1.5)`);
          }
        }
      }
    }
  });
  assert.deepEqual(fallos, [], `${fallos.length} incidencia(s):\n${fallos.join('\n')}`);
});

test('formula y dato con `alto`: estiran el viewBox y se recentran, sin cambiar su tipografía', () => {
  conDom(() => {
    const formula = construirVisual({ tipo: 'formula', texto: 'E = mc²', leyenda: 'Einstein' }, { alto: 330 });
    assert.equal(altoViewBox(formula), 330);
    const dato = construirVisual({ tipo: 'dato', cifra: '46,6 %', texto: 'de la corteza', leyenda: 'x' }, { alto: 330 });
    assert.equal(altoViewBox(dato), 330);
  });
});
