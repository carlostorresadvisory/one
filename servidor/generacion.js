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
// Ronda 1 (corrección del controlador, 14-sep-2026): la primera versión de esta tarea solo
// generaba tipo "vf" -- defecto del plan/brief, no una decisión de producto. Ahora `producirTanda`
// reparte `n` entre los 4 tipos con la misma proporción que MEZCLA de motor.js (import de solo
// lectura; motor.js no se toca) y `generarBorradores` acepta `tipo` para pedir cualquiera de los 4
// con su prompt y esquema correspondientes -- igual que hace hoy tools/generar-preguntas.js, sin
// duplicar su lógica de generación por área más allá de lo imprescindible (esquemaTipo/promptUsuario
// se reconstruyen aquí porque esa CLI no los exporta).
//
// Ronda 2 (revisión del controlador, 14-sep-2026): un tipo que agota su cascada de generación ya no
// aborta la tanda entera -- generarBorradores tolera el fallo de un lote suelto (no pierde lo que
// ya consiguió) y solo propaga el error si NINGÚN lote de ese tipo dio nada; producirTanda convierte
// eso en una entrada de `fallos` y sigue con los demás tipos. `promptUsuarioVF` (el prompt preciso
// del reparto 50/50 de "vf") se movió a tools/prompts-preguntas.js: es lógica de generación de
// preguntas, no del pipeline, y este fichero solo debía importar prompts, no definirlos.
import { llamar as llamarReal, extraerJson, MODELOS } from '../tools/openrouter.js';
import { validarPregunta } from '../tools/validar-banco.js';
import {
  resolverPregunta,
  GENERADOR_SOLO_PAGO,
  VERIFICADOR_SOLO_PAGO,
  GENERADOR_VISUAL,
  VERIFICADOR_VISUAL,
} from '../tools/visualizar.js';
import {
  promptSistemaGenerador,
  promptUsuarioVF,
  PROMPT_SISTEMA_VERIFICADOR,
  EJEMPLOS,
} from '../tools/prompts-preguntas.js';
import { HILOS_POR_AREA } from '../tools/criterio.js';
import { MEZCLA } from '../motor.js';

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

const TIPOS = ['vf', 'test4', 'ordenar', 'error'];

// Tamaños de lote de la spec §3.4: 5 preguntas por llamada de generación ("los gratis truncan con
// 10", mismo síntoma que TAMANO_SUBLOTE en generar-preguntas.js), 4 por llamada de verificación
// (idéntico a TAMANO_LOTE en verificar-preguntas.js). Los lotes de verificación pueden mezclar
// tipos (igual que la CLI mezcla áreas): se verifica la lista combinada de los 4 tipos.
const TAMANO_LOTE_GENERACION = 5;
const TAMANO_LOTE_VERIFICACION = 4;
const UMBRAL_CONFIANZA_DEFECTO = 0.7;

// Cascadas de pago barato para preguntas, análogas a GENERADOR_SOLO_PAGO/VERIFICADOR_SOLO_PAGO de
// tools/visualizar.js (spec §3.1: "un par análogo para preguntas"). Un solo modelo de pago cada
// una, de proveedores distintos entre sí (para que generador y verificador nunca coincidan sin
// necesidad de excluirModelo) y ya vetados en este repo: 'z-ai/glm-4.7-flash' es el escalón de pago
// más barato de MODELOS.generador; 'deepseek/deepseek-v4-flash' es el más barato de
// MODELOS.verificador (ver comentario de precios en tools/visualizar.js, 13-sep-2026). Aceptados
// por el controlador como valor por defecto en la ronda 1 de esta tarea (14-sep-2026) --
// PENDIENTE DE CONFIRMAR CON CARLOS antes de activar PERMITIR_PAGO=1 en producción.
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

