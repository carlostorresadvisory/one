// ONE · atomo.js — pantalla Átomo (Tarea 2 del plan v0.2b2-cliente-atomo). Spec:
// docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §4 ("Átomo").
//
// Dos piezas, deliberadamente separadas (mismo criterio que mazo.js/motor.js):
// - Estado puro (`crearEstadoAtomo`/`avanzar`/`retroceder`): la ruta de anillos elegida dentro de
//   un área, sin DOM ni red — se puede testear con `node --test` a secas (tests/atomo.test.js).
// - `crearAtomo`: el componente visual (SVG con viewBox, núcleo + nodos en órbita). No sabe nada
//   de servidor, de banco ni de partidas: solo pinta lo que le pasan y avisa por callback cuando
//   el jugador toca un nodo (`alElegir`) o el núcleo (`alVolver`, un anillo atrás). Toda la
//   orquestación (pedirSubtemas/pedirTanda/consultarTrabajo, fusionarBancoExtra, la vista de
//   espera, el chip "Tanda lista") vive en app.js, igual que ya hace con mazo.js/montarMazo.

// === Estado puro (decisión del controlador, 14-sep-2026) ==========================================

const MAX_ANILLOS = 4;

/** Estado inicial del átomo para `area`: sin ningún anillo elegido todavía (núcleo = el área). */
export function crearEstadoAtomo(area) {
  return { area, ruta: [], etiquetas: [] };
}

/**
 * Avanza un anillo: añade `subtema.completo` a `ruta` (lo que viaja a `pedirTanda`/`pedirSubtemas`)
 * y `subtema.corto` a `etiquetas` (lo que se ve en pantalla). Inmutable: nunca toca `estado`. En el
 * máximo de anillos (4) es un no-op que devuelve el MISMO objeto recibido (no una copia igual) —
 * así quien llama puede detectar "no ha pasado nada" con `===` en vez de comparar contenido.
 */
export function avanzar(estado, subtema) {
  if (estado.ruta.length >= MAX_ANILLOS) return estado;
  return {
    area: estado.area,
    ruta: [...estado.ruta, subtema.completo],
    etiquetas: [...estado.etiquetas, subtema.corto],
  };
}

/**
 * Retrocede un anillo: quita el último elemento de `ruta` y de `etiquetas`. Inmutable. En el
 * anillo 1 (`ruta` vacía) es un no-op que devuelve el MISMO objeto recibido, mismo criterio que
 * `avanzar` en el máximo.
 */
export function retroceder(estado) {
  if (estado.ruta.length === 0) return estado;
  return {
    area: estado.area,
    ruta: estado.ruta.slice(0, -1),
    etiquetas: estado.etiquetas.slice(0, -1),
  };
}

// === Componente visual: SVG con núcleo + nodos en órbita ===========================================

const NS_SVG = 'http://www.w3.org/2000/svg';
// viewBox 320x320 (brief): centro geométrico y radios en las mismas unidades. RADIO_NODO=24 da
// nodos de 48px de diámetro (>= 44px de toque exigidos) cuando el SVG renderiza cerca de 1:1 con
// su viewBox (ver estilos.css, max-height: min(55vh, 320px)).
const TAMANO = 320;
const CENTRO = TAMANO / 2;
const RADIO_NUCLEO = 54;
const RADIO_NODO = 24;
const RADIO_ORBITA = 118;

function crearElementoSvg(tipo, atributos = {}) {
  const el = document.createElementNS(NS_SVG, tipo);
  for (const [clave, valor] of Object.entries(atributos)) el.setAttribute(clave, String(valor));
  return el;
}

/**
 * Reparte `texto` en como mucho `maxLineas` líneas de como mucho `maxPorLinea` caracteres — SVG
 * `<text>` no envuelve solo, hay que decidir los saltos a mano. Nunca parte una palabra por la
 * mitad salvo en la ÚLTIMA línea, que se recorta con "…" si queda contenido sin colocar (mismo
 * criterio que `acortarSubtema` en servidor/index.js, aplicado aquí también como defensa: el
 * servidor ya manda `corto`/nombres de área dentro de límite, pero un texto más largo no debe
 * desbordar el círculo en vez de fallar en silencio).
 */
function envolverTexto(texto, maxPorLinea, maxLineas) {
  const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  let indice = 0;
  while (indice < palabras.length && lineas.length < maxLineas) {
    const palabra = palabras[indice];
    const candidato = actual ? `${actual} ${palabra}` : palabra;
    if (candidato.length <= maxPorLinea) {
      actual = candidato;
      indice += 1;
    } else if (!actual) {
      // Una sola palabra ya más larga que la línea: se coloca igual, se recorta más abajo si hace falta.
      actual = palabra;
      indice += 1;
    } else {
      lineas.push(actual);
      actual = '';
    }
  }
  if (actual) lineas.push(actual);

  const quedaTexto = indice < palabras.length;
  const ultima = lineas[lineas.length - 1] || '';
  if (quedaTexto || ultima.length > maxPorLinea) {
    lineas[lineas.length - 1] = `${ultima.slice(0, Math.max(0, maxPorLinea - 1))}…`;
  }
  return lineas.length > 0 ? lineas : [''];
}

/** Pinta `lineas` como `<tspan>` centrados verticalmente sobre `nodoTexto` (que ya tiene
 * `text-anchor="middle"`/`dominant-baseline="middle"`, ver crearAtomo). */
