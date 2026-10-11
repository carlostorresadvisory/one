// ONE · avatar.js — la esfinge v2 (spec §7). Clips MP4 «stacked alpha» (color arriba, alfa abajo)
// pintados en un <canvas> con WebGL (respaldo 2D): un reposo en bucle y 6 gestos que esperan a un
// punto de salida del reposo (avatar/anclas.json) y vuelven solos a él. Los puntos de salida directos
// (`salidas`) enlazan con el gesto; los demás tienen un clip puente (`puentes`: movimiento inventado por RIFE
// del fotograma del reposo al ancla) y se encadena puente -> gesto. Acierto y triste pueden quedar residentes
// (cargados y decodificados mientras viva el reproductor). Si el vídeo no arranca, imagen fija de la
// expresión más cercana (nunca un hueco). Sin `document` global.

export const GESTOS = ['saludo', 'pensando', 'sorpresa', 'triste', 'acierto', 'euforia'];
export const MS_PENSANDO = 8000;
export const MS_REACCION = 1400;
const MS_DESCARTE = 4000; // un gesto cuyo clip no está listo pasado este tiempo se descarta
const ANCLAS_POR_DEFECTO = { fps: 60, salidas: [0], puentes: {} };
const esPuente = (nombre) => nombre.startsWith('puente-');

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

function fotogramaDe(tiempo, duracion, anclas) {
  const fps = anclas.fps || 60;
  const total = Math.round(duracion * fps) || 1;
  return ((Math.round(tiempo * fps) % total) + total) % total;
}

/** ¿El fotograma actual del reposo (en bucle, a `anclas.fps`) es un punto de salida (directo o con puente)? */
export function esSalida(tiempo, duracion, anclas) {
  const f = fotogramaDe(tiempo, duracion, anclas);
  return anclas.salidas.includes(f) || Boolean((anclas.puentes || {})[f]);
}

/** Nombre del clip puente (sin `.mp4`) si el fotograma actual es un punto de salida con puente; si la
 * salida es directa o no hay salida, null. */
