// ONE · app.js — UI, gestos y máquina de vistas. Toda la lógica de juego vive en motor.js;
// este fichero solo pinta pantallas y traduce interacción del usuario en llamadas al motor.
import {
  crearEstado,
  siguientePregunta,
  registrarRespuesta,
  cambiarConfianza,
  actualizarRacha,
  resumenProgreso,
  pendientes,
  misionDelDia,
  exportar,
  importar,
  evaluar,
} from './motor.js';

const CLAVE_ESTADO = 'one.estado';
const N_PARTIDA = 10;

function hoyLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function cargarEstado(hoy) {
  try {
    const guardado = localStorage.getItem(CLAVE_ESTADO);
    if (guardado) return importar(guardado);
  } catch (err) {
    // Estado corrupto o inexistente: se arranca de cero.
  }
  return crearEstado(hoy);
}

function guardarEstado(estado) {
  try {
    localStorage.setItem(CLAVE_ESTADO, exportar(estado));
  } catch (err) {
    // localStorage no disponible (modo privado, cuota...): se sigue en memoria.
  }
}

// --- estado global de la sesión de UI ---
// La fecha se lee cada vez que hace falta: una partida puede cruzar la medianoche.
function hoy() { return hoyLocal(); }
let estado = cargarEstado(hoy());
let banco = [];
let bancoPorId = new Map();

// --- mazo de la partida en curso (spec v0.1c §2.1) ---
// `mazo` son los huecos ya alcanzados, en orden; máximo N_PARTIDA. Un hueco se
// rellena la PRIMERA VEZ que se llega a él con siguientePregunta(...): así la
// selección sigue dependiendo de lo respondido hasta ese momento. `indiceMazo`
// es la tarjeta visible (puede ser también la tarjeta de cierre, un índice más
// allá del último hueco real). `partidaUltima` es la última pregunta YA
// RESPONDIDA (no la última rellenada: ver rellenarHueco), para que el motor
// pueda seguir variando tipo/área. `nodoCierre` es la tarjeta de cierre (2.4)
// cuando aplica; `bancoAgotado` evita reintentar siguientePregunta en vano
// cuando ya ha devuelto null una vez en esta partida.
let mazo = [];
let indiceMazo = 0;
let partidaUsados = new Set();
let partidaUltima = null;
let bancoAgotado = false;
let nodoCierre = null;
let mazoControlador = null;
// "Para repasar" del resumen (falladas o acertadas con confianza Baja de la
// partida que acaba de terminar): se recalcula en finalizarPartida() a partir
// del mazo completo, así que refleja también un cambio de confianza hecho
// justo antes de terminar. Task 3 lo reutiliza para el mazo de repaso.
let repasoPartida = [];

// Modo "practicar solo un área": null en partida normal; { area } cuando se entra
// desde Progreso pulsando "Practicar" en una fila. Se limpia al volver a inicio
// ("←" o "Inicio"); "Otra" en el resumen lo respeta para repetir el mismo filtro.
let filtroPartida = null;

// Mazos activos (partida y, más adelante, el del repaso): registro mínimo para
// que window.__one.irA() (solo con ?test=1) alcance al que esté visible.
const mazosActivos = [];

// --- referencias a nodos ---
const nodoRacha = document.querySelector('[data-test="racha"]');
const nodoNivelPartida = document.querySelector('[data-test="nivel-partida"]');
const nodoVolver = document.querySelector('[data-test="volver"]');
const nodoModoArea = document.querySelector('[data-test="modo-area"]');
const botonCuerpo = document.querySelector('[data-test="cuerpo"]');
const avisoCuerpo = document.getElementById('aviso-cuerpo');
// Espejos de racha/nivel en inicio: mismos datos que la cabecera, solo que "en
// grande" y visibles sin tener que fijarse en la esquina.
const nodoRachaInicio = document.querySelector('[data-test="racha-inicio"]');
const nodoNivelInicio = document.querySelector('[data-test="nivel-inicio"]');
// Radar del HUB (tipo Tekken 8: un eje por área) y los 3 KPI debajo.
const radarSvg = document.querySelector('[data-test="radar"]');
const radarVacio = document.getElementById('radar-vacio');
const nodoKpiAciertosHoy = document.querySelector('[data-test="kpi-aciertos-hoy"]');
const nodoRecuperadas = document.querySelector('[data-test="recuperadas"]');
const nodoCalibracion = document.querySelector('[data-test="calibracion"]');
const nodoMision = document.querySelector('[data-test="mision"]');
const nodoPendientes = document.querySelector('[data-test="pendientes"]');
const vistas = document.querySelectorAll('[data-vista]');
const contenedorMazo = document.getElementById('mazo');
const barraProgresoRelleno = document.getElementById('barra-progreso-relleno');
const resumenAciertos = document.getElementById('resumen-aciertos');
const resumenXp = document.getElementById('resumen-xp');
const resumenAreas = document.getElementById('resumen-areas');
const repasoCarrusel = document.getElementById('repaso-carrusel');
const repasoPuntos = document.getElementById('repaso-puntos');
const repasoVacio = document.getElementById('repaso-vacio');
const progresoAreas = document.getElementById('progreso-areas');
const importarArchivo = document.getElementById('importar-archivo');
const plantillaConfianza = document.getElementById('plantilla-confianza');

function mostrarVista(nombre) {
  vistas.forEach((v) => {
    const activa = v.dataset.vista === nombre;
    v.hidden = !activa;
    if (activa) {
      // Reinicia la animación de entrada (deslizamiento + fade, ~180ms) aunque ya
      // tuviera la clase de una vez anterior: quitar, forzar reflow, volver a poner.
      v.classList.remove('vista-entra');
      void v.offsetWidth;
      v.classList.add('vista-entra');
    }
  });
  // La flecha "←" vuelve a inicio: no tiene sentido mostrarla ya en inicio.
  nodoVolver.hidden = nombre === 'inicio';
}

/** Primera letra en mayúscula (para nombres de área en textos). */
// Las claves de área van sin acento (ids); estos son los nombres que ve Carlos.
const NOMBRES_AREA = {
  economia: 'Economía', historia: 'Historia', ciencia: 'Ciencia', tecnologia: 'Tecnología',
  geografia: 'Geografía', filosofia: 'Filosofía', arte: 'Arte', logica: 'Lógica',
};
function nombreArea(area) {
  return NOMBRES_AREA[area] || capitalizar(area);
}

// Un emoji por área: para las tarjetas del HUB y las etiquetas del radar.
const EMOJI_AREA = {
  economia: '📈', historia: '🏛️', ciencia: '🔬', tecnologia: '💻',
  geografia: '🌍', filosofia: '🤔', arte: '🎨', logica: '🧩',
};

/** Clase de color de la nota (S+/S/A/B/C/D/—), según la paleta ya existente:
 * S+/S en el acento, A/B en el texto normal, C/D atenuados, sin datos ('—') aparte. */
function claseNota(nota) {
  if (nota === '—') return 'tarjeta-area-nota--vacia';
  if (nota === 'S+' || nota === 'S') return 'tarjeta-area-nota--alta';
  if (nota === 'A' || nota === 'B') return 'tarjeta-area-nota--media';
  return 'tarjeta-area-nota--baja';
}

// --- radar del HUB (8 ejes, uno por área, en el orden de resumenProgreso().porArea) ---
const RADAR_CENTRO = 110;
const RADAR_RADIO = 78;
const RADAR_RADIO_ETIQUETA = 98;

function anguloRadar(indice, total) {
  return -Math.PI / 2 + indice * ((2 * Math.PI) / total);
}

function puntoRadar(indice, total, fraccion, radio) {
  const angulo = anguloRadar(indice, total);
  return {
    x: Number((RADAR_CENTRO + Math.cos(angulo) * radio * fraccion).toFixed(1)),
    y: Number((RADAR_CENTRO + Math.sin(angulo) * radio * fraccion).toFixed(1)),
  };
}

/** Pinta el radar tipo Tekken 8: un polígono por anillo guía (25/50/75/100%), los
 * 8 ejes, el polígono de datos (con `puntuacion` 0..1 de cada área) y una
 * etiqueta (emoji) por eje. Si todas las áreas están a 0 (estado recién creado,
 * nada jugado todavía) se ve un polígono mínimo y un aviso debajo. */
