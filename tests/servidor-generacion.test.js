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
  repartoPorTipo,
  GENERADOR_PREGUNTAS_SOLO_PAGO,
  VERIFICADOR_PREGUNTAS_SOLO_PAGO,
  enParalelo,
  MAX_LOTES_EN_VUELO,
  MAX_VISUALES_EN_VUELO,
  completarVisual,
} from '../servidor/generacion.js';
import { MODELOS, esModeloGratis } from '../tools/openrouter.js';
import {
  GENERADOR_SOLO_PAGO,
  VERIFICADOR_SOLO_PAGO,
  GENERADOR_VISUAL_FONDO,
  VERIFICADOR_VISUAL_FONDO,
} from '../tools/visualizar.js';
import { validarPregunta } from '../tools/validar-banco.js';
import { EJEMPLOS, promptUsuarioVF, promptSistemaGenerador } from '../tools/prompts-preguntas.js';
import { MEZCLA } from '../motor.js';

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
    // Cambiado (Tarea 2, v0.2b3): antes filtraba solo por ':free' -- con `esModeloGratis` (que
    // también cuenta los "gemini:*" como gratis, ya en cabeza de MODELOS.generador) el primer
    // modelo gratis real pasa a ser 'gemini:gemini-flash-lite-latest'.
    assert.equal(b.generador, MODELOS.generador.filter(esModeloGratis)[0]);
    assert.equal(b.verificado, false);
    assert.equal(b.confianza, null);
    assert.ok(Number.isInteger(b.nivel) && b.nivel >= 1 && b.nivel <= 5);
  }
  const ids = borradores.map((b) => b.id);
  assert.equal(new Set(ids).size, 5, 'los 5 ids deben ser únicos');
  for (const id of ids) assert.match(id, /^srv-eco-[0-9a-z]+$/);
});

// Ronda final (revisión, 14-sep-2026) -- Menor (M4): lista blanca de campos -- antes `{...bruto}`
// copiaba cualquier campo que el modelo devolviera, esperado o no, directamente al pipeline.
test('generarBorradores (M4): descarta campos no esperados que el modelo devuelva, conserva los de contenido', async () => {
  const llamarFalso = async ({ modelos }) => {
    const preguntas = [
      {
        enunciado: 'A',
        explicacion: 'porque a',
        nivel: 1,
        respuesta: true,
        hilo: 1,
        // Campos que un modelo no debería mandar nunca -- deben desaparecer del borrador final.
        id: 'srv-inventado-por-el-modelo',
        generador: 'modelo-que-el-modelo-se-inventa',
        confianza: 0.99,
        verificado: true,
        notaInterna: 'esto no debería sobrevivir',
      },
    ];
    return respuestaVF(preguntas, modelos[0]);
  };

  const [borrador] = await generarBorradores({ area: 'economia', ruta: [], n: 1 }, { llamar: llamarFalso });

  // Los campos de contenido sobreviven.
  assert.equal(borrador.enunciado, 'A');
  assert.equal(borrador.explicacion, 'porque a');
  assert.equal(borrador.nivel, 1);
  assert.equal(borrador.respuesta, true);
  assert.equal(borrador.hilo, 1);
  // id/generador/confianza/verificado los pone SIEMPRE este código, nunca lo que mandó el modelo.
  assert.notEqual(borrador.id, 'srv-inventado-por-el-modelo');
  assert.match(borrador.id, /^srv-eco-[0-9a-z]+$/);
  assert.notEqual(borrador.generador, 'modelo-que-el-modelo-se-inventa');
  assert.equal(borrador.confianza, null);
  assert.equal(borrador.verificado, false);
  // Cualquier otro campo inesperado desaparece.
  assert.equal(borrador.notaInterna, undefined);
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
  // Cambiado (Tarea 2, v0.2b3): "gratis" ya no es solo ':free' -- ver esModeloGratis.
  for (const m of modelosVistos) assert.ok(esModeloGratis(m), `${m} no es gratis`);
});

// Tarea 2 (v0.2b3): esModeloGratis ahora se importa de tools/openrouter.js en vez de duplicarse
// localmente -- este test demuestra que los ids "gemini:*" (ya en cabeza de MODELOS.generador, ver
// Tarea 1) llegan de verdad a `llamar` con permitirPago=false, y en primer lugar.
test('generarBorradores: con permitirPago=false, la cascada que llega a llamar empieza por gemini:gemini-flash-lite-latest', async () => {
  const modelosVistos = [];
  const llamarFalso = async ({ modelos }) => {
    modelosVistos.push(...modelos);
    return respuestaVF([{ enunciado: 'X', explicacion: 'y', nivel: 1, respuesta: true, hilo: 1 }], modelos[0]);
  };

  await generarBorradores({ area: 'arte', ruta: [], n: 1 }, { llamar: llamarFalso, permitirPago: false });

  assert.equal(modelosVistos[0], 'gemini:gemini-flash-lite-latest');
});

test('generarBorradores: área desconocida lanza un error claro', async () => {
  await assert.rejects(
    () => generarBorradores({ area: 'no-existe', ruta: [], n: 1 }, { llamar: async () => respuestaVF([], 'x') }),
    /área desconocida/i,
  );
});

test('generarBorradores: tipo desconocido lanza un error claro', async () => {
  await assert.rejects(
    () => generarBorradores({ area: 'economia', ruta: [], n: 1, tipo: 'no-existe' }, { llamar: async () => respuestaVF([], 'x') }),
    /tipo desconocido/i,
  );
});

// Ronda 1 (controlador, 14-sep-2026): generarBorradores debe poder pedir cualquiera de los 4 tipos
// de la CLI, no solo "vf". Para cada uno: el prompt de usuario menciona el tipo pedido y lleva el
// ejemplo de EJEMPLOS[tipo]; el borrador resultante lleva `tipo` correcto y, con una respuesta bien
// formada del modelo falso, pasa validarPregunta (una vez completados los campos que solo pone
// producirTanda: nivel válido ya lo trae el ejemplo, así que basta con verificado/generador, que ya
// pone generarBorradores).
const RESPUESTAS_EJEMPLO_POR_TIPO = {
  test4: { enunciado: '¿Cuál es la capital de Italia?', explicacion: 'porque sí', nivel: 2, opciones: ['Madrid', 'Roma', 'Berlín', 'París'], correcta: 1, hilo: 1 },
  ordenar: { enunciado: 'Ordena de menor a mayor.', explicacion: 'porque sí', nivel: 2, criterio: 'de menor a mayor', items: ['1', '5', '10', '50'], hilo: 1 },
  error: {
    enunciado: 'Encuentra el error.',
    explicacion: 'porque sí',
    nivel: 2,
    tarjeta: { titulo: 'T', filas: [{ etiqueta: 'a', valor: '1' }, { etiqueta: 'b', valor: '2' }, { etiqueta: 'c', valor: '3' }] },
    sospechoso: 0,
    hilo: 1,
  },
};

