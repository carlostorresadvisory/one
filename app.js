// ONE · app.js — UI, gestos y máquina de vistas. Toda la lógica de juego vive en motor.js;
// este fichero solo pinta pantallas y traduce interacción del usuario en llamadas al motor.
import {
  crearEstado,
  siguientePregunta,
  registrarRespuesta,
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

// La partida ya no es una lista fija de 10 ids: se pide una pregunta a la vez a
// siguientePregunta() (escalera inmediata) hasta llegar a 10 o hasta que no quede
// ninguna elegible. `partidaUltima` es la última pregunta ya respondida, para que
// el motor pueda variar tipo/área; `partidaUsados` son los ids ya servidos hoy.
let preguntaEnPantalla = null;
let partidaUsados = new Set();
let partidaUltima = null;
let indicePartida = 0;
let xpPartida = 0;
let aciertosPartida = 0;
let areasPartida = new Set();
let reportadaEnActual = false;
// Nivel de confianza declarado en la pregunta actual (selector de 3 segmentos,
// "que se note" 12-sep): se reinicia a 'media' en cada pregunta.
let confianzaActual = 'media';
// Preguntas falladas o acertadas con confianza Baja ("frágil") de la partida en
// curso, en orden de aparición: alimentan el carrusel "Para repasar" del resumen.
let repasoPartida = [];
// Tras un acierto (no "no lo sé") la partida avanza sola a los ~1,4s; se guarda el
// id para poder cancelarlo si el jugador toca "Siguiente" o la tarjeta antes.
let avanceAutomaticoId = null;
// Solo true mientras hay un avance automático pendiente Y ya ha pasado un tick
// desde que se armó: así el click que ACABA de responder (que burbujea hasta
// contenedorPregunta en la misma fase de evento) nunca se confunde con un toque
// del jugador para adelantar el avance. Ver mostrarFeedback/limpiarAvanceAutomatico.
let puedeAdelantarConToque = false;

// Modo "practicar solo un área": null en partida normal; { area } cuando se entra
// desde Progreso pulsando "Practicar" en una fila. Se limpia al volver a inicio
// ("←" o "Inicio"); "Otra" en el resumen lo respeta para repetir el mismo filtro.
let filtroPartida = null;

// --- referencias a nodos ---
const nodoRacha = document.querySelector('[data-test="racha"]');
const nodoNivelPartida = document.querySelector('[data-test="nivel-partida"]');
const nodoVolver = document.querySelector('[data-test="volver"]');
const nodoModoArea = document.querySelector('[data-test="modo-area"]');
// Selector de confianza (sustituye a IDK): 3 segmentos + el contenedor que se
// oculta al responder.
const nodoConfianza = document.querySelector('[data-test="confianza"]');
const nodoConfianzaBaja = document.querySelector('[data-test="confianza-baja"]');
const nodoConfianzaMedia = document.querySelector('[data-test="confianza-media"]');
const nodoConfianzaAlta = document.querySelector('[data-test="confianza-alta"]');
// Chips de feedback compacto: cada uno se muestra solo si aplica (ver mostrarFeedback).
const chipRecuperada = document.getElementById('chip-recuperada');
const chipAltaFallo = document.getElementById('chip-alta-fallo');
const chipMisionCompletada = document.getElementById('chip-mision-completada');
const chipFragil = document.getElementById('chip-fragil');
// Espejos de racha/nivel en inicio: mismos datos que la cabecera, solo que "en
// grande" y visibles sin tener que fijarse en la esquina.
const nodoRachaInicio = document.querySelector('[data-test="racha-inicio"]');
const nodoNivelInicio = document.querySelector('[data-test="nivel-inicio"]');
const botonCuerpo = document.querySelector('[data-test="cuerpo"]');
const avisoCuerpo = document.getElementById('aviso-cuerpo');
// Radar del HUB (tipo Tekken 8: un eje por área) y los 3 KPI debajo.
const radarSvg = document.querySelector('[data-test="radar"]');
const radarVacio = document.getElementById('radar-vacio');
const nodoKpiRacha = document.querySelector('[data-test="kpi-racha"]');
const nodoKpiAciertosHoy = document.querySelector('[data-test="kpi-aciertos-hoy"]');
const nodoRecuperadas = document.querySelector('[data-test="recuperadas"]');
const nodoCalibracion = document.querySelector('[data-test="calibracion"]');
const nodoMision = document.querySelector('[data-test="mision"]');
const nodoPendientes = document.querySelector('[data-test="pendientes"]');
const vistas = document.querySelectorAll('[data-vista]');
const contenedorPregunta = document.getElementById('contenedor-pregunta');
const contenedorFeedback = document.getElementById('contenedor-feedback');
const barraProgresoRelleno = document.getElementById('barra-progreso-relleno');
const feedbackTexto = document.getElementById('feedback-texto');
const botonSiguiente = document.querySelector('[data-test="siguiente"]');
const feedbackCombo = document.getElementById('feedback-combo');
const cambioNivelTexto = document.getElementById('cambio-nivel-texto');
const cambioNivelAreaTexto = document.getElementById('cambio-nivel-area-texto');
const explicacionTexto = document.getElementById('explicacion-texto');
const reportadaTexto = document.getElementById('reportada-texto');
const resumenAciertos = document.getElementById('resumen-aciertos');
const resumenXp = document.getElementById('resumen-xp');
const resumenAreas = document.getElementById('resumen-areas');
const repasoCarrusel = document.getElementById('repaso-carrusel');
const repasoPuntos = document.getElementById('repaso-puntos');
const repasoVacio = document.getElementById('repaso-vacio');
const progresoAreas = document.getElementById('progreso-areas');
const importarArchivo = document.getElementById('importar-archivo');

function mostrarVista(nombre) {
  // Cambiar de vista (p. ej. "←" al hub durante el feedback) cancela cualquier avance
  // automático pendiente: si no, el temporizador dispararía irASiguiente() fuera de la
  // partida (hallazgo de la pasada adversarial del 12-sep).
  limpiarAvanceAutomatico();
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
        const fraccion = Math.max(0.04, Math.min(1, fila.solidez));
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
  preguntaEnPantalla = null;
  limpiarAvanceAutomatico();
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

// --- flujo de partida ---
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
  indicePartida = 0;
  xpPartida = 0;
  aciertosPartida = 0;
  areasPartida = new Set();
  repasoPartida = [];
  partidaUsados = new Set();
  partidaUltima = null;
  preguntaEnPantalla = null;
  actualizarCabecera(); // pinta "Solo <Área>" / "Misión de hoy" / "Pendientes" desde la primera pregunta.
  mostrarVista('pregunta');
  avanzarPregunta();
}

/** Pide la siguiente pregunta al motor (o termina la partida si no queda ninguna). */
function avanzarPregunta() {
  limpiarAvanceAutomatico(); // por si quedara uno pendiente (defensivo)
  if (indicePartida >= N_PARTIDA) {
    finalizarPartida();
    return;
  }
  const pregunta = siguientePregunta(estado, banco, hoy(), partidaUsados, Math.random, partidaUltima, filtroPartida);
  if (!pregunta) {
    // Banco agotado (reportadas/usadas incluidas): se termina con las que haya.
    finalizarPartida();
    return;
  }
  partidaUsados.add(pregunta.id);
  preguntaEnPantalla = pregunta;
  renderPreguntaActual(pregunta);
}

function construirCabeceraPregunta(pregunta) {
  const cabecera = document.createElement('p');
  cabecera.className = 'pregunta-cabecera';
  cabecera.dataset.test = 'nivel-pregunta';
  cabecera.textContent = `${nombreArea(pregunta.area)} · nivel ${pregunta.nivel}`;
  return cabecera;
}

function renderPreguntaActual(pregunta) {
  preguntaRespondida = false;

  barraProgresoRelleno.style.transform = `scaleX(${indicePartida / N_PARTIDA})`;
  contenedorFeedback.hidden = true;
  feedbackCombo.hidden = true;
  cambioNivelTexto.hidden = true;
  cambioNivelAreaTexto.hidden = true;
  explicacionTexto.hidden = true;
  reportadaTexto.hidden = true;
  reportadaEnActual = false;
  chipRecuperada.hidden = true;
  chipAltaFallo.hidden = true;
  chipMisionCompletada.hidden = true;
  chipFragil.hidden = true;

  // Selector de confianza: Media por defecto en cada pregunta, visible de nuevo.
  seleccionarConfianza('media');
  nodoConfianza.hidden = false;

  contenedorPregunta.innerHTML = '';
  const tarjeta = construirTarjetaPregunta(pregunta);
  tarjeta.insertBefore(construirCabeceraPregunta(pregunta), tarjeta.firstChild);
  contenedorPregunta.appendChild(tarjeta);

  // Enunciado recortado a 5 líneas (CSS): un toque lo expande. stopPropagation
  // evita que el toque también intente "adelantar" el avance automático tras acertar.
  const enunciadoEl = tarjeta.querySelector('.enunciado');
  if (enunciadoEl) {
    enunciadoEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      enunciadoEl.classList.toggle('enunciado--expandido');
    });
  }
}