function renderRadar(porArea) {
  const total = porArea.length;

  const anillos = [0.25, 0.5, 0.75, 1]
    .map((fraccion) => {
      const puntos = porArea
        .map((_, i) => {
          const p = puntoRadar(i, total, fraccion, RADAR_RADIO);
          return `${p.x},${p.y}`;
        })
        .join(' ');
      return `<polygon points="${puntos}" class="radar-anillo" />`;
    })
    .join('');

  const ejes = porArea
    .map((_, i) => {
      const p = puntoRadar(i, total, 1, RADAR_RADIO);
      return `<line x1="${RADAR_CENTRO}" y1="${RADAR_CENTRO}" x2="${p.x}" y2="${p.y}" class="radar-eje" />`;
    })
    .join('');

  // Relleno de solidez (más opaco, debajo del contorno de puntuación): no se
  // dibuja si todas las áreas están a 0 solidez (nada consolidado todavía).
  let poligonoSolidez = '';
  if (porArea.some((fila) => fila.solidez > 0)) {
    const puntosSolidez = porArea
      .map((fila, i) => {
        const solidez = Number.isFinite(fila.solidez) ? fila.solidez : 0;
        const fraccion = Math.max(0.04, Math.min(1, solidez));
        const p = puntoRadar(i, total, fraccion, RADAR_RADIO);
        return `${p.x},${p.y}`;
      })
      .join(' ');
    poligonoSolidez = `<polygon points="${puntosSolidez}" class="radar-solido" data-test="radar-solido" />`;
  }

  // Mínimo visible (4%) para que un área en 0 no colapse el polígono en el centro.
  const puntosDato = porArea
    .map((fila, i) => {
      const fraccion = Math.max(0.04, Math.min(1, fila.puntuacion));
      const p = puntoRadar(i, total, fraccion, RADAR_RADIO);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  const etiquetas = porArea
    .map((fila, i) => {
      const p = puntoRadar(i, total, 1, RADAR_RADIO_ETIQUETA);
      const emoji = EMOJI_AREA[fila.area] || '❔';
      return `<text x="${p.x}" y="${p.y}" class="radar-etiqueta" text-anchor="middle" dominant-baseline="middle">${emoji}</text>`;
    })
    .join('');

  radarSvg.innerHTML =
    `${anillos}${ejes}${poligonoSolidez}<polygon points="${puntosDato}" class="radar-dato" />${etiquetas}`;
  radarVacio.hidden = !porArea.every((fila) => fila.puntuacion === 0);
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function actualizarCabecera() {
  const textoRacha = `🔥 ${estado.racha.dias}`;
  const textoNivel = `Nivel ${estado.nivelPartida}`;
  nodoRacha.textContent = textoRacha;
  nodoNivelPartida.textContent = textoNivel;
  // Espejos "en grande" en inicio: mismo dato, misma fuente de verdad.
  nodoRachaInicio.textContent = textoRacha;
  nodoNivelInicio.textContent = textoNivel;
  if (filtroPartida && filtroPartida.area) {
    nodoModoArea.hidden = false;
    nodoModoArea.textContent = `Solo ${nombreArea(filtroPartida.area)}`;
  } else if (filtroPartida && filtroPartida.etiqueta) {
    // Misión de hoy / Pendientes: partidas filtradas por lista de ids concreta.
    nodoModoArea.hidden = false;
    nodoModoArea.textContent = filtroPartida.etiqueta;
  } else {
    nodoModoArea.hidden = true;
  }
}

function vistaActual() {
  return document.querySelector('.vista:not([hidden])')?.dataset.vista || null;
}

/** Abandona la partida en curso si la hubiera (las respuestas ya dadas quedan
 * guardadas: Leitner/nivel se aplican una a una; la racha solo se actualiza al
 * COMPLETAR una partida, ver finalizarPartida) y limpia el filtro de área. */
function limpiarPartidaEnCurso() {
  filtroPartida = null;
  if (mazoControlador) {
    mazoControlador.destruir();
    mazoControlador = null;
  }
  mazo = [];
  indiceMazo = 0;
  nodoCierre = null;
  actualizarCabecera();
}

/** Pantalla de los dos emojis (🧠/💪). Solo se llega aquí desde "←" en el HUB. */
function irAInicioEmojis() {
  limpiarPartidaEnCurso();
  mostrarVista('inicio');
}

/** El HUB (antes "Progreso"): SIEMPRE se empieza a jugar desde aquí. Se llega
 * desde 🧠, desde "←" en pregunta/resumen, y desde "Inicio" en el resumen. */
function irAlHub() {
  limpiarPartidaEnCurso();
  renderHub();
  mostrarVista('progreso');
}

/** "←" de la cabecera: desde el HUB vuelve a los emojis; desde cualquier otro
 * sitio (pregunta, resumen) vuelve siempre al HUB, nunca a los emojis. */
function manejarVolver() {
  if (vistaActual() === 'progreso') {
    irAInicioEmojis();
  } else {
    irAlHub();
  }
}

let avisoCuerpoId = null;
/** 💪 está apagado: un aviso breve, sin navegar a ningún sitio. */
function mostrarAvisoCuerpo() {
  avisoCuerpo.hidden = false;
  if (avisoCuerpoId !== null) clearTimeout(avisoCuerpoId);
  avisoCuerpoId = setTimeout(() => {
    avisoCuerpo.hidden = true;
    avisoCuerpoId = null;
  }, 1600);
}

// --- carga del banco y arranque ---
async function iniciar() {
  const params = new URLSearchParams(location.search);
  const rutaBanco = params.get('ejemplo') === '1' ? 'datos/banco.ejemplo.json' : 'datos/banco.json';
  const respuesta = await fetch(rutaBanco);
  banco = await respuesta.json();
  bancoPorId = new Map(banco.map((p) => [p.id, p]));
  actualizarCabecera();
  mostrarVista('inicio');
}

// ============================================================================
// --- MAZO: componente vertical reutilizable (spec v0.1c §1, §2.2, §6) ---
// Monta un mazo vertical sobre una lista de nodos de tarjeta YA CONSTRUIDOS:
// gestiona el gesto (pointerdown/move/up), las teclas (↑/↓, PageUp/PageDown),
// la columna de puntos, el chevrón y la pista, y la ventana de 3 nodos en el
// DOM (anterior/actual/siguiente). No sabe nada de preguntas ni de motor: la
// partida (más abajo) y, en la siguiente tarea, el repaso, son quienes deciden
// QUÉ tarjetas hay y cuándo hace falta una más (a través de `alCambiar` y
// `actualizarTarjetas`). `test=1` en la URL expone window.__one.irA(indice)
// sobre el mazo que esté visible en cada momento.
// ============================================================================

const CLAVE_PISTA_MAZO = 'one.pistaMazo';
const LIMITE_PISTA_MAZO = 5;

function contarPistaMazoMostrada() {
  try {
    return Number(localStorage.getItem(CLAVE_PISTA_MAZO)) || 0;
  } catch (err) {
    return 0;
  }
}

function registrarPistaMazoMostrada(veces) {
  try {
    localStorage.setItem(CLAVE_PISTA_MAZO, String(veces));
  } catch (err) {
    // Sin contador persistente la pista se ve siempre: mejor de más que de menos.
  }
}

function montarMazo(contenedor, tarjetasIniciales, { alCambiar } = {}) {
  let lista = tarjetasIniciales.slice();
  let indice = 0;
  let pistaVisibleActual = true;

  const puntos = document.createElement('div');
  puntos.className = 'mazo-puntos';
  puntos.dataset.test = 'mazo-puntos';
  contenedor.appendChild(puntos);

  const chevron = document.createElement('div');
  chevron.className = 'mazo-chevron';
  chevron.dataset.test = 'mazo-siguiente-chevron';
  chevron.textContent = '⌃';
  chevron.setAttribute('aria-hidden', 'true');
  contenedor.appendChild(chevron);

  const pista = document.createElement('p');
  pista.className = 'pista-mazo';
  pista.dataset.test = 'pista-mazo';
  pista.textContent = 'Desliza ↑ para la siguiente · ↓ para volver';
  contenedor.appendChild(pista);

  function estaVisible() {
    const vista = contenedor.closest('.vista');
    return Boolean(vista && !vista.hidden);
  }

  function pintarPuntos() {
    puntos.innerHTML = '';
    lista.forEach((nodo, i) => {
      const punto = document.createElement('span');
      punto.className = 'mazo-punto';
      const respondida = Boolean(nodo.dataset && nodo.dataset.respondida === 'true');
      punto.classList.toggle('mazo-punto--respondida', respondida);
      punto.classList.toggle('mazo-punto--actual', i === indice);
      puntos.appendChild(punto);
    });
  }

  function pintarChevronYPista() {
    const hayMas = indice + 1 < lista.length;
    chevron.hidden = !hayMas;
    pista.hidden = !hayMas || !pistaVisibleActual;
  }

  /** Se llama una vez por cada índice NUEVO mostrado (no en cada render): decide
   * si esta vista cuenta para el límite de 5 y avanza el contador persistente. */
  function contarVistaParaPista() {
    const vistas = contarPistaMazoMostrada();
    pistaVisibleActual = vistas < LIMITE_PISTA_MAZO;
    registrarPistaMazoMostrada(vistas + 1);
  }

  function render(conTransicion) {
    const enDom = new Set(contenedor.querySelectorAll('.tarjeta-mazo'));
    for (let offset = -1; offset <= 1; offset += 1) {
      const i = indice + offset;
      if (i < 0 || i >= lista.length) continue;
      const nodo = lista[i];
      nodo.classList.add('tarjeta-mazo');
      nodo.classList.toggle('tarjeta-mazo--actual', offset === 0);
      nodo.classList.toggle('tarjeta-mazo--arrastrando', !conTransicion);
      nodo.dataset.indice = String(i);
      // +-1px de margen sobre el 100% exacto: dos cajas con inset:0 en el mismo
      // contenedor deberían medir idéntico, pero el redondeo a píxel de
      // dispositivo puede dejarlas a un pixel de distancia y asomar un borde de
      // la vecina (visto en captura, 430×932). Un pixel extra las esconde del
      // todo sin que se note el desplazamiento.
      const colchon = offset === 0 ? 0 : offset > 0 ? 1 : -1;
      nodo.style.transform = `translateY(calc(${offset * 100}% + ${colchon}px))`;
      if (nodo.parentElement !== contenedor) contenedor.insertBefore(nodo, puntos);
      enDom.delete(nodo);
      ajustarEncaje(nodo);
    }
    // Solo se mantienen en el DOM la actual, la anterior y la siguiente (spec
    // v0.1c §2.2): el resto se retira.
    enDom.forEach((nodo) => nodo.remove());
    pintarPuntos();
    pintarChevronYPista();
  }

  function animarRebote(sentido) {
    const nodo = lista[indice];
    if (!nodo) return;
    const desplazamiento = sentido === 'abajo' ? 14 : -14;
    nodo.classList.remove('tarjeta-mazo--arrastrando');
    nodo.style.transform = `translateY(${desplazamiento}px)`;
    setTimeout(() => {
      nodo.style.transform = 'translateY(0)';
    }, 110);
  }

  function intentarIr(nuevo) {
    if (nuevo < 0) {
      animarRebote('abajo');
      return;
    }
    if (nuevo >= lista.length) {
      animarRebote('arriba');
      return;
    }
    if (nuevo === indice) return;
    indice = nuevo;
    contarVistaParaPista();
    render(true);
    if (alCambiar) alCambiar(indice);
  }

  // --- gesto vertical sobre el propio contenedor (nunca sobre botones) ---
  const UMBRAL_PX = 60;
  const UMBRAL_VELOCIDAD = 0.5; // px/ms
  const ARRANQUE = 10;
  let gesto = null; // { id, x, y, capturado, ultimaY, ultimoT }
  let deltaYActual = 0;
  let velocidadActual = 0;

  function alPointerDown(ev) {
    if (ev.target.closest('button')) return;
    gesto = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, capturado: false, ultimaY: ev.clientY, ultimoT: performance.now() };
    deltaYActual = 0;
    velocidadActual = 0;
  }

  function alPointerMove(ev) {
    if (!gesto || ev.pointerId !== gesto.id) return;
    const dx = ev.clientX - gesto.x;
    const dy = ev.clientY - gesto.y;
    if (!gesto.capturado) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > ARRANQUE) {
        gesto.capturado = true;
        try { contenedor.setPointerCapture(ev.pointerId); } catch (err) { /* ya liberado */ }
      } else if (Math.abs(dx) > ARRANQUE) {
        // Horizontal dominante: no es el gesto del mazo (vf lo captura por su cuenta).
        gesto = null;
        return;
      } else {
        return;
      }
    }
    const ahora = performance.now();
    const dt = ahora - gesto.ultimoT;
    if (dt > 0) velocidadActual = (ev.clientY - gesto.ultimaY) / dt;
    gesto.ultimoT = ahora;
    gesto.ultimaY = ev.clientY;
    deltaYActual = dy;

    const actual = lista[indice];
    if (actual) {
      actual.classList.add('tarjeta-mazo--arrastrando');
      actual.style.transform = `translateY(${dy}px)`;
    }
    const vecino = dy < 0 ? lista[indice + 1] : lista[indice - 1];
    if (vecino) {
      vecino.classList.add('tarjeta-mazo--arrastrando');
      const base = dy < 0 ? 100 : -100;
      vecino.style.transform = `translateY(calc(${base}% + ${dy}px))`;
    }
  }

  function alPointerFin(ev) {
    if (!gesto || ev.pointerId !== gesto.id) return;
    const fueCapturado = gesto.capturado;
    gesto = null;
    if (!fueCapturado) return;
    const dy = deltaYActual;
    const v = velocidadActual;
    deltaYActual = 0;
    if (dy < -UMBRAL_PX || v < -UMBRAL_VELOCIDAD) {
      intentarIr(indice + 1);
    } else if (dy > UMBRAL_PX || v > UMBRAL_VELOCIDAD) {
      intentarIr(indice - 1);
    } else {
      render(true); // vuelve a la posición de reposo
    }
  }

  contenedor.addEventListener('pointerdown', alPointerDown);
  contenedor.addEventListener('pointermove', alPointerMove);
  contenedor.addEventListener('pointerup', alPointerFin);
  contenedor.addEventListener('pointercancel', alPointerFin);

  function alKeydown(ev) {
    if (!estaVisible()) return;
    if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
      ev.preventDefault();
      intentarIr(indice + 1);
    } else if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
      ev.preventDefault();
      intentarIr(indice - 1);
    }
  }
  document.addEventListener('keydown', alKeydown);

  function destruir() {
    document.removeEventListener('keydown', alKeydown);
    contenedor.removeEventListener('pointerdown', alPointerDown);
    contenedor.removeEventListener('pointermove', alPointerMove);
    contenedor.removeEventListener('pointerup', alPointerFin);
    contenedor.removeEventListener('pointercancel', alPointerFin);
    contenedor.innerHTML = '';
    const pos = mazosActivos.indexOf(controlador);
    if (pos !== -1) mazosActivos.splice(pos, 1);
  }

  const controlador = {
    irA: intentarIr,
    siguiente: () => intentarIr(indice + 1),
    anterior: () => intentarIr(indice - 1),
    indiceActual: () => indice,
    total: () => lista.length,
    actualizarTarjetas(nuevaLista) {
      lista = nuevaLista.slice();
      if (indice > lista.length - 1) indice = Math.max(0, lista.length - 1);
      render(true);
    },
    reajustar() { render(true); },
    estaVisible,
    destruir,
  };
  mazosActivos.push(controlador);
  contarVistaParaPista();
  render(true);
  // OJO: alCambiar NO se llama aquí en el montaje inicial (a diferencia de cada
  // intentarIr posterior): quien llama a montarMazo todavía no tiene asignada su
  // propia referencia al controlador devuelto (p. ej. `mazoControlador = montarMazo(...)`
  // no se habrá completado), así que un alCambiar síncrono aquí vería esa
  // referencia a `null`. El propio llamador dispara su lógica de arranque (p. ej.
  // asegurarSiguienteDisponible) explícitamente después de recibir el controlador.
  return controlador;
}

