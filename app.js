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
  listarNoRespondidas,
  AREAS,
} from './motor.js';
import { construirVisual } from './visuales.js';
import { montarMazo, ajustarEncaje, mazosActivos } from './mazo.js';
import {
  guardarConfiguracionDesdeUrl,
  guardarConfiguracionDesdeTexto,
  leerConfiguracion,
  leerBancoExtra,
  fusionarBancoExtra,
  sincronizarEstado,
  reportarAlServidor,
  pedirSubtemas,
  pedirTanda,
  consultarTrabajo,
} from './sincronizacion.js';
import { crearEstadoAtomo, avanzar, retroceder, crearAtomo } from './atomo.js';
import { leerTanda, guardarTanda, borrarTanda, calcularRestanteSeg, formatearRestante } from './tanda.js';

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
// `bancoLocal` (datos/banco.json, nunca cambia tras iniciar()) + `leerBancoExtra()` (servidor,
// v0.2b2 §4). `banco` se reconstruye entera cada vez que el servidor trae preguntas nuevas
// (reconstruirBanco) para que el repaso y la partida en curso (que leen la variable `banco` del
// módulo en cada llamada, no una copia) las vean sin recargar la página.
let bancoLocal = [];
// Ids de bancoLocal (Ronda 1 de revisión, Important #2): se pasa a fusionarBancoExtra para que
// una pregunta del servidor nunca pise silenciosamente a una del banco local por colisión de id
// (en teoría no debería pasar -- los ids del servidor van siempre prefijados `srv-` -- pero es
// una comprobación barata de más, ver sincronizacion.js#fusionarBancoExtra).
let idsBancoLocal = new Set();
let banco = [];
let bancoPorId = new Map();
// 'gris' (sin servidor / aún sin confirmar esta sesión) | 'verde' (sincronizado hoy) | 'ambar'
// (hay servidor configurado pero el último intento falló) -- ver actualizarPuntoServidor.
let estadoServidor = 'gris';
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

// Mazo del REPASO del HUB (feed "sin fin", spec v0.2 §2, infinito con todo el
// banco desde v0.2a.1 §7): se monta en abrirRepaso()/renderRepaso() sobre
// #mazo-repaso y se destruye al abandonar la vista (irAlHub/irAInicioEmojis,
// vía limpiarPartidaEnCurso) o antes de remontarlo con otro filtro. Nada que
// ver con mazoResumenControlador (el repaso de UNA partida ya jugada): este
// es el feed de TODO el banco (lo respondido + lo que falta por responder).
let mazoRepasoControlador = null;
// Huecos del repaso (I1, ronda final de revisión de rendimiento: abrir el
// repaso con el banco real construía las ~295 tarjetas de golpe, 2,5 s con
// CPU x4). Mismo mecanismo que el mazo de la partida (`mazo`/`rellenarHueco`
// en app.js): cada hueco conoce ya su item, su posición y el total de SU
// vuelta (baratos, sin DOM), pero `nodo` se queda `null` hasta la PRIMERA VEZ
// que se llega a él (`mantenerVueltasRepaso`/`asegurarRepasoConstruidoHasta`
// construyen como mucho uno por deslizamiento). `repasoVueltaTamanos` es el
// tamaño de cada VUELTA dentro de `repasoHuecos`, en el mismo orden (spec
// v0.2a.1 §7, "sin fin": se van conociendo vueltas completas — barato — y se
// retiran las más antiguas ya recorridas del todo, máximo ~2 vueltas).
let repasoHuecos = [];
let repasoVueltaTamanos = [];
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

// --- Átomo (spec v0.2b2 §4): estado de la ruta elegida, instancia del SVG, y el trabajo de
// generación en curso (Generar -> espera -> chip "Tanda lista"). Todo module-level porque, a
// diferencia del mazo, el sondeo del trabajo sigue corriendo aunque el jugador navegue a otra
// vista (jugar/repasar "mientras" se genera) -- solo se detiene al llegar a un estado final o al
// cerrar la app (pagehide).
let atomoEstado = null; // {area, ruta, etiquetas} (atomo.js#crearEstadoAtomo); null = vista no abierta.
let atomoInstancia = null; // devuelto por crearAtomo(): {actualizar, destruir}.
let atomoPeticionId = 0; // contador para descartar respuestas de pedirSubtemas ya obsoletas.
let atomoTrabajoId = null; // id del trabajo en curso (Generar); null = no hay ninguno activo.
let atomoTrabajoInfo = null; // {corto} de la ruta que se pidió, para el texto de espera/chip.
let atomoSondeoId = null; // setInterval de consultarTrabajo (cada 5s).
let atomoTandaLista = null; // {ids, corto} de la última tanda lista/parcial; null = sin chip que mostrar.
// Ronda 1 de revisión (Critical): true justo entre el click en Generar y que `pedirTanda` resuelve
// -- `atomoTrabajoId` no sirve de guarda ahí porque solo se fija DESPUÉS del await, así que dos
// toques rápidos alcanzaban a mandar dos POST /generar antes de que el primero volviera. Ver
// actualizarBotonGenerarAtomo/manejarGenerarAtomo.
let atomoGenerarEnVuelo = false;
// Ronda final de revisión (Important #5): evita solapar dos consultarTrabajo a la vez (el
// intervalo de 5s y un `visibilitychange` casi al mismo tiempo, por ejemplo).
let atomoSondeoEnVuelo = false;
// Ronda final de revisión (Critical #8): tope de sondeos por trabajo -- se resetea a 0 solo al
// arrancar un trabajo NUEVO (manejarGenerarAtomo), nunca al pausar/reanudar (visibilitychange), o
// un jugador que minimizara y volviera a abrir la app cada minuto alargaría el sondeo para siempre.
let atomoConsultas = 0;
// Ola final v0.2b4 (Critical C2): sondeos SEGUIDOS que no han podido preguntar (red caída, 5xx,
// timeout) -- NO cuentan los 404, que sí significan "el trabajo ya no existe". Un sondeo que
// responde lo pone a 0. Se reinicia también en iniciarSondeoAtomo: cada arranque/reanudación del
// sondeo empieza con la tolerancia entera, si no un corte antiguo condenaría al primer fallo nuevo.
let atomoSondeosFallidos = 0;
// Ronda final de revisión (Critical #2): qué hace el botón único de la tarjeta de espera una vez
// resuelto el trabajo -- {tipo:'jugar', ids, corto} o {tipo:'volver'}; null mientras se sigue
// generando (esperaAtomo muestra los dos botones de siempre, no este).
let atomoEsperaResultado = null;

// --- Indicador de tanda (v0.2b4 §1 y §2): sustituye al chip "tanda-lista" del HUB. `atomoTandaInicio`
// y `atomoTandaPedidas` son la copia en memoria de lo que vive en `localStorage` (tanda.js), para
// poder calcular el restante sin releer la clave en cada sondeo. `atomoTandaSegPorPregunta` es lo
// último que dijo el servidor (`/trabajo/:id`, Tarea 3), la estimación mientras no hay ninguna hecha.
let atomoTandaInicio = null;
let atomoTandaPedidas = 0;
let atomoTandaSegPorPregunta = null;
let atomoTandaEstado = null; // 'en-curso' | 'lista' | 'fallo' | null (decide qué hace el toque)
let indicadorTandaTimeoutId = null; // los 6 s del aviso de fallo antes de esconderse solo

// --- Átomo dinámico (v0.2b3 Tarea 3, "Ampliación"): nodo "Más…", paginación y transición
// inmediata al tocar (sin órbita giratoria, nodos de espera mientras se pide el anillo). ---
// `mostrados` por anillo: completos ya mostrados en ESE anillo (decisión del controlador,
// indexado por JSON.stringify(ruta) aunque en la práctica solo se lee/escribe la clave del anillo
// vigente -- se reinicia entero al avanzar o retroceder a otra ruta, así "Más…" siempre empieza en
// la página 1 al volver a visitar un anillo).
let atomoMostrados = new Map();
let atomoSubtemasActuales = []; // últimos subtemas pintados con éxito en el anillo vigente (para
// restaurarlos si una página de "Más…" llega vacía).
let atomoCargando = false; // true mientras /subtemas está en vuelo para el anillo vigente.
let atomoFallo = false; // true tras un pedirSubtemas que devolvió null (aviso + Reintentar).
let atomoAvisoLentoId = null; // setTimeout de 20s: "los modelos gratis van lentos...".
let atomoTopeTimeoutId = null; // setTimeout de 2s del aviso "Máximo detalle: toca Generar".

// --- referencias a nodos ---
const nodoRacha = document.querySelector('[data-test="racha"]');
const nodoNivelPartida = document.querySelector('[data-test="nivel-partida"]');
// Ronda de corrección 1 del indicador de tanda (Plan B, segunda fila bajo la cabecera): su borde
// inferior real es lo que mide `posicionarIndicadorTanda` para no solaparla.
const nodoCabecera = document.querySelector('.cabecera');
// `<main>`: `reservarHuecoIndicadorTanda` le añade un padding-top mientras el indicador está
// visible, para que ninguna vista quede tapada bajo él (ver esa función).
const nodoContenidoApp = document.querySelector('main#app');
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
// Servidor de generación (v0.2b2 §4): punto de estado junto a "Comenzar" y chip de banco extendido.
const nodoEstadoServidor = document.querySelector('[data-test="estado-servidor"]');
const nodoNuevasServidor = document.querySelector('[data-test="nuevas-servidor"]');
const nodoIndicadorTanda = document.querySelector('[data-test="indicador-tanda"]');
const nodoIndicadorTandaTexto = document.querySelector('[data-test="indicador-tanda-texto"]');
const nodoIndicadorTandaAvance = document.querySelector('[data-test="indicador-tanda-anillo"]');
// Átomo (v0.2b2 §4).
const nodoAtomoRuta = document.querySelector('[data-test="atomo-ruta"]');
const nodoAtomoEstadoServidor = document.querySelector('[data-test="atomo-estado-servidor"]');
const nodoAtomoLienzo = document.querySelector('[data-test="atomo-lienzo"]');
const nodoAtomoAviso = document.querySelector('[data-test="atomo-aviso"]');
const nodoAtomoReintentar = document.querySelector('[data-test="atomo-reintentar"]');
const nodoAtomoAtras = document.querySelector('[data-test="atomo-atras"]');
const nodoAtomoGenerar = document.querySelector('[data-test="atomo-generar"]');
const nodoAtomoRutaCompleta = document.querySelector('[data-test="atomo-ruta-completa"]');
const nodoAtomoAyuda = document.querySelector('[data-test="atomo-ayuda"]');
// Fila "mientras" (v0.2b3 Tarea 3): "Jugar el área"/"Repasar" visibles mientras el anillo carga,
// mientras se genera una tanda en segundo plano, o si el anillo falló al cargar.
const nodoAtomoMientras = document.querySelector('[data-test="atomo-mientras"]');
const nodoAtomoEsperaTexto = document.querySelector('[data-test="atomo-espera-texto"]');
const nodoAtomoEsperaAcciones = document.querySelector('[data-test="atomo-espera-acciones"]');
const nodoAtomoEsperaResultado = document.querySelector('[data-test="atomo-espera-resultado"]');
// Hoja "Conectar" (v0.2b3 Tarea 4, "Conectar desde la app instalada"): en iOS la app añadida a la
// pantalla de inicio tiene almacenamiento SEPARADO de Safari, así que el enlace de conexión
// abierto en Safari no llega aquí -- esta hoja deja pegar el enlace (o "servidor token") a mano.
const nodoConectar = document.querySelector('[data-test="conectar"]');
const nodoConectarTexto = document.querySelector('[data-test="conectar-texto"]');
const nodoConectarError = document.querySelector('[data-test="conectar-error"]');
const nodoConectarHecho = document.querySelector('[data-test="conectar-hecho"]');
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
  // Ronda de corrección 1 (Plan B, segunda fila bajo la cabecera): mostrar/ocultar `modoArea` puede
  // cambiar la ALTURA de la cabecera (tercera línea en `.cabecera-estado`) -- si el indicador de
  // tanda ya está visible, se reposiciona para seguir pegado justo debajo.
  posicionarIndicadorTanda();
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
  repasoHuecos = [];
  repasoVueltaTamanos = [];
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
  limpiarAtomo(); // el SVG y la ruta elegida, NO el trabajo/sondeo en curso si lo hubiera (spec §4).
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

// --- servidor de generación (v0.2b2 §4): banco extendido, punto de estado, chip de nuevas ---

