// Genera los iconos de la app a partir de la esfinge (prototipos/avatares/i-esfinge/neutral.png, 512 px con alfa):
// iconos/esfinx-180.png (apple-touch-icon), esfinx-192.png, esfinx-512.png y esfinx-512-maskable.png.
// Fondo #0b0f14 con un leve degradado cian; cabeza y nemes centrados dentro de la zona segura del 80 %
// (círculo central de diámetro 0,80 del lado; el maskable, con más margen, 0,66).
// Uso: node tools/generar-iconos.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const FUENTE = path.join(RAIZ, 'prototipos/avatares/i-esfinge/neutral.png');

// Cabeza y nemes dentro de la imagen fuente (la caja que los contiene y el punto donde se desvanece el cuerpo).
const CAJA = { left: 70, top: 20, width: 370, height: 330 };
const DESVANECER_DESDE = 285;

const SALIDAS = [
  { nombre: 'esfinx-180.png', lado: 180, zona: 0.8 },
  { nombre: 'esfinx-192.png', lado: 192, zona: 0.8 },
  { nombre: 'esfinx-512.png', lado: 512, zona: 0.8 },
  { nombre: 'esfinx-512-maskable.png', lado: 512, zona: 0.66 },
];

async function cabeza() {
  const { data, info } = await sharp(FUENTE).ensureAlpha().extract(CAJA).raw().toBuffer({ resolveWithObject: true });
  for (let y = DESVANECER_DESDE; y < info.height; y += 1) {
    const f = 1 - (y - DESVANECER_DESDE) / (info.height - DESVANECER_DESDE);
    for (let x = 0; x < info.width; x += 1) data[(y * info.width + x) * 4 + 3] = Math.round(data[(y * info.width + x) * 4 + 3] * f);
  }
  // Radio real de la figura (píxel opaco más lejano del centro de la caja): es lo que debe caber en la zona segura.
  let r2 = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 40) r2 = Math.max(r2, (x - info.width / 2) ** 2 + (y - info.height / 2) ** 2);
    }
  }
  return { data, info, diametro: 2 * Math.sqrt(r2) };
}

function fondoSvg(lado) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}"><defs>
<radialGradient id="g" cx="50%" cy="46%" r="62%"><stop offset="0" stop-color="#4cc9f0" stop-opacity="0.28"/><stop offset="1" stop-color="#4cc9f0" stop-opacity="0"/></radialGradient></defs>
<rect width="100%" height="100%" fill="#0b0f14"/><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}

export async function construirIcono(lado, zona) {
  const { data, info, diametro } = await cabeza();
  const ancho = Math.round(((lado * zona) / diametro) * info.width);
  const figura = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).resize({ width: ancho }).png().toBuffer();
  const m = await sharp(figura).metadata();
  const left = Math.round((lado - m.width) / 2);
  const top = Math.round((lado - m.height) / 2);
  return sharp(fondoSvg(lado)).composite([{ input: figura, left, top }]).flatten({ background: '#0b0f14' }).png({ compressionLevel: 9 }).toBuffer();
}

async function generar() {
  const dir = path.join(RAIZ, 'iconos');
  fs.mkdirSync(dir, { recursive: true });
  for (const { nombre, lado, zona } of SALIDAS) {
    const png = await construirIcono(lado, zona);
    fs.writeFileSync(path.join(dir, nombre), png);
    console.log(`Generado iconos/${nombre} (${lado}x${lado}, ${png.length} bytes)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generar();
