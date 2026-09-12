// CLI: busca en Wikimedia Commons una imagen libre para las preguntas del banco donde una
// imagen aporte (arte: la obra; geografía: mapa o foto; historia: persona/lugar/documento;
// ciencia: fenómeno visible...), y escribe datos/imagenes.json con los datos de atribución.
//
// Tres pasos:
//   A) modelo gratis, por lotes de 20: decide si la pregunta se beneficia de una imagen y,
//      si es así, propone 1-2 términos de búsqueda en inglés + una leyenda corta en español.
//   B) sin modelo, API pública de Commons (sin clave): busca cada término, filtra por
//      licencia libre, tamaño y tipo de fichero, y se queda con el primer resultado válido.
//   C) modelo gratis, por lotes: comprueba que la imagen encontrada es realmente relevante
//      para el enunciado (descarta coincidencias de título engañosas).
//
// Solo modelos ':free' (nunca --permitir-pago: esta tarea es solo de datos, sin presupuesto
// aprobado para pago). Nunca lee ni imprime OPENROUTER_API_KEY.
//
// Uso: node tools/buscar-imagenes.js [--area X] [--solo-pendientes] [--limite N] [--aplicar]
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { llamar, extraerJson } from './openrouter.js';
import { PARA_QUIEN } from './criterio.js';
import { AREAS } from './validar-banco.js';

const RUTA_BANCO = 'datos/banco.json';
const RUTA_IMAGENES = 'datos/imagenes.json';
const RUTA_LOG = 'datos/imagenes.log';

const TAMANO_LOTE = 20;