window.addEventListener('resize', () => {
  mazosActivos.forEach((m) => m.reajustar());
});
window.addEventListener('orientationchange', () => {
  mazosActivos.forEach((m) => m.reajustar());
});

if (new URLSearchParams(location.search).get('test') === '1') {
  window.__one = {
    irA(indice) {
      const activo = mazosActivos.find((m) => m.estaVisible());
      if (activo) activo.irA(indice);
    },
  };
}

/**
 * Regla de encaje sin scroll (spec v0.1c §4.2). Ninguna tarjeta hace scroll ni
 * cambia tamaños de letra: lo que cede espacio es la respuesta ya fija y, si
 * aún no basta, la explicación (recortada con line-clamp calculado). Se llama
 * tras cada render del mazo y en resize/orientationchange.
 */
function ajustarEncaje(tarjetaNodo) {
  if (!tarjetaNodo) return;
  tarjetaNodo.classList.remove('tarjeta--compacta-1', 'tarjeta--compacta-2');
  delete tarjetaNodo.dataset.expandido;
  const explicacionEl = tarjetaNodo.querySelector('.explicacion');
  if (explicacionEl) explicacionEl.style.webkitLineClamp = '';

  if (tarjetaNodo.scrollHeight <= tarjetaNodo.clientHeight + 2) return;

  // Paso 1: la respuesta compacta se reduce a una sola línea.
  tarjetaNodo.classList.add('tarjeta--compacta-1');
  if (tarjetaNodo.scrollHeight <= tarjetaNodo.clientHeight + 2) return;

  // Paso 2: si aún no cabe, la explicación se recorta a las líneas que quepan.
  tarjetaNodo.classList.add('tarjeta--compacta-2');
  if (!explicacionEl) return;
  const estilo = window.getComputedStyle(explicacionEl);
  const lineHeight = parseFloat(estilo.lineHeight) || 18;
  const restoAltura = tarjetaNodo.scrollHeight - explicacionEl.scrollHeight;
  const alturaLibre = tarjetaNodo.clientHeight - restoAltura;
  const lineas = Math.max(1, Math.floor(alturaLibre / lineHeight));
  explicacionEl.style.webkitLineClamp = String(lineas);
}

/** Alterna, dentro de una tarjeta compactada, cuál de las dos piezas (respuesta
 * completa / explicación completa) se ve entera — nunca las dos, nunca scroll
 * (spec v0.1c §4.2). */
function alternarEncaje(tarjetaNodo, cual) {
  const actual = tarjetaNodo.dataset.expandido || '';
  tarjetaNodo.dataset.expandido = actual === cual ? '' : cual;
}

// ============================================================================
// --- flujo de partida ---
// ============================================================================

/** `filtro` opcional arranca una partida restringida:
 * - `{ area }`: solo esa área ("Practicar" desde el hub).
 * - `{ ids, etiqueta }`: solo esos ids, en ese orden, sin relleno (Misión de hoy
 *   o Pendientes desde el hub); `etiqueta` es el texto que ve la cabecera.
 * Sin filtro, partida normal (todas las áreas). */
function empezarPartida(filtro = null) {
  if (filtro && filtro.area) {
    filtroPartida = { area: filtro.area };
  } else if (filtro && Array.isArray(filtro.ids)) {
    filtroPartida = { ids: filtro.ids, etiqueta: filtro.etiqueta || null };
  } else {
    filtroPartida = null;
  }
  if (mazoControlador) {
    mazoControlador.destruir();
    mazoControlador = null;
  }
  mazo = [];
  indiceMazo = 0;
  partidaUsados = new Set();
  partidaUltima = null;
  bancoAgotado = false;
  nodoCierre = null;
  repasoPartida = [];
  actualizarCabecera(); // pinta "Solo <Área>" / "Misión de hoy" / "Pendientes" desde la primera pregunta.
  mostrarVista('pregunta');

  contenedorMazo.innerHTML = '';
  const primerHueco = rellenarHueco(0);
  if (!primerHueco) {
    // Banco vacío desde el principio (filtro sin nada elegible): defensivo, no
    // debería pasar con los filtros que ofrece el hub.
    finalizarPartida();
    return;
  }
  actualizarBarraProgreso();
  mazoControlador = montarMazo(contenedorMazo, listaActual(), { alCambiar: manejarCambioIndiceMazo });
  manejarCambioIndiceMazo(0); // dispara el pre-relleno inicial (ver nota en montarMazo).
}

/** Nodos que forman el mazo ahora mismo: uno por hueco (en su estado actual) y,
 * si aplica, la tarjeta de cierre al final. Única fuente de verdad para lo que
 * ve montarMazo: cualquier cambio se empuja con mazoControlador.actualizarTarjetas(). */
function listaActual() {
  const lista = mazo.map((h) => h.nodo);
  if (nodoCierre) lista.push(nodoCierre);
  return lista;
}

