// ONE · saber-mas.js — el botón «Saber +» (spec v0.3.2): UN componente para todos los modos. Un botón con
// chevron que despliega tres enlaces (ChatGPT · Claude · Gemini) con el prompt de la pregunta ya escrito.
// Patrón disclosure (botón aria-expanded + lista de enlaces). El panel se monta en `document.body` mientras
// está abierto, para que ningún overflow ni transform de la tarjeta lo recorte; nunca provoca scroll.
// Sin `document` global: el documento y la ventana se inyectan (por defecto, los globales).

import { valorConUnidad, formatearValor, esFecha } from './masomenos.js';

export const DESTINOS = [
  { clave: 'chatgpt', nombre: 'ChatGPT', url: (q) => `https://chatgpt.com/?q=${q}` },
  { clave: 'claude', nombre: 'Claude', url: (q) => `https://claude.ai/new?q=${q}` },
  // Gemini va por el modo IA de Google: la app gemini.google.com no lee la URL.
  { clave: 'gemini', nombre: 'Gemini', url: (q) => `https://www.google.com/search?udm=50&q=${q}` },
];

export const MARGEN = 8; // px mínimos entre el panel y el borde de la ventana visible

// --- Prompts --------------------------------------------------------------------------------------------------

/** Respuesta correcta como texto (vf, test4, ordenar, error). */
export function respuestaCorrectaTexto(pregunta) {
  switch (pregunta.tipo) {
    case 'vf': return pregunta.respuesta ? 'Verdadero' : 'Falso';
    case 'test4': return pregunta.opciones[pregunta.correcta];
    case 'ordenar': return pregunta.items.join(' → ');
    case 'error': return pregunta.tarjeta.filas[pregunta.sospechoso].etiqueta;
    default: return '';
  }
}

/** Prompt constructivo de una pregunta ya respondida (spec v0.1d §5). */
export function promptPregunta(pregunta) {
  return `Estoy aprendiendo con una app de preguntas. Pregunta: «${pregunta.enunciado}». Respuesta correcta: «${respuestaCorrectaTexto(pregunta)}». Explicación que me dio la app: «${pregunta.explicacion}». Ayúdame a entenderlo de verdad: explícame el mecanismo o el porqué de fondo, sitúalo en su contexto (histórico, económico o científico, según toque), dime por qué importa hoy y cómo se relaciona con la actualidad, dame un dato o una anécdota memorable para recordarlo y conversar sobre ello, corrige o matiza la explicación si crees que le falta algo, apóyate en algo visual siempre que ayude (un esquema en texto, una tabla comparativa, una línea de tiempo o una fórmula sencilla), y termina proponiéndome dos o tres preguntas para seguir profundizando. En español.`;
}

const CIERRE_CIFRAS = ' Ayúdame a entenderlo de verdad: explícame por qué hay tanta diferencia, el contexto que la explica, por qué importa hoy, un dato memorable para recordarlo, y termina proponiéndome dos o tres preguntas para seguir profundizando. En español.';

/** «Nombre (valor unidad, dato de 2025)»; en las fechas, el año es el propio valor. */
function describir(c) {
  const ano = typeof c.fecha === 'string' && /^\d{4}/.test(c.fecha) ? c.fecha.slice(0, 4) : null;
  const fecha = esFecha(c.categoria);
  return `${c.nombre} (${fecha ? `año ${valorConUnidad(c)}` : valorConUnidad(c)}${ano && !fecha ? `, dato de ${ano}` : ''})`;
}

/** Prompt de Más o menos (Comparar): las dos cifras de la ronda. */
export function promptComparar(a, b) {
  return `Estoy jugando a «Más o menos» en una app de cultura general. Comparación: ${describir(a)} frente a ${describir(b)}.${CIERRE_CIFRAS}`;
}

/** Prompt de Afinar: la cifra, mi estimación y el valor real. */
export function promptAfinar(real, estimado) {
  const texto = (valor) => (esFecha(real.categoria) ? formatearValor(valor, real.categoria) : valorConUnidad({ ...real, valor }));
  return `Estoy jugando a «Afinar» en una app de cultura general: estimo una cifra. Cifra: ${describir(real)}. Mi estimación: ${texto(estimado)}; el valor real: ${texto(real.valor)}.${CIERRE_CIFRAS}`;
}

/** Enlaces de los tres destinos con el prompt codificado. */
export function enlacesDe(prompt) {
  const q = encodeURIComponent(prompt);
  return DESTINOS.map((d) => ({ clave: d.clave, nombre: d.nombre, href: d.url(q) }));
}

// --- Posición (pura) ------------------------------------------------------------------------------------------

/** Dónde poner el panel: hacia abajo si cabe con MARGEN sobre el borde inferior de la zona visible; si no,
 * hacia arriba. `caja` es la del botón; `panel` {ancho, alto}; `zona` {arriba, abajo, izquierda, derecha}. */
export function posicionarPanel(caja, panel, zona) {
  const abajoLibre = zona.abajo - MARGEN - caja.bottom;
  const hacia = panel.alto <= abajoLibre ? 'abajo' : 'arriba';
  const top = hacia === 'abajo' ? caja.bottom + 4 : Math.max(zona.arriba + MARGEN, caja.top - 4 - panel.alto);
  const maxIzq = zona.derecha - MARGEN - panel.ancho;
  const left = Math.max(zona.izquierda + MARGEN, Math.min(caja.left, maxIzq));
  return { top, left, hacia };
}

