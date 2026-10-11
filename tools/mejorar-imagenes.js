// CLI: lote de mejora del banco de imágenes (spec v0.3 §7). Para cada pregunta del banco:
//   (a) si tiene imagen con nota >= 4 y no está marcada mala, se queda;
//   (b) si no, busca en Commons (mejor búsqueda) y puntúa las candidatas;
//   (c) si ninguna llega a 4, busca en los bancos libres (Openverse, Met, AIC, NASA);
//   (d) si tampoco, genera una imagen con IA (último recurso; cupo <= 100/día, tope 0,10 €/día);
//   (e) si no hay cupo, queda como estaba (con su imagen mediocre, pendiente) o, si no tenía, sin imagen.
// Cada entrada de datos/imagenes.json gana `nota`, `notaModelo` y `fuente`. Las de bancos distintos de
// Commons se guardan optimizadas (WebP <= 80 KB) en imagenes-banco/<id>.webp y las de IA en
// imagenes-ia/<id>.webp, para no depender de enlaces externos ni pesar en el móvil.
//
// Reanudable (`--continuar`): el progreso va en tmp/mejorar-imagenes.estado.json.
// Uso: node --env-file=.env tools/mejorar-imagenes.js [--continuar] [--dry-run] [--limite N] [--ids a,b,c]
//        [--sin-ia] [--area X]
// Solo datos públicos (cultura general + imágenes libres). Nunca lee ni imprime claves.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { llamar, extraerJson } from './openrouter.js';
import { buscarEnCommons, elegirImagen } from './buscar-imagenes.js';
import { buscarEnBancos } from './bancos-libres.js';
import { puntuarImagen, esBuena } from './nota-imagen.js';
import { escribirPrompt, generarImagen, crearCupo, aWebp } from '../servidor/imagen-ia.js';

const RUTA_BANCO = 'datos/banco.json';
const RUTA_IMAGENES = 'datos/imagenes.json';
const RUTA_MALAS = 'datos/imagenes-malas.json';
const RUTA_ESTADO = 'tmp/mejorar-imagenes.estado.json';
const RUTA_CUPO = 'datos/cupo-ia.json';
const DIR_IA = 'imagenes-ia';
const DIR_BANCO = 'imagenes-banco';
const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';
const MAX_CANDIDATAS_POR_FUENTE = 3;
const PAUSA_COMMONS_MS = 500;
const MODELOS_TEXTO = ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'];

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decide el siguiente paso para una pregunta. Función pura: `undefined` en una lista = «aún no se
 * ha consultado esa fuente» (devuelve `buscar-*`); un array (aunque esté vacío) = ya consultada y
 * son sus candidatas con nota >= 4.
 * @returns {'mantener'|'buscar-commons'|'commons'|'buscar-bancos'|'bancos'|'ia'|'sin-imagen'}
 */
export function decidirRama({ actual, marcadaMala = false, candidatasCommons, candidatasBancos, cupoLibre = false }) {
  if (actual && esBuena(actual.nota) && !marcadaMala) return 'mantener';
  if (candidatasCommons === undefined) return 'buscar-commons';
  if (candidatasCommons.length > 0) return 'commons';
  if (candidatasBancos === undefined) return 'buscar-bancos';
  if (candidatasBancos.length > 0) return 'bancos';
  return cupoLibre ? 'ia' : 'sin-imagen';
}

