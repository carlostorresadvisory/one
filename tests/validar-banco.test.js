import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarPregunta, validarBanco } from '../tools/validar-banco.js';

function base(extra) {
  return {
    id: 'eco-001',
    area: 'economia',
    tipo: 'vf',
    nivel: 3,
    enunciado: 'texto',
    explicacion: 'idea clave',
    confianza: 0.9,
    generador: 'modelo-a',
    verificador: 'modelo-b',
    verificado: true,
    respuesta: true,
    ...extra,
  };
}

function test4Valida(extra) {
  return {
    id: 'his-001',
    area: 'historia',
    tipo: 'test4',
    nivel: 2,
    enunciado: 'texto',
    explicacion: 'idea clave',
    confianza: 0.8,
    generador: 'modelo-a',
    verificador: 'modelo-b',
    verificado: true,
    opciones: ['a', 'b', 'c', 'd'],
    correcta: 1,
    ...extra,
  };
}

function ordenarValida(extra) {
  return {
    id: 'cie-001',
    area: 'ciencia',
    tipo: 'ordenar',
    nivel: 1,
    enunciado: 'texto',
    explicacion: 'idea clave',
    confianza: 0.85,
    generador: 'modelo-a',
    verificador: 'modelo-b',
    verificado: true,
    criterio: 'de menor a mayor',
    items: ['uno', 'dos', 'tres', 'cuatro'],
    ...extra,
  };
}

function errorValida(extra) {
  return {
    id: 'tec-001',
    area: 'tecnologia',
    tipo: 'error',
    nivel: 4,
    enunciado: 'texto',
    explicacion: 'idea clave',
    confianza: 0.75,
    generador: 'modelo-a',
    verificador: 'modelo-b',
    verificado: true,
    tarjeta: {
      titulo: 'titulo',
      filas: [
        { etiqueta: 'a', valor: '1' },
        { etiqueta: 'b', valor: '2' },
        { etiqueta: 'c', valor: '3' },
      ],
    },
    sospechoso: 1,
    ...extra,
  };
}

test('pregunta vf válida devuelve []', () => {
  assert.deepEqual(validarPregunta(base()), []);
});

test('pregunta test4 válida devuelve []', () => {
  assert.deepEqual(validarPregunta(test4Valida()), []);
});

test('pregunta ordenar válida devuelve []', () => {
  assert.deepEqual(validarPregunta(ordenarValida()), []);
});

test('pregunta error válida devuelve []', () => {
  assert.deepEqual(validarPregunta(errorValida()), []);
});

test('test4 sin opciones da error', () => {
  const p = test4Valida();
  delete p.opciones;
  const errores = validarPregunta(p);
  assert.ok(errores.length > 0);
});

test('test4 con correcta 4 da error (fuera de rango)', () => {
  const errores = validarPregunta(test4Valida({ correcta: 4 }));
  assert.ok(errores.length > 0);
});

test('ordenar con items de 3 da error', () => {
  const errores = validarPregunta(ordenarValida({ items: ['uno', 'dos', 'tres'] }));
  assert.ok(errores.length > 0);
});

test('error con sospechoso fuera de rango da error', () => {
  const errores = validarPregunta(errorValida({ sospechoso: 9 }));
  assert.ok(errores.length > 0);
});

test('nivel 6 da error', () => {
  const errores = validarPregunta(base({ nivel: 6 }));
  assert.ok(errores.length > 0);
});

test('area desconocida da error', () => {
  const errores = validarPregunta(base({ area: 'no-existe' }));
  assert.ok(errores.length > 0);
});

test('validarBanco detecta ids duplicados como error', () => {
  const banco = [base(), base()];
  const { errores } = validarBanco(banco);
  assert.ok(errores.some((e) => /duplicad/i.test(e)));
});

test('banco de ejemplo: pasa el validador y trae >= 24 preguntas jugables de nivel 3-5 (>= 3 por área)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { esJugableDificil } = await import('../modos.js');
  const banco = JSON.parse(await readFile(new URL('../datos/banco.ejemplo.json', import.meta.url), 'utf8'));
  const { errores } = validarBanco(banco);
  assert.deepEqual(errores, []);
  const duras = banco.filter(esJugableDificil);
  assert.ok(duras.length >= 24, `solo ${duras.length}`);
  for (const area of ['economia', 'historia', 'ciencia', 'tecnologia', 'geografia', 'filosofia', 'arte', 'logica']) {
    assert.ok(duras.filter((p) => p.area === area).length >= 3, area);
  }
  const imagenes = JSON.parse(await readFile(new URL('../datos/imagenes.ejemplo.json', import.meta.url), 'utf8'));
  const ids = new Set(duras.map((p) => p.id));
  assert.ok(Object.keys(imagenes).filter((id) => ids.has(id)).length >= 4, 'faltan fotos de ejemplo en preguntas difíciles');
});

test('validarBanco avisa de área con menos de 20 preguntas', () => {
  const banco = [];
  for (let i = 0; i < 19; i++) {
    banco.push(base({ id: `eco-${String(i).padStart(3, '0')}` }));
  }
  const { avisos } = validarBanco(banco);
  assert.ok(avisos.some((a) => /economia/i.test(a)));
});

test('validarImagenes acepta WebP locales de imagenes-ia/ e imagenes-banco/ y rechaza otras rutas', async () => {
  const { validarImagenes } = await import('../tools/validar-banco.js');
  const banco = [base({ id: 'eco-001' }), base({ id: 'eco-002' }), base({ id: 'eco-003' })];
  const ok = {
    'eco-001': { url: 'imagenes-ia/eco-001.webp', fuente: 'IA', licencia: null, titulo: 'x', pagina: null },
    'eco-002': { url: 'imagenes-banco/eco-002.webp', fuente: 'Met', licencia: 'CC0', titulo: 'x', pagina: 'https://www.metmuseum.org/art/collection/search/1' },
  };
  assert.deepEqual(validarImagenes(banco, ok).errores, []);
  const mal = { 'eco-003': { url: 'http://otro.com/x.jpg', fuente: 'Met', licencia: 'CC0', titulo: 'x', pagina: 'https://a' } };
  assert.equal(validarImagenes(banco, mal).errores.length, 1);
  const sinLicencia = { 'eco-003': { url: 'imagenes-banco/eco-003.webp', fuente: 'Met', licencia: 'Todos los derechos', titulo: 'x', pagina: 'https://a' } };
  assert.equal(validarImagenes(banco, sinLicencia).errores.length, 1);
});

test('validarImagenes: CC BY / CC BY-SA sin autor es un error; con autor, CC0 o IA no', async () => {
  const { validarImagenes } = await import('../tools/validar-banco.js');
  const banco = [base({ id: 'eco-001' }), base({ id: 'eco-002' }), base({ id: 'eco-003' }), base({ id: 'eco-004' })];
  const u = 'https://upload.wikimedia.org/x.jpg';
  const resultado = validarImagenes(banco, {
    'eco-001': { url: u, licencia: 'CC BY-SA 3.0', autor: '', titulo: 'x', pagina: 'https://a' },
    'eco-002': { url: u, licencia: 'CC BY 4.0', autor: 'Ana', titulo: 'x', pagina: 'https://a' },
    'eco-003': { url: u, licencia: 'CC0', autor: '', titulo: 'x', pagina: 'https://a' },
    'eco-004': { url: 'imagenes-ia/eco-004.webp', fuente: 'IA', licencia: null, titulo: 'x', pagina: null },
  });
  assert.equal(resultado.errores.length, 1);
  assert.match(resultado.errores[0], /eco-001.*sin autor/);
});
