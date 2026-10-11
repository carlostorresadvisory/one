import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTOS, rutaClip, rutaFija, esSalida, puenteDeSalida, gestoParaEvento, crearVigiaPensando, crearAvatar, montarReproductorMp4 } from '../avatar.js';
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
  const oyentes = {};
  const documento = {
    visibilityState: 'visible',
    addEventListener: (tipo, fn) => { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    removeEventListener: (tipo, fn) => { oyentes[tipo] = (oyentes[tipo] || []).filter((f) => f !== fn); },
    createElement(tag) {
      const v = new ElementoFalso(tag);
      if (opciones.ganchoVideo && tag === 'video') opciones.ganchoVideo(v);
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
    addEventListener: (tipo, fn) => { (oyentes[`v:${tipo}`] = oyentes[`v:${tipo}`] || []).push(fn); },
    removeEventListener: (tipo, fn) => { oyentes[`v:${tipo}`] = (oyentes[`v:${tipo}`] || []).filter((f) => f !== fn); },
  };
  const cargarClip = opciones.cargarClip || ((ruta) => Promise.resolve({ src: `blob:${ruta}`, liberar: () => liberados.push(ruta) }));
  const medidas = [];
  const reproductor = montarReproductorMp4(lienzo, {
    documento, ventana, anclas: opciones.anclas || ANCLAS, cargarClip, residentes: opciones.residentes, alMedir: (ms, n) => medidas.push([ms, n]),
  });
  return {
    reproductor, lienzo, liberados, creados, perdidos, medidas,
    clip: (nombre) => creados.find((v) => v.src === `blob:avatar/${nombre}.mp4`),
    fotograma: () => siguienteFotograma && siguienteFotograma(),
    pasarMs: (ms) => { reloj += ms; },
    hayFotograma: () => siguienteFotograma !== null,
    documento,
    emitir: (tipo, deVentana = false) => (oyentes[deVentana ? `v:${tipo}` : tipo] || []).forEach((f) => f({})),
    oyentesVivos: () => Object.values(oyentes).reduce((a, l) => a + l.length, 0),
  };
}

/** Monta el entorno con el reposo ya sonando en un punto que no es de salida. */
async function conReposo(opciones = {}) {
  const e = entorno(opciones);
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
  assert.equal(e.clip('acierto'), undefined, 'el sustituido ya no tiene vídeo vivo');
  e.clip('triste').readyState = 2;
  e.reposo.currentTime = 2 / 60;
  e.fotograma();
  assert.equal(e.clip('triste').reproducciones, 1);
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
  const sorpresa = e.creados.find((v) => v.tagName === 'video' && v !== e.reposo);
  e.fotograma(); // descarta
  sorpresa.readyState = 2;
  e.fotograma();
  assert.equal(sorpresa.reproducciones, 0);
  assert.equal(sorpresa.src, undefined, 'y suelta su vídeo');
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

/** Reproduce el gesto `nombre` entero y deja el reposo otra vez en pantalla. */
async function jugarGesto(e, nombre) {
  e.reposo.currentTime = 2 / 60; // salida
  e.reproductor.gesto(nombre);
  await tick();
  const clip = e.clip(nombre);
  clip.readyState = 2;
  e.fotograma();
  clip.currentTime = 0.1;
  e.fotograma(); // relevo al gesto
  clip.disparar('ended');
  e.reposo.currentTime = 0.1;
  e.fotograma(); // relevo al reposo: el gesto ya no hace falta
  return clip;
}
test('reproductor: al terminar un gesto suelta su vídeo y su blob; solo vive reposo + el gesto en curso', async () => {
  const e = await conReposo();
  const saludo = await jugarGesto(e, 'saludo');
  assert.equal(saludo.src, undefined);
  assert.deepEqual(e.liberados, ['avatar/saludo.mp4']);
  await jugarGesto(e, 'acierto');
  assert.deepEqual(e.liberados, ['avatar/saludo.mp4', 'avatar/acierto.mp4']);
  assert.equal(e.reposo.src, 'blob:avatar/reposo.mp4', 'el reposo no se suelta');
});
test('reproductor: un gesto que se pide otra vez se vuelve a descargar (no queda en memoria)', async () => {
  const e = await conReposo();
  await jugarGesto(e, 'saludo');
  const antes = e.creados.length;
  e.reproductor.gesto('saludo');
  await tick();
  assert.equal(e.creados.length, antes + 1);
  assert.ok(e.clip('saludo'));
});
test('reproductor: un gesto sustituido o descartado por tiempo suelta su blob', async () => {
  const e = await conReposo();
  e.reproductor.gesto('acierto');
  e.reproductor.gesto('triste'); // sustituye a acierto antes de que llegue
  await tick();
  assert.deepEqual(e.liberados, ['avatar/acierto.mp4']);
  e.pasarMs(4500);
  e.fotograma(); // triste no estaba listo en 4 s: se descarta
  assert.deepEqual(e.liberados, ['avatar/acierto.mp4', 'avatar/triste.mp4']);
});
test('reproductor: al volver a primer plano (visibilitychange visible o pageshow) reanuda un vídeo en pausa', async () => {
  const e = await conReposo();
  e.reposo.readyState = 4;
  e.reposo.paused = true; // iOS lo pausó al bloquear la pantalla
  const antes = e.reposo.reproducciones;
  e.documento.visibilityState = 'hidden';
  e.emitir('visibilitychange');
  assert.equal(e.reposo.reproducciones, antes, 'oculta: no se toca');
  e.documento.visibilityState = 'visible';
  e.emitir('visibilitychange');
  assert.equal(e.reposo.reproducciones, antes + 1);
  e.reposo.paused = true;
  e.emitir('pageshow', true);
  assert.equal(e.reposo.reproducciones, antes + 2);
  e.reposo.paused = false;
  e.emitir('pageshow', true);
  assert.equal(e.reposo.reproducciones, antes + 2, 'si ya suena, no se repite');
});
test('reproductor: destruir quita los oyentes de visibilidad y pageshow', async () => {
  const e = await conReposo();
  assert.equal(e.oyentesVivos(), 2);
  e.reproductor.destruir();
  assert.equal(e.oyentesVivos(), 0);
});

// --- v0.3.1: puentes y residentes ---
const ANCLAS_PUENTES = { ...ANCLAS, puentes: { 14: 'puente-14.mp4', 78: 'puente-78.mp4' } };

test('puntos de salida con puente: esSalida los acepta y puenteDeSalida da el clip (null en las salidas directas)', () => {
  assert.equal(esSalida(14 / 60, 127 / 60, ANCLAS_PUENTES), true);
  assert.equal(esSalida(15 / 60, 127 / 60, ANCLAS_PUENTES), false);
  assert.equal(esSalida(14 / 60, 127 / 60, ANCLAS), false, 'sin puentes en anclas.json, como antes');
  assert.equal(puenteDeSalida(14 / 60, 127 / 60, ANCLAS_PUENTES), 'puente-14');
  assert.equal(puenteDeSalida((127 + 78) / 60, 127 / 60, ANCLAS_PUENTES), 'puente-78', 'vuelta siguiente del bucle');
  assert.equal(puenteDeSalida(2 / 60, 127 / 60, ANCLAS_PUENTES), null, 'salida directa: sin puente');
  assert.equal(puenteDeSalida(15 / 60, 127 / 60, ANCLAS_PUENTES), null);
});
test('reproductor: los puentes se precargan con el reposo', async () => {
  const e = entorno({ anclas: ANCLAS_PUENTES });
  await tick();
  assert.ok(e.clip('puente-14') && e.clip('puente-78'));
  assert.equal(e.clip('puente-14').loop, undefined, 'un puente no hace bucle');
});
test('reproductor: salida por puente -> el reposo se queda quieto, suena el puente y al acabar arranca el gesto', async () => {
  const e = await conReposo({ anclas: ANCLAS_PUENTES });
  const cambios = [];
  e.reproductor.alCambiar((n) => cambios.push(n));
  e.reproductor.gesto('sorpresa');
  await tick();
  const puente = e.clip('puente-14'); const sorpresa = e.clip('sorpresa');
  sorpresa.readyState = 2;
  e.reposo.currentTime = 14 / 60;
  e.fotograma();
  assert.equal(puente.reproducciones, 0, 'el puente no está listo: se espera a otro punto de salida');
  assert.equal(sorpresa.reproducciones, 0);
  puente.readyState = 2;
  e.fotograma();
  assert.equal(e.reposo.pausado, true, 'el reposo se queda en el fotograma de salida');
  assert.equal(puente.reproducciones, 1);
  assert.equal(sorpresa.reproducciones, 0, 'el gesto espera a que acabe el puente');
  puente.currentTime = 0.05;
  e.fotograma();
  assert.deepEqual(cambios, ['puente-14']);
  puente.disparar('ended');
  assert.equal(sorpresa.reproducciones, 1, 'puente -> gesto encadenado');
  sorpresa.currentTime = 0.05;
  e.fotograma();
  assert.deepEqual(cambios, ['puente-14', 'sorpresa']);
  assert.equal(puente.src, 'blob:avatar/puente-14.mp4', 'los puentes no se sueltan');
});
test('reproductor: el gesto encadenado no se suelta mientras suena el puente aunque se pida otro', async () => {
  const e = await conReposo({ anclas: ANCLAS_PUENTES });
  e.reproductor.gesto('sorpresa');
  await tick();
  e.clip('sorpresa').readyState = 2; e.clip('puente-14').readyState = 2;
  e.reposo.currentTime = 14 / 60;
  e.fotograma();
  e.reproductor.gesto('saludo');
  await tick();
  assert.ok(e.clip('sorpresa'), 'el gesto decidido sigue vivo');
  assert.equal(e.liberados.includes('avatar/sorpresa.mp4'), false);
});
test('reproductor: en una salida directa no hay puente (gesto directo, como antes)', async () => {
  const e = await conReposo({ anclas: ANCLAS_PUENTES });
  e.reproductor.gesto('acierto');
  await tick();
  e.clip('acierto').readyState = 2; e.clip('puente-14').readyState = 2;
  e.reposo.currentTime = 2 / 60;
  e.fotograma();
  assert.equal(e.clip('acierto').reproducciones, 1);
  assert.equal(e.clip('puente-14').reproducciones, 0);
  assert.equal(e.reposo.pausado, false);
});
test('reproductor: residentes cargados desde el arranque, no se sueltan al usarse y quedan en el primer fotograma', async () => {
  const e = await conReposo({ residentes: ['acierto', 'triste'] });
  assert.ok(e.clip('acierto') && e.clip('triste'), 'cargados sin pedirlos');
  assert.equal(e.clip('saludo'), undefined, 'solo los residentes');
  const acierto = await jugarGesto(e, 'acierto');
  assert.equal(acierto.src, 'blob:avatar/acierto.mp4', 'no se suelta tras usarse');
  assert.equal(acierto.currentTime, 0, 'listo para repetirse');
  assert.equal(e.liberados.includes('avatar/acierto.mp4'), false);
  const antes = e.creados.length;
  e.reproductor.gesto('acierto');
  await tick();
  assert.equal(e.creados.length, antes, 'pedirlo otra vez no baja nada');
  // un gesto no residente sigue soltándose
  await jugarGesto(e, 'saludo');
  assert.deepEqual(e.liberados, ['avatar/saludo.mp4']);
});
test('reproductor: mide la latencia gesto pedido -> primer fotograma del gesto (alMedir)', async () => {
  const e = await conReposo();
  e.pasarMs(1000);
  e.reproductor.gesto('euforia');
  await tick();
  const clip = e.clip('euforia');
  clip.readyState = 2;
  e.pasarMs(120);
  e.reposo.currentTime = 2 / 60;
  e.fotograma();
  e.pasarMs(30);
  clip.currentTime = 0.05;
  e.fotograma();
  assert.deepEqual(e.medidas, [[150, 'euforia']]);
});
test('crearAvatar pasa residentes y alMedir al reproductor', (t) => {
  const desinstalar = instalarDomFalso(); t.after(desinstalar);
  const recibidas = [];
  const contenedor = new ElementoFalso('div');
  const alMedir = () => {};
  crearAvatar(contenedor, {
    documento: globalThis.document, ventana: SIN_MOVIMIENTO, temporizador: temporizadorFalso(), residentes: ['acierto', 'triste'], alMedir,
    montarReproductor: (lienzo, opciones) => { recibidas.push(opciones); return { gesto() {}, destruir() {}, reanudar() {}, alFallar() {}, alCambiar() {} }; },
  });
  assert.deepEqual(recibidas[0].residentes, ['acierto', 'triste']);
  assert.equal(recibidas[0].alMedir, alMedir);
});
test('reproductor: el gesto arranca al acercarse el puente a su final y el "ended" posterior no relanza el reposo', async () => {
  const e = await conReposo({ anclas: ANCLAS_PUENTES });
  e.reproductor.gesto('sorpresa');
  await tick();
  const puente = e.clip('puente-14'); const sorpresa = e.clip('sorpresa');
  puente.readyState = 2; sorpresa.readyState = 2; puente.duration = 9 / 60;
  e.reposo.currentTime = 14 / 60;
  e.fotograma();
  puente.currentTime = 1 / 60;
  e.fotograma(); // relevo al puente
  assert.equal(sorpresa.reproducciones, 0, 'aún le quedan varios fotogramas');
  puente.currentTime = 8 / 60; // a 1 fotograma del final
  e.fotograma();
  assert.equal(sorpresa.reproducciones, 1);
  const reproduccionesReposo = e.reposo.reproducciones;
  puente.disparar('ended');
  assert.equal(sorpresa.reproducciones, 1);
  assert.equal(e.reposo.reproducciones, reproduccionesReposo, 'el reposo no arranca por encima del gesto');
});
test('reproductor: con requestVideoFrameCallback la salida se decide en el fotograma exacto que presenta el reposo', async () => {
  let aviso = null;
  const e = entorno({
    anclas: ANCLAS_PUENTES,
    ganchoVideo: (video) => { if (!aviso) video.requestVideoFrameCallback = (cb) => { aviso = cb; }; },
  });
  await tick();
  assert.equal(typeof aviso, 'function', 'el reposo se suscribe a sus fotogramas');
  const reposo = e.clip('reposo'); reposo.readyState = 2; reposo.currentTime = 1;
  e.fotograma();
  e.reproductor.gesto('triste');
  await tick();
  e.clip('triste').readyState = 2; e.clip('puente-14').readyState = 2;
  // el fotograma presentado es el 14: sale por su puente sin esperar al requestAnimationFrame
  const enganche = aviso; aviso = null;
  enganche(0, { mediaTime: 14 / 60 });
  assert.equal(e.clip('puente-14').reproducciones, 1);
  assert.equal(reposo.pausado, true);
  assert.equal(typeof aviso, 'function', 'sigue suscrito al siguiente fotograma');
});
