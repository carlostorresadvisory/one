// Tests del pipeline puro de servidor/generacion.js (Tarea 1 del plan v0.2b1-servidor).
// Todos usan un `llamar` falso inyectado: ninguna llamada de red real, ninguna lectura de
// OPENROUTER_API_KEY. Ver docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md
// §3.1 y §3.4 (spec que manda para esta tarea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generarBorradores,
  verificarBorradores,
  producirTanda,
  GENERADOR_PREGUNTAS_SOLO_PAGO,
  VERIFICADOR_PREGUNTAS_SOLO_PAGO,
} from '../servidor/generacion.js';
import { MODELOS } from '../tools/openrouter.js';
import { GENERADOR_SOLO_PAGO, VERIFICADOR_SOLO_PAGO } from '../tools/visualizar.js';
import { validarPregunta } from '../tools/validar-banco.js';

// --- helpers de test -----------------------------------------------------------------------

function respuestaVF(preguntas, modelo, coste = 0.0001) {
  return { texto: JSON.stringify({ preguntas }), modelo, coste, usage: {} };
}

function borradorVF(extra = {}) {
  return {
    id: 'srv-eco-abc12xy',
    area: 'economia',
    tipo: 'vf',
    hilo: 1,
    nivel: 2,
    enunciado: 'La inflación siempre beneficia a los acreedores.',
    explicacion: 'Al revés: la inflación erosiona el valor real de lo que se cobra, perjudica al acreedor.',
    respuesta: false,
    generador: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    confianza: null,
    verificado: false,
    ...extra,
  };
}

// --- generarBorradores -----------------------------------------------------------------------

test('generarBorradores: con n=5 (un solo lote) reparte V/F 50/50 (redondeado hacia abajo el "true"), asigna ids srv- únicos y area/tipo/nivel', async () => {
  const llamarFalso = async ({ modelos }) => {
    const preguntas = [
      { enunciado: 'A', explicacion: 'porque a', nivel: 1, respuesta: true, hilo: 1 },
      { enunciado: 'B', explicacion: 'porque b', nivel: 2, respuesta: true, hilo: 2 },
      { enunciado: 'C', explicacion: 'porque c', nivel: 3, respuesta: false, hilo: 1 },
      { enunciado: 'D', explicacion: 'porque d', nivel: 4, respuesta: false, hilo: 3 },
      { enunciado: 'E', explicacion: 'porque e', nivel: 5, respuesta: false, hilo: 2 },
    ];
    return respuestaVF(preguntas, modelos[0]);
  };

  const borradores = await generarBorradores({ area: 'economia', ruta: [], n: 5 }, { llamar: llamarFalso });

  assert.equal(borradores.length, 5);
  for (const b of borradores) {
    assert.equal(b.area, 'economia');
    assert.equal(b.tipo, 'vf');
    assert.equal(b.generador, MODELOS.generador.filter((m) => m.endsWith(':free'))[0]);
    assert.equal(b.verificado, false);
    assert.equal(b.confianza, null);
    assert.ok(Number.isInteger(b.nivel) && b.nivel >= 1 && b.nivel <= 5);
  }
  const ids = borradores.map((b) => b.id);
  assert.equal(new Set(ids).size, 5, 'los 5 ids deben ser únicos');
  for (const id of ids) assert.match(id, /^srv-eco-[0-9a-z]+$/);
});

test('generarBorradores: con n mayor que el tamaño de lote hace varias llamadas y mantiene ids únicos entre lotes', async () => {
  let llamadas = 0;
  const llamarFalso = async ({ modelos }) => {
    llamadas++;
    const tamano = llamadas === 1 ? 5 : 3; // n=8 -> lotes [5,3]
    const preguntas = Array.from({ length: tamano }, (_, i) => ({
      enunciado: `Lote ${llamadas} #${i}`,
      explicacion: 'una explicación cualquiera con mecanismo',
      nivel: 3,
      respuesta: i % 2 === 0,
      hilo: 1,
    }));
    return respuestaVF(preguntas, modelos[0]);
  };

  const borradores = await generarBorradores({ area: 'historia', ruta: [], n: 8 }, { llamar: llamarFalso });

  assert.equal(llamadas, 2, 'n=8 con lotes de 5 debe hacer 2 llamadas (5+3)');
  assert.equal(borradores.length, 8);
  const ids = borradores.map((b) => b.id);
  assert.equal(new Set(ids).size, 8, 'ids únicos incluso entre lotes generados en el mismo tick');
  for (const id of ids) assert.match(id, /^srv-his-/);
});

