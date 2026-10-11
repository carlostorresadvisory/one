// Imagen de las preguntas generadas (servidor/imagenes.js): sin red, con dependencias simuladas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverImagen } from '../servidor/imagenes.js';

const PREGUNTA = { id: 'srv-eco-1', area: 'historia', enunciado: '¿Quién pintó la Mona Lisa?', explicacion: 'Leonardo da Vinci.' };
const cand = (url, extra = {}) => ({ url, pagina: `${url}#p`, titulo: 't', autor: 'A', licencia: 'CC BY 4.0', fuente: 'Commons', ...extra });

function deps(extra = {}) {
  const llamadas = { commons: 0, bancos: 0, ia: 0, guardar: 0, puntuar: [] };
  const base = {
    proponerTerminos: async () => ['mona lisa'],
    buscarCommons: async () => { llamadas.commons += 1; return [cand('https://upload.wikimedia.org/a.jpg')]; },
    buscarBancos: async () => { llamadas.bancos += 1; return [cand('https://images.metmuseum.org/b.jpg', { fuente: 'Met', licencia: 'CC0' })]; },
    puntuar: async ({ url }) => { llamadas.puntuar.push(url); return { nota: 5, motivo: 'ok', modelo: 'm' }; },
    guardarArchivo: async (c, p) => { llamadas.guardar += 1; return `/imagenes/${p.id}.webp`; },
    generarIA: async (p) => { llamadas.ia += 1; return { url: `/imagenes/${p.id}.webp` }; },
    cupo: { puede: () => true },
    permitirIA: false,
  };
  return { llamadas, d: { ...base, ...extra } };
}

test('imagen buena de Commons a tiempo: sale con imagen, sin tocar bancos ni IA', async () => {
  const { llamadas, d } = deps();
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(imagen.fuente, 'Commons');
  assert.equal(imagen.url, 'https://upload.wikimedia.org/a.jpg');
  assert.equal(imagen.nota, 5);
  assert.equal(llamadas.bancos + llamadas.ia + llamadas.guardar, 0);
});

test('Commons sin nota 4 -> otro banco libre: la imagen se guarda en el servidor y lleva su fuente real', async () => {
  const { llamadas, d } = deps({
    puntuar: async ({ url }) => ({ nota: url.includes('wikimedia') ? 2 : 4, motivo: '', modelo: 'm' }),
  });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(imagen.fuente, 'Met');
  assert.equal(imagen.licencia, 'CC0');
  assert.equal(imagen.url, '/imagenes/srv-eco-1.webp');
  assert.equal(llamadas.guardar, 1);
});

test('sin buena y SIN permiso de IA (tanda urgente): imagen null y la IA ni se pide', async () => {
  const { llamadas, d } = deps({ puntuar: async () => ({ nota: 1, motivo: '', modelo: 'm' }) });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(imagen, null);
  assert.equal(llamadas.ia, 0);
});

test('trabajo de fondo (permitirIA): sin buena en los bancos, genera con IA y la marca como tal', async () => {
  const { llamadas, d } = deps({ puntuar: async () => ({ nota: 1, motivo: '', modelo: 'm' }), permitirIA: true });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(llamadas.ia, 1);
  assert.equal(imagen.fuente, 'IA');
  assert.equal(imagen.autor, null);
  assert.equal(imagen.licencia, null);
  assert.equal(imagen.url, '/imagenes/srv-eco-1.webp');
});

test('trabajo de fondo con el cupo de IA agotado: sigue sin imagen (pendiente) y no falla', async () => {
  const { llamadas, d } = deps({ puntuar: async () => null, permitirIA: true, cupo: { puede: () => false } });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(imagen, null);
  assert.equal(llamadas.ia, 0);
});

test('las imágenes descartadas («imagen mala») no se vuelven a elegir', async () => {
  const { llamadas, d } = deps({ descartadas: ['https://upload.wikimedia.org/a.jpg'] });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.ok(!llamadas.puntuar.includes('https://upload.wikimedia.org/a.jpg'));
  assert.equal(imagen.fuente, 'Met');
});

test('señal abortada (plazo vencido): corta las búsquedas y devuelve null', async () => {
  const controlador = new AbortController();
  controlador.abort();
  const { llamadas, d } = deps({ signal: controlador.signal });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(imagen, null);
  assert.deepEqual(llamadas.puntuar, []);
});

test('si una dependencia lanza, no se propaga: imagen null', async () => {
  const { d } = deps({ buscarCommons: async () => { throw new Error('Commons caído'); } });
  assert.deepEqual(await resolverImagen(PREGUNTA, d), { imagen: null });
});
