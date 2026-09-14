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
  ordenarRepaso,
  AREAS,
} from './motor.js';
import { construirVisual } from './visuales.js';
import { montarMazo, ajustarEncaje, mazosActivos } from './mazo.js';

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
// Imágenes de Wikimedia Commons por id de pregunta (Tarea 3b): se cargan junto
// al banco en iniciar(); si falta el fichero o el fetch falla, queda vacío y
// la app sigue igual (la imagen es una mejora, no un requisito de la tarjeta).
let imagenesPorId = new Map();

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
// Día fijado al ARRANCAR la partida (hallazgo adversarial B5, confirmado):
// hoy() se reevaluaba en cada respuesta, así que una partida que cruzara la
// medianoche podía registrar respuestas de la MISMA partida en dos días de
// calendario distintos (historial partido, "hoy" del motor reiniciándose a
// mitad de partida). registrarRespuesta/cambiarConfianza usan este valor fijo
// en vez de llamar a hoy() de nuevo; el resto de usos de hoy() (HUB, racha al
// terminar) siguen evaluándose al vuelo a propósito.
let diaPartida = null;
// Mazo del RESUMEN (repaso vertical, spec v0.1c §6): se monta en finalizarPartida()
// sobre #mazo-resumen y se destruye al abandonar la vista (irAlHub, "Otra
// partida") o antes de reemplazarlo por uno nuevo (otra partida terminada sin
// haber recargado la página).
let mazoResumenControlador = null;
// "Para repasar" del resumen (falladas o acertadas con confianza Baja de la
// partida que acaba de terminar): se recalcula en finalizarPartida() a partir
// del mazo completo, así que refleja también un cambio de confianza hecho
// justo antes de terminar. Fuente del mazo de repaso vertical (spec v0.1c §6,
// ver construirMazoResumen): cada elemento guarda también `respuesta`/`delta`
// para poder reconstruir la MISMA tarjeta respondida en soloLectura.
let repasoPartida = [];

// Mazo del REPASO del HUB (feed "sin fin", spec v0.2 §2): se monta en
// abrirRepaso()/renderRepaso() sobre #mazo-repaso y se destruye al abandonar
// la vista (irAlHub/irAInicioEmojis, vía limpiarPartidaEnCurso) o antes de
// remontarlo con otro filtro. Nada que ver con mazoResumenControlador (el
// repaso de UNA partida ya jugada): este es el feed de TODA la historia.
let mazoRepasoControlador = null;
// Filtro de área activo del repaso del HUB: 'todas' o una de AREAS. Se
// recuerda en sessionStorage (spec v0.2 §2: "se recuerda en sessionStorage",
// no localStorage — vuelve dentro de la sesión, no entre sesiones).
const CLAVE_FILTRO_REPASO = 'one.repasoFiltro';
function cargarFiltroRepaso() {
  try {
    const guardado = sessionStorage.getItem(CLAVE_FILTRO_REPASO);
    if (guardado === 'todas' || AREAS.includes(guardado)) return guardado;
  } catch (err) {
    // sessionStorage no disponible (modo privado, cuota...): por defecto "todas".
  }
  return 'todas';
}
function guardarFiltroRepaso(valor) {
  try {
    sessionStorage.setItem(CLAVE_FILTRO_REPASO, valor);
  } catch (err) {
    // No persiste entre pantallas de la sesión, pero la app sigue funcionando.
  }
}
let filtroRepaso = cargarFiltroRepaso();

// Modo "practicar solo un área": null en partida normal; { area } cuando se entra
// desde Progreso pulsando "Practicar" en una fila. Se limpia al volver a inicio
// ("←" o "Inicio"); "Otra partida" en el resumen lo respeta para repetir el
// mismo filtro.
let filtroPartida = null;

// --- referencias a nodos ---
const nodoRacha = document.querySelector('[data-test="racha"]');
const nodoNivelPartida = document.querySelector('[data-test="nivel-partida"]');
const nodoVolver = document.querySelector('[data-test="volver"]');
const nodoModoArea = document.querySelector('[data-test="modo-area"]');
const botonCuerpo = document.querySelector('[data-test="cuerpo"]');
const avisoCuerpo = document.getElementById('aviso-cuerpo');
// Aviso breve del HUB (M1): "Nada que jugar con este filtro" cuando un filtro
// (Misión de hoy, Pendientes...) resulta sin ninguna pregunta elegible.
const avisoHub = document.getElementById('aviso-hub');
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
const nodoRepasoHub = document.querySelector('[data-test="repaso-hub"]');
const vistas = document.querySelectorAll('[data-vista]');
const contenedorMazo = document.getElementById('mazo');
const barraProgresoRelleno = document.getElementById('barra-progreso-relleno');
const contenedorMazoResumen = document.getElementById('mazo-resumen');
const contenedorMazoRepaso = document.getElementById('mazo-repaso');
const contenedorFiltroRepaso = document.querySelector('[data-test="repaso-filtro"]');
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

/** Desmonta el mazo de resumen (repaso vertical) si lo hubiera: listeners de
 * puntero y teclado incluidos. Se llama al abandonar la vista resumen y antes
 * de montar uno nuevo, por si acaso quedara uno de una partida anterior. */
function limpiarResumenMazo() {
  if (mazoResumenControlador) {
    mazoResumenControlador.destruir();
    mazoResumenControlador = null;
  }
}

/** Desmonta el mazo de repaso del HUB (feed sin fin, spec v0.2 §2), igual que
 * limpiarResumenMazo pero para #mazo-repaso. Se llama al abandonar la vista
 * (vía limpiarPartidaEnCurso) y antes de remontarlo con otro filtro. */
