// CLI: puntúa la utilidad educativa (1-5) de cada pregunta del banco ya verificado, según el
// criterio de Carlos en tools/criterio.js, y detecta duplicados evidentes dentro de cada área.
// Escribe datos/utilidad.json (puntuaciones) y datos/utilidad.log (progreso por lote).
// Con --aplicar mueve a datos/rechazadas.json las de utilidad < 3 y los duplicados (se queda
// con el id más bajo de cada grupo), con el motivo correspondiente.
// Uso: node tools/filtrar-utilidad.js [--lote 20] [--aplicar] [--permitir-pago --tope-eur N]
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { llamar, extraerJson } from './openrouter.js';
import { textoCriterio } from './criterio.js';
import { AREAS } from './validar-banco.js';

const RUTA_BANCO = 'datos/banco.json';
const RUTA_RECHAZADAS = 'datos/rechazadas.json';
const RUTA_UTILIDAD = 'datos/utilidad.json';
const RUTA_LOG = 'datos/utilidad.log';

// Cascada pedida por Carlos (12-sep): gratis primero, de pago barato solo como caída con
// --permitir-pago --tope-eur. Mismo mecanismo de openrouter.js: prueba en orden, con timeout
// y reintento en el siguiente modelo (ver tools/openrouter.js, función llamar).
const MODELOS_UTILIDAD = [
  'nex-agi/nex-n2.5-pro:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'z-ai/glm-4.7-flash',
  'openai/gpt-5-mini',
];

const UMBRAL_APROBACION = 3; // utilidad < 3 se rechaza
const UMBRAL_DUPLICADO = 0.55;

function parsearArgs(argv) {
  const args = { lote: 20, aplicar: false, permitirPago: false, topeEur: 0, ayuda: false, umbral: UMBRAL_APROBACION, reutilizar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--lote') args.lote = Number(argv[++i]);
    else if (a === '--aplicar') args.aplicar = true;
    else if (a === '--umbral') args.umbral = Number(argv[++i]); // se rechaza utilidad < umbral
    else if (a === '--reutilizar') args.reutilizar = true; // no repuntúa las ya presentes en datos/utilidad.json
    else if (a === '--permitir-pago') args.permitirPago = true;
    else if (a === '--tope-eur') args.topeEur = Number(argv[++i]);
  }
  return args;
}

function imprimirAyuda() {
  console.log(`Uso: node tools/filtrar-utilidad.js [--lote 20] [--aplicar] [--permitir-pago --tope-eur N]

Puntúa de 1 a 5 la utilidad educativa de cada pregunta de datos/banco.json (por lotes y por
área, con el criterio de tools/criterio.js) y detecta duplicados evidentes dentro de cada área.
Escribe datos/utilidad.json y datos/utilidad.log. Sin --aplicar es de solo lectura.

Opciones:
  --lote <n>          Preguntas por lote dentro de cada área (por defecto 20).
  --aplicar           Mueve a datos/rechazadas.json las de utilidad < 3 y los duplicados.
  --permitir-pago     Permite usar modelos de pago de la cascada si todos los gratis fallan.
  --tope-eur <n>      Tope de gasto ACUMULADO HOY en euros (solo con --permitir-pago).
  --ayuda             Muestra esta ayuda y sale.
`);
}

async function registrarLog(linea) {
  console.log(linea);
  await appendFile(RUTA_LOG, `${linea}\n`, 'utf8');
}

// --- Puntuación de utilidad -------------------------------------------------