test('generarBorradores: incluye la ruta del átomo y la lista "evitar" en el prompt de sistema cuando se pasan', async () => {
  let sistemaVisto = '';
  const llamarFalso = async ({ modelos, mensajes }) => {
    sistemaVisto = mensajes[0].content;
    return respuestaVF([{ enunciado: 'X', explicacion: 'y', nivel: 1, respuesta: true, hilo: 1 }], modelos[0]);
  };

  await generarBorradores(
    {
      area: 'ciencia',
      ruta: ['Física del día a día', 'por qué vuela un avión'],
      n: 1,
      nivelObjetivo: 4,
      evitar: ['¿El agua hierve a 100°C?'],
    },
    { llamar: llamarFalso },
  );

  assert.match(sistemaVisto, /subtema "por qué vuela un avión" dentro del hilo "Física del día a día"/);
  assert.match(sistemaVisto, /nivel 4/);
  assert.match(sistemaVisto, /¿El agua hierve a 100°C\?/);
});

test('generarBorradores: con permitirPago=false, nunca pasa un modelo de pago a llamar', async () => {
  const modelosVistos = [];
  const llamarFalso = async ({ modelos }) => {
    modelosVistos.push(...modelos);
    return respuestaVF([{ enunciado: 'X', explicacion: 'y', nivel: 1, respuesta: true, hilo: 1 }], modelos[0]);
  };

  await generarBorradores({ area: 'arte', ruta: [], n: 1 }, { llamar: llamarFalso, permitirPago: false });

  assert.ok(modelosVistos.length > 0);
  for (const m of modelosVistos) assert.ok(m.endsWith(':free'), `${m} no es gratis`);
});

test('generarBorradores: área desconocida lanza un error claro', async () => {
  await assert.rejects(
    () => generarBorradores({ area: 'no-existe', ruta: [], n: 1 }, { llamar: async () => respuestaVF([], 'x') }),
    /área desconocida/i,
  );
});

// --- verificarBorradores ---------------------------------------------------------------------

test('verificarBorradores: parte en lotes de 4', async () => {
  const tamanosDeLote = [];
  const llamarFalso = async ({ modelos, mensajes }) => {
    const lote = JSON.parse(mensajes[1].content.slice(mensajes[1].content.indexOf('[')));
    tamanosDeLote.push(lote.length);
    const resultados = lote.map((p) => ({
      id: p.id,
      correcta: true,
      unica: true,
      inequivoca: true,
      cumpleUtilidad: true,
      nivel: 3,
      confianza: 0.9,
      motivo: '',
    }));
    return { texto: JSON.stringify({ resultados }), modelo: modelos[0], coste: 0.00005, usage: {} };
  };

  const borradores = Array.from({ length: 5 }, (_, i) => borradorVF({ id: `srv-eco-${i}` }));
  await verificarBorradores(borradores, { llamar: llamarFalso });

  assert.deepEqual(tamanosDeLote, [4, 1]);
});

test('verificarBorradores: usa un modelo distinto del generador (excluirModelo = generador del lote)', async () => {
  const modelosVistos = [];
  const llamarFalso = async ({ modelos }) => {
    modelosVistos.push(modelos);
    return {
      texto: JSON.stringify({
        resultados: [{ id: 'srv-eco-1', correcta: true, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 2, confianza: 0.9, motivo: '' }],
      }),
      modelo: modelos[0],
      coste: 0,
      usage: {},
    };
  };

  const borrador = borradorVF({ id: 'srv-eco-1', generador: 'z-ai/glm-4.7-flash' });
  await verificarBorradores([borrador], { llamar: llamarFalso, permitirPago: true });

  assert.equal(modelosVistos.length, 1);
  assert.ok(!modelosVistos[0].includes('z-ai/glm-4.7-flash'), 'el modelo generador no debe estar en la cascada del verificador');
});

