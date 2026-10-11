// CLI: lote de mejora del banco de imágenes (spec v0.3 §7). Para cada pregunta del banco:
//   (a) si tiene imagen con nota >= 4 y no está marcada mala, se queda;
//   (b) si no, busca en Commons (mejor búsqueda) y puntúa las candidatas;
//   (c) si ninguna llega a 4, busca en los bancos libres (Openverse, Met, AIC, NASA);
//   (d) si tampoco, genera una imagen con IA (último recurso; cupo <= 100/día, tope 0,10 €/día) SOLO si
//       la pregunta lo admite (nunca arte; en historia/geografía nada de mapas, personas o hechos
//       concretos), la imagen actual tiene nota < 3 y la IA saca >= 4 (se puntúa antes de guardarla);
//   (e) si no hay cupo o la IA no mejora, queda como estaba (nota >= 3, pendiente) o, si no, sin imagen.
// Un fallo técnico (visión que no responde, descarga fallida) NO es «no hay imagen buena»: la pregunta
// queda sin puntuar, sin bajar a la IA, para otra pasada (--continuar).
// Cada entrada de datos/imagenes.json gana `nota`, `notaModelo` y `fuente`. Las de bancos distintos de
// Commons se guardan optimizadas (WebP <= 80 KB) en imagenes-banco/<id>.webp y las de IA en
// imagenes-ia/<id>.webp, para no depender de enlaces externos ni pesar en el móvil.
//
// Cifras de Más o menos (`--cifras`): puntúa las fotos de datos/cifras.json (la P18 de Wikidata) con el mismo juez;
// las de nota < 4 pasan al color del área (la IA no entra: ver más abajo). Es reanudable por sí mismo: solo toca
// las fotos sin nota. `node --env-file=.env tools/mejorar-imagenes.js --cifras [--limite N] [--dry-run]`.
//
// Reanudable (`--continuar`): el progreso va en tmp/mejorar-imagenes.estado.json.
// Uso: node --env-file=.env tools/mejorar-imagenes.js [--continuar] [--dry-run] [--limite N] [--ids a,b,c]
//        [--sin-ia] [--area X] [--cada K] [--repuntuar a,b,c]
//   (--cada K: muestra representativa, una de cada K preguntas; --repuntuar: vuelve a puntuar esas
//    imágenes con el juez actual aunque ya tengan nota)
// Al terminar escribe docs/revision-imagenes.md (nuevas de nota 5 e IA aceptadas) para revisión humana.
// Solo datos públicos (cultura general + imágenes libres). Nunca lee ni imprime claves.
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { llamar, extraerJson } from './openrouter.js';
import { buscarEnCommons, elegirImagen, limpiarHtml } from './buscar-imagenes.js';
import { buscarEnBancos } from './bancos-libres.js';
import { puntuarImagen, esBuena } from './nota-imagen.js';
import { escribirPrompt, generarImagen, crearCupo, aWebp, CREDITO_IA } from '../servidor/imagen-ia.js';
import { iaPermitida, iaMejoraActual, creditoCompleto, exigeAutor, descargarAcotado } from '../servidor/politica-imagen.js';

const RUTA_BANCO = 'datos/banco.json';
const RUTA_IMAGENES = 'datos/imagenes.json';
const RUTA_MALAS = 'datos/imagenes-malas.json';
const RUTA_ESTADO = 'tmp/mejorar-imagenes.estado.json';
const RUTA_CUPO = 'datos/cupo-ia.json';
const DIR_IA = 'imagenes-ia';
const DIR_BANCO = 'imagenes-banco';
const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';
const MAX_CANDIDATAS_POR_FUENTE = 6;
const RUTA_REVISION = 'docs/revision-imagenes.md';
const PAUSA_COMMONS_MS = 500;
const MODELOS_TEXTO = ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'];

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decide el siguiente paso para una pregunta. Función pura: `undefined` en una lista = «aún no se
 * ha consultado esa fuente» (devuelve `buscar-*`); un array (aunque esté vacío) = ya consultada y
 * son sus candidatas con nota >= 4. La IA solo si la pregunta la admite (`iaOk`) y la imagen actual
 * no es aprovechable (nota < 3): una nota 3 nunca se cambia por IA.
 * @returns {'mantener'|'buscar-commons'|'commons'|'buscar-bancos'|'bancos'|'ia'|'sin-imagen'}
 */
