// Imagen de las preguntas generadas (servidor/imagenes.js): sin red, con dependencias simuladas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverImagen, MAX_CANDIDATAS_POR_FUENTE } from '../servidor/imagenes.js';

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
    generarIA: async (p) => { llamadas.ia += 1; return { dataUrl: 'data:image/webp;base64,AAAA', guardar: async () => { llamadas.guardar += 1; return `/imagenes/${p.id}.webp`; } }; },
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

const puntuaIA = (notaIA) => async ({ url }) => ({ nota: url.startsWith('data:') ? notaIA : 1, motivo: '', modelo: 'm' });
const CIENCIA = { id: 'srv-cie-1', area: 'ciencia', enunciado: '¿Cuánto oxígeno hay en el aire?', explicacion: 'El 21%.' };

test('trabajo de fondo (permitirIA): sin buena en los bancos, genera con IA, la puntúa y la marca como tal', async () => {
  const { llamadas, d } = deps({ puntuar: puntuaIA(4), permitirIA: true });
  const { imagen } = await resolverImagen(CIENCIA, d);
  assert.equal(llamadas.ia, 1);
  assert.equal(imagen.nota, 4);
  assert.equal(imagen.fuente, 'IA');
  assert.equal(imagen.autor, null);
  assert.equal(imagen.licencia, null);
  assert.equal(imagen.url, '/imagenes/srv-cie-1.webp');
});

test('trabajo de fondo con el cupo de IA agotado: sigue sin imagen (pendiente) y no falla', async () => {
  const { llamadas, d } = deps({ puntuar: async () => ({ nota: 1, motivo: '', modelo: 'm' }), permitirIA: true, cupo: { puede: () => false } });
  const salida = await resolverImagen(CIENCIA, d);
  assert.deepEqual(salida, { imagen: null, sinIAHoy: true }, 'la cola sabe que hoy no hay IA y que mañana sí puede haberla');
  assert.equal(llamadas.ia, 0);
});

test('v0.3.5: el proveedor de IA no responde (cuota de Cloudflare, sin clave...): sinIAHoy, sin guardar nada', async () => {
  const { llamadas, d } = deps({ puntuar: puntuaIA(5), permitirIA: true, generarIA: async () => null });
  const salida = await resolverImagen(CIENCIA, d);
  assert.deepEqual(salida, { imagen: null, sinIAHoy: true });
  assert.equal(llamadas.guardar, 0);
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

test('si una dependencia lanza, no se propaga: imagen null y fallo técnico', async () => {
  const { d } = deps({ proponerTerminos: async () => { throw new Error('modelo caído'); } });
  assert.deepEqual(await resolverImagen(PREGUNTA, d), { imagen: null, tecnico: true });
});

// C1: la IA solo entra con nota >= 4; si el juez la puntúa por debajo, no se guarda.
test('IA con nota 3: se descarta sin guardarla', async () => {
  const { llamadas, d } = deps({ puntuar: puntuaIA(3), permitirIA: true });
  const salida = await resolverImagen(CIENCIA, d);
  assert.deepEqual(salida, { imagen: null }, 'generó y el juez la rechazó: ni «no aplica» ni «sin IA hoy»');
  assert.equal(llamadas.ia, 1);
  assert.equal(llamadas.guardar, 0);
});

// C2: arte, o historia/geografía con algo concreto, nunca usan IA.
test('arte y geografía con lugar concreto: la IA ni se pide', async () => {
  for (const p of [{ id: 'a', area: 'arte', enunciado: 'Obra de Goya', explicacion: '' }, { id: 'g', area: 'geografia', enunciado: 'El río Nilo.', explicacion: '' }]) {
    const { llamadas, d } = deps({ puntuar: puntuaIA(5), permitirIA: true });
    const salida = await resolverImagen(p, d);
    assert.deepEqual(salida, { imagen: null, iaNoAplica: true });
    assert.equal(llamadas.ia, 0);
  }
});

// I1: un fallo técnico no es «no hay imagen buena»: no baja a la IA.
test('visión que no responde: pendiente (tecnico) y la IA no se toca', async () => {
  const { llamadas, d } = deps({ puntuar: async () => null, permitirIA: true });
  const salida = await resolverImagen(CIENCIA, d);
  assert.deepEqual(salida, { imagen: null, tecnico: true });
  assert.equal(llamadas.ia, 0);
});

test('descarga fallida del banco o puntuar que lanza: tecnico, sin IA', async () => {
  const a = deps({ puntuar: async ({ url }) => ({ nota: url.includes('wikimedia') ? 1 : 5, motivo: '', modelo: 'm' }), guardarArchivo: async () => { throw new Error('HTTP 500'); }, permitirIA: true });
  assert.deepEqual(await resolverImagen(CIENCIA, a.d), { imagen: null, tecnico: true });
  assert.equal(a.llamadas.ia, 0);
  const b = deps({ puntuar: async () => { throw new Error('boom'); }, permitirIA: true });
  assert.equal((await resolverImagen(CIENCIA, b.d)).tecnico, true);
});

test('fuente agotada de verdad (todas puntuadas por debajo de 4) sí puede bajar a la IA', async () => {
  const { llamadas, d } = deps({ puntuar: puntuaIA(5), permitirIA: true });
  assert.equal((await resolverImagen(CIENCIA, d)).imagen.fuente, 'IA');
  assert.equal(llamadas.ia, 1);
});

test('Commons caído (búsqueda que lanza) no cuenta como agotada: no baja a la IA', async () => {
  const { llamadas, d } = deps({ buscarCommons: async () => { throw new Error('HTTP 429'); }, buscarBancos: async () => [], puntuar: puntuaIA(5), permitirIA: true });
  const salida = await resolverImagen(CIENCIA, d);
  assert.equal(salida.tecnico, true);
  assert.equal(llamadas.ia, 0);
});

test('prueba hasta 6 candidatas por fuente y busca también con el enunciado', async () => {
  assert.equal(MAX_CANDIDATAS_POR_FUENTE, 6);
  const vistas = [];
  const { d } = deps({
    proponerTerminos: async () => ['oxygen air', 'atmosphere', 'ES: oxígeno aire'],
    buscarCommons: async (t) => { vistas.push(t); return Array.from({ length: 8 }, (_, i) => cand(`https://upload.wikimedia.org/${t.replace(/\W/g, '')}${i}.jpg`)); },
    buscarBancos: async () => [],
    puntuar: async () => ({ nota: 2, motivo: '', modelo: 'm' }),
  });
  const puntuadas = [];
  d.puntuar = async ({ url }) => { puntuadas.push(url); return { nota: 2, motivo: '', modelo: 'm' }; };
  await resolverImagen(CIENCIA, d);
  assert.equal(puntuadas.length, 18);
  assert.deepEqual(vistas, ['oxygen air', 'atmosphere', 'ES: oxígeno aire']);
});

// I4: solo se publica lo que cumple licencia + autor.
test('candidata CC BY sin autor: se salta sin gastar nota', async () => {
  const { llamadas, d } = deps({ buscarCommons: async () => [cand('https://upload.wikimedia.org/s.jpg', { autor: '' })], buscarBancos: async () => [] });
  const { imagen } = await resolverImagen(PREGUNTA, d);
  assert.equal(imagen, null);
  assert.equal(llamadas.puntuar.length, 0);
});
