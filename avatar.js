// ONE · avatar.js — la esfinge v2 (spec §7). Clips MP4 «stacked alpha» (color arriba, alfa abajo)
// pintados en un <canvas> con WebGL (respaldo 2D): un reposo en bucle y 6 gestos que esperan a un
// punto de salida del reposo (avatar/anclas.json) y vuelven solos a él. Si el vídeo no arranca,
// imagen fija de la expresión más cercana (nunca un hueco). Sin `document` global.

export const GESTOS = ['saludo', 'pensando', 'sorpresa', 'triste', 'acierto', 'euforia'];
export const MS_PENSANDO = 8000;
export const MS_REACCION = 1400;
const MS_DESCARTE = 4000; // un gesto cuyo clip no está listo pasado este tiempo se descarta
const ANCLAS_POR_DEFECTO = { fps: 60, salidas: [0] };

const EVENTOS = {
  abrir: 'saludo', acierto: 'acierto', fallo: 'triste', quiebra: 'triste', dorada: 'sorpresa',
  clavado: 'euforia', record: 'euforia', nuevoMaximo: 'euforia', cofre: 'euforia', inactivo: 'pensando',
};
const FIJAS = { saludo: 'neutral', pensando: 'neutral', sorpresa: 'neutral', acierto: 'contenta', euforia: 'euforica', triste: 'triste' };

const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}';
const FS = 'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){'
  + 'vec3 c=texture2D(t,vec2(uv.x,uv.y*.5)).rgb;float a=texture2D(t,vec2(uv.x,.5+uv.y*.5)).r;'
  + 'gl_FragColor=vec4(c*a,a);}';

export const rutaClip = (nombre) => `avatar/${nombre}.mp4`;
export const rutaFija = (gesto) => `avatar/${FIJAS[gesto] || 'neutral'}.webp`;
export const gestoParaEvento = (evento) => EVENTOS[evento] || null;

/** ¿El fotograma actual del reposo (en bucle, a `anclas.fps`) es un punto de salida? */
export function esSalida(tiempo, duracion, anclas) {
  const fps = anclas.fps || 60;
  const fotograma = Math.round(tiempo * fps);
  const total = Math.round(duracion * fps) || 1;
  return anclas.salidas.includes(((fotograma % total) + total) % total);
}

/** Avisa una sola vez si pasan MS_PENSANDO sin `reiniciar()`. */
export function crearVigiaPensando({ temporizador = globalThis, alPensar }) {
  let id = null;
  const parar = () => { temporizador.clearTimeout(id); id = null; };
  return {
    reiniciar() {
      parar();
      id = temporizador.setTimeout(() => { id = null; alPensar(); }, MS_PENSANDO);
    },
    parar,
  };
}

function descargarClip(ventana) {
  return async (ruta) => {
    const respuesta = await ventana.fetch(ruta);
    if (!respuesta.ok) throw new Error(`clip ${ruta}: ${respuesta.status}`);
    const url = ventana.URL.createObjectURL(await respuesta.blob());
    return { src: url, liberar: () => ventana.URL.revokeObjectURL(url) };
  };
}

