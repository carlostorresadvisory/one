import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  validarVisual,
  validarFuente,
  contarPalabras,
  generarVisualYExplicacion,
  verificarVisualYExplicacion,
  resolverPregunta,
  reverificarVisualesGuardados,
  aplicarExclusionVisual,
  GENERADOR_VISUAL,
  VERIFICADOR_VISUAL,
  GENERADOR_SOLO_PAGO,
  VERIFICADOR_SOLO_PAGO,
} from '../tools/visualizar.js';

// --- validarVisual --------------------------------------------------------------------------

function visualValido(tipo) {
  switch (tipo) {
    case 'formula':
      return { tipo: 'formula', texto: 'PIB = C + I + G + (X − M)', leyenda: 'Componentes del PIB' };
    case 'linea-tiempo':
      return {
        tipo: 'linea-tiempo',
        hitos: [
          { ano: '1929', texto: 'Crack de Wall Street' },
          { ano: '1933', texto: 'New Deal' },
          { ano: '1944', texto: 'Bretton Woods' },
        ],
        leyenda: 'Hitos de la Gran Depresión',
      };
    case 'barras':
      return {
        tipo: 'barras',
        titulo: 'Inflación',
        items: [
          { etiqueta: 'España', valor: 3.2, unidad: '%' },
          { etiqueta: 'Zona euro', valor: 2.9, unidad: '%' },
        ],
        leyenda: 'Inflación interanual 2025',
        fuente: 'Eurostat 2025',
      };
    case 'comparacion':
      return {
        tipo: 'comparacion',
        columnas: [
          { titulo: 'Estoicismo', puntos: ['Controlar lo propio', 'Aceptar el resto'] },
          { titulo: 'Epicureísmo', puntos: ['Buscar placer sereno', 'Evitar el dolor'] },
        ],
        leyenda: 'Dos escuelas helenísticas',
      };
    case 'flujo':
      return { tipo: 'flujo', pasos: ['Ahorro', 'Inversión', 'Producción', 'Renta'], leyenda: 'Ciclo económico simplificado' };
    case 'dato':
      return { tipo: 'dato', cifra: '3%', texto: 'Inflación de España al cierre de 2025', leyenda: 'Inflación 2025', fuente: 'INE 2024' };
    default:
      throw new Error(`tipo de prueba desconocido: ${tipo}`);
  }
}

for (const tipo of ['formula', 'linea-tiempo', 'barras', 'comparacion', 'flujo', 'dato']) {
  test(`validarVisual acepta un ejemplo válido de tipo "${tipo}"`, () => {
    const r = validarVisual(visualValido(tipo));
    assert.deepEqual(r.errores, []);
    assert.equal(r.ok, true);
  });
}

test('validarVisual rechaza tipo desconocido', () => {
  const r = validarVisual({ tipo: 'grafico-3d', leyenda: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errores.length > 0);
});

test('validarVisual rechaza formula.texto por encima de 40 caracteres', () => {
  const v = visualValido('formula');
  v.texto = 'X'.repeat(41);
  const r = validarVisual(v);
  assert.equal(r.ok, false);
});

test('validarVisual rechaza leyenda por encima de 60 caracteres', () => {
  const v = visualValido('dato');
  v.leyenda = 'Y'.repeat(61);
  const r = validarVisual(v);
  assert.equal(r.ok, false);
});

test('validarVisual rechaza linea-tiempo con menos de 3 hitos', () => {
  const v = visualValido('linea-tiempo');
  v.hitos = v.hitos.slice(0, 2);
  const r = validarVisual(v);
  assert.equal(r.ok, false);
});

test('validarVisual rechaza barras con valor no numérico', () => {
  const v = visualValido('barras');
  v.items[0].valor = 'mucho';
  const r = validarVisual(v);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some((e) => /valor/.test(e)));
});

test('validarVisual rechaza barras con valor cero o negativo', () => {
  // Fijado tras la pasada adversarial del 13-sep-2026: 0 o negativo rompe el dibujo de barras.
  const vCero = visualValido('barras');
  vCero.items[0].valor = 0;
  assert.equal(validarVisual(vCero).ok, false);

  const vNegativo = visualValido('barras');
  vNegativo.items[0].valor = -5;
  assert.equal(validarVisual(vNegativo).ok, false);
});