export function decidirRama({ actual, marcadaMala = false, candidatasCommons, candidatasBancos, cupoLibre = false, iaOk = true }) {
  if (actual && esBuena(actual.nota) && !marcadaMala) return 'mantener';
  if (candidatasCommons === undefined) return 'buscar-commons';
  if (candidatasCommons.length > 0) return 'commons';
  if (candidatasBancos === undefined) return 'buscar-bancos';
  if (candidatasBancos.length > 0) return 'bancos';
  const actualAprovechable = actual && actual.nota >= 3 && !marcadaMala;
  return cupoLibre && iaOk && !actualAprovechable ? 'ia' : 'sin-imagen';
}

function parsearArgs(argv) {
  const a = { continuar: false, dryRun: false, limite: Infinity, ids: null, sinIa: false, area: null, cada: 1, repuntuar: new Set(), cifras: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--continuar') a.continuar = true;
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--sin-ia') a.sinIa = true;
    else if (argv[i] === '--cifras') a.cifras = true;
    else if (argv[i] === '--limite') a.limite = Number(argv[++i]);
    else if (argv[i] === '--ids') a.ids = argv[++i].split(',');
    else if (argv[i] === '--area') a.area = argv[++i];
    else if (argv[i] === '--cada') a.cada = Math.max(1, Number(argv[++i]) || 1);
    else if (argv[i] === '--repuntuar') a.repuntuar = new Set(argv[++i].split(','));
  }
  return a;
}

async function leerJson(ruta, defecto) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch {
    return defecto;
  }
}

export function bajar(url, fetchImpl = fetch) {
  return descargarAcotado(url, { fetchImpl, userAgent: USER_AGENT });
}

export const dataUrlWebp = (buffer) => `data:image/webp;base64,${buffer.toString('base64')}`;

export async function llamarTexto(mensajes, json = false) {
  const salida = await llamar({ modelos: MODELOS_TEXTO, mensajes, json, temperatura: 0.4, maxTokens: 1500, timeoutMs: 60000, reintentoMs: 2000 });
  return salida.texto;
}

/** Términos de búsqueda en inglés (2 por pregunta), pedidos por lotes a un modelo gratis. */
async function proponerTerminos(preguntas, guardados, imagenes) {
  const faltan = preguntas.filter((p) => !guardados[p.id]);
  for (let i = 0; i < faltan.length; i += 10) {
    const lote = faltan.slice(i, i + 10);
    const lista = lote.map((p) => `${p.id}: ${p.enunciado} (respuesta: ${p.explicacion ?? ''})`.slice(0, 400)).join('\n');
    try {
      const texto = await llamarTexto([
        { role: 'system', content: 'Para cada pregunta de un quiz propones 2 términos de búsqueda en INGLÉS (1-4 palabras cada uno) para encontrar en un banco de fotos libres una imagen llamativa, a color y de primer plano del tema. Si es un concepto abstracto, un objeto, lugar o escena concreta que lo represente. Devuelve SOLO JSON {"<id>": ["término 1", "término 2"], ...}.' },
        { role: 'user', content: lista },
      ], true);
      const datos = extraerJson(texto);
      for (const p of lote) {
        const t = (Array.isArray(datos[p.id]) ? datos[p.id] : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 2);
        const previo = imagenes[p.id]?.termino;
        guardados[p.id] = [...new Set([...(previo ? [previo] : []), ...t])];
      }
    } catch (err) {
      console.log(`  términos: lote ${i / 10 + 1} falló (${err.message.slice(0, 80)}); se usará el enunciado`);
    }
  }
}

function sinRepetirUrls(lista, usadas) {
  const vistas = new Set(usadas);
  return lista.filter((c) => (vistas.has(c.url) ? false : (vistas.add(c.url), true)));
}

/** Candidatas de Commons (hasta 3 distintas) para los términos dados. */
export async function candidatasCommons(terminos, pregunta, usadas) {
  const lista = [];
  for (const termino of terminos) {
    await esperar(PAUSA_COMMONS_MS);
    const { paginas, error } = await buscarEnCommons(termino);
    if (error && paginas.length === 0) throw new Error(`Commons: ${error}`); // caída, no «sin resultados»
    for (const pagina of paginas) {
      const c = elegirImagen([pagina], pregunta);
      if (c) lista.push({ url: c.url, pagina: c.pagina, titulo: c.titulo, autor: c.autor, licencia: c.licencia, fuente: 'Commons', ancho: c.ancho, alto: c.alto, termino });
    }
  }
  return sinRepetirUrls(lista.filter(creditoCompleto), usadas).slice(0, MAX_CANDIDATAS_POR_FUENTE);
}

