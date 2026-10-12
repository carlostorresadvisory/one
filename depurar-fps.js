// ONE · depurar-fps.js — medidor de fluidez en el iPhone (?depurar=fps). No se precachea.
// Cuenta los fotogramas reales (requestAnimationFrame) y cronometra cada subida de un vídeo de la esfinge a WebGL
// (`texImage2D`, lenta en Safari iOS: WebKit bug 216250). Con `&subida=media` sube el vídeo a mitad de tamaño
// (pasándolo antes por un lienzo 2D) para comparar en el mismo teléfono. No cambia nada sin el parámetro.
export function montarPanelFps(documento = document, ventana = window) {
  const params = new URLSearchParams(ventana.location.search);
  const mitad = params.get('subida') === 'media';
  const m = { fotogramas: 0, peor: 0, subidas: 0, msSubida: 0, maxSubida: 0, video: '' };
  const historico = []; // fps de cada segundo, para ver el bache de un gesto después de que pase

  const original = ventana.WebGLRenderingContext.prototype.texImage2D;
  const aux = documento.createElement('canvas');
  const auxCtx = aux.getContext('2d');
  ventana.WebGLRenderingContext.prototype.texImage2D = function (...args) {
    const fuente = args[5];
    if (!(fuente instanceof ventana.HTMLVideoElement)) return original.apply(this, args);
    const inicio = ventana.performance.now();
    let resultado;
    if (mitad && fuente.videoWidth) {
      aux.width = fuente.videoWidth / 2; aux.height = fuente.videoHeight / 2;
      auxCtx.drawImage(fuente, 0, 0, aux.width, aux.height);
      resultado = original.call(this, args[0], args[1], args[2], args[3], args[4], aux);
    } else resultado = original.apply(this, args);
    const ms = ventana.performance.now() - inicio;
    m.subidas += 1; m.msSubida += ms; m.maxSubida = Math.max(m.maxSubida, ms);
    m.video = `${fuente.videoWidth}×${fuente.videoHeight}${mitad ? ' → mitad' : ''}`;
    return resultado;
  };

  const panel = documento.createElement('pre');
  panel.style.cssText = 'position:fixed;left:0;right:0;top:0;margin:0;padding:4px 8px;font:11px/1.3 monospace;background:#000c;color:#4cc9f0;z-index:9999;pointer-events:none;white-space:pre-wrap';
  documento.body.append(panel);

  let anterior = ventana.performance.now();
  const contar = (ahora) => {
    m.peor = Math.max(m.peor, ahora - anterior);
    anterior = ahora;
    m.fotogramas += 1;
    ventana.requestAnimationFrame(contar);
  };
  ventana.requestAnimationFrame(contar);

  ventana.setInterval(() => {
    historico.push(m.fotogramas);
    if (historico.length > 10) historico.shift();
    const media = m.subidas ? (m.msSubida / m.subidas).toFixed(1) : '–';
    panel.textContent = `fps ${m.fotogramas} · peor ${Math.round(m.peor)} ms · mín 10 s ${Math.min(...historico)}\n`
      + `vídeo ${m.video || '–'} · subidas/s ${m.subidas} · ${media} ms media · ${m.maxSubida.toFixed(1)} ms máx · dpr ${ventana.devicePixelRatio}`;
    Object.assign(m, { fotogramas: 0, peor: 0, subidas: 0, msSubida: 0, maxSubida: 0 });
  }, 1000);
}