// Ronda final (revisión, 14-sep-2026) -- Adversarial (A9): agrupa por `generador` ANTES de partir
// en lotes de verificación. Sin esto, un lote de 4 podía mezclar borradores de generadores
// distintos (posible si sub-lotes de generarBorradores cayeron a modelos distintos de la cascada, o
// si dos tipos usaron modelos distintos) y `excluirModelo` (más abajo) solo mira el generador del
// PRIMER borrador del lote -- los demás podían acabar verificados por su propio generador, la
// regla fija de Carlos que esto viola. Agrupando primero, cada lote es homogéneo: `excluirModelo`
// excluye correctamente al generador de TODOS los borradores de ese lote, no solo del primero.
function agruparPorGenerador(borradores) {
  const grupos = new Map();
  for (const b of borradores) {
    const clave = b.generador || '';
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(b);
  }
  return [...grupos.values()];
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

/**
 * Reparte `n` preguntas entre los 4 tipos con la misma proporción que MEZCLA de motor.js (vf 3,
 * test4 4, ordenar 2, error 1 por cada 10). motor.js no se toca: tiene una función interna
 * `objetivoTipos()` que hace este mismo reparto proporcional con ajuste de resto, pero no está
 * exportada, así que se reconstruye aquí (mismo algoritmo: redondeo proporcional + reparte la
 * diferencia por orden de peso descendente). Garantía añadida por el controlador (ronda 1): al
 * menos 1 "test4" cuando n >= 2, para que ni siquiera una tanda pequeña del átomo se quede sin
 * variedad de tipos.
 * @param {number} n
 * @returns {{vf: number, test4: number, ordenar: number, error: number}}
 */
export function repartoPorTipo(n) {
  const tipos = Object.keys(MEZCLA);
  const total = Object.values(MEZCLA).reduce((a, b) => a + b, 0);
  const objetivo = {};
  let asignado = 0;
  for (const tipo of tipos) {
    objetivo[tipo] = Math.round((MEZCLA[tipo] / total) * n);
    asignado += objetivo[tipo];
  }

  let diferencia = n - asignado;
  const ordenPeso = [...tipos].sort((a, b) => MEZCLA[b] - MEZCLA[a]);
  let i = 0;
  while (diferencia !== 0 && ordenPeso.length > 0) {
    const tipo = ordenPeso[i % ordenPeso.length];
    if (diferencia > 0) {
      objetivo[tipo] += 1;
      diferencia -= 1;
    } else if (objetivo[tipo] > 0) {
      objetivo[tipo] -= 1;
      diferencia += 1;
    }
    i++;
  }

  // Al menos 1 test4 si n >= 2 (variedad mínima en tandas pequeñas del átomo, ronda 1 del
  // controlador): se resta 1 al tipo con más preguntas asignadas para no alterar la suma total.
  if (n >= 2 && objetivo.test4 === 0) {
    const donante = tipos.filter((t) => t !== 'test4' && objetivo[t] > 0).sort((a, b) => objetivo[b] - objetivo[a])[0];
    if (donante) {
      objetivo[donante] -= 1;
      objetivo.test4 += 1;
    }
  }

  return objetivo;
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

// Mismo esquema por tipo que esquemaTipo() en tools/generar-preguntas.js (duplicado a propósito:
// esa CLI no lo exporta). El caso "vf" no se usa en la práctica (promptUsuarioPorTipo, más abajo,
// da a "vf" un prompt más preciso con el reparto 50/50 ya calculado); se deja aquí solo por
// fidelidad con la CLI.
function esquemaTipo(tipo, numHilos) {
  const hilo = `, "hilo": 1..${numHilos} (número del hilo de la lista de arriba en el que encaja)`;
  switch (tipo) {
    case 'vf':
      return (
        `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "respuesta": true|false${hilo} }. ` +
        'OBLIGATORIO: exactamente la mitad de las afirmaciones con "respuesta": false. Las falsas deben ser ' +
        'plausibles (un dato, fecha, autor o relación cambiados por otro verosímil), nunca absurdas ni obvias.'
      );
    case 'test4':
      return `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "opciones": ["s","s","s","s"], "correcta": 0..3${hilo} }`;
    case 'ordenar':
      return `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "criterio": "de menor a mayor …", "items": ["s","s","s","s"]${hilo} }`;
    case 'error':
      return `{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "tarjeta": { "titulo": "s", "filas": [{"etiqueta":"s","valor":"s"}, …3..5] }, "sospechoso": índice${hilo} }`;
    default:
      return '';
  }
}

// Igual que promptUsuario(area, tipo, cantidad) en tools/generar-preguntas.js, para los 3 tipos
// que no son "vf" (ese sí tiene su propio prompt más preciso, ver promptUsuarioVF).
function promptUsuarioGenerico(area, tipo, cantidad, numHilos) {
  return (
    `Área: ${area}. Tipo de pregunta: ${tipo}. Genera ${cantidad} preguntas nuevas, ` +
    `repartidas entre los niveles 1 a 5 (una o dos por nivel). Responde con un objeto ` +
    `JSON {"preguntas": [ ... ]} donde cada elemento del array "preguntas" tiene ` +
    `exactamente este esquema:\n${esquemaTipo(tipo, numHilos)}\n` +
    `Ejemplo válido de un elemento (no lo repitas, es solo formato):\n${JSON.stringify(EJEMPLOS[tipo])}`
  );
}

function promptUsuarioPorTipo(area, tipo, cantidad, numHilos) {
  if (tipo === 'vf') {
    const mitad = Math.floor(cantidad / 2);
    const resto = cantidad - mitad;
    return promptUsuarioVF(cantidad, mitad, resto, numHilos);
  }
  return promptUsuarioGenerico(area, tipo, cantidad, numHilos);
}

/**
 * Genera `n` borradores de un tipo dado (por defecto "vf", verdadero/falso con reparto 50/50) para
 * un área, opcionalmente centrados en una ruta del átomo y evitando enunciados recientes. Una
 * función pura: no valida, no verifica y no toca disco -- solo llama al generador y da forma al
 * borrador (id, area, tipo, generador, confianza:null, verificado:false).
 * @param {object} params
 * @param {string} params.area una de validar-banco.js#AREAS
 * @param {string[]} [params.ruta] ruta del átomo (ver promptSistemaGenerador)
 * @param {number} [params.n] cuántos borradores pedir (por defecto 10)
 * @param {'vf'|'test4'|'ordenar'|'error'} [params.tipo] por defecto 'vf'
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
  const { area, ruta = [], n = 10, tipo = 'vf', nivelObjetivo, evitar = [] } = params || {};
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
  if (!TIPOS.includes(tipo)) {
    throw new Error(`generarBorradores: tipo desconocido: ${tipo}`);
  }
  if (n <= 0) return [];

  const numHilos = (HILOS_POR_AREA[area] || []).length || 1;
  const sistema = promptSistemaGenerador(area, { ruta, nivelObjetivo, evitar });
  const modelosFiltrados = filtrarPorPago(modelos, permitirPago);

  // Ronda 2 (controlador, 14-sep-2026): cada lote se intenta con su propio try/catch, igual que ya
  // hace verificarBorradores con los suyos -- si un lote falla (cascada agotada, red...) no se
  // pierden los borradores que YA se consiguieron en lotes anteriores de esta misma llamada. Solo
  // si TODOS los lotes de esta llamada fallan (borradores.length sigue en 0 al terminar) se
  // propaga el último error: eso es "la cascada se agota en este tipo", y producirTanda lo
  // convierte en una entrada de `fallos` en vez de abortar la tanda entera.
  const borradores = [];
  let ultimoError = null;
  for (const tamanoLote of repartirEnSublotes(n, TAMANO_LOTE_GENERACION)) {
    const mensajes = [
      { role: 'system', content: sistema },
      { role: 'user', content: promptUsuarioPorTipo(area, tipo, tamanoLote, numHilos) },
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
      ultimoError = err;
      continue;
    }
    if (acumulador) acumulador.coste += salida.coste || 0;

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch (err) {
      ultimoError = err;
      continue;
    }
    const lista = Array.isArray(datos) ? datos : datos.preguntas || [];

    for (const bruto of lista) {
      borradores.push({
        ...bruto,
        id: generarIdServidor(prefijo),
        area,
        tipo,
        generador: salida.modelo,
        confianza: null,
        verificado: false,
      });
    }
  }

  if (borradores.length === 0 && ultimoError) {
    throw ultimoError;
  }

  return borradores;
}

// Igual que promptUsuario(lote) en tools/verificar-preguntas.js: cada tipo lleva al verificador
// solo los campos que le hacen falta para juzgarlo (duplicado a propósito, esa CLI no lo exporta).
function promptUsuarioVerificador(lote) {
  const resumen = lote.map((p) => {
    const base = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion };
    if (p.tipo === 'vf') base.respuesta = p.respuesta;
    if (p.tipo === 'test4') {
      base.opciones = p.opciones;
      base.correcta = p.correcta;
    }
    if (p.tipo === 'ordenar') {
      base.criterio = p.criterio;
      base.items = p.items;
    }
    if (p.tipo === 'error') {
      base.tarjeta = p.tarjeta;
      base.sospechoso = p.sospechoso;
    }
    return base;
  });
  return `Verifica estas ${lote.length} preguntas:\n${JSON.stringify(resumen)}`;
}

/**
 * Verifica una lista de borradores (de cualquiera de los 4 tipos, pueden venir mezclados en el
 * mismo lote, igual que la CLI mezcla áreas) con un modelo DISTINTO del que generó cada lote (lotes
 * de 4, `excluirModelo` = borrador.generador). Una sola llamada por lote que devuelve
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
  // A9: agrupar por generador ANTES de partir en lotes de 4 -- ver agruparPorGenerador más arriba.
  const lotes = agruparPorGenerador(borradores).flatMap((grupo) => partirEnLotes(grupo, TAMANO_LOTE_VERIFICACION));

  for (const lote of lotes) {
    if (lote.length === 0) continue;

    // excluirModelo = el generador del lote (spec §3.4.2). Si el lote mezclara generadores
    // distintos (posible si un sub-lote de generarBorradores cayó a otro modelo de la cascada, o
    // si dos tipos distintos usaron modelos distintos), se usa el del primer borrador -- caso raro
    // y sin mejor heurística sin complicar el contrato.
    const excluirModelo = lote[0]?.generador || null;
    let candidatos = excluirModelo ? modelos.filter((m) => m !== excluirModelo) : modelos.slice();

    // Ronda final (revisión, 14-sep-2026) -- Adversarial (A1), regla fija de Carlos: "el
    // verificador NUNCA es el generador". La primera versión, si excluir al generador dejaba la
    // cascada vacía, revertía a la cascada COMPLETA -- lo que podía devolver a incluir al propio
    // generador, justo lo que esta regla prohíbe (nunca debía haberse aceptado así). Ahora: con
    // `permitirPago`, se usa el par dedicado de pago barato (VERIFICADOR_PREGUNTAS_SOLO_PAGO, de
    // un proveedor distinto por diseño del generador de pago barato -- ver comentario de la
    // constante más arriba); sin `permitirPago`, no hay ningún verificador legítimo que probar y el
    // lote se rechaza entero, sin llamar a nadie.
    if (candidatos.length === 0) {
      candidatos = permitirPago ? VERIFICADOR_PREGUNTAS_SOLO_PAGO.filter((m) => m !== excluirModelo) : [];
      if (candidatos.length === 0) {
        for (const b of lote) {
          resultados.push({ id: b.id, ok: false, nivel: null, motivo: 'sin verificador distinto del generador', modelo: null });
        }
        continue;
      }
    }
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
      // Ronda final (revisión, 14-sep-2026) -- Adversarial (A2): `cumpleUtilidad !== false` dejaba
      // pasar un campo AUSENTE (undefined !== false -- true) igual que un `false` explícito del
      // verificador debía rechazar -- inconsistente con los otros tres booleanos, que sí exigen
      // `=== true`. Un verificador que no responde ese campo no ha confirmado nada: se trata igual
      // que si hubiera dicho que no.
      const ok =
        r.correcta === true &&
        r.unica === true &&
        r.inequivoca === true &&
        r.cumpleUtilidad === true &&
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
 * Pipeline completo de una tanda: reparte `n` entre los 4 tipos (repartoPorTipo, misma proporción
 * que MEZCLA de motor.js) → genera cada tipo con generarBorradores → junta todo → verifica →
 * validarPregunta → resolverPregunta (spec §3.4). La verificación nunca se salta: nada llega a
 * `aprobadas` sin pasar por las tres.
 * @param {object} params
 * @param {string} params.area
 * @param {string[]} [params.ruta]
 * @param {number} [params.n] por defecto 10
 * @param {number} [params.nivelObjetivo]
 * @param {string[]} [params.evitar]
 * @param {object} [opciones]
 * @param {Function} [opciones.llamar]
 * @param {boolean} [opciones.permitirPago]
 * @param {number} [opciones.topeEur]
 * @param {string} [opciones.rutaLog]
 * @param {boolean} [opciones.urgente] con permitirPago, antepone las cascadas de pago barato
 *   (GENERADOR_PREGUNTAS_SOLO_PAGO/VERIFICADOR_PREGUNTAS_SOLO_PAGO y, para el visual,
 *   GENERADOR_SOLO_PAGO/VERIFICADOR_SOLO_PAGO de tools/visualizar.js) a las normales -- Ronda final
 *   (revisión, 14-sep-2026) -- Important (I2): antes las SUSTITUÍA, así que si el único modelo de
 *   pago barato de ese papel fallaba (agotado, red...), la tanda urgente se quedaba sin ningún
 *   modelo más que probar aunque `permitirPago` siguiera activo y la cascada normal (gratis + pago)
 *   tuviera más candidatos detrás. Ahora la cascada efectiva es `[...pago barato, ...normal]`: se
 *   sigue intentando primero lo rápido/barato pensado para "el jugador está esperando", pero nunca
 *   se pierde el resto de la cascada normal como red de seguridad.
 * @returns {Promise<{
 *   aprobadas: object[], rechazadas: {borrador: object, motivo: string}[], coste: number,
 *   modelos: string[], fallos: {tipo: string, motivo: string}[], pedidas: number, obtenidas: number,
 * }>} `fallos` lleva un elemento por tipo cuya generación agotó del todo su cascada (ver
 *   generarBorradores); `pedidas` es el `n` pedido y `obtenidas` los borradores que sí se
 *   generaron (antes de verificar/validar) -- así la cola (Task 2) puede marcar el trabajo
 *   "parcial" u homogéneo sin tener que adivinarlo a partir de `aprobadas`.
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
  const fallos = [];

  const reparto = repartoPorTipo(n);
  let borradores = [];
  for (const tipo of Object.keys(reparto)) {
    const cantidad = reparto[tipo];
    if (cantidad <= 0) continue;
    // Ronda 2 (controlador, 14-sep-2026): si la cascada se agota del todo para ESTE tipo
    // (generarBorradores lanza, ver ahí el porqué), se registra en `fallos` y se sigue con los
    // demás tipos -- una tanda parcial es mejor que ninguna, y el coste ya acumulado en otros tipos
    // no se pierde (el `acumulador` es el mismo objeto para todas las llamadas).
    try {
      const borradoresTipo = await generarBorradores(
        { area, ruta, n: cantidad, tipo, nivelObjetivo, evitar },
        {
          llamar: llamarFn,
          permitirPago,
          topeEur,
          rutaLog,
          acumulador,
          ...(usaPagoBarato ? { modelos: [...GENERADOR_PREGUNTAS_SOLO_PAGO, ...MODELOS.generador] } : {}),
        },
      );
      borradores = borradores.concat(borradoresTipo);
    } catch (err) {
      fallos.push({ tipo, motivo: err.message });
    }
  }
  const obtenidas = borradores.length;
  for (const b of borradores) {
    if (b.generador) modelosUsados.add(b.generador);
  }

  // Se verifica la lista COMBINADA de los 4 tipos: los lotes de 4 pueden mezclar tipos, igual que
  // la CLI mezcla áreas dentro de un mismo lote de verificación.
  const veredictos = await verificarBorradores(borradores, {
    llamar: llamarFn,
    permitirPago,
    topeEur,
    rutaLog,
    acumulador,
    ...(usaPagoBarato ? { modelos: [...VERIFICADOR_PREGUNTAS_SOLO_PAGO, ...MODELOS.verificador] } : {}),
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
        ...(usaPagoBarato
          ? {
              modelosGenerador: [...GENERADOR_SOLO_PAGO, ...GENERADOR_VISUAL],
              modelosVerificador: [...VERIFICADOR_SOLO_PAGO, ...VERIFICADOR_VISUAL],
            }
          : {}),
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
    fallos,
    pedidas: n,
    obtenidas,
  };
}