test('verificarBorradores: si excluir al generador dejaría la cascada vacía, no lo excluye (la usa igualmente)', async () => {
  const modelosVistos = [];
  const llamarFalso = async ({ modelos }) => {
    modelosVistos.push(modelos);
    return {
      texto: JSON.stringify({
        resultados: [{ id: 'srv-eco-1', correcta: true, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 2, confianza: 0.9, motivo: '' }],
      }),
      modelo: modelos[0],
      coste: 0,
      usage: {},
    };
  };

  const unicoModelo = 'z-ai/glm-4.7-flash';
  const borrador = borradorVF({ id: 'srv-eco-1', generador: unicoModelo });
  await verificarBorradores([borrador], { llamar: llamarFalso, permitirPago: true, modelos: [unicoModelo] });

  assert.deepEqual(modelosVistos[0], [unicoModelo]);
});

test('verificarBorradores: rechaza con motivo cuando cualquier booleano es false', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({
      resultados: [
        { id: 'srv-eco-1', correcta: true, unica: false, inequivoca: true, cumpleUtilidad: true, nivel: 2, confianza: 0.95, motivo: 'hay dos opciones defendibles' },
      ],
    }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });

  const [veredicto] = await verificarBorradores([borradorVF({ id: 'srv-eco-1' })], { llamar: llamarFalso });
  assert.equal(veredicto.ok, false);
  assert.match(veredicto.motivo, /dos opciones defendibles/);
});

test('verificarBorradores: rechaza cuando confianza < 0.7 aunque los booleanos sean true', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({
      resultados: [
        { id: 'srv-eco-1', correcta: true, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 2, confianza: 0.5, motivo: '' },
      ],
    }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });

  const [veredicto] = await verificarBorradores([borradorVF({ id: 'srv-eco-1' })], { llamar: llamarFalso });
  assert.equal(veredicto.ok, false);
});

test('verificarBorradores: aprueba y devuelve el nivel del verificador cuando todo cumple', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({
      resultados: [
        { id: 'srv-eco-1', correcta: true, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 4, confianza: 0.92, motivo: '' },
      ],
    }),
    modelo: modelos[0],
    coste: 0.0001,
    usage: {},
  });

  const [veredicto] = await verificarBorradores([borradorVF({ id: 'srv-eco-1', nivel: 1 })], { llamar: llamarFalso });
  assert.equal(veredicto.ok, true);
  assert.equal(veredicto.nivel, 4);
  assert.equal(veredicto.modelo, MODELOS.verificador.filter((m) => m.endsWith(':free'))[0]);
});

test('verificarBorradores: un id sin resultado del verificador queda ok:false con motivo', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({ resultados: [] }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });

  const [veredicto] = await verificarBorradores([borradorVF({ id: 'srv-eco-1' })], { llamar: llamarFalso });
  assert.equal(veredicto.ok, false);
  assert.match(veredicto.motivo, /sin resultado/);
});

test('verificarBorradores: si el lote entero falla (llamar lanza), todos quedan ok:false con motivo "lote fallido"', async () => {
  const llamarFalso = async () => {
    throw new Error('sin respuesta de la cascada');
  };
  const veredictos = await verificarBorradores([borradorVF({ id: 'srv-eco-1' }), borradorVF({ id: 'srv-eco-2' })], { llamar: llamarFalso });
  assert.equal(veredictos.length, 2);
  for (const v of veredictos) {
    assert.equal(v.ok, false);
    assert.match(v.motivo, /lote fallido/);
  }
});

// --- producirTanda ---------------------------------------------------------------------------

// crearLlamarPipeline(): fake llamar de propósito general que reconoce en qué paso del pipeline
// está (por el contenido del prompt de sistema, cada paso usa un texto muy distinto) y responde
// en consecuencia. `veredictoPorEnunciado(enunciado)` decide el veredicto de verificación de cada
// borrador POR SU ENUNCIADO (no por id: el id real lo asigna generarBorradores y no se conoce de
// antemano). Registra todas las llamadas en `registro` para poder inspeccionarlas después.
const VEREDICTO_OK_POR_DEFECTO = { correcta: true, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 3, confianza: 0.9, motivo: '' };

