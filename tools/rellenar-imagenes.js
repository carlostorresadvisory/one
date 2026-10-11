// ONE · da imagen a las preguntas de datos/banco.json que no tienen entrada en datos/imagenes.json y a las
// cifras de datos/cifras.json sin `imagen` (spec v0.3 §7). Fuentes en orden: Commons -> Openverse / museos / NASA
// -> IA (Cloudflare FLUX, solo preguntas que la política admite, cupo propio). Reglas:
//   - Commons responde 429 a ráfagas: todas sus peticiones pasan por UNA cola en serie con pausa, y el juez de
//     visión recibe la miniatura de 500 px YA DESCARGADA (data URL base64), nunca la URL de Commons.
//   - Una candidata solo entra con nota >= 4 del juez gratis; se guarda como WebP de 500 px <= 80 KB en
//     imagenes-banco/ (preguntas: <id>.webp; cifras: cifra-<id>.webp) con credito/autor/licencia/pagina.
//   - Nunca modelos de pago. Si los modelos de visión dejan de responder (8 fallos seguidos) se para.
// Reanudable: tmp/rellenar-estado.json guarda términos y lo ya intentado. Uso:
//   node --env-file=.env tools/rellenar-imagenes.js [--que preguntas|cifras|ambas] [--limite N] [--ids a,b]
//        [--sin-ia] [--pausa 1200] [--candidatas 4] [--dry-run]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { extraerJson } from './openrouter.js';
import { buscarEnCommons, elegirImagen } from './buscar-imagenes.js';
import { buscarEnBancos } from './bancos-libres.js';
import { puntuarImagen, esBuena } from './nota-imagen.js';
import { urlMiniatura } from './copiar-fotos-commons.js';
import { llamarTexto, dataUrlWebp, preguntaDeCifra, guardarWebp } from './mejorar-imagenes.js';
import { serializar, RUTA_CIFRAS } from './construir-cifras.js';
import { ESTILO_ONE, escribirPrompt, generarImagen, crearCupo, aWebp as aWebpIA, CREDITO_IA } from '../servidor/imagen-ia.js';
import { iaPermitida, iaMejoraActual, creditoCompleto, descargarAcotado } from '../servidor/politica-imagen.js';

const RUTA_BANCO = 'datos/banco.json';
const RUTA_IMAGENES = 'datos/imagenes.json';
const RUTA_ESTADO = 'tmp/rellenar-estado.json';
const RUTA_CUPO = 'datos/cupo-ia.json';
const DIR_BANCO = 'imagenes-banco';
const DIR_IA = 'imagenes-ia';
const UA = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub; relleno de imagenes)';
const ANCHO = 500;
const MAX_BYTES = 80 * 1024;

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const QUE = arg('que', 'ambas');
const LIMITE = Number(arg('limite', Infinity));
const IDS = arg('ids', null)?.split(',') ?? null;
const SIN_IA = process.argv.includes('--sin-ia');
const MAX_IA = Number(arg('ia-max', 200)); // cupo propio de IA de hoy (Carlos, 12-oct: 200 para este lote único)
const DRY = process.argv.includes('--dry-run');
const PAUSA = Math.max(1000, Number(arg('pausa', 1200)));
const MAX_CAND = Number(arg('candidatas', 4));
const MAX_BRUTAS = 10; // candidatas antes del filtro de títulos
// Juez: Groq (Qwen con visión, gratis y rápido) primero; los de Gemini y NVIDIA (gratis) como respaldo. Nunca de pago.
const MODELOS_JUEZ = ['groq:qwen/qwen3.8-27b', 'gemini:gemini-flash-lite-latest', 'gemini:gemini-3.6-flash', 'nvidia:meta/llama-3.2-11b-vision-instruct'];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Cola en serie para Commons (y pausa mínima entre peticiones) -------------------------------------------
let cola = Promise.resolve();
export function enCola(fn) {
  const r = cola.then(fn, fn);
  cola = r.then(() => dormir(PAUSA), () => dormir(PAUSA));
  return r;
}

async function bajarCommons(url) {
  for (let intento = 0; intento < 6; intento++) {
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(30000) }); }
    catch { await dormir(3000 * (intento + 1)); continue; }
    if (r.status === 200) return Buffer.from(await r.arrayBuffer());
    await r.arrayBuffer().catch(() => {});
    if (r.status === 429 || r.status >= 500) { await dormir(Math.min(60, Number(r.headers.get('retry-after')) || 5 * (intento + 1)) * 1000 + 500); continue; }
    return null;
  }
  return null;
}