/** Reconstruye `banco`/`bancoPorId` a partir de `bancoLocal` (fijo) + `leerBancoExtra()`
 * (localStorage, cambia cuando el servidor trae preguntas nuevas). Se llama al arrancar y cada
 * vez que `fusionarBancoExtra` añade algo: como `ordenarRepaso`/`listarNoRespondidas`/
 * `siguientePregunta` reciben `banco` en cada llamada (no una copia guardada), lo ven sin recargar. */
function reconstruirBanco() {
  banco = [...bancoLocal, ...leerBancoExtra()];
  bancoPorId = new Map(banco.map((p) => [p.id, p]));
}

// Ronda de revisión combinada (Tarea 4, Important — corrección de una instrucción anterior del
// controlador): los dos puntos de estado son botones desde esta misma ronda (abren la hoja
// "Conectar", ver más abajo), pero su `aria-label` NO debe fijarse a un texto de acción genérico
// ("Estado del servidor") -- debe seguir comunicando el estado real (gris/verde/ámbar), igual que
// antes de que fueran interactivos, con un empujón hacia la acción en el estado gris (el que de
// verdad invita a tocar).
const ETIQUETA_ESTADO_SERVIDOR = {
  gris: 'Servidor sin conectar, toca para conectar',
  verde: 'Servidor conectado',
  ambar: 'Servidor sin sincronizar hoy',
};

// Tarea 4 (v0.2b3, "Conectar desde la app instalada"): textos de `.atomo-ayuda`, la pista fija
// que vive bajo la ruta completa del Átomo (ver actualizarAyudaAtomo).
const TEXTO_AYUDA_ATOMO_DEFECTO = 'Mantén pulsada un área del HUB para abrir su átomo';
const TEXTO_AYUDA_ATOMO_SIN_SERVIDOR = 'Conecta el servidor (toca el punto de la cabecera)';

/** `.atomo-ayuda` (Tarea 4): sin servidor configurado, pasa a explicar cómo conectar uno en vez
 * del texto por defecto -- se llama desde `actualizarPuntoServidor` (mismo disparador que decide
 * el color del punto) para no tener que acordarse de llamarla aparte en cada sitio que cambia la
 * configuración. */
function actualizarAyudaAtomo() {
  nodoAtomoAyuda.textContent = leerConfiguracion() ? TEXTO_AYUDA_ATOMO_DEFECTO : TEXTO_AYUDA_ATOMO_SIN_SERVIDOR;
}

/** Pinta el punto junto a "Comenzar" (data-estado + aria-label) según `estadoServidor`. También el
 * mismo punto duplicado en la cabecera del Átomo (v0.2b2 §4, decisión #1 del controlador; Tarea 4 +
 * revisión combinada: los dos son ahora también botones que abren la hoja "Conectar", ver más
 * abajo, pero eso no cambia qué anuncia su `aria-label` -- sigue siendo el estado real
 * (`ETIQUETA_ESTADO_SERVIDOR`), no una descripción genérica de la acción). */
function actualizarPuntoServidor() {
  nodoEstadoServidor.dataset.estado = estadoServidor;
  nodoEstadoServidor.setAttribute('aria-label', ETIQUETA_ESTADO_SERVIDOR[estadoServidor]);
  nodoAtomoEstadoServidor.dataset.estado = estadoServidor;
  nodoAtomoEstadoServidor.setAttribute('aria-label', ETIQUETA_ESTADO_SERVIDOR[estadoServidor]);
  actualizarAyudaAtomo();
}

// Ids de la última tanda de "modo normal" que de verdad están en el banco (spec v0.2b4 §3): el chip
// ya no solo se cierra, arranca una partida con ellas. Se limpian al jugarlas.
let nuevasServidorIds = [];
const MAX_PARTIDA_NUEVAS = 10; // una partida son 10 tarjetas; el resto se queda en el banco

/** Chip "N preguntas nuevas · Jugar" (data-test="nuevas-servidor"): aparece con el recuento de
 * `fusionarBancoExtra` y, al tocarlo, arranca la partida con las 10 primeras por prioridad (el
 * servidor ya las manda ordenadas, ver servidor/cola.js#servir: área más floja primero y, a
 * igualdad, la más antigua). Las que sobren siguen en el banco, disponibles como cualquier otra. */
function mostrarChipNuevas(anadidas, ids = []) {
  nuevasServidorIds = ids.slice(0, MAX_PARTIDA_NUEVAS);
  const cuantas = anadidas === 1 ? '1 pregunta nueva' : `${anadidas} preguntas nuevas`;
  nodoNuevasServidor.textContent = `${cuantas} · Jugar`;
  nodoNuevasServidor.setAttribute('aria-label', `Jugar ${nuevasServidorIds.length} preguntas nuevas`);
  nodoNuevasServidor.hidden = false;
}

/** "Modo normal" (spec v0.2 §4): al abrir y al terminar cada partida, en segundo plano (nunca
 * bloquea la UI ni lanza). Sin configuración guardada, `sincronizarEstado` no hace ninguna
 * petición y el punto se queda gris. Con configuración: verde si respondió algo válido, ámbar si
 * no (red caída, servidor caído, 401...) -- la app sigue funcionando igual en ambos casos. */
async function sincronizarEnSegundoPlano() {
  if (!leerConfiguracion()) {
    estadoServidor = 'gris';
    actualizarPuntoServidor();
    return;
  }
  const resultado = await sincronizarEstado({ estado, banco, hoy: hoy(), fetchImpl: fetch });
  estadoServidor = resultado ? 'verde' : 'ambar';
  actualizarPuntoServidor();
  if (resultado && resultado.preguntas.length > 0) {
    const { anadidas } = fusionarBancoExtra(resultado.preguntas, estado, idsBancoLocal);
    if (anadidas > 0) {
      reconstruirBanco();
      // Solo los ids que de verdad EXISTEN en el banco tras fusionar (fusionarBancoExtra descarta
      // reportadas y repetidas) -- mismo cuidado que idsUtilizablesDeTanda: un id sin hueco en
      // `bancoPorId` dejaría una tarjeta vacía en la partida.
      const ids = resultado.preguntas.map((p) => p.id).filter((id) => bancoPorId.has(id));
      mostrarChipNuevas(anadidas, ids);
    }
  }
}

// --- Hoja "Conectar" (v0.2b3 Tarea 4, "Conectar desde la app instalada"): en iOS la app añadida a
// la pantalla de inicio (`display: standalone`) tiene almacenamiento SEPARADO de Safari, así que el
// enlace de conexión abierto en Safari (guardarConfiguracionDesdeUrl, arriba en iniciar()) no llega
// a la app instalada -- esta hoja deja pegar el enlace (o "servidor token") a mano, sin salir de la
// app. Se abre desde dos sitios del Átomo (ver los listeners junto al resto de eventos de
// navegación, más abajo): el punto de estado de su cabecera y su aviso "Conecta el servidor...". ---

let avisoConectadoId = null;
/** "Conectado" 2s (`data-test="conectar-hecho"`) tras guardar la configuración con éxito -- la
 * hoja ya se ha cerrado en ese momento (ver manejarConectarOk), así que este vive fuera de ella,
 * fijo y visible encima de cualquier vista (mismo patrón que mostrarAvisoCuerpo/mostrarAvisoHub). */
function mostrarAvisoConectado() {
  nodoConectarHecho.hidden = false;
  if (avisoConectadoId !== null) clearTimeout(avisoConectadoId);
  avisoConectadoId = setTimeout(() => {
    nodoConectarHecho.hidden = true;
    avisoConectadoId = null;
  }, 2000);
}

// Ronda de revisión combinada (Tarea 4, Important): el botón que abrió la hoja (punto de estado
// del HUB, del Átomo, o el propio aviso del Átomo) -- se le devuelve el foco al cerrar, sin
// importar cómo (Cancelar, Escape o éxito). Sin esto, cerrar un diálogo modal deja el foco de
// teclado "perdido" en <body>, un problema real para quien navega sin ratón/dedo.
let nodoConectarDisparador = null;

/** Abre la hoja con el campo vacío y sin el aviso de error de una vez anterior. */
function abrirHojaConectar() {
  nodoConectarDisparador = document.activeElement;
  nodoConectarError.hidden = true;
  nodoConectarTexto.value = '';
  nodoConectar.hidden = false;
  nodoConectarTexto.focus();
}

/** Escape/Cancelar (brief): cierran y vacían el campo -- el texto pegado no debe sobrevivir a un
 * intento cancelado (ver también el comentario de cabecera de sincronizacion.js#guardarConfiguracionDesdeTexto:
 * nunca se registra ni se guarda salvo la configuración resultante). También la vía de éxito
 * (manejarConectarOk la llama igual) -- así el foco vuelve al disparador en los tres casos, desde
 * un solo sitio. */
function cerrarHojaConectar() {
  nodoConectar.hidden = true;
  nodoConectarTexto.value = '';
  nodoConectarError.hidden = true;
  if (nodoConectarDisparador && typeof nodoConectarDisparador.focus === 'function') {
    nodoConectarDisparador.focus();
  }
  nodoConectarDisparador = null;
}

/** Botón "Conectar": valida y guarda con `guardarConfiguracionDesdeTexto` (sincronizacion.js,
 * mismo saneado que el enlace `?servidor=&token=`). Error: se queda abierta con el aviso, sin
 * tocar la configuración previa (brief). Éxito: cierra, "Conectado" 2s, recarga el anillo del
 * Átomo SI está abierto (ya lo está siempre que se llega aquí -- las dos únicas vías para abrir
 * esta hoja viven dentro del propio Átomo, pero se comprueba igual por si el jugador saliera de
 * la vista mientras la hoja seguía abierta) y sincroniza en segundo plano (fija el punto en verde
 * o ámbar según responda el servidor de verdad, igual que al abrir la app o terminar una partida). */
function manejarConectarOk() {
  const guardado = guardarConfiguracionDesdeTexto(nodoConectarTexto.value);
  if (!guardado) {
    nodoConectarError.hidden = false;
    return;
  }
  cerrarHojaConectar();
  mostrarAvisoConectado();
  actualizarAyudaAtomo(); // feedback inmediato, sin esperar al round-trip de sincronizarEnSegundoPlano
  if (atomoEstado) cargarAnilloAtomo();
  sincronizarEnSegundoPlano();
}

// --- Átomo (spec v0.2b2 §4): elegir un subtema sin teclado, pedir una tanda nueva y esperar
// jugando o repasando mientras se genera ---

const CLAVE_RUTAS_ATOMO = 'one.rutasAtomo';

/** Guarda la ruta pedida al pulsar Generar en `localStorage` (clave `one.rutasAtomo`), con la
 * fecha de hoy -- es lo que `sincronizacion.js#leerRutasAtomoRecientes` lee (últimos 7 días) para
 * mandarlo en el próximo `POST /estado` y que el servidor reparta parte de su colchón nocturno a
 * estas rutas (spec §3.1/§3.3). Esa función lectora no está exportada (Tarea 1 solo expuso el
 * lector; la escritura es de esta tarea) -- incluso así, esto NO toca sincronizacion.js: escribe
 * en la misma clave y con la misma forma que ese lector ya espera. Dedupe por [área, ruta, fecha]
 * para no acumular la misma entrada cada vez que se pulsa Generar dos veces seguidas en la misma
 * ruta el mismo día. */
function guardarRutaAtomo(area, ruta) {
  let guardadas = [];
  try {
    const crudo = localStorage.getItem(CLAVE_RUTAS_ATOMO);
    const datos = crudo ? JSON.parse(crudo) : [];
    if (Array.isArray(datos)) guardadas = datos;
  } catch {
    guardadas = [];
  }
  const fecha = hoy();
  const yaEsta = guardadas.some(
    (r) => r && r.area === area && r.fecha === fecha && JSON.stringify(r.ruta) === JSON.stringify(ruta)
  );
  if (!yaEsta) guardadas.push({ area, ruta, fecha });
  try {
    localStorage.setItem(CLAVE_RUTAS_ATOMO, JSON.stringify(guardadas));
  } catch {
    // localStorage llena o no disponible: mismo criterio que guardarEstado, se sigue en memoria
    // esta sesión sin más.
  }
}

/** Texto del núcleo: el último subtema elegido (corto), o el nombre del área en el anillo 1. */
function nucleoAtomoTexto() {
  const etiquetas = atomoEstado.etiquetas;
  return etiquetas.length > 0 ? etiquetas[etiquetas.length - 1] : nombreArea(atomoEstado.area);
}

/** Migaja de pan de la cabecera ("Economía › Mercados y crisis › ...", una línea con ellipsis) y
 * su gemela legible de la Ronda final (Disposición: "en el hueco inferior, la ruta completa
 * legible, 2 líneas máx.") -- mismo texto en los dos sitios, la diferencia es solo de estilos.css. */