test('validarVisual rechaza formula con "\\" o "$" (LaTeX crudo)', () => {
  const vBackslash = visualValido('formula');
  vBackslash.texto = 'PIB = \\frac{X}{Y}';
  assert.equal(validarVisual(vBackslash).ok, false);

  const vDolar = visualValido('formula');
  vDolar.texto = '$PIB = C + I$';
  assert.equal(validarVisual(vDolar).ok, false);
});

test('validarVisual rechaza linea-tiempo con "ano" repetido', () => {
  const v = visualValido('linea-tiempo');
  v.hitos[1].ano = v.hitos[0].ano; // duplica el primer año
  const r = validarVisual(v);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some((e) => /repetido/.test(e)));
});

test('validarVisual rechaza comparacion con 3 columnas (distinto de 2)', () => {
  const v = visualValido('comparacion');
  v.columnas.push({ titulo: 'Tercera', puntos: ['a', 'b'] });
  const r = validarVisual(v);
  assert.equal(r.ok, false);
});

test('validarVisual rechaza comparacion con 1 columna (distinto de 2)', () => {
  const v = visualValido('comparacion');
  v.columnas = [v.columnas[0]];
  const r = validarVisual(v);
  assert.equal(r.ok, false);
});

test('validarVisual rechaza flujo con más de 4 pasos', () => {
  const v = visualValido('flujo');
  v.pasos = ['uno', 'dos', 'tres', 'cuatro', 'cinco'];
  const r = validarVisual(v);
  assert.equal(r.ok, false);
});

test('validarVisual rechaza null/objeto vacío sin lanzar', () => {
  assert.equal(validarVisual(null).ok, false);
  assert.equal(validarVisual({}).ok, false);
});

// --- validarFuente / guardarraíl de "fuente" (ronda de corrección 1, 13-sep-2026) -------------
// Hallazgo del revisor + el controlador: el guardarraíl anterior solo exigía que "fuente" fuera
// texto no vacío, y eso dejaba pasar "Concepto físico estándar", "Datos geográficos estándar",
// etc. (~45% de falsos positivos, 12 de 28 barras/dato retirados a mano). Ahora "fuente" exige
// 8-40 caracteres, un año de 4 dígitos y el nombre de una institución/publicación, y rechaza
// frases que delatan una cifra genérica/ilustrativa.

test('validarFuente rechaza una fuente sin año', () => {
  const r = validarFuente('U.S.Geological Survey');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /año/);
});

test('validarFuente rechaza frases genéricas (estándar, concepto, cálculo propio...)', () => {
  for (const fuente of ['Concepto físico estándar', 'Datos geográficos estándar', 'Cálculo propio sobre enunciado', 'Estimación propia 2024', 'Análisis genérico 2022']) {
    const r = validarFuente(fuente);
    assert.equal(r.ok, false, `"${fuente}" debería rechazarse`);
  }
});

test('validarFuente rechaza fuente demasiado corta (< 8 caracteres) o sin institución reconocible', () => {
  assert.equal(validarFuente('2024').ok, false); // solo el año, < 8 caracteres
  assert.equal(validarFuente('a 2024').ok, false); // < 8 caracteres
});

test('validarFuente acepta una fuente real con año e institución', () => {
  for (const fuente of ['Banco Mundial 2023', 'INE 2024', 'IPCC 2014', "Christie's 2021"]) {
    const r = validarFuente(fuente);
    assert.equal(r.ok, true, `"${fuente}" debería aceptarse: ${r.motivo}`);
  }
});

test('validarVisual rechaza "barras"/"dato" sin fuente, con fuente sin año o con frase genérica', () => {
  const sinFuente = visualValido('barras');
  delete sinFuente.fuente;
  assert.equal(validarVisual(sinFuente).ok, false);

  const sinAno = visualValido('dato');
  sinAno.fuente = 'Instituto Nacional de Estadística';
  assert.equal(validarVisual(sinAno).ok, false);

  const generica = visualValido('barras');
  generica.fuente = 'Concepto físico estándar 2024';
  assert.equal(validarVisual(generica).ok, false);
});

