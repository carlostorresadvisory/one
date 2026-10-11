// Lógica de decisión del lote de mejora del banco (tools/mejorar-imagenes.js). Sin red ni disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decidirRama, mejorarUna, puntuarHastaBuena, limpiarHuerfanos, completarAutores, listaRevision, bajar, decidirRamaCifra, mejorarCifra, preguntaDeCifra, iaPermitidaCifra } from '../tools/mejorar-imagenes.js';
import { CATEGORIAS as CATEGORIAS_CIFRAS } from '../tools/construir-cifras.js';

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

// --- Cifras de Más o menos (--cifras, plan 8.1b) ---------------------------------------------------------

const foto = (extra = {}) => ({ url: 'https://upload.wikimedia.org/x.jpg', pagina: 'https://commons.wikimedia.org/wiki/File:x.jpg', autor: 'Ana', licencia: 'CC BY-SA 4.0', fuente: 'Commons', ...extra });
const cifraDe = (imagen, extra = {}) => ({ id: 'am-Q513', area: 'geografia', categoria: 'altitud-montana', unidad: 'm', nombre: 'Everest', valor: 8849, ...(imagen ? { imagen } : {}), ...extra });

test('cifras: P18 buena (nota 5) se mantiene; sin nota, primero se puntúa', () => {
  assert.equal(decidirRamaCifra({ cifra: cifraDe(foto({ nota: 5 })) }), 'mantener');
  assert.equal(decidirRamaCifra({ cifra: cifraDe(foto({ nota: 4 })) }), 'mantener');
  assert.equal(decidirRamaCifra({ cifra: cifraDe(foto()) }), 'puntuar');
});

test('cifras: P18 mala con cupo → IA solo si la política la admite; si no, color del área', () => {
  const mala = cifraDe(foto({ nota: 2 }));
  assert.equal(decidirRamaCifra({ cifra: mala, cupoLibre: true, iaOk: true }), 'ia');
  assert.equal(decidirRamaCifra({ cifra: mala, cupoLibre: true }), 'sin-imagen'); // Everest es un lugar con nombre: iaPermitida lo bloquea
  assert.equal(decidirRamaCifra({ cifra: mala, cupoLibre: false, iaOk: true }), 'sin-imagen');
});

test('cifras: sin P18 y sin cupo → sin imagen (color del área); con cupo y política abierta → IA', () => {
  assert.equal(decidirRamaCifra({ cifra: cifraDe(null), cupoLibre: false, iaOk: true }), 'sin-imagen');
  assert.equal(decidirRamaCifra({ cifra: cifraDe(null), cupoLibre: true, iaOk: true }), 'ia');
});

test('cifras: una licencia no libre (o CC BY sin autor) no cuenta como foto', () => {
  assert.equal(decidirRamaCifra({ cifra: cifraDe(foto({ licencia: 'CC BY-NC 2.0', nota: 5 })) }), 'sin-imagen');
  assert.equal(decidirRamaCifra({ cifra: cifraDe(foto({ autor: '', nota: 5 })) }), 'sin-imagen');
});

test('cifras: la IA no puede ilustrar ninguna categoría (todas son cosas reales con nombre)', () => {
  const ejemplos = {
    'poblacion-pais': 'Francia', 'poblacion-ciudad': 'Tokio', 'altitud-montana': 'Everest', 'altura-edificio': 'Burj Khalifa',
    'longitud-rio': 'Nilo', 'superficie-pais': 'Rusia', 'ano-obra': 'La Gioconda', 'ano-hecho': 'Batalla de Waterloo', 'pib-pais': 'Brasil',
  };
  assert.deepEqual(Object.keys(ejemplos).sort(), Object.keys(CATEGORIAS_CIFRAS).sort());
  for (const [categoria, nombre] of Object.entries(ejemplos)) {
    const area = CATEGORIAS_CIFRAS[categoria].area;
    assert.equal(iaPermitidaCifra({ id: 'x', area, categoria, nombre, valor: 5, unidad: 'm' }), false, categoria);
  }
});

