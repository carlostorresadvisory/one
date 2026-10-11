// ONE · diagnóstico de imágenes (oct-2026). Solo LEE: no toca la app ni sus datos.
// Uso: node tools/diagnostico-imagenes.js [--base https://carlostorresadvisory.github.io/one/] [--pausa 400] [--conc 4]
// Reúne TODAS las URL que la app pediría (datos/imagenes.json = preguntas del banco; datos/cifras.json =
// tarjetas de Más o Menos; datos/imagenes-hub.json = fotos del hub), las construye como el código
// (app.js#imagenDe y masomenos-ui.js: la `url` tal cual; las relativas se resuelven contra la base de Pages),
// las pide como un iPhone Safari desde la página de Pages, y clasifica el resultado.
// --local: las rutas propias (imagenes-banco/, imagenes-hub/...) se leen del repo en vez de pedirlas a Pages (comprueba que
// el fichero existe, que es WebP/JPEG/PNG de verdad y su peso); lo ajeno (Commons, servidor) se sigue pidiendo por red.
// Escribe el detalle en tmp/diagnostico-imagenes.json y un resumen por consola.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'https://carlostorresadvisory.github.io/one/');
const PAUSA = Number(arg('pausa', 400));
const CONC = Number(arg('conc', 4));
const LOCAL = process.argv.includes('--local');
const ORIGEN = new URL(BASE).origin;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SAFARI_OK = /^image\/(jpeg|png|gif|webp|avif|svg\+xml)$/; // Safari iOS 16+ lee webp/avif; tif y otros no
const leer = (f) => JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. Inventario de URL ---
const items = [];
for (const [id, d] of Object.entries(leer('datos/imagenes.json'))) items.push({ origen: 'banco', id, url: d.url });
for (const c of leer('datos/cifras.json')) if (c.imagen?.url) items.push({ origen: 'cifra', id: c.id, url: c.imagen.url });
for (const [id, d] of Object.entries(leer('datos/imagenes-hub.json'))) items.push({ origen: 'hub', id, url: d.url });
for (const it of items) {
  it.abs = new URL(it.url, BASE).href;
  it.propia = !/^https?:/.test(it.url);
  it.local = it.propia && fs.existsSync(path.join(RAIZ, it.url));
  const w = it.url.match(/\/(\d+)px-/);
  it.ancho = w ? Number(w[1]) : (it.propia ? null : 'original');
  it.host = new URL(it.abs).hostname;
}
const unicas = [...new Map(items.map((i) => [i.abs, i])).values()];

