// CLI: construye el banco de cifras de Más o menos (spec v0.3 §8) → datos/cifras.json.
//   node --env-file=.env tools/construir-cifras.js [--sin-notas] [--sin-imagenes] [--limite-notas N] [--solo cat1,cat2]
//   node --env-file=.env tools/construir-cifras.js --solo-notas [--limite-notas N]   (solo las notas curiosas, reanudable)
// Fuentes públicas y gratis, con usuario-agente propio y pausa entre consultas:
//   · Wikidata SPARQL (población de países y ciudades, altitud de montañas, altura de edificios, longitud de
//     ríos, superficie de países, año de pinturas famosas y de batallas famosas);
//   · Banco Mundial (indicador NY.GDP.MKTP.CD, PIB en US$ corrientes), la misma fuente primaria que usa
//     Our World in Data: OWID solo publica el PIB en $ internacionales constantes (no en US$ corrientes, que
//     es lo que entiende un jugador), así que se va a la fuente.
// Cada cifra: { id, area, categoria, unidad, nombre, valor, fuente (URL), fecha, imagen?, nota? }.
// La foto sale de la P18 de Wikidata (fichero de Commons) con autor y licencia comprobados con la API de
// Commons; la nota de calidad y la IA son de tools/mejorar-imagenes.js (--cifras). La nota curiosa la
// escribe la cascada gratis y pasa por el mismo verificador que las preguntas; si no verifica, sin nota.
// Solo datos públicos. Nunca lee ni imprime claves.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { llamar, extraerJson, MODELOS } from './openrouter.js';
import { elegirImagen, limpiarHtml } from './buscar-imagenes.js';
import { PROMPT_SISTEMA_VERIFICADOR } from './prompts-preguntas.js';
import { creditoCompleto } from '../servidor/politica-imagen.js';

export const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';
export const RUTA_CIFRAS = 'datos/cifras.json';
const SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const BANCO_MUNDIAL = 'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=400&mrnev=1';
const PAUSA_MS = 1500;

export const ANO_MIN = -3000;
export const ANO_MAX = 2026;

// Pinturas famosas: las de los grandes museos (Louvre, Prado, Rijksmuseum, Met, Uffizi, Orsay, National Gallery,
// Hermitage, Vaticano, MoMA, Ámsterdam...). Preguntar por todas las pinturas de Wikidata agota el tiempo de la consulta.
const COLECCIONES_PINTURA = ['Q19675', 'Q160112', 'Q190804', 'Q160236', 'Q51252', 'Q23402', 'Q180788', 'Q188740', 'Q132783', 'Q95569', 'Q1038113', 'Q153306', 'Q471379', 'Q214867', 'Q674775'];

/**
 * Las 9 categorías. `prefijo` abrevia el id (`pp-Q29`); `propiedad` es la de Wikidata; `factor` pasa del
 * valor normalizado de Wikidata (SI: metros, m²) a la unidad de la cifra; `maxCifras` acota el tamaño del
 * fichero (se quedan las de más enlaces a Wikipedia, las más conocidas); `minValor` descarta lo corriente.
 */