function ctxCifra({ nota, iaOk = false, cupo = true, generar = async () => ({ buffer: Buffer.from('x'), proveedor: 'cloudflare' }) } = {}) {
  const llamadas = { puntuar: 0, guardar: [], generar: 0 };
  return {
    llamadas,
    ctx: {
      iaOk, malas: new Set(), cupo: { puede: () => cupo }, args: { sinIa: false }, estado: { fallosSeguidos: 0, puntuadas: 0 },
      deps: {
        puntuar: async () => { llamadas.puntuar += 1; return nota === null ? null : { nota, modelo: 'm' }; },
        escribirPrompt: async () => 'prompt',
        generarImagen: async (...a) => { llamadas.generar += 1; return generar(...a); },
        aWebp: async (b) => b,
        guardarWebp: async (carpeta, id) => { llamadas.guardar.push(`${carpeta}/${id}`); return `${carpeta}/${id}.webp`; },
      },
    },
  };
}

test('cifras: mejorarCifra puntúa la P18 y la mantiene con nota 4+', async () => {
  const { ctx, llamadas } = ctxCifra({ nota: 4 });
  const c = cifraDe(foto());
  const r = await mejorarCifra(c, ctx);
  assert.equal(r.rama, 'mantener');
  assert.equal(c.imagen.nota, 4);
  assert.equal(c.imagen.notaModelo, 'm');
  assert.equal(llamadas.puntuar, 1);
  assert.equal(ctx.estado.puntuadas, 1);
});

test('cifras: nota baja → fuera la foto (color del área) y sin llamar a la IA', async () => {
  const { ctx, llamadas } = ctxCifra({ nota: 2, cupo: true });
  const c = cifraDe(foto());
  const r = await mejorarCifra(c, ctx);
  assert.equal(r.rama, 'sin-imagen');
  assert.equal(r.soltada, true);
  assert.equal(c.imagen, undefined);
  assert.equal(llamadas.generar, 0);
});

test('cifras: la visión sin respuesta deja la foto como estaba (pendiente) y cuenta como fallo técnico', async () => {
  const { ctx } = ctxCifra({ nota: null });
  const c = cifraDe(foto());
  const r = await mejorarCifra(c, ctx);
  assert.equal(r.rama, 'sin-puntuar');
  assert.ok(c.imagen && c.imagen.nota === undefined);
  assert.equal(ctx.estado.fallosSeguidos, 1);
});

test('cifras: con la política abierta la IA entra solo con nota 4+ y mejora; con 3 se descarta', async () => {
  const bueno = ctxCifra({ nota: 4, iaOk: true });
  const c1 = cifraDe(null);
  const r1 = await mejorarCifra(c1, bueno.ctx);
  assert.equal(r1.rama, 'ia');
  assert.deepEqual(bueno.llamadas.guardar, ['imagenes-ia/cifra-am-Q513']);
  assert.equal(c1.imagen.fuente, 'IA');
  assert.equal(c1.imagen.nota, 4);
  const flojo = ctxCifra({ nota: 3, iaOk: true });
  const c2 = cifraDe(null);
  const r2 = await mejorarCifra(c2, flojo.ctx);
  assert.equal(r2.rama, 'sin-imagen');
  assert.equal(c2.imagen, undefined);
  assert.deepEqual(flojo.llamadas.guardar, []);
});

test('cifras: una cifra marcada como mala se sustituye aunque la foto tuviera nota 5', async () => {
  const { ctx } = ctxCifra({ nota: 5 });
  ctx.malas = new Set(['am-Q513']);
  const c = cifraDe(foto({ nota: 5 }));
  const r = await mejorarCifra(c, ctx);
  assert.equal(r.rama, 'sin-imagen');
  assert.equal(c.imagen, undefined);
});