/** Selecciona un segmento de confianza (Baja/Media/Alta): actualiza el estado
 * interno y el aria-pressed/clase visual de los 3 botones. */
function seleccionarConfianza(valor) {
  confianzaActual = valor;
  const nodos = { baja: nodoConfianzaBaja, media: nodoConfianzaMedia, alta: nodoConfianzaAlta };
  for (const [clave, nodo] of Object.entries(nodos)) {
    const activo = clave === valor;
    nodo.classList.toggle('confianza-opcion--activa', activo);
    nodo.setAttribute('aria-pressed', String(activo));
  }
}

function construirTarjetaPregunta(pregunta) {
  switch (pregunta.tipo) {
    case 'vf':
      return construirVf(pregunta);
    case 'test4':
      return construirTest4(pregunta);
    case 'ordenar':
      return construirOrdenar(pregunta);
    case 'error':
      return construirError(pregunta);
    default:
      throw new Error(`Tipo de pregunta desconocido: ${pregunta.tipo}`);
  }
}

function crearTarjetaBase() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta';
  return tarjeta;
}

function construirVf(pregunta) {
  const tarjeta = crearTarjetaBase();
  tarjeta.id = 'tarjeta-vf';

  const enunciado = document.createElement('p');
  enunciado.className = 'enunciado';
  enunciado.textContent = pregunta.enunciado;
  tarjeta.appendChild(enunciado);

  const botones = document.createElement('div');
  botones.className = 'botones-vf';

  const falso = document.createElement('button');
  falso.className = 'boton-ko';
  falso.dataset.test = 'vf-falso';
  falso.textContent = 'FALSO';
  falso.addEventListener('click', () => manejarRespuesta(pregunta, false));

  const verdadero = document.createElement('button');
  verdadero.className = 'boton-ok';
  verdadero.dataset.test = 'vf-verdadero';
  verdadero.textContent = 'VERDADERO';
  verdadero.addEventListener('click', () => manejarRespuesta(pregunta, true));

  botones.appendChild(falso);
  botones.appendChild(verdadero);
  tarjeta.appendChild(botones);

  activarSwipeVf(tarjeta, pregunta);

  return tarjeta;
}

