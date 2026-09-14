// Pipeline puro de generación de preguntas del servidor (Tarea 1 del plan v0.2b1-servidor).
// Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.1 y §3.4.
//
// "La verificación nunca se salta, se esconde" (Carlos, 12-sep): nada entra en el colchón sin
// pasar (a) verificarBorradores por un modelo DISTINTO del generador, (b) validarPregunta, (c)
// resolverPregunta (explicación corta + visual, verificados por otro modelo). Este fichero solo
// produce -- no toca disco (eso es servidor/almacen.js y servidor/cola.js, Tareas 2-3).
//
// Todas las funciones aceptan `opciones.llamar` inyectable (por defecto tools/openrouter.js#llamar)
// para que los tests no hagan red, siguiendo el mismo patrón que tools/visualizar.js#resolverPregunta.
// OPENROUTER_API_KEY solo se lee dentro de tools/openrouter.js; aquí nunca se lee ni se registra.
//
// Decisión de alcance (v0.2b1, Tarea 1): el servidor genera únicamente tipo "vf" (verdadero/falso),
// con reparto 50/50 -- a diferencia de la CLI (tools/generar-preguntas.js), que reparte entre los 4
// tipos. Ni `generarBorradores` ni `producirTanda` reciben un parámetro `tipo` (ver el brief de la
// Tarea 1), así que no hay forma de que el llamante pida otro tipo; "empezar sencillo" (preferencia
// de producto de Carlos) y el foco explícito del brief en "V/F 50/50" apuntan a esto mismo. Añadir
// test4/ordenar/error al servidor queda para una tarea futura si hace falta variedad de tipos en el
// colchón.
import { llamar as llamarReal, extraerJson, MODELOS } from '../tools/openrouter.js';
import { validarPregunta } from '../tools/validar-banco.js';
import { resolverPregunta, GENERADOR_SOLO_PAGO, VERIFICADOR_SOLO_PAGO } from '../tools/visualizar.js';
import { promptSistemaGenerador, PROMPT_SISTEMA_VERIFICADOR, EJEMPLOS } from '../tools/prompts-preguntas.js';
import { HILOS_POR_AREA } from '../tools/criterio.js';

// Duplicado a propósito de PREFIJOS en tools/generar-preguntas.js: ese fichero es una CLI, no un
// módulo compartido (mismo motivo por el que tools/visualizar.js duplica AREAS de
// tools/validar-banco.js) -- son 8 literales, no vale la pena una dependencia cruzada por esto.
const PREFIJOS = {
  economia: 'eco',
  historia: 'his',
  ciencia: 'cie',
  tecnologia: 'tec',
  geografia: 'geo',
  filosofia: 'fil',
  arte: 'art',
  logica: 'log',
};

// Tamaños de lote de la spec §3.4: 5 preguntas por llamada de generación ("los gratis truncan con
// 10", mismo síntoma que TAMANO_SUBLOTE en generar-preguntas.js), 4 por llamada de verificación
// (idéntico a TAMANO_LOTE en verificar-preguntas.js).
const TAMANO_LOTE_GENERACION = 5;
const TAMANO_LOTE_VERIFICACION = 4;
const UMBRAL_CONFIANZA_DEFECTO = 0.7;

// Cascadas de pago barato para preguntas, análogas a GENERADOR_SOLO_PAGO/VERIFICADOR_SOLO_PAGO de
// tools/visualizar.js (spec §3.1: "un par análogo para preguntas"). Un solo modelo de pago cada
// una, de proveedores distintos entre sí (para que generador y verificador nunca coincidan sin
// necesidad de excluirModelo) y ya vetados en este repo: 'z-ai/glm-4.7-flash' es el escalón de pago
// más barato de MODELOS.generador; 'deepseek/deepseek-v4-flash' es el más barato de
// MODELOS.verificador (ver comentario de precios en tools/visualizar.js, 13-sep-2026).
export const GENERADOR_PREGUNTAS_SOLO_PAGO = ['z-ai/glm-4.7-flash'];
export const VERIFICADOR_PREGUNTAS_SOLO_PAGO = ['deepseek/deepseek-v4-flash'];

function esModeloGratis(id) {
  return id.endsWith(':free');
}

// Filtra la cascada a solo modelos ':free' cuando permitirPago es false. A diferencia de
// tools/openrouter.js#llamar (que se salta cada modelo de pago uno a uno según los va probando),
// aquí se filtra ANTES de llamar: el brief exige que, con permitirPago=false, nunca se pase un
// modelo de pago a `llamar`, ni siquiera como candidato descartado.
function filtrarPorPago(modelos, permitirPago) {
  return permitirPago ? modelos : modelos.filter(esModeloGratis);
}

function partirEnLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