for (const tipo of ['test4', 'ordenar', 'error']) {
  test(`generarBorradores: con tipo "${tipo}" pide ese esquema y usa el ejemplo de EJEMPLOS.${tipo}`, async () => {
    let usuarioVisto = '';
    const llamarFalso = async ({ modelos, mensajes }) => {
      usuarioVisto = mensajes[1].content;
      return respuestaVF([RESPUESTAS_EJEMPLO_POR_TIPO[tipo]], modelos[0]);
    };

    const [borrador] = await generarBorradores({ area: 'economia', ruta: [], n: 1, tipo }, { llamar: llamarFalso });

    assert.match(usuarioVisto, new RegExp(`Tipo de pregunta: ${tipo}\\.`));
    assert.ok(usuarioVisto.includes(JSON.stringify(EJEMPLOS[tipo])), 'el prompt debe incluir el ejemplo de ese tipo');
    assert.equal(borrador.tipo, tipo);
    assert.equal(validarPregunta(borrador).length, 0, `debe pasar validarPregunta: ${validarPregunta(borrador).join('; ')}`);
  });
}

// --- promptSistemaGenerador (v0.2b4 §6b) ---------------------------------------------------------

test('v0.2b4 §6b: el prompt de preguntas pide la explicación de 25 a 40 palabras desde la primera llamada', () => {
  const texto = promptSistemaGenerador('economia');
  assert.match(texto, /de 25 a 40 palabras/i);
  assert.match(texto, /nunca más de 40/i);
});

// --- promptUsuarioVF (Ronda 2, punto 2: el reparto 50/50 real, no solo el recuento final) --------
// Antes solo se comprobaba el RESULTADO ya parseado (2 true/3 false) con un `llamar` falso que
// devolvía lo que el test quería, sin mirar si el PROMPT enviado pedía de verdad ese reparto. Estos
// tests capturan el prompt de usuario tal cual lo recibe `llamar` y comprueban el texto exacto.

test('promptUsuarioVF: para n=5 pide EXACTAMENTE 2 "true" y 3 "false" (mitad=floor(5/2))', () => {
  const texto = promptUsuarioVF(5, 2, 3, 4);
  assert.match(texto, /Genera 5 afirmaciones de verdadero\/falso NUEVAS, EXACTAMENTE 2 con "respuesta": true y 3 con "respuesta": false/);
});

test('promptUsuarioVF: para n=4 pide EXACTAMENTE 2 "true" y 2 "false"', () => {
  const texto = promptUsuarioVF(4, 2, 2, 4);
  assert.match(texto, /Genera 4 afirmaciones de verdadero\/falso NUEVAS, EXACTAMENTE 2 con "respuesta": true y 2 con "respuesta": false/);
});

test('generarBorradores: el prompt real que recibe `llamar` para tipo "vf" pide el reparto correcto (n=5 -> 2/3, n=4 -> 2/2)', async () => {
  const usuariosPorN = {};
  const llamarFalso = async ({ modelos, mensajes }) => {
    const n = Number(mensajes[1].content.match(/Genera (\d+)/)[1]);
    usuariosPorN[n] = mensajes[1].content;
    return respuestaVF([], modelos[0]);
  };

  await generarBorradores({ area: 'economia', ruta: [], n: 5, tipo: 'vf' }, { llamar: llamarFalso });
  await generarBorradores({ area: 'economia', ruta: [], n: 4, tipo: 'vf' }, { llamar: llamarFalso });

  assert.match(usuariosPorN[5], /EXACTAMENTE 2 con "respuesta": true y 3 con "respuesta": false/);
  assert.match(usuariosPorN[4], /EXACTAMENTE 2 con "respuesta": true y 2 con "respuesta": false/);
});

// --- repartoPorTipo -------------------------------------------------------------------------

test('repartoPorTipo: n=10 reproduce exactamente MEZCLA (vf 3, test4 4, ordenar 2, error 1)', () => {
  assert.deepEqual(repartoPorTipo(10), { ...MEZCLA });
});

test('repartoPorTipo: n=5 reparte proporcionalmente y la suma da exactamente 5', () => {
  const reparto = repartoPorTipo(5);
  const suma = Object.values(reparto).reduce((a, b) => a + b, 0);
  assert.equal(suma, 5);
  assert.ok(reparto.test4 >= 1, 'test4 debe tener al menos 1 (mayor peso de MEZCLA)');
  for (const v of Object.values(reparto)) assert.ok(Number.isInteger(v) && v >= 0);
});

test('repartoPorTipo: con n >= 2, siempre hay al menos 1 test4 aunque el redondeo lo deje en 0', () => {
  for (let n = 2; n <= 12; n++) {
    const reparto = repartoPorTipo(n);
    const suma = Object.values(reparto).reduce((a, b) => a + b, 0);
    assert.equal(suma, n, `n=${n}: la suma debe seguir siendo ${n}`);
    assert.ok(reparto.test4 >= 1, `n=${n}: debe haber al menos 1 test4, fue ${JSON.stringify(reparto)}`);
  }
});

