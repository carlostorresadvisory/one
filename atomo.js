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

const MAX_ANILLOS = 6; // v0.2b3 Tarea 3: 4 → 6 (átomo más amplio, decisión de Carlos 14-sep 21:30).

/** Estado inicial del átomo para `area`: sin ningún anillo elegido todavía (núcleo = el área). */
export function crearEstadoAtomo(area) {
  return { area, ruta: [], etiquetas: [] };
}

/**
 * Avanza un anillo: añade `subtema.completo` a `ruta` (lo que viaja a `pedirTanda`/`pedirSubtemas`)
 * y `subtema.corto` a `etiquetas` (lo que se ve en pantalla). Inmutable: nunca toca `estado`. En el
 * máximo de anillos (6, v0.2b3) es un no-op que devuelve el MISMO objeto recibido (no una copia
 * igual) — así quien llama puede detectar "no ha pasado nada" con `===` en vez de comparar
 * contenido (app.js usa esto para mostrar "Máximo detalle: toca Generar", ver mostrarAvisoTopeAtomo).
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
// viewBox 320x320 (brief): centro geométrico y radios en las mismas unidades.
//
// v0.2b3 Tarea 3 -- "Ampliación" (dirección de Carlos, 14-sep 22:11: "la idea no es que dé vueltas
// sino que sea dinámico"): se quita la órbita giratoria entera (ver estilos.css, ya no hay
// @keyframes atomo-girar) y el texto pasa a vivir DENTRO del círculo del nodo, como ya hacía el
// núcleo -- ya no hace falta contra-rotación para mantenerlo recto, ni etiqueta exterior. Radios
// nuevos (diseño decidido por el controlador): núcleo 44, nodo 38, órbita 118. Con 7 nodos (6
// subtemas + "Más…", el caso más apretado) la distancia entre centros contiguos es
// 2*118*sin(π/7) ≈ 102px, más del doble del diámetro de un nodo (76px) -- no se solapan entre sí
// ni con el núcleo (hueco núcleo-nodo: 118-44-38 = 36px). Verificado también de forma visual en
// las capturas 375px (ver informe de la tarea).
const TAMANO = 320;
const CENTRO = TAMANO / 2;
const RADIO_NUCLEO = 44;
const RADIO_NODO = 38;
const RADIO_ORBITA = 118;
const ALTURA_LINEA_NODO = 10.5;
const N_NODOS_ESPERANDO = 6; // nodos de espera pintados mientras no se sabe aún cuántos subtemas hay.

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
 * `text-anchor="middle"`/`dominant-baseline="middle"`, ver crearAtomo). Para el núcleo: el texto
 * vive DENTRO del círculo. */
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

/** Reinicia una animación CSS por nombre de clase: la quita, fuerza reflow (leer `offsetWidth`) y
 * la vuelve a poner -- si no, añadir la MISMA clase que el elemento ya tiene no dispara la
 * animación una segunda vez (p. ej. núcleo/nodos que cambian de contenido sin salir del DOM). */
function reiniciarAnimacion(elemento, clase) {
  elemento.classList.remove(clase);
  void elemento.getBoundingClientRect();
  elemento.classList.add(clase);
}

function activarConTecladoYClic(elemento, manejador) {
  elemento.addEventListener('click', manejador);
  elemento.addEventListener('keydown', (ev) => {
    // Adversarial A10: 'Spacebar' es el nombre viejo (IE9-10) de la tecla espacio -- ' ' ya es el
    // valor real que da cualquier navegador soportado hoy, esa rama nunca se disparaba.
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      manejador();
    }
  });
}

/** Calcula las posiciones equiespaciadas de `total` nodos en la órbita, empezando arriba (-90°) y
 * repartidos en sentido horario -- mismo criterio de siempre, ahora reutilizado por pintarNodos y
 * pintarNodosEsperando (antes solo existía en el primero). */
function posicionNodo(indice, total) {
  const angulo = -Math.PI / 2 + (indice * 2 * Math.PI) / total;
  return { x: CENTRO + Math.cos(angulo) * RADIO_ORBITA, y: CENTRO + Math.sin(angulo) * RADIO_ORBITA };
}

