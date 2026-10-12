// ONE · ordago-ui.js — pantalla de Órdago (spec v0.3 §5.2). Traduce toques a las reglas puras de
// ordago.js; app.js solo la monta y le inyecta sus dependencias. Una ronda: la foto con el enunciado
// encima y las fichas → elegir ficha → respuestas → resultado (+N / −N, explicación, «Siguiente»).
// Cada paso se cierra con un cerrojo (`fase`): un doble toque rápido no apuesta ni responde dos veces.
// Elegir ficha COMPROMETE (spec §5.2): la ronda queda pendiente en `one.ordago`; salir, cambiar de vista o
// recargar antes de responder la resuelve como fallo (ordago.js#resolverPendiente), una sola vez. La pregunta
// dorada se revela DESPUÉS de elegir ficha (si no, convendría apostar todo solo a las doradas).
// Órdago no da objetos: lo que se gana es el fondo (el dinero de la Tienda).

import {
  FICHAS, calcularFicha, gananciaFicha, esDorada, resolverRonda, abrirFondoNuevo, cargarOrdago, cargarOrdagoResuelto, guardarOrdago,
  comprometerFicha, resolverPendiente, puedeFondoNuevo, fechaLocal, formatearCifra, puntosMinicurva,
} from './ordago.js';
import { evaluar, barajarOrden } from './motor.js';
import { montarFotoPregunta } from './foto-pregunta.js';
import { contarCifra, pintarLlama } from './efectos.js';
import { cargarMochila, contarObjetos } from './mochila.js';
import { crearSaberMas, cerrarSaberMas, promptPregunta } from './saber-mas.js';
import { montarComodines, descartesCincuenta, gastarComodin } from './comodines-ui.js';

const SVG = 'http://www.w3.org/2000/svg';
// Tras cada cambio de panel (fichas → respuestas → resultado → siguiente ronda) los botones nuevos caen
// justo donde estaba el pulsado: un doble toque rápido respondería o saltaría sin querer (Review Focus 2).
export const MS_ANTIREBOTE = 350;

/** Dibuja la minicurva del fondo en `svg` (viewBox 60×24): línea cian y, discontinua dorada, el máximo. */
export function pintarMinicurva(svg, { curva, maximo }, documento = svg.ownerDocument ?? globalThis.document) {
  const { puntos, yMaximo } = puntosMinicurva(curva, maximo);
  const maxima = documento.createElementNS(SVG, 'line');
  maxima.setAttribute('class', 'ordago-curva-maximo');
  maxima.setAttribute('x1', '0');
  maxima.setAttribute('x2', '60');
  maxima.setAttribute('y1', String(yMaximo));
  maxima.setAttribute('y2', String(yMaximo));
  const linea = documento.createElementNS(SVG, 'polyline');
  linea.setAttribute('class', 'ordago-curva-linea');
  linea.setAttribute('points', puntos);
  svg.replaceChildren(maxima, linea);
}

function crear(documento, etiqueta, clase, texto) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

const textoRespuesta = (p) => (p.tipo === 'vf' ? (p.respuesta ? 'Verdadero' : 'Falso') : p.opciones[p.correcta]);

/**
 * Monta Órdago en `contenedor` (la `<section data-vista="ordago">`). Dependencias inyectadas:
 * `contenedorQuiebra`, `mostrarVista(nombre)`, `elegirPregunta({usados, ultima})` → pregunta|null,
 * `registrar(pregunta, correcta, respuesta)`, `celebrarAcierto(nodo, 'monedas')`, `lamentarFallo(nodo)`,
 * `celebrarPremio(evento)`, `resplandorEsfinge()`, `imagenDe(pregunta)`, `pedirGesto(evento)`,
 * `alSinPreguntas()`, `alVenderObjetos()` (quiebra → Tienda), y opcionales `vigia` (el de «pensando»), `almacen`, `rng`, `documento`,
 * `hoy()` (fecha local AAAA-MM-DD del fondo nuevo diario).
 */