export async function candidatasBancos(terminos, pregunta, usadas) {
  const lista = [];
  for (const termino of terminos) lista.push(...(await buscarEnBancos(termino, { area: pregunta.area })));
  return sinRepetirUrls(lista.filter(creditoCompleto), usadas).slice(0, MAX_CANDIDATAS_POR_FUENTE);
}

/**
 * Puntúa candidatas en orden (se detiene en la primera con nota >= 4). Devuelve `{ buenas, tecnico }`:
 * `tecnico` = alguna candidata no se pudo juzgar (descarga fallida, visión sin respuesta), así que
 * «ninguna buena» NO significa que la fuente esté agotada.
 */
export async function puntuarHastaBuena(candidatas, pregunta, estado, { bajarImagen = bajar, puntuar = puntuarConReintento } = {}) {
  const buenas = [];
  let tecnico = false;
  for (const c of candidatas) {
    let urlParaModelo = c.url;
    let webp = null;
    if (c.fuente !== 'Commons') {
      try {
        webp = await aWebp(await bajarImagen(c.url));
        const { default: sharp } = await import('sharp');
        const m = await sharp(webp).metadata();
        if (Math.min(m.width ?? 0, m.height ?? 0) < 400) continue; // demasiado pequeña de verdad: descartada
        urlParaModelo = dataUrlWebp(webp);
        c.ancho = m.width;
        c.alto = m.height;
      } catch {
        tecnico = true;
        continue;
      }
    }
    const r = await puntuar({ url: urlParaModelo, pregunta });
    if (!r) {
      estado.fallosSeguidos += 1;
      tecnico = true;
      continue;
    }
    estado.fallosSeguidos = 0;
    estado.puntuadas += 1;
    c.nota = r.nota;
    c.notaModelo = r.modelo;
    c.motivo = r.motivo;
    if (esBuena(r.nota)) {
      c.webp = webp;
      buenas.push(c);
      break;
    }
  }
  return { buenas, tecnico };
}

export async function puntuarConReintento(datos) {
  // Los modelos gratis limitan las peticiones por minuto: si todos fallan a la vez, se espera y se repite.
  for (let ronda = 0; ronda < 3; ronda++) {
    const r = await puntuarImagen(datos);
    if (r) return r;
    await esperar(20000);
  }
  return null;
}

export async function guardarWebp(carpeta, id, buffer) {
  await mkdir(carpeta, { recursive: true });
  await writeFile(`${carpeta}/${id}.webp`, buffer);
  return `${carpeta}/${id}.webp`;
}

function entradaNueva(id, pregunta, c, url, leyenda) {
  return {
    id,
    url,
    pagina: c.pagina ?? null,
    titulo: c.titulo ?? '',
    autor: c.autor ?? '',
    licencia: c.licencia ?? null,
    fuente: c.fuente,
    leyenda,
    termino: c.termino ?? null,
    ancho: c.ancho ?? null,
    alto: c.alto ?? null,
    nota: c.nota ?? null,
    notaModelo: c.notaModelo ?? null,
    origen: 'lote',
  };
}

const leyendaDe = (pregunta, c) => (c.titulo ? String(c.titulo).replace(/\.[a-z]{3,4}$/i, '').slice(0, 90) : String(pregunta.enunciado).slice(0, 90));

/** La imagen se manda al juez por URL, salvo los WebP guardados en el repo, que van en base64. */
async function urlParaJuez(url) {
  if (/^https?:/.test(url)) return url;
  return dataUrlWebp(await readFile(url));
}

const esLocal = (url) => /^imagenes-(ia|banco)\//.test(url ?? '');

async function borrarSilencioso(ruta) {
  try {
    await unlink(ruta);
  } catch {
    // ya no estaba
  }
}