export const CATEGORIAS = Object.freeze({
  'poblacion-pais': { prefijo: 'pp', area: 'geografia', unidad: 'personas', clase: 'Q3624078', propiedad: 'P1082', tipo: 'poblacion', maxCifras: 80, minSitelinks: 0 },
  'poblacion-ciudad': { prefijo: 'pc', area: 'geografia', unidad: 'personas', clases: ['Q515', 'Q1549591', 'Q1637706', 'Q174844', 'Q200250'], propiedad: 'P1082', tipo: 'poblacion', minValor: 1e6, maxCifras: 45, minSitelinks: 25 },
  'altitud-montana': { prefijo: 'am', area: 'geografia', unidad: 'm', clases: ['Q8502', 'Q8072'], propiedad: 'P2044', tipo: 'cantidad', factor: 1, minValor: 4000, maxCifras: 45, minSitelinks: 12 },
  'altura-edificio': { prefijo: 'ae', area: 'arte', unidad: 'm', clase: 'Q11303', propiedad: 'P2048', tipo: 'cantidad', factor: 1, minValor: 150, maxCifras: 40, minSitelinks: 8 },
  'longitud-rio': { prefijo: 'lr', area: 'geografia', unidad: 'km', clase: 'Q4022', propiedad: 'P2043', tipo: 'cantidad', factor: 1 / 1000, minValor: 1000, maxCifras: 40, minSitelinks: 12 },
  'superficie-pais': { prefijo: 'sp', area: 'geografia', unidad: 'km²', clase: 'Q3624078', propiedad: 'P2046', tipo: 'cantidad', factor: 1 / 1e6, maxCifras: 60, minSitelinks: 0 },
  'ano-obra': { prefijo: 'ao', area: 'arte', unidad: 'año', clase: 'Q3305213', colecciones: COLECCIONES_PINTURA, propiedad: 'P571', tipo: 'ano', maxCifras: 55, minSitelinks: 20 },
  'ano-hecho': { prefijo: 'ah', area: 'historia', unidad: 'año', clase: 'Q178561', propiedad: 'P585', tipo: 'ano', maxCifras: 55, minSitelinks: 30 },
  'pib-pais': { prefijo: 'pib', area: 'economia', unidad: 'US$', tipo: 'pib', maxCifras: 60 },
});

const PREFIJO_A_CATEGORIA = Object.fromEntries(Object.entries(CATEGORIAS).map(([cat, c]) => [c.prefijo, cat]));
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Consultas ----------------------------------------------------------------------------------------

/** Consulta SPARQL de una categoría (solo datos desnudos: el nombre y la foto se piden después, por lotes). */
export function construirConsulta(categoria) {
  const c = CATEGORIAS[categoria];
  if (!c || c.tipo === 'pib') throw new Error(`Sin consulta SPARQL para ${categoria}`);
  const clases = (c.clases ?? [c.clase]).map((q) => `wd:${q}`).join(' ');
  const enlaces = `?e wikibase:sitelinks ?sl .${c.minSitelinks ? ` FILTER(?sl >= ${c.minSitelinks})` : ''}`;
  const coleccion = c.colecciones ? `VALUES ?col { ${c.colecciones.map((q) => `wd:${q}`).join(' ')} }
  ?e wdt:P195 ?col .
  ` : '';
  if (c.tipo === 'ano') {
    return `SELECT ?e ?valor ?sl WHERE {
  ${coleccion}VALUES ?clase { ${clases} }
  ?e wdt:P31 ?clase .
  ${enlaces}
  ?e p:${c.propiedad} ?s . ?s psv:${c.propiedad} ?v . ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec . FILTER(?prec >= 9)
  BIND(YEAR(?t) AS ?valor)
} ORDER BY DESC(?sl) LIMIT 1500`;
  }
  if (c.tipo === 'poblacion') {
    // El filtro de la población va antes que la clase: así Wikidata descarta primero lo que no llega al mínimo.
    const minimo = c.minValor ? ` FILTER(?valor > ${c.minValor})` : '';
    return `SELECT ?e ?valor ?fecha ?sl WHERE {
  ?e p:${c.propiedad} ?s . ?s ps:${c.propiedad} ?valor .${minimo}
  VALUES ?clase { ${clases} }
  ?e wdt:P31 ?clase .
  ${enlaces}
  ?s wikibase:rank ?r . FILTER(?r != wikibase:DeprecatedRank)
  OPTIONAL { ?s pq:P585 ?fecha }
} ORDER BY DESC(?sl) LIMIT 8000`;
  }
  const minimo = c.minValor ? ` FILTER(?valor > ${Math.round(c.minValor / c.factor) - 1})` : ''; // el SPARQL va en unidades SI
  return `SELECT ?e ?valor ?sl WHERE {
  VALUES ?clase { ${clases} }
  ?e wdt:P31 ?clase .
  ${enlaces}
  ?e p:${c.propiedad} ?s . ?s wikibase:rank ?r . FILTER(?r != wikibase:DeprecatedRank)
  ?s psn:${c.propiedad}/wikibase:quantityAmount ?valor .${minimo}
} ORDER BY DESC(?sl) LIMIT 8000`;
}