export function montarOrdago(contenedor, deps) {
  const documento = deps.documento ?? contenedor.ownerDocument ?? globalThis.document;
  const nodo = (id, raiz = contenedor) => raiz.querySelector(`[data-test="${id}"]`);
  const nodoFondo = nodo('ordago-fondo');
  const nodoRacha = nodo('ordago-racha');
  const nodoCurva = nodo('ordago-curva');
  const nodoFoto = nodo('ordago-foto');
  const nodoFichas = nodo('ordago-fichas');
  const nodoOpciones = nodo('ordago-opciones');
  const nodoResultado = nodo('ordago-resultado');
  const nodoDelta = nodo('ordago-delta');
  const nodoAviso = nodo('ordago-aviso');
  const nodoExplicacion = nodo('ordago-explicacion');
  const huecoSaberMas = nodo('ordago-saber-mas');
  const botonSiguiente = nodo('ordago-siguiente');
  const quiebra = deps.contenedorQuiebra;
  const nodoQuiebraMaximo = nodo('quiebra-maximo', quiebra);
  const botonFondoNuevo = nodo('quiebra-fondo-nuevo', quiebra);
  const botonVender = nodo('quiebra-vender', quiebra);
  const nodoManana = nodo('quiebra-manana', quiebra);
  const hoy = deps.hoy ?? (() => fechaLocal());
  const nodoComodines = nodo('ordago-comodines');

  // Una ronda comprometida y sin responder (recarga, o iOS mató la app): se resuelve como fallo, una sola vez.
  let estado = cargarOrdagoResuelto(deps.almacen);
  let fase = 'inicio'; // 'ficha' | 'opciones' | 'resuelta' | 'quiebra' | 'destruido'
  let ronda = null; // { pregunta, dorada, ficha }
  let foto = null;
  const usados = new Set();
  let ultima = null;
  const ahora = deps.ahora ?? (() => performance.now()); // monótono: un cambio de hora no rompe el antirrebote
  let desbloqueoEn = 0;
  const armar = () => { desbloqueoEn = ahora() + MS_ANTIREBOTE; };
  const libre = () => ahora() >= desbloqueoEn;
  let generacionFondo = 0;
  // Comodines (spec §6): 50/50 y Salvavidas valen (y se descuentan) solo para la ronda en curso. Saltar solo antes de
  // elegir ficha (después la ficha está comprometida, spec §5.2); el resto, solo después.
  const soloAntesDeFicha = (id) => id === 'saltar';
  const soloConFicha = (id) => id !== 'saltar';
  const comodines = nodoComodines && montarComodines(nodoComodines, {
    modo: 'ordago', mochila: () => cargarMochila(deps.almacen), documento, alUsar: usarComodin,
  });

  function pintarMarcador(desde = null) {
    generacionFondo += 1;
    const mia = generacionFondo;
    const real = globalThis.window;
    if (desde !== null && desde !== estado.fondo && real?.requestAnimationFrame) {
      // La cuenta se cancela sola si el marcador se vuelve a pintar antes de que acabe.
      const ventana = {
        matchMedia: (consulta) => real.matchMedia(consulta),
        performance: real.performance,
        requestAnimationFrame: (fn) => real.requestAnimationFrame((t) => { if (mia === generacionFondo) fn(t); }),
      };
      contarCifra(nodoFondo, { desde, hasta: estado.fondo, duracionMs: 500, formato: formatearCifra, ventana });
    } else {
      nodoFondo.textContent = formatearCifra(estado.fondo);
    }
    pintarLlama(nodoRacha, estado.racha);
    pintarMinicurva(nodoCurva, estado, documento);
  }

  const mostrar = (cual) => {
    nodoFichas.hidden = cual !== 'fichas';
    nodoOpciones.hidden = cual !== 'opciones';
    nodoResultado.hidden = cual !== 'resultado';
    comodines?.visible(cual === 'fichas' || cual === 'opciones'); // con las fichas, solo Saltar; con las opciones, los demás
  };

  /** El 50/50 y Saltar se descuentan al usarlos; el Salvavidas queda armado y solo se descuenta si de verdad perdona un fallo. */
  function usarComodin(id) {
    if (id === 'saltar') {
      // Otra pregunta, sin ficha ni registro. Si no hay otra, no se gasta; el antirrebote evita saltar dos veces de un doble toque.
      if (fase !== 'ficha' || !libre() || !nuevaRonda(false, { saltar: true })) return false;
      gastarComodin(id, deps.almacen);
      return true;
    }
    if (fase !== 'ficha' && fase !== 'opciones') return false;
    if (id === 'cincuenta') {
      ronda.ocultas = descartesCincuenta(ronda.pregunta, deps.rng);
      gastarComodin(id, deps.almacen);
      ocultarDescartadas();
    } else if (id === 'salvavidas') {
      ronda.salvavidas = true;
    }
    return true;
  }

  function ocultarDescartadas() {
    nodoOpciones.classList.toggle('ordago-opciones--dos', ronda.ocultas.length > 0); // las 2 que quedan, en una columna: sin hueco debajo
    if (!ronda.ocultas.length) return;
    for (const boton of nodoOpciones.querySelectorAll('button')) {
      boton.hidden = ronda.ocultas.includes(Number(boton.getAttribute('data-original')));
    }
  }

  /** Prepara la ronda siguiente. Con `saltar` (comodín) y sin otra pregunta no se acaba la partida: devuelve false y nada cambia. */
  function nuevaRonda(cambiarVista = false, { saltar = false } = {}) {
    if (estado.fondo < 1) {
      cerrarSaberMas();
      mostrarQuiebra();
      return false;
    }
    const pregunta = deps.elegirPregunta({ usados, ultima });
    if (!pregunta) {
      if (saltar) return false;
      cerrarSaberMas();
      fase = 'destruido';
      deps.alSinPreguntas();
      return false;
    }
    cerrarSaberMas();
    usados.add(pregunta.id);
    ultima = pregunta.id;
    const dorada = esDorada(deps.rng); // se decide ya, pero no se enseña hasta elegir ficha
    if (foto) foto.destruir();
    foto = montarFotoPregunta(nodoFoto, {
      enunciado: pregunta.enunciado, imagen: deps.imagenDe(pregunta), area: pregunta.area, dorada: false, documento,
    });
    ronda = { pregunta, dorada, ficha: 0, ocultas: [], salvavidas: false, orden: pregunta.tipo === 'vf' ? [] : barajarOrden(pregunta.opciones.length, deps.rng) };
    pintarMarcador();

    nodoFichas.replaceChildren(...FICHAS.map((f) => {
      // Cada ficha enseña lo que juega y lo que ganaría al acertar con el multiplicador de esta pregunta
      // (nivel y racha: ordago.js#gananciaFicha, el mismo cálculo que resolverRonda) SIN el factor dorada,
      // que aún no se conoce.
      const apuesta = calcularFicha(estado.fondo, f.pct);
      const gana = gananciaFicha({ fondo: estado.fondo, pct: f.pct, nivel: pregunta.nivel, dorada: false, racha: estado.racha });
      const boton = crear(documento, 'button', `ordago-ficha${f.id === 'ordago' ? ' ordago-ficha--ordago' : ''}`);
      boton.append(
        crear(documento, 'span', 'ordago-ficha-apuesta', `${f.texto} · ${formatearCifra(apuesta)}`),
        crear(documento, 'span', 'ordago-ficha-gana', `→ +${formatearCifra(gana)}`),
      );
      boton.setAttribute('aria-label', `Apostar ${formatearCifra(apuesta)} (${f.texto}); si aciertas ganas ${formatearCifra(gana)}`);
      boton.setAttribute('type', 'button');
      boton.setAttribute('data-test', `ficha-${f.id}`);
      boton.addEventListener('click', () => { if (libre()) elegirFicha(f); });
      return boton;
    }));
    nodoFichas.append(crear(documento, 'p', 'ordago-fichas-aviso', 'Si sales, la pierdes'));
    mostrar('fichas');
    comodines?.actualizar({ tipoPregunta: pregunta.tipo, usadosEnPregunta: [], filtro: soloAntesDeFicha });
    fase = 'ficha';
    armar();
    if (cambiarVista) deps.mostrarVista('ordago'); // entre rondas la vista no se recarga
    deps.vigia?.reiniciar(); // después de mostrarVista, que lo para: así arranca también en la primera ronda
    return true;
  }

  function elegirFicha(ficha) {
    if (fase !== 'ficha') return;
    fase = 'opciones';
    armar();
    ronda.ficha = calcularFicha(estado.fondo, ficha.pct);
    const { pregunta } = ronda;
    estado = comprometerFicha(estado, { pregunta: pregunta.id, ficha: ronda.ficha }); // desde aquí, salir es perder la ficha
    guardarOrdago(estado, deps.almacen);
    if (ronda.dorada) { // la dorada se revela ahora
      foto?.ponerDorada(true);
      deps.pedirGesto('dorada');
    }
    const opciones = pregunta.tipo === 'vf'
      ? [['Verdadero', true], ['Falso', false]]
      : ronda.orden.map((original) => [pregunta.opciones[original], original]); // barajadas, con su índice original
    nodoOpciones.replaceChildren(...opciones.map(([texto, valor], i) => {
      const boton = crear(documento, 'button', 'ordago-opcion', texto);
      boton.setAttribute('type', 'button');
      boton.setAttribute('data-test', `ordago-opcion-${i}`);
      boton.setAttribute('data-original', String(valor));
      boton.addEventListener('click', () => { if (libre()) responder(valor); });
      return boton;
    }));
    ocultarDescartadas();
    mostrar('opciones');
    comodines?.actualizar({ filtro: soloConFicha });
  }

  function responder(valor) {
    if (fase !== 'opciones') return;
    fase = 'resuelta';
    armar();
    const { pregunta, dorada, ficha } = ronda;
    const correcta = evaluar(pregunta, valor);
    const antes = estado.fondo;
    const salvavidas = ronda.salvavidas && !correcta;
    const resultado = resolverRonda(estado, { ficha, correcta, nivel: pregunta.nivel, dorada, salvavidas });
    if (salvavidas) gastarComodin('salvavidas', deps.almacen);
    estado = resultado.estado;
    guardarOrdago(estado, deps.almacen); // resolverRonda ya limpió la ronda pendiente: recargar ahora no cobra dos veces
    deps.registrar(pregunta, correcta, valor);

    nodoDelta.textContent = `${resultado.delta >= 0 ? '+' : '−'}${formatearCifra(Math.abs(resultado.delta))}`;
    nodoDelta.classList.toggle('ordago-delta--ok', correcta);
    nodoDelta.classList.toggle('ordago-delta--ko', !correcta);
    nodoAviso.hidden = !resultado.nuevoMaximo;
    nodoAviso.textContent = resultado.nuevoMaximo ? `Nuevo máximo · ${formatearCifra(estado.maximo)}` : '';
    nodoExplicacion.textContent = `${salvavidas ? '🛟 Salvavidas: pierdes la mitad de la ficha y la racha sigue. ' : ''}Respuesta: ${textoRespuesta(pregunta)}. ${pregunta.explicacion}`;
    botonSiguiente.textContent = resultado.quiebra ? 'Continuar' : 'Siguiente';
    pintarMarcador(antes);
    huecoSaberMas?.replaceChildren(crearSaberMas({ prompt: promptPregunta(pregunta), documento }).elemento);
    mostrar('resultado');

    if (correcta) deps.celebrarAcierto(nodoFoto, 'monedas');
    else deps.lamentarFallo(nodoFoto);
    if (resultado.nuevoMaximo) {
      deps.celebrarPremio('nuevoMaximo'); // confeti + fanfarria + esfinge eufórica; sin objeto
      deps.resplandorEsfinge();
    }
  }

  function siguiente() {
    if (fase !== 'resuelta') return;
    if (estado.fondo < 1) mostrarQuiebra();
    else nuevaRonda();
  }

  function mostrarQuiebra() {
    fase = 'quiebra';
    armar();
    nodoQuiebraMaximo.textContent = `Máximo alcanzado: ${formatearCifra(estado.maximo)}`;
    const hayFondoNuevo = puedeFondoNuevo(estado, hoy());
    botonFondoNuevo.hidden = !hayFondoNuevo; // un fondo nuevo gratis al día; ya usado, queda «Vuelve mañana»
    if (nodoManana) nodoManana.hidden = hayFondoNuevo;
    if (botonVender) botonVender.hidden = contarObjetos(cargarMochila(deps.almacen)) < 1; // spec §5.2: con objetos, también se pueden vender
    deps.vigia?.parar();
    deps.mostrarVista('quiebra');
    deps.pedirGesto('quiebra');
  }

  function fondoNuevo() {
    if (fase !== 'quiebra' || !puedeFondoNuevo(estado, hoy())) return;
    estado = abrirFondoNuevo(estado, hoy());
    guardarOrdago(estado, deps.almacen);
    nuevaRonda(true);
  }

  const alSiguiente = () => { if (libre()) siguiente(); };
  const alFondoNuevo = () => { if (libre()) fondoNuevo(); };
  botonSiguiente.addEventListener('click', alSiguiente);
  botonFondoNuevo.addEventListener('click', alFondoNuevo);
  const alVender = () => { if (libre() && fase === 'quiebra') deps.alVenderObjetos(); };
  botonVender?.addEventListener('click', alVender);
  nuevaRonda(true);

  return {
    destruir() {
      // Salir («←», otra vista, otra partida) con la ficha elegida y sin responder cuenta como fallo.
      if (fase === 'opciones' && estado.pendiente) {
        const perdida = resolverPendiente(estado);
        if (perdida) {
          estado = perdida.estado;
          guardarOrdago(estado, deps.almacen);
        }
      }
      fase = 'destruido';
      cerrarSaberMas();
      botonSiguiente.removeEventListener('click', alSiguiente);
      botonFondoNuevo.removeEventListener('click', alFondoNuevo);
      botonVender?.removeEventListener('click', alVender);
      if (foto) foto.destruir();
      foto = null;
      deps.vigia?.parar();
      comodines?.destruir();
    },
    /** Solo para los e2e (`?test=1`). */
    preguntaActual: () => (ronda ? ronda.pregunta : null),
    responderParaTest(correcta) {
      if (!ronda) return false;
      const { pregunta } = ronda;
      const acierto = pregunta.tipo === 'vf' ? pregunta.respuesta : pregunta.correcta;
      const fallo = pregunta.tipo === 'vf' ? !pregunta.respuesta : (pregunta.correcta + 1) % 4;
      responder(correcta ? acierto : fallo);
      return true;
    },
  };
}