function actualizarBarraProgreso() {
  const respondidas = mazo.filter((h) => h.respondida).length;
  barraProgresoRelleno.style.transform = `scaleX(${respondidas / N_PARTIDA})`;
}

/** Rellena el hueco `i` la primera vez que se llega a él (spec v0.1c §2.1): solo
 * avanza en orden (no se pueden "saltar" huecos) y usa `partidaUltima` (la
 * última pregunta YA RESPONDIDA) para la variedad de tipo/área del motor. */
function rellenarHueco(i) {
  if (mazo[i]) return mazo[i];
  if (i !== mazo.length || bancoAgotado) return null;
  const pregunta = siguientePregunta(estado, banco, hoy(), partidaUsados, Math.random, partidaUltima, filtroPartida);
  if (!pregunta) {
    bancoAgotado = true;
    return null;
  }
  partidaUsados.add(pregunta.id);
  const hueco = {
    pregunta,
    confianza: 'media',
    respondida: false,
    respuesta: null,
    correcta: null,
    delta: null,
    reportada: false,
    nodo: null,
  };
  hueco.nodo = construirTarjetaSinResponder(hueco);
  mazo.push(hueco);
  return hueco;
}

/** Mantiene siempre una tarjeta más disponible que la que se está viendo:
 * rellena el siguiente hueco si aún cabe en N_PARTIDA, o decide si hace falta
 * la tarjeta de cierre (huecos agotados/banco agotado con pendientes) o si ya
 * no hace falta nada más (todas respondidas: el botón Siguiente de la última
 * lleva directo al resumen). Se llama tras cada cambio de índice y tras cada
 * respuesta. */
function asegurarSiguienteDisponible() {
  if (listaActual().length <= indiceMazo + 1) {
    if (mazo.length < N_PARTIDA && !bancoAgotado) {
      if (rellenarHueco(mazo.length)) {
        mazoControlador.actualizarTarjetas(listaActual());
        return;
      }
    }
  }
  const hayHuecos = mazo.length > 0;
  const puedeCerrar = hayHuecos && (mazo.length >= N_PARTIDA || bancoAgotado);
  const todasRespondidas = hayHuecos && mazo.every((h) => h.respondida);
  if (puedeCerrar && !todasRespondidas && !nodoCierre) {
    nodoCierre = construirTarjetaCierre();
    mazoControlador.actualizarTarjetas(listaActual());
  } else if (todasRespondidas && nodoCierre) {
    nodoCierre = null;
    mazoControlador.actualizarTarjetas(listaActual());
  }
}

function manejarCambioIndiceMazo(nuevoIndice) {
  indiceMazo = nuevoIndice;
  asegurarSiguienteDisponible();
  actualizarBarraProgreso();
}

/** "Siguiente" (botón, en cada tarjeta ya respondida) y también el destino del
 * gesto/tecla cuando ya no queda ninguna tarjeta más que mostrar: si la hay,
 * navega; si no (las N_PARTIDA están respondidas, sin cierre), termina. */
function irASiguienteHueco() {
  const total = listaActual().length;
  if (indiceMazo + 1 < total) {
    mazoControlador.irA(indiceMazo + 1);
  } else {
    finalizarPartida();
  }
}

function finalizarPartida() {
  estado = actualizarRacha(estado, hoy());
  guardarEstado(estado);
  actualizarCabecera();

  const respondidas = mazo.filter((h) => h.respondida);
  const totalPreguntas = respondidas.length;
  const aciertos = respondidas.filter((h) => h.correcta).length;
  const xpTotal = respondidas.reduce((suma, h) => suma + h.delta.xp, 0);
  const areas = new Set(respondidas.map((h) => h.pregunta.area));
  // "Para repasar": falladas, o acertadas con confianza Baja (frágiles). Se
  // recalcula aquí (no se acumula sobre la marcha) para reflejar también los
  // cambios de confianza hechos en cualquier momento de la partida.
  repasoPartida = respondidas
    .filter((h) => !h.correcta || h.delta.fragil)
    .map((h) => ({ pregunta: h.pregunta, correcta: h.correcta }));

  animarConteo(resumenAciertos, 'Aciertos: ', aciertos, `/${totalPreguntas}`);
  animarConteo(resumenXp, 'XP ganado: ', xpTotal);
  resumenAreas.textContent = `Áreas: ${[...areas].join(', ') || '—'}`;

  renderRepaso();
  mostrarVista('resumen');
}

// ============================================================================
// --- construcción de tarjetas ---
// ============================================================================

function construirCabeceraPregunta(pregunta) {
  const cabecera = document.createElement('p');
  cabecera.className = 'pregunta-cabecera';
  cabecera.dataset.test = 'nivel-pregunta';
  cabecera.textContent = `${nombreArea(pregunta.area)} · nivel ${pregunta.nivel}`;
  return cabecera;
}

// Enunciado genérico del banco para "encuentra el error": cuando es exactamente
// este, la tarjeta muestra en su lugar la instrucción corta "Toca la fila que
// está mal"; si el banco trae uno propio, se respeta tal cual.
const ENUNCIADO_ERROR_GENERICO = 'Encuentra el dato erróneo en la tarjeta.';

/** Bloque de enunciado (spec v0.1c §4.1 punto 2): en "error" incluye además el
 * título de la tarjeta antes del enunciado/instrucción. Un solo `<p class="enunciado">`
 * en el resto de tipos. */
function construirBloqueEnunciado(pregunta) {
  const frag = document.createDocumentFragment();
  if (pregunta.tipo === 'error') {
    const titulo = document.createElement('p');
    titulo.className = 'titulo-tarjeta';
    titulo.textContent = pregunta.tarjeta.titulo;
    frag.appendChild(titulo);
  }
  const enunciado = document.createElement('p');
  if (pregunta.tipo === 'error' && pregunta.enunciado === ENUNCIADO_ERROR_GENERICO) {
    enunciado.className = 'instruccion-error';
    enunciado.textContent = 'Toca la fila que está mal';
  } else if (pregunta.tipo === 'ordenar') {
    enunciado.className = 'enunciado';
    // El banco suele traer ya la instrucción completa ("Ordena estos…"): no duplicarla.
    enunciado.textContent = /^ordena/i.test(pregunta.enunciado.trim())
      ? pregunta.enunciado
      : `Ordena ${pregunta.criterio}: ${pregunta.enunciado}`;
  } else {
    enunciado.className = 'enunciado';
    enunciado.textContent = pregunta.enunciado;
  }
  frag.appendChild(enunciado);
  return frag;
}

/** Enunciado recortado a 5 líneas (CSS): un toque lo expande. stopPropagation
 * evita que el toque se propague al gesto de arrastre del mazo. */
function activarToqueEnunciado(tarjeta) {
  const enunciadoEl = tarjeta.querySelector('.enunciado');
  if (!enunciadoEl) return;
  enunciadoEl.addEventListener('click', (ev) => {
    ev.stopPropagation();
    enunciadoEl.classList.toggle('enunciado--expandido');
    ajustarEncaje(tarjeta);
  });
}

/** Fila de confianza (spec v0.1c §2.3): clonada de la plantilla, con su propio
 * segmentado. Antes de responder cambia hueco.confianza sin más; después de
 * responder, cada cambio recorrige la respuesta ya registrada vía
 * cambiarConfianza() del motor. */
function construirFilaConfianza(hueco) {
  const nodo = plantillaConfianza.content.firstElementChild.cloneNode(true);
  const opciones = {
    baja: nodo.querySelector('[data-test="confianza-baja"]'),
    media: nodo.querySelector('[data-test="confianza-media"]'),
    alta: nodo.querySelector('[data-test="confianza-alta"]'),
  };
  function pintar(valor) {
    for (const [clave, boton] of Object.entries(opciones)) {
      const activo = clave === valor;
      boton.classList.toggle('confianza-opcion--activa', activo);
      boton.setAttribute('aria-pressed', String(activo));
    }
  }
  pintar(hueco.confianza);
  for (const [clave, boton] of Object.entries(opciones)) {
    boton.addEventListener('click', () => manejarClicConfianza(hueco, clave, pintar));
  }
  return nodo;
}

function manejarClicConfianza(hueco, valor, pintarLocal) {
  hueco.confianza = valor;
  pintarLocal(valor);
  if (!hueco.respondida) return;
  if (valor === hueco.delta.confianza) return; // sin cambios reales
  const resultado = cambiarConfianza(estado, hueco.pregunta, hueco.delta, valor, hoy());
  estado = resultado.estado;
  guardarEstado(estado);
  hueco.delta = resultado.delta;
  actualizarCabecera();
  if (hueco.nodo) {
    const feedbackNodo = hueco.nodo.querySelector('.feedback');
    if (feedbackNodo) pintarFeedback(feedbackNodo, hueco.pregunta, hueco.correcta, hueco.delta);
    ajustarEncaje(hueco.nodo);
  }
}

// --- tarjeta SIN responder (por tipo) ---

function construirZonaRespuesta(hueco) {
  const pregunta = hueco.pregunta;
  const contenedor = document.createElement('div');
  contenedor.className = 'zona-respuesta';
  switch (pregunta.tipo) {
    case 'vf':
      // Nada aquí (spec v0.1c §4.1 punto 4): la pista de deslizamiento vive
      // junto a FALSO/VERDADERO, en la zona de acción anclada abajo, para que
      // el hueco vacío del medio no quede aislado del control que describe.
      break;
    case 'test4':
      contenedor.appendChild(construirOpcionesTest4(hueco));
      break;
    case 'ordenar':
      contenedor.appendChild(construirItemsOrdenar(hueco));
      break;
    case 'error':
      contenedor.appendChild(construirFilasError(hueco));
      break;
    default:
      throw new Error(`Tipo de pregunta desconocido: ${pregunta.tipo}`);
  }
  return contenedor;
}

