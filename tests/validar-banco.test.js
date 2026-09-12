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

test('validarBanco avisa de área con menos de 20 preguntas', () => {
  const banco = [];
  for (let i = 0; i < 19; i++) {
    banco.push(base({ id: `eco-${String(i).padStart(3, '0')}` }));
  }
  const { avisos } = validarBanco(banco);
  assert.ok(avisos.some((a) => /economia/i.test(a)));
});