// Cascada de solo modelos ':free' ya usados y probados en este repo (tools/openrouter.js,
// MODELOS.generador/verificador, y tools/filtrar-utilidad.js). Se reutiliza aquí sin arrastrar
// las colas de pago de esos ficheros: esta tarea nunca pasa --permitir-pago.
const MODELOS_IMAGENES = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nex-agi/nex-n2.5-pro:free',
  'google/gemma-4-31b-it:free',
];

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia exige un User-Agent identificable (https://meta.wikimedia.org/wiki/User-Agent_policy).
const USER_AGENT = 'ONE-app/0.1 (aprendizaje personal; contacto via GitHub)';
// 250ms basta como cortesía en llamadas sueltas, pero en el barrido completo del banco (12-sep,
// ~99 preguntas x hasta 2 términos) la API de búsqueda anónima de Commons empezó a devolver 429
// a partir de cierto volumen y no se recuperaba con el backoff corto -- se sube el suelo y el
// backoff en el reintento.
const PAUSA_COMMONS_MS = 500;
const REINTENTOS_COMMONS = 4;
const COMMONS_TIMEOUT_MS = 15000;
const ANCHO_MINIMO = 600;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsearArgs(argv) {
  const args = { area: null, soloPendientes: false, limite: 0, aplicar: false, ayuda: false, revalidar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--area') args.area = argv[++i];
    else if (a === '--solo-pendientes') args.soloPendientes = true;
    else if (a === '--limite') args.limite = Number(argv[++i]);
    else if (a === '--aplicar') args.aplicar = true;
    else if (a === '--revalidar') args.revalidar = true;
  }
  return args;
}

function imprimirAyuda() {
  console.log(`Uso: node tools/buscar-imagenes.js [--area X] [--solo-pendientes] [--limite N] [--aplicar]
       node tools/buscar-imagenes.js --revalidar [--aplicar]

Busca en Wikimedia Commons una imagen libre para las preguntas de datos/banco.json donde una
imagen aporte de verdad (ilustra el mecanismo, la obra, el lugar o la persona de la pregunta,
nunca como decoración). Escribe datos/imagenes.json (solo con --aplicar) y datos/imagenes.log.
Solo usa modelos ':free' de OpenRouter; la búsqueda en Commons no requiere clave.

Opciones:
  --area <area>       Solo esta área (economia, historia, ciencia, tecnologia, geografia,
                       filosofia, arte, logica).
  --solo-pendientes   Salta las preguntas que ya tienen entrada en datos/imagenes.json.
  --limite <n>        Procesa como mucho N preguntas (tras aplicar --area/--solo-pendientes).
  --aplicar           Escribe datos/imagenes.json y datos/imagenes.log. Sin esto, solo informa.
  --revalidar         Re-comprueba la relevancia (paso C) de las imágenes YA guardadas en
                       datos/imagenes.json, sin repetir la búsqueda en Commons ni el paso A.
                       Útil tras mejorar el prompt del paso C (p. ej. contra homónimos). Quita
                       del fichero las que ya no pasen la comprobación.
  --ayuda             Muestra esta ayuda y sale.
`);
}

// --- Paso A: ¿aporta imagen? + términos de búsqueda -------------------------------------

function promptSistemaPasoA() {
  return (
    `${PARA_QUIEN}\n\n` +
    'Decides si a cada pregunta de un quiz le conviene una imagen de apoyo en la tarjeta de ' +
    'respuesta. Criterio: la imagen vale si ilustra el MECANISMO, la OBRA, el LUGAR o la PERSONA ' +
    'concretos de la pregunta -- nunca como mera decoración.\n' +
    'Por defecto "aporta": false en preguntas abstractas (definiciones, lógica formal, economía ' +
    'conceptual, ideas sin objeto físico) salvo que haya un gráfico o lugar concreto que mostrar. ' +
    'Suele ser "aporta": true en arte (mostrar la obra), geografía (mapa o foto del lugar), ' +
    'historia (persona, lugar o documento concreto) y ciencia (fenómeno visible, instrumento, ' +
    'imagen real). Ante la duda, false.\n' +
    'IMPORTANTE en test4/ordenar/error: la imagen debe ilustrar la RESPUESTA CORRECTA ("correcta" ' +
    'en test4, el orden de "items" en ordenar, el dato correcto -no el "sospechoso"- en error), ' +
    'nunca una de las opciones incorrectas ni otra obra/lugar/persona del mismo autor o tema.\n' +
    'Si aporta es true, propón 1 o 2 "terminos" de búsqueda para Wikimedia Commons EN INGLÉS ' +
    '(los títulos de Commons suelen estar en inglés), específicos y sin ambigüedad -- ejemplo ' +
    'bueno: "Starry Night Van Gogh painting"; ejemplo malo: "art" o "painting". Para una PERSONA, ' +
    'añade siempre su profesión/campo y época o nacionalidad para evitar homónimos (ejemplo bueno: ' +
    '"Aristotle ancient Greek philosopher bust"; ejemplo malo: "Aristotle portrait", que en Commons ' +
    'puede devolver a otra persona con un nombre parecido). Añade una "leyenda" corta en ESPAÑOL ' +
    '(máximo 60 caracteres) para el pie de la imagen.\n' +
    'Devuelve SOLO JSON con la forma {"resultados":[{"id":"…","aporta":true|false,' +
    '"terminos":["…"],"leyenda":"…"}]}. Si aporta es false, omite terminos y leyenda.'
  );
}

// Igual que resumir() en filtrar-utilidad.js: hace falta el contenido específico del tipo
// (opciones/correcta, items, tarjeta), no solo el enunciado -- si no, el modelo no sabe CUÁL es
// el concepto exacto a ilustrar (visto en pruebas reales: sin "correcta", una pregunta de test4
// sobre "cuál obra es de Leonardo" (respuesta: La última cena) propuso buscar "Mona Lisa").
function resumirParaPasoA(p) {
  const base = { id: p.id, area: p.area, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion };
  if (p.tipo === 'vf') base.respuesta = p.respuesta;
  if (p.tipo === 'test4') Object.assign(base, { opciones: p.opciones, correcta: p.correcta });
  if (p.tipo === 'ordenar') Object.assign(base, { criterio: p.criterio, items: p.items });
  if (p.tipo === 'error') Object.assign(base, { tarjeta: p.tarjeta, sospechoso: p.sospechoso });
  return base;
}

// Texto corto de "cuál es el concepto correcto" por tipo, para que el paso A sepa qué buscar
// de verdad y el paso C pueda comprobar la imagen contra ESE concepto, no solo contra el
// enunciado general (que en test4/error/ordenar no dice por sí solo cuál es la respuesta).
function conceptoCorrecto(p) {
  if (p.tipo === 'vf') return p.respuesta ? 'Verdadero' : 'Falso';
  if (p.tipo === 'test4') return p.opciones?.[p.correcta] ?? '';
  if (p.tipo === 'ordenar') return `orden correcto (${p.criterio}): ${(p.items || []).join(' → ')}`;
  if (p.tipo === 'error') {
    const fila = p.tarjeta?.filas?.[p.sospechoso];
    return fila ? `dato erróneo: "${fila.etiqueta}: ${fila.valor}"` : '';
  }
  return '';
}

function partirEnLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

// Reintentos dentro del propio paso: un modelo gratis puede devolver JSON válido pero vacío
// ({"resultados":[]}) sin que sea un error de red ni de parseo (visto en pruebas reales contra
// la API el 12-sep-2026). No lo detecta la cascada de openrouter.js (esa solo reintenta con el
// siguiente modelo si hay error de red, HTTP o JSON inválido), así que se reintenta aquí.
const REINTENTOS_LOTE_MODELO = 2;

async function decidirAportaLote(lote, registrar, etiquetaLote) {
  let salida;
  let crudos = [];
  let intento = 0;
  for (; intento < REINTENTOS_LOTE_MODELO; intento++) {
    try {
      salida = await llamar({
        modelos: MODELOS_IMAGENES,
        mensajes: [
          { role: 'system', content: promptSistemaPasoA() },
          { role: 'user', content: `Decide para estas ${lote.length} preguntas:\n${JSON.stringify(lote.map(resumirParaPasoA))}` },
        ],
        json: true,
        temperatura: 0.3,
        maxTokens: 6000,
        permitirPago: false,
      });
    } catch (err) {
      await registrar(`${etiquetaLote}: FALLO paso A (intento ${intento + 1}) — ${err.message}`);
      continue;
    }

    let datos;
    try {
      datos = extraerJson(salida.texto);
    } catch (err) {
      await registrar(`${etiquetaLote}: JSON inválido en paso A (intento ${intento + 1}, ${salida.modelo}) — ${err.message}`);
      continue;
    }

    crudos = Array.isArray(datos) ? datos : datos.resultados || [];
    if (crudos.length > 0) break;
    await registrar(`${etiquetaLote}: respuesta vacía (intento ${intento + 1}, ${salida.modelo}), reintentando`);
  }

  const porId = new Map();
  let aportan = 0;
  for (const r of crudos) {
    if (!r || typeof r.id !== 'string') continue;
    const aporta = r.aporta === true;
    if (aporta) aportan++;
    const terminos = aporta ? (Array.isArray(r.terminos) ? r.terminos.filter((t) => typeof t === 'string' && t.trim()) : []) : [];
    porId.set(r.id, { aporta: aporta && terminos.length > 0, terminos, leyenda: typeof r.leyenda === 'string' ? r.leyenda.slice(0, 60) : '' });
  }
  await registrar(`${etiquetaLote}: ${crudos.length} juzgadas, ${aportan} aportan${salida ? ` (${salida.modelo})` : ''}`);
  return porId;
}

// --- Paso B: búsqueda en Wikimedia Commons -----------------------------------------------

function limpiarHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function licenciaPermitida(nombre) {
  if (!nombre) return false;
  const n = String(nombre).trim();
  if (/^public domain/i.test(n)) return true;
  if (/^cc0/i.test(n)) return true;
  if (/^cc[\s-]?by/i.test(n)) {
    if (/nc/i.test(n)) return false; // no comercial: CC BY-NC, CC BY-NC-SA...
    if (/\bnd\b/i.test(n)) return false; // sin obra derivada: CC BY-ND
    return true; // CC BY, CC BY-SA
  }
  return false;
}

async function buscarEnCommons(termino, fetchImpl = fetch) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${termino} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    iiurlwidth: '900',
  });
  const url = `${COMMONS_API}?${params.toString()}`;

  let ultimoError = 'fallo desconocido';
  for (let intento = 1; intento <= REINTENTOS_COMMONS; intento++) {
    let respuesta;
    try {
      respuesta = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(COMMONS_TIMEOUT_MS),
      });
    } catch (err) {
      ultimoError = `error de red (${err.name === 'TimeoutError' ? 'timeout' : err.message})`;
      await esperar(1000 * intento);
      continue;
    }
    if (respuesta.status === 429 || respuesta.status === 403) {
      ultimoError = `HTTP ${respuesta.status}`;
      await esperar(3000 * intento); // 3s, 6s, 9s... el 429 de Commons tarda en despejarse
      continue;
    }
    if (!respuesta.ok) {
      return { paginas: [], error: `HTTP ${respuesta.status}` };
    }
    let datos;
    try {
      datos = await respuesta.json();
    } catch (err) {
      return { paginas: [], error: `respuesta no es JSON (${err.message})` };
    }
    const paginas = datos?.query?.pages ? Object.values(datos.query.pages) : [];
    paginas.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return { paginas, error: null };
  }
  return { paginas: [], error: ultimoError };
}