function construirOpcionesTest4(hueco) {
  const opciones = document.createElement('div');
  opciones.className = 'opciones';
  hueco.pregunta.opciones.forEach((texto, i) => {
    const boton = document.createElement('button');
    boton.dataset.test = `opcion-${i}`;
    boton.textContent = texto;
    boton.addEventListener('click', () => manejarRespuesta(hueco, i));
    opciones.appendChild(boton);
  });
  return opciones;
}

function barajar(indices) {
  const copia = [...indices];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function construirItemsOrdenar(hueco) {
  const pregunta = hueco.pregunta;
  const contenedorItems = document.createElement('div');
  contenedorItems.className = 'items';

  const ordenMostrado = barajar(pregunta.items.map((_, i) => i));
  const seleccion = []; // índices originales, en el orden en que se han tocado

  const botones = ordenMostrado.map((indiceOriginal) => {
    const boton = document.createElement('button');
    boton.dataset.original = String(indiceOriginal);

    const texto = document.createElement('span');
    texto.textContent = pregunta.items[indiceOriginal];

    const numero = document.createElement('span');
    numero.className = 'numero';
    numero.hidden = true;

    boton.appendChild(texto);
    boton.appendChild(numero);
    contenedorItems.appendChild(boton);
    return boton;
  });

  // El e2e clica por índice de posición mostrada (data-test="item-N"): se
  // asigna tras barajar, en el orden en que quedan los botones en el DOM.
  botones.forEach((boton, posicion) => {
    boton.dataset.test = `item-${posicion}`;
  });

  function renumerar() {
    botones.forEach((boton) => {
      const original = Number(boton.dataset.original);
      const pos = seleccion.indexOf(original);
      const numero = boton.querySelector('.numero');
      if (pos === -1) {
        numero.hidden = true;
        boton.classList.remove('seleccionado');
      } else {
        numero.hidden = false;
        numero.textContent = String(pos + 1);
        boton.classList.add('seleccionado');
      }
    });
  }

  botones.forEach((boton) => {
    boton.addEventListener('click', () => {
      const original = Number(boton.dataset.original);
      const pos = seleccion.indexOf(original);
      if (pos !== -1) {
        // Tocar una tarjeta ya numerada la deshace.
        seleccion.splice(pos, 1);
        renumerar();
        return;
      }
      seleccion.push(original);
      renumerar();
      if (seleccion.length === pregunta.items.length) {
        manejarRespuesta(hueco, [...seleccion]);
      }
    });
  });

  return contenedorItems;
}

function construirFilasError(hueco) {
  const pregunta = hueco.pregunta;
  const filas = document.createElement('div');
  filas.className = 'filas';
  pregunta.tarjeta.filas.forEach((fila, i) => {
    const boton = document.createElement('button');
    boton.dataset.test = `fila-${i}`;

    const etiqueta = document.createElement('span');
    etiqueta.className = 'fila-etiqueta';
    etiqueta.textContent = fila.etiqueta;

    const valor = document.createElement('span');
    valor.className = 'fila-valor';
    valor.textContent = fila.valor;

    boton.appendChild(etiqueta);
    boton.appendChild(valor);
    boton.addEventListener('click', () => manejarRespuesta(hueco, i));
    filas.appendChild(boton);
  });
  return filas;
}

function construirBotonesVf(hueco) {
  const contenedor = document.createElement('div');
  contenedor.className = 'botones-vf';

  const falso = document.createElement('button');
  falso.className = 'boton-ko';
  falso.dataset.test = 'vf-falso';
  falso.textContent = 'FALSO';
  falso.addEventListener('click', () => manejarRespuesta(hueco, false));

  const verdadero = document.createElement('button');
  verdadero.className = 'boton-ok';
  verdadero.dataset.test = 'vf-verdadero';
  verdadero.textContent = 'VERDADERO';
  verdadero.addEventListener('click', () => manejarRespuesta(hueco, true));

  contenedor.appendChild(falso);
  contenedor.appendChild(verdadero);
  return contenedor;
}

// Pista de deslizamiento horizontal (vf): los chevrones se quedan siempre; el
// texto se acorta a "‹ Falso · Verdadero ›" (spec v0.1c §2.2) y solo se ve las
// primeras 5 preguntas vf del dispositivo (contador propio, sin tocar).
const CLAVE_PISTA_SWIPE_VF = 'one.pistaSwipe';
const LIMITE_PISTA_SWIPE_VF = 5;

function contarPistaSwipeVfMostrada() {
  try {
    return Number(localStorage.getItem(CLAVE_PISTA_SWIPE_VF)) || 0;
  } catch (err) {
    return 0;
  }
}

function registrarPistaSwipeVfMostrada(veces) {
  try {
    localStorage.setItem(CLAVE_PISTA_SWIPE_VF, String(veces));
  } catch (err) {
    // Sin contador persistente: la pista se ve siempre (mejor de más que de menos).
  }
}

function construirPistaSwipeVf() {
  const vecesMostrada = contarPistaSwipeVfMostrada();
  const pista = document.createElement('div');
  pista.className = 'pista-swipe';
  pista.dataset.test = 'pista-swipe';

  const chevronIzq = document.createElement('span');
  chevronIzq.className = 'pista-swipe-chevron pista-swipe-chevron--izq';
  chevronIzq.textContent = '‹';
  chevronIzq.setAttribute('aria-hidden', 'true');

  const textoPista = document.createElement('span');
  textoPista.className = 'pista-swipe-texto';
  textoPista.textContent = 'Falso · Verdadero';
  textoPista.hidden = vecesMostrada >= LIMITE_PISTA_SWIPE_VF;

  const chevronDer = document.createElement('span');
  chevronDer.className = 'pista-swipe-chevron pista-swipe-chevron--der';
  chevronDer.textContent = '›';
  chevronDer.setAttribute('aria-hidden', 'true');

  pista.appendChild(chevronIzq);
  pista.appendChild(textoPista);
  pista.appendChild(chevronDer);
  registrarPistaSwipeVfMostrada(vecesMostrada + 1);
  return pista;
}

/** Swipe horizontal de vf (spec v0.1c §2.2: "las tarjetas vf conservan su swipe
 * horizontal"). Comparte tarjeta con el gesto vertical del mazo: cada uno solo
 * captura el puntero cuando su eje domina, así se dejan paso sin pisarse. */
function activarSwipeVf(tarjeta, hueco) {
  const UMBRAL = 60;
  const ARRANQUE = 8;
  let activo = false;
  let inicioX = 0;
  let inicioY = 0;
  let deltaX = 0;
  let capturado = false;

  const chevronIzq = tarjeta.querySelector('.pista-swipe-chevron--izq');
  const chevronDer = tarjeta.querySelector('.pista-swipe-chevron--der');

  function tenirChevrones(delta) {
    if (!chevronIzq || !chevronDer) return;
    chevronIzq.classList.toggle('pista-swipe-chevron--ko', delta < 0);
    chevronDer.classList.toggle('pista-swipe-chevron--ok', delta > 0);
  }

  tarjeta.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button')) return;
    activo = true;
    capturado = false;
    inicioX = ev.clientX;
    inicioY = ev.clientY;
    deltaX = 0;
  });

  tarjeta.addEventListener('pointermove', (ev) => {
    if (!activo) return;
    deltaX = ev.clientX - inicioX;
    const deltaY = ev.clientY - inicioY;
    if (!capturado) {
      // Solo se captura cuando el arrastre es horizontal Y ya supera el arranque:
      // un gesto vertical (el del mazo) o un tap simple nunca lo secuestran.
      if (Math.abs(deltaX) > ARRANQUE && Math.abs(deltaX) > Math.abs(deltaY)) {
        capturado = true;
        tarjeta.setPointerCapture(ev.pointerId);
      } else {
        return;
      }
    }
    tarjeta.style.transform = `translateX(${deltaX}px)`;
    tenirChevrones(deltaX);
  });

  function soltar() {
    if (!activo) return;
    activo = false;
    tarjeta.style.transform = '';
    tenirChevrones(0);
    if (capturado) {
      if (deltaX >= UMBRAL) manejarRespuesta(hueco, true);
      else if (deltaX <= -UMBRAL) manejarRespuesta(hueco, false);
    }
    deltaX = 0;
    capturado = false;
  }

  tarjeta.addEventListener('pointerup', soltar);
  tarjeta.addEventListener('pointercancel', soltar);
}

/** Tarjeta de un hueco todavía sin responder: cabecera, enunciado, confianza
 * (opcional, Media por defecto), zona de respuesta según tipo y, en vf, los
 * botones FALSO/VERDADERO anclados abajo. */
function construirTarjetaSinResponder(hueco) {
  const pregunta = hueco.pregunta;
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta';
  tarjeta.dataset.test = 'tarjeta';
  tarjeta.dataset.respondida = 'false';

  tarjeta.appendChild(construirCabeceraPregunta(pregunta));
  tarjeta.appendChild(construirBloqueEnunciado(pregunta));
  tarjeta.appendChild(construirFilaConfianza(hueco));
  tarjeta.appendChild(construirZonaRespuesta(hueco));

  const zonaAccion = document.createElement('div');
  zonaAccion.className = 'tarjeta-accion';
  if (pregunta.tipo === 'vf') {
    zonaAccion.appendChild(construirPistaSwipeVf());
    zonaAccion.appendChild(construirBotonesVf(hueco));
  }
  tarjeta.appendChild(zonaAccion);

  if (pregunta.tipo === 'vf') activarSwipeVf(tarjeta, hueco);
  activarToqueEnunciado(tarjeta);

  return tarjeta;
}

// --- tarjeta YA respondida (reutilizable por el repaso, Task 3) ---