// Igual que repartirEnSublotes() en tools/generar-preguntas.js (duplicado a propósito: ese fichero
// es una CLI, no un módulo compartido).
function repartirEnSublotes(cantidad, tamano) {
  const partes = [];
  let restante = cantidad;
  while (restante > 0) {
    const parte = Math.min(tamano, restante);
    partes.push(parte);
    restante -= parte;
  }
  return partes;
}

let contadorIdInterno = 0;
const LETRAS = 'abcdefghijklmnopqrstuvwxyz';

// Formato de la spec §3.2: srv-<prefijoArea>-<base36 de Date.now()><2 letras aleatorias>. Un lote
// se genera en un bucle síncrono, así que varias preguntas del mismo lote comparten Date.now() en
// milisegundos; sumamos un contador interno monótono a la marca de tiempo para que esa parte nunca
// choque dentro de este proceso (las 2 letras siguen siendo aleatorias, tal cual pide la spec, pero
// la unicidad real no depende de que no choquen).
function generarIdServidor(prefijo) {
  const marca = (Date.now() + contadorIdInterno++).toString(36);
  const l1 = LETRAS[Math.floor(Math.random() * LETRAS.length)];
  const l2 = LETRAS[Math.floor(Math.random() * LETRAS.length)];
  return `srv-${prefijo}-${marca}${l1}${l2}`;
}

function promptUsuarioVF(n, mitad, resto, numHilos) {
  return (
    `Genera ${n} afirmaciones de verdadero/falso NUEVAS, EXACTAMENTE ${mitad} con "respuesta": true ` +
    `y ${resto} con "respuesta": false (nunca desequilibres esta proporción; las falsas deben ser ` +
    'plausibles -- un dato, fecha, autor o relación cambiados por otro verosímil -- nunca absurdas ' +
    'ni obvias). Repártelas entre los niveles 1 a 5. Responde con un objeto JSON ' +
    '{"preguntas": [ ... ]} donde cada elemento tiene exactamente este esquema: { "enunciado": ' +
    '"string", "explicacion": "string", "nivel": 1..5, "respuesta": true|false, "hilo": ' +
    `1..${numHilos} (número del hilo de la lista de arriba en el que encaja) }.\n` +
    `Ejemplos válidos (no los repitas, son solo formato): ${JSON.stringify(EJEMPLOS.vf)}`
  );
}

/**
 * Genera `n` borradores de tipo "vf" (verdadero/falso, reparto 50/50) para un área, opcionalmente
 * centrados en una ruta del átomo y evitando enunciados recientes. Una función pura: no valida, no
 * verifica y no toca disco -- solo llama al generador y da forma al borrador (id, area, tipo,
 * generador, confianza:null, verificado:false).
 * @param {object} params
 * @param {string} params.area una de validar-banco.js#AREAS
 * @param {string[]} [params.ruta] ruta del átomo (ver promptSistemaGenerador)
 * @param {number} [params.n] cuántos borradores pedir (por defecto 10)
 * @param {number} [params.nivelObjetivo] 1-5, opcional
 * @param {string[]} [params.evitar] enunciados recientes a no repetir
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar] inyectable para tests; por defecto tools/openrouter.js#llamar
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {string[]} [opciones.modelos] cascada a usar; por defecto MODELOS.generador
 * @param {{coste: number}} [opciones.acumulador] si se pasa, se le suma el coste de cada llamada
 *   (así producirTanda puede sumar el coste total sin que este fichero cambie la forma exacta de
 *   retorno que pide el brief: `borradores[]`, un array plano).
 * @returns {Promise<object[]>}
 */
export async function generarBorradores(params, opciones = {}) {
  const { area, ruta = [], n = 10, nivelObjetivo, evitar = [] } = params || {};
  const {
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    rutaLog,
    modelos = MODELOS.generador,
    acumulador,
  } = opciones;

  const prefijo = PREFIJOS[area];
  if (!prefijo) {
    throw new Error(`generarBorradores: área desconocida: ${area}`);
  }

  const numHilos = (HILOS_POR_AREA[area] || []).length || 1;
  const sistema = promptSistemaGenerador(area, { ruta, nivelObjetivo, evitar });
  const modelosFiltrados = filtrarPorPago(modelos, permitirPago);

  const borradores = [];
  for (const tamanoLote of repartirEnSublotes(n, TAMANO_LOTE_GENERACION)) {
    const mitad = Math.floor(tamanoLote / 2);
    const resto = tamanoLote - mitad;
    const mensajes = [
      { role: 'system', content: sistema },
      { role: 'user', content: promptUsuarioVF(tamanoLote, mitad, resto, numHilos) },
    ];

    const salida = await llamarFn({
      modelos: modelosFiltrados,
      mensajes,
      json: true,
      permitirPago,
      topeEur,
      ...(rutaLog ? { rutaLog } : {}),
    });
    if (acumulador) acumulador.coste += salida.coste || 0;

    const datos = extraerJson(salida.texto);
    const lista = Array.isArray(datos) ? datos : datos.preguntas || [];

    for (const bruto of lista) {
      borradores.push({
        ...bruto,
        id: generarIdServidor(prefijo),
        area,
        tipo: 'vf',
        generador: salida.modelo,
        confianza: null,
        verificado: false,
      });
    }
  }

  return borradores;
}