/**
 * Monta el átomo (SVG núcleo + nodos en órbita) dentro de `contenedor`. `subtemas` es el anillo
 * visible al montar (`[]` vale: núcleo solo, sin nodos — p. ej. sin servidor configurado, ver
 * app.js). Tocar/activar por teclado un nodo real llama `alElegir(subtema)` (el objeto completo
 * `{indice, corto, completo}`, tal cual lo da `pedirSubtemas`); tocar/activar el núcleo llama
 * `alVolver()` (un anillo atrás — no-op en el anillo 1, lo decide `retroceder` en app.js); tocar el
 * nodo "Más…" llama `alMas()` (paginación del anillo actual, ver app.js#manejarMasAtomo).
 *
 * v0.2b3 Tarea 3 ("Ampliación", dirección de Carlos): sin órbita giratoria -- el átomo es un árbol
 * que se abre, no un sistema solar. `actualizar` acepta un tercer parámetro `opciones`:
 * - `esperando` (bool): pinta 6 nodos vacíos discontinuos con un punto que late
 *   (`.atomo-nodo--esperando`, `data-test="atomo-esperando"`), no interactivos, en vez de
 *   `nuevosSubtemas` -- se usa mientras `pedirSubtemas` está en vuelo (app.js).
 * - `conMas` (bool): añade el nodo "Más…" (círculo discontinuo, `data-test="atomo-mas"`) en la
 *   última posición de la órbita, contando en el reparto equiespaciado.
 * - `masVacio` (bool): el nodo "Más…" se pinta como "No hay más por ahora" (`data-test=
 *   "atomo-mas-vacio"`), sin interacción -- transitorio, app.js lo revierte a los 2s.
 * `prefers-reduced-motion` desactiva toda animación/transición vía la regla general de
 * estilos.css; aquí no hace falta ninguna comprobación aparte.
 * @returns {{actualizar: (subtemas: object[], textoNucleo: string, opciones?: object) => void, destruir: () => void}}
 */