/** Consulta de nombres (es, si no en), foto P18 e ISO3 de un lote de entidades. */
export function construirConsultaDetalle(qids) {
  const valores = qids.map((q) => `wd:${q}`).join(' ');
  return `SELECT ?e ?es ?en ?img ?iso3 WHERE {
  VALUES ?e { ${valores} }
  OPTIONAL { ?e rdfs:label ?es . FILTER(LANG(?es) = "es") }
  OPTIONAL { ?e rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?e wdt:P18 ?img }
  OPTIONAL { ?e wdt:P298 ?iso3 }
}`;
}

/** Los países soberanos con su ISO3 (para casar el PIB del Banco Mundial). */
export const CONSULTA_ISO3 = `SELECT ?e ?valor ?sl WHERE {
  ?e wdt:P31 wd:Q3624078 . ?e wdt:P298 ?valor . ?e wikibase:sitelinks ?sl .
} ORDER BY DESC(?sl) LIMIT 400`;

// --- Funciones puras ------------------------------------------------------------------------------------

const qidDe = (uri) => String(uri ?? '').match(/\/(Q\d+)$/)?.[1] ?? null;
// Cifras de 100 o más sin decimales (8848,86 m → 8849); las pequeñas conservan dos.
const redondear = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100);

/** Una fila de SPARQL (`bindings`) → `{ id, qid, categoria, valor, fecha, sitelinks }` o null si está rota. */
export function normalizarFilaWikidata(fila, categoria) {
  const c = CATEGORIAS[categoria];
  const qid = qidDe(fila?.e?.value);
  const bruto = Number(fila?.valor?.value);
  if (!c || !qid || !Number.isFinite(bruto)) return null;
  const valor = c.tipo === 'ano' ? Math.trunc(bruto) : redondear(bruto * (c.factor ?? 1));
  const fecha = typeof fila?.fecha?.value === 'string' ? fila.fecha.value.slice(0, 10) : null;
  const sitelinks = Number(fila?.sl?.value);
  return { id: `${c.prefijo}-${qid}`, qid, categoria, valor, fecha, sitelinks: Number.isFinite(sitelinks) ? sitelinks : 0 };
}

/**
 * Una cifra por `id` de Wikidata. Con fecha del dato gana la más reciente; sin fecha, si los valores
 * discrepan (más de un 5 %, o un solo año de diferencia en las fechas históricas) la medida es ambigua y la
 * cifra se descarta: dentro de una categoría todas las cifras miden lo mismo.
 */
export function deduplicar(cifras) {
  const grupos = new Map();
  for (const c of cifras) {
    if (!grupos.has(c.id)) grupos.set(c.id, []);
    grupos.get(c.id).push(c);
  }
  const salida = [];
  for (const grupo of grupos.values()) {
    const conFecha = grupo.filter((c) => c.fecha).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    if (conFecha.length > 0) {
      salida.push(conFecha[0]);
      continue;
    }
    const valores = grupo.map((c) => c.valor);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const esAno = CATEGORIAS[grupo[0].categoria]?.tipo === 'ano';
    const discrepa = esAno ? max !== min : min <= 0 || max / min > 1.05;
    if (!discrepa) salida.push(grupo[0]);
  }
  return salida;
}