// --- Componente -----------------------------------------------------------------------------------------------

let abierto = null; // el único panel abierto: { cerrar }
let contador = 0;

/** Cierra el panel abierto, sea de quien sea. */
export function cerrarSaberMas() {
  if (abierto) abierto.cerrar();
}

export function crearSaberMas({ prompt, documento = globalThis.document, ventana = globalThis.window }) {
  const id = `saber-mas-menu-${++contador}`;
  const nodo = (etiqueta, clase, texto) => {
    const n = documento.createElement(etiqueta);
    n.className = clase;
    if (texto !== undefined) n.textContent = texto;
    return n;
  };

  const boton = nodo('button', 'saber-mas');
  boton.setAttribute('type', 'button');
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', id);
  boton.setAttribute('aria-label', 'Saber más: preguntar a una IA');
  boton.setAttribute('data-test', 'saber-mas');
  const chevron = nodo('span', 'saber-mas-chevron', '▾');
  chevron.setAttribute('aria-hidden', 'true');
  boton.append(nodo('span', 'saber-mas-texto', 'Saber +'), chevron);

  const menu = nodo('div', 'saber-mas-menu');
  menu.setAttribute('id', id);
  menu.setAttribute('data-test', 'saber-mas-menu');
  const enlaces = enlacesDe(prompt).map((e) => {
    const a = nodo('a', 'saber-mas-enlace', e.nombre);
    a.setAttribute('href', e.href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.setAttribute('data-test', `preguntar-${e.clave}`);
    a.setAttribute('aria-label', `Preguntar a ${e.nombre}`);
    a.addEventListener('click', () => ventana.setTimeout(cerrar, 0)); // tras la navegación, no durante
    menu.appendChild(a);
    return a;
  });

  const raiz = nodo('div', 'saber-mas-raiz');
  raiz.appendChild(boton);

  let estaAbierto = false;
  let vigilante = null;

  const dentro = (objetivo) => Boolean(objetivo && (objetivo === boton || objetivo === menu
    || (typeof boton.contains === 'function' && boton.contains(objetivo))
    || (typeof menu.contains === 'function' && menu.contains(objetivo))));

  function alPointerdown(e) {
    if (dentro(e.target)) return;
    // El toque fuera que cierra se consume: ni elige una respuesta ni pasa de pregunta.
    e.preventDefault?.();
    e.stopPropagation?.();
    cerrar();
    let plazo = null;
    const soltar = () => {
      documento.removeEventListener('click', tragar, true);
      ventana.clearTimeout(plazo);
    };
    function tragar(ev) {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      soltar();
    }
    documento.addEventListener('click', tragar, true);
    plazo = ventana.setTimeout(soltar, 400);
  }
  function alTeclear(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault?.();
    cerrar();
    boton.focus?.({ preventScroll: true });
  }
  const alCambiarVista = () => cerrar();

  function colocar() {
    if (typeof boton.getBoundingClientRect !== 'function') return;
    const caja = boton.getBoundingClientRect();
    const vv = ventana.visualViewport;
    const seguro = parseFloat(ventana.getComputedStyle?.(documento.documentElement)?.getPropertyValue('--zona-segura-abajo')) || 0;
    const zona = {
      arriba: vv ? vv.offsetTop : 0,
      abajo: (vv ? vv.offsetTop + vv.height : ventana.innerHeight) - seguro,
      izquierda: vv ? vv.offsetLeft : 0,
      derecha: vv ? vv.offsetLeft + vv.width : ventana.innerWidth,
    };
    const r = menu.getBoundingClientRect();
    const { top, left, hacia } = posicionarPanel(caja, { ancho: r.width, alto: r.height }, zona);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.setAttribute('data-hacia', hacia);
  }

  function abrir({ teclado = false } = {}) {
    if (estaAbierto) return;
    cerrarSaberMas();
    estaAbierto = true;
    abierto = { cerrar };
    boton.setAttribute('aria-expanded', 'true');
    menu.style.visibility = 'hidden';
    documento.body.appendChild(menu);
    colocar();
    menu.style.visibility = '';
    documento.addEventListener('pointerdown', alPointerdown, true);
    documento.addEventListener('keydown', alTeclear, true);
    documento.addEventListener('scroll', alCambiarVista, true);
    ventana.addEventListener?.('resize', alCambiarVista);
    // Si la pregunta cambia (el botón sale del DOM) el panel se va con ella.
    vigilante = ventana.setInterval(() => { if (boton.isConnected === false) cerrar(); }, 300);
    if (teclado) enlaces[0].focus?.({ preventScroll: true });
  }

  function cerrar() {
    if (!estaAbierto) return;
    estaAbierto = false;
    if (abierto && abierto.cerrar === cerrar) abierto = null;
    boton.setAttribute('aria-expanded', 'false');
    menu.remove();
    documento.removeEventListener('pointerdown', alPointerdown, true);
    documento.removeEventListener('keydown', alTeclear, true);
    documento.removeEventListener('scroll', alCambiarVista, true);
    ventana.removeEventListener?.('resize', alCambiarVista);
    ventana.clearInterval(vigilante);
    vigilante = null;
  }

  boton.addEventListener('click', (e) => {
    if (estaAbierto) cerrar();
    else abrir({ teclado: e.detail === 0 });
  });

  return { elemento: raiz, boton, menu, abrir, cerrar, estaAbierto: () => estaAbierto };
}
