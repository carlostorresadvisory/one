// ONE · app.js — UI, gestos y máquina de vistas. Toda la lógica de juego vive en motor.js;
// este fichero solo pinta pantallas y traduce interacción del usuario en llamadas al motor.
import {
  crearEstado,
  siguientePregunta,
  registrarRespuesta,
  actualizarRacha,
  resumenProgreso,
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

// Modo "practicar solo un área": null en partida normal; { area } cuando se entra
// desde Progreso pulsando "Practicar" en una fila. Se limpia al volver a inicio
// ("←" o "Inicio"); "Otra" en el resumen lo respeta para repetir el mismo filtro.
let filtroPartida = null;

// --- referencias a nodos ---
const nodoRacha = document.querySelector('[data-test="racha"]');
const nodoNivelPartida = document.querySelector('[data-test="nivel-partida"]');
const nodoVolver = document.querySelector('[data-test="volver"]');
const nodoModoArea = document.querySelector('[data-test="modo-area"]');
const nodoNoLoSe = document.querySelector('[data-test="no-lo-se"]');
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
const progresoHoy = document.getElementById('progreso-hoy');
const progresoAreas = document.getElementById('progreso-areas');
const importarArchivo = document.getElementById('importar-archivo');

function mostrarVista(nombre) {
  vistas.forEach((v) => {
    v.hidden = v.dataset.vista !== nombre;
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

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function actualizarCabecera() {
  nodoRacha.textContent = `🔥 ${estado.racha.dias}`;
  nodoNivelPartida.textContent = `Nivel ${estado.nivelPartida}`;
  if (filtroPartida && filtroPartida.area) {
    nodoModoArea.hidden = false;
    nodoModoArea.textContent = `Solo ${nombreArea(filtroPartida.area)}`;
  } else {
    nodoModoArea.hidden = true;
  }
}

/** Vuelve a inicio abandonando la partida en curso si la hubiera: las respuestas ya
 * dadas quedan guardadas en el estado (se aplican a Leitner/nivel una a una), pero
 * la racha solo se actualiza al COMPLETAR una partida (ver finalizarPartida), así
 * que abandonar a mitad no cuenta como partida jugada para la racha. También limpia
 * el filtro de "practicar solo un área" si lo hubiera. */
function volverAInicio() {
  filtroPartida = null;
  preguntaEnPantalla = null;
  actualizarCabecera();
  mostrarVista('inicio');
}

// --- carga del banco y arranque ---
async function iniciar() {
  const params = new URLSearchParams(location.search);
  const rutaBanco = params.get('ejemplo') === '1' ? 'datos/banco.ejemplo.json' : 'datos/banco.json';
  const respuesta = await fetch(rutaBanco);
  banco = await respuesta.json();
  actualizarCabecera();
  mostrarVista('inicio');
}

// --- flujo de partida ---
/** `filtro` opcional ({ area }) arranca una partida SOLO de esa área ("Practicar"
 * desde Progreso). Sin filtro, partida normal (todas las áreas). */
function empezarPartida(filtro = null) {
  filtroPartida = filtro && filtro.area ? { area: filtro.area } : null;
  indicePartida = 0;
  xpPartida = 0;
  aciertosPartida = 0;
  areasPartida = new Set();
  partidaUsados = new Set();
  partidaUltima = null;
  preguntaEnPantalla = null;
  actualizarCabecera(); // pinta "Solo <Área>" desde la primera pregunta, si toca.
  mostrarVista('pregunta');
  avanzarPregunta();
}

/** Pide la siguiente pregunta al motor (o termina la partida si no queda ninguna). */
function avanzarPregunta() {
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
  nodoNoLoSe.hidden = false; // visible de nuevo para la pregunta que entra

  contenedorPregunta.innerHTML = '';
  const tarjeta = construirTarjetaPregunta(pregunta);
  tarjeta.insertBefore(construirCabeceraPregunta(pregunta), tarjeta.firstChild);
  contenedorPregunta.appendChild(tarjeta);
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
  const resultado = registrarRespuesta(estado, pregunta, correcta, hoy());
  aplicarResultado(pregunta, resultado, correcta, false);
}

/** Botón "No lo sé": no se evalúa ninguna respuesta, se trata como fallo a todos los
 * efectos de motor (Leitner, nivel de área, escalera), pero queda marcado aparte. */
function manejarNoLoSe() {
  if (preguntaRespondida) return;
  const pregunta = preguntaEnPantalla;
  if (!pregunta) return;
  preguntaRespondida = true;
  const resultado = registrarRespuesta(estado, pregunta, false, hoy(), { noLoSe: true });
  aplicarResultado(pregunta, resultado, false, true);
}

/** Aplica el resultado de registrarRespuesta a la sesión de UI: guarda estado,
 * actualiza contadores de la partida y pinta el feedback (normal o "no lo sé"). */
function aplicarResultado(pregunta, resultado, correcta, noLoSe) {
  estado = resultado.estado;
  guardarEstado(estado);
  actualizarCabecera(); // el "Nivel N" de la cabecera se ve moverse en vivo, no solo al volver a Inicio.

  xpPartida += resultado.delta.xp;
  if (correcta) aciertosPartida += 1;
  areasPartida.add(pregunta.area);

  mostrarFeedback(pregunta, correcta, resultado.delta, noLoSe);
}

function mostrarFeedback(pregunta, correcta, delta, noLoSe = false) {
  nodoNoLoSe.hidden = true; // ya se ha respondido (de una forma u otra): no tiene sentido seguir ofreciéndolo.

  const tarjeta = contenedorPregunta.querySelector('.tarjeta');
  if (tarjeta) {
    tarjeta.classList.remove('correcto', 'incorrecto');
    // "No lo sé" es un fallo a efectos de motor, pero visualmente es neutro: ni ✓ ni ✗.
    if (!noLoSe) tarjeta.classList.add(correcta ? 'correcto' : 'incorrecto');
  }

  feedbackTexto.textContent = noLoSe ? 'No pasa nada: mañana vuelve' : (correcta ? `✓ +${delta.xp} XP` : '✗');

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

  // Con "no lo sé" la explicación se despliega sola: no tiene sentido pedirle que
  // toque "¿por qué?" para ver algo que él mismo ha dicho no saber.
  explicacionTexto.hidden = !noLoSe;
  explicacionTexto.textContent = pregunta.explicacion;
  reportadaTexto.hidden = true;

  contenedorFeedback.hidden = false;
  // La explicación desplegada puede empujar el botón fuera de la pantalla en el móvil.
  requestAnimationFrame(() => botonSiguiente.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

function irASiguiente() {
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

function finalizarPartida() {
  estado = actualizarRacha(estado, hoy());
  guardarEstado(estado);
  actualizarCabecera();

  resumenAciertos.textContent = `Aciertos: ${aciertosPartida}/${indicePartida}`;
  resumenXp.textContent = `XP ganado: ${xpPartida}`;
  resumenAreas.textContent = `Áreas: ${[...areasPartida].join(', ') || '—'}`;

  mostrarVista('resumen');
}

function renderProgreso() {
  const resumen = resumenProgreso(estado, banco);
  actualizarCabecera();
  progresoHoy.textContent = `Hoy: ${resumen.hoy.respondidas} preguntas, ${resumen.hoy.aciertos} aciertos`;

  progresoAreas.innerHTML = '';
  resumen.porArea.forEach((fila) => {
    const contenedorFila = document.createElement('div');
    contenedorFila.className = 'progreso-area-fila';

    const cabecera = document.createElement('div');
    cabecera.className = 'progreso-area-cabecera';

    const nombre = document.createElement('span');
    nombre.className = 'progreso-area-nombre';
    nombre.textContent = nombreArea(fila.area);

    const detalle = document.createElement('span');
    detalle.className = 'progreso-area-detalle';
    const textoAcierto = fila.aciertoReciente === null ? 'sin datos' : `${Math.round(fila.aciertoReciente * 100)}%`;
    let textoDetalle = `nivel ${fila.nivel} · ${textoAcierto} · ${fila.estables} estables de ${fila.total}`;
    if (fila.noLoSe > 0) textoDetalle += ` · ${fila.noLoSe} no lo sabía`;
    detalle.textContent = textoDetalle;

    cabecera.appendChild(nombre);
    cabecera.appendChild(detalle);

    const track = document.createElement('div');
    track.className = 'barra-track';
    const relleno = document.createElement('div');
    relleno.className = 'barra-relleno';
    relleno.dataset.test = `barra-${fila.area}`;
    const ancho = fila.aciertoReciente === null ? 0 : fila.aciertoReciente * 100;
    relleno.style.width = `${ancho}%`;
    track.appendChild(relleno);

    // Practicar SOLO esta área: arranca una partida filtrada (siguientePregunta
    // recibe { area } como 7º parámetro y solo sirve preguntas de esta área).
    const practicar = document.createElement('button');
    practicar.className = 'enlace practicar-area';
    practicar.dataset.test = `practicar-${fila.area}`;
    practicar.textContent = 'Practicar';
    practicar.disabled = fila.total === 0;
    practicar.addEventListener('click', () => empezarPartida({ area: fila.area }));

    contenedorFila.appendChild(cabecera);
    contenedorFila.appendChild(track);
    contenedorFila.appendChild(practicar);
    progresoAreas.appendChild(contenedorFila);
  });
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
      actualizarCabecera();
      renderProgreso();
    } catch (err) {
      console.error('No se pudo importar el estado:', err.message);
    }
  };
  lector.readAsText(archivo);
}

// --- eventos de navegación ---
// "Jugar" desde inicio siempre arranca sin filtro (aunque quedara uno de una
// práctica anterior sin limpiar); "Otra" en el resumen SÍ respeta el filtro
// vigente, para poder repetir "Practicar <área>" varias veces seguidas.
document.querySelector('[data-test="jugar"]').addEventListener('click', () => empezarPartida(null));
document.querySelector('[data-test="progreso"]').addEventListener('click', () => {
  renderProgreso();
  mostrarVista('progreso');
});
document.querySelector('[data-test="siguiente"]').addEventListener('click', irASiguiente);
document.querySelector('[data-test="porque"]').addEventListener('click', () => {
  explicacionTexto.hidden = false;
});
document.querySelector('[data-test="esta-mal"]').addEventListener('click', marcarPreguntaMal);
document.querySelector('[data-test="no-lo-se"]').addEventListener('click', manejarNoLoSe);
document.querySelector('[data-test="otra"]').addEventListener('click', () => empezarPartida(filtroPartida));
// "←" (cabecera) e "Inicio" (resumen) hacen lo mismo: abandonar/cerrar y volver a
// inicio limpiando el filtro de área, para que el flujo nunca deje callejones.
document.querySelector('[data-test="volver"]').addEventListener('click', volverAInicio);
document.querySelector('[data-test="inicio"]').addEventListener('click', volverAInicio);
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