function crearLlamarPipeline({
  vfPorLlamada,
  veredictoPorEnunciado = () => VEREDICTO_OK_POR_DEFECTO,
  visual = { tipo: 'dato', cifra: '3', texto: 'x', leyenda: 'y', fuente: 'INE 2024' },
  fallaVisual = false,
} = {}) {
  const registro = [];
  let llamadaGeneracion = 0;
  const llamar = async ({ modelos, mensajes }) => {
    registro.push({ modelos, sistema: mensajes[0].content });
    const sistema = mensajes[0].content;

    if (sistema.includes('autor de preguntas')) {
      // Paso 1: generarBorradores.
      const preguntas = vfPorLlamada[llamadaGeneracion] ?? vfPorLlamada[vfPorLlamada.length - 1];
      llamadaGeneracion++;
      return respuestaVF(preguntas, modelos[0]);
    }

    if (sistema.includes('verificador escéptico de preguntas de examen')) {
      // Paso 2: verificarBorradores.
      const lote = JSON.parse(mensajes[1].content.slice(mensajes[1].content.indexOf('[')));
      const resultados = lote.map((p) => ({ id: p.id, ...veredictoPorEnunciado(p.enunciado) }));
      return { texto: JSON.stringify({ resultados }), modelo: modelos[0], coste: 0.00003, usage: {} };
    }

    if (sistema.includes('Tu tarea ahora NO es generar preguntas nuevas')) {
      // Paso 4a: generarVisualYExplicacion (dentro de resolverPregunta).
      if (fallaVisual === 'excepcion') throw new Error('cascada de visuales agotada');
      return {
        texto: JSON.stringify({ explicacion: 'Explicación corta y verificable con mecanismo real.', visual }),
        modelo: modelos[0],
        coste: 0.00002,
        usage: {},
      };
    }

    if (sistema.includes('Verificas, de forma ESCÉPTICA')) {
      // Paso 4b: verificarVisualYExplicacion (dentro de resolverPregunta).
      return {
        texto: JSON.stringify({
          explicacionOk: true,
          visualOk: fallaVisual !== 'rechazo',
          motivo: fallaVisual === 'rechazo' ? 'cifra no reproducible' : '',
        }),
        modelo: modelos[0],
        coste: 0.00001,
        usage: {},
      };
    }

    throw new Error(`crearLlamarPipeline: prompt de sistema no reconocido: ${sistema.slice(0, 60)}`);
  };
  return { llamar, registro };
}

test('producirTanda: descarta lo rechazado por el verificador y lo que no pasa validarPregunta, y aplica el nivel del verificador a lo aprobado', async () => {
  const vfPorLlamada = [
    [
      { enunciado: 'Aprobada', explicacion: 'porque sí', nivel: 3, respuesta: true, hilo: 1 },
      { enunciado: 'Rechazada por verificador', explicacion: 'porque no', nivel: 3, respuesta: false, hilo: 1 },
      { enunciado: 'Nivel inválido tras verificar', explicacion: 'porque tal', nivel: 3, respuesta: true, hilo: 1 },
    ],
  ];

  const veredictoPorEnunciado = (enunciado) => {
    if (enunciado === 'Aprobada') return { ...VEREDICTO_OK_POR_DEFECTO, nivel: 4 };
    if (enunciado === 'Rechazada por verificador') {
      return { correcta: false, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 3, confianza: 0.9, motivo: 'dato incorrecto' };
    }
    return { ...VEREDICTO_OK_POR_DEFECTO, nivel: 9 }; // nivel inválido (fuera de 1-5): debe caer en validarPregunta.
  };

  const { llamar } = crearLlamarPipeline({ vfPorLlamada, veredictoPorEnunciado });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 3 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].enunciado, 'Aprobada');
  assert.equal(resultado.aprobadas[0].nivel, 4, 'debe aplicar el nivel del verificador, no el original (3)');

  assert.equal(resultado.rechazadas.length, 2);
  const rechazoVerificador = resultado.rechazadas.find((r) => r.borrador.enunciado === 'Rechazada por verificador');
  const rechazoValidacion = resultado.rechazadas.find((r) => r.borrador.enunciado === 'Nivel inválido tras verificar');
  assert.match(rechazoVerificador.motivo, /dato incorrecto/);
  assert.match(rechazoValidacion.motivo, /validarPregunta/);
  assert.match(rechazoValidacion.motivo, /nivel/);
});

test('producirTanda: incluye la explicación corta y el visual de resolverPregunta en las aprobadas', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'explicación original', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar } = crearLlamarPipeline({ vfPorLlamada });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  const [p] = resultado.aprobadas;
  assert.equal(p.explicacion, 'Explicación corta y verificable con mecanismo real.');
  assert.equal(p.visual.tipo, 'dato');
  assert.ok(validarPregunta(p).length === 0, `la aprobada debe ser válida: ${validarPregunta(p).join('; ')}`);
});