export function puenteDeSalida(tiempo, duracion, anclas) {
  const f = fotogramaDe(tiempo, duracion, anclas);
  if (anclas.salidas.includes(f)) return null;
  const fichero = (anclas.puentes || {})[f];
  return fichero ? fichero.replace(/\.mp4$/, '') : null;
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
    const pintar = (video) => {
      gl.viewport(0, 0, lienzo.width, lienzo.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // Chrome limita los contextos WebGL vivos (~16): un lienzo descartado no basta, hay que soltarlo.
    pintar.liberar = () => { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); };
    return pintar;
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
export function montarReproductorMp4(lienzo, {
  documento, ventana, base = 'avatar/', anclas = null, cargarClip = descargarClip(ventana), residentes = [], alMedir = null,
}) {
  const pintar = prepararPintado(lienzo) || prepararPintado2d(lienzo, documento);
  if (!pintar) throw new Error('sin WebGL ni canvas 2D');
  let marcas = anclas || ANCLAS_POR_DEFECTO;
  const ahora = () => (ventana.performance ? ventana.performance.now() : Date.now());
  const clips = {};
  let actual = null;
  let entrante = null;
  let pendiente = null;
  let pendienteDesde = 0;
  let cadena = null; // gesto ya decidido que arranca al acabar el puente en curso
  let pedidoEn = 0;
  let pedido = null; // gesto cuya latencia (petición -> primer fotograma pintado) se mide
  let raf = 0;
  let vivo = true;
  let alFallar = () => {};
  let alCambiar = () => {};
  let medida = '';

  const precargarPuentes = () => Object.values(marcas.puentes || {}).forEach((f) => cargar(f.replace(/\.mp4$/, '')));
  if (!anclas) {
    ventana.fetch(`${base}anclas.json`).then((r) => r.json()).then((j) => { marcas = j; if (vivo) precargarPuentes(); }).catch(() => {});
  }

  function fallar(razon) { if (vivo) alFallar(razon); }

  function cargar(nombre) {
    if (clips[nombre]) return;
    const video = documento.createElement('video');
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.preload = 'auto';
    video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    if (nombre === 'reposo') { video.loop = true; vigilarFotogramas(video); }
    else {
      video.addEventListener('ended', () => {
        if (actual !== video && entrante !== video) return;
        if (esPuente(nombre) && !cadena) return; // ya encadenado al acercarse al final
        const siguiente = esPuente(nombre) && clips[cadena];
        cadena = null;
        arrancar(siguiente ? siguiente.video : clips.reposo.video);
      });
    }
    const clip = { video, liberar: null };
    clips[nombre] = clip;
    cargarClip(`${base}${nombre}.mp4`).then(({ src, liberar }) => {
      // Soltado mientras bajaba (gesto sustituido, descartado o reproductor destruido): sin vídeo vivo.
      if (!vivo || clips[nombre] !== clip) { liberar(); return; }
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

  // Viven a la vez: el reposo, los puentes, los residentes y el gesto en curso. Un gesto que ya sonó (o que
  // se descartó, o que otro sustituyó) suelta su <video> y su blob; si se vuelve a pedir, se baja de nuevo
  // (sale de la caché del service worker).
  function soltarClip(nombre) {
    const clip = clips[nombre];
    if (!clip || nombre === 'reposo' || esPuente(nombre) || residentes.includes(nombre) || nombre === cadena
      || clip.video === actual || clip.video === entrante) return;
    delete clips[nombre];
    clip.video.pause();
    clip.video.removeAttribute('src');
    clip.video.load();
    if (clip.liberar) clip.liberar();
  }

  function soltarGestosInactivos() {
    Object.keys(clips).forEach((n) => { if (n !== pendiente) soltarClip(n); });
  }

  function arrancar(video) {
    entrante = video;
    video.currentTime = 0;
    const promesa = video.play();
    if (promesa && promesa.catch) promesa.catch(() => fallar('play'));
  }

  function nombreDe(video) { return Object.keys(clips).find((n) => clips[n].video === video); }

  // El lienzo sigue pintando el clip saliente (que está en el ancla) hasta que el entrante tiene su primer fotograma.
  function relevo() {
    if (!entrante || entrante.readyState < 2 || entrante.currentTime <= 0) return;
    const anterior = actual;
    if (anterior && anterior !== entrante) {
      anterior.pause();
      // Un residente que acaba deja su primer fotograma ya decodificado para la próxima vez.
      if (residentes.includes(nombreDe(anterior))) anterior.currentTime = 0;
    }
    actual = entrante;
    entrante = null;
    const nombre = nombreDe(actual);
    alCambiar(nombre);
    if (pedido && nombre === pedido) {
      if (alMedir) alMedir(Math.round(ahora() - pedidoEn), nombre);
      pedido = null;
    }
    soltarGestosInactivos();
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

  /** Si el gesto pendiente está listo y el reposo está en un punto de salida, sale: directo, o por puente. */
  function intentarSalida(tiempo) {
    const clip = pendiente && clips[pendiente];
    if (!clip || clip.video.readyState < 2 || entrante || !actual || actual !== (clips.reposo && clips.reposo.video)) return;
    const nombrePuente = puenteDeSalida(tiempo, actual.duration, marcas);
    const puenteListo = nombrePuente && clips[nombrePuente] && clips[nombrePuente].video.readyState >= 2;
    if (puenteListo) {
      // El reposo se queda quieto en el fotograma de salida mientras arranca el puente: sin deriva.
      actual.pause();
      cadena = pendiente;
      pendiente = null;
      arrancar(clips[nombrePuente].video);
    } else if (!nombrePuente && esSalida(tiempo, actual.duration, marcas)) {
      arrancar(clip.video);
      pendiente = null;
    }
  }

  // Donde existe (Chrome, Safari 15.4+), el reposo avisa en cada fotograma que presenta: la salida no espera
  // al siguiente requestAnimationFrame ni se salta un punto de salida si el navegador se retrasa.
  function vigilarFotogramas(video) {
    if (!video.requestVideoFrameCallback) return;
    const aviso = (_, meta) => {
      if (!vivo) return;
      if (actual === video && pendiente && meta && typeof meta.mediaTime === 'number') intentarSalida(meta.mediaTime);
      video.requestVideoFrameCallback(aviso);
    };
    video.requestVideoFrameCallback(aviso);
  }

  function paso() {
    if (!vivo) return;
    medir();
    relevo();
    if (pendiente) {
      const clip = clips[pendiente];
      if (ahora() - pendienteDesde > MS_DESCARTE && !(clip && clip.video.readyState >= 2)) {
        const descartado = pendiente;
        pendiente = null;
        soltarClip(descartado);
      }
      else intentarSalida(actual && actual.currentTime);
    }
    // Puente casi terminado: el gesto arranca ya (su arranque tarda un par de fotogramas) y el lienzo sigue
    // con el último fotograma del puente hasta que el gesto tiene el suyo.
    if (cadena && actual && !entrante && esPuente(nombreDe(actual) || '') && actual.duration - actual.currentTime <= 2.5 / (marcas.fps || 60)) {
      const siguiente = clips[cadena];
      cadena = null;
      arrancar(siguiente ? siguiente.video : clips.reposo.video);
    }
    if (actual && actual.readyState >= 2) pintar(actual);
    raf = ventana.requestAnimationFrame(paso);
  }

  function contextoPerdido(evento) { evento.preventDefault(); fallar('gl'); }
  lienzo.addEventListener('webglcontextlost', contextoPerdido);

  // iOS pausa los <video> al bloquear la pantalla o cambiar de app y no los reanuda al volver: sin
  // esto la esfinge se quedaría congelada. Solo toca un vídeo que esté en pausa sin haber terminado.
  function alVolver() {
    if (!vivo || (documento.visibilityState && documento.visibilityState !== 'visible')) return;
    const video = entrante || actual;
    if (video && video.paused && !video.ended && video.readyState >= 2) {
      const promesa = video.play();
      if (promesa && promesa.catch) promesa.catch(() => {});
    }
  }
  documento.addEventListener?.('visibilitychange', alVolver);
  ventana.addEventListener?.('pageshow', alVolver);
  cargar('reposo');
  residentes.forEach(cargar);
  if (anclas) precargarPuentes();
  actual = clips.reposo.video;
  raf = ventana.requestAnimationFrame(paso);

  return {
    gesto(nombre) {
      if (!vivo || !GESTOS.includes(nombre)) return;
      const anterior = pendiente;
      cargar(nombre);
      pendiente = nombre;
      pendienteDesde = ahora();
      pedido = nombre;
      pedidoEn = pendienteDesde;
      if (anterior && anterior !== nombre) soltarClip(anterior);
    },
    // Tras un rechazo de play() (autoplay bloqueado): mismo vídeo y mismo lienzo, solo se pide play() otra vez.
    reanudar() { if (vivo && clips.reposo) arrancar(clips.reposo.video); },
    alFallar(cb) { alFallar = cb; },
    alCambiar(cb) { alCambiar = cb; },
    destruir() {
      vivo = false;
      ventana.cancelAnimationFrame(raf);
      lienzo.removeEventListener('webglcontextlost', contextoPerdido);
      documento.removeEventListener?.('visibilitychange', alVolver);
      ventana.removeEventListener?.('pageshow', alVolver);
      if (pintar.liberar) pintar.liberar();
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
  residentes = [],
  alMedir = null,
} = {}) {
  contenedor.setAttribute('aria-hidden', 'true');
  contenedor.classList.add('avatar', `avatar--${tamano}`);
  const sinMovimiento = Boolean(ventana.matchMedia && ventana.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let modo = 'fijo';
  let reproductor = null;
  let lienzo = null;
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

  // Con autoplay bloqueado (`conservar`) el reproductor sigue vivo: el siguiente gesto solo repite play().
  function pasarAFijo(gesto, conservar = false) {
    modo = 'fijo';
    if (!conservar) soltarReproductor();
    imagen = null;
    mostrarFijo(gesto);
    if (!sinMovimiento) documento.addEventListener('pointerdown', reintentar);
  }

  function reintentar() {
    documento.removeEventListener('pointerdown', reintentar);
    if (destruido) return;
    if (!reproductor) { montarVideo(); return; }
    temporizador.clearTimeout(idVuelta);
    idVuelta = null;
    imagen = null;
    contenedor.replaceChildren(lienzo);
    modo = 'video';
    reproductor.reanudar();
  }

  function montarVideo() {
    lienzo = documento.createElement('canvas');
    lienzo.classList.add('avatar-lienzo');
    try {
      reproductor = montarReproductor(lienzo, { documento, ventana, residentes, alMedir });
    } catch {
      pasarAFijo('neutral');
      return;
    }
    reproductor.alFallar((razon) => pasarAFijo(ultimoGesto, razon === 'play'));
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