function prepararPintado(lienzo) {
  const gl = lienzo.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (gl) {
    const sombreador = (tipo, fuente) => { const s = gl.createShader(tipo); gl.shaderSource(s, fuente); gl.compileShader(s); return s; };
    const programa = gl.createProgram();
    gl.attachShader(programa, sombreador(gl.VERTEX_SHADER, VS));
    gl.attachShader(programa, sombreador(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(programa);
    gl.useProgram(programa);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posicion = gl.getAttribLocation(programa, 'p');
    gl.enableVertexAttribArray(posicion);
    gl.vertexAttribPointer(posicion, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return (video) => {
      gl.viewport(0, 0, lienzo.width, lienzo.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }
  return null;
}

function prepararPintado2d(lienzo, documento) {
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const aux = documento.createElement('canvas');
  const auxCtx = aux.getContext('2d', { willReadFrequently: true });
  const color = documento.createElement('canvas');
  return (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight / 2;
    aux.width = w; aux.height = h * 2; color.width = w; color.height = h;
    auxCtx.drawImage(video, 0, 0);
    const imagen = auxCtx.getImageData(0, 0, w, h);
    const alfa = auxCtx.getImageData(0, h, w, h).data;
    for (let i = 3; i < imagen.data.length; i += 4) imagen.data[i] = alfa[i - 3];
    color.getContext('2d').putImageData(imagen, 0, 0);
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(color, 0, 0, lienzo.width, lienzo.height);
  };
}

/**
 * Reproductor MP4 sobre un <canvas>. Lanza si no hay ni WebGL ni 2D.
 * `cargarClip(ruta)` → `{ src, liberar }` (por defecto fetch → Blob → URL de objeto: iOS pide los
 * vídeos con `Range` y un service worker que cachea respuestas 200 completas no sabe contestar 206).
 */
export function montarReproductorMp4(lienzo, { documento, ventana, base = 'avatar/', anclas = null, cargarClip = descargarClip(ventana) }) {
  const pintar = prepararPintado(lienzo) || prepararPintado2d(lienzo, documento);
  if (!pintar) throw new Error('sin WebGL ni canvas 2D');
  let marcas = anclas || ANCLAS_POR_DEFECTO;
  const ahora = () => (ventana.performance ? ventana.performance.now() : Date.now());
  const clips = {};
  let actual = null;
  let entrante = null;
  let pendiente = null;
  let pendienteDesde = 0;
  let raf = 0;
  let vivo = true;
  let alFallar = () => {};
  let alCambiar = () => {};
  let medida = '';

  if (!anclas) {
    ventana.fetch(`${base}anclas.json`).then((r) => r.json()).then((j) => { marcas = j; }).catch(() => {});
  }

  function fallar() { if (vivo) alFallar(); }

  function cargar(nombre) {
    if (clips[nombre]) return;
    const video = documento.createElement('video');
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.preload = 'auto';
    video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    if (nombre === 'reposo') video.loop = true;
    else video.addEventListener('ended', () => { if (actual === video) arrancar(clips.reposo.video); });
    const clip = { video, liberar: null };
    clips[nombre] = clip;
    cargarClip(`${base}${nombre}.mp4`).then(({ src, liberar }) => {
      if (!vivo) { liberar(); return; }
      clip.liberar = liberar;
      video.src = src;
      video.load();
      if (nombre === 'reposo') arrancar(video);
    }).catch(() => {
      delete clips[nombre];
      if (nombre === 'reposo') fallar();
      else if (pendiente === nombre) pendiente = null;
    });
  }

  function arrancar(video) {
    entrante = video;
    video.currentTime = 0;
    const promesa = video.play();
    if (promesa && promesa.catch) promesa.catch(fallar);
  }

  function nombreDe(video) { return Object.keys(clips).find((n) => clips[n].video === video); }

  // El lienzo sigue pintando el clip saliente (que está en el ancla) hasta que el entrante tiene su primer fotograma.
  function relevo() {
    if (!entrante || entrante.readyState < 2 || entrante.currentTime <= 0) return;
    if (actual && actual !== entrante) actual.pause();
    actual = entrante;
    entrante = null;
    alCambiar(nombreDe(actual));
  }

  function medir() {
    const caja = lienzo.parentNode && lienzo.parentNode.getBoundingClientRect ? lienzo.parentNode.getBoundingClientRect() : null;
    const lado = caja ? Math.round(Math.min(caja.width, caja.height)) || 160 : 160;
    const clave = `${lado}`;
    if (clave === medida) return;
    medida = clave;
    lienzo.style.setProperty('width', `${lado}px`, 'important');
    lienzo.style.setProperty('height', `${lado}px`, 'important');
    lienzo.width = lienzo.height = Math.min(Math.round(lado * Math.min(ventana.devicePixelRatio || 1, 3)), 480);
  }

  function paso() {
    if (!vivo) return;
    medir();
    relevo();
    if (pendiente) {
      const clip = clips[pendiente];
      if (ahora() - pendienteDesde > MS_DESCARTE && !(clip && clip.video.readyState >= 2)) pendiente = null;
      else if (clip && clip.video.readyState >= 2 && !entrante && actual === (clips.reposo && clips.reposo.video)
        && esSalida(actual.currentTime, actual.duration, marcas)) {
        arrancar(clip.video);
        pendiente = null;
      }
    }
    if (actual && actual.readyState >= 2) pintar(actual);
    raf = ventana.requestAnimationFrame(paso);
  }

  lienzo.addEventListener('webglcontextlost', (evento) => { evento.preventDefault(); fallar(); });
  cargar('reposo');
  actual = clips.reposo.video;
  raf = ventana.requestAnimationFrame(paso);

  return {
    gesto(nombre) {
      if (!vivo || !GESTOS.includes(nombre)) return;
      cargar(nombre);
      pendiente = nombre;
      pendienteDesde = ahora();
    },
    alFallar(cb) { alFallar = cb; },
    alCambiar(cb) { alCambiar = cb; },
    destruir() {
      vivo = false;
      ventana.cancelAnimationFrame(raf);
      Object.values(clips).forEach(({ video, liberar }) => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (liberar) liberar();
      });
    },
  };
}

/**
 * Esfinge animada dentro de `contenedor`. `modo()` es 'video' o 'fijo'. Con reducir movimiento, o si el
 * vídeo falla, se muestra la imagen fija; en el siguiente toque del documento se reintenta el vídeo.
 */
export function crearAvatar(contenedor, {
  tamano = 'cabecera',
  documento = contenedor.ownerDocument,
  ventana = documento.defaultView,
  montarReproductor = montarReproductorMp4,
  temporizador = globalThis,
} = {}) {
  contenedor.setAttribute('aria-hidden', 'true');
  contenedor.classList.add('avatar', `avatar--${tamano}`);
  const sinMovimiento = Boolean(ventana.matchMedia && ventana.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let modo = 'fijo';
  let reproductor = null;
  let imagen = null;
  let idVuelta = null;
  let destruido = false;

  function mostrarFijo(gesto = 'neutral') {
    if (!imagen) {
      imagen = documento.createElement('img');
      imagen.classList.add('avatar-fijo');
      imagen.setAttribute('alt', '');
      imagen.setAttribute('aria-hidden', 'true');
      contenedor.replaceChildren(imagen);
    }
    imagen.src = rutaFija(gesto);
    temporizador.clearTimeout(idVuelta);
    idVuelta = gesto === 'neutral' ? null : temporizador.setTimeout(() => { idVuelta = null; mostrarFijo('neutral'); }, MS_REACCION);
  }

  function soltarReproductor() {
    if (reproductor) reproductor.destruir();
    reproductor = null;
  }

  function pasarAFijo(gesto) {
    modo = 'fijo';
    soltarReproductor();
    imagen = null;
    mostrarFijo(gesto);
    if (!sinMovimiento) documento.addEventListener('pointerdown', reintentar);
  }

  function reintentar() {
    documento.removeEventListener('pointerdown', reintentar);
    if (!destruido) montarVideo();
  }

  function montarVideo() {
    const lienzo = documento.createElement('canvas');
    lienzo.classList.add('avatar-lienzo');
    try {
      reproductor = montarReproductor(lienzo, { documento, ventana });
    } catch {
      pasarAFijo('neutral');
      return;
    }
    reproductor.alFallar(() => pasarAFijo(ultimoGesto));
    imagen = null;
    contenedor.replaceChildren(lienzo);
    modo = 'video';
  }

  let ultimoGesto = 'neutral';
  if (sinMovimiento) mostrarFijo('neutral');
  else montarVideo();

  return {
    modo: () => modo,
    gesto(nombre) {
      if (destruido || !GESTOS.includes(nombre)) return;
      ultimoGesto = nombre;
      if (modo === 'video') reproductor.gesto(nombre);
      else mostrarFijo(nombre);
    },
    destruir() {
      if (destruido) return;
      destruido = true;
      temporizador.clearTimeout(idVuelta);
      documento.removeEventListener('pointerdown', reintentar);
      soltarReproductor();
      contenedor.replaceChildren();
    },
  };
}