/** ¿Vale la cifra? Valor finito > 0 (años entre −3000 y 2026), con nombre y fuente. */
export function validarCifra(c) {
  if (!c || typeof c !== 'object') return false;
  const cat = CATEGORIAS[c.categoria];
  if (!cat || typeof c.id !== 'string' || !c.id) return false;
  if (typeof c.nombre !== 'string' || c.nombre.trim().length < 2 || c.nombre.length > 80 || /^Q\d+$/.test(c.nombre)) return false;
  if (!Number.isFinite(c.valor)) return false;
  if (cat.tipo === 'ano') {
    if (!Number.isInteger(c.valor) || c.valor < ANO_MIN || c.valor > ANO_MAX) return false;
  } else if (c.valor <= 0) {
    return false;
  }
  if (cat.minValor && c.valor < cat.minValor) return false;
  return typeof c.fuente === 'string' && /^https:\/\//.test(c.fuente);
}

// Una foto de Wikidata sin puntuar no puede ser un mapa, una bandera, un escudo, un plano ni un diagrama.
const FICHERO_NO_FOTO = /\b(map|mapa|karte|carte|locator|location|flag|bandera|coat[ _]of[ _]arms|escudo|blason|plan|diagram|chart|logo|icon|symbol|seal|sello)\b|\.svg$/i;

/** Nombre de fichero de Commons (decodificado) a partir de la URL `Special:FilePath/…` de la P18. */
export function ficheroDeP18(valor) {
  const m = String(valor ?? '').match(/Special:FilePath\/(.+)$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

/** ¿Merece la pena pedir esta P18 a Commons? (Descarta mapas, banderas, escudos, SVG...) */
export function p18Aceptable(fichero) {
  return typeof fichero === 'string' && fichero.length > 0 && !FICHERO_NO_FOTO.test(fichero);
}

const sinConsulta = (url) => String(url ?? '').split('?')[0];

/**
 * Imagen de Commons de un fichero P18: `{ url, pagina, autor, licencia, fuente: 'Commons', nota: null }` con
 * licencia libre y autor si la licencia lo exige (CC BY, BY-SA); null si no hay o no se puede publicar.
 * `pagina` es la respuesta de la API de Commons (`imageinfo`) de ese fichero.
 */
export function imagenDeWikidata(pagina) {
  const elegida = elegirImagen([pagina], { enunciado: '' });
  if (!elegida) return null;
  const imagen = {
    url: sinConsulta(elegida.url),
    pagina: elegida.pagina,
    autor: elegida.autor,
    licencia: elegida.licencia,
    fuente: 'Commons',
    nota: null,
  };
  return creditoCompleto(imagen) ? imagen : null;
}

/** CSV/JSON del Banco Mundial → `Map<ISO3, { valor, fecha }>` (agregados regionales y valores vacíos fuera). */
export function parsearPibBancoMundial(json) {
  const filas = Array.isArray(json) ? json[1] : null;
  const mapa = new Map();
  if (!Array.isArray(filas)) return mapa;
  for (const f of filas) {
    const iso3 = f?.countryiso3code;
    const valor = Number(f?.value);
    if (!/^[A-Z]{3}$/.test(iso3 ?? '') || !Number.isFinite(valor) || valor <= 0 || f?.value === null) continue;
    mapa.set(iso3, { valor: Math.round(valor), fecha: `${f.date}`.slice(0, 4) });
  }
  return mapa;
}

// --- Red ------------------------------------------------------------------------------------------------

async function pedirJson(url, { fetchImpl = fetch, intentos = 3, pausaMs = PAUSA_MS, cabeceras = {} } = {}) {
  let ultimo = 'sin intentos';
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, ...cabeceras }, signal: AbortSignal.timeout(90000) });
      if (r.status === 429 || r.status === 503) {
        const espera = Number(r.headers?.get?.('retry-after')) || 10 * i;
        ultimo = `HTTP ${r.status}`;
        await esperar(espera * 1000);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (pausaMs) await esperar(pausaMs);
      return json;
    } catch (err) {
      ultimo = err.message;
      await esperar(2000 * i);
    }
  }
  throw new Error(`${url.slice(0, 80)}… ${ultimo}`);
}