function promptUsuarioVerificador(lote) {
  const resumen = lote.map((p) => ({ id: p.id, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion, respuesta: p.respuesta }));
  return `Verifica estas ${lote.length} preguntas:\n${JSON.stringify(resumen)}`;
}

/**
 * Verifica una lista de borradores con un modelo DISTINTO del que generó cada lote (lotes de 4,
 * `excluirModelo` = borrador.generador). Una sola llamada por lote que devuelve
 * correcta/unica/inequivoca/cumpleUtilidad/nivel/confianza/motivo (spec §3.1: sustituye a las tres
 * pasadas de la CLI).
 * @param {object[]} borradores
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar]
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {number} [opciones.umbral] confianza mínima para aprobar; por defecto 0.7
 * @param {string[]} [opciones.modelos] cascada a usar; por defecto MODELOS.verificador
 * @param {{coste: number}} [opciones.acumulador]
 * @returns {Promise<{id: string, ok: boolean, nivel: number|null, motivo: string, modelo: string|null}[]>}
 */
export async function verificarBorradores(borradores, opciones = {}) {
  const {
    llamar: llamarFn = llamarReal,
    permitirPago = false,
    topeEur = 0,
    rutaLog,
    umbral = UMBRAL_CONFIANZA_DEFECTO,
    modelos = MODELOS.verificador,
    acumulador,
  } = opciones;

  const resultados = [];
  const lotes = partirEnLotes(borradores, TAMANO_LOTE_VERIFICACION);

  for (const lote of lotes) {
    if (lote.length === 0) continue;

    // excluirModelo = el generador del lote (spec §3.4.2). Si el lote mezclara generadores
    // distintos (posible si un sub-lote de generarBorradores cayó a otro modelo de la cascada), se
    // usa el del primer borrador -- caso raro y sin mejor heurística sin complicar el contrato.
    const excluirModelo = lote[0]?.generador || null;
    let candidatos = excluirModelo ? modelos.filter((m) => m !== excluirModelo) : modelos.slice();
    // "si la cascada del verificador solo contiene ese [modelo generador], saltarlo" (nota del
    // controlador en el brief): no lanzar, usar la cascada completa igualmente.
    if (candidatos.length === 0) candidatos = modelos.slice();
    const modelosFiltrados = filtrarPorPago(candidatos, permitirPago);

    const mensajes = [
      { role: 'system', content: PROMPT_SISTEMA_VERIFICADOR },
      { role: 'user', content: promptUsuarioVerificador(lote) },
    ];

    let salida;
    try {
      salida = await llamarFn({
        modelos: modelosFiltrados,
        mensajes,
        json: true,
        permitirPago,
        topeEur,
        ...(rutaLog ? { rutaLog } : {}),
      });
    } catch (err) {
      for (const b of lote) {
        resultados.push({ id: b.id, ok: false, nivel: null, motivo: `lote fallido: ${err.message}`, modelo: null });
      }
      continue;
    }
    if (acumulador) acumulador.coste += salida.coste || 0;

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch (err) {
      for (const b of lote) {
        resultados.push({ id: b.id, ok: false, nivel: null, motivo: `JSON inválido: ${err.message}`, modelo: salida.modelo });
      }
      continue;
    }

    const listaResultados = Array.isArray(datos) ? datos : datos.resultados || [];
    const idsDelLote = new Set(lote.map((b) => b.id));
    const vistos = new Set();

    for (const r of listaResultados) {
      if (!idsDelLote.has(r.id)) continue;
      vistos.add(r.id);
      const nivel = Number.isInteger(r.nivel) ? r.nivel : null;
      const ok =
        r.correcta === true &&
        r.unica === true &&
        r.inequivoca === true &&
        r.cumpleUtilidad !== false &&
        Number(r.confianza) >= umbral;
      resultados.push({
        id: r.id,
        ok,
        nivel,
        motivo: ok ? '' : r.motivo || 'no aprobada por el verificador',
        modelo: salida.modelo,
      });
    }
    for (const b of lote) {
      if (!vistos.has(b.id)) {
        resultados.push({ id: b.id, ok: false, nivel: null, motivo: 'sin resultado del verificador', modelo: salida.modelo });
      }
    }
  }

  return resultados;
}

