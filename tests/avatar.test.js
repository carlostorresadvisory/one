import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTOS, rutaClip, rutaFija, esSalida, gestoParaEvento, crearVigiaPensando, crearAvatar, montarReproductorMp4 } from '../avatar.js';
import { ElementoFalso, instalarDomFalso } from './dom-falso.js';
import { temporizadorFalso } from './temporizador-falso.js';

const ANCLAS = { fps: 60, salidas: [0, 1, 2, 3, 122, 123, 124, 125, 126] };
const SIN_MOVIMIENTO = { matchMedia: () => ({ matches: false }) };

function reproductorFalso({ falla = false } = {}) {
  const r = { pedidos: [], montajes: 0, destruido: false, cb: null };
  return {
    r,
    montar: () => ({
      gesto(nombre) { r.pedidos.push(nombre); if (falla && r.cb) r.cb(new Error('autoplay')); },
      destruir() { r.destruido = true; },
      reanudar() { r.reanudaciones = (r.reanudaciones || 0) + 1; },
      alFallar(cb) { r.cb = cb; r.montajes += 1; },
      alCambiar() {},
    }),
  };
}

test('rutas de clip y de imagen fija (la expresión más cercana)', () => {
  assert.equal(rutaClip('euforia'), 'avatar/euforia.mp4');
  assert.equal(rutaFija('acierto'), 'avatar/contenta.webp');
  assert.equal(rutaFija('sorpresa'), 'avatar/neutral.webp');
  assert.equal(rutaFija('rara'), 'avatar/neutral.webp');
  assert.equal(GESTOS.length, 6);
});
test('puntos de salida del reposo: solo los fotogramas de anclas.json, en bucle', () => {
  assert.equal(esSalida(2 / 60, 127 / 60, ANCLAS), true);
  assert.equal(esSalida(60 / 60, 127 / 60, ANCLAS), false);
  assert.equal(esSalida((127 + 1) / 60, 127 / 60, ANCLAS), true); // vuelta siguiente del bucle
});
test('mapa de gestos de la spec §7', () => {
  assert.equal(gestoParaEvento('abrir'), 'saludo');
  assert.equal(gestoParaEvento('quiebra'), 'triste');
  assert.equal(gestoParaEvento('fallo'), 'triste');
  assert.equal(gestoParaEvento('dorada'), 'sorpresa');
  for (const e of ['clavado', 'record', 'nuevoMaximo', 'cofre']) assert.equal(gestoParaEvento(e), 'euforia');
  assert.equal(gestoParaEvento('inactivo'), 'pensando');
  assert.equal(gestoParaEvento('nada'), null);
});
test('pensando: a los 8 s sin actividad, una sola vez; reiniciar lo aplaza', () => {
  const t = temporizadorFalso();
  let n = 0;
  const vigia = crearVigiaPensando({ temporizador: t, alPensar: () => { n += 1; } });
  vigia.reiniciar();
  t.avanzar(7000); vigia.reiniciar(); t.avanzar(7000);
  assert.equal(n, 0);
  t.avanzar(1500);
  assert.equal(n, 1);
  t.avanzar(20000);
  assert.equal(n, 1);
  vigia.reiniciar(); vigia.parar(); t.avanzar(20000);
  assert.equal(n, 1);
});
test('crearAvatar: arranca en vídeo, es decorativo y pasa los gestos válidos (los desconocidos se ignoran)', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const contenedor = new ElementoFalso('div');
  const f = reproductorFalso();
  const av = crearAvatar(contenedor, { tamano: 'protagonista', documento: globalThis.document, ventana: SIN_MOVIMIENTO, montarReproductor: f.montar });
  av.gesto('euforia'); av.gesto('baila');
  assert.deepEqual(f.r.pedidos, ['euforia']);
  assert.equal(av.modo(), 'video');
  assert.equal(contenedor.getAttribute('aria-hidden'), 'true');
  assert.ok(contenedor.classList.contains('avatar--protagonista'));
  assert.equal(contenedor.children[0].tagName, 'canvas');
});
test('si el vídeo falla, sale la imagen fija del gesto, vuelve a neutral y se reintenta en el siguiente toque', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const contenedor = new ElementoFalso('div');
  const tiempo = temporizadorFalso();
  const f = reproductorFalso({ falla: true });
  const av = crearAvatar(contenedor, { documento: globalThis.document, ventana: SIN_MOVIMIENTO, montarReproductor: f.montar, temporizador: tiempo });
  av.gesto('acierto');
  assert.equal(av.modo(), 'fijo');
  const imagen = contenedor.children[0];
  assert.equal(imagen.tagName, 'img');
  assert.equal(imagen.getAttribute('alt'), '');
  assert.equal(imagen.getAttribute('aria-hidden'), 'true');
  assert.equal(imagen.src, 'avatar/contenta.webp');
  tiempo.avanzar(1500);
  assert.equal(contenedor.children[0].src, 'avatar/neutral.webp');
  globalThis.document.disparar('pointerdown');
  assert.equal(av.modo(), 'video');
  assert.equal(f.r.montajes, 2);
  assert.equal(contenedor.children[0].tagName, 'canvas');
  av.destruir();
});
test('autoplay bloqueado: cada toque repite play() sobre el mismo reproductor y lienzo, sin remontar', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const contenedor = new ElementoFalso('div');
  const f = reproductorFalso();
  const av = crearAvatar(contenedor, { documento: globalThis.document, ventana: SIN_MOVIMIENTO, montarReproductor: f.montar, temporizador: temporizadorFalso() });
  const lienzo = contenedor.children[0];
  f.r.cb('play');
  assert.equal(av.modo(), 'fijo');
  assert.equal(f.r.destruido, false);
  for (let i = 1; i <= 3; i += 1) {
    globalThis.document.disparar('pointerdown');
    assert.equal(av.modo(), 'video');
    assert.equal(contenedor.children[0], lienzo);
    assert.equal(f.r.reanudaciones, i);
    f.r.cb('play'); // sigue bloqueado
  }
  assert.equal(f.r.montajes, 1);
  av.destruir();
  assert.equal(f.r.destruido, true);
});
test('si no se puede montar el reproductor (sin WebGL ni 2D), imagen fija y no lanza', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const contenedor = new ElementoFalso('div');
  const av = crearAvatar(contenedor, {
    documento: globalThis.document, ventana: SIN_MOVIMIENTO, temporizador: temporizadorFalso(),
    montarReproductor: () => { throw new Error('sin contexto'); },
  });
  assert.equal(av.modo(), 'fijo');
  assert.equal(contenedor.children[0].tagName, 'img');
  av.destruir();
});
test('con reducir movimiento solo hay imagen fija y no se monta ningún reproductor', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const contenedor = new ElementoFalso('div');
  const f = reproductorFalso();
  const av = crearAvatar(contenedor, {
    documento: globalThis.document, ventana: { matchMedia: () => ({ matches: true }) },
    montarReproductor: f.montar, temporizador: temporizadorFalso(),
  });
  assert.equal(av.modo(), 'fijo');
  assert.equal(f.r.montajes, 0);
  assert.equal(globalThis.document.oyentes('pointerdown'), 0); // tampoco reintenta
  av.destruir();
});
test('destruir suelta el reproductor, vacía el contenedor y quita el oyente de reintento', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const contenedor = new ElementoFalso('div');
  const f = reproductorFalso({ falla: true });
  const av = crearAvatar(contenedor, { documento: globalThis.document, ventana: SIN_MOVIMIENTO, montarReproductor: f.montar, temporizador: temporizadorFalso() });
  av.gesto('triste');
  av.destruir();
  assert.equal(f.r.destruido, true);
  assert.equal(contenedor.children.length, 0);
  assert.equal(globalThis.document.oyentes('pointerdown'), 0);
});