function limpiarRepasoMazo() {
  if (mazoRepasoControlador) {
    mazoRepasoControlador.destruir();
    mazoRepasoControlador = null;
  }
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
  limpiarResumenMazo();
  limpiarRepasoMazo();
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

let avisoHubId = null;
/** M1: aviso breve en el HUB cuando un filtro de partida (Misión de hoy,
 * Pendientes...) no tiene ninguna pregunta elegible — se vuelve al HUB en vez
 * de fingir una partida o un resumen vacíos (ver empezarPartida). */
function mostrarAvisoHub(mensaje) {
  avisoHub.textContent = mensaje;
  avisoHub.hidden = false;
  if (avisoHubId !== null) clearTimeout(avisoHubId);
  avisoHubId = setTimeout(() => {
    avisoHub.hidden = true;
    avisoHubId = null;
  }, 1600);
}

// --- carga del banco y arranque ---
async function iniciar() {
  const params = new URLSearchParams(location.search);
  const esEjemplo = params.get('ejemplo') === '1';
  const rutaBanco = esEjemplo ? 'datos/banco.ejemplo.json' : 'datos/banco.json';
  const respuesta = await fetch(rutaBanco);
  banco = await respuesta.json();
  bancoPorId = new Map(banco.map((p) => [p.id, p]));
  imagenesPorId = await cargarImagenes(esEjemplo);
  actualizarCabecera();
  mostrarVista('inicio');
}

/** Carga `datos/imagenes.json` (o `.ejemplo.json` con `?ejemplo=1`, ruta
 * relativa, Tarea 3b): objeto `{ [idPregunta]: {...} }` que se guarda como
 * Map por id. Si el fichero no existe o el fetch falla (red, 404...), se
 * queda vacío y la app sigue igual sin imágenes. */
async function cargarImagenes(esEjemplo) {
  const ruta = esEjemplo ? 'datos/imagenes.ejemplo.json' : 'datos/imagenes.json';
  try {
    const respuesta = await fetch(ruta);
    if (!respuesta.ok) return new Map();
    const datos = await respuesta.json();
    return new Map(Object.entries(datos));
  } catch (err) {
    return new Map();
  }
}

if (new URLSearchParams(location.search).get('test') === '1') {
  window.__one = {
    irA(indice) {
      const activo = mazosActivos.find((m) => m.estaVisible());
      if (activo) activo.irA(indice);
    },
    // Arranca una partida filtrada a ids concretos (mismo mecanismo que Misión
    // de hoy/Pendientes): para que el e2e pueda forzar preguntas concretas del
    // banco real (p. ej. el peor caso de encaje, spec v0.1c §4.2) sin depender
    // de qué le toque al azar.
    empezarPartida(filtro) {
      empezarPartida(filtro);
    },
    // Inyecta/quita una imagen para un id concreto del banco (Tarea 3b): para
    // que el e2e pueda forzar el peor caso "explicación larga + imagen" sobre
    // una pregunta real sin depender de qué ids tenga datos/imagenes.json en
    // cada momento (otro agente lo sigue completando en paralelo).
    forzarImagen(id, datos) {
      if (datos) imagenesPorId.set(id, datos);
      else imagenesPorId.delete(id);
    },
    // Inyecta una pregunta sintética en el banco ya cargado (ronda 1 de
    // revisión de v0.1d): para que el e2e pueda forzar un desborde extremo
    // (enunciado + explicación larguísimos) sin depender de `page.route` ni
    // de qué preguntas traiga el banco real/de ejemplo en cada momento.
    inyectarPregunta(pregunta) {
      bancoPorId.set(pregunta.id, pregunta);
      banco.push(pregunta);
    },
  };
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
  // Por si se viene del resumen ("Otra partida" arranca sin pasar por el HUB,
  // así que limpiarPartidaEnCurso() no se llega a invocar aquí): el mazo de
  // repaso no debe quedar montado (listeners incluidos) bajo la vista pregunta.
  limpiarResumenMazo();
  mazo = [];
  indiceMazo = 0;
  partidaUsados = new Set();
  partidaUltima = null;
  bancoAgotado = false;
  nodoCierre = null;
  repasoPartida = [];
  diaPartida = hoy(); // fijado UNA vez (hallazgo B5): ver comentario en la declaración.

  // Se comprueba ANTES de mostrar la vista "pregunta" (hallazgo M1, confirmado):
  // un filtro sin nada elegible (p. ej. "Misión de hoy" con ids de un banco ya
  // renovado — normalmente ya lo evita misionDelDia regenerando la misión,
  // pero esto es la red de seguridad para cualquier otro filtro que llegue
  // vacío) NO debe fingir una partida ni un resumen falso "0/0": eso además
  // subiría la racha sin haberse respondido nada (ver finalizarPartida).
  const primerHueco = rellenarHueco(0);
  if (!primerHueco) {
    filtroPartida = null;
    mostrarAvisoHub('Nada que jugar con este filtro');
    renderHub();
    mostrarVista('progreso');
    return;
  }

  actualizarCabecera(); // pinta "Solo <Área>" / "Misión de hoy" / "Pendientes" desde la primera pregunta.
  mostrarVista('pregunta');
  contenedorMazo.innerHTML = '';
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
  // Contador de la cabecera de pregunta (spec v0.1d §1, "3/10"): el mismo
  // valor para TODAS las tarjetas visibles ahora mismo (la ventana de 3 nodos
  // de montarMazo), así que basta con volver a pintar lo que ya esté en el
  // DOM en vez de reconstruir cada tarjeta. Se llama tras cada navegación y
  // tras cada respuesta (los dos únicos momentos en que "respondidas" cambia
  // o en que una tarjeta nueva puede entrar en la ventana).
  const textoContador = contadorTextoPartida();
  contenedorMazo.querySelectorAll('[data-test="mazo-contador"]').forEach((nodo) => {
    nodo.textContent = textoContador;
  });
}

/** "3/10" (respondidas/N_PARTIDA) para el contador de la cabecera de pregunta
 * (spec v0.1d §1). Solo tiene sentido en la partida: el repaso usa su propia
 * posición dentro del mazo de resumen (ver construirTarjetaRepaso). */
function contadorTextoPartida() {
  const respondidas = mazo.filter((h) => h.respondida).length;
  return `${respondidas}/${N_PARTIDA}`;
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
/**
 * Decide si hace falta rellenar un hueco más o crear/quitar la tarjeta de
 * cierre (spec v0.1c §2.1/§2.4): MUTA `mazo`/`nodoCierre` pero no empuja nada
 * a montarMazo todavía. Devuelve `true` si algo cambió (y por tanto hace
 * falta repintar). Separado de `asegurarSiguienteDisponible` para que
 * `manejarRespuesta` pueda combinarlo con el cambio de nodo de la respuesta en
 * UNA sola llamada a `actualizarTarjetas()`: dos renders seguidos con
 * `ajustarEncaje` midiendo (forzando layout) entre medias dejaban a veces el
 * `getBoundingClientRect()` de la tarjeta actual en un estado inconsistente
 * (hallazgo real de la ronda 1: reproducible con un filtro `{ids}` que se
 * agota justo al responder la penúltima).
 */
function actualizarEstadoMazo() {
  let cambio = false;
  if (listaActual().length <= indiceMazo + 1 && mazo.length < N_PARTIDA && !bancoAgotado) {
    if (rellenarHueco(mazo.length)) cambio = true;
  }
  const hayHuecos = mazo.length > 0;
  const puedeCerrar = hayHuecos && (mazo.length >= N_PARTIDA || bancoAgotado);
  const todasRespondidas = hayHuecos && mazo.every((h) => h.respondida);
  if (puedeCerrar && !todasRespondidas) {
    // Se reconstruye si no existía o si el número de pendientes ya no
    // coincide (spec v0.1c §2.4): el mazo puede alcanzar las N_PARTIDA (por
    // el prerrelleno) con más de un hueco sin responder todavía, y alguno de
    // esos huecos puede responderse DESPUÉS de que la tarjeta ya existiera.
    const pendientesActuales = mazo.filter((h) => !h.respondida).length;
    if (!nodoCierre || nodoCierre.dataset.pendientes !== String(pendientesActuales)) {
      nodoCierre = construirTarjetaCierre();
      cambio = true;
    }
  } else if (nodoCierre) {
    nodoCierre = null;
    cambio = true;
  }
  return cambio;
}

function asegurarSiguienteDisponible() {
  if (actualizarEstadoMazo()) mazoControlador.actualizarTarjetas(listaActual());
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
  // La partida ha terminado: se desmonta el mazo (listeners de puntero y de
  // teclado incluidos) para no dejar nada colgado mientras se ve el resumen;
  // también cualquier mazo de resumen anterior (defensivo: no debería quedar
  // uno vivo, ver limpiarResumenMazo/empezarPartida).
  if (mazoControlador) {
    mazoControlador.destruir();
    mazoControlador = null;
  }
  limpiarResumenMazo();

  const respondidas = mazo.filter((h) => h.respondida);
  // M1 (hallazgo confirmado): la racha solo sube si se ha respondido algo de
  // verdad en esta partida. Sin esta guarda, un filtro que se queda sin nada
  // que jugar (ver la comprobación en empezarPartida; esto es además una red
  // de seguridad por si algún otro camino llegara aquí con `mazo` vacío) subía
  // el 🔥 igual que una partida jugada de verdad.
  if (respondidas.length > 0) {
    estado = actualizarRacha(estado, hoy());
    guardarEstado(estado);
  }
  actualizarCabecera();

  const totalPreguntas = respondidas.length;
  const aciertos = respondidas.filter((h) => h.correcta).length;
  const xpTotal = respondidas.reduce((suma, h) => suma + h.delta.xp, 0);
  const areas = new Set(respondidas.map((h) => h.pregunta.area));
  // "Para repasar": falladas, o acertadas con confianza Baja (frágiles). Se
  // recalcula aquí (no se acumula sobre la marcha) para reflejar también los
  // cambios de confianza hechos en cualquier momento de la partida. Se
  // guardan también `respuesta`/`delta`: el mazo de repaso (spec v0.1c §6)
  // reconstruye la MISMA tarjeta respondida (construirTarjetaRespondida), que
  // los necesita para la respuesta compacta y el feedback.
  repasoPartida = respondidas
    .filter((h) => !h.correcta || h.delta.fragil)
    .map((h) => ({ pregunta: h.pregunta, correcta: h.correcta, respuesta: h.respuesta, delta: h.delta }));

  contenedorMazoResumen.innerHTML = '';
  mazoResumenControlador = montarMazo(
    contenedorMazoResumen,
    construirMazoResumen({ aciertos, totalPreguntas, xpTotal, areas }),
    // contarPista: false (B4) — navegar el repaso no gasta del presupuesto de
    // 5 vistas de la pista vertical, que es de la PARTIDA. puntosNeutros: true
    // (B3) — la semántica respondida/sin responder no aplica a la tarjeta de
    // cifras ni a la final; los puntos del resumen son neutros salvo el actual.
    { contarPista: false, puntosNeutros: true }
  );
  mostrarVista('resumen');
}

// ============================================================================
// --- construcción de tarjetas ---
// ============================================================================

/** Cabecera "Área · nivel N" de cada tarjeta, con el contador de la spec
 * v0.1d §1 a la derecha si se pasa `contadorTexto` ("3/10" en la partida,
 * "2/5" en el repaso — cada llamador decide cuál según el contexto). Sin
 * contador, la cabecera queda igual que en v0.1c (usado nunca hoy, pero deja
 * la función utilizable sin el segundo argumento). */
function construirCabeceraPregunta(pregunta, contadorTexto) {
  const cabecera = document.createElement('p');
  cabecera.className = 'pregunta-cabecera';
  cabecera.dataset.test = 'nivel-pregunta';
  const texto = document.createElement('span');
  texto.textContent = `${nombreArea(pregunta.area)} · nivel ${pregunta.nivel}`;
  cabecera.appendChild(texto);
  if (contadorTexto) {
    const contador = document.createElement('span');
    contador.dataset.test = 'mazo-contador';
    contador.textContent = contadorTexto;
    cabecera.appendChild(contador);
  }
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

/** Fila de confianza (spec v0.1c §2.3): clonada de la plantilla, con su propio
 * segmentado. Antes de responder cambia hueco.confianza sin más; después de
 * responder, cada cambio recorrige la respuesta ya registrada vía
 * cambiarConfianza() del motor. Compacta a 32px tras responder (spec v0.1d
 * §3, `hueco.respondida` ya está en `true` cuando esta función se llama desde
 * construirTarjetaRespondida): sigue tocable y editable igual, solo más baja. */
function construirFilaConfianza(hueco) {
  const nodo = plantillaConfianza.content.firstElementChild.cloneNode(true);
  nodo.classList.toggle('confianza-fila--compacta', hueco.respondida);
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
  // diaPartida, no hoy() (hallazgo B5): mismo motivo que en manejarRespuesta.
  const resultado = cambiarConfianza(estado, hueco.pregunta, hueco.delta, valor, diaPartida);
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

  // Todo lo de arriba de la zona de acción es UN bloque con gaps fijos que se
  // centra verticalmente en el espacio libre (corrección de la ronda 1: antes
  // cada pieza -confianza, respuesta, feedback- competía por su propio flex:1
  // y quedaban tres grupos flotantes con huecos grandes entre sí). Sin
  // responder SÍ hay cascada (Añadido A, 13-sep tarde: un enunciado largo no
  // puede quedar cortado con hueco libre de sobra en la tarjeta) — ver la
  // rama `dataset.respondida !== 'true'` en ajustarEncaje, sin ningún toque
  // para desplegar/plegar nada.
  const contenido = document.createElement('div');
  contenido.className = 'tarjeta-contenido';
  contenido.appendChild(construirCabeceraPregunta(pregunta, contadorTextoPartida()));
  contenido.appendChild(construirBloqueEnunciado(pregunta));
  contenido.appendChild(construirFilaConfianza(hueco));
  const zonaRespuesta = construirZonaRespuesta(hueco);
  if (zonaRespuesta.hasChildNodes()) contenido.appendChild(zonaRespuesta);
  tarjeta.appendChild(contenido);

  const zonaAccion = document.createElement('div');
  zonaAccion.className = 'tarjeta-accion';
  if (pregunta.tipo === 'vf') {
    zonaAccion.appendChild(construirPistaSwipeVf());
    zonaAccion.appendChild(construirBotonesVf(hueco));
  }
  tarjeta.appendChild(zonaAccion);

  if (pregunta.tipo === 'vf') activarSwipeVf(tarjeta, hueco);

  return tarjeta;
}

// --- tarjeta YA respondida (reutilizable por el repaso, Task 3) ---

/** Respuesta ya fija en su forma compacta (spec v0.1c §4.1 punto 4): vf una
 * línea; test4/error la fila correcta con ✓ y, si falló, la suya tachada
 * encima; ordenar la lista completa CORRECTA con un rótulo encima y ✓/✗ por
 * posición SOLO si al menos una posición acertó (ronda de corrección 1: con
 * TODO mal — p. ej. el orden invertido del todo — marcar cada línea con ✗
 * sobre el propio orden correcto leía como "esto está mal", cuando es
 * justo lo contrario; sin ninguna marca, el rótulo solo, se entiende). */
function construirRespuestaCompacta(pregunta, hueco) {
  const contenedor = document.createElement('div');
  contenedor.className = 'respuesta-compacta';
  switch (pregunta.tipo) {
    case 'vf': {
      // Tolerancia a hueco.respuesta === undefined (tarjeta anterior a v0.2,
      // spec §2: "se pinta con la correcta marcada y sin la respuesta del
      // usuario"): para vf, correcta === true implica por definición que la
      // respuesta dada fue pregunta.respuesta (evaluar() compara igualdad),
      // así que no hace falta "adivinar" nada — se reconstruye exacta.
      const respuestaVf = hueco.respuesta === undefined ? pregunta.respuesta : hueco.respuesta;
      const linea = document.createElement('p');
      linea.className = 'respuesta-compacta-linea';
      linea.textContent = hueco.correcta
        ? `Tu respuesta: ${respuestaVf ? 'Verdadero' : 'Falso'} ✓`
        : `✗ · Era ${pregunta.respuesta ? 'Verdadero' : 'Falso'}`;
      linea.classList.add(hueco.correcta ? 'respuesta-compacta-linea--ok' : 'respuesta-compacta-linea--tachada');
      contenedor.appendChild(linea);
      break;
    }
    case 'test4': {
      // Sin hueco.respuesta (tarjeta anterior a v0.2 fallada, sin volver a
      // responder) no hay forma de saber CUÁL opción se marcó: se omite la
      // línea tachada y se deja solo la correcta (tolerancia mínima pedida
      // por la spec §2, "marca solo la correcta").
      if (!hueco.correcta && hueco.respuesta !== undefined) {
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
      // Misma tolerancia que test4 (ver comentario arriba).
      if (!hueco.correcta && hueco.respuesta !== undefined) {
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
      const rotulo = document.createElement('p');
      rotulo.className = 'respuesta-compacta-orden-rotulo';
      rotulo.textContent = 'Orden correcto';
      contenedor.appendChild(rotulo);

      const lista = document.createElement('ol');
      lista.className = 'respuesta-compacta-orden';
      const respuestaUsuario = Array.isArray(hueco.respuesta) ? hueco.respuesta : [];
      // Si el jugador no acertó NI UNA posición, marcar cada línea con ✗ sobre
      // el orden correcto confunde (lee como si la lista en sí estuviera mal).
      // En ese caso se deja limpia, sin marcas: el rótulo de arriba ya dice
      // que esto es lo correcto.
      const algunaAcertada = respuestaUsuario.some((original, posicion) => original === posicion);
      pregunta.items.forEach((texto, posicion) => {
        const li = document.createElement('li');
        li.textContent = algunaAcertada
          ? `${texto} ${respuestaUsuario[posicion] === posicion ? '✓' : '✗'}`
          : texto;
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
      p.textContent = `Respuesta: ${pregunta.respuesta ? 'Verdadero' : 'Falso'} ✓`;
      break;
    case 'test4':
      p.textContent = `Respuesta: ${pregunta.opciones[pregunta.correcta]} ✓`;
      break;
    case 'error':
      p.textContent = `Respuesta: ${pregunta.tarjeta.filas[pregunta.sospechoso].etiqueta} ✓`;
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

/** Respuesta correcta como texto (para el repaso del resumen y el prompt de
 * "Preguntar a"). */
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

// ============================================================================
// --- "Preguntar a" (spec v0.1c §5): fila de 3 enlaces que abren ChatGPT,
// Claude y Gemini (vía el modo IA de Google, la app gemini.google.com no lee
// la URL) con el mismo prompt precargado, para profundizar en una pregunta ya
// respondida. Los tres LEEN el prompt de la URL (probado en vivo el 12-sep):
// sin plan B de portapapeles. Se inserta en el ancla vacía
// [data-test="preguntar-a"] de construirTarjetaRespondida (partida y repaso).
// ============================================================================

// Iconos SVG inline, monocromos (heredan el color cian del botón vía
// currentColor): ChatGPT una flor de 6 pétalos simplificada, Claude un
// asterisco de 8 rayos, Gemini una estrella/destello de 4 puntas.
const SVG_PREGUNTAR_CHATGPT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
  <ellipse cx="12" cy="7.3" rx="2.1" ry="3.8" transform="rotate(0 12 12)"/>
  <ellipse cx="12" cy="7.3" rx="2.1" ry="3.8" transform="rotate(60 12 12)"/>
  <ellipse cx="12" cy="7.3" rx="2.1" ry="3.8" transform="rotate(120 12 12)"/>
  <ellipse cx="12" cy="7.3" rx="2.1" ry="3.8" transform="rotate(180 12 12)"/>
  <ellipse cx="12" cy="7.3" rx="2.1" ry="3.8" transform="rotate(240 12 12)"/>
  <ellipse cx="12" cy="7.3" rx="2.1" ry="3.8" transform="rotate(300 12 12)"/>
</svg>`;
const SVG_PREGUNTAR_CLAUDE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
  <line x1="12" y1="2.5" x2="12" y2="21.5"/>
  <line x1="2.5" y1="12" x2="21.5" y2="12"/>
  <line x1="5.4" y1="5.4" x2="18.6" y2="18.6"/>
  <line x1="18.6" y1="5.4" x2="5.4" y2="18.6"/>
</svg>`;
const SVG_PREGUNTAR_GEMINI = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M12 2.5c0.9 5.6 3 7.7 8.6 8.6-5.6 0.9-7.7 3-8.6 8.6-0.9-5.6-3-7.7-8.6-8.6 5.6-0.9 7.7-3 8.6-8.6Z"/>
</svg>`;

const DESTINOS_PREGUNTAR_A = [
  { clave: 'chatgpt', nombre: 'ChatGPT', icono: SVG_PREGUNTAR_CHATGPT, url: (q) => `https://chatgpt.com/?q=${q}` },
  { clave: 'claude', nombre: 'Claude', icono: SVG_PREGUNTAR_CLAUDE, url: (q) => `https://claude.ai/new?q=${q}` },
  { clave: 'gemini', nombre: 'Gemini', icono: SVG_PREGUNTAR_GEMINI, url: (q) => `https://www.google.com/search?udm=50&q=${q}` },
];

/** Prompt en español, literal de la spec v0.1d §5 (feedback de Carlos: "el
 * prompt no lo limites tanto, que sea constructivo"): sin tope de palabras,
 * pide mecanismo/porqué, contexto, actualidad, un dato memorable, que
 * corrija la explicación si le falta algo y que proponga 2-3 preguntas más. */
function construirPromptPreguntarA(pregunta) {
  return `Estoy aprendiendo con una app de preguntas. Pregunta: «${pregunta.enunciado}». Respuesta correcta: «${respuestaCorrectaTexto(pregunta)}». Explicación que me dio la app: «${pregunta.explicacion}». Ayúdame a entenderlo de verdad: explícame el mecanismo o el porqué de fondo, sitúalo en su contexto (histórico, económico o científico, según toque), dime por qué importa hoy y cómo se relaciona con la actualidad, dame un dato o una anécdota memorable para recordarlo y conversar sobre ello, corrige o matiza la explicación si crees que le falta algo, apóyate en algo visual siempre que ayude (un esquema en texto, una tabla comparativa, una línea de tiempo o una fórmula sencilla), y termina proponiéndome dos o tres preguntas para seguir profundizando. En español.`;
}

/** Fila "Preguntar a:" (spec v0.1c §5, nombres añadidos en v0.1d §5): etiqueta
 * + tres columnas icono(44×44)+nombre(11px), cada `<a>` con borde cian, icono
 * monocromo, aria-label y el prompt de ESTA pregunta ya codificado en la URL.
 * `target="_blank" rel="noopener"`: abren aparte. El nombre visible es
 * `aria-hidden`: el aria-label del enlace ya lo dice, no hace falta leerlo dos
 * veces con lector de pantalla. */
function construirPreguntarA(pregunta) {
  const frag = document.createDocumentFragment();

  const etiqueta = document.createElement('span');
  etiqueta.className = 'preguntar-a-etiqueta';
  etiqueta.textContent = 'Preguntar a:';
  frag.appendChild(etiqueta);

  const prompt = encodeURIComponent(construirPromptPreguntarA(pregunta));
  for (const destino of DESTINOS_PREGUNTAR_A) {
    const item = document.createElement('div');
    item.className = 'preguntar-a-item';

    const enlace = document.createElement('a');
    enlace.className = 'preguntar-a-boton';
    enlace.dataset.test = `preguntar-${destino.clave}`;
    enlace.href = destino.url(prompt);
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    enlace.setAttribute('aria-label', `Preguntar a ${destino.nombre}`);
    enlace.innerHTML = destino.icono;
    item.appendChild(enlace);

    const nombre = document.createElement('span');
    nombre.className = 'preguntar-a-nombre';
    nombre.textContent = destino.nombre;
    nombre.setAttribute('aria-hidden', 'true');
    item.appendChild(nombre);

    frag.appendChild(item);
  }
  return frag;
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

  // Sin toque para desplegar/plegar (spec v0.1d §3/§4, cambio de contrato de
  // Carlos 13-sep 10:15/10:19: "evitar cantidad de clics"): si no cabe, la
  // cascada de ajustarEncaje la encoge (tarjeta--explicacion-menor/-minima) o,
  // como último recurso, la recorta con line-clamp — nunca con una alternancia
  // táctil que el jugador tenga que descubrir.
  const explicacion = document.createElement('p');
  explicacion.className = 'explicacion';
  explicacion.dataset.test = 'explicacion';
  explicacion.textContent = pregunta.explicacion;
  feedback.appendChild(explicacion);

  pintarFeedback(feedback, pregunta, hueco.correcta, hueco.delta);
  return feedback;
}

// ============================================================================
// --- Imagen de Wikimedia Commons (Tarea 3b, spec v0.1c §4): solo en la
// tarjeta YA RESPONDIDA (partida y repaso, misma función), entre la respuesta
// compacta y el feedback — nunca antes de responder (no debe dar pistas).
// Datos en `imagenesPorId` (cargados en iniciar()); si la pregunta no tiene
// entrada, no se pinta nada y la tarjeta queda igual que sin esta tarea.
// ============================================================================

/** Pie de atribución (segunda línea del figcaption): "Commons" siempre es un
 * enlace a la página del fichero. Dominio público y CC0 no exigen citar
 * autor (a diferencia de CC BY/CC BY-SA, que sí lo exigen): con esas dos
 * licencias basta "Dominio público · Commons" / "CC0 · Commons". */
function construirAtribucionImagen(datos) {
  const p = document.createElement('p');
  p.className = 'imagen-pie-atribucion';
  const exigeAutor = datos.licencia !== 'Public domain' && datos.licencia !== 'CC0';
  const licenciaTexto = datos.licencia === 'Public domain' ? 'Dominio público' : datos.licencia;
  const prefijo = exigeAutor && datos.autor ? `${datos.autor} · ${licenciaTexto} · ` : `${licenciaTexto} · `;
  p.appendChild(document.createTextNode(prefijo));
  const enlace = document.createElement('a');
  enlace.href = datos.pagina;
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  enlace.textContent = 'Commons';
  p.appendChild(enlace);
  return p;
}

/** Bloque de imagen: figura + pie, sin enlace "Ver imagen" (spec v0.1d §4,
 * feedback de Carlos: "el botón Ver imagen no sirve para nada: la imagen o
 * se pone o no"). La caja es flexible (CSS: flex:1 1 auto, min-height:90px,
 * max-height:40vh): crece si sobra espacio y se encoge hasta 90px si hace
 * falta, pero nunca se pliega/oculta por falta de espacio — es de lo último
 * que la cascada de ajustarEncaje sacrifica (spec v0.1d §3/§4, 13-sep 10:19).
 * Solo desaparece si la imagen de verdad falla al cargar (ver el `error` de
 * abajo). Devuelve `null` si la pregunta no tiene imagen (nada que pintar). */
function construirBloqueImagen(pregunta) {
  const datos = imagenesPorId.get(pregunta.id);
  if (!datos) return null;

  const zona = document.createElement('div');
  zona.className = 'zona-imagen';

  const figura = document.createElement('figure');
  figura.className = 'imagen';
  figura.dataset.test = 'imagen';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = datos.leyenda || '';
  img.referrerPolicy = 'no-referrer';
  img.src = datos.url;
  // Imagen rota (404, sin red...): antes de dejar el hueco vacío, se intenta
  // el visual generado como respaldo (hallazgo M2, revisión final v0.1e: la
  // prioridad fija imagen->visual de construirTarjetaRespondida se decide en
  // el momento de construir la tarjeta, cuando la imagen "existe" a efectos
  // de datos aunque su carga real falle después — sin este respaldo, una
  // imagen rota dejaba la tarjeta sin NINGÚN visual pudiendo haber uno). Si
  // `construirBloqueVisual` también devuelve null (sin visual, o inválido),
  // se cae al comportamiento anterior: se quita el bloque entero y la marca
  // de "hay imagen" del contenido (vuelve a centrarse como si nunca hubiera
  // tenido imagen, spec v0.1d §3). Se recalcula el encaje en ambos casos,
  // porque el alto disponible cambia.
  img.addEventListener('error', () => {
    const tarjeta = zona.closest('.tarjeta');
    const contenido = tarjeta ? tarjeta.querySelector('.tarjeta-contenido') : null;
    const respaldo = construirBloqueVisual(pregunta);
    if (respaldo) {
      zona.replaceWith(respaldo);
      if (contenido) contenido.classList.add('tarjeta-contenido--imagen');
    } else {
      zona.remove();
      if (contenido) contenido.classList.remove('tarjeta-contenido--imagen');
    }
    if (tarjeta) ajustarEncaje(tarjeta);
  });
  figura.appendChild(img);

  const pie = document.createElement('figcaption');
  pie.className = 'imagen-pie';
  pie.dataset.test = 'imagen-pie';
  const leyenda = document.createElement('p');
  leyenda.className = 'imagen-pie-leyenda';
  leyenda.textContent = datos.leyenda || '';
  pie.appendChild(leyenda);
  pie.appendChild(construirAtribucionImagen(datos));
  figura.appendChild(pie);

  zona.appendChild(figura);
  return zona;
}

/** Bloque de visual generado (spec v0.1e §2/§4): SOLO se llama cuando la
 * pregunta no tiene imagen de Commons (ver la prioridad fija en
 * construirTarjetaRespondida: imagen primero, este visual después, nada si
 * no hay ninguno de los dos). Misma caja flexible que la imagen
 * (.zona-imagen, con la clase extra zona-imagen--visual) y misma cascada de
 * encaje de v0.1d §4: el visual es "imagen" a todos los efectos (mín. 90px,
 * máx. 55vh, nunca se quita). construirVisual (visuales.js) hace su propia
 * comprobación mínima de forma y devuelve null si `pregunta.visual` no
 * existe, no tiene un tipo reconocido o los datos no tienen pinta de lo que
 * dicen ser; en ese caso esta función tampoco pinta nada (mismo contrato que
 * construirBloqueImagen: null = nada que pintar). La leyenda va en un <p>
 * con el mismo estilo que el pie de la imagen, pero sin atribución (no hay
 * autor/licencia que citar en un dibujo generado por la propia app). */
function construirBloqueVisual(pregunta) {
  const svg = construirVisual(pregunta.visual);
  if (!svg) return null;

  const zona = document.createElement('div');
  zona.className = 'zona-imagen zona-imagen--visual';
  zona.appendChild(svg);

  const leyenda = document.createElement('p');
  leyenda.className = 'visual-pie';
  leyenda.dataset.test = 'visual-pie';
  leyenda.textContent = (pregunta.visual && pregunta.visual.leyenda) || '';
  zona.appendChild(leyenda);

  return zona;
}

/**
 * Tarjeta de un hueco ya respondido (spec v0.1c, interfaz para el repaso):
 * cabecera (con contador, spec v0.1d §1), enunciado, confianza compacta
 * (activa, salvo soloLectura), respuesta compacta + resumen a una línea (para
 * tarjeta--compacta-1), imagen de Wikimedia Commons si la pregunta tiene una
 * (Tarea 3b), feedback y, en la zona de acción, la fila "Preguntar a"
 * (construirPreguntarA) y, salvo soloLectura, la fila compacta de 44px "esta
 * pregunta está mal" + Siguiente (spec v0.1d §2). Único toque permitido en
 * esta tarjeta, aparte de esos cuatro controles: ninguno — spec v0.1d §3/§4
 * (Carlos, 13-sep 10:15) quita toda alternancia de despliegue/plegado, así que
 * ni la explicación, ni la respuesta compacta, ni la imagen tienen listener.
 * `contadorTexto` lo decide cada llamador ("3/10" en partida, "n/N" en
 * repaso): ver manejarRespuesta y construirTarjetaRepaso.
 */
function construirTarjetaRespondida(pregunta, hueco, { soloLectura = false, contadorTexto } = {}) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta';
  tarjeta.dataset.test = 'tarjeta';
  tarjeta.dataset.respondida = 'true';
  tarjeta.classList.add(hueco.correcta ? 'correcto' : 'incorrecto');

  const contenido = document.createElement('div');
  contenido.className = 'tarjeta-contenido';
  contenido.appendChild(construirCabeceraPregunta(pregunta, contadorTexto));
  contenido.appendChild(construirBloqueEnunciado(pregunta));
  if (!soloLectura) contenido.appendChild(construirFilaConfianza(hueco));

  // Zona de respuesta ya fija: la compacta (completa) y su resumen a una
  // línea conviven en el DOM, CSS decide cuál se ve según la cascada de
  // ajustarEncaje (tarjeta--compacta-1 / tarjeta--sin-respuestas) — sin
  // listeners, nunca se alternan con un toque.
  const zonaRespuesta = document.createElement('div');
  zonaRespuesta.className = 'zona-respuesta';
  zonaRespuesta.appendChild(construirRespuestaCompacta(pregunta, hueco));
  zonaRespuesta.appendChild(construirResumenRespuesta(pregunta));
  contenido.appendChild(zonaRespuesta);

  // La imagen (o, en su falta, el visual) absorbe el sobrante (spec v0.1d
  // §3, ampliado en v0.1e §2): el bloque de contenido deja de centrarse con
  // márgenes automáticos y se alinea arriba (ver .tarjeta-contenido--imagen
  // en estilos.css) en cuanto hay CUALQUIERA de los dos; sin ninguno, o en
  // la tarjeta sin responder, el centrado de v0.1c se mantiene. Prioridad
  // fija: imagen de Commons si existe; si no, el visual verificado de la
  // pregunta; si tampoco, nada (como hasta ahora) — nunca los dos a la vez.
  const bloqueImagen = construirBloqueImagen(pregunta) || construirBloqueVisual(pregunta);
  if (bloqueImagen) {
    contenido.classList.add('tarjeta-contenido--imagen');
    contenido.appendChild(bloqueImagen);
  }

  contenido.appendChild(construirBloqueFeedback(pregunta, hueco));
  tarjeta.appendChild(contenido);

  const zonaAccion = document.createElement('div');
  zonaAccion.className = 'tarjeta-accion';
  const anclaPreguntarA = document.createElement('div');
  anclaPreguntarA.className = 'preguntar-a';
  anclaPreguntarA.dataset.test = 'preguntar-a';
  anclaPreguntarA.appendChild(construirPreguntarA(pregunta));
  zonaAccion.appendChild(anclaPreguntarA);

  if (!soloLectura) {
    // Fila de acción compacta de 44px (spec v0.1d §2): "esta pregunta está
    // mal" a la izquierda (o "Anotado" en su lugar, tras tocarlo) y
    // "Siguiente ›" a la derecha, en UNA sola fila — ya no hay fila aparte
    // para el enlace ni un botón Siguiente a todo el ancho.
    const filaAccion = document.createElement('div');
    filaAccion.className = 'fila-accion';

    const botonEstaMal = document.createElement('button');
    botonEstaMal.className = 'enlace-discreto';
    botonEstaMal.dataset.test = 'esta-mal';
    botonEstaMal.textContent = 'esta pregunta está mal';
    botonEstaMal.hidden = hueco.reportada;
    botonEstaMal.addEventListener('click', () => manejarClicEstaMal(hueco));
    filaAccion.appendChild(botonEstaMal);

    const reportadaTexto = document.createElement('p');
    reportadaTexto.className = 'reportada';
    reportadaTexto.textContent = 'Anotado';
    reportadaTexto.hidden = !hueco.reportada;
    filaAccion.appendChild(reportadaTexto);

    const botonSiguiente = document.createElement('button');
    botonSiguiente.className = 'boton boton-principal boton-siguiente';
    botonSiguiente.dataset.test = 'siguiente';
    botonSiguiente.textContent = 'Siguiente ›';
    botonSiguiente.addEventListener('click', irASiguienteHueco);
    filaAccion.appendChild(botonSiguiente);

    zonaAccion.appendChild(filaAccion);
  }
  tarjeta.appendChild(zonaAccion);

  // Sin toque en el enunciado (Añadido A quitó también el de la tarjeta sin
  // responder: ninguna tarjeta lo tiene ya): el único plegado de esta tarjeta
  // es la cascada automática de ajustarEncaje, nunca uno manual.
  return tarjeta;
}

function manejarClicEstaMal(hueco) {
  if (hueco.reportada) return;
  if (!estado.reportadas.includes(hueco.pregunta.id)) {
    estado = { ...estado, reportadas: [...estado.reportadas, hueco.pregunta.id] };
    guardarEstado(estado);
  }
  hueco.reportada = true;
  if (!hueco.nodo) return;
  const botonEstaMal = hueco.nodo.querySelector('[data-test="esta-mal"]');
  const reportadaTexto = hueco.nodo.querySelector('.reportada');
  if (botonEstaMal) botonEstaMal.hidden = true;
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
  // No es un hueco (spec v0.1c §2.2/§2.4): no pinta punto en la columna del
  // mazo (hallazgo adversarial B3, confirmado; ver pintarPuntos).
  tarjeta.dataset.puntoOculto = 'true';

  const pendientesN = mazo.filter((h) => !h.respondida).length;
  // Marca cuántas quedaban AL CONSTRUIRSE: actualizarEstadoMazo la usa para
  // saber si hay que reconstruir la tarjeta (spec v0.1c §2.4). Sin esto, una
  // pendiente respondida DESPUÉS de que apareciera el cierre (p. ej. el
  // pre-relleno alcanza las N_PARTIDA justo al llegar al penúltimo hueco, con
  // dos sin responder todavía) dejaba el número congelado y equivocado.
  tarjeta.dataset.pendientes = String(pendientesN);
  // Añadido B (13-sep tarde): título de confirmación explícito por encima
  // del recuento — antes el recuento SOLO ("Quedan N sin responder") hacía
  // de título, sin preguntar nada. El recuento se mantiene literal debajo,
  // en --texto-suave (hay e2e que buscan justo ese texto).
  const titulo = document.createElement('p');
  titulo.className = 'mazo-cierre-titulo';
  titulo.textContent = '¿Seguro que quieres terminar?';
  tarjeta.appendChild(titulo);

  const subtitulo = document.createElement('p');
  subtitulo.className = 'mazo-cierre-subtitulo';
  subtitulo.textContent = `Quedan ${pendientesN} sin responder`;
  tarjeta.appendChild(subtitulo);

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
  // diaPartida (hallazgo B5), no hoy(): el día se fija una vez al arrancar la
  // partida, así una partida que cruce la medianoche no reparte sus
  // respuestas entre dos días de calendario distintos.
  const resultado = registrarRespuesta(estado, pregunta, correcta, diaPartida, {
    confianza: hueco.confianza,
    respuesta,
  });
  estado = resultado.estado;
  guardarEstado(estado);
  actualizarCabecera(); // el "Nivel N" de la cabecera se ve moverse en vivo.

  hueco.respondida = true;
  hueco.respuesta = respuesta;
  hueco.correcta = correcta;
  hueco.delta = resultado.delta;
  hueco.nodo = construirTarjetaRespondida(pregunta, hueco, { soloLectura: false, contadorTexto: contadorTextoPartida() });

  // Un solo actualizarTarjetas() con el nodo nuevo Y (si aplica) el hueco
  // rellenado por delante o la tarjeta de cierre ya resueltos: ver el porqué
  // en el comentario de actualizarEstadoMazo.
  actualizarEstadoMazo();
  mazoControlador.actualizarTarjetas(listaActual());
  actualizarBarraProgreso();
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

// ============================================================================
// --- REPASO: mazo vertical de solo lectura (spec v0.1c §6). Mismo componente
// (montarMazo) que la partida, montado sobre #mazo-resumen: tarjeta 0 con las
// cifras, una por cada elemento de repasoPartida (la MISMA tarjeta respondida
// de la partida, reconstruida en soloLectura) y una tarjeta final con Otra
// partida / Inicio. El carrusel horizontal de antes desaparece entero.
// ============================================================================

/** Fila Otra partida / Inicio (spec v0.1c §6): reutilizada por la tarjeta de
 * cifras cuando no hay nada que repasar (botones directos, sin deslizar) y
 * por la tarjeta final cuando sí lo hay. "Otra partida" respeta el filtro de
 * área vigente (igual que hacía el antiguo botón "Otra"). */
function construirAccionesResumen() {
  const acciones = document.createElement('div');
  acciones.className = 'resumen-acciones';

  const otra = document.createElement('button');
  otra.className = 'boton boton-principal';
  otra.dataset.test = 'otra-partida';
  otra.textContent = 'Otra partida';
  otra.addEventListener('click', () => empezarPartida(filtroPartida));

  const inicio = document.createElement('button');
  inicio.className = 'boton';
  inicio.dataset.test = 'ir-inicio';
  inicio.textContent = 'Inicio';
  inicio.addEventListener('click', irAlHub);

  acciones.append(otra, inicio);
  return acciones;
}

/** Una cifra destacada (spec v0.1c §6, ronda de corrección 1): número grande
 * arriba, etiqueta pequeña debajo. `animarConteo` sigue animando solo el
 * número (sin la etiqueta dentro del mismo texto, a diferencia de antes). */
function construirCifraDestacada(etiquetaTexto) {
  const cifra = document.createElement('div');
  cifra.className = 'resumen-cifra';
  const numero = document.createElement('p');
  numero.className = 'resumen-cifra-numero';
  const etiqueta = document.createElement('p');
  etiqueta.className = 'resumen-cifra-etiqueta';
  etiqueta.textContent = etiquetaTexto;
  cifra.append(numero, etiqueta);
  return { cifra, numero };
}

/** Tarjeta 0 del resumen (spec v0.1c §6): cifras de la partida (aciertos y XP
 * como dos cifras destacadas, áreas en una línea pequeña con sus nombres
 * legibles) y, según haya o no algo que repasar, la pista de deslizar o el
 * mensaje vacío con los botones directos (sin deslizar a ningún sitio, ya que
 * en ese caso esta es también la última tarjeta del mazo). Todo centrado como
 * un solo bloque (ronda de corrección 1: antes eran dos líneas de texto
 * planas, sin jerarquía, y las áreas salían con su id sin traducir). */
function construirTarjetaCifras({ aciertos, totalPreguntas, xpTotal, areas }) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta';
  tarjeta.dataset.test = 'resumen-cifras';

  const contenido = document.createElement('div');
  contenido.className = 'tarjeta-contenido';

  const resultado = document.createElement('div');
  resultado.className = 'resumen-resultado';
  const { cifra: cifraAciertos, numero: numeroAciertos } = construirCifraDestacada('Aciertos');
  const { cifra: cifraXp, numero: numeroXp } = construirCifraDestacada('XP ganado');
  resultado.append(cifraAciertos, cifraXp);

  const areasNodo = document.createElement('p');
  areasNodo.className = 'resumen-areas-linea';
  const nombresAreas = [...areas].map(nombreArea);
  areasNodo.textContent = `Áreas: ${nombresAreas.join(', ') || '—'}`;

  const pieN = repasoPartida.length;
  const pie = document.createElement('p');
  pie.className = 'resumen-cifras-pie';
  pie.textContent = pieN > 0 ? `Desliza ↑ para repasar ${pieN}` : 'Sin fallos. Nada que repasar.';

  contenido.append(resultado, areasNodo, pie);
  tarjeta.appendChild(contenido);

  if (pieN === 0) {
    const zonaAccion = document.createElement('div');
    zonaAccion.className = 'tarjeta-accion';
    zonaAccion.appendChild(construirAccionesResumen());
    tarjeta.appendChild(zonaAccion);
  }

  animarConteo(numeroAciertos, '', aciertos, `/${totalPreguntas}`);
  animarConteo(numeroXp, '', xpTotal);

  return tarjeta;
}

/** Sufijo de clase de `.repaso-marca` para cada estado (spec v0.1c §6 + v0.2
 * §2: 'fallo'/'fragil' ya existían, 'acertada' es nuevo). */
function claseRepasoMarca(estadoRepaso) {
  if (estadoRepaso === 'fallada') return 'fallo';
  if (estadoRepaso === 'fragil') return 'fragil';
  return 'acertada';
}

/** Texto de la marca para cada estado (spec v0.1c §6 + v0.2 §2). */
function textoRepasoMarca(estadoRepaso) {
  if (estadoRepaso === 'fallada') return '✗ fallada';
  if (estadoRepaso === 'fragil') return '✓ frágil';
  return '✓ acertada';
}

/** "hoy" (0 días) / "ayer" (1) / "hace N días" (spec v0.2 §2, feed de repaso
 * del HUB: `diasDesde` de ordenarRepaso). */
function textoDiasDesde(dias) {
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/** Una tarjeta de repaso: la MISMA tarjeta respondida (construirTarjetaRespondida,
 * soloLectura: sin confianza ni Siguiente, con "Preguntar a" ya relleno), con
 * una marca añadida justo tras la cabecera de área/nivel. Sirve a DOS orígenes
 * (spec v0.1c §6 y v0.2 §2), distinguidos por si `item.estadoRepaso` es una
 * cadena ('fallada'/'fragil'/'acertada', feed del HUB) o no (repaso de UNA
 * partida ya jugada, resumen):
 *  - Resumen (`repasoPartida`, item = { pregunta, correcta, respuesta, delta }):
 *    `delta` es el REAL de esa respuesta (XP, combo, nivel...) — el bloque de
 *    feedback lo pinta tal cual, como hasta ahora. Marca: fallada/frágil, sin
 *    "hace N días" (misma partida, siempre "hoy").
 *  - Feed del HUB (`ordenarRepaso`, item = { pregunta, tarjeta, estadoRepaso,
 *    diasDesde }): no hay un `delta` real (la respuesta pudo darse en
 *    cualquier partida pasada, incluso antes de v0.2): se construye uno
 *    neutro y se oculta la línea de resultado ("✓ +N XP") en vez de fingir un
 *    XP que no se ganó ahora — la marca de abajo ya dice si acertó o no. El
 *    resto del bloque (combo, cambio de nivel, chips) queda oculto solo, al
 *    ser todo 0/false/null. `hueco.respuesta` (`tarjeta.ultimaRespuesta`)
 *    puede ser `undefined` en una tarjeta anterior a v0.2: tolerado por
 *    construirRespuestaCompacta (marca solo la correcta).
 */
function construirTarjetaRepaso(item, indice, total) {
  const esFeedHub = typeof item.estadoRepaso === 'string';
  const estadoRepaso = esFeedHub ? item.estadoRepaso : item.correcta ? 'fragil' : 'fallada';
  const correcta = esFeedHub ? estadoRepaso !== 'fallada' : item.correcta;
  const respuesta = esFeedHub ? item.tarjeta.ultimaRespuesta : item.respuesta;
  const delta = esFeedHub
    ? {
        xp: 0,
        combo: 0,
        cambioNivelPartida: 0,
        cambioNivelArea: 0,
        confianza: null,
        recuperada: null,
        misionCompletada: false,
        fragil: false,
      }
    : item.delta;

  const hueco = {
    pregunta: item.pregunta,
    correcta,
    respuesta,
    delta,
    reportada: false,
    nodo: null,
  };
  // Contador "n/N" (spec v0.1d §1): la posición de ESTA tarjeta dentro del
  // repaso, fija desde que se construye (a diferencia del contador de la
  // partida, aquí no hace falta refrescarlo: nada cambia el total ni el orden
  // una vez montado el mazo).
  const tarjeta = construirTarjetaRespondida(item.pregunta, hueco, {
    soloLectura: true,
    contadorTexto: `${indice + 1}/${total}`,
  });
  tarjeta.dataset.test = 'repaso-tarjeta';

  if (esFeedHub) {
    // Sin un delta real, "✓ +0 XP" mentiría (spec v0.2 §2): la marca de abajo
    // ya dice si acertó, así que la línea de resultado se oculta entera.
    const feedbackTexto = tarjeta.querySelector('[data-test="feedback-texto"]');
    if (feedbackTexto) feedbackTexto.hidden = true;
  }

  const marca = document.createElement('p');
  marca.className = `repaso-marca repaso-marca--${claseRepasoMarca(estadoRepaso)}`;
  marca.textContent = esFeedHub
    ? `${textoRepasoMarca(estadoRepaso)} · ${textoDiasDesde(item.diasDesde)}`
    : textoRepasoMarca(estadoRepaso);
  tarjeta.querySelector('.pregunta-cabecera').insertAdjacentElement('afterend', marca);

  return tarjeta;
}

/** Última tarjeta del mazo de resumen (spec v0.1c §6), solo cuando hay algo
 * que repasar (si no, la tarjeta 0 ya hace de última: ver construirTarjetaCifras). */
function construirTarjetaFinalResumen() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta tarjeta-cierre';
  tarjeta.dataset.test = 'repaso-final';

  const titulo = document.createElement('p');
  titulo.className = 'mazo-cierre-titulo';
  titulo.textContent = 'Repaso terminado';

  tarjeta.appendChild(titulo);
  tarjeta.appendChild(construirAccionesResumen());
  return tarjeta;
}

/** Construye las tarjetas del mazo de resumen, en orden (spec v0.1c §6):
 * cifras, una por cada elemento de repasoPartida y, si había alguno, la final. */
function construirMazoResumen(cifras) {
  const tarjetas = [construirTarjetaCifras(cifras)];
  const total = repasoPartida.length;
  repasoPartida.forEach((item, i) => tarjetas.push(construirTarjetaRepaso(item, i, total)));
  if (total > 0) tarjetas.push(construirTarjetaFinalResumen());
  return tarjetas;
}

// ============================================================================
// --- Repaso del HUB: feed "sin fin" (spec v0.2 §2, entrega A) ---
// A diferencia del resumen (repaso de UNA partida ya jugada), este mazo cubre
// TODA la historia (`ordenarRepaso`), es filtrable por área y no tiene ni
// principio ni fin de verdad: la tarjeta de cierre solo ofrece "Otra vuelta"
// (remonta al índice 0) o "Volver" (HUB), nunca "0 tarjetas todavía" — el
// botón del HUB ya queda apagado ("Juega primero") cuando no hay nada que
// repasar (ver actualizarDestacados), así que al llegar aquí siempre hay al
// menos una pregunta con tarjeta en estado.tarjetas.
// ============================================================================

/** Última tarjeta del feed de repaso del HUB (spec v0.2 §2): a diferencia de
 * construirTarjetaFinalResumen (resumen de partida), esta SIEMPRE se añade —
 * no hay una "tarjeta 0" que pueda hacer de última cuando el filtro deja la
 * lista vacía (caso raro: todas las tarjetas de esa área se reportaron desde
 * la última vez que se abrió el repaso; ver renderRepaso). */
function construirTarjetaCierreRepaso() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta tarjeta-cierre';
  tarjeta.dataset.test = 'repaso-cierre';

  const titulo = document.createElement('p');
  titulo.className = 'mazo-cierre-titulo';
  titulo.textContent = 'Repaso terminado';
  tarjeta.appendChild(titulo);

  const acciones = document.createElement('div');
  acciones.className = 'resumen-acciones';

  const otraVuelta = document.createElement('button');
  otraVuelta.className = 'boton boton-principal';
  otraVuelta.dataset.test = 'repaso-otra-vuelta';
  otraVuelta.textContent = 'Otra vuelta';
  otraVuelta.addEventListener('click', () => {
    if (mazoRepasoControlador) mazoRepasoControlador.irA(0);
  });

  const volver = document.createElement('button');
  volver.className = 'boton';
  volver.dataset.test = 'repaso-volver';
  volver.textContent = 'Volver';
  volver.addEventListener('click', irAlHub);

  acciones.append(otraVuelta, volver);
  tarjeta.appendChild(acciones);
  return tarjeta;
}

/** Tarjetas del mazo de repaso del HUB para la lista ya filtrada: una por
 * elemento y, siempre, el cierre al final (spec v0.2 §2, "sin fin": al
 * agotar la lista, tarjeta de cierre). */
function construirMazoRepaso(lista) {
  const total = lista.length;
  const tarjetas = lista.map((item, i) => construirTarjetaRepaso(item, i, total));
  tarjetas.push(construirTarjetaCierreRepaso());
  return tarjetas;
}

/** Cuenta cuántas tarjetas de `lista` (ya la del feed completo, sin filtrar)
 * tiene cada área, para apagar en el filtro los chips sin nada que mostrar
 * (spec v0.2 §2: "un área sin tarjetas se muestra apagada"). */
function contarRepasoPorArea(lista) {
  const conteos = {};
  for (const area of AREAS) conteos[area] = 0;
  lista.forEach((item) => {
    conteos[item.pregunta.area] = (conteos[item.pregunta.area] || 0) + 1;
  });
  return conteos;
}

/** Pinta la fila de chips "Todas" + las 8 áreas (spec v0.2 §2): un chip activo
 * a la vez (el de `filtroRepaso`, en cian), apagados los que no tengan
 * ninguna tarjeta en `listaCompleta`. Cambiar de chip guarda el filtro
 * (sessionStorage) y remonta el mazo desde la primera tarjeta (renderRepaso,
 * sin volver a disparar la animación de entrada de la vista). */
function renderFiltroRepaso(listaCompleta) {
  const conteos = contarRepasoPorArea(listaCompleta);
  contenedorFiltroRepaso.innerHTML = '';
  const opciones = [{ area: 'todas', nombre: 'Todas', total: listaCompleta.length }].concat(
    AREAS.map((area) => ({ area, nombre: nombreArea(area), total: conteos[area] }))
  );
  opciones.forEach(({ area, nombre, total }) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'repaso-chip';
    chip.dataset.area = area;
    chip.textContent = nombre;
    chip.disabled = total === 0;
    chip.classList.toggle('repaso-chip--activa', filtroRepaso === area);
    chip.addEventListener('click', () => {
      if (chip.disabled || filtroRepaso === area) return;
      filtroRepaso = area;
      guardarFiltroRepaso(filtroRepaso);
      renderRepaso();
    });
    contenedorFiltroRepaso.appendChild(chip);
  });
  actualizarFiltroRepasoFinal();
}

/** Ronda 1 de revisión (UX): la fila de chips no avisaba de que había más a la
 * derecha. `.repaso-filtro--final` apaga el degradado del borde derecho
 * (ver estilos.css) cuando la fila ya está desplazada hasta el final -- o
 * cuando ni siquiera hace falta scroll porque todo cabe (mismo cálculo:
 * `scrollWidth <= clientWidth` dispara la comparación igual que "ya al
 * final"). Se llama una vez al pintar los chips (renderFiltroRepaso) y en
 * cada evento 'scroll' de la fila (listener añadido una sola vez, más abajo,
 * junto al resto de listeners del fichero). */
function actualizarFiltroRepasoFinal() {
  const alFinal =
    contenedorFiltroRepaso.scrollLeft + contenedorFiltroRepaso.clientWidth >= contenedorFiltroRepaso.scrollWidth - 1;
  contenedorFiltroRepaso.classList.toggle('repaso-filtro--final', alFinal);
}

/** Recalcula el feed completo, pinta los chips y (re)monta el mazo filtrado
 * (spec v0.2 §2): se usa tanto para abrir la vista por primera vez como para
 * remontar tras cambiar de chip — nunca cambia de vista por sí misma (ver
 * abrirRepaso), así que un cambio de filtro no retriggerea la animación de
 * entrada de la vista. */
function renderRepaso() {
  limpiarRepasoMazo();
  const listaCompleta = ordenarRepaso(estado, banco, hoy());
  // El filtro guardado puede apuntar a un área que ya no tiene tarjetas (p.
  // ej. se reportaron todas desde la última vez que se abrió el repaso): se
  // cae a "todas" en vez de dejar la vista vacía en silencio.
  if (filtroRepaso !== 'todas' && !listaCompleta.some((item) => item.pregunta.area === filtroRepaso)) {
    filtroRepaso = 'todas';
    guardarFiltroRepaso(filtroRepaso);
  }
  renderFiltroRepaso(listaCompleta);
  const lista =
    filtroRepaso === 'todas' ? listaCompleta : listaCompleta.filter((item) => item.pregunta.area === filtroRepaso);
  contenedorMazoRepaso.innerHTML = '';
  mazoRepasoControlador = montarMazo(contenedorMazoRepaso, construirMazoRepaso(lista), {
    contarPista: false,
    puntosNeutros: true,
  });
}

/** Abre la vista de repaso del HUB (botón `data-test="repaso-hub"`, spec v0.2
 * §2): solo se llega aquí cuando el botón está tocable (hay al menos una
 * tarjeta en estado.tarjetas, ver actualizarDestacados). */
function abrirRepaso() {
  renderRepaso();
  mostrarVista('repaso');
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

/** Pinta las tres tarjetas destacadas del hub (Misión de hoy, Pendientes y
 * Repaso): texto, y si son tocables (aria-disabled + dataset.tocable cuando
 * no). Repaso (spec v0.2 §2) se apaga con "Juega primero" cuando no hay
 * NINGUNA tarjeta todavía (estado.tarjetas vacío) — a diferencia de Pendientes,
 * no depende de cuántas haya AHORA MISMO pendientes: el feed de repaso
 * siempre tiene algo que mostrar en cuanto se ha jugado una sola vez. */
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

  if (Object.keys(estado.tarjetas).length === 0) {
    nodoRepasoHub.textContent = 'Juega primero';
    marcarNoTocable(nodoRepasoHub);
  } else {
    nodoRepasoHub.textContent = 'Repaso';
    marcarTocable(nodoRepasoHub);
  }
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
// Repaso (spec v0.2 §2): feed "sin fin" de todo lo jugado, filtrable por área.
nodoRepasoHub.addEventListener('click', () => {
  if (nodoRepasoHub.dataset.tocable !== 'true') return;
  abrirRepaso();
});
// Degradado de "hay más chips a la derecha" (ronda 1 de revisión): un solo
// listener de scroll para toda la vida de la app (los chips se recrean en
// cada renderFiltroRepaso, pero el contenedor .repaso-filtro nunca).
contenedorFiltroRepaso.addEventListener('scroll', actualizarFiltroRepasoFinal);
// "←" (cabecera): del HUB a inicio; de pregunta/resumen, siempre al HUB.
// "Otra partida"/"Inicio" del resumen ya no son botones estáticos: viven
// dentro del mazo de repaso (ver construirAccionesResumen).
document.querySelector('[data-test="volver"]').addEventListener('click', manejarVolver);
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