test('repartoPorTipo: n=0 y n=1 no fuerzan test4 de más (n=1 lo da la propia proporción)', () => {
  assert.deepEqual(repartoPorTipo(0), { vf: 0, test4: 0, ordenar: 0, error: 0 });
  const reparto1 = repartoPorTipo(1);
  assert.equal(Object.values(reparto1).reduce((a, b) => a + b, 0), 1);
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

// Ronda final (revisión, 14-sep-2026) -- Adversarial (A9): antes, `excluirModelo` solo miraba el
// generador del PRIMER borrador de cada lote de 4 -- si el lote mezclaba generadores, los demás
// borradores del lote podían acabar verificados por su propio generador. Agrupando por generador
// ANTES de partir en lotes, cada lote es homogéneo y la exclusión es correcta para todos.
test('verificarBorradores (A9): agrupa por generador antes de partir en lotes, para excluir al de cada uno', async () => {
  const generadorA = 'modelo-a:free';
  const generadorB = 'modelo-b:free';
  const borradores = [
    borradorVF({ id: 'b1', generador: generadorA }),
    borradorVF({ id: 'b2', generador: generadorB }),
    borradorVF({ id: 'b3', generador: generadorA }),
  ];
  const llamadas = [];
  const llamarFalso = async ({ modelos, mensajes }) => {
    const lote = JSON.parse(mensajes[1].content.slice(mensajes[1].content.indexOf('[')));
    llamadas.push({ modelos, ids: lote.map((p) => p.id) });
    const resultados = lote.map((p) => ({ id: p.id, ...VEREDICTO_OK_POR_DEFECTO }));
    return { texto: JSON.stringify({ resultados }), modelo: modelos[0], coste: 0, usage: {} };
  };

  await verificarBorradores(borradores, { llamar: llamarFalso, modelos: [generadorA, generadorB, 'modelo-c:free'] });

  assert.equal(llamadas.length, 2, 'un lote por generador (b1+b3 juntos, b2 aparte)');
  const loteA = llamadas.find((l) => l.ids.includes('b1'));
  const loteB = llamadas.find((l) => l.ids.includes('b2'));
  assert.deepEqual(loteA.ids.sort(), ['b1', 'b3']);
  assert.ok(!loteA.modelos.includes(generadorA), 'el lote de A no debe poder usar A como su propio verificador');
  assert.ok(loteA.modelos.includes(generadorB));
  assert.deepEqual(loteB.ids, ['b2']);
  assert.ok(!loteB.modelos.includes(generadorB), 'el lote de B no debe poder usar B como su propio verificador');
  assert.ok(loteB.modelos.includes(generadorA));
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

// Ronda final (revisión, 14-sep-2026) -- Adversarial (A1), regla fija de Carlos: "el verificador
// NUNCA es el generador". La primera versión de este test comprobaba justo lo contrario de esta
// regla (que SÍ se usara el generador como verificador cuando no quedaba otra cascada) -- nunca
// debía haberse aceptado así. Corregido: con permitirPago, se usa el par dedicado de pago barato
// (VERIFICADOR_PREGUNTAS_SOLO_PAGO); sin permitirPago, el lote se rechaza sin llamar a nadie (test
// aparte, justo debajo).
test('verificarBorradores (A1): si excluir al generador deja la cascada vacía y permitirPago, usa VERIFICADOR_PREGUNTAS_SOLO_PAGO', async () => {
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
  const resultados = await verificarBorradores([borrador], {
    llamar: llamarFalso,
    permitirPago: true,
    modelos: [unicoModelo],
  });

  assert.deepEqual(modelosVistos[0], VERIFICADOR_PREGUNTAS_SOLO_PAGO);
  assert.ok(!modelosVistos[0].includes(unicoModelo), 'el generador nunca debe verificar su propio borrador');
  assert.equal(resultados[0].ok, true);
});

test('verificarBorradores (A1): si excluir al generador deja la cascada vacía y NO permitirPago, rechaza el lote sin llamar a nadie', async () => {
  let llamadas = 0;
  const llamarFalso = async () => {
    llamadas++;
    throw new Error('no debería llamarse');
  };

  const unicoModelo = 'z-ai/glm-4.7-flash';
  const borrador = borradorVF({ id: 'srv-eco-1', generador: unicoModelo });
  const resultados = await verificarBorradores([borrador], {
    llamar: llamarFalso,
    permitirPago: false,
    modelos: [unicoModelo],
  });

  assert.equal(llamadas, 0);
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].ok, false);
  assert.equal(resultados[0].motivo, 'sin verificador distinto del generador');
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

// Ronda final (revisión, 14-sep-2026) -- Adversarial (A2): `cumpleUtilidad` ausente debe rechazar
// igual que si fuera `false` explícito -- antes `!== false` dejaba pasar el campo ausente.
test('verificarBorradores (A2): cumpleUtilidad ausente rechaza igual que cumpleUtilidad:false', async () => {
  const llamarFalso = async ({ modelos }) => ({
    texto: JSON.stringify({
      resultados: [{ id: 'srv-eco-1', correcta: true, unica: true, inequivoca: true, nivel: 2, confianza: 0.95, motivo: '' }],
    }),
    modelo: modelos[0],
    coste: 0,
    usage: {},
  });

  const [veredicto] = await verificarBorradores([borradorVF({ id: 'srv-eco-1' })], { llamar: llamarFalso });
  assert.equal(veredicto.ok, false, 'sin cumpleUtilidad, el verificador no ha confirmado nada -- se rechaza');
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
  // Cambiado (Tarea 2, v0.2b3): ver el comentario análogo en generarBorradores más arriba.
  assert.equal(veredicto.modelo, MODELOS.verificador.filter(esModeloGratis)[0]);
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

// Ronda 1: producirTanda ahora reparte `n` entre los 4 tipos (repartoPorTipo) y llama a
// generarBorradores una vez POR TIPO, así que el pipeline falso tiene que reconocer de qué tipo es
// cada llamada de generación (no basta con un array indexado por orden de llamada como en la v1).

/** Construye una pregunta bien formada del tipo pedido, con overrides opcionales. */
function preguntaGenerica(tipo, indice, overrides = {}) {
  const base = {
    enunciado: `Pregunta ${tipo} ${indice}`,
    explicacion: `Explicación ${indice} con mecanismo real.`,
    nivel: 2,
    hilo: 1,
    ...overrides,
  };
  switch (tipo) {
    case 'vf':
      return { ...base, respuesta: overrides.respuesta ?? indice % 2 === 0 };
    case 'test4':
      return { ...base, opciones: overrides.opciones ?? ['A', 'B', 'C', 'D'], correcta: overrides.correcta ?? 1 };
    case 'ordenar':
      return { ...base, criterio: overrides.criterio ?? 'de menor a mayor', items: overrides.items ?? ['1', '2', '3', '4'] };
    case 'error':
      return {
        ...base,
        tarjeta: overrides.tarjeta ?? {
          titulo: 'Título',
          filas: [
            { etiqueta: 'a', valor: '1' },
            { etiqueta: 'b', valor: '2' },
            { etiqueta: 'c', valor: '3' },
          ],
        },
        sospechoso: overrides.sospechoso ?? 0,
      };
    default:
      throw new Error(`preguntaGenerica: tipo desconocido: ${tipo}`);
  }
}

function detectarTipoYCantidad(usuario) {
  const tipo = /afirmaciones de verdadero\/falso/.test(usuario) ? 'vf' : (usuario.match(/Tipo de pregunta: (\w+)\./) || [])[1];
  const cantidad = Number((usuario.match(/Genera (\d+)/) || [])[1] || 0);
  return { tipo, cantidad };
}

// crearLlamarPipeline(): fake llamar de propósito general que reconoce en qué paso del pipeline
// está (por el contenido del prompt de sistema, cada paso usa un texto muy distinto) y responde en
// consecuencia. Para el paso de generación, detecta el TIPO pedido en el prompt de usuario y sirve
// preguntas de `preguntasPorTipo[tipo]` (una cola que se consume en orden); si no hay suficientes
// (o no se ha pasado esa lista), rellena con `preguntaGenerica`. `veredictoPorEnunciado(enunciado)`
// decide el veredicto de verificación de cada borrador POR SU ENUNCIADO (el id real lo asigna
// generarBorradores y no se conoce de antemano). Registra todas las llamadas en `registro`.
const VEREDICTO_OK_POR_DEFECTO = { correcta: true, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 3, confianza: 0.9, motivo: '' };

function crearLlamarPipeline({
  preguntasPorTipo = {},
  veredictoPorEnunciado = () => VEREDICTO_OK_POR_DEFECTO,
  visual = { tipo: 'dato', cifra: '3', texto: 'x', leyenda: 'y', fuente: 'INE 2024' },
  fallaVisual = false,
} = {}) {
  const registro = [];
  const colas = {};
  for (const tipo of ['vf', 'test4', 'ordenar', 'error']) colas[tipo] = [...(preguntasPorTipo[tipo] || [])];
  let contadorGenerico = 0;

  const llamar = async ({ modelos, mensajes }) => {
    registro.push({ modelos, sistema: mensajes[0].content, usuario: mensajes[1]?.content });
    const sistema = mensajes[0].content;

    if (sistema.includes('autor de preguntas')) {
      // Paso 1: generarBorradores (una llamada por tipo con cantidad > 0).
      const { tipo, cantidad } = detectarTipoYCantidad(mensajes[1].content);
      const preguntas = [];
      for (let i = 0; i < cantidad; i++) {
        preguntas.push(colas[tipo].length > 0 ? colas[tipo].shift() : preguntaGenerica(tipo, contadorGenerico++));
      }
      return respuestaVF(preguntas, modelos[0]);
    }

    if (sistema.includes('verificador escéptico de preguntas de examen')) {
      // Paso 2: verificarBorradores (lote combinado, puede mezclar tipos).
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

// n=1 -> repartoPorTipo da {test4:1, resto 0} (ver tests de repartoPorTipo más arriba), así que las
// tandas de un solo item de aquí en adelante son de tipo "test4" salvo que se pase preguntasPorTipo
// explícito para otro tipo.

test('producirTanda: reparte n entre tipos (n=10 reproduce MEZCLA) y junta todo antes de verificar', async () => {
  const { llamar, registro } = crearLlamarPipeline({});

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar });

  const llamadasGeneracion = registro.filter((r) => r.sistema.includes('autor de preguntas'));
  const tiposPedidos = llamadasGeneracion.map((r) => detectarTipoYCantidad(r.usuario));
  assert.deepEqual(
    Object.fromEntries(tiposPedidos.map((t) => [t.tipo, t.cantidad])),
    { ...MEZCLA },
    'una llamada de generación por tipo, con la cantidad de MEZCLA',
  );
  assert.equal(resultado.aprobadas.length, 10, 'con el verificador falso aprobando todo, deben llegar los 10');
  const porTipo = {};
  for (const p of resultado.aprobadas) porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1;
  assert.deepEqual(porTipo, { ...MEZCLA });
});

test('producirTanda: cada tipo llega al verificador con su forma (opciones/correcta, criterio/items, tarjeta/sospechoso)', async () => {
  const { llamar, registro } = crearLlamarPipeline({});

  await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar });

  const lotesVerificacion = registro
    .filter((r) => r.sistema.includes('verificador escéptico de preguntas de examen'))
    .map((r) => JSON.parse(r.usuario.slice(r.usuario.indexOf('['))))
    .flat();

  const porTipo = Object.fromEntries(['vf', 'test4', 'ordenar', 'error'].map((t) => [t, lotesVerificacion.find((p) => p.tipo === t)]));
  assert.ok(porTipo.vf && typeof porTipo.vf.respuesta === 'boolean', 'vf debe llevar "respuesta"');
  assert.ok(porTipo.test4 && Array.isArray(porTipo.test4.opciones) && typeof porTipo.test4.correcta === 'number', 'test4 debe llevar "opciones"/"correcta"');
  assert.ok(porTipo.ordenar && porTipo.ordenar.criterio && Array.isArray(porTipo.ordenar.items), 'ordenar debe llevar "criterio"/"items"');
  assert.ok(porTipo.error && porTipo.error.tarjeta && typeof porTipo.error.sospechoso === 'number', 'error debe llevar "tarjeta"/"sospechoso"');
});

// Ronda 2, punto 1 (controlador, 14-sep-2026): si la cascada de generación se agota del todo para
// UN tipo, la tanda no debe abortar entera -- debe seguir con los demás tipos y registrarlo en
// `fallos`, sin lanzar.
test('producirTanda: si un tipo agota su cascada de generación, sigue con los demás, lo registra en "fallos" y no lanza', async () => {
  const { llamar: base, registro } = crearLlamarPipeline({});
  const llamarFalso = async (args) => {
    const esGeneracion = args.mensajes[0].content.includes('autor de preguntas');
    const tipo = esGeneracion ? detectarTipoYCantidad(args.mensajes[1].content).tipo : null;
    if (esGeneracion && tipo === 'ordenar') {
      throw new Error('cascada de preguntas agotada');
    }
    return base(args);
  };

  // n=10 -> repartoPorTipo da MEZCLA: {vf:3, test4:4, ordenar:2, error:1}.
  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar: llamarFalso });

  assert.equal(resultado.fallos.length, 1);
  assert.equal(resultado.fallos[0].tipo, 'ordenar');
  assert.match(resultado.fallos[0].motivo, /cascada de preguntas agotada/);

  assert.equal(resultado.pedidas, 10);
  assert.equal(resultado.obtenidas, 8, 'MEZCLA sin los 2 "ordenar" deja vf:3 + test4:4 + error:1 = 8');

  assert.ok(!resultado.aprobadas.some((p) => p.tipo === 'ordenar'), 'no debe haber aprobadas de "ordenar"');
  assert.equal(resultado.aprobadas.length, 8, 'los otros 3 tipos siguen generándose, verificándose y aprobándose con normalidad');
  assert.ok(resultado.coste > 0, 'el coste de los tipos que sí funcionaron no se pierde');
});

test('generarBorradores: si un lote falla pero otro de la misma llamada funciona, no se pierden los borradores ya conseguidos', async () => {
  let llamadas = 0;
  const llamarFalso = async ({ modelos }) => {
    llamadas++;
    if (llamadas === 1) throw new Error('primer lote sin respuesta');
    // n=8 -> lotes [5,3]: el primero falla, el segundo (3 preguntas) debe seguir llegando.
    const preguntas = Array.from({ length: 3 }, (_, i) => ({
      enunciado: `Superviviente ${i}`,
      explicacion: 'una explicación con mecanismo',
      nivel: 3,
      respuesta: i % 2 === 0,
      hilo: 1,
    }));
    return respuestaVF(preguntas, modelos[0]);
  };

  const borradores = await generarBorradores({ area: 'economia', ruta: [], n: 8, tipo: 'vf' }, { llamar: llamarFalso });

  assert.equal(llamadas, 2, 'debe intentar los 2 lotes aunque el primero falle');
  assert.equal(borradores.length, 3, 'conserva los borradores del lote que sí funcionó');
});

test('generarBorradores: si TODOS los lotes fallan, propaga el último error (no devuelve una lista vacía en silencio)', async () => {
  await assert.rejects(
    () => generarBorradores({ area: 'economia', ruta: [], n: 2, tipo: 'vf' }, { llamar: async () => { throw new Error('cascada agotada del todo'); } }),
    /cascada agotada del todo/,
  );
});

test('producirTanda: un "ordenar" inválido (items duplicados) no entra si el verificador lo rechaza', async () => {
  const preguntasPorTipo = {
    ordenar: [preguntaGenerica('ordenar', 0, { enunciado: 'Orden ambiguo', items: ['10', '10', '20', '30'] })],
  };
  const veredictoPorEnunciado = (enunciado) => {
    if (enunciado === 'Orden ambiguo') {
      return { correcta: true, unica: false, inequivoca: false, cumpleUtilidad: true, nivel: 2, confianza: 0.9, motivo: 'items duplicados, orden ambiguo' };
    }
    return VEREDICTO_OK_POR_DEFECTO;
  };
  const { llamar } = crearLlamarPipeline({ preguntasPorTipo, veredictoPorEnunciado });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar });

  assert.ok(!resultado.aprobadas.some((p) => p.enunciado === 'Orden ambiguo'), 'el ordenar con items duplicados no debe aprobarse');
  const rechazo = resultado.rechazadas.find((r) => r.borrador.enunciado === 'Orden ambiguo');
  assert.ok(rechazo, 'debe aparecer entre las rechazadas');
  assert.match(rechazo.motivo, /items duplicados/);
});

test('producirTanda: descarta lo rechazado por el verificador y lo que no pasa validarPregunta, y aplica el nivel del verificador a lo aprobado', async () => {
  const preguntasPorTipo = {
    vf: [preguntaGenerica('vf', 0, { enunciado: 'Aprobada', respuesta: true })],
    test4: [preguntaGenerica('test4', 0, { enunciado: 'Rechazada por verificador' })],
    ordenar: [preguntaGenerica('ordenar', 0, { enunciado: 'Nivel inválido tras verificar' })],
  };

  const veredictoPorEnunciado = (enunciado) => {
    if (enunciado === 'Aprobada') return { ...VEREDICTO_OK_POR_DEFECTO, nivel: 4 };
    if (enunciado === 'Rechazada por verificador') {
      return { correcta: false, unica: true, inequivoca: true, cumpleUtilidad: true, nivel: 3, confianza: 0.9, motivo: 'dato incorrecto' };
    }
    if (enunciado === 'Nivel inválido tras verificar') return { ...VEREDICTO_OK_POR_DEFECTO, nivel: 9 }; // fuera de 1-5 -> validarPregunta lo rechaza
    return VEREDICTO_OK_POR_DEFECTO;
  };

  const { llamar } = crearLlamarPipeline({ preguntasPorTipo, veredictoPorEnunciado });

  // n=3 -> repartoPorTipo da {vf:1, test4:1, ordenar:1, error:0} (ver tests de repartoPorTipo).
  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 3 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].enunciado, 'Aprobada');
  assert.equal(resultado.aprobadas[0].nivel, 4, 'debe aplicar el nivel del verificador, no el original (2)');

  assert.equal(resultado.rechazadas.length, 2);
  const rechazoVerificador = resultado.rechazadas.find((r) => r.borrador.enunciado === 'Rechazada por verificador');
  const rechazoValidacion = resultado.rechazadas.find((r) => r.borrador.enunciado === 'Nivel inválido tras verificar');
  assert.match(rechazoVerificador.motivo, /dato incorrecto/);
  assert.match(rechazoValidacion.motivo, /validarPregunta/);
  assert.match(rechazoValidacion.motivo, /nivel/);
});