export async function mejorarUna(pregunta, ctx) {
  const { imagenes, malas, cupo, args, estado, terminos } = ctx;
  // Dependencias con red o disco, sustituibles en los tests.
  const d = {
    candidatasCommons, candidatasBancos, puntuarHastaBuena, puntuar: puntuarConReintento, guardarWebp, aWebp, generarImagen,
    escribirPrompt: (p) => escribirPrompt(p, { llamarModelo: ({ mensajes }) => llamarTexto(mensajes) }),
    ...(ctx.deps ?? {}),
  };
  const id = pregunta.id;
  const marcadaMala = malas.has(id);
  let actual = imagenes[id] ?? null;
  if (actual && args.repuntuar.has(id)) actual = { ...actual, nota: null };

  // Una imagen existente sin nota se puntúa primero.
  if (actual && actual.nota == null) {
    const r = await d.puntuar({ url: await urlParaJuez(actual.url), pregunta });
    if (!r) {
      estado.fallosSeguidos += 1;
      return { rama: 'sin-puntuar' };
    }
    estado.fallosSeguidos = 0;
    estado.puntuadas += 1;
    actual = { ...actual, nota: r.nota, notaModelo: r.modelo, fuente: actual.fuente ?? 'Commons' };
    imagenes[id] = actual;
  }

  const usadas = actual ? [actual.url] : [];
  const buscar = [...new Set([...(terminos[id] ?? []), pregunta.enunciado.slice(0, 60)])].slice(0, 4);
  let commons;
  let bancos;
  for (;;) {
    const rama = decidirRama({ actual, marcadaMala, candidatasCommons: commons, candidatasBancos: bancos, cupoLibre: !args.sinIa && cupo.puede(), iaOk: iaPermitida(pregunta) });
    if (rama === 'mantener') return { rama };
    if (rama === 'buscar-commons' || rama === 'buscar-bancos') {
      const porCommons = rama === 'buscar-commons';
      const candidatas = porCommons ? await d.candidatasCommons(buscar, pregunta, usadas) : await d.candidatasBancos(buscar, pregunta, usadas);
      const { buenas, tecnico } = await d.puntuarHastaBuena(candidatas, pregunta, estado);
      // Un fallo técnico no es «no hay imagen buena»: se queda como estaba, pendiente, sin bajar a la IA.
      if (buenas.length === 0 && tecnico) return { rama: 'sin-puntuar' };
      if (porCommons) commons = buenas;
      else bancos = buenas;
      continue;
    }
    if (rama === 'commons') {
      const c = commons[0];
      if (esLocal(actual?.url)) await borrarSilencioso(actual.url);
      imagenes[id] = entradaNueva(id, pregunta, c, c.url, leyendaDe(pregunta, c));
      return { rama, fuente: 'Commons' };
    }
    if (rama === 'bancos') {
      const c = bancos[0];
      const url = await d.guardarWebp(DIR_BANCO, id, c.webp);
      delete c.webp;
      if (esLocal(actual?.url) && actual.url !== url) await borrarSilencioso(actual.url);
      imagenes[id] = entradaNueva(id, pregunta, c, url, leyendaDe(pregunta, c));
      return { rama, fuente: c.fuente };
    }
    if (rama === 'ia') {
      const prompt = await d.escribirPrompt(pregunta);
      const g = prompt ? await d.generarImagen(prompt, { cupo }) : null;
      if (!g) return { rama: 'sin-imagen', conservada: conservarActual(imagenes, id, actual, marcadaMala), motivo: 'la IA no devolvió imagen' };
      const webp = await d.aWebp(g.buffer);
      // Se puntúa ANTES de guardarla: solo entra con nota >= 4 y por encima de la actual.
      const r = await d.puntuar({ url: dataUrlWebp(webp), pregunta });
      if (!r) {
        estado.fallosSeguidos += 1;
        return { rama: 'sin-puntuar' };
      }
      if (!iaMejoraActual(r.nota, actual?.nota)) {
        return { rama: 'sin-imagen', conservada: await soltarActual(imagenes, id, actual, marcadaMala), motivo: `IA descartada (nota ${r.nota})` };
      }
      if (esLocal(actual?.url) && actual.url !== `${DIR_IA}/${id}.webp`) await borrarSilencioso(actual.url);
      const url = await d.guardarWebp(DIR_IA, id, webp);
      imagenes[id] = {
        id, url, pagina: null, titulo: '', autor: null, licencia: null, fuente: 'IA',
        leyenda: CREDITO_IA.texto, prompt, proveedor: g.proveedor,
        ancho: 768, alto: 768, nota: r.nota, notaModelo: r.modelo, origen: 'lote',
      };
      return { rama, fuente: 'IA' };
    }
    // sin-imagen: se queda lo que había si no es inservible (nota >= 3, pendiente del cupo de mañana)
    return { rama, conservada: await soltarActual(imagenes, id, actual, marcadaMala) };
  }
}

