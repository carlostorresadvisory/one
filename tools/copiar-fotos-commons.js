// ONE · copia las fotos de Commons a imagenes-banco/ (spec v0.3.1 §5). Relanzable e idempotente.
// Para cada foto de Commons de datos/imagenes.json (preguntas) y datos/cifras.json (Más o menos):
//   1. pide la miniatura de 500 px de Commons (no el original), EN SERIE, con pausa y respetando Retry-After;
//   2. la guarda como WebP de 500 px de ancho (calidad ~75, <= 80 KB) en imagenes-banco/commons-<fichero>.webp;
//   3. reescribe la `url` del JSON a esa ruta propia (crédito, autor, licencia y página siguen siendo los de Commons).
// Lo ya copiado se salta (si el WebP existe, solo se reescribe la URL). Una foto que falla se deja con su URL de
// Commons y se cuenta como fallida; se arregla relanzando. Uso: node tools/copiar-fotos-commons.js [--pausa 1100] [--limite N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(RAIZ, 'imagenes-banco');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const PAUSA = Math.max(1000, Number(arg('pausa', 1100)));
const LIMITE = Number(arg('limite', Infinity));
const ANCHO = 500;
const MAX_BYTES = 80 * 1024;
const UA = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub; copia unica de miniaturas)';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const COMMONS = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//;

/** Nombre del fichero de Commons (decodificado) a partir de una URL de miniatura u original. */
export function ficheroDe(url) {
  const p = new URL(url).pathname.replace(/^\/wikipedia\/commons\//, '').split('/');
  return decodeURIComponent(p[0] === 'thumb' ? p[3] : p[p.length - 1]);
}
/** Nombre estable y seguro: commons-<fichero sin extensión, minúsculas, solo [a-z0-9-]>.webp */
export function nombreLocal(url) {
  const f = ficheroDe(url).replace(/\.[a-z0-9]+$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return `commons-${f.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}.webp`;
}
/** URL de la miniatura de 500 px (sin query). Los formatos que Commons rasteriza (svg, tif, pdf) salen como .png. */
export function urlMiniatura(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/wikipedia\/commons\//, '').split('/');
  const fichero = p[0] === 'thumb' ? p[3] : p[p.length - 1];
  const d = p[0] === 'thumb' ? p.slice(1, 3) : p.slice(0, 2);
  const raster = /\.(svg|tiff?|pdf|xcf|webm|ogv)$/i.test(fichero) ? '.png' : '';
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${d.join('/')}/${fichero}/${ANCHO}px-${fichero}${raster}`;
}
export function urlOriginal(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/wikipedia\/commons\//, '').split('/');
  const fichero = p[0] === 'thumb' ? p[3] : p[p.length - 1];
  const d = p[0] === 'thumb' ? p.slice(1, 3) : p.slice(0, 2);
  return `https://upload.wikimedia.org/wikipedia/commons/${d.join('/')}/${fichero}`;
}

async function bajar(url) {
  for (let intento = 0; intento < 7; intento++) {
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } }); }
    catch (e) { await dormir(3000 * (intento + 1)); continue; }
    if (r.status === 200) return { ok: true, buf: Buffer.from(await r.arrayBuffer()) };
    await r.arrayBuffer().catch(() => {});
    if (r.status === 429 || r.status >= 500) {
      const espera = Math.min(120, Number(r.headers.get('retry-after')) || 5 * (intento + 1));
      console.error(`  ${r.status}, espero ${espera} s`);
      await dormir(espera * 1000 + 500);
      continue;
    }
    return { ok: false, estado: r.status };
  }
  return { ok: false, estado: 'reintentos agotados' };
}

async function aWebp(buf) {
  let salida;
  for (const q of [75, 68, 60, 52, 45, 38]) {
    salida = await sharp(buf).rotate().resize({ width: ANCHO, withoutEnlargement: true }).webp({ quality: q, effort: 5 }).toBuffer();
    if (salida.length <= MAX_BYTES) return salida;
  }
  return salida;
}

async function copiar(url) {
  const destino = nombreLocal(url);
  const ruta = path.join(DIR, destino);
  if (fs.existsSync(ruta)) return { destino, saltada: true };
  let r = await bajar(urlMiniatura(url));
  if (!r.ok && r.estado === 400) { await dormir(PAUSA); r = await bajar(urlOriginal(url)); } // original más pequeño que 500 px
  if (!r.ok) return { destino, error: `HTTP ${r.estado}` };
  try {
    fs.writeFileSync(ruta, await aWebp(r.buf));
  } catch (e) { return { destino, error: `sharp: ${e.message}` }; }
  return { destino };
}

if (process.argv[1] && process.argv[1].endsWith("copiar-fotos-commons.js")) await principal();
async function principal() {
fs.mkdirSync(DIR, { recursive: true });
const rIm = path.join(RAIZ, 'datos', 'imagenes.json');
const rCi = path.join(RAIZ, 'datos', 'cifras.json');
const imagenes = JSON.parse(fs.readFileSync(rIm, 'utf8'));
const cifras = JSON.parse(fs.readFileSync(rCi, 'utf8'));
const usos = []; // { obj, url }
for (const d of Object.values(imagenes)) if (d.url && COMMONS.test(d.url)) usos.push(d);
for (const c of cifras) if (c.imagen?.url && COMMONS.test(c.imagen.url)) usos.push(c.imagen);

// Se conserva el formato de origen (CRLF; cifras.json una cifra por línea) para que el diff solo toque las url.
const guardar = () => {
  fs.writeFileSync(rIm, JSON.stringify(imagenes, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  fs.writeFileSync(rCi, '[\r\n' + cifras.map((c) => JSON.stringify(c)).join(',\r\n') + '\r\n]\r\n');
};

const porUrlLocal = new Map(); // url Commons -> resultado (varias entradas pueden compartir foto)
let copiadas = 0, saltadas = 0; const fallidas = [];
console.error(`${usos.length} usos de Commons pendientes de ${Object.keys(imagenes).length} imágenes + ${cifras.length} cifras.`);
let n = 0;
for (const uso of usos) {
  if (n >= LIMITE) break;
  const clave = nombreLocal(uso.url);
  let res = porUrlLocal.get(clave);
  if (!res) {
    res = await copiar(uso.url);
    porUrlLocal.set(clave, res);
    if (res.error) { fallidas.push({ url: uso.url, error: res.error }); console.error(`FALLO ${res.destino}: ${res.error}`); }
    else if (res.saltada) saltadas++;
    else { copiadas++; console.error(`ok ${res.destino} (${Math.round(fs.statSync(path.join(DIR, res.destino)).size / 1024)} KB) [${copiadas}]`); await dormir(PAUSA); }
    n++;
    if (copiadas > 0 && copiadas % 25 === 0 && !res.error && !res.saltada) guardar();
  }
  if (!res.error) uso.url = `imagenes-banco/${res.destino}`;
}
guardar();
const kb = fs.readdirSync(DIR).reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0) / 1024;
console.log(JSON.stringify({ copiadas, saltadas, fallidas: fallidas.length, detalleFallidas: fallidas, pesoTotalImagenesBancoMB: +(kb / 1024).toFixed(1) }, null, 1));
}