function actualizarCabeceraAtomo() {
  const texto = [nombreArea(atomoEstado.area), ...atomoEstado.etiquetas].join(' › ');
  nodoAtomoRuta.textContent = texto;
  nodoAtomoRutaCompleta.textContent = texto;
}

/** Generar apagado sin servidor, mientras la petición de `pedirTanda` está en vuelo (Ronda 1 de
 * revisión, Critical: guarda contra doble click), o mientras ya hay un trabajo en curso (spec:
 * "un solo trabajo activo a la vez") -- el texto del botón dice por qué en ese último caso.
 * Centralizado aquí (nunca se toca `nodoAtomoGenerar.disabled` a mano en otro sitio) para que
 * cualquier llamada, venga de donde venga, deje el botón en el estado correcto para ESE instante. */
function actualizarBotonGenerarAtomo() {
  if (!leerConfiguracion()) {
    nodoAtomoGenerar.disabled = true;
    nodoAtomoGenerar.textContent = 'Generar';
    return;
  }
  if (atomoGenerarEnVuelo) {
    nodoAtomoGenerar.disabled = true;
    nodoAtomoGenerar.textContent = 'Generar';
    return;
  }
  if (atomoTrabajoId) {
    nodoAtomoGenerar.disabled = true;
    nodoAtomoGenerar.textContent = 'Ya hay una tanda en marcha';
    return;
  }
  nodoAtomoGenerar.disabled = false;
  nodoAtomoGenerar.textContent = 'Generar';
}

/** `nodoAtomoAviso` se reutiliza para tres textos distintos (conectar servidor / fallo al cargar /
 * "Buscando subtemas…" mientras carga) -- `dataset.test` se resetea a 'atomo-aviso' aquí siempre,
 * por si `mostrarCargandoAtomo` lo había dejado en 'atomo-cargando' (ver más abajo). */
function mostrarAvisoAtomo(texto, { reintentar = false } = {}) {
  nodoAtomoAviso.dataset.test = 'atomo-aviso';
  nodoAtomoAviso.textContent = texto;
  nodoAtomoAviso.hidden = false;
  nodoAtomoReintentar.hidden = !reintentar;
}

function ocultarAvisoAtomo() {
  nodoAtomoAviso.dataset.test = 'atomo-aviso';
  nodoAtomoAviso.hidden = true;
  nodoAtomoReintentar.hidden = true;
}

/** Aviso mientras el anillo está en vuelo (`data-test="atomo-cargando"`, brief de la Ampliación):
 * mismo nodo que mostrarAvisoAtomo, pero con su propio data-test mientras dura -- así un test
 * puede distinguir "cargando" de "fallo" sin ambigüedad aunque sea el mismo elemento del DOM. */
function mostrarCargandoAtomo() {
  nodoAtomoAviso.dataset.test = 'atomo-cargando';
  nodoAtomoAviso.textContent = 'Buscando subtemas…';
  nodoAtomoAviso.hidden = false;
  nodoAtomoReintentar.hidden = true;
}

/** Fila `atomo-mientras` ("Jugar el área"/"Repasar"): visible mientras el anillo carga, mientras
 * falló, o mientras una tanda se genera en segundo plano (incluso si el jugador reabrió el átomo
 * de OTRA área entre tanto) -- oculta solo cuando no hay nada de eso en vuelo (brief). */
function actualizarFilaMientras() {
  nodoAtomoMientras.hidden = !(atomoCargando || atomoFallo || Boolean(atomoTrabajoId));
}

/** Clave de `atomoMostrados` para el anillo vigente. */
function claveAnilloAtomo() {
  return JSON.stringify(atomoEstado.ruta);
}

/** Arranca el estado "cargando" de un anillo: aviso, fila-mientras, y el aviso de lentitud a los
 * 20s (brief: "si la carga supera 20s, la ayuda dice..."). Común a cargarAnilloAtomo y
 * manejarMasAtomo -- cualquier petición a /subtemas pasa por aquí. */
function empezarCargaAtomo() {
  atomoCargando = true;
  atomoFallo = false;
  mostrarCargandoAtomo();
  actualizarFilaMientras();
  clearTimeout(atomoAvisoLentoId);
  atomoAvisoLentoId = setTimeout(() => {
    if (!atomoCargando) return; // ya resolvió o se canceló (Atrás) antes de los 20s
    nodoAtomoAviso.textContent = 'Los modelos gratis van lentos; puedes jugar o repasar mientras';
  }, 20000);
}

/** Cierra el estado "cargando" (éxito, fallo o cancelación por Atrás) -- deja de avisar de
 * lentitud y actualiza la fila-mientras acorde al resto del estado (fallo/trabajo en curso). */
function terminarCargaAtomo() {
  atomoCargando = false;
  clearTimeout(atomoAvisoLentoId);
  atomoAvisoLentoId = null;
  actualizarFilaMientras();
}

/** "Máximo detalle: toca Generar" (brief, tope de 6 anillos): elemento propio con
 * `data-test="atomo-tope"`, creado una sola vez y reutilizado -- vive junto al aviso de siempre,
 * no lo sustituye (ese sigue disponible para "conectar servidor"/"fallo al cargar"). */
let nodoAtomoTope = null;
function mostrarAvisoTopeAtomo() {
  if (!nodoAtomoTope) {
    nodoAtomoTope = document.createElement('p');
    nodoAtomoTope.className = 'atomo-aviso';
    nodoAtomoTope.dataset.test = 'atomo-tope';
    nodoAtomoAviso.insertAdjacentElement('afterend', nodoAtomoTope);
  }
  nodoAtomoTope.textContent = 'Máximo detalle: toca Generar';
  nodoAtomoTope.hidden = false;
  clearTimeout(atomoTopeTimeoutId);
  atomoTopeTimeoutId = setTimeout(() => {
    nodoAtomoTope.hidden = true;
  }, 2000);
}

/** "No se pudo cargar más" (Ronda de revisión combinada, Tarea 3+4, Important): "Regenerar temas"
 * (v0.2b4 §5, antes "Más…") con un error real (network/HTTP -- 400 "Exclusión inválida" incluido,
 * si el `excluir` disparara ese límite pese al recorte de `sincronizacion.js#pedirSubtemas`),
 * DISTINTO de "agotado" (el servidor respondió `[]` de verdad, ver `manejarMasAtomo` más abajo: esa
 * rama sí usa `atomoInstancia.actualizar(..., {masVacio:true})`, una opción de atomo.js). Mismo
 * patrón que `mostrarAvisoTopeAtomo` -- elemento propio creado una sola vez, para no tocar
 * atomo.js: "Regenerar temas" sigue pulsable, los subtemas ya pintados no cambian. */
let nodoAtomoMasError = null;
let atomoMasErrorTimeoutId = null;
function mostrarErrorMasAtomo() {
  if (!nodoAtomoMasError) {
    nodoAtomoMasError = document.createElement('p');
    nodoAtomoMasError.className = 'atomo-aviso';
    nodoAtomoMasError.dataset.test = 'atomo-mas-error';
    nodoAtomoAviso.insertAdjacentElement('afterend', nodoAtomoMasError);
  }
  nodoAtomoMasError.textContent = 'No se pudo cargar más';
  nodoAtomoMasError.hidden = false;
  clearTimeout(atomoMasErrorTimeoutId);
  atomoMasErrorTimeoutId = setTimeout(() => {
    nodoAtomoMasError.hidden = true;
  }, 2000);
}

/** Pide el anillo correspondiente a `atomoEstado.ruta` y lo pinta. Decisión #1 del controlador:
 * sin servidor configurado, núcleo solo (sin nodos) con el aviso de conectar servidor y Generar
 * apagado; con servidor pero `pedirSubtemas` devolviendo null, aviso de fallo + "Reintentar" --
 * Generar sigue disponible en ese caso (no depende del anillo actual, solo de la ruta YA
 * confirmada). `atomoPeticionId` descarta una respuesta tardía si el jugador ya avanzó/retrocedió
 * antes de que esta llegara (evita que un anillo viejo pise al nuevo).
 *
 * v0.2b3 Tarea 3 ("Ampliación"): la cabecera/núcleo ya cambiaron ANTES de llamar aquí (ver
 * manejarElegirSubtemaAtomo/manejarAtomoAtras) -- esta función solo añade el resto del cambio de
 * pantalla "YA": nodos de espera mientras `pedirSubtemas` está en vuelo, en vez de dejar pintado
 * el anillo anterior (pulsable, generando la ruta de basura que vio Carlos en el iPhone). */
async function cargarAnilloAtomo() {
  if (!atomoEstado) return; // adversarial A7: la vista pudo cerrarse justo antes de esta llamada.
  actualizarCabeceraAtomo();
  actualizarBotonGenerarAtomo();
  nodoAtomoAtras.disabled = atomoEstado.ruta.length === 0;

  const configuracion = leerConfiguracion();
  if (!configuracion) {
    terminarCargaAtomo();
    atomoFallo = false;
    actualizarFilaMientras();
    atomoInstancia.actualizar([], nucleoAtomoTexto());
    mostrarAvisoAtomo('Conecta el servidor para generar preguntas nuevas');
    return;
  }

  empezarCargaAtomo();
  atomoInstancia.actualizar([], nucleoAtomoTexto(), { esperando: true });

  const idPeticion = (atomoPeticionId += 1);
  const subtemas = await pedirSubtemas({ area: atomoEstado.area, ruta: atomoEstado.ruta, fetchImpl: fetch });
  if (idPeticion !== atomoPeticionId || !atomoEstado) return; // ya no es la petición vigente

  terminarCargaAtomo();
  if (subtemas === null) {
    atomoFallo = true;
    actualizarFilaMientras();
    atomoInstancia.actualizar([], nucleoAtomoTexto());
    mostrarAvisoAtomo('No se pudieron cargar los subtemas', { reintentar: true });
    return;
  }
  ocultarAvisoAtomo();
  atomoMostrados.set(claveAnilloAtomo(), subtemas.map((s) => s.completo));
  atomoSubtemasActuales = subtemas;
  atomoInstancia.actualizar(subtemas, nucleoAtomoTexto(), { conMas: true });
}

/** "Regenerar temas" (v0.2b4 §5, antes "Más…"): pide la siguiente página del anillo VIGENTE (misma
 * ruta, `excluir` = lo ya mostrado) -- no avanza de anillo, así que pasa por el mismo estado
 * "cargando" que cargarAnilloAtomo pero sin tocar la cabecera/ruta (no cambian).
 *
 * Ronda de revisión combinada (Tarea 3+4, Important): página `null` (cualquier error real --
 * network/HTTP) y página `[]` (el servidor respondió de verdad "no hay más subtemas") ya NO se
 * tratan igual. Antes ambas caían en la misma rama "agotado", así que un 400 "Exclusión inválida"
 * (que `pedirSubtemas` convierte en `null`, como cualquier otro fallo) dejaba el anillo roto en
 * silencio a partir de ese toque -- ahora `null` avisa "No se pudo cargar más" 2s
 * (`mostrarErrorMasAtomo`) y deja "Regenerar temas" operativo, sin marcar el anillo como agotado.
 * Página vacía de verdad: revierte a los subtemas anteriores con "No hay más por ahora" 2s
 * (atomo.js#actualizar `masVacio`) y vuelve a "Regenerar temas", igual que siempre. */
