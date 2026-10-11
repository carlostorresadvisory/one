// Lógica de decisión del lote de mejora del banco (tools/mejorar-imagenes.js). Sin red ni disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decidirRama, mejorarUna, puntuarHastaBuena, limpiarHuerfanos, completarAutores, listaRevision, bajar } from '../tools/mejorar-imagenes.js';

const buena = { nota: 5 };
const mediocre = { nota: 3 };

test('(a) imagen con nota >= 4 y no marcada mala -> mantener', () => {
  assert.equal(decidirRama({ actual: buena, marcadaMala: false }), 'mantener');
  assert.equal(decidirRama({ actual: { nota: 4 }, marcadaMala: false }), 'mantener');
});

test('marcada mala se sustituye aunque tuviera 4-5', () => {
  assert.equal(decidirRama({ actual: buena, marcadaMala: true }), 'buscar-commons');
});

test('(b) Commons: se busca primero y, si hay candidata buena, gana', () => {
  assert.equal(decidirRama({ actual: mediocre }), 'buscar-commons');
  assert.equal(decidirRama({ actual: mediocre, candidatasCommons: [{ nota: 4 }], candidatasBancos: [{ nota: 5 }] }), 'commons');
});

test('(c) sin buena en Commons -> bancos libres', () => {
  assert.equal(decidirRama({ actual: null, candidatasCommons: [] }), 'buscar-bancos');
  assert.equal(decidirRama({ actual: null, candidatasCommons: [], candidatasBancos: [{ nota: 4 }] }), 'bancos');
});

test('(d) nada en bancos -> IA si queda cupo; (e) sin cupo -> sin imagen', () => {
  assert.equal(decidirRama({ actual: { nota: 2 }, candidatasCommons: [], candidatasBancos: [], cupoLibre: true }), 'ia');
  assert.equal(decidirRama({ actual: null, candidatasCommons: [], candidatasBancos: [], cupoLibre: true }), 'ia');
  assert.equal(decidirRama({ actual: mediocre, candidatasCommons: [], candidatasBancos: [], cupoLibre: false }), 'sin-imagen');
});

test('una imagen sin nota todavía no se mantiene', () => {
  assert.equal(decidirRama({ actual: {}, marcadaMala: false }), 'buscar-commons');
});

test('C1/C2: una nota 3 nunca se cambia por IA, y sin permiso de IA (arte...) tampoco', () => {
  const vacio = { candidatasCommons: [], candidatasBancos: [], cupoLibre: true };
  assert.equal(decidirRama({ actual: mediocre, ...vacio }), 'sin-imagen');
  assert.equal(decidirRama({ actual: { nota: 1 }, ...vacio, iaOk: false }), 'sin-imagen');
});

// --- mejorarUna con dependencias simuladas ---------------------------------------------------------

const CIENCIA = { id: 'cie-001', area: 'ciencia', enunciado: '¿Qué gas respiramos?', explicacion: 'Oxígeno.' };
const ARTE = { id: 'art-001', area: 'arte', enunciado: '¿Quién pintó Las Meninas?', explicacion: 'Velázquez.' };

function contexto({ notaIA, imagenes = {}, deps = {} }) {
  const llamadas = { generar: 0, guardar: [], puntuar: 0 };
  return {
    llamadas,
    ctx: {
      imagenes, malas: new Set(), cupo: { puede: () => true }, args: { sinIa: false, repuntuar: new Set() }, estado: { fallosSeguidos: 0, puntuadas: 0 }, terminos: {},
      deps: {
        candidatasCommons: async () => [], candidatasBancos: async () => [],
        puntuarHastaBuena: async () => ({ buenas: [], tecnico: false }),
        escribirPrompt: async () => 'a prompt',
        generarImagen: async () => { llamadas.generar += 1; return { buffer: Buffer.from('x'), proveedor: 'cloudflare' }; },
        aWebp: async (b) => b,
        puntuar: async () => { llamadas.puntuar += 1; return notaIA == null ? null : { nota: notaIA, modelo: 'm' }; },
        guardarWebp: async (dir, id) => { llamadas.guardar.push(`${dir}/${id}`); return `${dir}/${id}.webp`; },
        ...deps,
      },
    },
  };
}

const actualConNota = (nota) => ({ 'cie-001': { id: 'cie-001', url: 'https://upload.wikimedia.org/a.jpg', nota, fuente: 'Commons', licencia: 'CC0' } });