/** WebP de 500 px de ancho y <= 80 KB. */
export async function aWebp500(buf) {
  let salida;
  for (const q of [75, 68, 60, 52, 45, 38]) {
    salida = await sharp(buf, { limitInputPixels: 64e6 }).rotate().resize({ width: ANCHO, withoutEnlargement: true }).webp({ quality: q, effort: 5 }).toBuffer();
    if (salida.length <= MAX_BYTES) return salida;
  }
  return salida;
}

// --- Términos de búsqueda ----------------------------------------------------------------------------------
const PROMPT_TERMINOS_PREG = 'Para cada pregunta de un quiz propones 2 términos de búsqueda en INGLÉS (1-4 palabras cada uno) para encontrar en un banco de fotos libres una imagen llamativa, a color y de primer plano del TEMA (un objeto, lugar, escena u obra concreta que lo represente; nada de diagramas, tablas, retratos de cartel ni capturas). No uses la respuesta como término si la revela. Devuelve SOLO JSON {"<id>": ["término 1", "término 2"], ...}.';
const PROMPT_TERMINOS_CIFRA = 'Para cada elemento (un país, ciudad, montaña, edificio, río, obra o hecho) propones 2 términos de búsqueda en INGLÉS (1-4 palabras) para encontrar en un banco de fotos libres UNA FOTO llamativa y a color que lo represente: para un país o ciudad, un monumento o paisaje famoso de allí (nunca banderas, mapas ni escudos); para una montaña, edificio o río, el propio lugar; para una obra, la obra; para un hecho, una imagen icónica del hecho. Devuelve SOLO JSON {"<id>": ["término 1", "término 2"], ...}.';

async function proponerTerminos(items, estado, prompt, lineaDe) {
  const faltan = items.filter((x) => !estado.terminos[x.id]);
  for (let i = 0; i < faltan.length; i += 10) {
    const lote = faltan.slice(i, i + 10);
    try {
      const texto = await llamarTexto([{ role: 'system', content: prompt }, { role: 'user', content: lote.map(lineaDe).join('\n') }], true);
      const datos = extraerJson(texto);
      for (const x of lote) {
        const t = (Array.isArray(datos[x.id]) ? datos[x.id] : []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 2);
        if (t.length) estado.terminos[x.id] = t;
      }
    } catch (e) { console.log(`  términos: lote ${i / 10 + 1} falló (${String(e.message).slice(0, 80)})`); }
  }
}

// --- Candidatas --------------------------------------------------------------------------------------------
async function candidatasCommons(terminos, usadas) {
  const lista = [];
  for (const termino of terminos) {
    const { paginas, error } = await enCola(() => buscarEnCommons(termino));
    if (error && paginas.length === 0) throw new Error(`Commons: ${error}`);
    for (const pagina of paginas) {
      const c = elegirImagen([pagina], { enunciado: termino, explicacion: '' });
      if (c && !usadas.has(c.pagina)) lista.push({ url: c.url, pagina: c.pagina, titulo: c.titulo, autor: c.autor, licencia: c.licencia, fuente: 'Commons', ancho: c.ancho, alto: c.alto, termino });
    }
  }
  const vistas = new Set();
  return lista.filter(creditoCompleto).filter((c) => (vistas.has(c.pagina) ? false : (vistas.add(c.pagina), true))).slice(0, MAX_BRUTAS);
}

async function candidatasBancos(terminos, area, usadas) {
  const lista = [];
  for (const termino of terminos) lista.push(...(await buscarEnBancos(termino, { area })));
  const vistas = new Set();
  return lista.filter(creditoCompleto).filter((c) => !usadas.has(c.pagina) && (vistas.has(c.url) ? false : (vistas.add(c.url), true))).slice(0, MAX_BRUTAS);
}

/** Descarga la candidata y la devuelve como WebP de 500 px (null = no se pudo; 'pequena' = descartada por tamaño). */
async function traer(c) {
  try {
    let buf;
    if (c.fuente === 'Commons') {
      buf = await enCola(() => bajarCommons(urlMiniatura(c.url)));
      if (!buf) return null;
    } else {
      buf = await descargarAcotado(c.url, { userAgent: UA, timeoutMs: 40000 });
    }
    const webp = await aWebp500(buf);
    const m = await sharp(webp).metadata();
    if (Math.min(m.width ?? 0, m.height ?? 0) < 300) return 'pequena';
    return { webp, ancho: m.width, alto: m.height };
  } catch { return null; }
}