function activarSwipeVf(tarjeta, pregunta) {
  const UMBRAL = 60;
  let activo = false;
  let inicioX = 0;
  let deltaX = 0;

  const ARRANQUE = 8; // px de movimiento antes de considerar que es un swipe y no un tap
  let capturado = false;

  tarjeta.addEventListener('pointerdown', (ev) => {
    // Un toque que empieza en un botón (FALSO/VERDADERO, ¿por qué?...) es del botón, no del gesto:
    // si la tarjeta capturase el puntero, el click acabaría en la tarjeta y el botón no respondería.
    if (ev.target.closest('button')) return;
    activo = true;
    capturado = false;
    inicioX = ev.clientX;
    deltaX = 0;
  });

  tarjeta.addEventListener('pointermove', (ev) => {
    if (!activo) return;
    deltaX = ev.clientX - inicioX;
    if (!capturado && Math.abs(deltaX) > ARRANQUE) {
      // Solo se captura el puntero cuando ya es un arrastre: un tap simple nunca lo secuestra.
      capturado = true;
      tarjeta.setPointerCapture(ev.pointerId);
    }
    if (capturado) tarjeta.style.transform = `translateX(${deltaX}px)`;
  });

  function soltar() {
    if (!activo) return;
    activo = false;
    tarjeta.style.transform = '';
    if (deltaX >= UMBRAL) {
      manejarRespuesta(pregunta, true);
    } else if (deltaX <= -UMBRAL) {
      manejarRespuesta(pregunta, false);
    }
    deltaX = 0;
  }

  tarjeta.addEventListener('pointerup', soltar);
  tarjeta.addEventListener('pointercancel', soltar);
}