test('C1: IA con nota 3 no se guarda y la actual de nota 2 se suelta', async () => {
  const { ctx, llamadas } = contexto({ notaIA: 3, imagenes: actualConNota(2) });
  const r = await mejorarUna(CIENCIA, ctx);
  assert.equal(r.rama, 'sin-imagen');
  assert.deepEqual(llamadas.guardar, []);
  assert.equal(ctx.imagenes['cie-001'], undefined);
});

test('C1: IA con nota 4 sobre una actual de nota 2 sí entra; sin actual también', async () => {
  const a = contexto({ notaIA: 4, imagenes: actualConNota(2) });
  assert.equal((await mejorarUna(CIENCIA, a.ctx)).fuente, 'IA');
  assert.equal(a.ctx.imagenes['cie-001'].fuente, 'IA');
  assert.equal(a.ctx.imagenes['cie-001'].leyenda, 'Imagen generada con IA');
  assert.equal(a.ctx.imagenes['cie-001'].nota, 4);
  const b = contexto({ notaIA: 5 });
  assert.equal((await mejorarUna(CIENCIA, b.ctx)).fuente, 'IA');
});

test('C1: una actual de nota 3 se conserva y la IA ni se genera', async () => {
  const { ctx, llamadas } = contexto({ notaIA: 5, imagenes: actualConNota(3) });
  const r = await mejorarUna(CIENCIA, ctx);
  assert.equal(r.conservada, true);
  assert.equal(llamadas.generar, 0);
  assert.equal(ctx.imagenes['cie-001'].url, 'https://upload.wikimedia.org/a.jpg');
  assert.equal(ctx.imagenes['cie-001'].pendienteMejora, true);
});

test('C1/C2: en arte nunca hay IA (obra real o nada)', async () => {
  const { ctx, llamadas } = contexto({ notaIA: 5 });
  const r = await mejorarUna(ARTE, ctx);
  assert.equal(r.rama, 'sin-imagen');
  assert.equal(llamadas.generar, 0);
  assert.equal(ctx.imagenes['art-001'], undefined);
});

test('I1: fallo técnico en una fuente deja la pregunta sin puntuar y no baja a la IA', async () => {
  const { ctx, llamadas } = contexto({ notaIA: 5, deps: { puntuarHastaBuena: async () => ({ buenas: [], tecnico: true }), candidatasCommons: async () => [{ url: 'u' }] } });
  const r = await mejorarUna(CIENCIA, ctx);
  assert.equal(r.rama, 'sin-puntuar');
  assert.equal(llamadas.generar, 0);
});

test('--repuntuar: vuelve a puntuar aunque tuviera nota 5 y, si ahora suspende, la suelta', async () => {
  const { ctx } = contexto({ notaIA: 5, imagenes: actualConNota(5), deps: { puntuar: async () => ({ nota: 2, modelo: 'm' }) } });
  ctx.args.repuntuar = new Set(['cie-001']);
  ctx.args.sinIa = true;
  const r = await mejorarUna(CIENCIA, ctx);
  assert.equal(r.rama, 'sin-imagen');
  assert.equal(ctx.imagenes['cie-001'], undefined);
});

// --- puntuarHastaBuena: fuente agotada vs fallo técnico -----------------------------------------------