/** Sin mejora posible: una imagen actual con nota >= 3 se queda (pendiente); una peor, fuera. */
function conservarActual(imagenes, id, actual, marcadaMala) {
  if (actual && actual.nota >= 3 && !marcadaMala) {
    imagenes[id] = { ...actual, pendienteMejora: true };
    return true;
  }
  return false;
}

async function soltarActual(imagenes, id, actual, marcadaMala) {
  if (conservarActual(imagenes, id, actual, marcadaMala)) return true;
  delete imagenes[id];
  if (esLocal(actual?.url)) await borrarSilencioso(actual.url);
  return false;
}

/** Borra los WebP de imagenes-ia/ e imagenes-banco/ que ninguna entrada de imagenes.json usa. */
export async function limpiarHuerfanos(imagenes, { carpetas = [DIR_IA, DIR_BANCO] } = {}) {
  const usadas = new Set(Object.values(imagenes).map((e) => e.url));
  const borradas = [];
  for (const carpeta of carpetas) {
    let nombres = [];
    try {
      nombres = await readdir(carpeta);
    } catch {
      continue;
    }
    for (const n of nombres) {
      if (!n.endsWith('.webp') || usadas.has(`${carpeta}/${n}`)) continue;
      await unlink(`${carpeta}/${n}`);
      borradas.push(`${carpeta}/${n}`);
    }
  }
  return borradas;
}