test('producirTanda: incluye el visual de resolverPregunta en las aprobadas', async () => {
  const { llamar } = crearLlamarPipeline({});

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  const [p] = resultado.aprobadas;
  assert.equal(p.visual.tipo, 'dato');
  assert.ok(validarPregunta(p).length === 0, `la aprobada debe ser válida: ${validarPregunta(p).join('; ')}`);
});

// v0.2b4 §6b: producirTanda llama a resolverPregunta con saltarAcortado:true -- el borrador que
// acaba de salir del generador de preguntas (y que ya pasó verificarBorradores) ya cumple el límite
// de 25-40 palabras (preguntaGenerica produce "Explicación N con mecanismo real.", 5 palabras), así
// que resolverPregunta NO debe gastar una llamada en reescribirla: la aprobada conserva la
// explicación original tal cual, aunque el `llamar` falso del paso de visual devuelva otra distinta.
test('v0.2b4 §6b: producirTanda no reescribe una explicación que ya cumple el límite de palabras', async () => {
  const { llamar } = crearLlamarPipeline({});

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  const [p] = resultado.aprobadas;
  assert.match(p.explicacion, /^Explicación \d+ con mecanismo real\.$/, 'conserva la explicación del borrador, no la del mock de visual');
  assert.notEqual(p.explicacion, 'Explicación corta y verificable con mecanismo real.');
});