function pintarLineas(nodoTexto, lineas, alturaLinea, x = 0) {
  nodoTexto.textContent = '';
  const offsetInicial = (-(lineas.length - 1) * alturaLinea) / 2;
  lineas.forEach((linea, i) => {
    // `x` se repite en CADA tspan a propósito: sin él, un tspan sin `x` propio continúa desde
    // donde quedó el cursor de la línea anterior (que con text-anchor="middle" no está centrado
    // para la segunda línea) en vez de recentrarse él solo.
    const tspan = crearElementoSvg('tspan', { x, dy: i === 0 ? offsetInicial : alturaLinea });
    tspan.textContent = linea;
    nodoTexto.appendChild(tspan);
  });
}

function activarConTecladoYClic(elemento, manejador) {
  elemento.addEventListener('click', manejador);
  elemento.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      manejador();
    }
  });
}

/**
 * Monta el átomo (SVG núcleo + nodos en órbita) dentro de `contenedor`. `subtemas` es el anillo
 * visible al montar (`[]` vale: núcleo solo, sin nodos — p. ej. sin servidor configurado, ver
 * app.js). Tocar/activar por teclado un nodo llama `alElegir(subtema)` (el objeto completo
 * `{indice, corto, completo}`, tal cual lo da `pedirSubtemas`); tocar/activar el núcleo llama
 * `alVolver()` (un anillo atrás — no-op en el anillo 1, lo decide `retroceder` en app.js).
 * Órbita lenta (60s/vuelta, CSS @keyframes en estilos.css) con contra-rotación por nodo para que
 * el texto quede recto; `prefers-reduced-motion` la apaga entera (estilos.css).
 * @returns {{actualizar: (subtemas: object[], textoNucleo: string) => void, destruir: () => void}}
 */
export function crearAtomo({ contenedor, area, subtemas = [], alElegir, alVolver }) {
  contenedor.innerHTML = '';

  const svg = crearElementoSvg('svg', {
    class: 'atomo-svg',
    viewBox: `0 0 ${TAMANO} ${TAMANO}`,
    role: 'img',
    'aria-label': 'Mapa de subtemas',
  });

  const grupoOrbita = crearElementoSvg('g', { class: 'atomo-orbita' });

  const grupoNucleo = crearElementoSvg('g', {
    class: 'atomo-nucleo',
    role: 'button',
    tabindex: '0',
    'data-test': 'atomo-nucleo',
    'aria-label': 'Volver un anillo atrás',
  });
  const circuloNucleo = crearElementoSvg('circle', {
    cx: CENTRO,
    cy: CENTRO,
    r: RADIO_NUCLEO,
    class: 'atomo-nucleo-circulo',
  });
  const textoNucleo = crearElementoSvg('text', {
    x: CENTRO,
    y: CENTRO,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    class: 'atomo-nucleo-texto',
  });
  grupoNucleo.appendChild(circuloNucleo);
  grupoNucleo.appendChild(textoNucleo);
  activarConTecladoYClic(grupoNucleo, () => {
    if (typeof alVolver === 'function') alVolver();
  });

  svg.appendChild(grupoOrbita);
  svg.appendChild(grupoNucleo);
  contenedor.appendChild(svg);

  function pintarNodos(listaSubtemas) {
    grupoOrbita.innerHTML = '';
    const total = listaSubtemas.length;
    listaSubtemas.forEach((subtema, indice) => {
      const angulo = -Math.PI / 2 + (indice * 2 * Math.PI) / total;
      const x = CENTRO + Math.cos(angulo) * RADIO_ORBITA;
      const y = CENTRO + Math.sin(angulo) * RADIO_ORBITA;

      const grupoNodo = crearElementoSvg('g', {
        class: 'atomo-nodo',
        transform: `translate(${x.toFixed(2)}, ${y.toFixed(2)})`,
      });
      // Contra-rotación (spec §4): un `<g>` interno que gira al revés que `.atomo-orbita`, misma
      // duración, para que el círculo y el texto queden siempre rectos aunque el nodo dé vueltas.
      const grupoContra = crearElementoSvg('g', {
        class: 'atomo-nodo-contra',
        role: 'button',
        tabindex: '0',
        'data-test': 'atomo-nodo',
        'aria-label': `Elegir subtema: ${subtema.corto || ''}`,
      });
      const circulo = crearElementoSvg('circle', { r: RADIO_NODO, class: 'atomo-nodo-circulo' });
      const texto = crearElementoSvg('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        class: 'atomo-nodo-texto',
      });
      grupoContra.appendChild(circulo);
      grupoContra.appendChild(texto);
      grupoNodo.appendChild(grupoContra);

      pintarLineas(texto, envolverTexto(subtema.corto, 20, 2), 9);
      activarConTecladoYClic(grupoContra, () => {
        if (typeof alElegir === 'function') alElegir(subtema);
      });

      grupoOrbita.appendChild(grupoNodo);
    });
  }

  function actualizar(nuevosSubtemas = [], textoNucleo2 = area) {
    pintarLineas(textoNucleo, envolverTexto(textoNucleo2, 16, 2), 13, CENTRO);
    pintarNodos(nuevosSubtemas);
  }

  actualizar(subtemas, area);

  return {
    actualizar,
    destruir() {
      contenedor.innerHTML = '';
    },
  };
}
