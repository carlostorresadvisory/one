// Reglas de imagen compartidas (servidor/politica-imagen.js): IA, publicación y descarga acotada. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iaPermitida, iaMejoraActual, imagenPublicable, exigeAutor, descargarAcotado } from '../servidor/politica-imagen.js';

test('IA: nunca en arte; en historia y geografía solo si nada pide mapa, persona, lugar o hecho concreto', () => {
  assert.equal(iaPermitida({ area: 'arte', enunciado: 'El color rojo suele asociarse a la pasión.' }), false);
  assert.equal(iaPermitida({ area: 'historia', enunciado: 'El Tratado de Utrecht puso fin a la guerra.' }), false);
  assert.equal(iaPermitida({ area: 'geografia', enunciado: 'El desierto de Gobi está en América del Sur.' }), false);
  assert.equal(iaPermitida({ area: 'geografia', enunciado: 'Señala el mapa de Europa.' }), false);
  assert.equal(iaPermitida({ area: 'historia', enunciado: 'Encuentra el dato erróneo.', tarjeta: { filas: [{ valor: 'Reconoció a las Provincias Unidas' }] } }), false);
  assert.equal(iaPermitida({ area: 'historia', enunciado: 'Ocurrió en 1701.' }), false);
  assert.equal(iaPermitida({ area: 'historia', enunciado: 'El comercio con monedas mejoró la vida cotidiana.' }), true);
  assert.equal(iaPermitida({ area: 'ciencia', enunciado: 'El oxígeno es el 21% del aire.' }), true);
  assert.equal(iaPermitida({ area: 'tecnologia', enunciado: '¿Qué protocolo cifra archivos?' }), true);
});

test('IA: solo vale con nota >= 4 y por encima de la actual', () => {
  assert.equal(iaMejoraActual(4, null), true);
  assert.equal(iaMejoraActual(3, null), false);
  assert.equal(iaMejoraActual(4, 4), false);
  assert.equal(iaMejoraActual(5, 4), true);
  assert.equal(iaMejoraActual(5, 5), false);
  assert.equal(iaMejoraActual(null, 1), false);
});

const base = { url: 'https://upload.wikimedia.org/a.jpg', licencia: 'CC BY 4.0', autor: 'Ana', fuente: 'Commons' };

test('publicable: licencia libre, autor si la licencia lo exige y URL de dominio conocido o /imagenes/', () => {
  assert.equal(imagenPublicable(base), true);
  assert.equal(imagenPublicable({ ...base, autor: '' }), false);
  assert.equal(imagenPublicable({ ...base, licencia: 'Public domain', autor: '' }), true);
  assert.equal(imagenPublicable({ ...base, licencia: 'CC BY-NC 4.0' }), false);
  assert.equal(imagenPublicable({ ...base, licencia: null }), false);
  assert.equal(imagenPublicable({ ...base, url: 'http://upload.wikimedia.org/a.jpg' }), false);
  assert.equal(imagenPublicable({ ...base, url: 'https://malo.example/a.jpg' }), false);
  assert.equal(imagenPublicable({ ...base, url: '/imagenes/x-1.webp', licencia: 'CC0', autor: '', fuente: 'Met' }), true);
  assert.equal(imagenPublicable({ url: '/imagenes/x-1.webp', fuente: 'IA', licencia: null, autor: null }), true);
  assert.equal(imagenPublicable({ url: 'https://upload.wikimedia.org/a.jpg', fuente: 'IA' }), false);
  assert.equal(imagenPublicable(null), false);
  assert.equal(exigeAutor('CC BY-SA 3.0'), true);
  assert.equal(exigeAutor('CC0'), false);
});

function respuesta({ ok = true, status = 200, longitud = null, trozos = [] } = {}) {
  let i = 0;
  return {
    ok, status,
    headers: { get: (k) => (k.toLowerCase() === 'content-length' && longitud != null ? String(longitud) : null) },
    body: { getReader: () => ({ read: async () => (i < trozos.length ? { done: false, value: trozos[i++] } : { done: true }), cancel: async () => {} }), cancel: async () => {} },
  };
}

test('descarga: corta por Content-Length, al leer y devuelve lo que cabe', async () => {
  await assert.rejects(descargarAcotado('https://x', { fetchImpl: async () => respuesta({ longitud: 9e6 }) }), /demasiado grande/);
  await assert.rejects(descargarAcotado('https://x', { maxBytes: 10, fetchImpl: async () => respuesta({ trozos: [new Uint8Array(6), new Uint8Array(6)] }) }), /demasiado grande/);
  const buf = await descargarAcotado('https://x', { maxBytes: 20, fetchImpl: async () => respuesta({ trozos: [new Uint8Array(6), new Uint8Array(6)] }) });
  assert.equal(buf.length, 12);
  await assert.rejects(descargarAcotado('https://x', { fetchImpl: async () => respuesta({ ok: false, status: 404 }) }), /HTTP 404/);
});
