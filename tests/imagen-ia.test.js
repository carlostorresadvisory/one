// Imagen IA de último recurso (servidor/imagen-ia.js): sin red; fetch simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ESTILO_ONE, escribirPrompt, generarImagen, crearCupo, aWebp, CREDITO_IA, COSTE_RUNWARE_EUR, TOPE_DIA_EUR } from '../servidor/imagen-ia.js';

const ENTORNO_CF = { CLOUDFLARE_AI_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'cuenta' };
const ENTORNO_TODO = { ...ENTORNO_CF, RUNWARE_API_KEY: 'rk' };
const DIA = new Date('2026-10-11T10:00:00Z');
const PNG_B64 = Buffer.from('imagen-falsa').toString('base64');

const cupoEnMemoria = (extra = {}) => crearCupo({ ruta: join(mkdtempSync(join(tmpdir(), 'cupo-')), 'cupo.json'), ahora: () => DIA, ...extra });
const json = (estado, cuerpo) => ({ ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo });

test('ESTILO_ONE y crédito', () => {
  assert.match(ESTILO_ONE, /cinematic illustration/);
  assert.match(ESTILO_ONE, /no text/);
  assert.equal(CREDITO_IA.texto, 'Imagen generada con IA');
  assert.equal(CREDITO_IA.fuente, 'IA');
});

test('escribirPrompt: añade el estilo y le pasa la respuesta al modelo solo para evitarla', async () => {
  let visto;
  const p = await escribirPrompt({ enunciado: '¿Quién pintó La noche estrellada?', explicacion: 'Van Gogh' }, {
    llamarModelo: async ({ mensajes }) => { visto = mensajes; return 'A swirling night sky over a quiet village'; },
  });
  assert.match(p, /swirling night sky/);
  assert.ok(p.endsWith(ESTILO_ONE));
  const texto = JSON.stringify(visto);
  assert.match(texto, /Van Gogh/);
  assert.match(texto, /NOT|never|do not/i);
});

test('cupo agotado: generarImagen devuelve null sin llamar', async () => {
  const cupo = cupoEnMemoria({ maxDia: 1 });
  cupo.apuntar('cloudflare', 0);
  let llamadas = 0;
  const r = await generarImagen('p', { fetchImpl: async () => { llamadas++; }, entorno: ENTORNO_TODO, cupo, ahora: () => DIA });
  assert.equal(r, null);
  assert.equal(llamadas, 0);
});

test('Cloudflare bien: devuelve el buffer, apunta una imagen y no cobra', async () => {
  const cupo = cupoEnMemoria();
  let pedido;
  const r = await generarImagen('un prompt', {
    entorno: ENTORNO_CF, cupo, ahora: () => DIA,
    fetchImpl: async (url, o) => { pedido = { url, o }; return json(200, { result: { image: PNG_B64 }, success: true }); },
  });
  assert.equal(r.proveedor, 'cloudflare');
  assert.equal(r.buffer.toString(), 'imagen-falsa');
  assert.match(pedido.url, /accounts\/cuenta\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
  assert.equal(pedido.o.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(pedido.o.body), { prompt: 'un prompt', steps: 4 });
  assert.deepEqual(cupo.estadoHoy(), { dia: '2026-10-11', n: 1, gastoHoyEur: 0 });
});

test('Cloudflare 429 -> Runware (con clave y dentro del tope)', async () => {
  const cupo = cupoEnMemoria();
  const urls = [];
  const r = await generarImagen('p', {
    entorno: ENTORNO_TODO, cupo, ahora: () => DIA,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('cloudflare')) return json(429, { errors: [{ message: 'rate limit' }] });
      return json(200, { data: [{ imageBase64Data: PNG_B64 }] });
    },
  });
  assert.equal(r.proveedor, 'runware');
  assert.equal(urls.length, 2);
  assert.equal(cupo.estadoHoy().gastoHoyEur, COSTE_RUNWARE_EUR);
});

test('Runware pasaría el tope de 0,10 EUR -> null', async () => {
  const cupo = cupoEnMemoria();
  cupo.apuntar('runware', TOPE_DIA_EUR - COSTE_RUNWARE_EUR / 2);
  let runware = 0;
  const r = await generarImagen('p', {
    entorno: ENTORNO_TODO, cupo, ahora: () => DIA,
    fetchImpl: async (url) => {
      if (String(url).includes('runware')) runware++;
      return json(429, {});
    },
  });
  assert.equal(r, null);
  assert.equal(runware, 0);
});

test('Cloudflare 429 sin clave de Runware -> null; un 500 no pasa al escalón de pago', async () => {
  const cupo = cupoEnMemoria();
  assert.equal(await generarImagen('p', { entorno: ENTORNO_CF, cupo, ahora: () => DIA, fetchImpl: async () => json(429, {}) }), null);
  let runware = 0;
  const r = await generarImagen('p', {
    entorno: ENTORNO_TODO, cupo, ahora: () => DIA,
    fetchImpl: async (url) => { if (String(url).includes('runware')) runware++; return json(500, {}); },
  });
  assert.equal(r, null);
  assert.equal(runware, 0);
});

test('cupo: persiste en disco, cuenta por día y se reinicia al día siguiente', () => {
  const ruta = join(mkdtempSync(join(tmpdir(), 'cupo-')), 'cupo-ia.json');
  let hoy = DIA;
  const a = crearCupo({ ruta, maxDia: 2, ahora: () => hoy });
  a.apuntar('cloudflare', 0);
  const b = crearCupo({ ruta, maxDia: 2, ahora: () => hoy });
  assert.equal(b.estadoHoy().n, 1);
  b.apuntar('cloudflare', 0);
  assert.equal(b.puede(), false);
  hoy = new Date('2026-10-12T00:30:00Z');
  assert.equal(b.puede(), true);
  assert.deepEqual(b.estadoHoy(), { dia: '2026-10-12', n: 0, gastoHoyEur: 0 });
  assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).dia, '2026-10-11');
});

test('cupo: fichero corrupto o ausente no lanza', () => {
  const cupo = crearCupo({ ruta: join(mkdtempSync(join(tmpdir(), 'cupo-')), 'no', 'existe.json'), ahora: () => DIA });
  assert.equal(cupo.puede(), true);
});

test('aWebp: una imagen de 1024 px con ruido queda en WebP <= 80 KB y <= 768 px', async () => {
  const ruido = Buffer.alloc(1024 * 1024 * 3);
  for (let i = 0; i < ruido.length; i++) ruido[i] = (i * 2654435761) >>> 24;
  const png = await sharp(ruido, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
  const webp = await aWebp(png);
  assert.ok(webp.length <= 80 * 1024, `pesa ${webp.length}`);
  const meta = await sharp(webp).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.width <= 768);
});