function construirTest4(pregunta) {
  const tarjeta = crearTarjetaBase();

  const enunciado = document.createElement('p');
  enunciado.className = 'enunciado';
  enunciado.textContent = pregunta.enunciado;
  tarjeta.appendChild(enunciado);

  const opciones = document.createElement('div');
  opciones.className = 'opciones';
  pregunta.opciones.forEach((texto, i) => {
    const boton = document.createElement('button');
    boton.dataset.test = `opcion-${i}`;
    boton.textContent = texto;
    boton.addEventListener('click', () => manejarRespuesta(pregunta, i));
    opciones.appendChild(boton);
  });
  tarjeta.appendChild(opciones);

  return tarjeta;
}

function barajar(indices) {
  const copia = [...indices];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function construirOrdenar(pregunta) {
  const tarjeta = crearTarjetaBase();

  const enunciado = document.createElement('p');
  enunciado.className = 'enunciado';
  enunciado.textContent = `Ordena ${pregunta.criterio}: ${pregunta.enunciado}`;
  tarjeta.appendChild(enunciado);

  const contenedorItems = document.createElement('div');
  contenedorItems.className = 'items';

  const ordenMostrado = barajar(pregunta.items.map((_, i) => i));
  const seleccion = []; // índices originales, en el orden en que se han tocado

  const botones = ordenMostrado.map((indiceOriginal, posicion) => {
    const boton = document.createElement('button');
    boton.dataset.test = `item-${posicion}`;
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
        manejarRespuesta(pregunta, [...seleccion]);
      }
    });
  });

  tarjeta.appendChild(contenedorItems);
  return tarjeta;
}

function construirError(pregunta) {
  const tarjeta = crearTarjetaBase();

  const titulo = document.createElement('p');
  titulo.className = 'titulo-tarjeta';
  titulo.textContent = pregunta.tarjeta.titulo;
  tarjeta.appendChild(titulo);

  const enunciado = document.createElement('p');
  enunciado.className = 'enunciado';
  enunciado.textContent = pregunta.enunciado;
  tarjeta.appendChild(enunciado);

  const filas = document.createElement('div');
  filas.className = 'filas';
  pregunta.tarjeta.filas.forEach((fila, i) => {
    const boton = document.createElement('button');
    boton.dataset.test = `fila-${i}`;

    const etiqueta = document.createElement('span');
    etiqueta.className = 'fila-etiqueta';
    etiqueta.textContent = fila.etiqueta;

    const valor = document.createElement('span');
    valor.textContent = fila.valor;

    boton.appendChild(etiqueta);
    boton.appendChild(valor);
    boton.addEventListener('click', () => manejarRespuesta(pregunta, i));
    filas.appendChild(boton);
  });
  tarjeta.appendChild(filas);

  return tarjeta;
}

let preguntaRespondida = false;

function manejarRespuesta(pregunta, respuesta) {
  // Guarda contra doble tap / doble evento sobre la misma pregunta.
  if (preguntaRespondida) return;
  preguntaRespondida = true;
  const correcta = evaluar(pregunta, respuesta);
  const resultado = registrarRespuesta(estado, pregunta, correcta, hoy(), { confianza: confianzaActual });
  aplicarResultado(pregunta, resultado, correcta);
}

/** Aplica el resultado de registrarRespuesta a la sesión de UI: guarda estado,
 * actualiza contadores de la partida (incluido "Para repasar") y pinta el feedback. */