export async function consultarSparql(consulta, opciones = {}) {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(consulta)}`;
  const json = await pedirJson(url, { ...opciones, cabeceras: { Accept: 'application/sparql-results+json' } });
  return json?.results?.bindings ?? [];
}

/** Nombres, fotos P18 e ISO3 de las entidades, por lotes. → `Map<qid, { nombre, fichero, iso3 }>`. */
export async function detalleDeEntidades(qids, opciones = {}) {
  const mapa = new Map();
  for (let i = 0; i < qids.length; i += 150) {
    const filas = await consultarSparql(construirConsultaDetalle(qids.slice(i, i + 150)), opciones);
    for (const f of filas) {
      const qid = qidDe(f.e?.value);
      if (!qid) continue;
      const previo = mapa.get(qid) ?? { nombre: null, fichero: null, iso3: null };
      previo.nombre = previo.nombre ?? f.es?.value ?? f.en?.value ?? null;
      const fichero = ficheroDeP18(f.img?.value);
      if (!previo.fichero && p18Aceptable(fichero)) previo.fichero = fichero;
      previo.iso3 = previo.iso3 ?? f.iso3?.value ?? null;
      mapa.set(qid, previo);
    }
  }
  return mapa;
}

/** Imágenes de Commons de un conjunto de ficheros P18 (50 por llamada). → `Map<fichero, imagen>`. */
export async function imagenesDeCommons(ficheros, opciones = {}) {
  const mapa = new Map();
  for (let i = 0; i < ficheros.length; i += 40) {
    const lote = ficheros.slice(i, i + 40);
    const params = new URLSearchParams({
      action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '800',
      titles: lote.map((f) => `File:${f}`).join('|'),
    });
    const json = await pedirJson(`${COMMONS_API}?${params}`, { ...opciones, pausaMs: 700 });
    const normalizados = new Map((json?.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const pagina of Object.values(json?.query?.pages ?? {})) {
      const original = normalizados.get(pagina.title) ?? pagina.title;
      const fichero = String(original).replace(/^File:/i, '');
      const imagen = imagenDeWikidata(pagina);
      if (imagen) {
        imagen.autor = limpiarHtml(imagen.autor).slice(0, 120);
        mapa.set(fichero, imagen);
      }
    }
  }
  return mapa;
}

// --- Montaje del banco -----------------------------------------------------------------------------------

export function fuenteWikidata(qid) {
  return `https://www.wikidata.org/wiki/${qid}`;
}

/** Cifras (sin nombre) de una categoría de Wikidata, ya normalizadas, sin duplicados y acotadas. */
export function cifrasDeFilas(filas, categoria) {
  const c = CATEGORIAS[categoria];
  const normalizadas = filas.map((f) => normalizarFilaWikidata(f, categoria)).filter(Boolean);
  const unicas = deduplicar(normalizadas).filter((x) => (!c.minValor || x.valor >= c.minValor) && x.valor > (c.tipo === 'ano' ? ANO_MIN - 1 : 0));
  return unicas.sort((a, b) => b.sitelinks - a.sitelinks).slice(0, Math.round(c.maxCifras * 1.5));
}

/** Wikidata etiqueta en minúscula («batalla de Adua»): en el juego cada nombre empieza en mayúscula. */
export function capitalizar(texto) {
  const t = String(texto ?? '').trim();
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
}

function cifraCompleta(base, detalle, hoy) {
  const c = CATEGORIAS[base.categoria];
  return {
    id: base.id, area: c.area, categoria: base.categoria, unidad: c.unidad,
    nombre: capitalizar(detalle?.nombre), valor: base.valor,
    fuente: fuenteWikidata(base.qid), fecha: base.fecha ?? hoy,
    _fichero: detalle?.fichero ?? null,
  };
}