function promptSistema(area) {
  return (
    `${textoCriterio(area)}\n\n` +
    'Eres un evaluador estricto de la utilidad educativa de estas preguntas de trivia, según ' +
    'las reglas de arriba (PARA_QUIEN y REGLAS_UTILIDAD). Puntúa cada pregunta de 1 a 5 en ' +
    '"utilidad":\n' +
    '1 = inútil o cae en algo PROHIBIDO por las reglas (trivia de especialista, sigla, puerto, ' +
    'versión, fecha suelta sin causa/consecuencia, récord sin mecanismo, definición de diccionario...).\n' +
    '2 = poco útil: correcta pero no enseña nada memorable ni da una referencia de conversación.\n' +
    '3 = aceptable: se aprende algo, pero es mejorable (explicación floja, sin conexión con nada actual).\n' +
    '4 = útil: enseña un mecanismo o da una referencia real de conversación, con una buena explicación del porqué.\n' +
    '5 = muy útil: además conecta con un hecho, debate o noticia reciente (2022-2026) sin depender ' +
    'de él para seguir siendo válida.\n' +
    'Juzga por el ENUNCIADO y la EXPLICACIÓN (no si la respuesta es correcta, eso ya se verificó antes). ' +
    'Sé estricto: ante la duda entre dos puntuaciones, la más baja. Devuelve SOLO JSON con la forma ' +
    '{"resultados":[{"id":"…","utilidad":1-5,"motivo":"…"}]}, motivo en una frase corta.'
  );
}

// Mismo resumen que auditar-banco.js: solo lo que hace falta para juzgar, sin arrastrar
// el resto de metadatos (generador, confianza...).
function resumir(p) {
  const base = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion };
  if (p.tipo === 'vf') base.respuesta = p.respuesta;
  if (p.tipo === 'test4') Object.assign(base, { opciones: p.opciones, correcta: p.correcta });
  if (p.tipo === 'ordenar') Object.assign(base, { criterio: p.criterio, items: p.items });
  if (p.tipo === 'error') Object.assign(base, { tarjeta: p.tarjeta, sospechoso: p.sospechoso });
  return base;
}

function partirEnLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

async function puntuarArea(area, preguntas, opts) {
  const lotes = partirEnLotes(preguntas, opts.lote);
  const resultados = [];
  for (let i = 0; i < lotes.length; i++) {
    const lote = lotes[i];
    const numero = i + 1;
    let salida;
    try {
      salida = await llamar({
        modelos: MODELOS_UTILIDAD,
        mensajes: [
          { role: 'system', content: promptSistema(area) },
          { role: 'user', content: `Puntúa la utilidad de estas ${lote.length} preguntas:\n${JSON.stringify(lote.map(resumir))}` },
        ],
        json: true,
        temperatura: 0.2,
        maxTokens: 6000,
        permitirPago: opts.permitirPago,
        topeEur: opts.topeEur,
      });
    } catch (err) {
      await registrarLog(`${area} lote ${numero}/${lotes.length}: FALLO — ${err.message}`);
      continue;
    }

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch (err) {
      await registrarLog(`${area} lote ${numero}/${lotes.length}: JSON inválido (${salida.modelo}) — ${err.message}`);
      continue;
    }

    const crudos = Array.isArray(datos) ? datos : datos.resultados || [];
    // "Ignora resultados sin utilidad numérica (no los cuentes como problema)": ni entran en
    // datos/utilidad.json ni cuentan como baja utilidad, simplemente se descartan en silencio.
    let ignorados = 0;
    let bajasLote = 0;
    for (const r of crudos) {
      const utilidad = Number(r.utilidad);
      if (!Number.isInteger(utilidad) || utilidad < 1 || utilidad > 5) {
        ignorados++;
        continue;
      }
      if (utilidad < UMBRAL_APROBACION) bajasLote++;
      resultados.push({ id: r.id, area, utilidad, motivo: r.motivo || '', modelo: salida.modelo });
    }

    await registrarLog(
      `${area} lote ${numero}/${lotes.length}: ${crudos.length} juzgadas` +
        (ignorados > 0 ? ` (${ignorados} ignoradas sin utilidad numérica)` : '') +
        `, ${bajasLote} con utilidad < ${UMBRAL_APROBACION} (${salida.modelo})`
    );
  }
  return resultados;
}