test('validarVisual rechaza "barras"/"dato" cuyo título o leyenda sugiere una cifra ilustrativa ("típica"/"aproximada"/"estimada")', () => {
  const tituloTipico = visualValido('barras');
  tituloTipico.titulo = 'Margen típico del sector';
  assert.equal(validarVisual(tituloTipico).ok, false);

  const leyendaAproximada = visualValido('barras');
  leyendaAproximada.leyenda = 'Reparto aproximado de ingresos';
  assert.equal(validarVisual(leyendaAproximada).ok, false);

  const leyendaEstimada = visualValido('dato');
  leyendaEstimada.leyenda = 'Cifra estimada para 2025';
  assert.equal(validarVisual(leyendaEstimada).ok, false);
});

// --- contarPalabras --------------------------------------------------------------------------

test('contarPalabras cuenta palabras separadas por espacios', () => {
  assert.equal(contarPalabras('Esto tiene cinco palabras exactas'), 5);
});

test('contarPalabras ignora espacios múltiples y bordes', () => {
  assert.equal(contarPalabras('  una   frase   con  espacios  '), 4);
});

test('contarPalabras devuelve 0 para texto vacío o no string', () => {
  assert.equal(contarPalabras(''), 0);
  assert.equal(contarPalabras(undefined), 0);
});

// --- aplicarExclusionVisual (M5, revisión final v0.1e) ----------------------------------------

test('aplicarExclusionVisual: sin visual, devuelve null tal cual (nada que filtrar)', () => {
  assert.equal(aplicarExclusionVisual('eco-096', null, { 'eco-096': { tipos: ['barras', 'dato'] } }), null);
});

test('aplicarExclusionVisual: id sin entrada en exclusiones, el visual pasa igual', () => {
  const visual = { tipo: 'barras', leyenda: 'x' };
  assert.equal(aplicarExclusionVisual('eco-001', visual, { 'eco-096': { tipos: ['barras'] } }), visual);
});

test('aplicarExclusionVisual: tipo del visual está en la lista de tipos excluidos -> null', () => {
  const visual = { tipo: 'barras', leyenda: 'x' };
  assert.equal(aplicarExclusionVisual('eco-096', visual, { 'eco-096': { tipos: ['barras', 'dato'] } }), null);
});

test('aplicarExclusionVisual: tipo del visual NO está en la lista de tipos excluidos -> pasa', () => {
  const visual = { tipo: 'linea-tiempo', leyenda: 'x' };
  assert.equal(aplicarExclusionVisual('eco-096', visual, { 'eco-096': { tipos: ['barras', 'dato'] } }), visual);
});

test('aplicarExclusionVisual: "tipos" vacío excluye TODOS los tipos para ese id, no solo los listados', () => {
  const visual = { tipo: 'flujo', leyenda: 'x' };
  assert.equal(aplicarExclusionVisual('eco-096', visual, { 'eco-096': { tipos: [] } }), null);
});

test('aplicarExclusionVisual: "tipos" ausente (solo motivo) se trata como vacío -> excluye todo', () => {
  const visual = { tipo: 'flujo', leyenda: 'x' };
  assert.equal(aplicarExclusionVisual('eco-096', visual, { 'eco-096': { motivo: 'sin tipos' } }), null);
});

test('aplicarExclusionVisual: sin mapa de exclusiones (undefined/{}), el visual pasa igual', () => {
  const visual = { tipo: 'barras', leyenda: 'x' };
  assert.equal(aplicarExclusionVisual('eco-096', visual, {}), visual);
  assert.equal(aplicarExclusionVisual('eco-096', visual, undefined), visual);
});

test('datos/visuales-excluidos.json: cada entrada tiene forma válida ({tipos: string[], motivo: string})', async () => {
  const { readFile } = await import('node:fs/promises');
  const contenido = JSON.parse(await readFile(new URL('../datos/visuales-excluidos.json', import.meta.url), 'utf8'));
  const ids = Object.keys(contenido);
  assert.ok(ids.length > 0, 'la lista de exclusión no debería estar vacía tras la revisión humana');
  for (const id of ids) {
    const entrada = contenido[id];
    assert.ok(Array.isArray(entrada.tipos), `${id}: "tipos" debe ser un array`);
    assert.ok(typeof entrada.motivo === 'string' && entrada.motivo.length > 0, `${id}: "motivo" debe ser texto no vacío`);
  }
});

// --- generarVisualYExplicacion ----------------------------------------------------------------