/** Recorre las categorías y devuelve las cifras (con `_fichero`, la P18 aún sin resolver). */
export async function construirCifras({ opciones = {}, hoy = new Date().toISOString().slice(0, 10), log = console.log, solo = null, fallos = [] } = {}) {
  const todas = [];
  const sitelinksPorId = new Map();
  const toca = (categoria) => !solo || solo.includes(categoria);
  for (const categoria of Object.keys(CATEGORIAS)) {
    if (CATEGORIAS[categoria].tipo === 'pib' || !toca(categoria)) continue;
    let filas;
    try {
      filas = await consultarSparql(construirConsulta(categoria), opciones);
    } catch (err) {
      log(`  ${categoria}: la consulta falló (${err.message.slice(-40)}); se queda lo que había`);
      fallos.push(categoria);
      continue;
    }
    const bases = cifrasDeFilas(filas, categoria);
    const detalles = await detalleDeEntidades([...new Set(bases.map((b) => b.qid))], opciones);
    const nombres = new Set();
    const cifras = [];
    for (const b of bases) {
      const cifra = cifraCompleta(b, detalles.get(b.qid), hoy);
      if (!validarCifra(cifra) || nombres.has(cifra.nombre.toLowerCase())) continue;
      nombres.add(cifra.nombre.toLowerCase());
      sitelinksPorId.set(cifra.id, b.sitelinks);
      cifras.push(cifra);
    }
    log(`  ${categoria}: ${filas.length} filas → ${cifras.length} cifras`);
    todas.push(...cifras.slice(0, CATEGORIAS[categoria].maxCifras));
  }
  // PIB: Banco Mundial casado con Wikidata por ISO3.
  if (!toca('pib-pais')) return todas;
  const iso = await consultarSparql(CONSULTA_ISO3, opciones);
  const qidPorIso = new Map(iso.map((f) => [f.valor.value, qidDe(f.e.value)]));
  const pib = parsearPibBancoMundial(await pedirJson(BANCO_MUNDIAL, opciones));
  const paises = [...pib].map(([iso3, p]) => ({ iso3, qid: qidPorIso.get(iso3), ...p })).filter((p) => p.qid);
  const detalles = await detalleDeEntidades(paises.map((p) => p.qid), opciones);
  const cp = CATEGORIAS['pib-pais'];
  const pibCifras = [];
  for (const p of paises) {
    const cifra = {
      id: `${cp.prefijo}-${p.qid}`, area: cp.area, categoria: 'pib-pais', unidad: cp.unidad,
      nombre: capitalizar(detalles.get(p.qid)?.nombre), valor: p.valor,
      fuente: `https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=${p.iso3}`, fecha: `${p.fecha}-12-31`,
      _fichero: detalles.get(p.qid)?.fichero ?? null,
    };
    if (validarCifra(cifra)) pibCifras.push(cifra);
  }
  pibCifras.sort((a, b) => b.valor - a.valor);
  log(`  pib-pais: ${pib.size} países del Banco Mundial → ${pibCifras.length} cifras`);
  todas.push(...pibCifras.slice(0, cp.maxCifras));
  return todas;
}

/** Pone `imagen` (Commons, sin nota) a las cifras con P18 aceptable. Quita `_fichero`. */
export async function ponerImagenes(cifras, opciones = {}) {
  const ficheros = [...new Set(cifras.map((c) => c._fichero).filter(Boolean))];
  const imagenes = await imagenesDeCommons(ficheros, opciones);
  for (const c of cifras) {
    const imagen = c._fichero ? imagenes.get(c._fichero) : null;
    if (imagen) {
      const { nota, ...resto } = imagen; // sin puntuar: el campo `nota` solo existe cuando hay nota
      c.imagen = nota == null ? resto : imagen;
    }
    delete c._fichero;
  }
  return cifras;
}

// --- Notas curiosas (cascada gratis + el mismo verificador de las preguntas) -----------------------------