async function juzgar(webp, pregunta, estado) {
  // Los jueces gratis tienen tope diario/por minuto de tokens: si ninguno responde, se espera (10 min) y se reintenta.
  for (let ronda = 0; ronda < 8; ronda++) {
    const r = await puntuarImagen({ url: dataUrlWebp(webp), pregunta }, { modelos: MODELOS_JUEZ });
    if (r) { estado.fallosSeguidos = 0; estado.esperas = 0; return r; }
    estado.fallosSeguidos += 1;
    if (ronda >= 1) { console.log('  juez sin cupo: espero 10 min'); await dormir(600000); }
    else await dormir(20000);
  }
  return null;
}

// --- Filtro de relevancia por título (texto, gratis): el juez de visión no es fiable para descartar fotos sin relación ---
async function filtrarRelevantes(cands, pregunta) {
  if (cands.length === 0) return cands;
  const lista = cands.map((c, i) => `${i}: «${String(c.titulo).slice(0, 110)}» (${c.fuente})`).join('\n');
  try {
    const texto = await llamarTexto([
      { role: 'system', content: 'Filtras fotos candidatas para ilustrar la pregunta de un quiz. Te doy la pregunta y una lista de títulos de fotos. Marca como válida SOLO la foto cuyo título indica claramente que muestra el tema de la pregunta o algo muy ligado a él (el lugar, la obra, el objeto, el fenómeno, la escena o el elemento que la pregunta trata). Descarta también la foto cuyo título nombra o identifica directamente la RESPUESTA correcta cuando la pregunta pide identificarla (no puede regalarla). Descarta lo genérico, lo de otro tema, diagramas, tablas, mapas, banderas, logotipos, carteles, documentos y retratos sin relación. Devuelve SOLO JSON {"validas": [índices]}.' },
      { role: 'user', content: `Pregunta: ${pregunta.enunciado}\nTema (la foto NO debe mostrar la respuesta como texto): ${String(pregunta.explicacion ?? '').slice(0, 250)}\n\nCandidatas:\n${lista}` },
    ], true);
    const v = extraerJson(texto)?.validas;
    if (!Array.isArray(v)) return cands; // sin criterio fiable: que decida el juez de visión
    return cands.filter((_, i) => v.map(Number).includes(i));
  } catch { return cands; }
}

/** Recorre las candidatas hasta la primera con nota >= 4. → { buena, tecnico } */
async function primeraBuena(cands, pregunta, estado, notas) {
  let tecnico = false;
  for (const c of cands) {
    const t = await traer(c);
    if (t === 'pequena') continue;
    if (!t) { tecnico = true; continue; }
    const r = await juzgar(t.webp, { ...pregunta, enunciado: `${pregunta.enunciado}
(Título de la foto en su banco: ${String(c.titulo).slice(0, 100)})` }, estado);
    if (!r) { tecnico = true; if (estado.fallosSeguidos >= 40) break; continue; }
    notas.push(r.nota);
    if (esBuena(r.nota)) return { buena: { ...c, ...t, nota: r.nota, notaModelo: r.modelo }, tecnico };
  }
  return { buena: null, tecnico };
}

// --- Una pregunta / una cifra ------------------------------------------------------------------------------
async function buscarFuentes({ pregunta, area, terminos, usadas, estado }) {
  if (estado.buscadas?.[pregunta.id]) return { buena: null, notas: [], tecnico: false }; // ya se buscó sin éxito: solo queda la IA
  const notas = [];
  const q = [...new Set([...(terminos ?? []), String(pregunta.enunciado).slice(0, 60)])].slice(0, 3);
  let tecnico = false;
  for (const fuente of ['commons', 'bancos']) {
    const cands = fuente === 'commons' ? await candidatasCommons(q, usadas) : await candidatasBancos(q.slice(0, 2), area, usadas);
    const r = await primeraBuena((await filtrarRelevantes(cands, pregunta)).slice(0, MAX_CAND), pregunta, estado, notas);
    tecnico ||= r.tecnico;
    if (r.buena) return { buena: r.buena, notas };
    if (estado.fallosSeguidos >= 40) break;
  }
  if (!tecnico && estado.fallosSeguidos < 40) (estado.buscadas ??= {})[pregunta.id] = true;
  return { buena: null, notas, tecnico };
}