// --- montarReproductorMp4 con vídeos, GL y requestAnimationFrame falsos ---
const tick = () => new Promise((resolve) => setImmediate(resolve));

function entorno(opciones = {}) {
  const creados = [];
  const liberados = [];
  let siguienteFotograma = null;
  let reloj = 0;
  const perdidos = [];
  const gl = new Proxy({}, { get: (_, k) => {
    if (k === 'getExtension') return (nombre) => (nombre === 'WEBGL_lose_context' ? { loseContext: () => perdidos.push(nombre) } : null);
    return /^[A-Z_0-9]+$/.test(String(k)) ? 1 : () => ({});
  } });
  const lienzo = new ElementoFalso('canvas');
  lienzo.style = { setProperty() {} };
  lienzo.getContext = () => gl;
  const documento = {
    createElement(tag) {
      const v = new ElementoFalso(tag);
      Object.assign(v, { readyState: 0, currentTime: 0, duration: 127 / 60, reproducciones: 0, pausado: false });
      v.play = () => { v.reproducciones += 1; return Promise.resolve(); };
      v.pause = () => { v.pausado = true; };
      v.load = () => {};
      v.removeAttribute = (nombre) => { if (nombre === 'src') v.src = undefined; };
      creados.push(v);
      return v;
    },
  };
  const ventana = {
    performance: { now: () => reloj },
    requestAnimationFrame: (cb) => { siguienteFotograma = cb; return 1; },
    cancelAnimationFrame: () => { siguienteFotograma = null; },
    devicePixelRatio: 1,
  };
  const cargarClip = opciones.cargarClip || ((ruta) => Promise.resolve({ src: `blob:${ruta}`, liberar: () => liberados.push(ruta) }));
  const reproductor = montarReproductorMp4(lienzo, { documento, ventana, anclas: ANCLAS, cargarClip });
  return {
    reproductor, lienzo, liberados, creados, perdidos,
    clip: (nombre) => creados.find((v) => v.src === `blob:avatar/${nombre}.mp4`),
    fotograma: () => siguienteFotograma && siguienteFotograma(),
    pasarMs: (ms) => { reloj += ms; },
    hayFotograma: () => siguienteFotograma !== null,
  };
}