const PROMPT_NOTA = 'Escribes notas curiosas para un juego de cultura general. Para cada cifra devuelves UNA frase corta en español (máx. 110 caracteres), con un dato verdadero, conocido y comprobable en cualquier enciclopedia sobre la cosa (su historia, su entorno, su nombre, algo que se le atribuye con seguridad). Reglas: NO repitas la cifra ni el año del dato; NO uses superlativos (el mayor, el primero, el único, el más...) ni cifras que no estés seguro de recordar; NO inventes ni redondees. Si no estás seguro al 100 %, omite esa cifra. Devuelve SOLO JSON {"<id>": "nota"}.';

/** ¿Es una nota usable? Una sola frase corta, sin enlaces ni marcas, sin superlativos ni números sueltos. */
export function notaValida(nota) {
  if (typeof nota !== 'string') return false;
  const t = nota.trim();
  return t.length >= 20 && t.length <= 140 && !/https?:|\*\*|\n/.test(t)
    && !/\b(el|la|los|las)\s+(mayor|menor|primer[oa]?|[uú]ltim[oa]|[uú]nic[oa]|m[aá]s\s+\p{L}+)\b/iu.test(t)
    && !/(^|\s)-\d/.test(t);
}

/** Convierte una nota en una V/F verdadera para el verificador de preguntas (mismo prompt y umbral). */
export function preguntaDeNota(cifra, nota) {
  return {
    id: cifra.id, tipo: 'vf', enunciado: `${cifra.nombre}: ${nota.trim()}`, respuesta: true,
    explicacion: `Dato de partida: ${cifra.nombre}, ${cifra.valor} ${cifra.unidad} (${cifra.fuente}).`,
  };
}

export async function escribirNotas(lote, { llamarModelo = llamar } = {}) {
  const lista = lote.map((c) => ({ id: c.id, nombre: c.nombre, valor: c.valor, unidad: c.unidad }));
  const salida = await llamarModelo({
    modelos: MODELOS.generadorFondo, mensajes: [{ role: 'system', content: PROMPT_NOTA }, { role: 'user', content: JSON.stringify(lista) }],
    json: true, temperatura: 0.4, maxTokens: 2000,
  });
  const datos = extraerJson(salida.texto);
  return Object.fromEntries(Object.entries(datos ?? {}).filter(([, n]) => notaValida(n)));
}

/**
 * Pasa las notas por el verificador de las preguntas (mismo prompt y umbral). Una nota es un dato suelto que
 * nadie más revisa, así que se exige que la den por buena DOS listas de modelos distintas (la del día y la de
 * fondo): ante la duda, sin nota.
 */
export async function verificarNotas(lote, notas, { llamarModelo = llamar, umbral = 0.7, listas = [MODELOS.verificador, MODELOS.verificadorFondo] } = {}) {
  let vivas = lote.filter((c) => notas[c.id]);
  for (const modelos of listas) {
    if (vivas.length === 0) return {};
    const preguntas = vivas.map((c) => preguntaDeNota(c, notas[c.id]));
    const salida = await llamarModelo({
      modelos,
      mensajes: [{ role: 'system', content: PROMPT_SISTEMA_VERIFICADOR }, { role: 'user', content: `Verifica estas ${preguntas.length} preguntas:
${JSON.stringify(preguntas)}` }],
      json: true,
    });
    const datos = extraerJson(salida.texto);
    const resultados = Array.isArray(datos) ? datos : datos?.resultados ?? [];
    const buenas = new Set(resultados.filter((r) => r?.correcta && r.unica && r.inequivoca && Number(r.confianza) >= umbral).map((r) => r.id));
    vivas = vivas.filter((c) => buenas.has(c.id));
  }
  return Object.fromEntries(vivas.map((c) => [c.id, notas[c.id].trim()]));
}

// --- CLI --------------------------------------------------------------------------------------------------