function aplicarResultado(pregunta, resultado, correcta) {
  estado = resultado.estado;
  guardarEstado(estado);
  actualizarCabecera(); // el "Nivel N" de la cabecera se ve moverse en vivo, no solo al volver a Inicio.

  xpPartida += resultado.delta.xp;
  if (correcta) aciertosPartida += 1;
  areasPartida.add(pregunta.area);

  // "Para repasar" del resumen: falladas, o acertadas con confianza Baja (frágiles,
  // delta.fragil ya implica correcta === true: en un fallo el motor siempre lo deja en false).
  if (!correcta || resultado.delta.fragil) {
    repasoPartida.push({ pregunta, correcta });
  }

  mostrarFeedback(pregunta, correcta, resultado.delta);
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** 'YYYY-MM-DD' -> "9 sep" (sin ceros a la izquierda), para el chip de Recuperada. */
function formatearFechaCorta(fechaISO) {
  if (!fechaISO) return '';
  const [, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia} ${MESES_CORTOS[mes - 1]}`;
}

/** Respuesta correcta como texto, para la tarjeta del carrusel "Para repasar". */
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

function mostrarFeedback(pregunta, correcta, delta) {
  nodoConfianza.hidden = true; // ya se ha respondido: el selector no tiene sentido hasta la próxima pregunta.

  const tarjeta = contenedorPregunta.querySelector('.tarjeta');
  if (tarjeta) {
    tarjeta.classList.remove('correcto', 'incorrecto');
    tarjeta.classList.add(correcta ? 'correcto' : 'incorrecto');
  }

  let textoResultado = correcta ? `✓ +${delta.xp} XP` : '✗';
  if (correcta && delta.confianza === 'alta') textoResultado += ' · confianza alta ×1,5';
  feedbackTexto.textContent = textoResultado;

  if (delta.combo >= 3) {
    feedbackCombo.hidden = false;
    feedbackCombo.textContent = `Combo ×${delta.combo}`;
  } else {
    feedbackCombo.hidden = true;
  }

  // Escalera inmediata: se ve subir o bajar en cada respuesta.
  if (delta.cambioNivelPartida > 0) {
    cambioNivelTexto.hidden = false;
    cambioNivelTexto.textContent = `Nivel ${delta.nivelPartida} ↑`;
    cambioNivelTexto.classList.remove('cambio-nivel-bajada');
    cambioNivelTexto.classList.add('cambio-nivel-subida');
  } else if (delta.cambioNivelPartida < 0) {
    cambioNivelTexto.hidden = false;
    cambioNivelTexto.textContent = `Nivel ${delta.nivelPartida} ↓`;
    cambioNivelTexto.classList.remove('cambio-nivel-subida');
    cambioNivelTexto.classList.add('cambio-nivel-bajada');
  } else {
    cambioNivelTexto.hidden = true;
  }

  // Nivel por área (más lento, solo se anuncia cuando de verdad cambia).
  if (delta.cambioNivelArea !== 0) {
    cambioNivelAreaTexto.hidden = false;
    const nombreAreaTexto = nombreArea(pregunta.area);
    cambioNivelAreaTexto.textContent = delta.cambioNivelArea > 0
      ? `${nombreAreaTexto} sube a nivel ${delta.nivelArea}`
      : `${nombreAreaTexto} baja a nivel ${delta.nivelArea}`;
  } else {
    cambioNivelAreaTexto.hidden = true;
  }

  // Chips compactos (spec "que se note"): cada uno solo si aplica.
  const hayRecuperada = Boolean(delta.recuperada);
  chipRecuperada.hidden = !hayRecuperada;
  if (hayRecuperada) {
    chipRecuperada.textContent = `Recuperada · la fallaste el ${formatearFechaCorta(delta.recuperada.fechaFallo)}`;
  }
  chipAltaFallo.hidden = !(delta.confianza === 'alta' && !correcta);
  chipMisionCompletada.hidden = !delta.misionCompletada;
  chipFragil.hidden = !delta.fragil;

  // Al fallar, la explicación se despliega sola: no tiene sentido pedir "¿por qué?"
  // para ver por qué se ha fallado. Al acertar se queda oculta (disponible bajo "?").
  explicacionTexto.hidden = correcta;
  explicacionTexto.textContent = pregunta.explicacion;
  reportadaTexto.hidden = true;

  contenedorFeedback.hidden = false;
  // La explicación desplegada puede empujar el botón fuera de la pantalla en el móvil.
  // "Siguiente" es sticky (siempre visible), así que hay que llevar el scroll de la
  // vista hasta el final: si no, tapa la fila de "?" y "esta pregunta está mal".
  requestAnimationFrame(() => {
    const vista = contenedorFeedback.closest('.vista');
    if (vista) vista.scrollTo({ top: vista.scrollHeight, behavior: 'auto' });
  });

  // Acierto: avanza sola; tocar "Siguiente" o la propia tarjeta antes cancela este
  // temporizador y adelanta el avance (ver más abajo, listener de contenedorPregunta,
  // y irASiguiente que siempre lo limpia primero). Con Recuperada o Misión completada
  // el tiempo sube a 2,2s para dar tiempo a leer el chip. Fallo: nunca avanza sola,
  // siempre espera a "Siguiente".
  limpiarAvanceAutomatico();
  if (correcta) {
    const duracion = hayRecuperada || delta.misionCompletada ? 2200 : 1400;
    avanceAutomaticoId = setTimeout(() => {
      avanceAutomaticoId = null;
      puedeAdelantarConToque = false;
      // Guarda extra: solo avanza si el feedback sigue en pantalla.
      if (!contenedorFeedback.hidden) irASiguiente();
    }, duracion);
    // Un tick después: el click que acaba de responder ya ha terminado de
    // burbujear, así que a partir de ahora sí es seguro adelantar con un toque.
    setTimeout(() => { puedeAdelantarConToque = true; }, 0);
  }
}

// El fondo del inicio respira en bucle: se pausa cuando la app no está visible para
// no gastar batería (hallazgo bajo de la pasada adversarial).
document.addEventListener('visibilitychange', () => {
  for (const luz of document.querySelectorAll('.fondo-luz')) {
    luz.style.animationPlayState = document.hidden ? 'paused' : 'running';
  }
});

function limpiarAvanceAutomatico() {
  puedeAdelantarConToque = false;
  if (avanceAutomaticoId !== null) {
    clearTimeout(avanceAutomaticoId);
    avanceAutomaticoId = null;
  }
}

function irASiguiente() {
  limpiarAvanceAutomatico();
  if (!preguntaEnPantalla) return;
  partidaUltima = preguntaEnPantalla;
  preguntaEnPantalla = null;
  indicePartida += 1;
  avanzarPregunta();
}

function marcarPreguntaMal() {
  const pregunta = preguntaEnPantalla;
  if (!pregunta || reportadaEnActual) return;
  if (!estado.reportadas.includes(pregunta.id)) {
    estado = { ...estado, reportadas: [...estado.reportadas, pregunta.id] };
    guardarEstado(estado);
  }
  reportadaEnActual = true;
  reportadaTexto.hidden = false;
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

function finalizarPartida() {
  estado = actualizarRacha(estado, hoy());
  guardarEstado(estado);
  actualizarCabecera();

  const totalPreguntas = indicePartida;
  animarConteo(resumenAciertos, 'Aciertos: ', aciertosPartida, `/${totalPreguntas}`);
  animarConteo(resumenXp, 'XP ganado: ', xpPartida);
  resumenAreas.textContent = `Áreas: ${[...areasPartida].join(', ') || '—'}`;

  renderRepaso();

  mostrarVista('resumen');
}

/** "Para repasar" del resumen: un carrusel horizontal (scroll-snap) con una
 * tarjeta por pregunta fallada o acertada con confianza Baja de la partida que
 * acaba de terminar, en orden de aparición. Sin nada que repasar, el mensaje
 * vacío ("Sin fallos. Nada que repasar."). */
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
}

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

  nodoKpiRacha.textContent = `🔥 ${estado.racha.dias}`;
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
document.querySelector('[data-test="siguiente"]').addEventListener('click', irASiguiente);
// Tocar la tarjeta mientras el acierto está avanzando solo adelanta ese avance;
// antes de responder, o tras un fallo, no hace nada (puedeAdelantarConToque es
// false), así que no interfiere con los botones de cada mecánica.
contenedorPregunta.addEventListener('click', () => {
  if (puedeAdelantarConToque) irASiguiente();
});
document.querySelector('[data-test="porque"]').addEventListener('click', () => {
  explicacionTexto.hidden = false;
});
document.querySelector('[data-test="esta-mal"]').addEventListener('click', marcarPreguntaMal);
nodoConfianzaBaja.addEventListener('click', () => seleccionarConfianza('baja'));
nodoConfianzaMedia.addEventListener('click', () => seleccionarConfianza('media'));
nodoConfianzaAlta.addEventListener('click', () => seleccionarConfianza('alta'));
// Misión de hoy / Pendientes: tocables solo cuando dataset.tocable === 'true'
// (ver actualizarDestacados). Partida cerrada a esos ids concretos, sin relleno.
nodoMision.addEventListener('click', () => {
  if (nodoMision.dataset.tocable !== 'true') return;
  const ids = estado.mision.ids.filter((id) => !estado.mision.hechas.includes(id));
  empezarPartida({ ids, etiqueta: 'Misión de hoy' });
});
nodoPendientes.addEventListener('click', () => {
  if (nodoPendientes.dataset.tocable !== 'true') return;
  const ids = pendientes(estado, banco).slice(0, 5).map((p) => p.id);
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
