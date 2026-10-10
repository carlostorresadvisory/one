// ONE · depurar-sonido.js — panel de diagnóstico del audio en iOS (?depurar=sonido). No se precachea.
export function montarPanelSonido(sonido, documento = document) {
  const panel = documento.createElement('pre');
  panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:40vh;overflow:auto;margin:0;padding:8px;font:11px monospace;background:#000c;color:#4cc9f0;z-index:9999;white-space:pre-wrap';
  const boton = documento.createElement('button');
  boton.textContent = 'Probar ding';
  boton.style.cssText = 'position:fixed;right:8px;bottom:42vh;z-index:9999';
  boton.addEventListener('click', () => { sonido.desbloquear('click-panel'); sonido.reproducir('ding'); });
  const pintar = () => {
    const d = sonido.diagnostico();
    panel.textContent = JSON.stringify({ ...d, ua: navigator.userAgent, standalone: navigator.standalone === true }, null, 1);
  };
  documento.body.append(panel, boton);
  setInterval(pintar, 500);
  pintar();
}
