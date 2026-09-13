import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarVisual,
  contarPalabras,
  generarVisualYExplicacion,
  verificarVisualYExplicacion,
  resolverPregunta,
  GENERADOR_VISUAL,
  VERIFICADOR_VISUAL,
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
      return { tipo: 'dato', cifra: '3%', texto: 'Inflación de España al cierre de 2025', leyenda: 'Inflación 2025' };
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

// --- resolverPregunta: flujo generar → verificar → reintento único ----------------------------

test('resolverPregunta: si el visual pasa la verificación a la primera, no reintenta', async () => {
  let llamadasGenerador = 0;
  let llamadasVerificador = 0;
  const llamarFalso = async ({ modelos }) => {
    if (modelos === GENERADOR_VISUAL) {
      llamadasGenerador++;
      return {
        texto: JSON.stringify({ explicacion: 'Corta y válida.', visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y' } }),
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

test('resolverPregunta: reintenta una vez el visual y lo deja en null si vuelve a fallar', async () => {
  let llamadasGenerador = 0;
  let llamadasVerificador = 0;
  const llamarFalso = async ({ modelos }) => {
    if (modelos === GENERADOR_VISUAL) {
      llamadasGenerador++;
      return {
        texto: JSON.stringify({
          explicacion: 'Corta y válida.',
          visual: { tipo: 'dato', cifra: '1', texto: 'x', leyenda: 'y' },
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