// Ronda final (revisión, 14-sep-2026) -- Menor (M5): la confianza del verificador se copia a la
// pregunta final -- antes se calculaba (para decidir `ok`) y se tiraba.
test('producirTanda (M5): copia la confianza del verificador a la pregunta aprobada', async () => {
  const { llamar } = crearLlamarPipeline({ veredictoPorEnunciado: () => ({ ...VEREDICTO_OK_POR_DEFECTO, confianza: 0.87 }) });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].confianza, 0.87);
});

test('producirTanda: tolera visual null cuando el verificador de visual lo rechaza', async () => {
  const { llamar } = crearLlamarPipeline({ fallaVisual: 'rechazo' });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].visual, null);
  assert.ok(validarPregunta(resultado.aprobadas[0]).length === 0);
});

test('producirTanda: si resolverPregunta lanza (cascada de visuales agotada), la pregunta entra igual sin visual', async () => {
  const preguntasPorTipo = { test4: [preguntaGenerica('test4', 0, { explicacion: 'explicación original' })] };
  const { llamar } = crearLlamarPipeline({ preguntasPorTipo, fallaVisual: 'excepcion' });

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.equal(resultado.aprobadas.length, 1);
  assert.equal(resultado.aprobadas[0].visual, null);
  assert.equal(resultado.aprobadas[0].explicacion, 'explicación original', 'sin resolverPregunta, conserva la explicación del borrador');
});

test('producirTanda: suma el coste de generación, verificación y resolución', async () => {
  const { llamar } = crearLlamarPipeline({});

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  // 0.0001 (generación) + 0.00003 (verificación) + 0.00002 (visual generador) + 0.00001 (visual verificador)
  assert.ok(resultado.coste > 0.0001, `coste debería sumar varias llamadas, fue ${resultado.coste}`);
  assert.ok(Math.abs(resultado.coste - (0.0001 + 0.00003 + 0.00002 + 0.00001)) < 1e-9);
});

test('producirTanda: con permitirPago=false, nunca pasa un modelo de pago a llamar al generar/verificar preguntas', async () => {
  // Alcance de esta comprobación: generarBorradores/verificarBorradores (código nuevo de esta
  // tarea) filtran la cascada a solo modelos gratis (esModeloGratis: ':free' o "gemini:*") antes
  // de llamar (ver filtrarPorPago en servidor/generacion.js). El paso de visual (resolverPregunta, tools/visualizar.js, ya
  // existente y fuera de esta tarea) NO filtra por su cuenta -- confía, como siempre, en que
  // tools/openrouter.js#llamar se salte cada modelo de pago uno a uno; eso ya está cubierto por
  // los tests de visualizar.test.js y no se toca aquí.
  const { llamar, registro } = crearLlamarPipeline({});

  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar, permitirPago: false });

  const llamadasDePreguntas = registro.filter(
    (r) => r.sistema.includes('autor de preguntas') || r.sistema.includes('verificador escéptico de preguntas de examen'),
  );
  assert.equal(llamadasDePreguntas.length, 2, 'debe haber pasado por generarBorradores y verificarBorradores');
  for (const { modelos } of llamadasDePreguntas) {
    // Cambiado (Tarea 2, v0.2b3): ver el comentario análogo en generarBorradores más arriba.
    for (const m of modelos) assert.ok(esModeloGratis(m), `${m} no es gratis`);
  }
});