function preguntaBase(extra) {
  return {
    id: 'eco-001',
    area: 'economia',
    tipo: 'vf',
    nivel: 3,
    enunciado: 'La inflación mide la subida generalizada de precios.',
    explicacion: 'Explicación larga original que se quiere acortar y hacer más visual, con más detalle del necesario.',
    respuesta: true,
    ...extra,
  };
}

test('generarVisualYExplicacion: llamar falso que devuelve JSON válido produce un objeto', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({
      explicacion: 'La inflación sube cuando hay más demanda que oferta; en 2025 marcó el debate en toda Europa.',
      visual: { tipo: 'dato', cifra: '3%', texto: 'Inflación española en 2025', leyenda: 'Inflación 2025' },
    }),
    modelo: modelos[0],
    coste: 0.00012,
    usage: {},
  });

  const resultado = await generarVisualYExplicacion(preguntaBase(), { llamar: llamarFalso, necesitaVisual: true });
  assert.equal(typeof resultado, 'object');
  assert.match(resultado.explicacion, /inflación/i);
  assert.equal(resultado.visual.tipo, 'dato');
  assert.equal(resultado.modelo, GENERADOR_VISUAL[0]);
  assert.equal(resultado.coste, 0.00012);
});

test('generarVisualYExplicacion: con necesitaVisual false no exige visual', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacion: 'Explicación corta sin visual porque ya hay imagen de Commons.' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const resultado = await generarVisualYExplicacion(preguntaBase(), { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(resultado.visual, null);
});

test('generarVisualYExplicacion: pasa el motivoRechazo al prompt de usuario en el reintento', async () => {
  let contenidoUsuario = '';
  const llamarFalso = async ({ modelos, mensajes }) => {
    contenidoUsuario = mensajes[1].content;
    return {
      texto: JSON.stringify({ explicacion: 'Corregida.', visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y' } }),
      modelo: modelos[0],
      coste: 0,
      usage: {},
    };
  };
  await generarVisualYExplicacion(preguntaBase(), {
    llamar: llamarFalso,
    necesitaVisual: true,
    motivoRechazo: 'el dato de la cifra no era real',
  });
  assert.match(contenidoUsuario, /el dato de la cifra no era real/);
});

test('generarVisualYExplicacion: reintenta una vez si "explicacion" viene vacía, y usa la del reintento si llega bien', async () => {
  let llamadas = 0;
  const llamarFalso = async ({ modelos }) => {
    llamadas++;
    if (llamadas === 1) {
      return { texto: JSON.stringify({ explicacion: '', visual: null }), modelo: modelos[0], coste: 0.0001, usage: {} };
    }
    return { texto: JSON.stringify({ explicacion: 'Ahora sí llega.', visual: null }), modelo: modelos[0], coste: 0.0001, usage: {} };
  };
  const r = await generarVisualYExplicacion(preguntaBase(), { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(llamadas, 2);
  assert.equal(r.explicacion, 'Ahora sí llega.');
  assert.equal(r.coste, 0.0002); // suma de las dos llamadas
});

test('generarVisualYExplicacion: si "explicacion" falta en las tres veces, se rinde con explicacion vacía', async () => {
  // Ronda de corrección 1 (13-sep-2026): 3 intentos ahora, no 2 (el tercero es el intento
  // reforzado "máximo 32 palabras, dos frases" para el caso de explicación demasiado larga; una
  // explicación vacía agota los mismos 3 intentos antes de rendirse).
  let llamadas = 0;
  const llamarFalso = async ({ modelos }) => {
    llamadas++;
    return { texto: JSON.stringify({ visual: null }), modelo: modelos[0], coste: 0, usage: {} }; // sin "explicacion"
  };
  const r = await generarVisualYExplicacion(preguntaBase(), { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(llamadas, 3, 'debe intentarlo exactamente tres veces, ni dos ni cuatro');
  assert.equal(r.explicacion, '');
});

test('generarVisualYExplicacion: si la explicación se pasa de 40 palabras dos veces, un tercer intento pide máximo 32 palabras', async () => {
  // Hallazgo 3 de la ronda de corrección 1: antes solo se reintentaba una "explicacion" vacía;
  // ahora también se reintenta (hasta un tercer intento, con instrucción más estricta) una
  // "explicacion" que se pasa de 40 palabras.
  let llamadas = 0;
  const notasVistas = [];
  const explicacionLarga = Array.from({ length: 45 }, (_, i) => `palabra${i}`).join(' ');
  const explicacionCorta = 'Explicación corta y válida tras el tercer intento reforzado.';
  const llamarFalso = async ({ modelos, mensajes }) => {
    llamadas++;
    notasVistas.push(mensajes[1].content);
    const explicacion = llamadas < 3 ? explicacionLarga : explicacionCorta;
    return { texto: JSON.stringify({ explicacion, visual: null }), modelo: modelos[0], coste: 0.0001, usage: {} };
  };
  const r = await generarVisualYExplicacion(preguntaBase(), { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(llamadas, 3, 'debe parar en el tercer intento en cuanto una propuesta cumple el límite');
  assert.equal(r.explicacion, explicacionCorta);
  assert.match(notasVistas[1], /45 palabras/, 'el segundo intento debe avisar de cuántas palabras se pasó');
  assert.match(notasVistas[2], /máximo 32 palabras/i, 'el tercer intento debe pedir explícitamente 32 palabras');
});

// --- verificarVisualYExplicacion ---------------------------------------------------------------

test('verificarVisualYExplicacion excluye el modelo generador de la cascada (excluirModelo)', async () => {
  const modelosRecibidos = [];
  const llamarFalso = async ({ modelos }) => {
    modelosRecibidos.push(...modelos);
    return { texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }), modelo: modelos[0], coste: 0, usage: {} };
  };
  const propuesta = {
    explicacion: 'Explicación corta.',
    visual: { tipo: 'dato', cifra: '1', texto: 'texto válido', leyenda: 'leyenda' },
    modelo: 'a/uno:free',
  };
  await verificarVisualYExplicacion(preguntaBase(), propuesta, {
    llamar: llamarFalso,
    excluirModelo: 'a/uno:free',
    modelos: ['a/uno:free', 'b/dos:free'],
  });
  assert.ok(!modelosRecibidos.includes('a/uno:free'));
  assert.ok(modelosRecibidos.includes('b/dos:free'));
});

test('verificarVisualYExplicacion: visualOk pasa a false si el esquema es inválido aunque el modelo diga true', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuesta = {
    explicacion: 'Explicación corta.',
    visual: { tipo: 'formula', texto: 'X'.repeat(50), leyenda: 'leyenda' }, // supera el límite de 40
    modelo: 'a/uno:free',
  };
  const r = await verificarVisualYExplicacion(preguntaBase(), propuesta, { llamar: llamarFalso });
  assert.equal(r.visualOk, false);
  assert.match(r.motivo, /esquema inválido/);
});

test('verificarVisualYExplicacion: con necesitaVisual false, visualOk siempre true', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: false, motivo: 'irrelevante' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuesta = { explicacion: 'Explicación corta.', visual: null, modelo: 'a/uno:free' };
  const r = await verificarVisualYExplicacion(preguntaBase(), propuesta, { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(r.visualOk, true);
});

test('verificarVisualYExplicacion: explicacionOk pasa a false si supera 40 palabras aunque el modelo diga true', async () => {
  // Visto en vivo el 13-sep-2026 (art-001, ejecución completa real): el verificador dio
  // explicacionOk:true a una propuesta de 54 palabras. El límite debe comprobarse en código.
  const explicacionLarga = Array.from({ length: 45 }, (_, i) => `palabra${i}`).join(' ');
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuesta = { explicacion: explicacionLarga, visual: null, modelo: 'a/uno:free' };
  const r = await verificarVisualYExplicacion(preguntaBase(), propuesta, { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(r.explicacionOk, false);
  assert.match(r.motivo, /45 palabras/);
});

test('verificarVisualYExplicacion: explicacion vacía nunca es explicacionOk, aunque el modelo diga true', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuesta = { explicacion: '', visual: null, modelo: 'a/uno:free' };
  const r = await verificarVisualYExplicacion(preguntaBase(), propuesta, { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(r.explicacionOk, false);
  assert.match(r.motivo, /vacía/);
});

test('verificarVisualYExplicacion: sin visual propuesto pero necesitándolo, visualOk false', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuesta = { explicacion: 'Explicación corta.', visual: null, modelo: 'a/uno:free' };
  const r = await verificarVisualYExplicacion(preguntaBase(), propuesta, { llamar: llamarFalso, necesitaVisual: true });
  assert.equal(r.visualOk, false);
  assert.ok(r.motivo);
});

test('verificarVisualYExplicacion: "barras"/"dato" sin fuente se rechazan aunque el modelo diga visualOk:true', async () => {
  // Visto en vivo el 13-sep-2026 (art-010, ejecución real): el generador propuso un "barras" con
  // porcentajes inventados (40 %/60 %) para ilustrar una técnica pictórica, y el verificador lo dio
  // por bueno. La ausencia de "fuente" en barras/dato debe bastar para rechazar, en código, sin
  // depender de que el modelo se acuerde de comprobarlo.
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuestaBarras = {
    explicacion: 'Explicación corta.',
    visual: { tipo: 'barras', items: [{ etiqueta: 'Capa base', valor: 40 }, { etiqueta: 'Veladura', valor: 60 }], leyenda: 'x' },
    modelo: 'a/uno:free',
  };
  const rBarras = await verificarVisualYExplicacion(preguntaBase(), propuestaBarras, { llamar: llamarFalso });
  assert.equal(rBarras.visualOk, false);
  assert.match(rBarras.motivo, /fuente/i);

  const propuestaDato = {
    explicacion: 'Explicación corta.',
    visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y' },
    modelo: 'a/uno:free',
  };
  const rDato = await verificarVisualYExplicacion(preguntaBase(), propuestaDato, { llamar: llamarFalso });
  assert.equal(rDato.visualOk, false);
  assert.match(rDato.motivo, /fuente/i);
});

test('verificarVisualYExplicacion: "barras" con fuente real se acepta', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });
  const propuesta = {
    explicacion: 'Explicación corta.',
    visual: {
      tipo: 'barras',
      items: [{ etiqueta: 'España', valor: 3.2, unidad: '%' }, { etiqueta: 'Zona euro', valor: 2.9, unidad: '%' }],
      leyenda: 'Inflación 2025',
      fuente: 'Eurostat 2025',
    },
    modelo: 'a/uno:free',
  };
  const r = await verificarVisualYExplicacion(preguntaBase(), propuesta, { llamar: llamarFalso });
  assert.equal(r.visualOk, true);
});

test('resolverPregunta: cuando explicación y visual fallan a la vez, el motivo de cada uno no se pisa', async () => {
  // Visto en vivo el 13-sep-2026 (art-010): el motivo mostrado para "explicación conservada" era en
  // realidad el motivo del visual (esquema inválido), porque ambos compartían una sola variable.
  const llamarFalso = async ({ modelos }) => {
    if (modelos === GENERADOR_VISUAL) {
      return {
        texto: JSON.stringify({
          explicacion: 'x '.repeat(45).trim(), // 45 palabras: supera el límite
          visual: { tipo: 'flujo', pasos: ['un paso muchísimo más largo de lo permitido'], leyenda: 'y' }, // esquema inválido (1 paso, no 2-4)
        }),
        modelo: modelos[0],
        coste: 0,
        usage: {},
      };
    }
    return { texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }), modelo: modelos[0], coste: 0, usage: {} };
  };
  const r = await resolverPregunta(preguntaBase(), { llamar: llamarFalso, necesitaVisual: true });
  assert.equal(r.explicacionCambiada, false);
  assert.match(r.motivoExplicacionRechazo, /45 palabras/);
  assert.equal(r.visual, null);
  assert.match(r.motivoVisualRechazo, /esquema inválido/);
});

// --- resolverPregunta: flujo generar → verificar → reintento único ----------------------------

test('resolverPregunta: si el visual pasa la verificación a la primera, no reintenta', async () => {
  let llamadasGenerador = 0;
  let llamadasVerificador = 0;
  const llamarFalso = async ({ modelos }) => {
    if (modelos === GENERADOR_VISUAL) {
      llamadasGenerador++;
      return {
        texto: JSON.stringify({ explicacion: 'Corta y válida.', visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y', fuente: 'INE 2024' } }),
        modelo: modelos[0],
        coste: 0.0001,
        usage: {},
      };
    }
    llamadasVerificador++;
    return { texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }), modelo: modelos[0], coste: 0.0001, usage: {} };
  };
  const r = await resolverPregunta(preguntaBase(), { llamar: llamarFalso, necesitaVisual: true });
  assert.equal(llamadasGenerador, 1);
  assert.equal(llamadasVerificador, 1);
  assert.equal(r.visual.tipo, 'dato');
  assert.equal(r.explicacionCambiada, true);
  assert.ok(r.coste > 0);
});

test('resolverPregunta: con modelosGenerador/modelosVerificador (--sin-gratis) usa cada cascada en su papel, sin mezclarlas', async () => {
  // verificarVisualYExplicacion siempre filtra excluirModelo (aunque no elimine nada), así que
  // el array que llega a llamar() es una COPIA de VERIFICADOR_SOLO_PAGO, no la misma referencia
  // -- se compara por contenido, no con ===.
  const modelosVistos = { generador: [], verificador: [] };
  const llamarFalso = async ({ modelos }) => {
    if (modelos[0] === GENERADOR_SOLO_PAGO[0]) {
      modelosVistos.generador.push(modelos);
      return {
        texto: JSON.stringify({ explicacion: 'Corta y válida.', visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y', fuente: 'INE 2024' } }),
        modelo: modelos[0],
        coste: 0.0001,
        usage: {},
      };
    }
    if (modelos[0] === VERIFICADOR_SOLO_PAGO[0]) {
      modelosVistos.verificador.push(modelos);
      return { texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }), modelo: modelos[0], coste: 0.0001, usage: {} };
    }
    throw new Error(`cascada inesperada: ${JSON.stringify(modelos)}`);
  };
  const r = await resolverPregunta(preguntaBase(), {
    llamar: llamarFalso,
    necesitaVisual: true,
    modelosGenerador: GENERADOR_SOLO_PAGO,
    modelosVerificador: VERIFICADOR_SOLO_PAGO,
  });
  assert.equal(modelosVistos.generador.length, 1);
  assert.equal(modelosVistos.verificador.length, 1);
  assert.equal(r.visual.tipo, 'dato');
});

test('resolverPregunta: reintenta una vez el visual y lo deja en null si vuelve a fallar', async () => {
  let llamadasGenerador = 0;
  let llamadasVerificador = 0;
  const llamarFalso = async ({ modelos }) => {
    if (modelos === GENERADOR_VISUAL) {
      llamadasGenerador++;
      return {
        texto: JSON.stringify({
          explicacion: 'Corta y válida.',
          visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y', fuente: 'INE 2024' },
        }),
        modelo: modelos[0],
        coste: 0.0001,
        usage: {},
      };
    }
    llamadasVerificador++;
    // Rechaza el visual las dos veces (verificación inicial y verificación del reintento).
    return {
      texto: JSON.stringify({ explicacionOk: true, visualOk: false, motivo: 'dato inventado, no verificable' }),
      modelo: modelos[0],
      coste: 0.0001,
      usage: {},
    };
  };
  const r = await resolverPregunta(preguntaBase(), { llamar: llamarFalso, necesitaVisual: true });
  assert.equal(llamadasGenerador, 2, 'debe generar dos veces: intento inicial + un reintento');
  assert.equal(llamadasVerificador, 2, 'debe verificar dos veces: la propuesta y el reintento');
  assert.equal(r.visual, null);
  assert.match(r.motivoVisualRechazo, /dato inventado/);
  assert.equal(r.explicacionCambiada, true);
});

test('resolverPregunta: si explicacionOk es false, conserva la explicación original', async () => {
  const llamarFalso = async ({ modelos }) => {
    if (modelos === GENERADOR_VISUAL) {
      return {
        texto: JSON.stringify({ explicacion: 'Explicación con un error factual.', visual: null }),
        modelo: modelos[0],
        coste: 0,
        usage: {},
      };
    }
    return {
      texto: JSON.stringify({ explicacionOk: false, visualOk: true, motivo: 'la explicación introduce un error' }),
      modelo: modelos[0],
      coste: 0,
      usage: {},
    };
  };
  const pregunta = preguntaBase();
  const r = await resolverPregunta(pregunta, { llamar: llamarFalso, necesitaVisual: false });
  assert.equal(r.explicacion, pregunta.explicacion);
  assert.equal(r.explicacionCambiada, false);
  assert.match(r.motivoExplicacionRechazo, /error/);
});

// --- reverificarVisualesGuardados (modo --reverificar-visuales, hallazgo 4) --------------------

function preguntaConVisual(id, tipo, visual) {
  return { ...preguntaBase(), id, area: 'economia', explicacion: 'Explicación ya aceptada.', visual: { tipo, ...visual } };
}

test('reverificarVisualesGuardados: solo revisa los tipos pedidos, sin tocar otros visuales guardados', async () => {
  const preguntas = [
    preguntaConVisual('eco-a', 'barras', { items: [{ etiqueta: 'x', valor: 1 }, { etiqueta: 'y', valor: 2 }], leyenda: 'z', fuente: 'INE 2024' }),
    preguntaConVisual('eco-b', 'flujo', { pasos: ['uno', 'dos'], leyenda: 'z' }), // no es barras/dato: no se toca
  ];
  const llamarFalso = async ({ modelos }) => ({ texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }), modelo: modelos[0], coste: 0.0002, usage: {} });
  const r = await reverificarVisualesGuardados(preguntas, { llamar: llamarFalso, pausaMs: 0 });
  assert.equal(r.revisadas, 1, 'flujo no es barras/dato, no debe entrar en la revisión');
  assert.deepEqual(r.mantenidos, ['eco-a']);
  assert.equal(r.retirados.length, 0);
});

test('reverificarVisualesGuardados: NO regenera -- si el verificador rechaza, retira (visual queda fuera), no reintenta generar', async () => {
  const preguntas = [
    preguntaConVisual('eco-c', 'barras', { items: [{ etiqueta: 'x', valor: 1 }, { etiqueta: 'y', valor: 2 }], leyenda: 'z', fuente: 'INE 2024' }),
  ];
  let llamadas = 0;
  const llamarFalso = async ({ modelos }) => {
    llamadas++;
    return { texto: JSON.stringify({ explicacionOk: true, visualOk: false, motivo: 'cifra no reproducible: valor de "x"' }), modelo: modelos[0], coste: 0.0002, usage: {} };
  };
  const r = await reverificarVisualesGuardados(preguntas, { llamar: llamarFalso, pausaMs: 0 });
  assert.equal(llamadas, 1, 'una sola llamada al verificador -- este modo nunca regenera ni reintenta');
  assert.equal(r.mantenidos.length, 0);
  assert.deepEqual(r.retirados, [{ id: 'eco-c', tipo: 'barras', motivo: 'cifra no reproducible: valor de "x"' }]);
});

test('reverificarVisualesGuardados: respeta el tope de gasto y se detiene antes de agotarlo', async () => {
  const preguntas = [
    preguntaConVisual('eco-d', 'dato', { cifra: '1', texto: 'x', leyenda: 'y', fuente: 'INE 2024' }),
    preguntaConVisual('eco-e', 'dato', { cifra: '2', texto: 'x', leyenda: 'y', fuente: 'INE 2024' }),
  ];
  let llamadas = 0;
  const llamarFalso = async ({ modelos }) => {
    llamadas++;
    return { texto: JSON.stringify({ explicacionOk: true, visualOk: true, motivo: '' }), modelo: modelos[0], coste: 0.01, usage: {} };
  };
  const r = await reverificarVisualesGuardados(preguntas, {
    llamar: llamarFalso,
    pausaMs: 0,
    permitirPago: true,
    topeEur: 0.005,
    costeAcumuladoInicial: 0.006, // ya superado ANTES de intentar la primera pregunta candidata
  });
  assert.equal(llamadas, 0, 'no debe llamar al verificador ni una vez si el tope ya estaba agotado');
  assert.equal(r.detenidoPorTope, true);
  assert.equal(r.mantenidos.length, 0);
  assert.equal(r.retirados.length, 0);
});

// --- CLI: --sin-gratis sin --permitir-pago (hallazgo 5) -----------------------------------------

test('CLI: --sin-gratis sin --permitir-pago falla con error claro y exit code 1, sin llegar a leer el banco', () => {
  const resultado = spawnSync(process.execPath, ['tools/visualizar.js', '--sin-gratis', '--limite', '1'], {
    encoding: 'utf8',
    cwd: process.cwd(), // node --test tests/*.test.js ya se ejecuta desde la raíz del proyecto
  });
  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /--sin-gratis/);
  assert.match(resultado.stderr, /--permitir-pago/);
  // No debe imprimir nada de "candidatas" ni tocar el banco: falla ANTES de procesar nada.
  assert.doesNotMatch(resultado.stdout, /candidatas/);
});