// La API de Commons devuelve a veces el thumburl en el dominio "thumb.wikimedia.org" en vez de
// "upload.wikimedia.org" (mismo fichero, mismo etag -- comprobado con curl el 12-sep-2026:
// ambos devuelven idéntico content-length y etag). Se normaliza al dominio estable y documentado
// de Wikimedia (el que valida tools/validar-banco.js) para no depender de un alias de CDN.
function normalizarUrlUpload(url) {
  if (!url) return url;
  return url.replace(/^https:\/\/thumb\.wikimedia\.org\//i, 'https://upload.wikimedia.org/');
}

function elegirImagen(paginas, pregunta) {
  const esBandera = /bandera/i.test(`${pregunta.enunciado} ${pregunta.explicacion || ''}`);
  for (const pagina of paginas) {
    const info = pagina.imageinfo?.[0];
    if (!info || !info.thumburl) continue;
    const titulo = (pagina.title || '').replace(/^File:/i, '');
    if (/\.(svg|pdf)$/i.test(titulo)) continue;
    if (!esBandera && /(logo|icon|flag)/i.test(titulo)) continue;
    const licencia = info.extmetadata?.LicenseShortName?.value;
    if (!licenciaPermitida(licencia)) continue;
    const anchoOriginal = Number(info.width) || 0;
    if (anchoOriginal < ANCHO_MINIMO) continue;
    return {
      titulo,
      url: normalizarUrlUpload(info.thumburl),
      pagina: info.descriptionurl,
      autor: limpiarHtml(info.extmetadata?.Artist?.value || '').slice(0, 200),
      licencia,
      ancho: info.thumbwidth || anchoOriginal,
      alto: info.thumbheight || Number(info.height) || 0,
      descripcion: limpiarHtml(info.extmetadata?.ImageDescription?.value || '').slice(0, 300),
    };
  }
  return null;
}

// --- Paso C: relevancia por modelo ---------------------------------------------------------

function promptSistemaPasoC() {
  return (
    'Compruebas si una imagen de Wikimedia Commons es realmente relevante para ilustrar la ' +
    'pregunta de un quiz. Te doy el enunciado, el "concepto_correcto" (la respuesta correcta -- ' +
    'lo que la imagen DEBE mostrar) y el título + descripción de la imagen candidata. Marca ' +
    '"relevante": true solo si la imagen muestra de verdad ese concepto correcto concreto -- no ' +
    'una opción incorrecta, no otra obra/lugar/persona parecida del mismo autor o tema, no algo ' +
    'genérico. PRESTA ESPECIAL ATENCIÓN A HOMÓNIMOS: cuando el concepto correcto es una persona ' +
    '(filósofo, científico, artista, gobernante...), comprueba que el título/descripción de la ' +
    'imagen corresponde a ESA persona exacta y no a otra con nombre igual o parecido, de otra ' +
    'época, profesión o país (ejemplo real de error: buscar "Aristotle" devolvió un busto de ' +
    '"Aristotelis Valaoritis", un poeta griego del siglo XIX, no el filósofo). Ante la duda, false. ' +
    'Devuelve SOLO JSON: {"resultados":[{"id":"…","relevante":true|false,"motivo":"…"}]}'
  );
}

async function comprobarRelevanciaLote(lote, registrar, etiquetaLote) {
  const payload = lote.map((c) => ({
    id: c.pregunta.id,
    enunciado: c.pregunta.enunciado,
    concepto_correcto: conceptoCorrecto(c.pregunta),
    imagen_titulo: c.imagen.titulo,
    imagen_descripcion: c.imagen.descripcion,
  }));
  let salida;
  try {
    salida = await llamar({
      modelos: MODELOS_IMAGENES,
      mensajes: [
        { role: 'system', content: promptSistemaPasoC() },
        { role: 'user', content: `Comprueba la relevancia de estas ${lote.length} imágenes:\n${JSON.stringify(payload)}` },
      ],
      json: true,
      temperatura: 0.2,
      maxTokens: 4000,
      permitirPago: false,
    });
  } catch (err) {
    await registrar(`${etiquetaLote}: FALLO paso C — ${err.message} (se conservan las imágenes de este lote sin comprobar)`);
    return new Map(lote.map((c) => [c.pregunta.id, { relevante: true, motivo: 'paso C no disponible: se conserva' }]));
  }

  let datos;
  try {
    datos = extraerJson(salida.texto);
  } catch (err) {
    await registrar(`${etiquetaLote}: JSON inválido en paso C (${salida.modelo}) — ${err.message} (se conservan)`);
    return new Map(lote.map((c) => [c.pregunta.id, { relevante: true, motivo: 'paso C JSON inválido: se conserva' }]));
  }

  const crudos = Array.isArray(datos) ? datos : datos.resultados || [];
  const porId = new Map();
  for (const r of crudos) {
    if (!r || typeof r.id !== 'string') continue;
    porId.set(r.id, { relevante: r.relevante !== false, motivo: r.motivo || '' });
  }
  const noRelevantes = [...porId.values()].filter((v) => !v.relevante).length;
  await registrar(`${etiquetaLote}: ${crudos.length} comprobadas, ${noRelevantes} descartadas por relevancia (${salida.modelo})`);
  return porId;
}

// --- Revalidación: repite solo el paso C sobre lo ya guardado -------------------------------

async function revalidar(banco, existentes, args, registrar, lineasLog) {
  const porId = new Map(banco.map((p) => [p.id, p]));
  const entradas = Object.entries(existentes)
    .filter(([id]) => porId.has(id))
    .map(([id, img]) => ({ pregunta: porId.get(id), imagen: img }));

  await registrar(`\n=== buscar-imagenes --revalidar ${new Date().toISOString()} — ${entradas.length} imágenes a revisar ===`);
  if (entradas.length === 0) {
    console.log('Nada que revalidar.');
    return;
  }

  const relevancia = new Map();
  const lotes = partirEnLotes(entradas, TAMANO_LOTE);
  for (let i = 0; i < lotes.length; i++) {
    const parcial = await comprobarRelevanciaLote(lotes[i], registrar, `revalidar lote ${i + 1}/${lotes.length}`);
    for (const [id, v] of parcial) relevancia.set(id, v);
  }

  const descartadas = new Map();
  const resultado = { ...existentes };
  for (const { pregunta } of entradas) {
    const r = relevancia.get(pregunta.id);
    if (r && r.relevante === false) {
      descartadas.set(pregunta.id, r.motivo || 'no relevante');
      delete resultado[pregunta.id];
    }
  }

  await registrar(`\nRevisadas: ${entradas.length}. Descartadas ahora: ${descartadas.size}. Quedan: ${Object.keys(resultado).length}.`);
  if (descartadas.size > 0) {
    await registrar('Detalle de las descartadas en la revalidación:');
    for (const [id, motivo] of descartadas) await registrar(`  ${id}: ${motivo}`);
  }

  if (!args.aplicar) {
    console.log('\n(sin --aplicar: no se ha escrito datos/imagenes.json ni datos/imagenes.log)');
    return;
  }
  await writeFile(RUTA_IMAGENES, JSON.stringify(resultado, null, 2), 'utf8');
  await appendFile(RUTA_LOG, `${lineasLog.join('\n')}\n`, 'utf8');
  console.log(`\nEscrito ${RUTA_IMAGENES} (${Object.keys(resultado).length} imágenes en total) y ${RUTA_LOG}.`);
}

// --- Programa principal ---------------------------------------------------------------------

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    return;
  }
  if (args.area && !AREAS.includes(args.area)) {
    console.error(`Área desconocida: ${args.area}. Válidas: ${AREAS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const lineasLog = [];
  const registrar = async (linea) => {
    console.log(linea);
    lineasLog.push(linea);
  };

  const banco = JSON.parse(await readFile(RUTA_BANCO, 'utf8'));
  const existentes = JSON.parse(await readFile(RUTA_IMAGENES, 'utf8').catch(() => '{}'));

  if (args.revalidar) {
    await revalidar(banco, existentes, args, registrar, lineasLog);
    return;
  }

  let candidatas = args.area ? banco.filter((p) => p.area === args.area) : banco.slice();
  if (args.soloPendientes) {
    const antes = candidatas.length;
    candidatas = candidatas.filter((p) => !(p.id in existentes));
    await registrar(`--solo-pendientes: ${antes - candidatas.length} ya tenían entrada, ${candidatas.length} pendientes.`);
  }
  if (args.limite > 0) candidatas = candidatas.slice(0, args.limite);

  await registrar(`\n=== buscar-imagenes ${new Date().toISOString()} — ${candidatas.length} preguntas candidatas ===`);

  if (candidatas.length === 0) {
    console.log('Nada que procesar.');
    return;
  }

  // Paso A, por área (el criterio y los hilos varían por área) y por lotes de TAMANO_LOTE.
  const porArea = new Map();
  for (const p of candidatas) {
    if (!porArea.has(p.area)) porArea.set(p.area, []);
    porArea.get(p.area).push(p);
  }

  const decisiones = new Map(); // id -> {aporta, terminos, leyenda}
  for (const [area, preguntas] of porArea) {
    const lotes = partirEnLotes(preguntas, TAMANO_LOTE);
    for (let i = 0; i < lotes.length; i++) {
      const parcial = await decidirAportaLote(lotes[i], registrar, `paso A ${area} lote ${i + 1}/${lotes.length}`);
      for (const [id, v] of parcial) decisiones.set(id, v);
    }
  }

  const aportan = candidatas.filter((p) => decisiones.get(p.id)?.aporta);
  await registrar(`\nAportan imagen según el modelo: ${aportan.length}/${candidatas.length}`);

  // Paso B: búsqueda en Commons, secuencial con pausa de cortesía.
  const conCandidato = []; // {pregunta, imagen, termino}
  const sinImagenPasoB = new Map(); // id -> motivo
  let primeraLlamadaCommons = true;
  for (const p of aportan) {
    const decision = decisiones.get(p.id);
    let encontrada = null;
    let terminoUsado = null;
    let motivos = [];
    for (const termino of decision.terminos.slice(0, 2)) {
      if (!primeraLlamadaCommons) await esperar(PAUSA_COMMONS_MS);
      primeraLlamadaCommons = false;
      const { paginas, error } = await buscarEnCommons(termino);
      if (error) {
        motivos.push(`"${termino}": ${error}`);
        continue;
      }
      if (paginas.length === 0) {
        motivos.push(`"${termino}": sin resultados`);
        continue;
      }
      const imagen = elegirImagen(paginas, p);
      if (imagen) {
        encontrada = imagen;
        terminoUsado = termino;
        break;
      }
      motivos.push(`"${termino}": ningún resultado con licencia/tamaño/tipo válidos`);
    }
    if (encontrada) {
      conCandidato.push({ pregunta: p, imagen: encontrada, termino: terminoUsado, leyenda: decision.leyenda });
    } else {
      sinImagenPasoB.set(p.id, motivos.join('; ') || 'sin términos de búsqueda');
    }
  }
  await registrar(`Con candidato de Commons: ${conCandidato.length}/${aportan.length}`);

  // Paso C: relevancia por modelo, por lotes.
  const relevancia = new Map(); // id -> {relevante, motivo}
  const lotesC = partirEnLotes(conCandidato, TAMANO_LOTE);
  for (let i = 0; i < lotesC.length; i++) {
    const parcial = await comprobarRelevanciaLote(lotesC[i], registrar, `paso C lote ${i + 1}/${lotesC.length}`);
    for (const [id, v] of parcial) relevancia.set(id, v);
  }

  const finalesPorId = new Map(); // id -> objeto de datos/imagenes.json
  const descartadasRelevancia = new Map(); // id -> motivo
  for (const c of conCandidato) {
    const r = relevancia.get(c.pregunta.id);
    if (r && r.relevante === false) {
      descartadasRelevancia.set(c.pregunta.id, r.motivo || 'no relevante');
      continue;
    }
    finalesPorId.set(c.pregunta.id, {
      id: c.pregunta.id,
      url: c.imagen.url,
      pagina: c.imagen.pagina,
      titulo: c.imagen.titulo,
      autor: c.imagen.autor,
      licencia: c.imagen.licencia,
      leyenda: c.leyenda || '',
      termino: c.termino,
      ancho: c.imagen.ancho,
      alto: c.imagen.alto,
    });
  }

  // --- Informe por área ---
  const resumenPorArea = new Map();
  for (const area of AREAS) resumenPorArea.set(area, { preguntas: 0, aportan: 0, conImagen: 0, sinImagen: 0 });
  for (const p of candidatas) {
    const r = resumenPorArea.get(p.area);
    if (!r) continue;
    r.preguntas++;
    if (decisiones.get(p.id)?.aporta) r.aportan++;
  }
  for (const id of finalesPorId.keys()) {
    const p = candidatas.find((x) => x.id === id);
    if (p) resumenPorArea.get(p.area).conImagen++;
  }
  for (const p of candidatas) {
    if (decisiones.get(p.id)?.aporta && !finalesPorId.has(p.id)) {
      resumenPorArea.get(p.area).sinImagen++;
    }
  }

  await registrar('\n=== Resumen por área ===');
  for (const area of AREAS) {
    const r = resumenPorArea.get(area);
    if (r.preguntas === 0) continue;
    await registrar(`  ${area}: ${r.preguntas} preguntas, ${r.aportan} aportan, ${r.conImagen} con imagen, ${r.sinImagen} sin imagen`);
  }

  const descartadasLicenciaCalidad = sinImagenPasoB.size;
  await registrar(`\nTotal candidatas: ${candidatas.length}`);
  await registrar(`Aportan (paso A): ${aportan.length}`);
  await registrar(`Con imagen final: ${finalesPorId.size}`);
  await registrar(`Descartadas por licencia/tamaño/tipo (paso B): ${descartadasLicenciaCalidad}`);
  await registrar(`Descartadas por relevancia (paso C): ${descartadasRelevancia.size}`);
  if (sinImagenPasoB.size > 0) {
    await registrar('\nDetalle sin imagen (paso B):');
    for (const [id, motivo] of sinImagenPasoB) await registrar(`  ${id}: ${motivo}`);
  }
  if (descartadasRelevancia.size > 0) {
    await registrar('\nDetalle descartadas por relevancia (paso C):');
    for (const [id, motivo] of descartadasRelevancia) await registrar(`  ${id}: ${motivo}`);
  }

  if (!args.aplicar) {
    console.log('\n(sin --aplicar: no se ha escrito datos/imagenes.json ni datos/imagenes.log)');
    return;
  }

  // Fusión: se parte de lo existente y solo se toca lo que ha entrado en esta ejecución
  // (así --area/--limite/--solo-pendientes nunca borran entradas de otras preguntas).
  const resultadoFinal = { ...existentes };
  for (const p of candidatas) {
    if (finalesPorId.has(p.id)) resultadoFinal[p.id] = finalesPorId.get(p.id);
    else delete resultadoFinal[p.id];
  }

  await writeFile(RUTA_IMAGENES, JSON.stringify(resultadoFinal, null, 2), 'utf8');
  await appendFile(RUTA_LOG, `${lineasLog.join('\n')}\n`, 'utf8');
  console.log(`\nEscrito ${RUTA_IMAGENES} (${Object.keys(resultadoFinal).length} imágenes en total) y ${RUTA_LOG}.`);
}

const esCLI = process.argv[1] && process.argv[1].endsWith('buscar-imagenes.js');
if (esCLI) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { licenciaPermitida, elegirImagen, limpiarHtml };
