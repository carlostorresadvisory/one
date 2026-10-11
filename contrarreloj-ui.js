// ONE · contrarreloj-ui.js — pantalla de Contrarreloj (spec v0.3 §5.4). Traduce toques y tiempo a las
// reglas puras de contrarreloj.js; app.js solo la monta y le inyecta sus dependencias. Una pregunta: la
// foto con el enunciado encima, la barra de tiempo y las respuestas. Fallo o tiempo agotado → «Has caído»
// (con la explicación); 10 aciertos → cofre y «doble o nada». La serie vive solo en memoria (spec §11).
// El tiempo corre con requestAnimationFrame y `performance.now` (nada de setInterval); al ocultar la app
// se pausa y al volver llega OTRA pregunta de la misma posición con el tiempo completo (spec §11).
// Cada paso se cierra con un cerrojo (`fase`) y un antirrebote: un doble toque no responde dos veces.

import {
  N_SERIE, crearSerie, responder as responderSerie, abrirCofre, aceptarDoble, resultadoFinal,
  tiempoPreguntaMs, actualizarRecords, cargarRecords, guardarRecords,
} from './contrarreloj.js';
import { OBJETOS, cargarMochila } from './mochila.js';
import { montarComodines, descartesCincuenta, gastarComodin } from './comodines-ui.js';
import { evaluar, barajarOrden } from './motor.js';
import { montarFotoPregunta } from './foto-pregunta.js';
import { pintarBarraTiempo } from './efectos.js';
import { MS_ANTIREBOTE } from './ordago-ui.js';

// Pausa tras un acierto para que se vea el destello antes de la siguiente pregunta (el reloj no corre).
export const MS_PAUSA_ACIERTO = 450;
export const MS_MAS5 = 5000;
const ETIQUETA_RAREZA = { comun: 'Común', raro: 'Raro', epico: 'Épico' };

function crear(documento, etiqueta, clase, texto) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

const textoRespuesta = (p) => (p.tipo === 'vf' ? (p.respuesta ? 'Verdadero' : 'Falso') : p.opciones[p.correcta]);

/**
 * Monta Contrarreloj en `contenedor` (la `<section data-vista="contrarreloj">`). Dependencias inyectadas:
 * `contenedorCaida`, `contenedorCofre`, `mostrarVista(nombre)`, `elegirPregunta({usados, ultima})` →
 * pregunta|null, `registrar(pregunta, correcta, respuesta)`, `celebrarAcierto(nodo)`, `lamentarFallo(nodo)`,
 * `celebrarPremio(evento)`, `reproducir(sonido)`, `imagenDe(pregunta)`, `darObjetos(ids)`, `alSalir()`,
 * `alSinPreguntas()`, y opcionales `vigia` (el de «pensando»), `almacen`, `rng`, `documento`, `ahora`,
 * `raf`, `cancelarRaf`, `temporizador`. `elegirPregunta({usados, ultima, enSerie})`: una serie no repite
 * preguntas (`enSerie` son las ya salidas en ella), así que devuelve null si no queda ninguna distinta.
 */