/** Respuesta ya fija en su forma compacta (spec v0.1c §4.1 punto 4): vf una
 * línea; test4/error la fila correcta con ✓ y, si falló, la suya tachada
 * encima; ordenar la lista completa numerada con ✓/✗ por posición. */
function construirRespuestaCompacta(pregunta, hueco) {
  const contenedor = document.createElement('div');
  contenedor.className = 'respuesta-compacta';
  switch (pregunta.tipo) {
    case 'vf': {
      const linea = document.createElement('p');
      linea.className = 'respuesta-compacta-linea';
      linea.textContent = hueco.correcta
        ? `Tu respuesta: ${hueco.respuesta ? 'Verdadero' : 'Falso'} ✓`
        : `✗ · Era ${pregunta.respuesta ? 'Verdadero' : 'Falso'}`;
      linea.classList.add(hueco.correcta ? 'respuesta-compacta-linea--ok' : 'respuesta-compacta-linea--tachada');
      contenedor.appendChild(linea);
      break;
    }
    case 'test4': {
      if (!hueco.correcta) {
        const tuya = document.createElement('p');
        tuya.className = 'respuesta-compacta-linea respuesta-compacta-linea--tachada';
        tuya.textContent = `${pregunta.opciones[hueco.respuesta]} ✗`;
        contenedor.appendChild(tuya);
      }
      const correcta = document.createElement('p');
      correcta.className = 'respuesta-compacta-linea respuesta-compacta-linea--ok';
      correcta.textContent = `${pregunta.opciones[pregunta.correcta]} ✓`;
      contenedor.appendChild(correcta);
      break;
    }
    case 'error': {
      if (!hueco.correcta) {
        const tuya = document.createElement('p');
        tuya.className = 'respuesta-compacta-linea respuesta-compacta-linea--tachada';
        tuya.textContent = `${pregunta.tarjeta.filas[hueco.respuesta].etiqueta} ✗`;
        contenedor.appendChild(tuya);
      }
      const correcta = document.createElement('p');
      correcta.className = 'respuesta-compacta-linea respuesta-compacta-linea--ok';
      correcta.textContent = `${pregunta.tarjeta.filas[pregunta.sospechoso].etiqueta} ✓`;
      contenedor.appendChild(correcta);
      break;
    }
    case 'ordenar': {
      const lista = document.createElement('ol');
      lista.className = 'respuesta-compacta-orden';
      const respuestaUsuario = Array.isArray(hueco.respuesta) ? hueco.respuesta : [];
      pregunta.items.forEach((texto, posicion) => {
        const li = document.createElement('li');
        const marca = respuestaUsuario[posicion] === posicion ? '✓' : '✗';
        li.textContent = `${texto} ${marca}`;
        lista.appendChild(li);
      });
      contenedor.appendChild(lista);
      break;
    }
    default:
      break;
  }
  return contenedor;
}

/** Resumen a una sola línea de la respuesta (tarjeta--compacta-1, spec v0.1c
 * §4.2): siempre la respuesta CORRECTA (no la del jugador), para que quepa en
 * una línea sea cual sea el resultado. */