// Ronda final (revisión, 14-sep-2026) -- Important (I2): la primera versión de este test
// comprobaba `c.length === 1` -- es decir, que la cascada de pago barato SUSTITUÍA a la normal.
// Corregido tras el ruling del controlador: debe ir DELANTE de la normal, nunca sustituirla (si el
// único modelo de pago barato falla, un urgente no debe quedarse sin nada más que probar).
test('producirTanda: con urgente + permitirPago=true, antepone las cascadas de pago barato a las normales, sin sustituirlas (I2)', async () => {
  const { llamar, registro } = crearLlamarPipeline({});

  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar, permitirPago: true, topeEur: 5, urgente: true });

  const cascadasVistas = registro.map((r) => r.modelos);
  assert.ok(
    cascadasVistas.some((c) => c[0] === GENERADOR_PREGUNTAS_SOLO_PAGO[0] && c.length > GENERADOR_PREGUNTAS_SOLO_PAGO.length),
    'la cascada de generación de preguntas debe seguir con la normal detrás del modelo de pago barato',
  );
  assert.ok(
    cascadasVistas.some((c) => c[0] === VERIFICADOR_PREGUNTAS_SOLO_PAGO[0] && c.length > VERIFICADOR_PREGUNTAS_SOLO_PAGO.length),
  );
  assert.ok(cascadasVistas.some((c) => c[0] === GENERADOR_SOLO_PAGO[0] && c.length > GENERADOR_SOLO_PAGO.length));
  assert.ok(cascadasVistas.some((c) => c[0] === VERIFICADOR_SOLO_PAGO[0] && c.length > VERIFICADOR_SOLO_PAGO.length));
});

test('v0.2b4.1 §3: una tanda urgente usa las cascadas rápidas y una de fondo las suyas', async () => {
  const urgente = crearLlamarPipeline({});
  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar: urgente.llamar, urgente: true });
  const genUrgente = urgente.registro.find((r) => r.sistema.includes('autor de preguntas'));
  assert.deepEqual(genUrgente.modelos, MODELOS.generador);

  const fondo = crearLlamarPipeline({});
  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar: fondo.llamar, urgente: false });
  const genFondo = fondo.registro.find((r) => r.sistema.includes('autor de preguntas'));
  assert.deepEqual(genFondo.modelos, MODELOS.generadorFondo, 'el colchón no gasta la cuota rápida');
  const verFondo = fondo.registro.find((r) => r.sistema.includes('verificador escéptico de preguntas'));
  // El verificador excluye al modelo que generó, así que se compara contra la cascada ya filtrada.
  assert.deepEqual(verFondo.modelos, MODELOS.verificadorFondo.filter((m) => m !== genFondo.modelos[0]));

  // Y el paso de visual también cambia de cascada según urgencia.
  const visualFondo = fondo.registro.find((r) => r.sistema.includes('visual'));
  assert.equal(visualFondo.modelos[0], GENERADOR_VISUAL_FONDO[0]);
});

// REESCRITO (v0.2b4.1 §3, excepción declarada en Global Constraints): antes afirmaba que sin
// `urgente` se usaban "las cascadas normales" (MODELOS.generador). Desde v0.2b4.1 un trabajo de
// fondo tiene cascada PROPIA a propósito -- lo contrario sería gastar en el colchón nocturno la
// cuota rápida que el jugador necesita de día. Lo que sigue siendo cierto, y es lo que este test
// protege ahora, es que `permitirPago` no basta: sin `urgente` NO se usan las de pago barato.
test('producirTanda: sin urgente (aunque permitirPago sea true), nunca usa las cascadas de pago barato', async () => {
  const { llamar, registro } = crearLlamarPipeline({});

  await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar, permitirPago: true, urgente: false });

  const cascadasVistas = registro.map((r) => r.modelos);
  for (const cascada of cascadasVistas) {
    assert.ok(!cascada.includes(GENERADOR_PREGUNTAS_SOLO_PAGO[0]), 'nada de pago barato en un trabajo de fondo');
    assert.ok(!cascada.includes(VERIFICADOR_PREGUNTAS_SOLO_PAGO[0]));
  }
  const primeraGeneracion = registro.find((r) => r.sistema.includes('autor de preguntas'));
  assert.deepEqual(primeraGeneracion.modelos, MODELOS.generadorFondo);
});

test('producirTanda: devuelve en "modelos" los modelos realmente usados a lo largo del pipeline', async () => {
  const { llamar } = crearLlamarPipeline({});

  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 1 }, { llamar });

  assert.ok(resultado.modelos.length >= 2, 'al menos el modelo generador y el verificador de preguntas');
  assert.ok(resultado.modelos.every((m) => typeof m === 'string' && m.length > 0));
});

// --- paralelismo (v0.2b4.1 §4) ----------------------------------------------------------------

// Doble de `llamar` que mide cuántas llamadas hay EN VUELO a la vez. El setTimeout es lo que
// permite que se solapen de verdad: sin él, cada llamada terminaría antes de que empiece la
// siguiente y el máximo sería siempre 1, aunque el código fuera perfectamente paralelo.
function llamarQueMidePaparelismo(respuesta, { msPorLlamada = 20 } = {}) {
  let enVuelo = 0;
  const medida = { max: 0, total: 0 };
  const llamar = async (opciones) => {
    enVuelo += 1;
    medida.total += 1;
    medida.max = Math.max(medida.max, enVuelo);
    try {
      await new Promise((r) => setTimeout(r, msPorLlamada));
      return respuesta(opciones);
    } finally {
      enVuelo -= 1;
    }
  };
  return { llamar, medida };
}

test('v0.2b4.1 §4: los lotes de generación por tipo van en PARALELO, con tope de 4 en vuelo', async () => {
  const { llamar: base } = crearLlamarPipeline({});
  const { llamar, medida } = llamarQueMidePaparelismo((op) => base(op));

  // n=10 -> reparto en los 4 tipos (vf 3, test4 4, ordenar 2, error 1): 4 lotes de generación.
  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar, urgente: true });

  assert.ok(resultado.aprobadas.length > 0, 'la tanda sigue produciendo preguntas');
  assert.ok(medida.max > 1, 'secuencial: los cuatro tipos deben solaparse');
  assert.ok(medida.max <= MAX_VISUALES_EN_VUELO, 'nunca por encima del tope mayor del pipeline');
});

