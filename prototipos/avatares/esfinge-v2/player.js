// Esfinge v2: MP4 «stacked alpha» (color arriba, alfa abajo) pintado en <canvas> con WebGL.
// Todos los clips empiezan en el mismo fotograma ancla N; el reposo acaba justo antes de N.
// Un gesto pedido espera a un punto de salida del reposo (fotograma casi idéntico a N) y vuelve solo al reposo.
var GESTOS = ['saludo', 'pensando', 'sorpresa', 'triste', 'acierto', 'euforia'];
var CLIPS = ['reposo'].concat(GESTOS);

var VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}';
var FS = 'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){' +
  'vec3 c=texture2D(t,vec2(uv.x,uv.y*.5)).rgb;float a=texture2D(t,vec2(uv.x,.5+uv.y*.5)).r;' +
  'gl_FragColor=vec4(c*a,a);}';

function vid(src) {
  var v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.crossOrigin = 'anonymous'; v.src = src; v.load();
  return v;
}

export function montarEsfinge(el, base, anclas) {
  var fps = (anclas && anclas.fps) || 60, salidas = (anclas && anclas.salidas) || [0];
  var cv = document.createElement('canvas');
  var dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.style.display = 'block';
  el.appendChild(cv);
  var vids = {};
  CLIPS.forEach(function (n) { vids[n] = vid(base + n + '.mp4?v=2'); });
  vids.reposo.loop = true;
  var actual = vids.reposo, entrante = null, pendiente = null, raf = 0, vivo = true, alCambiar = null;

  var gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  var draw;
  if (gl) {
    var sh = function (tipo, src) { var s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    draw = function (v) {
      gl.viewport(0, 0, cv.width, cv.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  } else {
    // Respaldo sin WebGL: combina color y alfa con getImageData.
    var ctx = cv.getContext('2d', { willReadFrequently: true }), tmp = document.createElement('canvas'), tc = tmp.getContext('2d', { willReadFrequently: true });
    draw = function (v) {
      var w = v.videoWidth, h = v.videoHeight / 2; tmp.width = w; tmp.height = h * 2; tc.drawImage(v, 0, 0);
      var c = tc.getImageData(0, 0, w, h), a = tc.getImageData(0, h, w, h).data;
      for (var i = 3; i < c.data.length; i += 4) c.data[i] = a[i - 3];
      var o = document.createElement('canvas'); o.width = w; o.height = h; o.getContext('2d').putImageData(c, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(o, 0, 0, cv.width, cv.height);
    };
  }

  function tam() {
    var r = el.getBoundingClientRect(), lado = Math.min(r.width, r.height) || 160;
    cv.style.setProperty('width', lado + 'px', 'important'); cv.style.setProperty('height', lado + 'px', 'important');
    cv.width = cv.height = Math.min(Math.round(lado * dpr), 480);
  }
  tam();

  function nombre(v) { for (var n in vids) if (vids[n] === v) return n; }
  // Arranca v desde N; el lienzo sigue pintando el clip saliente (que está en N) hasta que v tenga su primer fotograma.
  function arrancar(v) {
    entrante = v; v.currentTime = 0;
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  }
  function relevo() {
    if (!entrante || entrante.readyState < 2 || entrante.currentTime <= 0) return;
    if (actual !== entrante) actual.pause();
    actual = entrante; entrante = null;
    if (alCambiar) alCambiar(nombre(actual));
  }
  function enSalida(v) {
    var f = Math.round(v.currentTime * fps), n = Math.round(v.duration * fps) || 1;
    return salidas.indexOf(((f % n) + n) % n) >= 0;
  }
  function bucle() {
    if (!vivo) return;
    relevo();
    if (pendiente && !entrante && actual === vids.reposo && enSalida(actual)) { arrancar(vids[pendiente]); pendiente = null; }
    if (actual.readyState >= 2) draw(actual);
    raf = requestAnimationFrame(bucle);
  }
  GESTOS.forEach(function (n) { vids[n].addEventListener('ended', function () { if (actual === vids[n]) arrancar(vids.reposo); }); });
  arrancar(vids.reposo); bucle();
  // iOS en modo ahorro puede bloquear autoplay: se reintenta en el primer toque.
  var desbloq = function () { [actual, entrante].forEach(function (v) { if (v && v.paused) v.play().catch(function () {}); }); };
  document.addEventListener('pointerdown', desbloq, { once: true });

  return {
    gesto: function (g) { if (GESTOS.indexOf(g) >= 0) pendiente = g; },
    alCambiar: function (f) { alCambiar = f; },
    destruir: function () { vivo = false; cancelAnimationFrame(raf); CLIPS.forEach(function (n) { vids[n].pause(); vids[n].removeAttribute('src'); vids[n].load(); }); cv.remove(); }
  };
}