function construirResumenRespuesta(pregunta) {
  const p = document.createElement('p');
  p.className = 'respuesta-resumen';
  switch (pregunta.tipo) {
    case 'vf':
      p.textContent = `Respuesta: ${pregunta.respuesta ? 'Verdadero' : 'Falso'}`;
      break;
    case 'test4':
      p.textContent = `Respuesta: ${pregunta.opciones[pregunta.correcta]}`;
      break;
    case 'error':
      p.textContent = `Respuesta: ${pregunta.tarjeta.filas[pregunta.sospechoso].etiqueta}`;
      break;
    case 'ordenar':
      p.textContent = `Orden: ${pregunta.items.join(' › ')}`;
      break;
    default:
      break;
  }
  return p;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** 'YYYY-MM-DD' -> "9 sep" (sin ceros a la izquierda), para el chip de Recuperada. */
function formatearFechaCorta(fechaISO) {
  if (!fechaISO) return '';
  const [, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia} ${MESES_CORTOS[mes - 1]}`;
}

/** Respuesta correcta como texto (para el carrusel "Para repasar" del resumen). */
function respuestaCorrectaTexto(pregunta) {
  switch (pregunta.tipo) {
    case 'vf':
      return pregunta.respuesta ? 'Verdadero' : 'Falso';
    case 'test4':
      return pregunta.opciones[pregunta.correcta];
    case 'ordenar':
      return pregunta.items.join(' → ');
    case 'error':
      return pregunta.tarjeta.filas[pregunta.sospechoso].etiqueta;
    default:
      return '';
  }
}

/** Construye (o repinta, si se le pasa un nodo ya existente) el bloque de
 * resultado + chips: resultado ("✓ +N XP" / "✗ Incorrecto"), combo, cambio de
 * nivel, chips (Recuperada/Estabas seguro/Misión completada/Frágil). */
function pintarFeedback(feedbackNodo, pregunta, correcta, delta) {
  const feedbackTexto = feedbackNodo.querySelector('[data-test="feedback-texto"]');
  let texto = correcta ? `✓ +${delta.xp} XP` : '✗ Incorrecto';
  if (correcta && delta.confianza === 'alta') texto += ' · confianza alta ×1,5';
  feedbackTexto.textContent = texto;
  feedbackTexto.classList.toggle('feedback-texto--ok', correcta);
  feedbackTexto.classList.toggle('feedback-texto--ko', !correcta);
  // Animación breve al (re)pintar (spec v0.1c §2.3: se nota al cambiar la confianza).
  feedbackTexto.classList.remove('feedback-texto--pulso');
  void feedbackTexto.offsetWidth;
  feedbackTexto.classList.add('feedback-texto--pulso');

  const combo = feedbackNodo.querySelector('[data-test="feedback-combo"]');
  combo.hidden = !(delta.combo >= 3);
  if (!combo.hidden) combo.textContent = `Combo ×${delta.combo}`;

  const cambioNivel = feedbackNodo.querySelector('[data-test="cambio-nivel"]');
  if (delta.cambioNivelPartida > 0) {
    cambioNivel.hidden = false;
    cambioNivel.textContent = `Nivel ${delta.nivelPartida} ↑`;
    cambioNivel.classList.remove('cambio-nivel-bajada');
    cambioNivel.classList.add('cambio-nivel-subida');
  } else if (delta.cambioNivelPartida < 0) {
    cambioNivel.hidden = false;
    cambioNivel.textContent = `Nivel ${delta.nivelPartida} ↓`;
    cambioNivel.classList.remove('cambio-nivel-subida');
    cambioNivel.classList.add('cambio-nivel-bajada');
  } else {
    cambioNivel.hidden = true;
  }

  const cambioNivelArea = feedbackNodo.querySelector('[data-test="cambio-nivel-area"]');
  if (delta.cambioNivelArea !== 0) {
    cambioNivelArea.hidden = false;
    const nombreAreaTexto = nombreArea(pregunta.area);
    cambioNivelArea.textContent = delta.cambioNivelArea > 0
      ? `${nombreAreaTexto} sube a nivel ${delta.nivelArea}`
      : `${nombreAreaTexto} baja a nivel ${delta.nivelArea}`;
  } else {
    cambioNivelArea.hidden = true;
  }

  const hayRecuperada = Boolean(delta.recuperada);
  const chipRecuperada = feedbackNodo.querySelector('[data-test="recuperada"]');
  chipRecuperada.hidden = !hayRecuperada;
  if (hayRecuperada) {
    chipRecuperada.textContent = `Recuperada · la fallaste el ${formatearFechaCorta(delta.recuperada.fechaFallo)}`;
  }
  feedbackNodo.querySelector('[data-test="confianza-alta-fallo"]').hidden = !(delta.confianza === 'alta' && !correcta);
  feedbackNodo.querySelector('[data-test="mision-completada"]').hidden = !delta.misionCompletada;
  feedbackNodo.querySelector('[data-test="fragil"]').hidden = !delta.fragil;
}

/** Esqueleto del bloque de feedback (resultado, chips, explicación): se pinta
 * una vez con pintarFeedback() y queda listo para repintarse tras un cambio de
 * confianza (manejarClicConfianza). */
function construirBloqueFeedback(pregunta, hueco) {
  const feedback = document.createElement('div');
  feedback.className = 'feedback';

  const feedbackTexto = document.createElement('p');
  feedbackTexto.className = 'feedback-texto';
  feedbackTexto.dataset.test = 'feedback-texto';
  feedback.appendChild(feedbackTexto);

  const combo = document.createElement('p');
  combo.className = 'feedback-combo';
  combo.dataset.test = 'feedback-combo';
  combo.hidden = true;
  feedback.appendChild(combo);

  const cambioNivel = document.createElement('p');
  cambioNivel.className = 'cambio-nivel';
  cambioNivel.dataset.test = 'cambio-nivel';
  cambioNivel.hidden = true;
  feedback.appendChild(cambioNivel);

  const cambioNivelArea = document.createElement('p');
  cambioNivelArea.className = 'cambio-nivel-area';
  cambioNivelArea.dataset.test = 'cambio-nivel-area';
  cambioNivelArea.hidden = true;
  feedback.appendChild(cambioNivelArea);

  const chips = document.createElement('div');
  chips.className = 'feedback-chips';
  const chipRecuperada = document.createElement('span');
  chipRecuperada.className = 'feedback-chip';
  chipRecuperada.dataset.test = 'recuperada';
  chipRecuperada.hidden = true;
  const chipAltaFallo = document.createElement('span');
  chipAltaFallo.className = 'feedback-chip';
  chipAltaFallo.dataset.test = 'confianza-alta-fallo';
  chipAltaFallo.textContent = 'Estabas seguro → Pendientes';
  chipAltaFallo.hidden = true;
  const chipMision = document.createElement('span');
  chipMision.className = 'feedback-chip';
  chipMision.dataset.test = 'mision-completada';
  chipMision.textContent = 'Misión completada';
  chipMision.hidden = true;
  const chipFragil = document.createElement('span');
  chipFragil.className = 'feedback-chip';
  chipFragil.dataset.test = 'fragil';
  chipFragil.textContent = 'Frágil: volverá pronto';
  chipFragil.hidden = true;
  chips.append(chipRecuperada, chipAltaFallo, chipMision, chipFragil);
  feedback.appendChild(chips);

  const explicacion = document.createElement('p');
  explicacion.className = 'explicacion';
  explicacion.dataset.test = 'explicacion';
  explicacion.textContent = pregunta.explicacion;
  explicacion.addEventListener('click', (ev) => {
    const tarjeta = explicacion.closest('.tarjeta');
    if (!tarjeta || !tarjeta.classList.contains('tarjeta--compacta-2')) return;
    ev.stopPropagation();
    alternarEncaje(tarjeta, 'explicacion');
  });
  feedback.appendChild(explicacion);

  pintarFeedback(feedback, pregunta, hueco.correcta, hueco.delta);
  return feedback;
}

/**
 * Tarjeta de un hueco ya respondido (spec v0.1c, interfaz para Task 3/repaso):
 * cabecera, enunciado, confianza (activa, salvo soloLectura), respuesta
 * compacta + resumen a una línea (para tarjeta--compacta-1), feedback y, en la
 * zona de acción, el ancla "Preguntar a" (vacía: la rellena otra tarea) y,
 * salvo soloLectura, "esta pregunta está mal" + Siguiente.
 */
function construirTarjetaRespondida(pregunta, hueco, { soloLectura = false } = {}) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta';
  tarjeta.dataset.test = 'tarjeta';
  tarjeta.dataset.respondida = 'true';
  tarjeta.classList.add(hueco.correcta ? 'correcto' : 'incorrecto');

  tarjeta.appendChild(construirCabeceraPregunta(pregunta));
  tarjeta.appendChild(construirBloqueEnunciado(pregunta));
  if (!soloLectura) tarjeta.appendChild(construirFilaConfianza(hueco));

  const zonaRespuesta = document.createElement('div');
  zonaRespuesta.className = 'zona-respuesta';
  const respuestaCompacta = construirRespuestaCompacta(pregunta, hueco);
  const resumenRespuesta = construirResumenRespuesta(pregunta);
  resumenRespuesta.addEventListener('click', (ev) => {
    if (!tarjeta.classList.contains('tarjeta--compacta-1')) return;
    ev.stopPropagation();
    alternarEncaje(tarjeta, 'respuesta');
  });
  respuestaCompacta.addEventListener('click', (ev) => {
    if (tarjeta.dataset.expandido !== 'respuesta') return;
    ev.stopPropagation();
    alternarEncaje(tarjeta, 'respuesta');
  });
  zonaRespuesta.appendChild(respuestaCompacta);
  zonaRespuesta.appendChild(resumenRespuesta);
  tarjeta.appendChild(zonaRespuesta);

  tarjeta.appendChild(construirBloqueFeedback(pregunta, hueco));

  const zonaAccion = document.createElement('div');
  zonaAccion.className = 'tarjeta-accion';
  const anclaPreguntarA = document.createElement('div');
  anclaPreguntarA.dataset.test = 'preguntar-a';
  zonaAccion.appendChild(anclaPreguntarA);

  if (!soloLectura) {
    const reportadaTexto = document.createElement('p');
    reportadaTexto.className = 'reportada';
    reportadaTexto.textContent = 'Anotado';
    reportadaTexto.hidden = !hueco.reportada;
    zonaAccion.appendChild(reportadaTexto);

    const filaEstaMal = document.createElement('div');
    filaEstaMal.className = 'fila-esta-mal';
    const botonEstaMal = document.createElement('button');
    botonEstaMal.className = 'enlace-discreto';
    botonEstaMal.dataset.test = 'esta-mal';
    botonEstaMal.textContent = 'esta pregunta está mal';
    botonEstaMal.addEventListener('click', () => manejarClicEstaMal(hueco));
    filaEstaMal.appendChild(botonEstaMal);
    zonaAccion.appendChild(filaEstaMal);

    const botonSiguiente = document.createElement('button');
    botonSiguiente.className = 'boton boton-principal';
    botonSiguiente.dataset.test = 'siguiente';
    botonSiguiente.textContent = 'Siguiente';
    botonSiguiente.addEventListener('click', irASiguienteHueco);
    zonaAccion.appendChild(botonSiguiente);
  }
  tarjeta.appendChild(zonaAccion);

  activarToqueEnunciado(tarjeta);
  return tarjeta;
}

function manejarClicEstaMal(hueco) {
  if (hueco.reportada) return;
  if (!estado.reportadas.includes(hueco.pregunta.id)) {
    estado = { ...estado, reportadas: [...estado.reportadas, hueco.pregunta.id] };
    guardarEstado(estado);
  }
  hueco.reportada = true;
  const reportadaTexto = hueco.nodo && hueco.nodo.querySelector('.reportada');
  if (reportadaTexto) reportadaTexto.hidden = false;
}

/** Tarjeta de cierre (spec v0.1c §2.4): aparece al deslizar más allá del último
 * hueco cuando ya hay N_PARTIDA (o el banco se agotó antes) y quedan sin
 * responder. "Volver a ellas" salta al primer hueco pendiente; "Terminar
 * igual" cierra la partida (las no respondidas no cuentan). */
function construirTarjetaCierre() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta tarjeta-cierre';
  tarjeta.dataset.test = 'mazo-cierre';

  const pendientesN = mazo.filter((h) => !h.respondida).length;
  const titulo = document.createElement('p');
  titulo.className = 'mazo-cierre-titulo';
  titulo.textContent = `Quedan ${pendientesN} sin responder`;
  tarjeta.appendChild(titulo);

  const acciones = document.createElement('div');
  acciones.className = 'mazo-cierre-acciones';

  const volver = document.createElement('button');
  volver.className = 'boton boton-principal';
  volver.dataset.test = 'volver-pendientes';
  volver.textContent = 'Volver a ellas';
  volver.addEventListener('click', () => {
    const indicePendiente = mazo.findIndex((h) => !h.respondida);
    if (indicePendiente !== -1) mazoControlador.irA(indicePendiente);
  });

  const terminar = document.createElement('button');
  terminar.className = 'boton';
  terminar.dataset.test = 'terminar-igual';
  terminar.textContent = 'Terminar igual';
  terminar.addEventListener('click', finalizarPartida);

  acciones.appendChild(volver);
  acciones.appendChild(terminar);
  tarjeta.appendChild(acciones);

  return tarjeta;
}

/** Responde el hueco (cualquier tipo): evalúa, registra en el motor, reconstruye
 * su tarjeta ya en estado respondida y la deja lista en el mazo. */
function manejarRespuesta(hueco, respuesta) {
  if (hueco.respondida) return; // guarda contra doble tap / doble evento
  const pregunta = hueco.pregunta;
  const correcta = evaluar(pregunta, respuesta);
  const resultado = registrarRespuesta(estado, pregunta, correcta, hoy(), { confianza: hueco.confianza });
  estado = resultado.estado;
  guardarEstado(estado);
  actualizarCabecera(); // el "Nivel N" de la cabecera se ve moverse en vivo.

  hueco.respondida = true;
  hueco.respuesta = respuesta;
  hueco.correcta = correcta;
  hueco.delta = resultado.delta;
  hueco.nodo = construirTarjetaRespondida(pregunta, hueco, { soloLectura: false });

  mazoControlador.actualizarTarjetas(listaActual());
  actualizarBarraProgreso();
  asegurarSiguienteDisponible();
}

/** Cuenta 0 -> valor en ~600ms (aciertos y XP del resumen). Con "reducir
 * movimiento" activo pinta el valor final directamente, sin animar. */
function animarConteo(nodo, prefijo, valorFinal, sufijo = '') {
  const prefiereMenosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefiereMenosMovimiento || valorFinal === 0) {
    nodo.textContent = `${prefijo}${valorFinal}${sufijo}`;
    return;
  }
  const duracion = 600;
  const inicio = performance.now();
  function paso(ahora) {
    const t = Math.min(1, (ahora - inicio) / duracion);
    nodo.textContent = `${prefijo}${Math.round(valorFinal * t)}${sufijo}`;
    if (t < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

// El fondo del inicio respira en bucle: se pausa cuando la app no está visible para
// no gastar batería (hallazgo bajo de la pasada adversarial).
document.addEventListener('visibilitychange', () => {
  for (const luz of document.querySelectorAll('.fondo-luz')) {
    luz.style.animationPlayState = document.hidden ? 'paused' : 'running';
  }
});

/** "Para repasar" del resumen: un carrusel horizontal (scroll-snap) con una
 * tarjeta por pregunta fallada o acertada con confianza Baja de la partida que
 * acaba de terminar, en orden de aparición. Sin nada que repasar, el mensaje
 * vacío ("Sin fallos. Nada que repasar."). (Sustituido por un mazo vertical de
 * solo lectura en la siguiente tarea, spec v0.1c §6; de momento se deja igual.) */
function renderRepaso() {
  repasoCarrusel.innerHTML = '';
  repasoPuntos.innerHTML = '';

  const vacio = repasoPartida.length === 0;
  repasoVacio.hidden = !vacio;
  repasoCarrusel.hidden = vacio;
  repasoPuntos.hidden = vacio;
  if (vacio) return;

  repasoPartida.forEach((item) => {
    const { pregunta, correcta } = item;

    const tarjetaRepaso = document.createElement('div');
    tarjetaRepaso.className = 'resumen-repaso-tarjeta';

    const marca = document.createElement('p');
    marca.className = `resumen-repaso-marca ${correcta ? 'resumen-repaso-marca--fragil' : 'resumen-repaso-marca--fallo'}`;
    marca.textContent = correcta ? '✓ frágil' : '✗';

    const enunciado = document.createElement('p');
    enunciado.className = 'resumen-repaso-enunciado';
    enunciado.textContent = pregunta.enunciado;

    const respuesta = document.createElement('p');
    respuesta.className = 'resumen-repaso-respuesta';
    respuesta.textContent = respuestaCorrectaTexto(pregunta);

    const explicacionRepaso = document.createElement('p');
    explicacionRepaso.className = 'resumen-repaso-explicacion';
    explicacionRepaso.textContent = pregunta.explicacion;

    tarjetaRepaso.appendChild(marca);
    tarjetaRepaso.appendChild(enunciado);
    tarjetaRepaso.appendChild(respuesta);
    tarjetaRepaso.appendChild(explicacionRepaso);
    repasoCarrusel.appendChild(tarjetaRepaso);

    const punto = document.createElement('span');
    punto.className = 'resumen-repaso-punto';
    repasoPuntos.appendChild(punto);
  });
  sincronizarPuntosRepaso();
}

/** Marca el punto del carrusel que corresponde a la tarjeta visible (hallazgo de la
 * pasada adversarial del 12-sep: los puntos se pintaban pero nunca cambiaban). */
function sincronizarPuntosRepaso() {
  const puntos = repasoPuntos.children;
  if (puntos.length === 0) return;
  const ancho = repasoCarrusel.firstElementChild ? repasoCarrusel.firstElementChild.offsetWidth + 10 : 1;
  const indice = Math.min(puntos.length - 1, Math.max(0, Math.round(repasoCarrusel.scrollLeft / ancho)));
  for (let i = 0; i < puntos.length; i++) puntos[i].classList.toggle('resumen-repaso-punto--activo', i === indice);
}
repasoCarrusel.addEventListener('scroll', sincronizarPuntosRepaso, { passive: true });

/** El HUB: radar de las 8 áreas, KPIs, Misión de hoy + Pendientes, "Comenzar" y
 * la cuadrícula 4×2 de áreas (una tarjeta tocable por área, con emoji, nota,
 * barra fina de puntuación y "S · R"). Al entrar se genera (o recupera) la
 * misión de hoy: `misionDelDia` es idempotente el mismo día. */
function renderHub() {
  const resultadoMision = misionDelDia(estado, banco, hoy());
  estado = resultadoMision.estado;
  guardarEstado(estado);

  const resumen = resumenProgreso(estado, banco, hoy());
  actualizarCabecera();

  renderRadar(resumen.porArea);

  // El 🔥 ya está en la cabecera: la fila KPI no lo repite (spec "pantalla
  // completa" 12-sep).
  nodoKpiAciertosHoy.textContent = `Hoy: ${resumen.hoy.aciertos}/${resumen.hoy.respondidas}`;
  nodoRecuperadas.textContent = `Recuperadas ${resumen.recuperadas}`;
  if (resumen.confianza.calibracion === null) {
    nodoCalibracion.hidden = true;
  } else {
    nodoCalibracion.hidden = false;
    nodoCalibracion.textContent = `Confianza ${Math.round(resumen.confianza.calibracion * 100)}%`;
  }

  actualizarDestacados(resumen);

  progresoAreas.innerHTML = '';
  resumen.porArea.forEach((fila) => {
    const tarjeta = document.createElement('button');
    tarjeta.className = 'tarjeta-area';
    tarjeta.dataset.test = `practicar-${fila.area}`;
    tarjeta.disabled = fila.total === 0;

    const cabeceraTarjeta = document.createElement('div');
    cabeceraTarjeta.className = 'tarjeta-area-cabecera';

    const emoji = document.createElement('span');
    emoji.className = 'tarjeta-area-emoji';
    emoji.textContent = EMOJI_AREA[fila.area] || '❔';

    const nota = document.createElement('span');
    nota.className = `tarjeta-area-nota ${claseNota(fila.nota)}`;
    nota.dataset.test = `nota-${fila.area}`;
    nota.textContent = fila.nota;

    cabeceraTarjeta.appendChild(emoji);
    cabeceraTarjeta.appendChild(nota);

    const nombre = document.createElement('span');
    nombre.className = 'tarjeta-area-nombre';
    nombre.textContent = nombreArea(fila.area);

    const track = document.createElement('div');
    track.className = 'tarjeta-area-track';
    const relleno = document.createElement('div');
    relleno.className = 'tarjeta-area-relleno';
    relleno.dataset.test = `barra-${fila.area}`;
    relleno.style.width = `${fila.puntuacion * 100}%`;
    track.appendChild(relleno);

    const solido = document.createElement('span');
    solido.className = 'tarjeta-area-solido';
    solido.dataset.test = `solido-${fila.area}`;
    solido.textContent = `S ${fila.solidas} · R ${fila.recientes}`;

    // Tocar la tarjeta entera arranca una partida SOLO de esa área (como un nivel
    // de videojuego): nada de un botón "Practicar" aparte.
    tarjeta.addEventListener('click', () => empezarPartida({ area: fila.area }));

    tarjeta.appendChild(cabeceraTarjeta);
    tarjeta.appendChild(nombre);
    tarjeta.appendChild(track);
    tarjeta.appendChild(solido);
    progresoAreas.appendChild(tarjeta);
  });
}

/** Pinta las dos tarjetas destacadas del hub (Misión de hoy y Pendientes):
 * texto, y si son tocables (aria-disabled + dataset.tocable cuando no). */
function actualizarDestacados(resumen) {
  const mision = estado.mision;
  if (!mision || mision.ids.length === 0) {
    nodoMision.textContent = 'Misión de hoy · —';
    marcarNoTocable(nodoMision);
  } else if (mision.completada) {
    nodoMision.textContent = 'Misión de hoy ✓';
    marcarNoTocable(nodoMision);
  } else {
    const areasUnicas = [];
    for (const id of mision.ids) {
      const pregunta = bancoPorId.get(id);
      const nombre = pregunta ? nombreArea(pregunta.area) : null;
      if (nombre && !areasUnicas.includes(nombre)) areasUnicas.push(nombre);
    }
    nodoMision.textContent = `Misión de hoy · ${areasUnicas.join(' y ')} · ${mision.hechas.length}/${mision.ids.length}`;
    marcarTocable(nodoMision);
  }

  const nPendientes = resumen.pendientes;
  nodoPendientes.textContent = `Pendientes · ${nPendientes}`;
  if (nPendientes === 0) marcarNoTocable(nodoPendientes);
  else marcarTocable(nodoPendientes);
}

function marcarTocable(nodo) {
  nodo.classList.remove('hub-destacado--inactivo');
  nodo.setAttribute('aria-disabled', 'false');
  nodo.dataset.tocable = 'true';
}

function marcarNoTocable(nodo) {
  nodo.classList.add('hub-destacado--inactivo');
  nodo.setAttribute('aria-disabled', 'true');
  nodo.dataset.tocable = 'false';
}

function exportarEstado() {
  const json = exportar(estado);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `one-estado-${hoy()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importarEstadoDesdeArchivo(archivo) {
  const lector = new FileReader();
  lector.onload = () => {
    try {
      estado = importar(String(lector.result));
      guardarEstado(estado);
      renderHub();
    } catch (err) {
      console.error('No se pudo importar el estado:', err.message);
    }
  };
  lector.readAsText(archivo);
}

// --- eventos de navegación ---
// "Comenzar" (en el HUB) siempre arranca sin filtro (aunque quedara uno de una
// práctica anterior sin limpiar); "Otra" en el resumen SÍ respeta el filtro
// vigente, para poder repetir la misma área varias veces seguidas.
document.querySelector('[data-test="comenzar"]').addEventListener('click', () => empezarPartida(null));
// 🧠 lleva siempre al HUB (con los datos recién pintados); 💪 solo avisa.
document.querySelector('[data-test="cerebro"]').addEventListener('click', irAlHub);
botonCuerpo.addEventListener('click', mostrarAvisoCuerpo);
// Misión de hoy / Pendientes: tocables solo cuando dataset.tocable === 'true'
// (ver actualizarDestacados). Partida cerrada a esos ids concretos, sin relleno.
nodoMision.addEventListener('click', () => {
  if (nodoMision.dataset.tocable !== 'true') return;
  const ids = estado.mision.ids.filter((id) => !estado.mision.hechas.includes(id));
  if (ids.length === 0) return; // nada que jugar: no arrancar una partida vacía (adversarial 12-sep)
  empezarPartida({ ids, etiqueta: 'Misión de hoy' });
});
nodoPendientes.addEventListener('click', () => {
  if (nodoPendientes.dataset.tocable !== 'true') return;
  const ids = pendientes(estado, banco).slice(0, 5).map((p) => p.id);
  if (ids.length === 0) return;
  empezarPartida({ ids, etiqueta: 'Pendientes' });
});
document.querySelector('[data-test="otra"]').addEventListener('click', () => empezarPartida(filtroPartida));
// "←" (cabecera): del HUB a inicio; de pregunta/resumen, siempre al HUB.
// "Inicio" (resumen): siempre al HUB, nunca a los emojis (ver manejarVolver/irAlHub).
document.querySelector('[data-test="volver"]').addEventListener('click', manejarVolver);
document.querySelector('[data-test="inicio"]').addEventListener('click', irAlHub);
document.querySelector('[data-test="exportar"]').addEventListener('click', exportarEstado);
importarArchivo.addEventListener('change', (ev) => {
  const archivo = ev.target.files && ev.target.files[0];
  if (archivo) importarEstadoDesdeArchivo(archivo);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Sin service worker el juego sigue funcionando, solo sin caché offline.
  });
}

iniciar();