async function manejarMasAtomo() {
  if (!atomoEstado || atomoCargando) return;
  const clave = claveAnilloAtomo();
  const mostrados = atomoMostrados.get(clave) || [];
  const subtemasPrevios = atomoSubtemasActuales;

  empezarCargaAtomo();
  atomoInstancia.actualizar([], nucleoAtomoTexto(), { esperando: true });

  const idPeticion = (atomoPeticionId += 1);
  const subtemas = await pedirSubtemas({
    area: atomoEstado.area,
    ruta: atomoEstado.ruta,
    excluir: mostrados,
    fetchImpl: fetch,
  });
  if (idPeticion !== atomoPeticionId || !atomoEstado) return;

  terminarCargaAtomo();
  // Ronda final de arreglos (revisión, 14-sep-2026) -- Important (C3): terminarCargaAtomo() no
  // toca `nodoAtomoAviso` (solo la fila-mientras) -- sin esto, "Buscando subtemas…" (puesto por
  // empezarCargaAtomo/mostrarCargandoAtomo unas líneas arriba) se quedaba fijo bajo el anillo
  // recién cargado, en las TRES ramas de abajo (éxito, error, página vacía): ni mostrarErrorMasAtomo
  // ni el `masVacio` de más abajo tocan este nodo, solo crean/reutilizan uno propio aparte.
  ocultarAvisoAtomo();
  if (subtemas === null) {
    // Error real (network/HTTP, 400 "Exclusión inválida" incluido): NO es "agotado" -- se
    // restaura el anillo tal y como estaba (subtemasPrevios === atomoSubtemasActuales aquí, nada
    // se reasignó todavía) y "Más…" sigue disponible para reintentar.
    atomoInstancia.actualizar(subtemasPrevios, nucleoAtomoTexto(), { conMas: true });
    mostrarErrorMasAtomo();
    return;
  }
  if (subtemas.length === 0) {
    atomoInstancia.actualizar(subtemasPrevios, nucleoAtomoTexto(), { conMas: true, masVacio: true });
    setTimeout(() => {
      if (idPeticion !== atomoPeticionId || !atomoEstado) return; // ya no vigente
      atomoInstancia.actualizar(atomoSubtemasActuales, nucleoAtomoTexto(), { conMas: true });
    }, 2000);
    return;
  }
  atomoMostrados.set(clave, [...mostrados, ...subtemas.map((s) => s.completo)]);
  atomoSubtemasActuales = subtemas;
  atomoInstancia.actualizar(subtemas, nucleoAtomoTexto(), { conMas: true });
}

/** Tocar un nodo real: la cabecera/ruta/núcleo cambian AL INSTANTE (síncrono, antes de pedir nada
 * al servidor) -- "al clicar tiene que pasar algo, cambiar la pantalla aunque sea mientras carga"
 * (Carlos, 22:11). `cargarAnilloAtomo` se encarga del resto (nodos de espera + la petición). */
function manejarElegirSubtemaAtomo(subtema) {
  const nuevoEstado = avanzar(atomoEstado, subtema);
  if (nuevoEstado === atomoEstado) {
    mostrarAvisoTopeAtomo(); // ya en el máximo de 6 anillos (atomo.js#avanzar)
    return;
  }
  atomoEstado = nuevoEstado;
  atomoMostrados = new Map(); // nuevo anillo: "Más…" empieza de página 1 (decisión del controlador)
  cargarAnilloAtomo();
}

/** Atrás cancela cualquier carga en vuelo (brief: "Atrás durante la carga") -- invalida la
 * petición pendiente con `atomoPeticionId` y repinta el anillo anterior, que `pedirSubtemas` sirve
 * de su propia caché en memoria si ya se había visitado. */
function manejarAtomoAtras() {
  const nuevoEstado = retroceder(atomoEstado);
  if (nuevoEstado === atomoEstado) return; // ya en el anillo 1, nada que hacer
  atomoPeticionId += 1; // invalida la petición vigente (si la había) antes de cambiar de ruta
  terminarCargaAtomo();
  atomoEstado = nuevoEstado;
  atomoMostrados = new Map();
  cargarAnilloAtomo();
}

/** Abre el Átomo del área `area` (mantener pulsada una tarjeta del HUB, o su botón "⚛"). */
function abrirAtomo(area) {
  atomoEstado = crearEstadoAtomo(area);
  atomoMostrados = new Map();
  atomoFallo = false;
  if (atomoInstancia) atomoInstancia.destruir();
  atomoInstancia = crearAtomo({
    contenedor: nodoAtomoLienzo,
    area: nombreArea(area),
    subtemas: [],
    alElegir: manejarElegirSubtemaAtomo,
    alVolver: manejarAtomoAtras,
    alMas: manejarMasAtomo,
  });
  mostrarVista('atomo');
  cargarAnilloAtomo();
}

/** Desmonta el Átomo (SVG + estado de ruta), sin tocar el trabajo/sondeo en curso si lo hubiera
 * -- ver limpiarPartidaEnCurso, que es quien la llama al salir hacia el HUB o los emojis. */
function limpiarAtomo() {
  if (atomoInstancia) {
    atomoInstancia.destruir();
    atomoInstancia = null;
  }
  atomoEstado = null;
  atomoFallo = false;
  terminarCargaAtomo(); // cancela el aviso de lentitud pendiente y actualiza la fila-mientras
  ocultarAvisoAtomo(); // adversarial A7: barato, aunque la vista oculta ya lo impide visualmente.
}

const TOPE_SONDEOS_ATOMO = 120; // Ronda final (Important #8): ~10 min a 5s/sondeo.
// Ola final v0.2b4 (Critical C2): fallos de red SEGUIDOS que se aguantan antes de parar el sondeo
// -- 5 x 5 s ≈ 25 s, de sobra para un túnel, un cambio de wifi a datos o un servidor reiniciándose.
const MAX_SONDEOS_FALLIDOS = 5;
const UMBRAL_ANTICIPADO_ATOMO = 5; // chip adelantado MIENTRAS sigue en curso (no detiene el sondeo).
const N_TANDA_ATOMO = 10; // preguntas por tanda del Átomo (lo que se pide y lo que cuenta el indicador)

function detenerSondeoAtomo() {
  if (atomoSondeoId !== null) {
    clearInterval(atomoSondeoId);
    atomoSondeoId = null;
  }
}

function finalizarTrabajoAtomo() {
  atomoTrabajoId = null;
  atomoTrabajoInfo = null;
  atomoTandaInicio = null;
  atomoTandaPedidas = 0;
  atomoTandaSegPorPregunta = null;
  actualizarBotonGenerarAtomo();
  actualizarFilaMientras(); // ya no hay tanda generándose: puede que la fila-mientras deba ocultarse
}

const PERIMETRO_ANILLO_TANDA = 2 * Math.PI * 15; // r=15 del viewBox 36x36 de index.html
const MS_AVISO_FALLO_TANDA = 6000; // spec §2: el aviso de fallo dura 6 s y desaparece
const SEPARACION_INDICADOR_TANDA = 8; // hueco vertical hasta el borde inferior de .cabecera

/** Ronda de corrección 1 (Important, hallazgo del revisor, verificado en vivo con Playwright a
 * 375x812 en `pregunta`): en la misma fila que la cabecera no cabía sin solapar -- a 375px de
 * ancho, botón "←" + logo + el indicador en su estado más ancho ("N de 10 · ~40 s") +
 * `.cabecera-estado` (racha/nivel) no dejan hueco de sobra (llegaba a solapar el LOGO, no solo
 * `.cabecera-estado`). Plan B del controlador: segunda fila, pegada al borde inferior REAL de
 * `.cabecera` -- se mide en vivo con `getBoundingClientRect()` en vez de reconstruir su alto a
 * mano, porque ese alto ya incluye `env(safe-area-inset-top)` horneado en el propio padding-top de
 * `.cabecera` (sumarlo aparte aquí lo contaría dos veces en un iPhone con muesca). Se llama antes de
 * cada vez que el indicador se muestra/actualiza, y también desde `actualizarCabecera`/`resize` por
 * si la cabecera cambia de alto mientras el indicador ya está visible (p. ej. tipografía dinámica
 * del sistema). Sin número mágico de posición: el único valor fijo es el hueco deliberado de 8px. */
function posicionarIndicadorTanda() {
  if (!nodoCabecera) return;
  const bordeCabecera = nodoCabecera.getBoundingClientRect().bottom;
  nodoIndicadorTanda.style.top = `${Math.round(bordeCabecera + SEPARACION_INDICADOR_TANDA)}px`;
}

/** Ronda de corrección 1 (Plan B): con el indicador en una segunda fila, el contenido de la vista
 * necesita ceder ese hueco -- la tarjeta del mazo "ES la vista" (spec v0.1c §1) y arranca pegada
 * arriba del todo, sin margen propio, así que sin esto quedaría tapada bajo el indicador (hallazgo
 * verificado con Playwright: la tarjeta solapaba el indicador en `pregunta` y `repaso`). Se mide la
 * altura REAL del indicador YA VISIBLE (min-height:44px es un suelo, no el alto final con
 * padding/borde) -- se llama SIEMPRE después de mostrarlo/ocultarlo, nunca antes (oculto = alto 0).
 * Empuja `<main>` entero (todas las vistas), no solo `pregunta`/`repaso`: más simple y sin casos
 * especiales por vista que mantener sincronizados, a cambio de un margen de sobra en HUB mientras
 * genera -- coste aceptable frente a la complejidad de decidir vista por vista. */
function reservarHuecoIndicadorTanda() {
  if (!nodoContenidoApp) return;
  if (nodoIndicadorTanda.hidden) {
    nodoContenidoApp.style.paddingTop = '';
    return;
  }
  const altoIndicador = nodoIndicadorTanda.getBoundingClientRect().height;
  nodoContenidoApp.style.paddingTop = `${Math.round(altoIndicador + SEPARACION_INDICADOR_TANDA * 2)}px`;
}

/** Anillo de progreso: fracción 0..1 sobre `stroke-dashoffset` (la transición y su apagado con
 * prefers-reduced-motion están en estilos.css, aquí solo se mueve el número). */
function pintarAnilloTanda(fraccion) {
  const acotada = Math.max(0, Math.min(1, Number.isFinite(fraccion) ? fraccion : 0));
  nodoIndicadorTandaAvance.style.strokeDasharray = String(PERIMETRO_ANILLO_TANDA);
  nodoIndicadorTandaAvance.style.strokeDashoffset = String(PERIMETRO_ANILLO_TANDA * (1 - acotada));
}

function ocultarIndicadorTanda() {
  clearTimeout(indicadorTandaTimeoutId);
  indicadorTandaTimeoutId = null;
  atomoTandaEstado = null;
  nodoIndicadorTanda.hidden = true;
  reservarHuecoIndicadorTanda();
}

/** Tanda en curso: "4 de 10 · ~1 min" + anillo (spec §2). `hechas`/`pedidas` vienen tal cual de
 * `/trabajo/:id`; el restante lo calcula tanda.js#calcularRestanteSeg (probado sin DOM). */
function actualizarIndicadorTanda({ hechas = 0, pedidas } = {}) {
  const total = Number.isInteger(pedidas) && pedidas > 0 ? pedidas : atomoTandaPedidas;
  const hechasValidas = Number.isInteger(hechas) && hechas > 0 ? hechas : 0;
  const restante = formatearRestante(
    calcularRestanteSeg({
      inicio: atomoTandaInicio,
      ahora: Date.now(),
      hechas: hechasValidas,
      pedidas: total,
      segundosPorPregunta: atomoTandaSegPorPregunta,
    })
  );
  atomoTandaEstado = 'en-curso';
  nodoIndicadorTandaTexto.textContent = restante
    ? `${hechasValidas} de ${total} · ${restante}`
    : `${hechasValidas} de ${total}`;
  nodoIndicadorTanda.setAttribute('aria-label', `Tanda en curso, ${hechasValidas} de ${total}; toca para ver la espera`);
  pintarAnilloTanda(total > 0 ? hechasValidas / total : 0);
  clearTimeout(indicadorTandaTimeoutId);
  indicadorTandaTimeoutId = null;
  posicionarIndicadorTanda();
  nodoIndicadorTanda.hidden = false;
  reservarHuecoIndicadorTanda();
}

/** Estado terminal con >= 1 pregunta: "Tanda lista · N"; tocarlo arranca la partida (ver el
 * listener junto al resto de eventos de navegación). No se esconde solo: es una oferta, no un aviso. */
function mostrarIndicadorTandaLista(ids, corto) {
  atomoTandaLista = { ids, corto };
  atomoTandaEstado = 'lista';
  nodoIndicadorTandaTexto.textContent = `Tanda lista · ${ids.length}`;
  nodoIndicadorTanda.setAttribute('aria-label', `Tanda lista: ${ids.length} preguntas de ${corto}; toca para jugarlas`);
  pintarAnilloTanda(1);
  clearTimeout(indicadorTandaTimeoutId);
  indicadorTandaTimeoutId = null;
  posicionarIndicadorTanda();
  nodoIndicadorTanda.hidden = false;
  reservarHuecoIndicadorTanda();
}

/** Fallo (spec §2: 6 s y desaparece). Tres textos posibles, todos por aquí: "No se pudo generar"
 * (fallo total), "La tanda se perdió, genera otra" (404, spec §1) y "El servidor tarda demasiado"
 * (tope de 120 sondeos, ya existente en este fichero). */
function mostrarIndicadorTandaFallida(mensaje = 'No se pudo generar') {
  atomoTandaLista = null;
  atomoTandaEstado = 'fallo';
  nodoIndicadorTandaTexto.textContent = mensaje;
  nodoIndicadorTanda.setAttribute('aria-label', mensaje);
  pintarAnilloTanda(0);
  posicionarIndicadorTanda();
  nodoIndicadorTanda.hidden = false;
  reservarHuecoIndicadorTanda();
  clearTimeout(indicadorTandaTimeoutId);
  indicadorTandaTimeoutId = setTimeout(ocultarIndicadorTanda, MS_AVISO_FALLO_TANDA);
}