export function crearAtomo({ contenedor, area, subtemas = [], alElegir, alVolver, alMas }) {
  contenedor.innerHTML = '';

  const svg = crearElementoSvg('svg', {
    class: 'atomo-svg',
    viewBox: `0 0 ${TAMANO} ${TAMANO}`,
    // Ronda final de revisión (Important #7): `role="img"` en el `<svg>` contenedor anuncia todo
    // su interior como una imagen plana ante VoiceOver -- los `role="button"` de los nodos y el
    // núcleo, que SÍ son interactivos, quedaban invisibles para el lector de pantalla. "group" no
    // cambia nada visualmente y deja que sus hijos se anuncien cada uno con su propio rol.
    role: 'group',
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

  /** Nodo real de subtema: círculo con el texto DENTRO (ya no debajo, v0.2b3) y `alElegir`. */
  function crearNodoSubtema(subtema) {
    // Ronda 1 de revisión (Minor #5, se conserva): "Elegir subtema: " a secas (sin nombre) si
    // `corto` viene vacío -- nunca un aria-label con el separador colgando.
    const etiquetaAria = subtema.corto ? `Elegir subtema: ${subtema.corto}` : 'Elegir subtema';
    const boton = crearElementoSvg('g', {
      class: 'atomo-nodo-boton',
      role: 'button',
      tabindex: '0',
      'data-test': 'atomo-nodo',
      'aria-label': etiquetaAria,
    });
    const circulo = crearElementoSvg('circle', { r: RADIO_NODO, class: 'atomo-nodo-circulo' });
    const texto = crearElementoSvg('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      class: 'atomo-nodo-texto',
    });
    boton.appendChild(circulo);
    boton.appendChild(texto);
    pintarLineas(texto, envolverTexto(subtema.corto, 11, 3), ALTURA_LINEA_NODO);
    activarConTecladoYClic(boton, () => {
      if (typeof alElegir === 'function') alElegir(subtema);
    });
    return boton;
  }

  /** Nodo "Más…" (o "No hay más por ahora" si `vacio`): círculo discontinuo. Sin interacción
   * mientras `vacio` es true -- es un mensaje transitorio, no un botón que hacer doble-tap. */
  function crearNodoMas(vacio) {
    const atributos = {
      class: 'atomo-nodo-boton atomo-nodo-boton--mas',
      'data-test': vacio ? 'atomo-mas-vacio' : 'atomo-mas',
    };
    if (!vacio) {
      atributos.role = 'button';
      atributos.tabindex = '0';
      atributos['aria-label'] = 'Más subtemas';
    }
    const boton = crearElementoSvg('g', atributos);
    const circulo = crearElementoSvg('circle', {
      r: RADIO_NODO,
      class: 'atomo-nodo-circulo atomo-nodo-circulo--mas',
    });
    const texto = crearElementoSvg('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      class: 'atomo-nodo-texto',
    });
    boton.appendChild(circulo);
    boton.appendChild(texto);
    pintarLineas(texto, envolverTexto(vacio ? 'No hay más por ahora' : 'Más…', 11, 3), ALTURA_LINEA_NODO);
    if (!vacio) {
      activarConTecladoYClic(boton, () => {
        if (typeof alMas === 'function') alMas();
      });
    }
    return boton;
  }

  /** Nodo de espera: círculo discontinuo con un punto que late, sin `role`/`tabindex` (no
   * pulsable -- "los nodos de espera no son pulsables; un toque sobre ellos no hace nada", ver
   * brief de la tarea). `data-test="atomo-esperando"`, distinto de "atomo-nodo" a propósito: así
   * un test puede comprobar que NO hay nodos reales mientras se espera, sin ambigüedad. */
  function crearNodoEsperando() {
    const grupo = crearElementoSvg('g', { class: 'atomo-nodo-boton atomo-nodo-boton--esperando', 'data-test': 'atomo-esperando' });
    const circulo = crearElementoSvg('circle', {
      r: RADIO_NODO,
      class: 'atomo-nodo-circulo atomo-nodo-circulo--esperando',
    });
    const punto = crearElementoSvg('circle', { r: 4, class: 'atomo-nodo-punto' });
    grupo.appendChild(circulo);
    grupo.appendChild(punto);
    return grupo;
  }

  function colocarEnOrbita(elemento, indice, total) {
    const { x, y } = posicionNodo(indice, total);
    const grupoNodo = crearElementoSvg('g', {
      class: 'atomo-nodo',
      transform: `translate(${x.toFixed(2)}, ${y.toFixed(2)})`,
    });
    grupoNodo.appendChild(elemento);
    grupoOrbita.appendChild(grupoNodo);
  }

  /** Pinta el anillo real: `listaSubtemas` y, si `conMas`, el nodo "Más…" (o su variante `masVacio`)
   * en la última posición -- "equiespaciados contando Más…" (brief), por eso entra en `total`. */
  function pintarNodos(listaSubtemas, { conMas = false, masVacio = false } = {}) {
    grupoOrbita.innerHTML = '';
    const total = listaSubtemas.length + (conMas ? 1 : 0);
    if (total === 0) return;
    listaSubtemas.forEach((subtema, indice) => {
      colocarEnOrbita(crearNodoSubtema(subtema), indice, total);
    });
    if (conMas) colocarEnOrbita(crearNodoMas(masVacio), listaSubtemas.length, total);
  }

  /** Pinta los `N_NODOS_ESPERANDO` nodos de espera, siempre en ese número fijo -- nunca se sabe
   * todavía cuántos subtemas reales van a llegar. Nunca lleva "Más…" (decisión del controlador:
   * "Más… solo se pinta si el anillo actual no está esperando"). */
  function pintarNodosEsperando() {
    grupoOrbita.innerHTML = '';
    for (let indice = 0; indice < N_NODOS_ESPERANDO; indice += 1) {
      colocarEnOrbita(crearNodoEsperando(), indice, N_NODOS_ESPERANDO);
    }
  }

  function actualizar(nuevosSubtemas = [], textoNucleo2 = area, opciones = {}) {
    const { esperando = false, conMas = false, masVacio = false } = opciones;
    // Disposición (Ronda final): núcleo <= 12 caracteres/línea (2 líneas) para que quepa sin
    // salirse del círculo (A8 del triage adversarial: textLength/lengthAdjust deforma los glifos,
    // se prefiere acortar el texto en vez de encogerlo).
    pintarLineas(textoNucleo, envolverTexto(textoNucleo2, 12, 2), 13, CENTRO);
    // "Al tocar un nodo pasa algo YA" (brief): un pequeño "pop" de entrada cada vez que el texto
    // del núcleo cambia -- el estado (texto/cabecera/ruta) ya cambió al instante en app.js, esto
    // es solo el acompañamiento visual (neutralizado entero por prefers-reduced-motion).
    reiniciarAnimacion(grupoNucleo, 'atomo-nucleo--entra');
    if (esperando) pintarNodosEsperando();
    else pintarNodos(nuevosSubtemas, { conMas, masVacio });
  }

  actualizar(subtemas, area);

  return {
    actualizar,
    destruir() {
      contenedor.innerHTML = '';
    },
  };
}
