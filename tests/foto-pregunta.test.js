// Tests de foto-pregunta.js (spec v0.3 §4): crédito real, color del área sin emoji y brillo dorado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reintentarImagen, creditoTexto, esImagenValida, esPaginaSegura, montarFotoPregunta, cargarImagenesMalas, guardarImagenesMalas, CLAVE_IMAGENES_MALAS } from '../foto-pregunta.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';
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
test('creditoTexto: no repite la fuente cuando el autor la trae delante', () => {
  assert.equal(creditoTexto({ ...COMMONS, autor: 'Wikimedia Commons / Mu' }), 'Commons · Mu · CC BY-SA 4.0');
  assert.equal(creditoTexto({ ...COMMONS, autor: 'Commons' }), 'Commons · CC BY-SA 4.0');
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
    const img = raiz.buscarPorClase('foto-pregunta-imagen');
    const original = globalThis.setTimeout;
    const pendientes = [];
    globalThis.setTimeout = (fn, ms) => { pendientes.push([fn, ms]); return 0; };
    try {
      img.disparar('error');
      assert.equal(pendientes.length, 1, 'primer fallo: reintento programado, la imagen sigue');
      assert.equal(pendientes[0][1], 1500);
      assert.ok(raiz.buscarPorClase('foto-pregunta-imagen'));
      pendientes[0][0]();
      assert.match(img.src, /\?reintento=1$/);
    } finally {
      globalThis.setTimeout = original;
    }
    img.disparar('error');
    assert.equal(raiz.buscarPorClase('foto-pregunta-imagen'), null);
    assert.equal(raiz.buscarPorClase('foto-pregunta-credito'), null);
    assert.equal(contenedor.children.length, 1);
    assert.ok(raiz.classList.contains('foto-pregunta--historia'));
    assert.doesNotMatch(raiz.textoPlano, /\p{Extended_Pictographic}/u);
  } finally {
    desinstalar();
  }
});

test('reintentarImagen: un solo reintento con parámetro nuevo (& si ya hay query) y luego alFallar', () => {
  const img = { src: 'https://h/a.webp?x=1', _o: [], addEventListener(t, f) { this._o.push(f); } };
  const cola = [];
  let fallos = 0;
  reintentarImagen(img, () => { fallos += 1; }, (fn, ms) => cola.push([fn, ms]));
  img._o[0]();
  assert.deepEqual(cola.map((c) => c[1]), [1500]);
  assert.equal(fallos, 0);
  cola[0][0]();
  assert.equal(img.src, 'https://h/a.webp?x=1&reintento=1');
  img._o[0]();
  assert.equal(fallos, 1);
  assert.equal(cola.length, 1, 'no hay segundo reintento');
});

test('reintentarImagen: si la imagen ya no está en el DOM o cambió de URL, el reintento no hace nada', () => {
  const montarImg = () => ({ src: 'https://h/a.webp', isConnected: true, _o: [], addEventListener(t, f) { this._o.push(f); } });
  const quitada = montarImg();
  const cola = [];
  reintentarImagen(quitada, () => {}, (fn) => cola.push(fn));
  quitada._o[0]();
  quitada.isConnected = false;
  cola[0]();
  assert.equal(quitada.src, 'https://h/a.webp');
  const cambiada = montarImg();
  reintentarImagen(cambiada, () => {}, (fn) => cola.push(fn));
  cambiada._o[0]();
  cambiada.src = 'https://h/otra.webp';
  cola[1]();
  assert.equal(cambiada.src, 'https://h/otra.webp');
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

test('imágenes malas: se guardan, se cargan y con basura o almacén roto no lanzan', () => {
  const alm = almacenFalso();
  assert.equal(cargarImagenesMalas(alm).size, 0);
  assert.equal(guardarImagenesMalas(new Set(['art-001', 'srv-9']), alm), true);
  assert.deepEqual([...cargarImagenesMalas(alm)], ['art-001', 'srv-9']);
  alm.setItem(CLAVE_IMAGENES_MALAS, '{"no":"una lista"}');
  assert.equal(cargarImagenesMalas(alm).size, 0);
  alm.setItem(CLAVE_IMAGENES_MALAS, '["ok", 5, "", null]');
  assert.deepEqual([...cargarImagenesMalas(alm)], ['ok']);
  assert.equal(cargarImagenesMalas(almacenRoto()).size, 0);
  assert.equal(guardarImagenesMalas(new Set(['a']), almacenRoto()), false);
});

test('enlaces de atribución: solo https (nada de javascript:, data: ni http)', () => {
  assert.equal(esPaginaSegura('https://commons.wikimedia.org/wiki/File:X.jpg'), true);
  for (const mala of ['javascript:alert(1)', 'data:text/html,x', 'http://commons.wikimedia.org', '//commons.wikimedia.org', '', null, undefined, 5]) {
    assert.equal(esPaginaSegura(mala), false, String(mala));
  }
});
test('esImagenValida: una página de origen que no es https invalida la imagen; null/ausente vale', () => {
  const base = { url: 'https://upload.wikimedia.org/a.jpg', fuente: 'Commons' };
  assert.equal(esImagenValida({ ...base, pagina: 'https://commons.wikimedia.org/wiki/File:A' }), true);
  assert.equal(esImagenValida({ ...base, pagina: null }), true);
  assert.equal(esImagenValida(base), true);
  assert.equal(esImagenValida({ ...base, pagina: 'javascript:alert(1)' }), false);
  assert.equal(esImagenValida({ ...base, pagina: 'http://x.org' }), false);
});