const cands = (n) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}.jpg`, fuente: 'Commons' }));

test('I1: todas puntuadas por debajo de 4 = agotada (no técnico); visión sin respuesta = técnico', async () => {
  const estado = { fallosSeguidos: 0, puntuadas: 0 };
  const a = await puntuarHastaBuena(cands(6), CIENCIA, estado, { puntuar: async () => ({ nota: 2, modelo: 'm' }) });
  assert.deepEqual([a.buenas.length, a.tecnico, estado.puntuadas], [0, false, 6]);
  const b = await puntuarHastaBuena(cands(3), CIENCIA, estado, { puntuar: async () => null });
  assert.deepEqual([b.buenas.length, b.tecnico], [0, true]);
  const c = await puntuarHastaBuena(cands(3), CIENCIA, estado, { puntuar: async ({ url }) => (url.endsWith('1.jpg') ? { nota: 4, modelo: 'm' } : null) });
  assert.equal(c.buenas.length, 1);
});

test('I1: descarga fallida de un banco = técnico; imagen realmente pequeña = descartada sin ser técnico', async () => {
  const estado = { fallosSeguidos: 0, puntuadas: 0 };
  const banco = [{ url: 'https://x/a.jpg', fuente: 'Openverse' }];
  const r = await puntuarHastaBuena(banco, CIENCIA, estado, { bajarImagen: async () => { throw new Error('HTTP 503'); }, puntuar: async () => ({ nota: 5, modelo: 'm' }) });
  assert.deepEqual([r.buenas.length, r.tecnico], [0, true]);
  const { default: sharp } = await import('sharp');
  const pequena = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#fff' } }).png().toBuffer();
  const p = await puntuarHastaBuena(banco, CIENCIA, estado, { bajarImagen: async () => pequena, puntuar: async () => ({ nota: 5, modelo: 'm' }) });
  assert.deepEqual([p.buenas.length, p.tecnico], [0, false]);
});

// --- I5: descarga acotada ----------------------------------------------------------------------------

test('I5: bajar() corta una imagen de más de 8 MB', async () => {
  const grande = async () => ({ ok: true, status: 200, headers: { get: () => String(30 * 1024 * 1024) }, body: { cancel: async () => {} } });
  await assert.rejects(bajar('https://x/enorme.jpg', grande), /demasiado grande/);
});

// --- Créditos, revisión humana y huérfanos --------------------------------------------------------------

test('I4: completarAutores rellena el autor desde Commons y descarta la imagen si no lo hay', async () => {
  const imagenes = {
    a: { licencia: 'CC BY-SA 3.0', autor: '', pagina: 'https://commons.wikimedia.org/wiki/File:A_b.png' },
    b: { licencia: 'CC BY 4.0', autor: '', pagina: 'https://commons.wikimedia.org/wiki/File:B.png' },
    c: { licencia: 'CC0', autor: '', pagina: 'https://commons.wikimedia.org/wiki/File:C.png' },
    d: { licencia: 'CC BY 2.0', autor: 'Ana', pagina: 'https://commons.wikimedia.org/wiki/File:D.png' },
  };
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ query: { pages: { 1: { imageinfo: [{ extmetadata: { Artist: { value: url.includes('A_b') ? '<a href="x">Juan Pérez</a>' : '' } } }] } } } }) });
  const r = await completarAutores(imagenes, { fetchImpl });
  assert.deepEqual(r, { completadas: ['a'], descartadas: ['b'] });
  assert.equal(imagenes.a.autor, 'Juan Pérez');
  assert.ok(imagenes.c && imagenes.d && !imagenes.b);
});

test('I2: listaRevision incluye las IA y las nuevas de nota 5, con id, enunciado, fuente y ruta', () => {
  const imagenes = {
    'ia-1': { fuente: 'IA', nota: 4, url: 'imagenes-ia/ia-1.webp' },
    n5: { fuente: 'Commons', nota: 5, origen: 'lote', url: 'https://u/x.jpg', pagina: 'https://commons.wikimedia.org/wiki/File:X.jpg' },
    n4: { fuente: 'Commons', nota: 4, origen: 'lote', url: 'https://u/y.jpg' },
    vieja: { fuente: 'Commons', nota: 5, url: 'https://u/z.jpg' },
  };
  const md = listaRevision(imagenes, [{ id: 'ia-1', enunciado: 'Pregunta | uno' }, { id: 'n5', enunciado: 'Pregunta dos' }]);
  assert.match(md, /Total: 2/);
  assert.ok(md.includes('| ia-1 | Pregunta / uno | IA | 4 | imagenes-ia/ia-1.webp |'));
  assert.ok(md.includes('| n5 | Pregunta dos | Commons | 5 | https://commons.wikimedia.org/wiki/File:X.jpg |'));
  assert.ok(!md.includes('n4 |') && !md.includes('vieja'));
});

test('C3: limpiarHuerfanos borra los WebP que ninguna entrada usa', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'one-huerf-'));
  await writeFile(path.join(dir, 'usada.webp'), 'x');
  await writeFile(path.join(dir, 'sobra.webp'), 'x');
  const borradas = await limpiarHuerfanos({ a: { url: `${dir}/usada.webp` } }, { carpetas: [dir] });
  assert.equal(borradas.length, 1);
  assert.deepEqual(await readdir(dir), ['usada.webp']);
});