/** Contrato real del servidor (servidor/cola.js#finalizarTrabajo, línea ~300): 'lista' y 'fallida'
 * son SIEMPRE terminales; 'parcial' lo es cuando `hechas >= pedidas` (al menos una aprobada, algún
 * fallo por el camino) -- 'parcial' con `hechas < pedidas` solo puede darse en un trabajo de FONDO
 * que cede el turno a uno urgente (servidor/cola.js, `debeCeder`), y el Átomo solo pide trabajos
 * `urgente:true` (que nunca ceden, ver sincronizacion.js#pedirTanda), así que en la práctica CUALQUIER
 * 'parcial' que este cliente observe ya es terminal -- `hechas >= pedidas` es el respaldo, no la
 * única vía. 'en-cola'/'generando' son los dos únicos estados realmente en curso. */
function trabajoAtomoTerminal(trabajo) {
  return !['en-cola', 'generando'].includes(trabajo.estado) || trabajo.hechas >= trabajo.pedidas;
}

/** Fusiona `trabajo.preguntas` en el banco extendido y devuelve los ids que de verdad EXISTEN en
 * el banco tras fusionar (`bancoPorId`) -- Ronda 1 de revisión (Important #2): fusionarBancoExtra
 * puede descartar alguna (reportada, o ya en el banco) y `empezarPartida({ids})` con un id que no
 * está en `bancoPorId` se queda esa tarjeta sin hueco. `[]` si `trabajo.preguntas` viene vacío. */
function idsUtilizablesDeTanda(trabajo) {
  if (!Array.isArray(trabajo.preguntas) || trabajo.preguntas.length === 0) return [];
  fusionarBancoExtra(trabajo.preguntas, estado, idsBancoLocal);
  reconstruirBanco();
  return trabajo.preguntas.map((p) => p.id).filter((id) => bancoPorId.has(id));
}

/** Repinta la tarjeta de espera con el resultado FINAL (Ronda final, Critical #2) -- antes se
 * quedaba en "Generando... ~42 s" para siempre aunque el trabajo ya hubiera terminado hace rato.
 * Si el jugador ya se fue a "Jugar mientras"/"Repasar mientras" (o cualquier otra vista), no tiene
 * sentido resucitar una pantalla que abandonó: el chip del HUB ya es la única señal que hace
 * falta. `atomoEsperaResultado` se guarda de todas formas (por si vuelve a "atomo-espera" con el
 * botón "←" antes de que la vista cambie de sitio) y es lo que lee el listener del botón único. */
function actualizarEsperaAtomoConResultado({ ok, ids, corto, mensaje }) {
  atomoEsperaResultado = ok ? { tipo: 'jugar', ids, corto } : { tipo: 'volver' };
  if (vistaActual() !== 'atomo-espera') return;
  nodoAtomoEsperaAcciones.hidden = true;
  nodoAtomoEsperaResultado.hidden = false;
  if (ok) {
    nodoAtomoEsperaTexto.textContent = `Tanda lista: ${ids.length} preguntas de ${corto}`;
    nodoAtomoEsperaResultado.textContent = 'Jugar la tanda';
  } else {
    nodoAtomoEsperaTexto.textContent = mensaje || 'No se pudo generar, prueba otra vez';
    nodoAtomoEsperaResultado.textContent = 'Volver';
  }
}

/**
 * Sondeo del trabajo en curso (spec §4, cada 5s -- Minor #11: también una consulta inmediata al
 * arrancar/reanudar, ver iniciarSondeoAtomo/reanudarSondeoAtomoSiHaceFalta).
 *
 * Ronda final de revisión -- Critical #1: antes solo 'lista'/'fallida' se trataban como terminales;
 * un trabajo que terminaba en 'parcial' (contrato real del servidor, ver trabajoAtomoTerminal) dejaba
 * el sondeo corriendo CADA 5 S PARA SIEMPRE, con Generar bloqueado ("Ya hay una tanda en marcha")
 * sin que nada lo fuera a desbloquear.
 *
 * Ronda final -- Important #5: `idEnCurso` se captura ANTES del `await` y se comprueba DESPUÉS --
 * si `atomoTrabajoId` cambió mientras la petición estaba en vuelo, esta respuesta ya no pinta nada.
 * `atomoSondeoEnVuelo` evita que dos llamadas se solapen.
 */
async function sondearTrabajoAtomo() {
  const idEnCurso = atomoTrabajoId;
  if (!idEnCurso || atomoSondeoEnVuelo) return;

  atomoSondeoEnVuelo = true;
  let trabajo;
  try {
    trabajo = await consultarTrabajo(idEnCurso, { fetchImpl: fetch });
  } finally {
    atomoSondeoEnVuelo = false;
  }
  if (idEnCurso !== atomoTrabajoId) return; // carrera post-await: ya no es el trabajo vigente.

  if (!trabajo) {
    // Ola final v0.2b4 (Critical C2): NO se ha podido preguntar (red caída, 5xx, timeout). Eso no
    // dice nada sobre si el trabajo sigue vivo, así que ni se borra la tanda ni se para el sondeo:
    // se aguantan MAX_SONDEOS_FALLIDOS seguidos (~25 s) y el siguiente sondeo que responda
    // continúa como si nada. Antes esto se confundía con el 404 y un solo corte de red mataba la
    // tanda ("La tanda se perdió, genera otra", con la clave ya borrada).
    atomoSondeosFallidos += 1;
    if (atomoSondeosFallidos >= MAX_SONDEOS_FALLIDOS) {
      // Se para el intervalo para no machacar una red que claramente no está, pero la tanda
      // sobrevive: la clave sigue en localStorage y `atomoTrabajoId` sigue en memoria, así que
      // reanudarSondeoAtomoSiHaceFalta (volver a la app) o reanudarTandaGuardada (recarga de iOS)
      // la retoman solas. De ahí el texto del aviso.
      detenerSondeoAtomo();
      mostrarIndicadorTandaFallida('Sin conexión, se retomará al abrir');
    }
    return;
  }

  if (trabajo.perdido) {
    // 404: el trabajo YA NO EXISTE (p. ej. el servidor se reinició). Aquí sí es terminal.
    detenerSondeoAtomo();
    finalizarTrabajoAtomo();
    borrarTanda(); // spec §1: no reanudar en la próxima apertura algo que ya no existe
    mostrarIndicadorTandaFallida('La tanda se perdió, genera otra');
    actualizarEsperaAtomoConResultado({ ok: false, mensaje: 'La tanda se perdió, genera otra' });
    return;
  }

  atomoSondeosFallidos = 0; // el servidor ha respondido: la racha de fallos se corta aquí.

  // Tarea 3: el servidor manda su media móvil real; mientras no haya ninguna pregunta hecha, es la
  // única base para el "~N s" (ver tanda.js#calcularRestanteSeg).
  if (Number.isFinite(trabajo.segundosPorPregunta) && trabajo.segundosPorPregunta > 0) {
    atomoTandaSegPorPregunta = trabajo.segundosPorPregunta;
  }

  if (!trabajoAtomoTerminal(trabajo)) {
    actualizarIndicadorTanda({ hechas: trabajo.hechas, pedidas: trabajo.pedidas });
    // v0.2b4: la fusión ADELANTADA se conserva (las preguntas entran antes en el banco), pero ya
    // NO se anuncia como "Tanda lista" mientras sigue generando: el indicador dice "5 de 10" y
    // anunciar lo contrario a la vez sería mentir. Los ids se guardan por si salta el tope de
    // sondeos y hay que ofrecer algo jugable de todas formas.
    if (Array.isArray(trabajo.preguntas) && trabajo.preguntas.length >= UMBRAL_ANTICIPADO_ATOMO) {
      const ids = idsUtilizablesDeTanda(trabajo);
      if (ids.length > 0) atomoTandaLista = { ids, corto: atomoTrabajoInfo.corto };
    }
    atomoConsultas += 1;
    if (atomoConsultas >= TOPE_SONDEOS_ATOMO) {
      detenerSondeoAtomo();
      const parcial = atomoTandaLista;
      finalizarTrabajoAtomo();
      borrarTanda();
      if (parcial && parcial.ids.length > 0) {
        mostrarIndicadorTandaLista(parcial.ids, parcial.corto);
        actualizarEsperaAtomoConResultado({ ok: true, ids: parcial.ids, corto: parcial.corto });
      } else {
        mostrarIndicadorTandaFallida('El servidor tarda demasiado');
        actualizarEsperaAtomoConResultado({ ok: false, mensaje: 'El servidor tarda demasiado, prueba más tarde' });
      }
    }
    return;
  }

  // Terminal: 'lista' | 'fallida' | 'parcial' con hechas >= pedidas.
  detenerSondeoAtomo();
  const corto = atomoTrabajoInfo ? atomoTrabajoInfo.corto : '';
  const ids = idsUtilizablesDeTanda(trabajo);
  finalizarTrabajoAtomo();
  borrarTanda(); // spec §1: se borra en estado terminal, tras decidir qué mostrar
  if (ids.length > 0) {
    mostrarIndicadorTandaLista(ids, corto);
    actualizarEsperaAtomoConResultado({ ok: true, ids, corto });
  } else {
    mostrarIndicadorTandaFallida();
    actualizarEsperaAtomoConResultado({ ok: false });
  }
}

function iniciarSondeoAtomo() {
  detenerSondeoAtomo(); // por si quedara uno de un trabajo anterior sin limpiar
  atomoSondeosFallidos = 0; // C2: cada arranque/reanudación empieza con la tolerancia entera.
  sondearTrabajoAtomo(); // Minor #11: primer sondeo inmediato, no a ciegas 5s.
  atomoSondeoId = setInterval(sondearTrabajoAtomo, 5000);
}

/** Reanuda el sondeo tras pausarlo (pestaña oculta) o al restaurar la página (bfcache) -- Ronda
 * final, Critical #3. No-op si no hay trabajo en curso, o si ya hay un intervalo corriendo (evita
 * un doble `setInterval` si `visibilitychange` y `pageshow` se disparan casi a la vez). */
function reanudarSondeoAtomoSiHaceFalta() {
  if (atomoTrabajoId && atomoSondeoId === null) iniciarSondeoAtomo();
}

function mostrarEsperaAtomo(rutaTexto, estimadoSeg) {
  atomoEsperaResultado = null;
  nodoAtomoEsperaAcciones.hidden = false;
  nodoAtomoEsperaResultado.hidden = true;
  // Minor #9: `estimadoSeg` validado (entero > 0) -- si no, se omite el "~N s" en vez de mostrar
  // "~undefined s"/"~NaN s".
  const sufijoSeg = Number.isInteger(estimadoSeg) && estimadoSeg > 0 ? ` · ~${estimadoSeg} s` : '';
  nodoAtomoEsperaTexto.textContent = `Generando ${atomoTandaPedidas} preguntas de ${rutaTexto}${sufijoSeg}`;
  mostrarVista('atomo-espera');
}

/** Botón Generar (spec §4): pide la tanda con la ruta YA confirmada (no depende del anillo que se
 * esté mirando ahora mismo) y pasa a la tarjeta de espera. Un solo trabajo activo a la vez: si ya
 * hay uno, no hace nada (el botón ya debería estar apagado, ver actualizarBotonGenerarAtomo --
 * esta comprobación es solo defensiva).
 *
 * Ronda 1 de revisión (Critical): `atomoGenerarEnVuelo` se pone a `true` y el botón se deshabilita
 * de forma SÍNCRONA, ANTES del `await pedirTanda(...)` -- antes, `atomoTrabajoId` (la única guarda)
 * no se fijaba hasta que la promesa resolvía, así que dos toques rápidos en Generar corrían la
 * función dos veces con la guarda todavía en `null` las dos, y salían dos `POST /generar`. */