// --- 2. Petición ---
async function pedir(it, intento = 0) {
  if (LOCAL && it.propia) {
    const f = path.join(RAIZ, it.url.split('?')[0]);
    if (!fs.existsSync(f)) return { estado: 404, bytes: 0, ms: 0 };
    const buf = fs.readFileSync(f);
    const tipo = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
      : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png' : 'desconocido';
    return { estado: 200, tipo, bytes: buf.length, ms: 0, magico: buf.subarray(0, 12).toString('latin1') };
  }
  const t0 = Date.now();
  const cab = { 'User-Agent': UA, Referer: BASE, Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5', 'Accept-Language': 'es-ES,es;q=0.9' };
  if (!it.propia) { cab.Origin = ORIGEN; } // el SW la pide con CORS; el <img> no manda Origin, pero así se ve el ACAO
  try {
    const r = await fetch(it.abs, { headers: cab, redirect: 'manual' });
    if (r.status === 429 && intento < 2) {
      const espera = Math.min(30, Number(r.headers.get('retry-after')) || 5) * 1000;
      await r.arrayBuffer().catch(() => {});
      await dormir(espera);
      return pedir(it, intento + 1);
    }
    const buf = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    if (r.status !== 200) await r.arrayBuffer().catch(() => {});
    return {
      estado: r.status, reintentos: intento, tipo: r.headers.get('content-type'), bytes: buf.length,
      acao: r.headers.get('access-control-allow-origin'), loc: r.headers.get('location'),
      cache: r.headers.get('cache-control'), retryAfter: r.headers.get('retry-after'), limite: r.headers.get('x-ratelimit-remaining'), ms: Date.now() - t0, magico: buf.subarray(0, 12).toString('latin1'),
    };
  } catch (e) {
    return { estado: 0, error: String(e.cause?.code || e.message), ms: Date.now() - t0 };
  }
}

function clasificar(it, r) {
  if (r.estado === 0) return 'ERROR_RED';
  if (r.estado >= 300 && r.estado < 400) return `REDIRECT_${r.estado}`;
  if (r.estado !== 200) return `HTTP_${r.estado}`;
  if (!SAFARI_OK.test((r.tipo || '').split(';')[0])) return 'TIPO_NO_SOPORTADO';
  if (!it.propia && !r.acao) return 'OK_SIN_CORS';
  if (r.bytes > 2 * 1024 * 1024) return 'OK_PESADA_>2MB';
  return 'OK';
}

const resultados = new Map();
// --reanudar: conserva lo ya medido en la pasada anterior salvo 429/errores de red (se repiten, con --conc 1 y --pausa alta).
if (process.argv.includes('--reanudar')) {
  const previo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tmp', 'diagnostico-imagenes.json'), 'utf8'));
  for (const f of previo.filas) if (f.estado && f.estado !== 429 && !resultados.has(f.abs)) resultados.set(f.abs, Object.fromEntries(Object.entries(f).filter(([k]) => ['estado','reintentos','tipo','bytes','acao','loc','cache','ms','magico','clase','retryAfter','limite'].includes(k))));
}
const pendientes = unicas.filter((i) => !resultados.has(i.abs));
let idx = 0, hechas = 0;
async function trabajador() {
  while (idx < pendientes.length) {
    const it = pendientes[idx++];
    const r = await pedir(it);
    r.clase = clasificar(it, r);
    resultados.set(it.abs, r);
    if (++hechas % 50 === 0) console.error(`  ${hechas}/${unicas.length}`);
    await dormir(PAUSA);
  }
}
console.error(`Pidiendo ${pendientes.length} de ${unicas.length} URL únicas (de ${items.length} usos), conc ${CONC}, pausa ${PAUSA} ms...`);
await Promise.all(Array.from({ length: CONC }, trabajador));

// --- 3. Resumen ---
const filas = items.map((it) => ({ ...it, ...resultados.get(it.abs), existeEnRepo: it.propia ? it.local : undefined }));
const cuenta = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const resumen = {
  fecha: new Date().toISOString(), base: BASE, usos: items.length, unicas: unicas.length,
  porOrigenYClase: cuenta(filas, (f) => `${f.origen}:${f.clase}`),
  porClase: cuenta(filas, (f) => f.clase),
  porAncho: cuenta(filas.filter((f) => !f.propia), (f) => `${f.ancho}px:${f.clase}`),
  tipos: cuenta(filas.filter((f) => f.estado === 200), (f) => (f.tipo || '').split(';')[0]),
  pesoMedioKB: Math.round(filas.filter((f) => f.bytes).reduce((a, f) => a + f.bytes, 0) / Math.max(1, filas.filter((f) => f.bytes).length) / 1024),
  pesoMaxKB: Math.round(Math.max(0, ...filas.map((f) => f.bytes || 0)) / 1024),
  malas: filas.filter((f) => f.clase !== 'OK').map((f) => ({ origen: f.origen, id: f.id, clase: f.clase, estado: f.estado, tipo: f.tipo, bytes: f.bytes, url: f.abs })),
};
fs.mkdirSync(path.join(RAIZ, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'tmp', 'diagnostico-imagenes.json'), JSON.stringify({ resumen, filas }, null, 1));
console.log(JSON.stringify({ ...resumen, malas: resumen.malas.length }, null, 1));
for (const m of resumen.malas.slice(0, 60)) console.log(m.origen, m.id, m.clase, m.estado, m.url);

// --- 4. Experimento opcional del 429: `node tools/diagnostico-imagenes.js --experimento` ---
// Pide 25 fotos distintas seguidas (una a una, sin pausa: lo que haría la app al pasar tarjetas deprisa)
// con tres cabeceras distintas, con 70 s de enfriamiento entre grupos, y cuenta cuántas dan 429.
if (process.argv.includes('--experimento')) {
  const urls = unicas.filter((i) => !i.propia).slice(0, 75).map((i) => i.abs);
  const variantes = {
    'sin Referer ni Origin (<img> sin SW)': {},
    'sin Referer + Origin (SW con CORS, como sw.js)': { Origin: ORIGEN },
    'con Referer de Pages': { Referer: BASE },
  };
  let g = 0;
  for (const [nombre, extra] of Object.entries(variantes)) {
    await dormir(70000);
    const lote = urls.slice(g * 25, g * 25 + 25); g++;
    const estados = {};
    for (const u of lote) {
      const r = await fetch(u, { headers: { 'User-Agent': UA, ...extra } });
      await r.arrayBuffer();
      estados[r.status] = (estados[r.status] || 0) + 1;
    }
    console.log(`EXPERIMENTO ${nombre}:`, JSON.stringify(estados));
  }
}
