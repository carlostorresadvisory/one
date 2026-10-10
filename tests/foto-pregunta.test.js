// Tests de foto-pregunta.js (spec v0.3 §4): crédito real, color del área sin emoji y brillo dorado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditoTexto, montarFotoPregunta } from '../foto-pregunta.js';
import { instalarDomFalso } from './dom-falso.js';

const COMMONS = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',
  pagina: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  autor: 'Ana Pérez',
  licencia: 'CC BY-SA 4.0',
};

test('creditoTexto: Commons con autor porque la licencia lo exige', () => {
  assert.equal(creditoTexto(COMMONS), 'Commons · Ana Pérez · CC BY-SA 4.0');
});
test('creditoTexto: Met en dominio público, sin autor obligatorio', () => {
  const met = { url: 'https://images.metmuseum.org/a.jpg', pagina: 'https://www.metmuseum.org/art/collection/search/1', autor: 'Vincent van Gogh', licencia: 'CC0' };
  assert.equal(creditoTexto(met), 'Met · CC0');
});
test('creditoTexto: la fuente explícita manda sobre el dominio; sin autor aunque la licencia lo pida', () => {
  assert.equal(creditoTexto({ ...COMMONS, fuente: 'Openverse', autor: '' }), 'Openverse · CC BY-SA 4.0');
});
test('creditoTexto: imagen de IA y sin imagen', () => {
  assert.equal(creditoTexto({ url: 'x', ia: true }), 'Imagen generada con IA');
  assert.equal(creditoTexto({ url: 'x', fuente: 'IA' }), 'Imagen generada con IA');
  assert.equal(creditoTexto(null), '');
  assert.equal(creditoTexto(undefined), '');
});

function montar(opciones = {}) {
  const desinstalar = instalarDomFalso();
  const contenedor = document.createElement('div');
  const foto = montarFotoPregunta(contenedor, { enunciado: '¿Quién?', area: 'historia', ...opciones });
  return { contenedor, foto, desinstalar, raiz: contenedor.children[0] };
}

test('el enunciado va encima de la foto, con su crédito', () => {
  const { foto, raiz, desinstalar } = montar({ imagen: COMMONS });
  try {
    assert.equal(foto.nodoEnunciado.textContent, '¿Quién?');
    assert.ok(raiz.buscarPorClase('foto-pregunta-imagen'));
    assert.equal(raiz.buscarPorClase('foto-pregunta-credito').textContent, 'Commons · Ana Pérez · CC BY-SA 4.0');
    assert.ok(raiz.classList.contains('foto-pregunta--historia'));
    // El enunciado y el crédito se añaden después de la imagen, así quedan por encima.
    const clases = raiz.children.map((h) => [...h._clases][0]);
    assert.ok(clases.indexOf('foto-pregunta-imagen') < clases.indexOf('foto-pregunta-enunciado'));
  } finally {
    desinstalar();
  }
});

test('una imagen que no carga se quita con su crédito; queda el color del área y ningún emoji', () => {
  const { contenedor, raiz, desinstalar } = montar({ imagen: COMMONS });
  try {
    raiz.buscarPorClase('foto-pregunta-imagen').disparar('error');
    assert.equal(raiz.buscarPorClase('foto-pregunta-imagen'), null);
    assert.equal(raiz.buscarPorClase('foto-pregunta-credito'), null);
    assert.equal(contenedor.children.length, 1);
    assert.ok(raiz.classList.contains('foto-pregunta--historia'));
    assert.doesNotMatch(raiz.textoPlano, /\p{Extended_Pictographic}/u);
  } finally {
    desinstalar();
  }
});

test('sin imagen no hay <img> ni crédito, y tampoco emoji', () => {
  const { raiz, desinstalar } = montar({ imagen: null });
  try {
    assert.equal(raiz.buscarPorClase('foto-pregunta-imagen'), null);
    assert.equal(raiz.buscarPorClase('foto-pregunta-credito'), null);
    assert.doesNotMatch(raiz.textoPlano, /\p{Extended_Pictographic}/u);
  } finally {
    desinstalar();
  }
});

test('ponerDorada enciende y apaga el borde dorado; dorada inicial; destruir saca el nodo', () => {
  const { contenedor, foto, raiz, desinstalar } = montar({ imagen: COMMONS });
  try {
    assert.equal(raiz.classList.contains('foto-pregunta--dorada'), false);
    foto.ponerDorada(true);
    assert.equal(raiz.classList.contains('foto-pregunta--dorada'), true);
    foto.ponerDorada(false);
    assert.equal(raiz.classList.contains('foto-pregunta--dorada'), false);
    foto.destruir();
    assert.equal(contenedor.children.length, 0);
  } finally {
    desinstalar();
  }
  const otra = montar({ dorada: true });
  try {
    assert.equal(otra.raiz.classList.contains('foto-pregunta--dorada'), true);
  } finally {
    otra.desinstalar();
  }
});
