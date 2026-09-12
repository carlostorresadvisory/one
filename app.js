// ONE · app.js — UI, gestos y máquina de vistas. Toda la lógica de juego vive en motor.js;
// este fichero solo pinta pantallas y traduce interacción del usuario en llamadas al motor.
import {
  crearEstado,
  seleccionarPartida,
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

let partidaIds = [];
let indicePartida = 0;
let xpPartida = 0;
let aciertosPartida = 0;
let areasPartida = new Set();
let reportadaEnActual = false;

// --- referencias a nodos ---
const nodoRacha = document.querySelector('[data-test="racha"]');
const vistas = document.querySelectorAll('[data-vista]');
const contenedorPregunta = document.getElementById('contenedor-pregunta');
const contenedorFeedback = document.getElementById('contenedor-feedback');
const barraProgresoRelleno = document.getElementById('barra-progreso-relleno');
const feedbackTexto = document.getElementById('feedback-texto');
const feedbackCombo = document.getElementById('feedback-combo');
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
}

function actualizarRachaNodo() {
  nodoRacha.textContent = `🔥 ${estado.racha.dias}`;
}

// --- carga del banco y arranque ---
async function iniciar() {
  const params = new URLSearchParams(location.search);
  const rutaBanco = params.get('ejemplo') === '1' ? 'datos/banco.ejemplo.json' : 'datos/banco.json';
  const respuesta = await fetch(rutaBanco);
  banco = await respuesta.json();
  actualizarRachaNodo();
  mostrarVista('inicio');
}

// --- flujo de partida ---
function empezarPartida() {
  partidaIds = seleccionarPartida(estado, banco, hoy(), N_PARTIDA, Math.random);
  indicePartida = 0;
  xpPartida = 0;
  aciertosPartida = 0;
  areasPartida = new Set();
  mostrarVista('pregunta');
  renderPreguntaActual();
}

function preguntaActual() {
  const id = partidaIds[indicePartida];
  return banco.find((p) => p.id === id) || null;
}

function renderPreguntaActual() {
  if (indicePartida >= partidaIds.length) {
    finalizarPartida();
    return;
  }
  preguntaRespondida = false;
  const pregunta = preguntaActual();
  if (!pregunta) {
    // Id de la partida no encontrado en el banco: se salta a la siguiente.
    indicePartida += 1;
    renderPreguntaActual();
    return;
  }

  barraProgresoRelleno.style.transform = `scaleX(${indicePartida / partidaIds.length})`;
  contenedorFeedback.hidden = true;
  feedbackCombo.hidden = true;
  explicacionTexto.hidden = true;
  reportadaTexto.hidden = true;
  reportadaEnActual = false;

  contenedorPregunta.innerHTML = '';
  const tarjeta = construirTarjetaPregunta(pregunta);
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

  tarjeta.addEventListener('pointerdown', (ev) => {
    activo = true;
    inicioX = ev.clientX;
    tarjeta.setPointerCapture(ev.pointerId);
  });

  tarjeta.addEventListener('pointermove', (ev) => {
    if (!activo) return;
    deltaX = ev.clientX - inicioX;
    tarjeta.style.transform = `translateX(${deltaX}px)`;
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
  estado = resultado.estado;
  guardarEstado(estado);

  xpPartida += resultado.delta.xp;
  if (correcta) aciertosPartida += 1;
  areasPartida.add(pregunta.area);

  mostrarFeedback(pregunta, correcta, resultado.delta);
}

function mostrarFeedback(pregunta, correcta, delta) {
  const tarjeta = contenedorPregunta.querySelector('.tarjeta');
  if (tarjeta) tarjeta.classList.add(correcta ? 'correcto' : 'incorrecto');

  feedbackTexto.textContent = correcta ? `✓ +${delta.xp} XP` : '✗';

  if (delta.combo >= 3) {
    feedbackCombo.hidden = false;
    feedbackCombo.textContent = `Combo ×${delta.combo}`;
  } else {
    feedbackCombo.hidden = true;
  }

  explicacionTexto.hidden = true;
  explicacionTexto.textContent = pregunta.explicacion;
  reportadaTexto.hidden = true;

  contenedorFeedback.hidden = false;
}

function irASiguiente() {
  if (indicePartida >= partidaIds.length) return;
  indicePartida += 1;
  renderPreguntaActual();
}

function marcarPreguntaMal() {
  const pregunta = preguntaActual();
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
  actualizarRachaNodo();

  resumenAciertos.textContent = `Aciertos: ${aciertosPartida}/${partidaIds.length}`;
  resumenXp.textContent = `XP ganado: ${xpPartida}`;
  resumenAreas.textContent = `Áreas: ${[...areasPartida].join(', ') || '—'}`;

  mostrarVista('resumen');
}

function renderProgreso() {
  const resumen = resumenProgreso(estado, banco);
  actualizarRachaNodo();
  progresoHoy.textContent = `Hoy: ${resumen.hoy.respondidas} preguntas, ${resumen.hoy.aciertos} aciertos`;

  progresoAreas.innerHTML = '';
  resumen.porArea.forEach((fila) => {
    const contenedorFila = document.createElement('div');
    contenedorFila.className = 'progreso-area-fila';

    const cabecera = document.createElement('div');
    cabecera.className = 'progreso-area-cabecera';

    const nombre = document.createElement('span');
    nombre.className = 'progreso-area-nombre';
    nombre.textContent = fila.area;

    const detalle = document.createElement('span');
    detalle.className = 'progreso-area-detalle';
    const textoAcierto = fila.aciertoReciente === null ? 'sin datos' : `${Math.round(fila.aciertoReciente * 100)}%`;
    detalle.textContent = `nivel ${fila.nivel} · ${textoAcierto} · ${fila.estables} estables de ${fila.total}`;

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

    contenedorFila.appendChild(cabecera);
    contenedorFila.appendChild(track);
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
      actualizarRachaNodo();
      renderProgreso();
    } catch (err) {
      console.error('No se pudo importar el estado:', err.message);
    }
  };
  lector.readAsText(archivo);
}

// --- eventos de navegación ---
document.querySelector('[data-test="jugar"]').addEventListener('click', empezarPartida);
document.querySelector('[data-test="progreso"]').addEventListener('click', () => {
  renderProgreso();
  mostrarVista('progreso');
});
document.querySelector('[data-test="siguiente"]').addEventListener('click', irASiguiente);
document.querySelector('[data-test="porque"]').addEventListener('click', () => {
  explicacionTexto.hidden = false;
});
document.querySelector('[data-test="esta-mal"]').addEventListener('click', marcarPreguntaMal);
document.querySelector('[data-test="otra"]').addEventListener('click', empezarPartida);
document.querySelector('[data-test="inicio"]').addEventListener('click', () => {
  actualizarRachaNodo();
  mostrarVista('inicio');
});
document.querySelector('[data-test="exportar"]').addEventListener('click', exportarEstado);
document.getElementById('boton-cerrar-progreso').addEventListener('click', () => mostrarVista('inicio'));
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