// --- Duplicados evidentes ---------------------------------------------------
// Heurística local (sin llamada a modelo): compara el contenido que de verdad distingue cada
// pregunta -- no el enunciado a secas, que en "ordenar" y "error" suele ser una plantilla
// genérica ("Ordena los siguientes...", "Encuentra el dato erróneo en la tarjeta.") que
// comparten preguntas totalmente distintas. Calibrada a mano contra los ejemplos del encargo
// (tec-009/013, tec-007/012, art-021/025/054, cie-021/054, log-017/021, log-019/023: los 7
// detectados) y contra pares que NO debían salir por compartir solo la plantilla o el mismo
// pool cerrado de opciones (cie-063/064/065/066, his-030..033, eco-030/031/033, tec-027/028/029,
// log-012/016, geo-005/034/038: ninguno detectado).
const STOPWORDS = new Set([
  'que', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'a',
  'al', 'su', 'sus', 'se', 'es', 'son', 'para', 'por', 'con', 'mas', 'segun', 'le', 'les', 'lo',
  'entre', 'sobre', 'como', 'tarjeta', 'encuentra', 'dato', 'erroneo', 'siguientes', 'ordena',
  'si', 'puede', 'pueden', 'concluir', 'necesariamente', 'cual', 'cuales', 'estos', 'estas',
  'este', 'esta', 'que', 'cada', 'tras', 'sin', 'bajo', 'desde', 'hacia', 'hasta',
]);
const RANGO_ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizarTokens(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(RANGO_ACENTOS, '')
    .replace(/[¿?¡!.,;:()"'«»]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, 5) : w));
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Contenido que realmente distingue una pregunta de otra del mismo tipo, ignorando la
// plantilla del enunciado cuando no aporta nada (ordenar, error).
function contenidoComparable(p) {
  switch (p.tipo) {
    case 'vf':
    case 'test4':
      return p.enunciado || '';
    case 'ordenar':
      return `${p.criterio || ''} ${(p.items || []).join(' ')}`;
    case 'error':
      return `${p.tarjeta?.titulo || ''} ${(p.tarjeta?.filas || []).map((f) => `${f.etiqueta} ${f.valor}`).join(' ')}`;
    default:
      return p.enunciado || '';
  }
}

function esDuplicado(a, b) {
  if (a.area !== b.area || a.tipo !== b.tipo) return false;
  const tokA = normalizarTokens(contenidoComparable(a));
  const tokB = normalizarTokens(contenidoComparable(b));
  return jaccard(tokA, tokB) >= UMBRAL_DUPLICADO;
}

// Devuelve Map<id, {repId, sim}> con los ids a rechazar como duplicados (todos menos el de id
// más bajo de cada grupo conectado).
function detectarDuplicados(banco) {
  const porAreaTipo = new Map();
  for (const p of banco) {
    const clave = `${p.area}::${p.tipo}`;
    if (!porAreaTipo.has(clave)) porAreaTipo.set(clave, []);
    porAreaTipo.get(clave).push(p);
  }

  // Union-Find simple sobre los ids del grupo.
  const padre = new Map();
  const buscar = (id) => {
    if (!padre.has(id)) padre.set(id, id);
    let r = id;
    while (padre.get(r) !== r) r = padre.get(r);
    padre.set(id, r);
    return r;
  };
  const unir = (a, b) => {
    const ra = buscar(a);
    const rb = buscar(b);
    if (ra !== rb) padre.set(ra, rb);
  };

  for (const lista of porAreaTipo.values()) {
    lista.sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < lista.length; i++) {
      buscar(lista[i].id);
      for (let j = i + 1; j < lista.length; j++) {
        if (esDuplicado(lista[i], lista[j])) unir(lista[i].id, lista[j].id);
      }
    }
  }

  // Agrupa por raíz y, dentro de cada grupo de tamaño > 1, se queda con el id más bajo.
  const grupos = new Map();
  for (const id of padre.keys()) {
    const raiz = buscar(id);
    if (!grupos.has(raiz)) grupos.set(raiz, []);
    grupos.get(raiz).push(id);
  }

  const porId = new Map(banco.map((p) => [p.id, p]));
  const rechazar = new Map();
  for (const miembros of grupos.values()) {
    if (miembros.length < 2) continue;
    miembros.sort();
    const [mantenido, ...resto] = miembros;
    for (const id of resto) {
      const enun = porId.get(id)?.enunciado || '';
      rechazar.set(id, `duplicado de ${mantenido}: "${enun}"`);
    }
  }
  return rechazar;
}

// --- Informe de distribución -------------------------------------------------

function imprimirDistribucion(resultados) {
  const porArea = new Map();
  for (const r of resultados) {
    if (!porArea.has(r.area)) porArea.set(r.area, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    porArea.get(r.area)[r.utilidad]++;
  }
  console.log('\nDistribución de utilidad por área (1-5):');
  for (const area of AREAS) {
    const d = porArea.get(area) || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    console.log(`  ${area}: 1=${d[1]} 2=${d[2]} 3=${d[3]} 4=${d[4]} 5=${d[5]}`);
  }
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    process.exit(0);
    return;
  }

  const banco = JSON.parse(await readFile(RUTA_BANCO, 'utf8'));
  const porArea = new Map();
  for (const p of banco) {
    if (!porArea.has(p.area)) porArea.set(p.area, []);
    porArea.get(p.area).push(p);
  }

  await registrarLog(`\n=== filtrar-utilidad ${new Date().toISOString()} — banco: ${banco.length} preguntas, lote ${args.lote} ===`);

  // --reutilizar: conserva las puntuaciones ya hechas (datos/utilidad.json) y solo puntúa las
  // preguntas nuevas del banco; así una regeneración no obliga a repasar las 300 anteriores.
  const previas = new Map();
  if (args.reutilizar) {
    const viejas = JSON.parse(await readFile(RUTA_UTILIDAD, 'utf8').catch(() => '[]'));
    for (const r of viejas) if (typeof r.utilidad === 'number') previas.set(r.id, r);
  }
  const resultados = [];
  for (const area of AREAS) {
    const todas = porArea.get(area) || [];
    for (const p of todas) if (previas.has(p.id)) resultados.push(previas.get(p.id));
    const preguntas = todas.filter((p) => !previas.has(p.id));
    if (preguntas.length === 0) continue;
    const r = await puntuarArea(area, preguntas, args);
    resultados.push(...r);
  }

  await writeFile(RUTA_UTILIDAD, JSON.stringify(resultados, null, 2), 'utf8');
  imprimirDistribucion(resultados);

  const duplicados = detectarDuplicados(banco);
  console.log(`\nDuplicados evidentes detectados: ${duplicados.size}`);
  for (const [id, motivo] of duplicados) console.log(`  ${id}: ${motivo}`);

  const bajaUtilidad = new Map(
    resultados.filter((r) => r.utilidad < args.umbral).map((r) => [r.id, `utilidad ${r.utilidad}/5: ${r.motivo}`])
  );

  console.log(`\nBaja utilidad (< ${args.umbral}): ${bajaUtilidad.size}`);
  console.log(`Total a quitar si se aplica: ${new Set([...duplicados.keys(), ...bajaUtilidad.keys()]).size}`);

  if (!args.aplicar) {
    console.log('\n(sin --aplicar: no se ha tocado datos/banco.json ni datos/rechazadas.json)');
    return;
  }

  const rechazadasPrevias = JSON.parse(await readFile(RUTA_RECHAZADAS, 'utf8').catch(() => '[]'));
  const quitar = new Map();
  for (const [id, motivo] of duplicados) quitar.set(id, motivo); // duplicados tienen prioridad en el motivo mostrado
  for (const [id, motivo] of bajaUtilidad) if (!quitar.has(id)) quitar.set(id, motivo);

  const quedan = banco.filter((p) => !quitar.has(p.id));
  const nuevasRechazadas = banco
    .filter((p) => quitar.has(p.id))
    .map((p) => ({ ...p, motivo: quitar.get(p.id) }));

  await writeFile(RUTA_BANCO, JSON.stringify(quedan, null, 2), 'utf8');
  await writeFile(RUTA_RECHAZADAS, JSON.stringify([...rechazadasPrevias, ...nuevasRechazadas], null, 2), 'utf8');

  await registrarLog(
    `Aplicado: banco ${banco.length} → ${quedan.length} (duplicados ${duplicados.size}, baja utilidad ${bajaUtilidad.size}, ` +
      `solapadas ${duplicados.size + bajaUtilidad.size - quitar.size}); rechazadas +${nuevasRechazadas.length}.`
  );
}

const esCLI = process.argv[1] && process.argv[1].endsWith('filtrar-utilidad.js');
if (esCLI) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { detectarDuplicados, contenidoComparable, normalizarTokens, jaccard };