test('v0.2b4.1 §4: enParalelo respeta el tope y conserva el ORDEN de los resultados', async () => {
  let enVuelo = 0;
  let max = 0;
  const items = [50, 10, 40, 5, 30, 1, 20];
  const salida = await enParalelo(items, 3, async (ms, indice) => {
    enVuelo += 1;
    max = Math.max(max, enVuelo);
    await new Promise((r) => setTimeout(r, ms));
    enVuelo -= 1;
    return `${indice}:${ms}`;
  });
  assert.equal(max, 3, 'nunca más de 3 a la vez');
  // NOTA (discrepancia del brief, corregida aquí): el brief original comparaba `salida` contra un
  // array de valores en crudo (['0:50', ...]), pero eso contradice tanto el propio Step 28
  // (`resultados[indice] = { ok: true, valor: ... }`) como el test siguiente de esta misma sección
  // ("un fallo no tumba al resto"), que exige `{ok, valor}`/`{ok, error}` -- y también contradice a
  // los dos consumidores reales de `enParalelo` (producirTanda en Step 28 y Step 33), que leen
  // `resultado.ok`/`resultado.valor`. Un único contrato no puede satisfacer las dos formas a la
  // vez; se elige la envuelta por ser la que exige el resto del brief y el código de producción.
  assert.deepEqual(
    salida,
    ['0:50', '1:10', '2:40', '3:5', '4:30', '5:1', '6:20'].map((valor) => ({ ok: true, valor })),
    'el orden es el de entrada',
  );
});

test('v0.2b4.1 §4: enParalelo con un fallo no tumba al resto (cada tarea se resuelve o se anota)', async () => {
  const salida = await enParalelo([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error('boom');
    return n * 10;
  });
  assert.deepEqual(salida, [{ ok: true, valor: 10 }, { ok: false, error: 'boom' }, { ok: true, valor: 30 }]);
});

// M5 (ronda de corrección 1): un `tope` no numérico (NaN, Infinity venido de una división por 0,
// undefined...) no debe colarse tal cual en `Math.min(Math.max(1, tope), lista.length)` -- se trata
// como 1 (secuencial), la opción segura, nunca como "sin límite".
test('v0.2b4.1 §4 (M5): enParalelo con tope no numérico (NaN) se trata como 1, nunca como sin límite', async () => {
  let max = 0;
  let enVuelo = 0;
  const salida = await enParalelo([1, 2, 3], NaN, async (n) => {
    enVuelo += 1;
    max = Math.max(max, enVuelo);
    await new Promise((r) => setTimeout(r, 5));
    enVuelo -= 1;
    return n;
  });
  assert.equal(max, 1, 'tope no numérico se trata como 1 (secuencial), no como NaN/Infinity sin control');
  assert.deepEqual(salida, [{ ok: true, valor: 1 }, { ok: true, valor: 2 }, { ok: true, valor: 3 }]);
});

test('v0.2b4.1 §4: los visuales se resuelven en PARALELO, con tope de 5 en vuelo y sin pausa entre preguntas', async () => {
  const { llamar: base } = crearLlamarPipeline({});
  let visualesEnVuelo = 0;
  let maxVisuales = 0;
  const llamar = async (opciones) => {
    const esVisual = opciones.mensajes[0].content.includes('visual');
    if (esVisual) {
      visualesEnVuelo += 1;
      maxVisuales = Math.max(maxVisuales, visualesEnVuelo);
    }
    try {
      await new Promise((r) => setTimeout(r, 15));
      return base(opciones);
    } finally {
      if (esVisual) visualesEnVuelo -= 1;
    }
  };

  const inicio = Date.now();
  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar, urgente: true });
  const duracion = Date.now() - inicio;

  assert.equal(resultado.aprobadas.length, 10);
  assert.ok(maxVisuales > 1, 'los visuales deben solaparse');
  assert.ok(maxVisuales <= MAX_VISUALES_EN_VUELO, `tope de ${MAX_VISUALES_EN_VUELO} en vuelo`);
  // Sin paralelismo ni pausa serían >= 20 llamadas x 15 ms = 300 ms; con la pausa de 1 s por
  // pregunta que la spec manda quitar, más de 10 s. El margen es amplio a propósito: mide que NO
  // hay serialización oculta, no una latencia concreta.
  assert.ok(duracion < 2000, `una tanda de 10 con dobles de 15 ms no puede tardar ${duracion} ms`);
});

// Actualizado en la ronda de corrección 1 (I2): la versión original solo comprobaba la forma final
// de `avisos` (contador 1..n, `pedidas` correcto), que seguía en verde aunque los avisos llegaran
// TODOS juntos al terminar el lote entero -- el bug real que encontró la revisión. Ahora también se
// mide EN QUÉ MOMENTO llega cada aviso, con resoluciones que terminan en ticks distintos.
test('v0.2b4.1 §6: producirTanda avisa por cada pregunta resuelta, no por lote (y en tiempo real, no al final)', async () => {
  const { llamar: base } = crearLlamarPipeline({});
  let contadorVisual = 0;
  const llamar = async (opciones) => {
    const esGeneradorVisual = opciones.mensajes[0].content.includes('Tu tarea ahora NO es generar preguntas nuevas');
    if (esGeneradorVisual) {
      const i = contadorVisual++;
      await new Promise((r) => setTimeout(r, i * 25)); // ticks distintos: 0, 25, 50, 75, 100 ms
    }
    return base(opciones);
  };

  const avisos = [];
  const inicio = Date.now();
  const resultado = await producirTanda(
    { area: 'economia', ruta: [], n: 5 },
    { llamar, urgente: true, onProgreso: (p) => avisos.push({ ...p, enMs: Date.now() - inicio }) },
  );
  assert.equal(avisos.length, resultado.aprobadas.length, 'un aviso por aprobada');
  assert.deepEqual(avisos.map((a) => a.verificadas), avisos.map((_, i) => i + 1), '1, 2, 3... nunca saltos');
  assert.ok(avisos.every((a) => a.pedidas === 5));

  // Si onProgreso solo se disparara DESPUÉS de que las 5 promesas de la Fase 2 ya se resolvieran
  // todas (el bug de I2), el primero y el último aviso tendrían prácticamente el mismo instante.
  const primero = Math.min(...avisos.map((a) => a.enMs));
  const ultimo = Math.max(...avisos.map((a) => a.enMs));
  assert.ok(ultimo - primero > 30, `los avisos deben repartirse en el tiempo, no llegar todos juntos (rango medido: ${ultimo - primero} ms)`);
});

test('v0.2b4.1 §6: sin onProgreso, producirTanda funciona exactamente igual (opción opcional)', async () => {
  const { llamar } = crearLlamarPipeline({});
  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 2 }, { llamar, urgente: true });
  assert.equal(resultado.aprobadas.length, 2);
});

// --- Ronda de corrección 1 (Opus, controlador) --------------------------------------------------