async function rellenarPregunta(p, ctx) {
  const { imagenes, estado, usadas, cupo } = ctx;
  const { buena, tecnico } = await buscarFuentes({ pregunta: p, area: p.area, terminos: estado.terminos[p.id], usadas, estado });
  if (buena) {
    const url = await guardarWebp(DIR_BANCO, p.id, buena.webp);
    imagenes[p.id] = {
      id: p.id, url, pagina: buena.pagina ?? null, titulo: buena.titulo ?? '', autor: buena.autor ?? '', licencia: buena.licencia ?? null, fuente: buena.fuente,
      leyenda: (buena.titulo ? String(buena.titulo).replace(/\.[a-z]{3,4}$/i, '') : String(p.enunciado)).slice(0, 90),
      termino: buena.termino ?? null, ancho: buena.ancho, alto: buena.alto, nota: buena.nota, notaModelo: buena.notaModelo, origen: 'lote',
    };
    usadas.add(buena.pagina);
    return { rama: 'nueva', fuente: buena.fuente, nota: buena.nota };
  }
  if (tecnico || estado.fallosSeguidos >= 40) return { rama: 'tecnico' };
  return viaIA(p, p, ctx, p.id, p.id);
}


// --- Último recurso: IA (Cloudflare FLUX, cupo propio). Regla de Carlos (12-oct): ninguna pregunta ni cifra sin imagen.
// Si la política normal no admite IA (arte, hechos o lugares concretos, cifras de cosas reales), se usa un prompt
// SIMBÓLICO: escena atmosférica del tema, sin personas reales, sin obras, sin mapas, sin banderas, sin texto.
const PROMPT_SIMBOLICO = 'You write one image-generation prompt in English (max 40 words) for a striking, ATMOSPHERIC and SYMBOLIC scene that evokes the general theme of a quiz item (e.g. a typical landscape of a region, an emblematic object of the field, an abstract metaphor). NEVER depict real or identifiable people, specific artworks, maps, flags, logos, or any text, letters or numbers; do not depict or hint at the answer. Reply with just the prompt, no quotes.';
async function promptSimbolico(pregunta) {
  const t = await llamarTexto([{ role: 'system', content: PROMPT_SIMBOLICO }, { role: 'user', content: `Item: ${pregunta.enunciado}
Answer (do NOT depict it): ${pregunta.explicacion ?? ''}` }]);
  const limpio = String(t ?? '').replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[.,;\s]+$/, '');
  return limpio ? `${limpio}, ${ESTILO_ONE}` : null;
}

async function viaIA(item, pregunta, ctx, nombre, id) {
  const { imagenes, cupo } = ctx;
  if (SIN_IA || ctx.iaCaida >= 3 || !cupo.puede()) return { rama: 'pendiente-ia', motivo: 'IA no disponible ahora (desactivada, cupo o tramo diario agotado)' };
  const normal = iaPermitida(pregunta) && !ctx.esCifra?.(item);
  for (let intento = 0; intento < 2; intento++) {
    const llamarModelo = ({ mensajes }) => llamarTexto(mensajes);
    const prompt = normal && intento === 0 ? await escribirPrompt(pregunta, { llamarModelo }) : await promptSimbolico(pregunta);
    const g = prompt ? await generarImagen(prompt, { cupo }) : null;
    if (!g) { ctx.iaCaida = (ctx.iaCaida ?? 0) + 1; return { rama: 'pendiente-ia', motivo: 'la IA no devolvió imagen (¿tramo gratis diario agotado?)' }; }
    ctx.iaCaida = 0;
    const webp = await aWebpIA(g.buffer);
    const r = await juzgar(webp, pregunta, ctx.estado);
    if (!r) return { rama: 'tecnico' };
    if (!iaMejoraActual(r.nota, undefined)) { if (intento === 1) return { rama: 'sin-imagen', motivo: `IA descartada (nota ${r.nota})` }; continue; }
    const url = await guardarWebp(DIR_IA, nombre, webp);
    if (ctx.esCifra?.(item)) item.imagen = { url, fuente: 'IA', nota: r.nota, notaModelo: r.modelo };
    else imagenes[id] = { id, url, pagina: null, titulo: '', autor: null, licencia: null, fuente: 'IA', leyenda: CREDITO_IA.texto, prompt, proveedor: g.proveedor, ancho: 768, alto: 768, nota: r.nota, notaModelo: r.modelo, origen: 'lote' };
    return { rama: 'nueva', fuente: 'IA', nota: r.nota };
  }
  return { rama: 'sin-imagen', motivo: 'IA descartada' };
}

async function rellenarCifra(c, ctx) {
  const { estado, usadas } = ctx;
  const { buena, tecnico } = await buscarFuentes({ pregunta: preguntaDeCifra(c), area: c.area, terminos: estado.terminos[c.id], usadas, estado });
  if (!buena) {
    if (tecnico || estado.fallosSeguidos >= 40) return { rama: 'tecnico' };
    return viaIA(c, preguntaDeCifra(c), ctx, `cifra-${c.id}`, c.id);
  }
  const url = await guardarWebp(DIR_BANCO, `cifra-${c.id}`, buena.webp);
  c.imagen = { url, pagina: buena.pagina, autor: buena.autor, licencia: buena.licencia, fuente: buena.fuente, nota: buena.nota, notaModelo: buena.notaModelo };
  usadas.add(buena.pagina);
  return { rama: 'nueva', fuente: buena.fuente, nota: buena.nota };
}