async function manejarGenerarAtomo() {
  if (atomoGenerarEnVuelo || atomoTrabajoId || !leerConfiguracion() || !atomoEstado) return;
  const { area, ruta, etiquetas } = atomoEstado;
  const corto = etiquetas.length > 0 ? etiquetas[etiquetas.length - 1] : nombreArea(area);
  const rutaTexto = [nombreArea(area), ...etiquetas].join(' › ');
  guardarRutaAtomo(area, ruta);

  atomoGenerarEnVuelo = true;
  actualizarBotonGenerarAtomo(); // deshabilita YA: nada de esperar al await para que surta efecto.
  const resultado = await pedirTanda({ area, ruta, n: N_TANDA_ATOMO, fetchImpl: fetch });
  atomoGenerarEnVuelo = false;

  if (!resultado) {
    mostrarAvisoAtomo('No se pudo generar, prueba otra vez');
    actualizarBotonGenerarAtomo(); // reactiva Generar: sin trabajo en curso, puede volver a intentarlo.
    return;
  }
  atomoTrabajoId = resultado.trabajoId;
  atomoTrabajoInfo = { corto, rutaTexto };
  atomoTandaInicio = Date.now();
  atomoTandaPedidas = N_TANDA_ATOMO;
  // Estimación inicial por pregunta a partir de lo que dijo /generar, hasta que /trabajo/:id mande
  // su `segundosPorPregunta` propio (Tarea 3).
  atomoTandaSegPorPregunta =
    Number.isInteger(resultado.estimadoSeg) && resultado.estimadoSeg > 0
      ? resultado.estimadoSeg / N_TANDA_ATOMO
      : null;
  guardarTanda({ id: atomoTrabajoId, corto, inicio: atomoTandaInicio, pedidas: N_TANDA_ATOMO });
  atomoConsultas = 0; // trabajo nuevo: el tope de 120 sondeos empieza de cero.
  actualizarBotonGenerarAtomo();
  actualizarFilaMientras(); // tanda generándose: si se reabre el átomo mientras tanto, se ve
  actualizarIndicadorTanda({ hechas: 0, pedidas: N_TANDA_ATOMO });
  mostrarEsperaAtomo(rutaTexto, resultado.estimadoSeg);
  iniciarSondeoAtomo();
}

// Spec §1: una tanda guardada de hace más de 2 h no se reanuda (el servidor conserva los terminados
// 1 h, Tarea 3 — pasado ese rato lo único que se conseguiría es un 404 y un susto).
const MAX_EDAD_TANDA_MS = 2 * 60 * 60 * 1000;

/** Al arrancar la app, si quedó una tanda a medias en `localStorage`, se retoma el sondeo sin que
 * el jugador tenga que hacer nada (spec §1). Es el arreglo del diagnóstico §0: iOS recarga la PWA
 * al cambiar de app o bloquear el móvil y `atomoTrabajoId` (solo en memoria) se perdía, así que el
 * aviso "Tanda lista" no llegaba nunca aunque el servidor sí terminase. */
function reanudarTandaGuardada() {
  const guardada = leerTanda();
  if (!guardada || atomoTrabajoId) return;
  if (Date.now() - guardada.inicio > MAX_EDAD_TANDA_MS) {
    borrarTanda();
    return;
  }
  atomoTrabajoId = guardada.id;
  // Tras una recarga no queda la ruta completa, solo el `corto` guardado: sirve igual para el
  // indicador, para el chip de la partida y para el texto de la vista de espera.
  atomoTrabajoInfo = { corto: guardada.corto, rutaTexto: guardada.corto };
  atomoTandaInicio = guardada.inicio;
  atomoTandaPedidas = guardada.pedidas;
  atomoTandaSegPorPregunta = null;
  atomoConsultas = 0;
  actualizarIndicadorTanda({ hechas: 0, pedidas: guardada.pedidas });
  // iniciarSondeoAtomo hace un primer sondeo INMEDIATO: si el servidor ya terminó mientras la app
  // estaba cerrada, el indicador pasa a "Tanda lista · N" en la misma apertura.
  iniciarSondeoAtomo();
}

