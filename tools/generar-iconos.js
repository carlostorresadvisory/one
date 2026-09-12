// Genera iconos/192.png e iconos/512.png con un codificador PNG mínimo propio
// (sin dependencias): fondo oscuro, círculo de acento centrado y un punto oscuro central.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');

const FONDO = [0x0b, 0x0f, 0x14];
const ACENTO = [0x4c, 0xc9, 0xf0];

// --- CRC32 propio (tabla estándar del algoritmo PNG) ---
const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const tipoBuf = Buffer.from(tipo, 'ascii');
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([tipoBuf, datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([longitud, cuerpo, crc]);
}

function dibujarPixeles(lado) {
  const centro = lado / 2;
  const radioCirculo = lado * 0.35;
  const radioPunto = lado * 0.08;
  // 3 bytes por píxel (RGB, sin alfa).
  const pixeles = Buffer.alloc(lado * lado * 3);
  for (let y = 0; y < lado; y += 1) {
    for (let x = 0; x < lado; x += 1) {
      const dx = x - centro + 0.5;
      const dy = y - centro + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let color = FONDO;
      if (dist <= radioPunto) {
        color = FONDO; // punto oscuro central, sobre el círculo de acento
      } else if (dist <= radioCirculo) {
        color = ACENTO;
      }
      const i = (y * lado + x) * 3;
      pixeles[i] = color[0];
      pixeles[i + 1] = color[1];
      pixeles[i + 2] = color[2];
    }
  }
  return pixeles;
}

function construirPng(lado) {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); // width
  ihdr.writeUInt32BE(lado, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const pixeles = dibujarPixeles(lado);
  // Cada línea de escaneo lleva un byte de filtro (0 = ninguno) delante.
  const crudo = Buffer.alloc(lado * (1 + lado * 3));
  for (let y = 0; y < lado; y += 1) {
    const inicioCrudo = y * (1 + lado * 3);
    crudo[inicioCrudo] = 0;
    pixeles.copy(crudo, inicioCrudo + 1, y * lado * 3, (y + 1) * lado * 3);
  }
  const comprimido = zlib.deflateSync(crudo);

  return Buffer.concat([
    firma,
    chunk('IHDR', ihdr),
    chunk('IDAT', comprimido),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function generar() {
  const dirIconos = path.join(RAIZ, 'iconos');
  fs.mkdirSync(dirIconos, { recursive: true });
  for (const lado of [192, 512]) {
    const png = construirPng(lado);
    const destino = path.join(dirIconos, `${lado}.png`);
    fs.writeFileSync(destino, png);
    console.log(`Generado ${path.relative(RAIZ, destino)} (${png.length} bytes)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generar();
}

export { construirPng, crc32 };
