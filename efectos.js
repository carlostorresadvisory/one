// ONE · efectos.js — efectos visuales comunes de v0.3 (spec §7). Regla de oro: TODO superpuesto
// (clases que animan `transform`/`opacity`/`box-shadow`, o capas `position: fixed` con
// pointer-events:none) -- ningún efecto cambia el tamaño de nada ni provoca scroll. Con
// prefers-reduced-motion las animaciones se anulan en estilos.css (bloque "v0.3 efectos") y aquí
// no se lanza confeti ni se anima el contador. canvas-confetti (vendor/, ISC) se carga perezoso.

export const COLORES_CONFETI = ['#4cc9f0', '#f2c14e', '#e8edf2', '#3ddc84'];
export const MS_EFECTO = 650;

const temporizadorReal = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function prefiereMenosMovimiento(ventana = globalThis.window) {
  try {
    return Boolean(ventana && ventana.matchMedia && ventana.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

const temporizadoresActivos = new WeakMap(); // nodo -> Map(clase -> {id, temporizador})

/** Pone `clase` (reiniciando su animación si ya estaba) y la quita a los `ms`. */
export function pulsarClase(nodo, clase, { ms = MS_EFECTO, temporizador = temporizadorReal } = {}) {
  if (!nodo) return null;
  const previos = temporizadoresActivos.get(nodo) || new Map();
  if (previos.has(clase)) {
    // El timeout anterior no debe quitar la clase de la pulsación nueva.
    (previos.get(clase).temporizador || temporizador).clearTimeout(previos.get(clase).id);
    previos.delete(clase);
  }
  nodo.classList.remove(clase);
  void nodo.offsetWidth; // fuerza reflow: la misma animación dos veces seguidas vuelve a correr
  nodo.classList.add(clase);
  const id = temporizador.setTimeout(() => {
    nodo.classList.remove(clase);
    previos.delete(clase);
  }, ms);
  previos.set(clase, { id, temporizador });
  temporizadoresActivos.set(nodo, previos);
  return id;
}

export function efectoAcierto(nodo, opciones) {
  return pulsarClase(nodo, 'efecto-acierto', opciones);
}

export function efectoFallo(nodo, opciones) {
  return pulsarClase(nodo, 'efecto-fallo', opciones);
}

/** Destello verde ('ok') o rojo ('ko') sobre toda la pantalla: capa fija `[data-test="destello"]`. */
export function destelloPantalla(tipo, { documento = globalThis.document, ...opciones } = {}) {
  const capa = documento && documento.querySelector ? documento.querySelector('[data-test="destello"]') : null;
  if (!capa) return null;
  capa.dataset.tipo = tipo === 'ko' ? 'ko' : 'ok';
  return pulsarClase(capa, 'destello--activo', opciones);
}

export function suavizar(t) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function valorIntermedio(desde, hasta, t) {
  return Math.round(desde + (hasta - desde) * suavizar(t));
}

/** Cuenta de `desde` a `hasta` en `duracionMs` (subida o bajada). Con reducir movimiento, directo. */
export function contarCifra(nodo, { desde = 0, hasta, duracionMs = 600, formato = String, ventana = globalThis.window } = {}) {
  return new Promise((resolver) => {
    if (!nodo) {
      resolver();
      return;
    }
    const sinAnimar =
      prefiereMenosMovimiento(ventana) || duracionMs <= 0 || desde === hasta || !ventana || !ventana.requestAnimationFrame;
    if (sinAnimar) {
      nodo.textContent = formato(hasta);
      resolver();
      return;
    }
    const inicio = ventana.performance.now();
    const paso = (ahora) => {
      const t = (ahora - inicio) / duracionMs;
      nodo.textContent = formato(t >= 1 ? hasta : valorIntermedio(desde, hasta, t));
      if (t < 1) ventana.requestAnimationFrame(paso);
      else resolver();
    };
    ventana.requestAnimationFrame(paso);
  });
}

export function estadoBarraTiempo(restanteMs, totalMs) {
  const fraccion = totalMs > 0 ? Math.min(1, Math.max(0, restanteMs / totalMs)) : 0;
  return { fraccion, critico: restanteMs > 0 && restanteMs <= 3000, agotado: restanteMs <= 0 };
}

/** Barra de tiempo cian→rojo (el color lo mezcla el CSS con --fraccion) que late en los 3 últimos s. */
export function pintarBarraTiempo(nodo, restanteMs, totalMs) {
  const estado = estadoBarraTiempo(restanteMs, totalMs);
  nodo.style.transform = `scaleX(${estado.fraccion})`;
  nodo.style.setProperty('--fraccion', String(estado.fraccion));
  nodo.classList.toggle('barra-tiempo--critica', estado.critico);
  return estado;
}

/** 0 por debajo de 3; 1 (3-5), 2 (6-8), 3 (9 o más). */
export function nivelLlama(racha) {
  if (!Number.isInteger(racha) || racha < 3) return 0;
  return Math.min(3, 1 + Math.floor((racha - 3) / 3));
}

export function pintarLlama(nodo, racha) {
  const nivel = nivelLlama(racha);
  nodo.hidden = nivel === 0;
  nodo.dataset.nivel = String(nivel);
  nodo.textContent = nivel ? `🔥 ${racha}` : '';
  return nivel;
}

export function marcarDorada(nodo, activa) {
  nodo.classList.toggle('tarjeta--dorada', Boolean(activa));
}

let disparadorConfeti = null;

/** Solo para tests: olvida el lienzo y el disparador creados. */
export function reiniciarConfetiParaTests() {
  disparadorConfeti = null;
}

export async function lanzarConfeti({
  documento = globalThis.document,
  ventana = globalThis.window,
  cargar = () => import('./vendor/canvas-confetti.js'),
  intensidad = 1,
} = {}) {
  if (prefiereMenosMovimiento(ventana) || !documento || !documento.body) return false;
  try {
    if (!disparadorConfeti) {
      const modulo = await cargar();
      const lienzo = documento.createElement('canvas');
      lienzo.className = 'lienzo-confeti';
      lienzo.dataset.test = 'confeti';
      lienzo.setAttribute('aria-hidden', 'true');
      documento.body.appendChild(lienzo);
      disparadorConfeti = modulo.create(lienzo, { resize: true, useWorker: false });
    }
    disparadorConfeti({
      particleCount: Math.round(120 * intensidad),
      spread: 75,
      startVelocity: 42,
      origin: { y: 0.65 },
      colors: COLORES_CONFETI,
      disableForReducedMotion: true,
    });
    return true;
  } catch {
    return false;
  }
}