/** Monta el entorno con el reposo ya sonando en un punto que no es de salida. */
async function conReposo() {
  const e = entorno();
  await tick();
  const reposo = e.clip('reposo');
  reposo.readyState = 2; reposo.currentTime = 1; // fotograma 60: no es salida
  e.fotograma();
  return { ...e, reposo };
}

test('reproductor: vídeos muted + playsinline y el reposo en bucle', async () => {
  const { reposo } = await conReposo();
  assert.equal(reposo.muted, true);
  assert.equal(reposo.loop, true);
  assert.ok('playsinline' in reposo.attrs && 'webkit-playsinline' in reposo.attrs && 'muted' in reposo.attrs);
  assert.equal(reposo.reproducciones, 1);
});
test('reproductor: un gesto espera a un punto de salida del reposo y no corta el reposo a medias', async () => {
  const e = await conReposo();
  e.reproductor.gesto('acierto');
  await tick();
  const acierto = e.clip('acierto');
  acierto.readyState = 2;
  e.fotograma();
  assert.equal(acierto.reproducciones, 0);
  e.reposo.currentTime = 2 / 60; // fotograma 2: salida
  e.fotograma();
  assert.equal(acierto.reproducciones, 1);
  assert.equal(e.reposo.pausado, false);
});
test('reproductor: un segundo gesto mientras el primero espera lo sustituye', async () => {
  const e = await conReposo();
  e.reproductor.gesto('acierto');
  e.reproductor.gesto('triste');
  await tick();
  e.clip('acierto').readyState = 2;
  e.clip('triste').readyState = 2;
  e.reposo.currentTime = 2 / 60;
  e.fotograma();
  assert.equal(e.clip('triste').reproducciones, 1);
  assert.equal(e.clip('acierto').reproducciones, 0);
});
test('reproductor: al acabar el gesto vuelve solo al reposo', async () => {
  const e = await conReposo();
  const cambios = [];
  e.reproductor.alCambiar((n) => cambios.push(n));
  e.reproductor.gesto('euforia');
  await tick();
  const euforia = e.clip('euforia');
  euforia.readyState = 2;
  e.reposo.currentTime = 2 / 60;
  e.fotograma();
  euforia.currentTime = 0.1; // ya hay primer fotograma: relevo
  e.fotograma();
  assert.deepEqual(cambios, ['euforia']);
  assert.equal(e.reposo.pausado, true);
  const reproduccionesReposo = e.reposo.reproducciones;
  euforia.disparar('ended');
  assert.equal(e.reposo.reproducciones, reproduccionesReposo + 1);
  e.reposo.currentTime = 0.1;
  e.fotograma();
  assert.deepEqual(cambios, ['euforia', 'reposo']);
});
test('reproductor: un clip que no está listo en 4 s se descarta sin lanzar y el reposo sigue', async () => {
  const e = await conReposo();
  e.reproductor.gesto('sorpresa');
  await tick();
  e.pasarMs(4500);
  e.reposo.currentTime = 2 / 60;
  e.fotograma(); // descarta
  e.clip('sorpresa').readyState = 2;
  e.fotograma();
  assert.equal(e.clip('sorpresa').reproducciones, 0);
  assert.equal(e.hayFotograma(), true);
});
test('reproductor: webglcontextlost avisa del fallo', () => {
  const e = entorno();
  let fallos = 0;
  e.reproductor.alFallar(() => { fallos += 1; });
  let prevenido = false;
  e.lienzo.disparar('webglcontextlost', { preventDefault: () => { prevenido = true; } });
  assert.equal(fallos, 1);
  assert.equal(prevenido, true);
});
test('reproductor: si no se puede descargar el reposo, avisa del fallo', async () => {
  let fallos = 0;
  const e = entorno({ cargarClip: () => Promise.reject(new Error('404')) });
  e.reproductor.alFallar(() => { fallos += 1; });
  await tick();
  assert.equal(fallos, 1);
});
test('reproductor: si play() del reposo es rechazado (autoplay bloqueado), avisa del fallo', async () => {
  const e = entorno();
  let fallos = 0;
  let razon = null;
  e.reproductor.alFallar((r) => { fallos += 1; razon = r; });
  const reposo = e.creados[0];
  reposo.play = () => Promise.reject(new Error('autoplay'));
  await tick(); // llega el clip y se arranca el reposo
  await tick();
  assert.equal(fallos, 1);
  assert.equal(razon, 'play');
});
test('reproductor: destruir cancela el fotograma, suelta los vídeos y revoca las URL', async () => {
  const e = await conReposo();
  e.reproductor.gesto('saludo');
  await tick();
  e.reproductor.destruir();
  assert.equal(e.hayFotograma(), false);
  assert.equal(e.reposo.pausado, true);
  assert.equal(e.reposo.src, undefined);
  assert.deepEqual([...e.liberados].sort(), ['avatar/reposo.mp4', 'avatar/saludo.mp4']);
  e.reproductor.gesto('triste'); // tras destruir no hace nada
});
test('reproductor: sin WebGL ni canvas 2D lanza (crearAvatar lo convierte en imagen fija)', () => {
  const lienzo = new ElementoFalso('canvas');
  lienzo.getContext = () => null;
  assert.throws(() => montarReproductorMp4(lienzo, { documento: {}, ventana: {}, anclas: ANCLAS, cargarClip: () => Promise.resolve() }));
});
test('reproductor: destruir libera el contexto WebGL y quita el oyente de contexto perdido', async () => {
  const e = await conReposo();
  let fallos = 0;
  e.reproductor.alFallar(() => { fallos += 1; });
  e.reproductor.destruir();
  assert.deepEqual(e.perdidos, ['WEBGL_lose_context']);
  e.lienzo.disparar('webglcontextlost');
  assert.equal(fallos, 0);
});
test('reproductor: reanudar repite play() del reposo en el mismo vídeo', async () => {
  const e = await conReposo();
  const antes = e.reposo.reproducciones;
  e.reproductor.reanudar();
  assert.equal(e.reposo.reproducciones, antes + 1);
  assert.equal(e.creados.filter((v) => v.tagName === 'video').length, 1);
});