test('producirTanda: tolera visual null cuando el verificador de visual lo rechaza', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'explicación original', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar } = crearLlamarPipeline({ vfPorLlamada, fallaVisual: 'rechazo' });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].visual, null);
  assert.ok(validarPregunta(resultado.aprobadas[0]).length === 0);
});

test('producirTanda: si resolverPregunta lanza (cascada de visuales agotada), la pregunta entra igual sin visual', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'explicación original', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar } = crearLlamarPipeline({ vfPorLlamada, fallaVisual: 'excepcion' });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].visual, null);
  assert.equal(resultado.aprobadas[0].explicacion, 'explicación original', 'sin resolverPregunta, conserva la explicación del borrador');
});

test('producirTanda: suma el coste de generación, verificación y resolución', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'e', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar } = crearLlamarPipeline({ vfPorLlamada });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  // 0.0001 (generación) + 0.00003 (verificación) + 0.00002 (visual generador) + 0.00001 (visual verificador)
  assert.ok(resultado.coste > 0.0001, `coste debería sumar varias llamadas, fue ${resultado.coste}`);
  assert.ok(Math.abs(resultado.coste - (0.0001 + 0.00003 + 0.00002 + 0.00001)) < 1e-9);
});

test('producirTanda: con permitirPago=false, nunca pasa un modelo de pago a llamar al generar/verificar preguntas', async () => {
  // Alcance de esta comprobación: generarBorradores/verificarBorradores (código nuevo de esta
  // tarea) filtran la cascada a ':free' antes de llamar (ver filtrarPorPago en
  // servidor/generacion.js). El paso de visual (resolverPregunta, tools/visualizar.js, ya
  // existente y fuera de esta tarea) NO filtra por su cuenta -- confía, como siempre, en que
  // tools/openrouter.js#llamar se salte cada modelo de pago uno a uno; eso ya está cubierto por
  // los tests de visualizar.test.js y no se toca aquí.
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'e', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar, registro } = crearLlamarPipeline({ vfPorLlamada });

  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar, permitirPago: false });

  const llamadasDePreguntas = registro.filter(
    (r) => r.sistema.includes('autor de preguntas') || r.sistema.includes('verificador escéptico de preguntas de examen'),
  );
  assert.equal(llamadasDePreguntas.length, 2, 'debe haber pasado por generarBorradores y verificarBorradores');
  for (const { modelos } of llamadasDePreguntas) {
    for (const m of modelos) assert.ok(m.endsWith(':free'), `${m} no es gratis`);
  }
});

test('producirTanda: con urgente + permitirPago=true, usa las cascadas de pago barato de preguntas y de visuales', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'e', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar, registro } = crearLlamarPipeline({ vfPorLlamada });

  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar, permitirPago: true, topeEur: 5, urgente: true });

  const cascadasVistas = registro.map((r) => r.modelos);
  assert.ok(cascadasVistas.some((c) => c.length === 1 && c[0] === GENERADOR_PREGUNTAS_SOLO_PAGO[0]));
  assert.ok(cascadasVistas.some((c) => c.length === 1 && c[0] === VERIFICADOR_PREGUNTAS_SOLO_PAGO[0]));
  assert.ok(cascadasVistas.some((c) => c.includes(GENERADOR_SOLO_PAGO[0])));
  assert.ok(cascadasVistas.some((c) => c.includes(VERIFICADOR_SOLO_PAGO[0])));
});

test('producirTanda: sin urgente (aunque permitirPago sea true), usa las cascadas normales, no las de pago barato', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'e', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar, registro } = crearLlamarPipeline({ vfPorLlamada });

  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar, permitirPago: true, urgente: false });

  const primeraLlamadaGeneracion = registro.find((r) => r.sistema.includes('autor de preguntas'));
  assert.deepEqual(primeraLlamadaGeneracion.modelos, MODELOS.generador);
});

test('producirTanda: devuelve en "modelos" los modelos realmente usados a lo largo del pipeline', async () => {
  const vfPorLlamada = [[{ enunciado: 'Única', explicacion: 'e', nivel: 2, respuesta: true, hilo: 1 }]];
  const { llamar } = crearLlamarPipeline({ vfPorLlamada });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.ok(resultado.modelos.length >= 2, 'al menos el modelo generador y el verificador de preguntas');
  assert.ok(resultado.modelos.every((m) => typeof m === 'string' && m.length > 0));
});