// I1: la concurrencia también debe distinguir urgente/fondo -- no solo los modelos (Task 3, cascadas
// por urgencia). Un trabajo de fondo (colchón nocturno) no debe disparar ráfagas de 4 generaciones +
// 5 visuales contra NVIDIA/`:free`, que son justo los eslabones con menos margen.
test('v0.2b4.1 §4 (I1): una tanda de FONDO procesa secuencial (tope 1); una URGENTE sigue en paralelo', async () => {
  const { llamar: base } = crearLlamarPipeline({});

  async function medirConcurrencia(urgente) {
    let enVuelo = 0;
    let max = 0;
    const llamar = async (opciones) => {
      enVuelo += 1;
      max = Math.max(max, enVuelo);
      try {
        await new Promise((r) => setTimeout(r, 15));
        return base(opciones);
      } finally {
        enVuelo -= 1;
      }
    };
    await producirTanda({ area: 'economia', ruta: [], n: 10 }, { llamar, urgente });
    return max;
  }

  const maxFondo = await medirConcurrencia(false);
  const maxUrgente = await medirConcurrencia(true);

  assert.equal(maxFondo, 1, 'el colchón nocturno nunca dispara dos llamadas a la vez');
  assert.ok(maxUrgente >= 2, 'una tanda urgente sí solapa llamadas');
});

// I2: onProgreso está cableado pero era inerte -- las 5 llamadas de la Fase 2 (visuales) se
// resolvían en el mismo tick sincrono DESPUÉS de `await enParalelo(...)`, así que GET /trabajo/:id
// nunca veía valores intermedios reales. Este test usa resoluciones que terminan en TICKS DISTINTOS
// (stagger creciente por orden de llamada) y comprueba que los avisos llegan repartidos en el
// tiempo, no todos juntos al final.
test('v0.2b4.1 §6 (I2): onProgreso llega en tiempo real, según cada candidata va terminando -- no todo junto al final', async () => {
  const { llamar: base } = crearLlamarPipeline({});
  let contadorVisual = 0;
  const llamar = async (opciones) => {
    const esGeneradorVisual = opciones.mensajes[0].content.includes('Tu tarea ahora NO es generar preguntas nuevas');
    if (esGeneradorVisual) {
      const i = contadorVisual++;
      await new Promise((r) => setTimeout(r, i * 30)); // ticks distintos: 0, 30, 60, 90, 120 ms
    }
    return base(opciones);
  };

  const avisos = [];
  const inicio = Date.now();
  const resultado = await producirTanda(
    { area: 'economia', ruta: [], n: 5 },
    { llamar, urgente: true, onProgreso: (p) => avisos.push({ ...p, enMs: Date.now() - inicio }) },
  );

  assert.equal(resultado.aprobadas.length, 5);
  assert.equal(avisos.length, 5);
  assert.deepEqual(avisos.map((a) => a.verificadas), [1, 2, 3, 4, 5], 'contador monótono, un aviso por candidata terminada');

  // Si onProgreso solo se disparara al final (el bug de I2), todos los avisos tendrían prácticamente
  // el mismo instante. Con las resoluciones escalonadas 0/30/60/90/120 ms, el primero y el último
  // deben separarse claramente en el tiempo.
  const primero = Math.min(...avisos.map((a) => a.enMs));
  const ultimo = Math.max(...avisos.map((a) => a.enMs));
  assert.ok(ultimo - primero > 40, `los avisos deben repartirse en el tiempo, no llegar todos juntos (rango medido: ${ultimo - primero} ms)`);
});

// --- v0.2b4.1 §5: el visual deja de bloquear (timeout, visualPendiente, completarVisual) --------

test('v0.2b4.1 §5: un visual que tarda más de la cuenta NO retiene la pregunta: sale con visualPendiente', async () => {
  const { llamar: base } = crearLlamarPipeline({});
  const llamar = async (opciones) => {
    // Solo el paso de visual se queda colgado; generar y verificar preguntas responden normal.
    if (opciones.mensajes[0].content.includes('visual')) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return base(opciones);
  };

  const resultado = await producirTanda(
    { area: 'economia', ruta: [], n: 2 },
    { llamar, urgente: true, timeoutVisualMs: 30 },
  );

  assert.equal(resultado.aprobadas.length, 2, 'las preguntas salen igual: el visual es opcional');
  for (const p of resultado.aprobadas) {
    assert.equal(p.visual, null);
    assert.equal(p.visualPendiente, true, 'marcada para que el trabajo de fondo la complete');
  }
});

test('v0.2b4.1 §5: si el visual llega a tiempo, la pregunta sale completa y SIN visualPendiente', async () => {
  const { llamar } = crearLlamarPipeline({});
  const resultado = await producirTanda({ area: 'economia', ruta: [], n: 2 }, { llamar, urgente: true });
  for (const p of resultado.aprobadas) {
    assert.equal(p.visualPendiente, false);
  }
});

test('v0.2b4.1 §5: un trabajo de FONDO no tiene timeout corto (nadie espera, el visual se hace entero)', async () => {
  const { llamar: base } = crearLlamarPipeline({});
  const llamar = async (opciones) => {
    if (opciones.mensajes[0].content.includes('visual')) await new Promise((r) => setTimeout(r, 60));
    return base(opciones);
  };
  const resultado = await producirTanda(
    { area: 'economia', ruta: [], n: 1 },
    { llamar, urgente: false, timeoutVisualMs: 30 },
  );
  assert.equal(resultado.aprobadas[0].visualPendiente, false, 'el timeout es solo del camino urgente');
  assert.notEqual(resultado.aprobadas[0].visual, null);
});

test('v0.2b4.1 §5: completarVisual usa las cascadas de FONDO y no toca la explicación', async () => {
  const cascadasVistas = [];
  const llamar = async ({ modelos, mensajes }) => {
    cascadasVistas.push(modelos);
    // Autocorrección del brief (24-sep-2026): el prompt de verificación real dice "Verificas..."
    // (con mayúscula inicial) -- `.includes('verificas')` en minúsculas nunca casaba con nada y
    // dejaba `esVerificador` siempre en `false`, lo que hacía que el propio verificador recibiera
    // la respuesta con forma de GENERADOR y rechazara el visual (visualOk quedaba undefined). Se
    // compara en minúsculas por los dos lados para no depender de mayúsculas exactas del prompt.
    const esVerificador = mensajes[0].content.toLowerCase().includes('verificas');
    return {
      texto: JSON.stringify(
        esVerificador
          ? { explicacionOk: true, visualOk: true, motivo: '' }
          : { explicacion: 'da igual lo que diga aquí', visual: { tipo: 'formula', texto: 'a = b', leyenda: 'Prueba' } },
      ),
      modelo: modelos[0],
      coste: 0,
      usage: {},
    };
  };

  const pregunta = { ...borradorVF(), explicacion: 'Explicación original del banco, intacta.', visual: null };
  const salida = await completarVisual(pregunta, { llamar });

  assert.equal(salida.visual.tipo, 'formula');
  assert.equal(salida.explicacion, 'Explicación original del banco, intacta.', 'el fondo no reescribe texto');
  assert.equal(cascadasVistas[0][0], GENERADOR_VISUAL_FONDO[0], 'sin prisa: NVIDIA y :free primero');
});

test('v0.2b4.1 §5: completarVisual devuelve visual null si la cascada entera falla, sin lanzar', async () => {
  const llamar = async () => { throw new Error('cascada agotada'); };
  const salida = await completarVisual({ ...borradorVF(), visual: null }, { llamar });
  assert.equal(salida.visual, null);
  assert.equal(salida.coste, 0);
});