/**
 * Pipeline completo de una tanda: generar → verificar → validarPregunta → resolverPregunta (spec
 * §3.4). La verificación nunca se salta: nada llega a `aprobadas` sin pasar por las tres.
 * @param {object} params mismos que generarBorradores
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar]
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {boolean} [opciones.urgente] con permitirPago, usa las cascadas de pago barato
 *   (GENERADOR_PREGUNTAS_SOLO_PAGO/VERIFICADOR_PREGUNTAS_SOLO_PAGO y, para el visual,
 *   GENERADOR_SOLO_PAGO/VERIFICADOR_SOLO_PAGO de tools/visualizar.js) en vez de las normales.
 * @returns {Promise<{aprobadas: object[], rechazadas: {borrador: object, motivo: string}[], coste: number, modelos: string[]}>}
 *
 * Nota sobre permitirPago=false: generarBorradores/verificarBorradores (código de esta tarea)
 * filtran su cascada a solo ':free' antes de llamar. El paso de visual (resolverPregunta, ya
 * existente en tools/visualizar.js, fuera de esta tarea) no filtra por su cuenta -- sigue confiando
 * en que tools/openrouter.js#llamar se salte cada modelo de pago uno a uno, como ya hacía antes de
 * este plan; ese comportamiento tiene sus propios tests en tests/visualizar.test.js y no se toca.
 */
export async function producirTanda(params, opciones = {}) {
  const { area, ruta = [], n = 10, nivelObjetivo, evitar = [] } = params || {};
  const { llamar: llamarFn = llamarReal, permitirPago = false, topeEur = 0, rutaLog, urgente = false } = opciones;

  const usaPagoBarato = urgente && permitirPago;
  const acumulador = { coste: 0 };
  const modelosUsados = new Set();
  const rechazadas = [];
  const aprobadas = [];

  const borradores = await generarBorradores(
    { area, ruta, n, nivelObjetivo, evitar },
    {
      llamar: llamarFn,
      permitirPago,
      topeEur,
      rutaLog,
      acumulador,
      ...(usaPagoBarato ? { modelos: GENERADOR_PREGUNTAS_SOLO_PAGO } : {}),
    },
  );
  for (const b of borradores) {
    if (b.generador) modelosUsados.add(b.generador);
  }

  const veredictos = await verificarBorradores(borradores, {
    llamar: llamarFn,
    permitirPago,
    topeEur,
    rutaLog,
    acumulador,
    ...(usaPagoBarato ? { modelos: VERIFICADOR_PREGUNTAS_SOLO_PAGO } : {}),
  });
  const veredictoPorId = new Map(veredictos.map((v) => [v.id, v]));

  for (const borrador of borradores) {
    const veredicto = veredictoPorId.get(borrador.id);
    if (!veredicto) {
      rechazadas.push({ borrador, motivo: 'sin veredicto del verificador' });
      continue;
    }
    if (veredicto.modelo) modelosUsados.add(veredicto.modelo);
    if (!veredicto.ok) {
      rechazadas.push({ borrador, motivo: veredicto.motivo || 'no aprobada por el verificador' });
      continue;
    }

    // El nivel del verificador manda siempre sobre el que propuso el generador (spec §3.1).
    const candidata = {
      ...borrador,
      nivel: Number.isInteger(veredicto.nivel) ? veredicto.nivel : borrador.nivel,
      verificado: true,
      verificador: veredicto.modelo,
    };

    const erroresValidacion = validarPregunta(candidata);
    if (erroresValidacion.length > 0) {
      rechazadas.push({ borrador: candidata, motivo: `validarPregunta: ${erroresValidacion.join('; ')}` });
      continue;
    }

    let resuelta = { ...candidata, visual: null };
    try {
      const resolucion = await resolverPregunta(candidata, {
        llamar: llamarFn,
        permitirPago,
        topeEur,
        rutaLog,
        necesitaVisual: true,
        ...(usaPagoBarato ? { modelosGenerador: GENERADOR_SOLO_PAGO, modelosVerificador: VERIFICADOR_SOLO_PAGO } : {}),
      });
      acumulador.coste += resolucion.coste || 0;
      if (resolucion.modeloGenerador) modelosUsados.add(resolucion.modeloGenerador);
      if (resolucion.modeloVerificador) modelosUsados.add(resolucion.modeloVerificador);
      resuelta = { ...candidata, explicacion: resolucion.explicacion, visual: resolucion.visual };
    } catch {
      // Si toda la cascada de visuales falla (red, todos los modelos agotados...), la pregunta
      // entra igual, sin visual -- igual que cuando resolverPregunta rechaza el visual con calma
      // (spec §3.4: "una que falle (a) o (b) se descarta con motivo" no aplica al visual, que es
      // opcional; el 11 % del banco tampoco lo tiene).
      resuelta = { ...candidata, visual: null };
    }

    aprobadas.push(resuelta);
  }

  return {
    aprobadas,
    rechazadas,
    coste: acumulador.coste,
    modelos: [...modelosUsados],
  };
}