// --- Principal ---------------------------------------------------------------------------------------------
const leer = async (r, d) => { try { return JSON.parse(await readFile(r, 'utf8')); } catch { return d; } };

async function principal() {
  const banco = await leer(RUTA_BANCO, []);
  const preguntas = Array.isArray(banco) ? banco : banco.preguntas;
  const imagenes = await leer(RUTA_IMAGENES, {});
  const cifras = await leer(RUTA_CIFRAS, []);
  const estado = (await leer(RUTA_ESTADO, null)) ?? { terminos: {}, intentadas: {}, resumen: {} };
  estado.fallosSeguidos = 0;
  const cupo = crearCupo({ ruta: RUTA_CUPO, maxDia: MAX_IA });
  const usadas = new Set([...Object.values(imagenes).map((e) => e.pagina), ...cifras.map((c) => c.imagen?.pagina)].filter(Boolean));

  const pendP = QUE === 'cifras' ? [] : preguntas.filter((p) => !imagenes[p.id] && !estado.intentadas[p.id] && (!IDS || IDS.includes(p.id))).slice(0, LIMITE);
  const pendC = QUE === 'preguntas' ? [] : cifras.filter((c) => !c.imagen && !estado.intentadas[c.id] && (!IDS || IDS.includes(c.id))).slice(0, LIMITE);
  console.log(`Pendientes: ${pendP.length} preguntas, ${pendC.length} cifras. Cupo IA de hoy: ${JSON.stringify(cupo.estadoHoy())}`);
  if (DRY) return;
  await mkdir('tmp', { recursive: true });
  const guardarEstado = () => writeFile(RUTA_ESTADO, JSON.stringify(estado, null, 1), 'utf8');
  const guardarTodo = async () => {
    await writeFile(RUTA_IMAGENES, JSON.stringify(imagenes, null, 2) + '\n', 'utf8');
    await writeFile(RUTA_CIFRAS, serializar(cifras), 'utf8');
    await guardarEstado();
  };

  await proponerTerminos(pendP, estado, PROMPT_TERMINOS_PREG, (p) => `${p.id}: ${p.enunciado} (respuesta: ${p.explicacion ?? ''})`.slice(0, 400));
  await proponerTerminos(pendC, estado, PROMPT_TERMINOS_CIFRA, (c) => `${c.id}: ${c.nombre} (${c.categoria})`);
  await guardarEstado();

  const ctx = { imagenes, estado, usadas, cupo, esCifra: (x) => 'categoria' in x };
  const cola2 = [...pendP.map((x) => ['p', x]), ...pendC.map((x) => ['c', x])];
  let i = 0, n = 0;
  async function trabajador() {
    while (i < cola2.length && estado.fallosSeguidos < 40) {
      const [tipo, x] = cola2[i++];
      try {
        const r = tipo === 'p' ? await rellenarPregunta(x, ctx) : await rellenarCifra(x, ctx);
        if (r.rama !== 'tecnico' && r.rama !== 'pendiente-ia') estado.intentadas[x.id] = { rama: r.rama, fuente: r.fuente ?? null, nota: r.nota ?? null, motivo: r.motivo ?? null };
        const clave = `${tipo === 'p' ? 'preguntas' : 'cifras'}: ${r.rama === 'nueva' ? `nueva ${r.fuente}` : r.rama}`;
        estado.resumen[clave] = (estado.resumen[clave] ?? 0) + 1;
        console.log(`${x.id}: ${r.rama}${r.fuente ? ` ${r.fuente} nota ${r.nota}` : ''}${r.motivo ? ` (${r.motivo})` : ''}`);
      } catch (e) { console.log(`${x.id}: ERROR ${String(e.message).slice(0, 120)}`); }
      if (++n % 5 === 0) await guardarTodo();
    }
  }
  await Promise.all([trabajador(), trabajador()]);
  await guardarTodo();
  if (estado.fallosSeguidos >= 40) console.log('Los modelos de visión no responden (8 fallos seguidos): se paró. Relanza más tarde.');
  console.log('\nResumen acumulado:', estado.resumen, '· cupo IA:', cupo.estadoHoy());
}

if (process.argv[1]?.endsWith('rellenar-imagenes.js')) principal().catch((e) => { console.error(e); process.exit(1); });
