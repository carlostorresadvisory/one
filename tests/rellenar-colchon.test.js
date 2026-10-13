// tools/rellenar-colchon.js (plan v0.3.5, punto 3): recuento, lotes y --dry-run, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { crearAlmacen } from '../servidor/almacen.js';
import { parsearArgs, contarColchon, rellenarColchon } from '../tools/rellenar-colchon.js';

const ejecutar = promisify(execFile);
const IMAGEN = { url: 'https://upload.wikimedia.org/x.jpg', fuente: 'Commons', licencia: 'Public domain', nota: 5 };
const sinImagen = (n, extra = {}) => ({ id: `srv-eco-${n}`, area: 'economia', creada: `2026-01-${String(n % 28 + 1).padStart(2, '0')}T00:00:00.000Z`, servida: null, ...extra });

async function almacenCon(lista) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'one-rellenar-'));
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon(lista);
  return { dir, almacen };
}

test('parsearArgs: valores por defecto, números y errores', () => {
  assert.deepEqual(parsearArgs([], { RUTA_DATOS: '/d' }), { datos: '/d', limite: 50, lote: 10, dryRun: false });
  assert.deepEqual(parsearArgs(['--datos', '/x', '--limite', '7', '--lote', '3', '--dry-run'], {}), { datos: '/x', limite: 7, lote: 3, dryRun: true });
  assert.match(parsearArgs(['--limite', 'abc'], {}).error, /--limite/);
  assert.match(parsearArgs(['--lote', '0'], {}).error, /--lote/);
  assert.match(parsearArgs(['--raro'], {}).error, /desconocido/);
});

test('contarColchon: con imagen por fuente, por procesar, en espera, rendidas y las que conservan su visual', () => {
  const futuro = new Date(Date.now() + 3600e3).toISOString();
  const c = contarColchon([
    sinImagen(1, { imagen: IMAGEN }),
    sinImagen(2, { imagen: { ...IMAGEN, fuente: 'IA' } }),
    sinImagen(3, { visual: { tipo: 'formula' } }),
    sinImagen(4, { imagenReintentarDesde: futuro }),
    sinImagen(5, { imagenPendiente: false, imagenRendida: true }),
  ]);
  assert.deepEqual(c, { total: 5, conImagen: 2, sinImagen: 3, porProcesar: 2, enEspera: 1, rendidas: 1, sinImagenConVisual: 1, porFuente: { Commons: 1, IA: 1 } });
});

test('rellenarColchon: procesa por lotes hasta --limite y cuenta lo que pasa', async () => {
  const { almacen } = await almacenCon(Array.from({ length: 25 }, (_, i) => sinImagen(i + 1)));
  const lotes = [];
  let vistas = 0;
  const res = await rellenarColchon({
    almacen,
    limite: 12,
    lote: 5,
    completarImagen: async (p) => {
      vistas += 1;
      lotes.push(p.id);
      return Number(p.id.split('-').pop()) % 2 === 0 ? { imagen: IMAGEN } : { imagen: null, sinIAHoy: true };
    },
  });
  assert.equal(res.intentadas, 12);
  assert.equal(vistas, 12);
  assert.equal(res.pasadas, 3, '5 + 5 + 2');
  assert.equal(res.completadas + res.sinIAHoy, 12);
  assert.equal(res.antes.sinImagen, 25);
  assert.equal(res.despues.conImagen, res.completadas);
  assert.equal(res.despues.sinImagen, 25 - res.completadas);
  assert.equal(res.despues.enEspera, res.sinIAHoy, 'las que no tuvieron IA esperan a mañana');
  assert.equal(new Set(lotes).size, 12, 'ninguna pregunta se intenta dos veces en la misma ejecución');
});

test('rellenarColchon: se para solo cuando no queda nada elegible (todo en espera por falta de IA)', async () => {
  const { almacen } = await almacenCon([sinImagen(1), sinImagen(2), sinImagen(3)]);
  const res = await rellenarColchon({ almacen, limite: 100, lote: 2, completarImagen: async () => ({ imagen: null, sinIAHoy: true }) });
  assert.equal(res.intentadas, 3);
  assert.equal(res.pasadas, 3, '2 + 1 + una vacía que corta');
  assert.equal(res.despues.porProcesar, 3, 'siguen pendientes, nadie se rinde');
  assert.equal(res.despues.enEspera, 3);
});

test('rellenarColchon: los fallos técnicos no cuentan como intento de la pregunta, se anotan y la apartan 30 min (cortacircuito)', async () => {
  const { almacen } = await almacenCon([sinImagen(1)]);
  const res = await rellenarColchon({ almacen, limite: 2, lote: 1, completarImagen: async () => ({ imagen: null, tecnico: true }) });
  assert.equal(res.tecnicos, 1, 'tras el fallo la pregunta espera y ya no hay nada elegible');
  assert.equal(res.despues.porProcesar, 1);
  assert.equal((await almacen.leerColchon())[0].intentosImagen, 0, "solo la marca de la migración, ningún intento");
});

test('--dry-run por la línea de órdenes: imprime recuentos y no toca el colchón', async () => {
  const { dir, almacen } = await almacenCon([sinImagen(1), sinImagen(2, { imagen: IMAGEN })]);
  const antes = await readFile(path.join(dir, 'colchon.json'), 'utf8');
  const marca = (await stat(path.join(dir, 'colchon.json'))).mtimeMs;
  const { stdout } = await ejecutar(process.execPath, ['tools/rellenar-colchon.js', '--datos', dir, '--dry-run']);
  assert.match(stdout, /2 preguntas · 1 con imagen · 1 sin imagen/);
  assert.match(stdout, /por procesar: 1/);
  assert.equal(await readFile(path.join(dir, 'colchon.json'), 'utf8'), antes);
  assert.equal((await stat(path.join(dir, 'colchon.json'))).mtimeMs, marca);
  assert.equal((await almacen.leerColchon()).length, 2);
});