/** Autor de una página de Commons (API de extmetadata); '' si no consta. */
export async function autorDeCommons(pagina, fetchImpl = fetch) {
  const titulo = decodeURIComponent(String(pagina ?? '').replace(/^.*\/wiki\//, ''));
  if (!titulo.startsWith('File:')) return '';
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(titulo)}`;
  const r = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const paginas = Object.values((await r.json())?.query?.pages ?? {});
  return limpiarHtml(paginas[0]?.imageinfo?.[0]?.extmetadata?.Artist?.value || '').slice(0, 200).trim();
}

/**
 * CC BY / BY-SA sin autor: se completa desde Commons o la imagen se descarta (deja de enseñarse).
 * @returns {{completadas: string[], descartadas: string[]}}
 */
export async function completarAutores(imagenes, { fetchImpl = fetch } = {}) {
  const completadas = [];
  const descartadas = [];
  for (const [id, e] of Object.entries(imagenes)) {
    if (!exigeAutor(e.licencia) || String(e.autor ?? '').trim()) continue;
    let autor = '';
    try {
      autor = await autorDeCommons(e.pagina, fetchImpl);
    } catch {
      autor = '';
    }
    if (autor) {
      e.autor = autor;
      completadas.push(id);
    } else {
      delete imagenes[id];
      descartadas.push(id);
    }
  }
  return { completadas, descartadas };
}

/** Markdown para que Carlos mire a ojo lo que decidió un juez poco fiable: IA aceptadas y nuevas de nota 5. */
export function listaRevision(imagenes, preguntas) {
  const porId = Object.fromEntries(preguntas.map((p) => [p.id, p]));
  const filas = Object.entries(imagenes)
    .filter(([, e]) => e.fuente === 'IA' || (e.origen === 'lote' && e.nota === 5))
    .sort(([a], [b]) => a.localeCompare(b));
  const corto = (t) => String(t ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 80);
  return [
    '# Revisión humana de imágenes (generado por tools/mejorar-imagenes.js)',
    '',
    'El juez automático es poco fiable: aquí van las imágenes IA aceptadas y las nuevas con nota 5. Si alguna es mala, márcala con «imagen mala» en la app o dímelo con su id.',
    '',
    `Total: ${filas.length}`,
    '',
    '| id | enunciado | fuente | nota | imagen |',
    '| --- | --- | --- | --- | --- |',
    ...filas.map(([id, e]) => `| ${id} | ${corto(porId[id]?.enunciado)} | ${e.fuente} | ${e.nota ?? '-'} | ${e.url.startsWith('http') ? e.pagina ?? e.url : e.url} |`),
    '',
  ].join('\n');
}

async function guardarTodo(imagenes, estado) {
  await mkdir('tmp', { recursive: true });
  await writeFile(RUTA_IMAGENES, JSON.stringify(imagenes, null, 2) + '\n', 'utf8');
  await writeFile(RUTA_ESTADO, JSON.stringify(estado, null, 2), 'utf8');
}

// --- Cifras de Más o menos (--cifras, spec v0.3 §7 y plan 8.1b) ---------------------------------------------
// La foto de cada cifra es la P18 de Wikidata (fichero de Commons con autor y licencia ya comprobados por
// tools/construir-cifras.js). Aquí se puntúa con el mismo juez que las preguntas y se aplica la misma decisión:
// nota >= 4 se queda; si no, bancos libres (opcional, no se usa: una foto de otro banco no sería «la» foto de
// esa montaña) y por último la IA, que solo entra si la política lo admite y mejora. Con las cifras la política
// la bloquea siempre: todas son cosas reales con nombre (países, montañas, cuadros, batallas), y `iaPermitida`
// no admite arte, ni lugares, ni hechos concretos. Si no hay foto buena, la tarjeta se ve con el color del área.

const ETIQUETA_CATEGORIA = {
  'altitud-montana': 'altitud de una montaña', 'altura-edificio': 'altura de un edificio', 'longitud-rio': 'longitud de un río',
  'poblacion-pais': 'población de un país', 'poblacion-ciudad': 'población de una ciudad', 'superficie-pais': 'superficie de un país',
  'pib-pais': 'PIB de un país', 'ano-obra': 'año de una obra', 'ano-hecho': 'año de un hecho histórico',
};
// Las categorías de tamaño (las que se dibujan a escala) se puntúan antes que las de fechas.
const CATEGORIAS_DE_TAMANO = new Set(['altitud-montana', 'altura-edificio', 'longitud-rio', 'poblacion-pais', 'poblacion-ciudad', 'superficie-pais', 'pib-pais']);

/** La cifra como «pregunta» para el juez de imágenes y para `iaPermitida` (que mira nombres propios). */
export function preguntaDeCifra(cifra) {
  return {
    id: cifra.id, area: cifra.area,
    enunciado: `foto de ${cifra.nombre} (${ETIQUETA_CATEGORIA[cifra.categoria] ?? cifra.categoria})`,
    explicacion: `${cifra.valor} ${cifra.unidad}`,
  };
}

/**
 * ¿Puede la IA ilustrar esta cifra? Toda cifra es una cosa real con nombre, sea cual sea su área (el PIB de Brasil
 * también): se aplica la regla estricta de historia y geografía (ni nombres propios, ni lugares, ni hechos), que
 * en la práctica la bloquea siempre.
 */
export function iaPermitidaCifra(cifra) {
  return iaPermitida({ ...preguntaDeCifra(cifra), area: cifra.area === 'arte' ? 'arte' : 'geografia' });
}

/**
 * Siguiente paso para la foto de una cifra: `'puntuar'` (hay foto de Wikidata sin nota) o lo que decida
 * `decidirRama` con las fuentes alternativas ya agotadas (Commons es la propia P18; los bancos libres no
 * aplican). Una imagen con licencia no libre o sin autor no cuenta como foto.
 */
export function decidirRamaCifra({ cifra, marcadaMala = false, cupoLibre = false, iaOk = iaPermitidaCifra(cifra) }) {
  const imagen = cifra.imagen && (cifra.imagen.fuente === 'IA' || creditoCompleto(cifra.imagen)) ? cifra.imagen : null;
  if (imagen && imagen.nota == null) return 'puntuar';
  return decidirRama({ actual: imagen, marcadaMala, candidatasCommons: [], candidatasBancos: [], cupoLibre, iaOk });
}

/** Aplica la decisión a una cifra (muta `cifra`). → `{ rama, ... }`; `sin-puntuar` = fallo técnico, se reintenta. */
export async function mejorarCifra(cifra, ctx) {
  const { cupo, args, estado } = ctx;
  const d = {
    puntuar: puntuarConReintento, guardarWebp, aWebp, generarImagen,
    escribirPrompt: (p) => escribirPrompt(p, { llamarModelo: ({ mensajes }) => llamarTexto(mensajes) }),
    ...(ctx.deps ?? {}),
  };
  const pregunta = preguntaDeCifra(cifra);
  for (let vuelta = 0; vuelta < 3; vuelta += 1) {
    const iaOk = ctx.iaOk ?? iaPermitidaCifra(cifra);
    const rama = decidirRamaCifra({ cifra, marcadaMala: ctx.malas?.has(cifra.id) ?? false, cupoLibre: !args.sinIa && cupo.puede(), iaOk });
    if (rama === 'mantener') return { rama };
    if (rama === 'puntuar') {
      const r = await d.puntuar({ url: cifra.imagen.url, pregunta });
      if (!r) {
        estado.fallosSeguidos += 1;
        return { rama: 'sin-puntuar' };
      }
      estado.fallosSeguidos = 0;
      estado.puntuadas += 1;
      cifra.imagen = { ...cifra.imagen, nota: r.nota, notaModelo: r.modelo };
      continue;
    }
    if (rama === 'ia') {
      const prompt = await d.escribirPrompt(pregunta);
      const g = prompt ? await d.generarImagen(prompt, { cupo }) : null;
      if (!g) return { rama: 'sin-imagen', motivo: 'la IA no devolvió imagen', ...soltarFotoDeCifra(cifra) };
      const webp = await d.aWebp(g.buffer);
      const r = await d.puntuar({ url: dataUrlWebp(webp), pregunta });
      if (!r) {
        estado.fallosSeguidos += 1;
        return { rama: 'sin-puntuar' };
      }
      if (!iaMejoraActual(r.nota, cifra.imagen?.nota)) return { rama: 'sin-imagen', motivo: `IA descartada (nota ${r.nota})`, ...soltarFotoDeCifra(cifra) };
      const url = await d.guardarWebp(DIR_IA, `cifra-${cifra.id}`, webp);
      cifra.imagen = { url, fuente: 'IA', nota: r.nota, notaModelo: r.modelo };
      return { rama: 'ia', fuente: 'IA' };
    }
    return { rama, ...soltarFotoDeCifra(cifra) };
  }
  return { rama: 'sin-puntuar' };
}

/** Sin foto buena: fuera la P18 puntuada por debajo de 4 (la tarjeta usa el color del área). */
function soltarFotoDeCifra(cifra) {
  const tenia = Boolean(cifra.imagen);
  delete cifra.imagen;
  return { soltada: tenia };
}

async function mainCifras(args) {
  const { serializar, RUTA_CIFRAS } = await import('./construir-cifras.js');
  const cifras = await leerJson(RUTA_CIFRAS, []);
  const malas = new Set(await leerJson(RUTA_MALAS, []));
  const cupo = crearCupo({ ruta: RUTA_CUPO });
  const pendientes = cifras
    .filter((c) => c.imagen && c.imagen.nota == null && c.imagen.fuente !== 'IA' && (!args.ids || args.ids.includes(c.id)))
    .sort((a, b) => Number(CATEGORIAS_DE_TAMANO.has(b.categoria)) - Number(CATEGORIAS_DE_TAMANO.has(a.categoria)))
    .slice(0, args.limite);
  const resumen = { total: cifras.length, conFoto: cifras.filter((c) => c.imagen).length, puntuadas: cifras.filter((c) => c.imagen?.nota != null).length, pendientes: pendientes.length };
  if (args.dryRun) {
    console.log('Dry-run de cifras (sin llamar a ningún modelo):', resumen);
    console.log(`Cupo IA de hoy: ${JSON.stringify(cupo.estadoHoy())}`);
    return;
  }
  const estado = { fallosSeguidos: 0, puntuadas: 0 };
  const ctx = { malas, cupo, args, estado };
  const cuenta = {};
  let n = 0;
  console.log(`Cifras con foto pendiente de nota: ${pendientes.length}. Cupo IA de hoy: ${JSON.stringify(cupo.estadoHoy())}`);
  for (const cifra of pendientes) {
    if (estado.fallosSeguidos >= 8) {
      console.log('Los modelos de visión no responden (8 fallos seguidos): se paró; relanza el comando más tarde.');
      break;
    }
    try {
      const r = await mejorarCifra(cifra, ctx);
      const clave = r.rama === 'sin-puntuar' ? 'sin puntuar (pendiente)' : r.rama === 'mantener' ? 'mantenida' : r.soltada ? 'foto floja: color del área' : r.rama;
      cuenta[clave] = (cuenta[clave] ?? 0) + 1;
      console.log(`${cifra.id} ${cifra.nombre}: ${clave}`);
    } catch (err) {
      console.log(`${cifra.id}: ERROR ${err.message.slice(0, 120)}`);
    }
    if (++n % 10 === 0) await writeFile(RUTA_CIFRAS, serializar(cifras), 'utf8');
  }
  await writeFile(RUTA_CIFRAS, serializar(cifras), 'utf8');
  console.log('\nResumen:', cuenta, '· cupo IA:', cupo.estadoHoy());
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.cifras) return mainCifras(args);
  const banco = await leerJson(RUTA_BANCO, []);
  const preguntas = (Array.isArray(banco) ? banco : banco.preguntas ?? []).filter((p, i) => (!args.area || p.area === args.area) && (!args.ids || args.ids.includes(p.id)) && i % args.cada === 0);
  const imagenes = await leerJson(RUTA_IMAGENES, {});
  const malas = new Set(await leerJson(RUTA_MALAS, []));
  const todas = Array.isArray(banco) ? banco : banco.preguntas ?? [];

  if (args.dryRun) {
    const c = { mantener: 0, 'por puntuar': 0, 'a buscar (nota < 4 o mala)': 0, 'sin imagen (a buscar)': 0 };
    for (const p of preguntas) {
      const e = imagenes[p.id];
      if (!e) c['sin imagen (a buscar)']++;
      else if (e.nota == null) c['por puntuar']++;
      else if (esBuena(e.nota) && !malas.has(p.id)) c.mantener++;
      else c['a buscar (nota < 4 o mala)']++;
    }
    console.log(`Dry-run sobre ${preguntas.length} preguntas (sin llamar a ningún modelo ni banco):`);
    console.log(c);
    console.log(`Cupo IA de hoy: ${JSON.stringify(crearCupo({ ruta: RUTA_CUPO }).estadoHoy())}`);
    return;
  }

  // Créditos: CC BY / BY-SA sin autor se completan desde Commons o se descartan antes de empezar.
  const autores = await completarAutores(imagenes);
  if (autores.completadas.length || autores.descartadas.length) console.log(`Autores completados: ${autores.completadas.join(', ') || '-'}; imágenes descartadas por no tener autor: ${autores.descartadas.join(', ') || '-'}`);

  const estado = args.continuar && existsSync(RUTA_ESTADO)
    ? await leerJson(RUTA_ESTADO, null)
    : null;
  const e = estado ?? { terminos: {}, hechas: {}, resumen: {} };
  e.fallosSeguidos = 0;
  e.puntuadas = e.puntuadas ?? 0;
  const cupo = crearCupo({ ruta: RUTA_CUPO });
  const ctx = { imagenes, malas, cupo, args, estado: e, terminos: e.terminos };

  console.log(`Preguntas: ${preguntas.length}. Cupo IA de hoy: ${JSON.stringify(cupo.estadoHoy())}`);
  const pendientes = preguntas.filter((p) => !e.hechas[p.id]).slice(0, args.limite);
  await proponerTerminos(pendientes, e.terminos, imagenes);
  await guardarTodo(imagenes, e);

  let n = 0;
  let siguiente = 0;
  // Dos preguntas a la vez (los modelos gratis limitan las peticiones por minuto): el cuello de botella son las esperas de red, no la CPU.
  async function trabajador() {
    while (siguiente < pendientes.length && e.fallosSeguidos < 8) {
      const p = pendientes[siguiente++];
      try {
        const r = await mejorarUna(p, ctx);
        if (r.rama !== 'sin-puntuar') e.hechas[p.id] = { rama: r.rama, fuente: r.fuente ?? null, fecha: new Date().toISOString().slice(0, 10) };
        const clave = r.rama === 'sin-puntuar' ? 'sin puntuar (se reintenta)' : r.rama === 'sin-imagen' ? (r.conservada ? 'pendiente (se queda la mediocre)' : 'sin imagen') : r.rama === 'mantener' ? 'mantenida' : `sustituida/nueva: ${r.fuente}`;
        e.resumen[clave] = (e.resumen[clave] ?? 0) + 1;
        console.log(`${p.id}: ${clave}`);
      } catch (err) {
        console.log(`${p.id}: ERROR ${err.message.slice(0, 120)}`);
      }
      if (++n % 10 === 0) await guardarTodo(imagenes, e);
    }
  }
  await Promise.all([trabajador(), trabajador()]);
  if (e.fallosSeguidos >= 8) console.log('Los modelos de visión no responden (8 fallos seguidos): se paró; lanza de nuevo con --continuar.');
  await guardarTodo(imagenes, e);
  console.log('\nResumen de esta ejecución (acumulado):', e.resumen);
  console.log('Cupo IA:', cupo.estadoHoy());
}

const esCLI = process.argv[1] && process.argv[1].endsWith('mejorar-imagenes.js');
if (esCLI) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