function parsearArgs(argv) {
  const a = { continuar: false, dryRun: false, limite: Infinity, ids: null, sinIa: false, area: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--continuar') a.continuar = true;
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--sin-ia') a.sinIa = true;
    else if (argv[i] === '--limite') a.limite = Number(argv[++i]);
    else if (argv[i] === '--ids') a.ids = argv[++i].split(',');
    else if (argv[i] === '--area') a.area = argv[++i];
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

async function bajar(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const dataUrlWebp = (buffer) => `data:image/webp;base64,${buffer.toString('base64')}`;

async function llamarTexto(mensajes, json = false) {
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
async function candidatasCommons(terminos, pregunta, usadas) {
  const lista = [];
  for (const termino of terminos) {
    await esperar(PAUSA_COMMONS_MS);
    const { paginas } = await buscarEnCommons(termino);
    for (const pagina of paginas) {
      const c = elegirImagen([pagina], pregunta);
      if (c) lista.push({ url: c.url, pagina: c.pagina, titulo: c.titulo, autor: c.autor, licencia: c.licencia, fuente: 'Commons', ancho: c.ancho, alto: c.alto, termino });
    }
  }
  return sinRepetirUrls(lista, usadas).slice(0, MAX_CANDIDATAS_POR_FUENTE);
}

async function candidatasBancos(terminos, pregunta, usadas) {
  const lista = [];
  for (const termino of terminos) lista.push(...(await buscarEnBancos(termino, { area: pregunta.area })));
  return sinRepetirUrls(lista, usadas).slice(0, MAX_CANDIDATAS_POR_FUENTE);
}

/** Puntúa candidatas en orden y devuelve las que llegan a 4 (se detiene en la primera buena). */
async function puntuarHastaBuena(candidatas, pregunta, estado) {
  const buenas = [];
  for (const c of candidatas) {
    let urlParaModelo = c.url;
    let webp = null;
    if (c.fuente !== 'Commons') {
      try {
        webp = await aWebp(await bajar(c.url));
        const { default: sharp } = await import('sharp');
        const m = await sharp(webp).metadata();
        if (Math.min(m.width ?? 0, m.height ?? 0) < 400) continue;
        urlParaModelo = dataUrlWebp(webp);
        c.ancho = m.width;
        c.alto = m.height;
      } catch {
        continue;
      }
    }
    const r = await puntuarImagen({ url: urlParaModelo, pregunta });
    if (!r) {
      estado.fallosSeguidos += 1;
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
  return buenas;
}

async function guardarWebp(carpeta, id, buffer) {
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
  };
}

const leyendaDe = (pregunta, c) => (c.titulo ? String(c.titulo).replace(/\.[a-z]{3,4}$/i, '').slice(0, 90) : String(pregunta.enunciado).slice(0, 90));

async function mejorarUna(pregunta, ctx) {
  const { imagenes, malas, cupo, args, estado, terminos } = ctx;
  const id = pregunta.id;
  const marcadaMala = malas.has(id);
  let actual = imagenes[id] ?? null;

  // Una imagen existente sin nota se puntúa primero.
  if (actual && actual.nota == null) {
    const r = await puntuarImagen({ url: actual.url, pregunta });
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
  const buscar = [...new Set([...(terminos[id] ?? []), pregunta.enunciado.slice(0, 60)])].slice(0, 3);
  let commons;
  let bancos;
  for (;;) {
    const rama = decidirRama({ actual, marcadaMala, candidatasCommons: commons, candidatasBancos: bancos, cupoLibre: !args.sinIa && cupo.puede() });
    if (rama === 'mantener') return { rama };
    if (rama === 'buscar-commons') {
      commons = await puntuarHastaBuena(await candidatasCommons(buscar, pregunta, usadas), pregunta, estado);
      continue;
    }
    if (rama === 'commons') {
      const c = commons[0];
      imagenes[id] = entradaNueva(id, pregunta, c, c.url, leyendaDe(pregunta, c));
      return { rama, fuente: 'Commons' };
    }
    if (rama === 'buscar-bancos') {
      bancos = await puntuarHastaBuena(await candidatasBancos(buscar, pregunta, usadas), pregunta, estado);
      continue;
    }
    if (rama === 'bancos') {
      const c = bancos[0];
      const url = await guardarWebp(DIR_BANCO, id, c.webp);
      delete c.webp;
      imagenes[id] = entradaNueva(id, pregunta, c, url, leyendaDe(pregunta, c));
      return { rama, fuente: c.fuente };
    }
    if (rama === 'ia') {
      const prompt = await escribirPrompt(pregunta, { llamarModelo: ({ mensajes }) => llamarTexto(mensajes) });
      const g = await generarImagen(prompt, { cupo });
      if (!g) return { rama: 'sin-imagen', motivo: 'la IA no devolvió imagen' };
      const webp = await aWebp(g.buffer);
      const url = await guardarWebp(DIR_IA, id, webp);
      const r = await puntuarImagen({ url: dataUrlWebp(webp), pregunta });
      imagenes[id] = {
        id, url, pagina: null, titulo: '', autor: null, licencia: null, fuente: 'IA',
        leyenda: String(pregunta.enunciado).slice(0, 90), prompt, proveedor: g.proveedor,
        ancho: 768, alto: 768, nota: r?.nota ?? null, notaModelo: r?.modelo ?? null,
      };
      return { rama, fuente: 'IA' };
    }
    // sin-imagen: se queda lo que había si no es inservible (nota >= 3, pendiente del cupo de mañana)
    if (actual && actual.nota >= 3 && !marcadaMala) {
      imagenes[id] = { ...actual, pendienteMejora: true };
      return { rama, conservada: true };
    }
    delete imagenes[id];
    return { rama, conservada: false };
  }
}

async function guardarTodo(imagenes, estado) {
  await mkdir('tmp', { recursive: true });
  await writeFile(RUTA_IMAGENES, JSON.stringify(imagenes, null, 2) + '\n', 'utf8');
  await writeFile(RUTA_ESTADO, JSON.stringify(estado, null, 2), 'utf8');
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  const banco = await leerJson(RUTA_BANCO, []);
  const preguntas = (Array.isArray(banco) ? banco : banco.preguntas ?? []).filter((p) => (!args.area || p.area === args.area) && (!args.ids || args.ids.includes(p.id)));
  const imagenes = await leerJson(RUTA_IMAGENES, {});
  const malas = new Set(await leerJson(RUTA_MALAS, []));

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
  for (const p of pendientes) {
    if (e.fallosSeguidos >= 8) {
      console.log('Los modelos de visión no responden (8 fallos seguidos): se para; lanza de nuevo con --continuar.');
      break;
    }
    try {
      const r = await mejorarUna(p, ctx);
      if (r.rama !== 'sin-puntuar') e.hechas[p.id] = { rama: r.rama, fuente: r.fuente ?? null, fecha: new Date().toISOString().slice(0, 10) };
      const clave = r.rama === 'sin-imagen' ? (r.conservada ? 'pendiente (se queda la mediocre)' : 'sin imagen') : r.rama === 'mantener' ? 'mantenida' : `sustituida/nueva: ${r.fuente}`;
      e.resumen[clave] = (e.resumen[clave] ?? 0) + 1;
      console.log(`${p.id}: ${clave}`);
    } catch (err) {
      console.log(`${p.id}: ERROR ${err.message.slice(0, 120)}`);
    }
    if (++n % 10 === 0) await guardarTodo(imagenes, e);
  }
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