export function montarContrarreloj(contenedor, deps) {
  const documento = deps.documento ?? contenedor.ownerDocument ?? globalThis.document;
  const nodo = (id, raiz = contenedor) => raiz.querySelector(`[data-test="${id}"]`);
  const nodoNumero = nodo('contrarreloj-numero');
  const nodoFase = nodo('contrarreloj-fase');
  const nodoFoto = nodo('contrarreloj-foto');
  const nodoBarra = nodo('contrarreloj-barra');
  const nodoOpciones = nodo('contrarreloj-opciones');
  const nodoComodines = nodo('contrarreloj-comodines');
  const caida = deps.contenedorCaida;
  const nodoCaidaResumen = nodo('caida-resumen', caida);
  const nodoCaidaExplicacion = nodo('caida-explicacion', caida);
  const botonReintentar = nodo('caida-reintentar', caida);
  const cofre = deps.contenedorCofre;
  const nodoCofreTitulo = nodo('cofre-titulo', cofre);
  const nodoCofrePremio = nodo('cofre-premio', cofre);
  const nodoCofreNota = nodo('cofre-nota', cofre);
  const botonDoble = nodo('cofre-doble', cofre);
  const botonPlantarse = nodo('cofre-plantarse', cofre);
  const botonRecoger = nodo('cofre-recoger', cofre);

  const ahora = deps.ahora ?? (() => performance.now()); // monótono: un cambio de hora no rompe nada
  const raf = deps.raf ?? ((fn) => globalThis.requestAnimationFrame(fn));
  const cancelarRaf = deps.cancelarRaf ?? ((id) => globalThis.cancelAnimationFrame(id));
  const temporizador = deps.temporizador ?? globalThis;

  let records = cargarRecords(deps.almacen);
  let serie = crearSerie();
  let fase = 'inicio'; // 'jugando' | 'respondida' | 'caida' | 'cofre' | 'salido' | 'destruido'
  let ronda = null; // { pregunta, orden, total, inicio, ultimoTic }
  let premioDoble = [];
  let foto = null;
  let rafId = null;
  let pausaId = null; // pausa tras un acierto
  let pausadaPor = null; // 'jugando' | 'respondida' si la app se ocultó en mitad
  const usados = new Set(); // vistas en toda la sesión: solo sirven para preferir las nuevas entre series
  let enSerie = new Set(); // las de la serie en curso: dentro de una serie, nunca se repite
  let ultima = null;
  let desbloqueoEn = 0;
  const armar = () => { desbloqueoEn = ahora() + MS_ANTIREBOTE; };
  const libre = () => ahora() >= desbloqueoEn;

  // Comodines (spec §6): el 50/50 y el +5 s se descuentan al usarlos; el Salvavidas, solo si de verdad te salva.
  const comodines = nodoComodines && montarComodines(nodoComodines, {
    modo: 'contrarreloj', mochila: () => cargarMochila(deps.almacen), documento, alUsar: usarComodin,
  });
  function usarComodin(id) {
    if (fase !== 'jugando') return;
    if (id === 'cincuenta') {
      ronda.ocultas = descartesCincuenta(ronda.pregunta, deps.rng);
      gastarComodin(id, deps.almacen);
      for (const boton of nodoOpciones.querySelectorAll('button')) {
        boton.hidden = ronda.ocultas.includes(Number(boton.getAttribute('data-original')));
      }
    } else if (id === 'mas5') {
      ronda.total += MS_MAS5; // suma 5 s al tiempo restante; la barra se repinta en el siguiente fotograma
      gastarComodin(id, deps.almacen);
    } else if (id === 'salvavidas') {
      ronda.salvavidas = true;
    }
  }

  const detenerReloj = () => {
    if (rafId !== null) cancelarRaf(rafId);
    rafId = null;
  };
  const detenerPausa = () => {
    if (pausaId !== null) temporizador.clearTimeout(pausaId);
    pausaId = null;
  };

  function guardarFinDeSerie() {
    records = actualizarRecords(records, serie);
    guardarRecords(records, deps.almacen);
  }

  function nuevaPregunta(cambiarVista = false) {
    const pregunta = deps.elegirPregunta({ usados, ultima, enSerie });
    if (!pregunta) {
      fase = 'destruido';
      deps.alSinPreguntas();
      return;
    }
    usados.add(pregunta.id);
    enSerie.add(pregunta.id);
    ultima = pregunta.id;
    if (foto) foto.destruir();
    foto = montarFotoPregunta(nodoFoto, {
      enunciado: pregunta.enunciado, imagen: deps.imagenDe(pregunta), area: pregunta.area, documento,
    });
    const orden = pregunta.tipo === 'vf' ? [] : barajarOrden(pregunta.opciones.length, deps.rng);
    const opciones = pregunta.tipo === 'vf'
      ? [['Verdadero', true], ['Falso', false]]
      : orden.map((original) => [pregunta.opciones[original], original]); // barajadas, con su índice original
    nodoOpciones.classList.toggle('contrarreloj-opciones--vf', pregunta.tipo === 'vf');
    nodoOpciones.replaceChildren(...opciones.map(([texto, valor], i) => {
      const boton = crear(documento, 'button', 'contrarreloj-opcion', texto);
      boton.setAttribute('type', 'button');
      boton.setAttribute('data-test', `contrarreloj-opcion-${i}`);
      boton.setAttribute('data-original', String(valor));
      boton.addEventListener('click', () => { if (libre()) resolver(valor); });
      return boton;
    }));
    nodoNumero.textContent = `${serie.indice + 1}/${N_SERIE}`;
    nodoFase.hidden = serie.fase !== 'doble';
    const total = tiempoPreguntaMs(serie.indice, serie.fase);
    ronda = { pregunta, total, inicio: ahora(), ultimoTic: null, ocultas: [], salvavidas: false };
    comodines?.actualizar({ tipoPregunta: pregunta.tipo, usadosEnPregunta: [] });
    comodines?.visible(true);
    pintarBarraTiempo(nodoBarra, total, total);
    fase = 'jugando';
    pausadaPor = null;
    if (cambiarVista) deps.mostrarVista('contrarreloj'); // entre preguntas la vista no se recarga
    deps.vigia?.reiniciar(); // tras mostrarVista, que lo para; a los 8 s sin responder, la esfinge «piensa»
    detenerReloj();
    rafId = raf(latido);
  }

  /** Un fotograma del reloj: pinta la barra, suena el tictac en los 3 últimos segundos y agota el tiempo. */
  function latido() {
    rafId = null;
    if (fase !== 'jugando') return;
    const restante = ronda.total - (ahora() - ronda.inicio);
    pintarBarraTiempo(nodoBarra, Math.max(0, restante), ronda.total);
    if (restante <= 0) {
      resolver(undefined, { tiempo: true });
      return;
    }
    const segundo = Math.ceil(restante / 1000);
    if (restante <= 3000 && segundo !== ronda.ultimoTic) {
      ronda.ultimoTic = segundo;
      deps.reproducir('tictac');
    }
    rafId = raf(latido);
  }

  /** `valor` undefined = tiempo agotado (no hubo respuesta: no se registra en el radar). */
  function resolver(valor, { tiempo = false, sinPausa = false } = {}) {
    if (fase !== 'jugando') return;
    // Un toque que llega con el plazo ya vencido (carrera entre el click y el fotograma) es tiempo agotado.
    if (!tiempo && ahora() - ronda.inicio >= ronda.total) { tiempo = true; valor = undefined; }
    fase = 'respondida';
    detenerReloj();
    deps.vigia?.parar();
    const { pregunta } = ronda;
    const correcta = !tiempo && evaluar(pregunta, valor);
    const salvada = !correcta && ronda.salvavidas; // el Salvavidas perdona el fallo y también el tiempo agotado
    serie = responderSerie(serie, { correcta, salvavidas: salvada });
    if (salvada) gastarComodin('salvavidas', deps.almacen);
    if (!tiempo) deps.registrar(pregunta, correcta, valor);
    comodines?.visible(false);
    if (salvada) {
      deps.lamentarFallo(nodoFoto);
      if (sinPausa) avanzar();
      else pausaId = temporizador.setTimeout(() => { pausaId = null; avanzar(); }, MS_PAUSA_ACIERTO);
      return;
    }
    if (correcta) {
      deps.celebrarAcierto(nodoFoto);
      if (sinPausa) avanzar();
      else pausaId = temporizador.setTimeout(() => { pausaId = null; avanzar(); }, MS_PAUSA_ACIERTO);
      return;
    }
    deps.lamentarFallo(nodoFoto);
    mostrarCaida(pregunta, tiempo);
  }

  function avanzar() {
    if (fase !== 'respondida') return;
    if (serie.terminada) finDeSerieSuperada();
    else nuevaPregunta();
  }

  function mostrarCaida(pregunta, tiempo) {
    fase = 'caida';
    guardarFinDeSerie();
    const lugar = serie.fase === 'doble' ? 'del doble: pierdes el cofre' : `de ${N_SERIE}`;
    nodoCaidaResumen.textContent = `${tiempo ? 'Se acabó el tiempo. ' : ''}Caíste en la pregunta ${serie.indice + 1} ${lugar}.`;
    nodoCaidaExplicacion.textContent = `Respuesta: ${textoRespuesta(pregunta)}. ${pregunta.explicacion}`;
    armar();
    deps.mostrarVista('caida');
  }

  function pintarPremio(ids) {
    nodoCofrePremio.replaceChildren(...ids.map((id, i) => {
      const objeto = OBJETOS[id];
      const caja = crear(documento, 'div', `cofre-objeto cofre-objeto--${objeto.rareza}`);
      caja.setAttribute('data-test', `cofre-objeto-${i}`);
      caja.setAttribute('data-id', id);
      caja.setAttribute('data-rareza', objeto.rareza);
      const icono = crear(documento, 'span', 'cofre-icono', objeto.icono);
      icono.setAttribute('aria-hidden', 'true');
      caja.append(icono, crear(documento, 'span', 'cofre-nombre', objeto.nombre),
        crear(documento, 'span', `cofre-etiqueta cofre-etiqueta--${objeto.rareza}`, ETIQUETA_RAREZA[objeto.rareza]));
      return caja;
    }));
  }

  function finDeSerieSuperada() {
    guardarFinDeSerie();
    if (serie.fase === 'doble') {
      premioDoble = resultadoFinal(serie, deps.rng);
      nodoCofreTitulo.textContent = '¡Doble superado!';
      pintarPremio(premioDoble);
      nodoCofreNota.textContent = 'Dos objetos, con más suerte que en la primera serie.';
      botonDoble.hidden = true;
      botonPlantarse.hidden = true;
      botonRecoger.hidden = false;
    } else {
      serie = abrirCofre(serie, deps.rng);
      nodoCofreTitulo.textContent = `¡${N_SERIE} de ${N_SERIE}!`;
      pintarPremio(serie.cofre);
      nodoCofreNota.textContent = 'Doble o nada: otras 10 preguntas. Si las superas, 2 objetos; si caes, pierdes este.';
      botonDoble.hidden = false;
      botonPlantarse.hidden = false;
      botonRecoger.hidden = true;
    }
    fase = 'cofre';
    armar();
    deps.mostrarVista('cofre');
    deps.celebrarPremio('cofre'); // confeti + fanfarria + esfinge eufórica
  }

  function reintentar() {
    if (fase !== 'caida') return;
    serie = crearSerie();
    enSerie = new Set();
    armar();
    nuevaPregunta(true);
  }

  function dobleONada() {
    if (fase !== 'cofre' || serie.fase !== 'normal') return;
    serie = aceptarDoble(serie);
    enSerie = new Set();
    armar();
    nuevaPregunta(true);
  }

  function salirConPremio(ids) {
    if (fase !== 'cofre') return;
    fase = 'salido';
    deps.darObjetos(ids);
    deps.alSalir();
  }

  const alReintentar = () => { if (libre()) reintentar(); };
  const alDoble = () => { if (libre()) dobleONada(); };
  const alPlantarse = () => { if (libre() && serie.fase === 'normal') salirConPremio(resultadoFinal(serie, deps.rng)); };
  const alRecoger = () => { if (libre() && serie.fase === 'doble') salirConPremio(premioDoble); };
  botonReintentar.addEventListener('click', alReintentar);
  botonDoble.addEventListener('click', alDoble);
  botonPlantarse.addEventListener('click', alPlantarse);
  botonRecoger.addEventListener('click', alRecoger);

  // Segundo plano: el reloj se para; al volver, la misma posición con OTRA pregunta y el tiempo completo.
  function alCambiarVisibilidad() {
    if (documento.hidden) {
      if (fase === 'jugando') {
        detenerReloj();
        pausadaPor = 'jugando';
      } else if (fase === 'respondida' && pausaId !== null) {
        detenerPausa();
        pausadaPor = 'respondida';
      }
      return;
    }
    const motivo = pausadaPor;
    pausadaPor = null;
    if (motivo === 'jugando' && fase === 'jugando') {
      enSerie.delete(ronda.pregunta.id); // la abandonada no cuenta como vista de la serie (con 10 válidas no habría 11.ª)
      nuevaPregunta();
    }
    else if (motivo === 'respondida') avanzar();
  }
  documento.addEventListener('visibilitychange', alCambiarVisibilidad);

  armar(); // el segundo toque de un doble toque en la tarjeta del hub no cuenta
  nuevaPregunta(true);

  return {
    destruir() {
      // Salir del cofre por cualquier camino («←», otra partida…) es plantarse: el premio no se pierde.
      if (fase === 'cofre') {
        const ids = serie.fase === 'doble' ? premioDoble : resultadoFinal(serie, deps.rng);
        fase = 'destruido';
        deps.darObjetos(ids);
      }
      fase = 'destruido';
      deps.vigia?.parar();
      comodines?.destruir();
      detenerReloj();
      detenerPausa();
      documento.removeEventListener('visibilitychange', alCambiarVisibilidad);
      botonReintentar.removeEventListener('click', alReintentar);
      botonDoble.removeEventListener('click', alDoble);
      botonPlantarse.removeEventListener('click', alPlantarse);
      botonRecoger.removeEventListener('click', alRecoger);
      if (foto) foto.destruir();
      foto = null;
    },
    /** Solo para los e2e (`?test=1`). */
    preguntaActual: () => (ronda ? ronda.pregunta : null),
    responderParaTest(correcta) {
      if (fase !== 'jugando') return false;
      const { pregunta } = ronda;
      const acierto = pregunta.tipo === 'vf' ? pregunta.respuesta : pregunta.correcta;
      const fallo = pregunta.tipo === 'vf' ? !pregunta.respuesta : (pregunta.correcta + 1) % 4;
      resolver(correcta ? acierto : fallo, { sinPausa: true });
      return true;
    },
    /** Responde bien `n` preguntas seguidas (sin pausas) o hasta que la serie deje de estar en juego. */
    acertarParaTest(n) {
      let hechas = 0;
      while (hechas < n && fase === 'jugando') {
        this.responderParaTest(true);
        hechas += 1;
      }
      return hechas;
    },
  };
}