function ordenar(cifras) {
  const orden = Object.keys(CATEGORIAS);
  return [...cifras].sort((a, b) => orden.indexOf(a.categoria) - orden.indexOf(b.categoria) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Una cifra por línea: diff legible y sin sangrías que engorden el fichero. */
export function serializar(cifras) {
  return `[\n${ordenar(cifras).map((c) => JSON.stringify(c)).join(',\n')}\n]\n`;
}

async function leerPrevias() {
  try {
    return JSON.parse(await readFile(RUTA_CIFRAS, 'utf8'));
  } catch {
    return [];
  }
}

function parsearArgs(argv) {
  const a = { sinNotas: false, sinImagenes: false, limiteNotas: 0, solo: null, soloNotas: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sin-notas') a.sinNotas = true;
    else if (argv[i] === '--sin-imagenes') a.sinImagenes = true;
    else if (argv[i] === '--solo-notas') a.soloNotas = true;
    else if (argv[i] === '--limite-notas') a.limiteNotas = Number(argv[++i]) || 0;
    else if (argv[i] === '--solo') a.solo = argv[++i].split(',');
  }
  return a;
}

async function guardar(cifras) {
  await mkdir('datos', { recursive: true });
  await writeFile(RUTA_CIFRAS, serializar(cifras), 'utf8');
}

/** Notas curiosas en lotes de 8; el fichero se guarda tras cada lote, así que se puede parar y reanudar con --solo-notas. */
async function ponerNotas(cifras, limite) {
  const pendientes = cifras.filter((c) => !c.nota).slice(0, limite || Infinity);
  for (let i = 0; i < pendientes.length; i += 8) {
    const lote = pendientes.slice(i, i + 8);
    try {
      const buenas = await verificarNotas(lote, await escribirNotas(lote));
      for (const c of lote) if (buenas[c.id]) c.nota = buenas[c.id];
      await guardar(cifras);
      console.log(`  notas ${i + lote.length}/${pendientes.length}: ${Object.keys(buenas).length} verificadas`);
    } catch (err) {
      console.log(`  notas: lote ${i / 8 + 1} falló (${err.message.slice(0, 80)}); sin nota`);
    }
  }
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  const previas = new Map((await leerPrevias()).map((c) => [c.id, c]));
  let cifras;
  if (args.soloNotas) {
    cifras = [...previas.values()];
  } else {
    console.log('Consultando Wikidata y el Banco Mundial…');
    const fallos = [];
    const nuevas = await construirCifras({ solo: args.solo, fallos });
    // Las categorías que no se han tocado (con --solo) o cuya consulta falló conservan lo que había.
    const tocadas = new Set(nuevas.map((c) => c.categoria));
    cifras = [...nuevas, ...[...previas.values()].filter((c) => !tocadas.has(c.categoria))];
    if (!args.sinImagenes) await ponerImagenes(nuevas);
    else nuevas.forEach((c) => delete c._fichero);
    // Lo ya trabajado en pasadas anteriores (nota de imagen, imagen de IA, nota curiosa) se conserva.
    for (const c of cifras) {
      const p = previas.get(c.id);
      if (!p) continue;
      if (p.nota) c.nota = p.nota;
      if (p.imagen && (!c.imagen || p.imagen.nota != null || p.imagen.fuente === 'IA')) c.imagen = p.imagen;
    }
    await guardar(cifras);
  }
  if (!args.sinNotas) await ponerNotas(cifras, args.limiteNotas);
  const porCategoria = {};
  for (const c of cifras) porCategoria[c.categoria] = (porCategoria[c.categoria] ?? 0) + 1;
  console.log(`\n${cifras.length} cifras en ${new Set(cifras.map((c) => c.area)).size} áreas:`, porCategoria);
  console.log(`Con foto: ${cifras.filter((c) => c.imagen).length} · con nota curiosa: ${cifras.filter((c) => c.nota).length}`);
}

const esCLI = process.argv[1] && process.argv[1].endsWith('construir-cifras.js');
if (esCLI) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { PREFIJO_A_CATEGORIA };