// --- carga del banco y arranque ---
async function iniciar() {
  const params = new URLSearchParams(location.search);
  const esEjemplo = params.get('ejemplo') === '1';
  const rutaBanco = esEjemplo ? 'datos/banco.ejemplo.json' : 'datos/banco.json';
  // Antes de nada: si el enlace trae `?servidor=&token=` (Carlos lo abre una vez desde el chat,
  // spec v0.2b2 §4), guardarlo y limpiar la URL — silencioso, sin params no hace nada.
  const seGuardoConfiguracion = guardarConfiguracionDesdeUrl(location);

  const respuesta = await fetch(rutaBanco);
  bancoLocal = await respuesta.json();
  idsBancoLocal = new Set(bancoLocal.map((p) => p.id));
  reconstruirBanco();
  imagenesPorId = await cargarImagenes(esEjemplo);
  actualizarCabecera();
  actualizarPuntoServidor();
  reanudarTandaGuardada(); // spec §1: la tanda a medias sobrevive a la recarga de iOS

  if (seGuardoConfiguracion) {
    // Directo al HUB (no a los emojis): es donde vive el punto de estado y el aviso, y así se ve
    // "Servidor conectado" al momento en vez de quedarse esperando en la pantalla de inicio.
    renderHub();
    mostrarVista('progreso');
    mostrarAvisoHub('Servidor conectado');
  } else {
    mostrarVista('inicio');
  }

  // En segundo plano, nunca bloquea el arranque (spec: "al abrir... en segundo plano").
  sincronizarEnSegundoPlano();
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
      if (!activo) return;
      // El repaso construye sus tarjetas de forma perezosa (I1, ronda final
      // de revisión de rendimiento): el gesto/tecla real siempre navega de
      // uno en uno, así que mantenerVueltasRepaso solo necesita construir el
      // actual + un colchón. Un salto de TEST directo a un índice lejano
      // (irA(150), irA(294)...) necesita los huecos intermedios ya
      // construidos o mazo.js lo rebota (`nuevo >= lista.length`) — se
      // construyen aquí, solo para este salto, sin tocar el mecanismo
      // perezoso normal.
      if (activo === mazoRepasoControlador) {
        asegurarRepasoConstruidoHasta(indice + 1);
        mazoRepasoControlador.actualizarTarjetas(listaMazoRepaso(), 0);
      }
      activo.irA(indice);
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
    // Nº de ITEMS ya conocidos (baratos, sin DOM) de las vueltas del repaso
    // cargadas ahora mismo (v0.2a.1 §7, repaso "sin fin"): lo que
    // `mantenerVueltasRepaso` acota a ~2 vueltas al recortar la más antigua
    // ya recorrida. Mazo.js ya limita a máximo 3 los nodos REALMENTE
    // adjuntos al DOM en cada momento (ventana anterior/actual/siguiente, ver
    // render() en mazo.js) sea cual sea el tamaño de este array — así que
    // contar `.tarjeta` en el DOM no distinguiría un recorte de vueltas
    // correcto de uno roto. El e2e comprueba ESTE número, no el recuento del DOM.
    repasoNodosLength() {
      return repasoHuecos.length;
    },
    // Nº de tarjetas REALMENTE construidas (I1, ronda final de revisión de
    // rendimiento): `repasoHuecos` conoce todos los items de la vuelta, pero
    // `nodo` se queda `null` hasta la primera vez que se llega a ese hueco.
    // Al abrir debe ser ≤ 3; tras 10 deslizamientos, ≤ 13 (como mucho una
    // tarjeta nueva por deslizamiento).
    repasoNodosConstruidos() {
      return listaMazoRepaso().length;
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

/** Total "oficial" de la partida en curso, para el contador de cabecera y la
 * barra de progreso: N_PARTIDA (10) salvo que haya un filtro cerrado de ids
 * (Misión de hoy, Pendientes, chip "N preguntas nuevas · Jugar"...), que es
 * "sin relleno" por definición (ver empezarPartida) y por tanto tiene su
 * propio total -- v0.2b4 §3, expuesto por el chip con partidas de menos de 10. */
function totalPartidaActual() {
  return filtroPartida && Array.isArray(filtroPartida.ids) ? filtroPartida.ids.length : N_PARTIDA;
}

function actualizarBarraProgreso() {
  const respondidas = mazo.filter((h) => h.respondida).length;
  barraProgresoRelleno.style.transform = `scaleX(${respondidas / totalPartidaActual()})`;
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

/** "3/10" (respondidas/total) para el contador de la cabecera de pregunta
 * (spec v0.1d §1; el total es totalPartidaActual(), no siempre N_PARTIDA).
 * Solo tiene sentido en la partida: el repaso usa su propia posición dentro
 * del mazo de resumen (ver construirTarjetaRepaso). */
function contadorTextoPartida() {
  const respondidas = mazo.filter((h) => h.respondida).length;
  return `${respondidas}/${totalPartidaActual()}`;
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
  // "Modo normal" (spec v0.2b2 §4): también al terminar cada partida, en segundo plano.
  sincronizarEnSegundoPlano();

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

  // C1 (revisión final de rama, Critical): mostrarVista('resumen') va ANTES
  // de montarMazo, no después — mismo defecto que abrirRepaso (ver su
  // comentario): con la vista todavía hidden, ajustarEncaje mide cajas de
  // alto 0 y la cascada de encaje nunca se aplica (desborde real, no visible
  // hasta un resize). Todo esto sigue pasando de forma síncrona antes de que
  // el navegador pinte nada, así que no hay parpadeo de una vista a medio
  // construir.
  mostrarVista('resumen');
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
      if (hueco.correcta === undefined) {
        // Sin responder (v0.2a.1 §7, tramo 2 del repaso infinito): no hay "tu
        // respuesta" que mostrar ni fallo que marcar, solo la correcta.
        linea.textContent = `Respuesta: ${pregunta.respuesta ? 'Verdadero' : 'Falso'} ✓`;
        linea.classList.add('respuesta-compacta-linea--ok');
      } else if (hueco.correcta) {
        linea.textContent = `Tu respuesta: ${respuestaVf ? 'Verdadero' : 'Falso'} ✓`;
        linea.classList.add('respuesta-compacta-linea--ok');
      } else {
        linea.textContent = `✗ · Era ${pregunta.respuesta ? 'Verdadero' : 'Falso'}`;
        linea.classList.add('respuesta-compacta-linea--tachada');
      }
      contenedor.appendChild(linea);
      break;
    }
    case 'test4': {
      // Sin hueco.respuesta (tarjeta anterior a v0.2 fallada, sin volver a
      // responder; o sin responder de verdad, v0.2a.1 §7: hueco.correcta
      // TAMBIÉN es undefined ahí) no hay forma de saber CUÁL opción se marcó:
      // se omite la línea tachada y se deja solo la correcta (tolerancia
      // mínima pedida por la spec §2, "marca solo la correcta").
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
  // Sin responder (v0.2a.1 §7, tramo 2 del repaso infinito): hueco.correcta
  // es undefined a propósito (nunca se ha respondido de verdad, ni acierto
  // ni fallo que marcar) — borde NEUTRO, ni verde ni rojo, sin la animación
  // de pulso/sacudida que sí llevan correcto/incorrecto (spec: "ni verde ni
  // rojo: clase tarjeta--neutra"), y SIN `dataset.respondida` (Minor 1, ronda
  // final de revisión: nunca se ha respondido de verdad, así que marcarla
  // como "respondida" sería falso). `ajustarEncaje` (mazo.js) distingue la
  // cascada de una pregunta ACTIVA sin responder mirando
  // `dataset.respondida === 'false'`, no `!== 'true'`, así que esta tarjeta
  // (construida con la MISMA forma que una respondida: zona de respuesta +
  // feedback, no la de una pregunta activa) sigue cayendo en la cascada
  // correcta aunque no lleve el atributo.
  if (hueco.correcta === undefined) {
    tarjeta.classList.add('tarjeta--neutra');
  } else {
    tarjeta.dataset.respondida = 'true';
    tarjeta.classList.add(hueco.correcta ? 'correcto' : 'incorrecto');
  }

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
  // v0.2b2 §4: una pregunta del servidor se reporta también allí (fuego y olvido — ya queda
  // anotada localmente arriba pase lo que pase; reportarAlServidor nunca lanza, ver
  // sincronizacion.js). Sin configuración de servidor no hace ninguna petición.
  if (hueco.pregunta.id.startsWith('srv-')) {
    reportarAlServidor({ id: hueco.pregunta.id, fetchImpl: fetch });
  }
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
 * §2: 'fallo'/'fragil' ya existían, 'acertada' es v0.2, 'neutra' es v0.2a.1
 * §7 — tramo 2 del repaso infinito, preguntas sin responder). */
function claseRepasoMarca(estadoRepaso) {
  if (estadoRepaso === 'fallada') return 'fallo';
  if (estadoRepaso === 'fragil') return 'fragil';
  if (estadoRepaso === 'sinResponder') return 'neutra';
  return 'acertada';
}

/** Texto de la marca para cada estado (spec v0.1c §6 + v0.2 §2 + v0.2a.1 §7:
 * 'sinResponder' no lleva ✓/✗ — nunca se ha respondido de verdad, así que
 * marcarlo como acierto o fallo mentiría). */
function textoRepasoMarca(estadoRepaso) {
  if (estadoRepaso === 'fallada') return '✗ fallada';
  if (estadoRepaso === 'fragil') return '✓ frágil';
  if (estadoRepaso === 'sinResponder') return '· sin responder';
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
 * una marca añadida justo tras la cabecera de área/nivel. Sirve a TRES
 * orígenes, distinguidos por `item.estadoRepaso`:
 *  - Resumen (`repasoPartida`, item = { pregunta, correcta, respuesta, delta },
 *    sin `estadoRepaso`): `delta` es el REAL de esa respuesta (XP, combo,
 *    nivel...) — el bloque de feedback lo pinta tal cual, como hasta ahora.
 *    Marca: fallada/frágil, sin "hace N días" (misma partida, siempre "hoy").
 *  - Feed del HUB, tramo 1 (`ordenarRepaso`, item = { pregunta, tarjeta,
 *    estadoRepaso: 'fallada'|'fragil'|'acertada', diasDesde }): no hay un
 *    `delta` real (la respuesta pudo darse en cualquier partida pasada,
 *    incluso antes de v0.2): se construye uno neutro y se oculta la línea de
 *    resultado ("✓ +N XP") en vez de fingir un XP que no se ganó ahora — la
 *    marca de abajo ya dice si acertó o no. El resto del bloque (combo,
 *    cambio de nivel, chips) queda oculto solo, al ser todo 0/false/null.
 *    `hueco.respuesta` (`tarjeta.ultimaRespuesta`) puede ser `undefined` en
 *    una tarjeta anterior a v0.2: tolerado por construirRespuestaCompacta
 *    (marca solo la correcta).
 *  - Feed del HUB, tramo 2 (v0.2a.1 §7, `listarNoRespondidas`, item =
 *    { pregunta, estadoRepaso: 'sinResponder' }, SIN `tarjeta` — la pregunta
 *    nunca se ha respondido, no hay tarjeta que traer): `hueco.correcta` y
 *    `hueco.respuesta` quedan `undefined` a propósito (construirTarjetaRespondida
 *    ya sabe pintar eso como borde neutro, y construirRespuestaCompacta como
 *    "marca solo la correcta"); mismo delta neutro que el tramo 1 (sin XP);
 *    marca `· sin responder` sin "hace N días" (no hay `diasDesde`: nunca se
 *    ha tocado, "hace N días" no tendría sentido) y con
 *    `data-test="repaso-marca-nueva"` para que el e2e la distinga sin
 *    depender solo del texto.
 */
function construirTarjetaRepaso(item, indice, total) {
  const esFeedHub = typeof item.estadoRepaso === 'string';
  const esSinResponder = item.estadoRepaso === 'sinResponder';
  const estadoRepaso = esFeedHub ? item.estadoRepaso : item.correcta ? 'fragil' : 'fallada';
  const correcta = esSinResponder ? undefined : esFeedHub ? estadoRepaso !== 'fallada' : item.correcta;
  const respuesta = esSinResponder ? undefined : esFeedHub ? item.tarjeta.ultimaRespuesta : item.respuesta;
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
  // Contador "n/N" (spec v0.1d §1, redefinido en v0.2a.1 §7 para el repaso
  // infinito): la posición de ESTA tarjeta DENTRO DE SU VUELTA — cada llamador
  // (renderRepaso/mantenerVueltasRepaso) construye una vuelta entera de una
  // sola vez con `indice`/`total` relativos solo a esa vuelta, así que fijarlo
  // aquí sigue sin necesitar refresco después.
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
  if (esSinResponder) {
    marca.dataset.test = 'repaso-marca-nueva';
    marca.textContent = textoRepasoMarca(estadoRepaso);
  } else {
    marca.textContent = esFeedHub
      ? `${textoRepasoMarca(estadoRepaso)} · ${textoDiasDesde(item.diasDesde)}`
      : textoRepasoMarca(estadoRepaso);
  }
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
// --- Repaso del HUB: feed infinito con todo el banco (v0.2a.1 §7, enmienda
// del 14-sep 16:00 sobre la entrega A de v0.2 §2) ---
// A diferencia del resumen (repaso de UNA partida ya jugada), este mazo cubre
// TODO el banco filtrado (respondidas por prioridad de repaso + el resto sin
// responder, como tarjetas ya reveladas para leer) y no tiene ni principio ni
// fin de verdad: sin tarjeta de cierre, al acercarse al final se añade otra
// vuelta completa (mantenerVueltasRepaso) y así indefinidamente. Con banco no
// vacío siempre hay algo que mostrar (el botón del HUB ya no se apaga, ver
// actualizarDestacados), aunque no se haya respondido nada todavía.
// ============================================================================

/** Feed de repaso "sin fin" (spec v0.2a.1 §7): concatena los dos tramos —
 * (1) lo YA respondido, por prioridad de repaso, exactamente igual que antes
 * (`ordenarRepaso`, motor.js, sin cambios) y (2) lo que queda SIN responder
 * (`listarNoRespondidas`, motor.js: nivel ascendente, rotando áreas, por id),
 * como tarjetas ya reveladas para leer. `filtro` (una de AREAS, o
 * `'todas'`/`null`/`undefined` para no filtrar) se aplica sobre el resultado
 * YA concatenado, así que respeta los dos tramos con el mismo criterio. Pura
 * en la práctica (no muta nada), aunque vive en app.js porque combina dos
 * funciones de motor.js con el `hoy()`/`banco`/`estado` de la sesión. */
function construirFeedRepaso(estado, banco, hoy, filtro) {
  const respondidas = ordenarRepaso(estado, banco, hoy);
  const sinResponder = listarNoRespondidas(estado, banco).map((pregunta) => ({
    pregunta,
    estadoRepaso: 'sinResponder',
  }));
  const listaCompleta = [...respondidas, ...sinResponder];
  if (!filtro || filtro === 'todas') return listaCompleta;
  return listaCompleta.filter((item) => item.pregunta.area === filtro);
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
    // I2 (revisión final, accesibilidad): cada chip anuncia si es el activo,
    // igual que ya hace confianza-opcion (aria-pressed) en la tarjeta.
    chip.setAttribute('aria-pressed', String(filtroRepaso === area));
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

/** El PREFIJO de `repasoHuecos` ya construido en nodos DOM, en orden (I1,
 * ronda final de revisión de rendimiento): mazo.js nunca debe ver un hueco
 * sin construir, así que se corta en el primer `nodo` a `null`.
 * `mantenerVueltasRepaso`/`asegurarRepasoConstruidoHasta` garantizan que el
 * hueco actual y su colchón siempre están construidos ANTES de llamar a
 * esto, así que el corte nunca deja fuera al que hace falta mostrar. */
function listaMazoRepaso() {
  const construidos = [];
  for (const hueco of repasoHuecos) {
    if (!hueco.nodo) break;
    construidos.push(hueco.nodo);
  }
  return construidos;
}

/** Añade vueltas (solo ITEMS: baratos, sin construir DOM) a `repasoHuecos`
 * hasta conocer al menos `hastaIndice + 1`, y construye los nodos DOM del 0
 * hasta `hastaIndice` que todavía no lo estén. Uso: el salto de TEST directo
 * (`window.__one.irA`), que a diferencia del gesto real (siempre ±1) puede
 * pedir un índice lejano de golpe — recorre `repasoHuecos` desde el principio
 * porque no sabe qué tramo ya estaba construido, a diferencia del camino
 * normal (`mantenerVueltasRepaso`), que sí lo sabe y por eso solo mira dos
 * posiciones por deslizamiento. */
function asegurarRepasoConstruidoHasta(hastaIndice) {
  while (repasoHuecos.length <= hastaIndice) {
    const lista = construirFeedRepaso(estado, banco, hoy(), filtroRepaso);
    if (lista.length === 0) break; // defensivo: no debería darse con banco no vacío
    repasoVueltaTamanos.push(lista.length);
    lista.forEach((item, i) => repasoHuecos.push({ item, posicion: i, total: lista.length, nodo: null }));
  }
  for (let i = 0; i <= hastaIndice && i < repasoHuecos.length; i += 1) {
    const hueco = repasoHuecos[i];
    if (!hueco.nodo) hueco.nodo = construirTarjetaRepaso(hueco.item, hueco.posicion, hueco.total);
  }
}

/**
 * Sin fin de verdad (spec v0.2a.1 §7) Y perezoso (I1, ronda final de
 * revisión de rendimiento: abrir el repaso con el banco real construía las
 * ~295 tarjetas de golpe, 2,5 s con CPU x4 — 27.000 nodos). Tres pasos en
 * cada cambio de índice:
 *  1. Conocer más ITEMS (baratos, sin DOM) mientras al usuario le queden ≤ 3
 *     por delante en `repasoHuecos` — feed recalculado con el mismo filtro.
 *  2. Construir como mucho UN nodo nuevo: el actual, por si aún no existe
 *     (primer montaje o justo tras un recorte de vuelta), y uno de colchón
 *     por delante — mismo mecanismo que `asegurarSiguienteDisponible` en la
 *     partida ("rellena la PRIMERA VEZ que se llega a él").
 *  3. Retirar la vuelta más antigua ya recorrida del todo (items Y nodos),
 *     máximo ~2 vueltas cargadas: al superarlas se recorta por delante y se
 *     reajusta el índice hacia abajo con el segundo argumento de
 *     `actualizarTarjetas` (cambio mínimo en mazo.js, ver su comentario) para
 *     que el usuario no note ningún salto: sigue viendo la misma tarjeta.
 * `indice` es la posición ACTUAL dentro de `repasoHuecos` (no dentro de una
 * vuelta). Se llama una vez a mano justo tras montar el mazo (mismo patrón
 * que `manejarCambioIndiceMazo(0)` en `empezarPartida`) y luego en cada
 * `alCambiar`.
 */
function mantenerVueltasRepaso(indice) {
  let indiceRelativo = indice;
  let huboCambio = false;

  while (repasoHuecos.length - 1 - indiceRelativo <= 3) {
    const lista = construirFeedRepaso(estado, banco, hoy(), filtroRepaso);
    if (lista.length === 0) break; // defensivo: no debería darse con banco no vacío
    repasoVueltaTamanos.push(lista.length);
    lista.forEach((item, i) => repasoHuecos.push({ item, posicion: i, total: lista.length, nodo: null }));
  }

  for (const i of [indiceRelativo, indiceRelativo + 1]) {
    const hueco = repasoHuecos[i];
    if (hueco && !hueco.nodo) {
      hueco.nodo = construirTarjetaRepaso(hueco.item, hueco.posicion, hueco.total);
      huboCambio = true;
    }
  }

  let ajuste = 0;
  while (repasoVueltaTamanos.length > 2 && repasoVueltaTamanos[0] <= indiceRelativo - ajuste) {
    ajuste += repasoVueltaTamanos.shift();
  }
  if (ajuste > 0) {
    repasoHuecos = repasoHuecos.slice(ajuste);
    huboCambio = true;
  }

  if (huboCambio) mazoRepasoControlador.actualizarTarjetas(listaMazoRepaso(), ajuste);
}

/** Recalcula el feed completo, pinta los chips y (re)monta el mazo filtrado
 * (spec v0.2a.1 §7): se usa tanto para abrir la vista por primera vez como
 * para remontar tras cambiar de chip — nunca cambia de vista por sí misma
 * (ver abrirRepaso), así que un cambio de filtro no retriggerea la animación
 * de entrada de la vista. Construye el feed UNA sola vez (Minor 5, ronda
 * final de revisión) y filtra el resultado ya calculado en vez de volver a
 * recorrer `ordenarRepaso`/`listarNoRespondidas` una segunda vez solo para
 * aplicar el filtro. */
function renderRepaso() {
  limpiarRepasoMazo();
  const listaCompleta = construirFeedRepaso(estado, banco, hoy(), null);
  // El filtro guardado puede apuntar a un área que ya no tiene ninguna
  // tarjeta en ninguno de los dos tramos (p. ej. se reportaron todas desde
  // la última vez que se abrió el repaso): se cae a "todas" en vez de dejar
  // la vista vacía en silencio.
  if (filtroRepaso !== 'todas' && !listaCompleta.some((item) => item.pregunta.area === filtroRepaso)) {
    filtroRepaso = 'todas';
    guardarFiltroRepaso(filtroRepaso);
  }
  renderFiltroRepaso(listaCompleta);
  const primeraLista =
    filtroRepaso === 'todas' ? listaCompleta : listaCompleta.filter((item) => item.pregunta.area === filtroRepaso);
  repasoVueltaTamanos = [primeraLista.length];
  repasoHuecos = primeraLista.map((item, i) => ({ item, posicion: i, total: primeraLista.length, nodo: null }));
  contenedorMazoRepaso.innerHTML = '';
  mazoRepasoControlador = montarMazo(contenedorMazoRepaso, [], {
    contarPista: false,
    puntosNeutros: true,
    alCambiar: mantenerVueltasRepaso,
  });
  mantenerVueltasRepaso(0); // construye el hueco 0 + colchón (I1) y aplica vuelta/recorte si hiciera falta.
}

/** Abre la vista de repaso del HUB (botón `data-test="repaso-hub"`, spec
 * v0.2a.1 §7): con banco no vacío siempre hay algo que mostrar (ver
 * actualizarDestacados), aunque no se haya respondido nada todavía.
 *
 * C1 (revisión final de rama, Critical): `mostrarVista('repaso')` va ANTES de
 * `renderRepaso()`, no después. Con la vista todavía `hidden` (`display:
 * none`), `ajustarEncaje` mide `clientHeight`/`scrollHeight` sobre cajas de
 * alto 0: `cabe()` da `true` siempre y la cascada de encaje nunca se aplica,
 * dejando tarjetas con enunciado/explicación largos desbordadas de verdad (no
 * detectable hasta un resize, que es lo único que hasta ahora forzaba a
 * `ajustarEncaje` a recalcular con medidas reales). `empezarPartida` ya hace
 * `mostrarVista('pregunta')` antes de `montarMazo`; este era el mismo defecto
 * latente, aquí y en finalizarPartida (ver más abajo). */
function abrirRepaso() {
  mostrarVista('repaso');
  renderRepaso();
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
    // de videojuego); mantenerla pulsada, o el botón "⚛", abre el Átomo (v0.2b2 §4)
    // para elegir un subtema y pedir una tanda nueva.
    let idPulsacionLarga = null;
    let origenPulsacion = null;
    let pulsacionYaAbrioAtomo = false; // el click que sigue a una pulsación larga no lanza la partida.
    const PULSACION_LARGA_MS = 500;
    const MOVIMIENTO_MAX_PX = 10;

    function cancelarPulsacionLarga() {
      if (idPulsacionLarga !== null) {
        clearTimeout(idPulsacionLarga);
        idPulsacionLarga = null;
      }
      origenPulsacion = null;
    }

    tarjeta.addEventListener('pointerdown', (ev) => {
      if (tarjeta.disabled) return;
      origenPulsacion = { x: ev.clientX, y: ev.clientY };
      idPulsacionLarga = setTimeout(() => {
        idPulsacionLarga = null;
        pulsacionYaAbrioAtomo = true;
        abrirAtomo(fila.area);
      }, PULSACION_LARGA_MS);
    });
    tarjeta.addEventListener('pointermove', (ev) => {
      if (!origenPulsacion) return;
      const dx = ev.clientX - origenPulsacion.x;
      const dy = ev.clientY - origenPulsacion.y;
      if (Math.hypot(dx, dy) > MOVIMIENTO_MAX_PX) cancelarPulsacionLarga();
    });
    tarjeta.addEventListener('pointerup', cancelarPulsacionLarga);
    tarjeta.addEventListener('pointerleave', cancelarPulsacionLarga);
    tarjeta.addEventListener('pointercancel', cancelarPulsacionLarga);
    // Adversarial A3: en iOS, mantener pulsado un elemento dispara el callout nativo (copiar/
    // compartir) y selecciona texto salvo que se lo digamos explícitamente -- eso mataría el
    // gesto de pulsación larga a medio camino. `-webkit-touch-callout`/`user-select` ya lo cubren
    // en estilos.css; `contextmenu` es el evento que dispara ESE callout, así que se descarta aquí
    // también por si acaso (defensa en profundidad, no todos los navegadores respetan el CSS igual).
    tarjeta.addEventListener('contextmenu', (ev) => ev.preventDefault());

    tarjeta.addEventListener('click', () => {
      if (pulsacionYaAbrioAtomo) {
        pulsacionYaAbrioAtomo = false; // se descarta UNA sola vez, ver brief de la tarea.
        return;
      }
      empezarPartida({ area: fila.area });
    });

    const botonAtomo = document.createElement('span');
    botonAtomo.className = 'tarjeta-area-atomo';
    botonAtomo.dataset.test = 'atomo-abrir';
    botonAtomo.setAttribute('role', 'button');
    botonAtomo.setAttribute('tabindex', '0');
    // v0.2b4 §4: "+" en vez de "⚛" (Carlos, 15-sep: el símbolo del átomo no decía nada). El
    // `aria-label` dice la acción completa, que es lo que anuncia un lector de pantalla.
    botonAtomo.setAttribute('aria-label', `Explorar subtemas de ${nombreArea(fila.area)}`);
    botonAtomo.textContent = '+';
    botonAtomo.addEventListener('click', (ev) => {
      ev.stopPropagation();
      abrirAtomo(fila.area);
    });
    botonAtomo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        abrirAtomo(fila.area);
      }
    });
    botonAtomo.addEventListener('pointerdown', (ev) => ev.stopPropagation());

    tarjeta.appendChild(cabeceraTarjeta);
    tarjeta.appendChild(nombre);
    tarjeta.appendChild(track);
    tarjeta.appendChild(solido);
    tarjeta.appendChild(botonAtomo);
    progresoAreas.appendChild(tarjeta);
  });
}

/** Pinta las tres tarjetas destacadas del hub (Misión de hoy, Pendientes y
 * Repaso): texto, y si son tocables (aria-disabled + dataset.tocable cuando
 * no). Repaso (spec v0.2a.1 §7) YA NO se apaga con "Juega primero": con todo
 * el banco como contenido (respondido + sin responder), con banco no vacío
 * siempre hay feed, aunque no se haya respondido nada — a diferencia de
 * Pendientes, que sí depende de cuántas haya AHORA MISMO pendientes. */
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

  // v0.2a.1 §7: "el botón Repaso del HUB deja de apagarse" — con todas las
  // preguntas del banco como contenido (no solo las respondidas) siempre hay
  // algo que mostrar salvo con el banco entero vacío, algo que no debería
  // darse nunca en producción (ver también el guarda defensivo del mismo
  // caso en mantenerVueltasRepaso).
  if (banco.length === 0) {
    nodoRepasoHub.textContent = 'Sin preguntas';
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
// Chip "N preguntas nuevas · Jugar" (v0.2b4 §3): arranca la partida con ellas. Sin ids utilizables
// (todas descartadas al fusionar) solo se cierra, sin fingir una partida vacía -- mismo criterio
// que "Misión de hoy"/"Pendientes" más abajo.
nodoNuevasServidor.addEventListener('click', () => {
  nodoNuevasServidor.hidden = true;
  if (nuevasServidorIds.length === 0) return;
  const ids = nuevasServidorIds;
  nuevasServidorIds = [];
  empezarPartida({ ids, etiqueta: 'Nuevas' });
});
// Indicador de tanda (v0.2b4 §2): un solo nodo con tres comportamientos según el estado.
// - 'lista': arranca la partida con esas preguntas (`empezarPartida({ids, etiqueta: corto})`).
// - 'en-curso': abre la vista de espera del átomo (tras una recarga esta vista todavía no tiene
//   texto: `mostrarEsperaAtomo` lo pinta desde `atomoTrabajoInfo` antes de mostrarla).
// - 'fallo' o cualquier otro: solo se cierra.
nodoIndicadorTanda.addEventListener('click', () => {
  if (atomoTandaEstado === 'lista' && atomoTandaLista) {
    const { ids, corto } = atomoTandaLista;
    atomoTandaLista = null;
    ocultarIndicadorTanda();
    empezarPartida({ ids, etiqueta: corto });
    return;
  }
  if (atomoTandaEstado === 'en-curso') {
    const info = atomoTrabajoInfo || {};
    mostrarEsperaAtomo(info.rutaTexto || info.corto || 'tu tanda', null);
    return;
  }
  ocultarIndicadorTanda();
});
// Botones fijos del Átomo: Atrás (un anillo), Generar, y Reintentar del aviso de fallo al cargar
// subtemas (ver cargarAnilloAtomo).
nodoAtomoAtras.addEventListener('click', manejarAtomoAtras);
nodoAtomoGenerar.addEventListener('click', manejarGenerarAtomo);
nodoAtomoReintentar.addEventListener('click', () => cargarAnilloAtomo());
// Hoja "Conectar" (v0.2b3 Tarea 4 + revisión combinada): se abre al tocar el punto de estado de
// la cabecera del Átomo, el del HUB (junto a "Comenzar" -- Carlos aterriza ahí al abrir la app
// instalada), o el aviso del Átomo -- pero SOLO cuando ese aviso es "Conecta el servidor..." (sin
// configuración); con servidor configurado el mismo nodo muestra otros textos (fallo al cargar,
// "Buscando..."), que no deben abrir esta hoja.
nodoAtomoEstadoServidor.addEventListener('click', abrirHojaConectar);
nodoEstadoServidor.addEventListener('click', abrirHojaConectar);
nodoAtomoAviso.addEventListener('click', () => {
  if (!leerConfiguracion()) abrirHojaConectar();
});
document.querySelector('[data-test="conectar-ok"]').addEventListener('click', manejarConectarOk);
document.querySelector('[data-test="conectar-cancelar"]').addEventListener('click', cerrarHojaConectar);
// Escape (brief): cierra y vacía el campo, igual que Cancelar.
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !nodoConectar.hidden) cerrarHojaConectar();
});
// Tarjeta de espera: "Jugar mientras"/"Repasar mientras" (el sondeo sigue en segundo plano, no
// depende de qué vista esté abierta -- ver iniciarSondeoAtomo/sondearTrabajoAtomo).
document.querySelector('[data-test="atomo-jugar-mientras"]').addEventListener('click', () => empezarPartida(null));
document.querySelector('[data-test="atomo-repasar-mientras"]').addEventListener('click', () => abrirRepaso());
// Fila "atomo-mientras" (v0.2b3 Tarea 3): misma idea, dentro de la propia vista del átomo mientras
// el anillo carga/falla o una tanda se genera en segundo plano -- "Jugar el área" reutiliza la
// misma función que el HUB al tocar una tarjeta de área (empezarPartida({area})).
document.querySelector('[data-test="atomo-mientras-jugar"]').addEventListener('click', () => {
  if (atomoEstado) empezarPartida({ area: atomoEstado.area });
});
document.querySelector('[data-test="atomo-mientras-repasar"]').addEventListener('click', () => abrirRepaso());
// Botón único de la tarjeta de espera una vez resuelto el trabajo (Ronda final, Critical #2):
// "Jugar la tanda" o "Volver", según `atomoEsperaResultado` (lo fija actualizarEsperaAtomoConResultado).
nodoAtomoEsperaResultado.addEventListener('click', () => {
  if (!atomoEsperaResultado) return;
  if (atomoEsperaResultado.tipo === 'jugar') {
    empezarPartida({ ids: atomoEsperaResultado.ids, etiqueta: atomoEsperaResultado.corto });
  } else {
    irAlHub();
  }
});
// Ronda final de revisión (Critical #3): el sondeo se detiene de verdad solo al cerrar la app de
// verdad (`pagehide` sin bfcache -- `ev.persisted` true significa que el navegador puede
// restaurarla más tarde con `pageshow`, y él mismo congela los timers mientras tanto, no hace
// falta tocar nada). Al ocultar la pestaña (`visibilitychange`), se PAUSA (mismo mecanismo,
// `atomoTrabajoId` no se toca) para no gastar red en segundo plano sin que Carlos esté mirando; al
// volver a verla, o al restaurar desde bfcache, se reanuda con una consulta inmediata (Minor #11)
// en vez de esperar a ciegas hasta el siguiente tick de 5s.
window.addEventListener('pagehide', (ev) => {
  if (!ev.persisted) detenerSondeoAtomo();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) detenerSondeoAtomo();
  else reanudarSondeoAtomoSiHaceFalta();
});
window.addEventListener('pageshow', reanudarSondeoAtomoSiHaceFalta);
// Ronda de corrección 1 del indicador de tanda: barato (dos lecturas de layout) e inocuo si el
// indicador está oculto -- por si rotar el móvil cambiara el alto de la cabecera o del propio
// indicador (ver posicionarIndicadorTanda/reservarHuecoIndicadorTanda).
window.addEventListener('resize', () => {
  posicionarIndicadorTanda();
  reservarHuecoIndicadorTanda();
});
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
