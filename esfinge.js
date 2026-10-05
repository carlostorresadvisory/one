// ONE · esfinge.js — el personaje de v0.3 (spec §7): SVG propio en cian y dorado, redondeado y de
// trazo limpio. Expresiones: neutral, contenta (salta), triste (orejas caídas), eufórica (brillos).
// Parpadeo autónomo. Los grupos con `data-anclaje` (cabeza, ojos, cuello) son los puntos de
// enganche de los accesorios de la entrega 2. Las animaciones viven en estilos.css (bloque
// "v0.3 esfinge") y se anulan con prefers-reduced-motion.

const NS_SVG = 'http://www.w3.org/2000/svg';

export const EXPRESIONES = ['neutral', 'contenta', 'triste', 'euforica'];
export const ANCLAJES = ['cabeza', 'ojos', 'cuello'];
export const MS_REACCION = 1400;
const MS_PARPADEO = 140;

const BOCAS = {
  neutral: 'M46 45 L54 45',
  contenta: 'M45 43.5 Q50 48.5 55 43.5',
  triste: 'M45 47 Q50 42.5 55 47',
  euforica: 'M44.5 43 Q50 51 55.5 43 Z',
};

export function bocaPara(expresion) {
  return BOCAS[expresion] || BOCAS.neutral;
}

export function siguienteParpadeoMs(rng = Math.random) {
  return 2500 + Math.floor(rng() * 3500);
}

function el(tipo, atributos = {}, clases = '') {
  const nodo = document.createElementNS(NS_SVG, tipo);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor));
  clases.split(' ').filter(Boolean).forEach((c) => nodo.classList.add(c));
  return nodo;
}

function construirSvg(tamano) {
  const svg = el('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': 'Esfinge' }, `esfinge esfinge--${tamano}`);

  const cuerpo = el('g', {}, 'esfinge-cuerpo');
  cuerpo.append(
    el('path', { d: 'M16 86 L16 74 Q16 60 32 58 L68 58 Q86 58 88 74 L88 86 Z' }, 'esfinge-relleno'),
    el('path', { d: 'M56 86 L94 86 M60 80 L92 80' }, 'esfinge-trazo')
  );

  const cuello = el('g', { 'data-anclaje': 'cuello' }, 'esfinge-cuello');
  cuello.append(el('rect', { x: 39, y: 48, width: 22, height: 14, rx: 3 }, 'esfinge-relleno'));

  const cabeza = el('g', { 'data-anclaje': 'cabeza' }, 'esfinge-cabeza');
  const orejas = el('g', {}, 'esfinge-orejas');
  orejas.append(
    el('path', { d: 'M34 36 L28 54 L36 54 Z' }, 'esfinge-oro esfinge-oreja esfinge-oreja--izq'),
    el('path', { d: 'M66 36 L72 54 L64 54 Z' }, 'esfinge-oro esfinge-oreja esfinge-oreja--der')
  );
  const nemes = el('path', { d: 'M31 40 Q31 16 50 14 Q69 16 69 40 Q60 34 50 34 Q40 34 31 40 Z' }, 'esfinge-oro esfinge-nemes');
  const franjas = el('path', { d: 'M38 20 L36 36 M44 16 L43 34 M56 16 L57 34 M62 20 L64 36' }, 'esfinge-franjas');
  const cara = el('ellipse', { cx: 50, cy: 38, rx: 12, ry: 13 }, 'esfinge-relleno esfinge-cara');
  const ojos = el('g', { 'data-anclaje': 'ojos' }, 'esfinge-ojos');
  ojos.append(
    el('ellipse', { cx: 45.5, cy: 36, rx: 1.8, ry: 2.3 }, 'esfinge-ojo'),
    el('ellipse', { cx: 54.5, cy: 36, rx: 1.8, ry: 2.3 }, 'esfinge-ojo')
  );
  const boca = el('path', { d: bocaPara('neutral') }, 'esfinge-boca');
  cabeza.append(orejas, nemes, franjas, cara, ojos, boca);

  const brillos = el('g', { 'aria-hidden': 'true' }, 'esfinge-brillos');
  brillos.append(
    el('path', { d: 'M14 20 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z' }, 'esfinge-brillo'),
    el('path', { d: 'M84 14 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 Z' }, 'esfinge-brillo'),
    el('path', { d: 'M88 44 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 l3 -1 Z' }, 'esfinge-brillo')
  );

  svg.append(cuerpo, cuello, cabeza, brillos);
  return { svg, ojos, boca };
}

const temporizadorReal = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function crearEsfinge(contenedor, { tamano = 'pequena', temporizador = temporizadorReal, rng = Math.random } = {}) {
  const { svg, ojos, boca } = construirSvg(tamano === 'grande' ? 'grande' : 'pequena');
  contenedor.appendChild(svg);
  let idVuelta = null;
  let idParpadeo = null;
  let idFinParpadeo = null;
  let destruida = false;

  function poner(expresion) {
    const valida = EXPRESIONES.includes(expresion) ? expresion : 'neutral';
    EXPRESIONES.forEach((e) => svg.classList.remove(`esfinge--${e}`));
    if (svg.getBoundingClientRect) svg.getBoundingClientRect(); // reinicia el salto si se repite
    svg.classList.add(`esfinge--${valida}`);
    svg.dataset.expresion = valida;
    boca.setAttribute('d', bocaPara(valida));
  }

  function programarParpadeo() {
    idParpadeo = temporizador.setTimeout(() => {
      ojos.classList.add('esfinge-ojos--cerrados');
      idFinParpadeo = temporizador.setTimeout(() => {
        ojos.classList.remove('esfinge-ojos--cerrados');
        if (!destruida) programarParpadeo();
      }, MS_PARPADEO);
    }, siguienteParpadeoMs(rng));
  }

  poner('neutral');
  programarParpadeo();

  return {
    nodo: svg,
    expresion: () => svg.dataset.expresion,
    reaccionar(expresion) {
      if (destruida) return;
      temporizador.clearTimeout(idVuelta);
      idVuelta = null;
      poner(expresion);
      if (svg.dataset.expresion !== 'neutral') {
        idVuelta = temporizador.setTimeout(() => {
          idVuelta = null;
          poner('neutral');
        }, MS_REACCION);
      }
    },
    destruir() {
      destruida = true;
      [idVuelta, idParpadeo, idFinParpadeo].forEach((id) => temporizador.clearTimeout(id));
      contenedor.removeChild(svg);
    },
  };
}
