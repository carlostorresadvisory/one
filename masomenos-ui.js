// ONE · masomenos-ui.js — pantalla de Más o menos (spec v0.3 §5.3 y §5.3.1). Traduce toques a las reglas puras
// de masomenos.js y dibuja con escala.js; app.js solo la monta y le inyecta sus dependencias. Dos variantes con un
// interruptor (Comparar | Afinar; la última se recuerda en `one.masomenos`):
//   · Comparar: dos tarjetas con la foto de su cifra, «Más» / «Menos» (fechas: «Después» / «Antes»), la cifra
//     oculta se revela contando; acierto → la de abajo sube; fallo → racha a 0 y se enseña la diferencia.
//   · Afinar: la barra fija la estimación; las dos fotos a escala real (o la línea temporal con la foto del
//     evento) y la calificación Clavado / Muy cerca / Cerca / Lejos.
// Las cifras NO son preguntas del banco: aquí no hay `registrarRespuesta` y nada toca el radar.
// Cada paso se cierra con un cerrojo (`fase`) y un antirrebote de 350 ms: un doble toque no responde dos veces.

import {
  CATEGORIAS, elegirPareja, evaluarComparar, etiquetasBotones, registrarResultado, escalaBarra, valorDesdePosicion,
  posicionDesdeValor, calificar, cuentaParaRacha, formatearValor, valorConUnidad, esFecha, TEXTO_CALIFICACION,
  cargarMasomenos, guardarMasomenos,
} from './masomenos.js';
import { montarEscenaFotos, montarLineaTemporal } from './escala.js';
import { montarFotoPregunta, creditoTexto, reintentarImagen } from './foto-pregunta.js';
import { contarCifra, pintarLlama } from './efectos.js';
import { sortearObjeto, OBJETOS, cargarMochila } from './mochila.js';
import { crearSaberMas, cerrarSaberMas, promptComparar, promptAfinar } from './saber-mas.js';
import { montarComodines, gastarComodin } from './comodines-ui.js';
import { MS_ANTIREBOTE } from './ordago-ui.js';

const RECIENTES = 12; // ids vistos hace poco: se evitan mientras haya alternativa
const PASOS_BARRA = 10000; // posiciones de la barra (fechas: una por año)

// Lo que se le pregunta al jugador en cada categoría.
const PREGUNTA_COMPARAR = {
  'altitud-montana': '¿Es más o menos alta que la de arriba?',
  'altura-edificio': '¿Es más o menos alto que el de arriba?',
  'longitud-rio': '¿Es más o menos largo que el de arriba?',
  'poblacion-pais': '¿Tiene más o menos habitantes?',
  'poblacion-ciudad': '¿Tiene más o menos habitantes?',
  'superficie-pais': '¿Tiene más o menos superficie?',
  'pib-pais': '¿Tiene más o menos PIB?',
  'ano-obra': '¿Se pintó antes o después?',
  'ano-hecho': '¿Fue antes o después?',
};
// El nombre va delante y la pregunta detrás: así no hace falta artículo («el Amur», «la Batalla de…»).
const PREGUNTA_AFINAR = {
  'altitud-montana': (n) => `${n}: ¿qué altitud tiene?`,
  'altura-edificio': (n) => `${n}: ¿qué altura tiene?`,
  'longitud-rio': (n) => `${n}: ¿cuánto mide?`,
  'poblacion-pais': (n) => `${n}: ¿cuántos habitantes tiene?`,
  'poblacion-ciudad': (n) => `${n}: ¿cuántos habitantes tiene?`,
  'superficie-pais': (n) => `${n}: ¿qué superficie tiene?`,
  'pib-pais': (n) => `${n}: ¿cuál es su PIB?`,
  'ano-obra': (n) => `${n}: ¿en qué año se pintó?`,
  'ano-hecho': (n) => `${n}: ¿en qué año fue?`,
};

function crear(documento, etiqueta, clase, texto) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** Tamaño de la cifra de la tarjeta según lo larga que sea ya escrita (la oculta se mide con su valor real): sin partirla ni salirse. */
export function tamanoValor(texto) {
  const n = String(texto).length;
  return n <= 11 ? 'normal' : n <= 17 ? 'medio' : 'largo';
}

/** Tres cifras significativas: la barra no pide precisión de unidades en un país de millones. */
export function redondearEstimacion(valor, categoria) {
  if (esFecha(categoria)) return Math.round(valor);
  if (!Number.isFinite(valor) || valor === 0) return 0;
  const orden = 10 ** (Math.floor(Math.log10(Math.abs(valor))) - 2);
  return Math.round(valor / orden) * orden;
}

/** «2.849 m más» / «73 años después»: la diferencia entre la cifra de abajo y la de arriba. */
export function diferenciaTexto(arriba, abajo) {
  const delta = abajo.valor - arriba.valor;
  if (esFecha(abajo.categoria)) {
    const anos = Math.abs(Math.round(delta));
    return `${formatearValor(anos, 'x')} ${anos === 1 ? 'año' : 'años'} ${delta > 0 ? 'después' : 'antes'}`;
  }
  return `${valorConUnidad({ ...abajo, valor: Math.abs(delta) })} ${delta > 0 ? 'más' : 'menos'}`;
}

/**
 * Monta Más o menos en `contenedor` (la `<section data-vista="masomenos">`). Dependencias inyectadas:
 * `cifras` (el banco ya cargado), `area` (filtro de área o null), `mostrarVista(nombre)`, `alSinParejas()`,
 * `celebrarAcierto(nodo)`, `lamentarFallo(nodo)`, `celebrarPremio(evento)`, `darObjetos(ids)`, `pedirGesto(evento)`,
 * y opcionales `vigia` (el de «pensando»), `almacen`, `rng`, `documento`, `ahora`.
 */
export function montarMasomenos(contenedor, deps) {
  const documento = deps.documento ?? contenedor.ownerDocument ?? globalThis.document;
  const nodo = (id) => contenedor.querySelector(`[data-test="${id}"]`);
  const nodoRacha = nodo('mm-racha');
  const nodoRecord = nodo('mm-record');
  const nodoCuerpo = nodo('mm-cuerpo');
  const botonComparar = nodo('mm-var-comparar');
  const botonAfinar = nodo('mm-var-afinar');
  const rng = deps.rng ?? Math.random;
  const ahora = deps.ahora ?? (() => performance.now()); // monótono: un cambio de hora no rompe el antirrebote

  let estado = cargarMasomenos(deps.almacen);
  let variante = estado.variante;
  let fase = 'inicio'; // 'comparar' | 'afinar' | 'revelada' | 'destruido'
  let ronda = null; // la ronda en curso (pareja, escala, instancias de escala.js)
  let limpiarRonda = () => {};
  const recientes = [];
  let desbloqueoEn = 0;
  const armar = () => { desbloqueoEn = ahora() + MS_ANTIREBOTE; };
  const libre = () => ahora() >= desbloqueoEn;
  let generacionCuenta = 0;
  // El récord se celebra una sola vez por racha: la primera vez que la racha supera el récord que había al empezarla.
  // Tras recargar a mitad de una racha que ya iba en el récord (racha ≥ récord) ya se celebró: no se repite; si iba por
  // debajo, el récord de ahora es el de entonces.
  const recordCelebrado = {
    comparar: estado.comparar.racha > 0 && estado.comparar.racha >= estado.comparar.record,
    afinar: estado.afinar.racha > 0 && estado.afinar.racha >= estado.afinar.record,
  };
  const oyentes = []; // [nodo, tipo, fn]: se quitan todos al destruir
  const escuchar = (n, tipo, fn) => { n.addEventListener(tipo, fn); oyentes.push([n, tipo, fn]); };

  function pintarMarcador() {
    const v = estado[variante];
    pintarLlama(nodoRacha, v.racha);
    nodoRecord.textContent = `Récord ${v.record}`;
    botonComparar.setAttribute('aria-pressed', String(variante === 'comparar'));
    botonAfinar.setAttribute('aria-pressed', String(variante === 'afinar'));
    botonComparar.classList.toggle('mm-var--activa', variante === 'comparar');
    botonAfinar.classList.toggle('mm-var--activa', variante === 'afinar');
  }

  /** Cuenta de 0 a `hasta` en el nodo; se cancela sola si la pantalla pasa a otra ronda. */
  function contar(nodoCifra, cifra) {
    generacionCuenta += 1;
    const mia = generacionCuenta;
    const real = globalThis.window;
    const formato = (n) => (esFecha(cifra.categoria) ? formatearValor(n, cifra.categoria) : valorConUnidad({ ...cifra, valor: n }));
    if (!real?.requestAnimationFrame) {
      nodoCifra.textContent = formato(cifra.valor);
      return;
    }
    const ventana = {
      matchMedia: (consulta) => real.matchMedia(consulta),
      performance: real.performance,
      requestAnimationFrame: (fn) => real.requestAnimationFrame((t) => { if (mia === generacionCuenta) fn(t); }),
    };
    contarCifra(nodoCifra, { desde: 0, hasta: cifra.valor, duracionMs: 700, formato, ventana });
  }

  let parejaForzada = null; // solo e2e (`fijarParejaParaTest`): la próxima pareja es esta
  function elegirPar(opciones = {}) {
    const forzada = parejaForzada;
    parejaForzada = null;
    const par = forzada ?? elegirPareja(deps.cifras, { area: deps.area ?? null, variante, rng, excluir: recientes, ...opciones });
    if (par) {
      for (const c of par) if (!recientes.includes(c.id)) recientes.push(c.id);
      while (recientes.length > RECIENTES) recientes.shift();
    }
    return par;
  }

  function vaciar() {
    cerrarSaberMas();
    ronda?.comodines?.destruir();
    limpiarRonda();
    limpiarRonda = () => {};
    generacionCuenta += 1;
    nodoCuerpo.replaceChildren();
    ronda = null;
  }

  // --- Resultado común (racha, récord, premio) ---------------------------------------------------------------

  /** Aplica el resultado a la racha de la variante, lo guarda y devuelve el texto del premio (o ''). */
  function anotar(acierto) {
    const antes = estado[variante].record;
    const salvavidas = !acierto && Boolean(ronda?.salvavidas); // el Salvavidas mantiene la racha y se descuenta solo aquí
    if (salvavidas) gastarComodin('salvavidas', deps.almacen);
    const r = registrarResultado(estado, variante, { acierto, salvavidas });
    estado = { ...r.estado, variante };
    guardarMasomenos(estado, deps.almacen);
    pintarMarcador();
    const superaRecord = acierto && antes > 0 && estado[variante].record > antes;
    let premio = '';
    if (r.premio) {
      const id = sortearObjeto(rng, 'normal');
      deps.darObjetos([id]);
      premio = `Premio: ${OBJETOS[id].icono} ${OBJETOS[id].nombre}`;
      deps.celebrarPremio('cofre');
    } else if (superaRecord && !recordCelebrado[variante]) {
      deps.pedirGesto('record'); // superar tu propio récord se celebra con la esfinge (una vez por racha) aunque no toque premio
    }
    if (superaRecord || (acierto && antes === 0)) recordCelebrado[variante] = true; // sin récord previo no hay nada que superar
    else if (!acierto) recordCelebrado[variante] = false; // la racha siguiente vuelve a poder celebrarlo
    return premio;
  }

  /** Barra de comodines de la ronda (solo Salvavidas aplica a Más o menos), primer hijo del mando. */
  function montarBarraComodines(mando) {
    const barra = crear(documento, 'div', 'mm-comodines');
    barra.setAttribute('data-test', 'mm-comodines');
    mando.prepend(barra);
    ronda.comodines = montarComodines(barra, {
      modo: 'masomenos', mochila: () => cargarMochila(deps.almacen), documento,
      alUsar: (id) => {
        if (id !== 'salvavidas') return false;
        ronda.salvavidas = true;
        return true;
      },
    });
  }

  function panelResultado(clase) {
    const raiz = crear(documento, 'div', `mm-resultado ${clase}`);
    raiz.setAttribute('data-test', 'mm-resultado');
    raiz.setAttribute('aria-live', 'polite');
    return raiz;
  }

  function filaResultado(titulo, tituloClase, onSiguiente) {
    const fila = crear(documento, 'div', 'mm-resultado-fila');
    const t = crear(documento, 'span', `mm-resultado-titulo ${tituloClase}`, titulo);
    t.setAttribute('data-test', 'mm-resultado-titulo');
    const siguiente = crear(documento, 'button', 'boton boton-principal mm-siguiente', 'Siguiente');
    siguiente.setAttribute('type', 'button');
    siguiente.setAttribute('data-test', 'mm-siguiente');
    escuchar(siguiente, 'click', () => { if (libre()) onSiguiente(); });
    fila.append(t, siguiente);
    return fila;
  }

  /** «Saber +» al pie del panel de resultado, con el prompt de cifras de la ronda. */
  function huecoSaberMas(prompt) {
    const hueco = crear(documento, 'div', 'saber-mas-hueco');
    hueco.appendChild(crearSaberMas({ prompt, documento }).elemento);
    return hueco;
  }

  // --- COMPARAR -----------------------------------------------------------------------------------------------

  function tarjeta(cifra, oculta) {
    const raiz = crear(documento, 'article', 'mm-tarjeta');
    raiz.setAttribute('data-area', cifra.area);
    raiz.setAttribute('data-test', oculta ? 'mm-abajo' : 'mm-arriba');
    let credito = null;
    if (cifra.imagen && typeof cifra.imagen.url === 'string' && cifra.imagen.url) {
      const img = crear(documento, 'img', 'mm-tarjeta-img');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = cifra.imagen.url;
      reintentarImagen(img, () => { img.remove(); if (credito) credito.remove(); });
      raiz.appendChild(img);
      const texto = creditoTexto(cifra.imagen);
      if (texto) {
        credito = crear(documento, 'span', 'mm-credito', texto);
        credito.setAttribute('data-test', 'mm-credito');
      }
    }
    const velo = crear(documento, 'div', 'mm-tarjeta-velo');
    velo.setAttribute('aria-hidden', 'true');
    const textos = crear(documento, 'div', 'mm-tarjeta-textos');
    const nombre = crear(documento, 'p', 'mm-tarjeta-nombre', cifra.nombre);
    const valor = crear(documento, 'p', `mm-tarjeta-valor mm-tarjeta-valor--${tamanoValor(valorConUnidad(cifra))}`, oculta ? '?' : valorConUnidad(cifra));
    valor.setAttribute('data-test', oculta ? 'mm-valor-abajo' : 'mm-valor-arriba');
    textos.append(nombre, valor);
    raiz.append(velo, textos);
    if (credito) raiz.appendChild(credito);
    return { raiz, valor };
  }

  function nuevaComparar(arriba = null, cambiarVista = false) {
    vaciar();
    const par = arriba ? elegirPar({ arriba }) ?? elegirPar() : elegirPar();
    if (!par) {
      fase = 'destruido';
      deps.alSinParejas();
      return;
    }
    const [cima, fondo] = par;
    ronda = { cima, fondo };
    const tarjetas = crear(documento, 'div', 'mm-tarjetas');
    tarjetas.setAttribute('data-test', 'mm-tarjetas');
    const tArriba = tarjeta(cima, false);
    const tAbajo = tarjeta(fondo, true);
    tarjetas.append(tArriba.raiz, tAbajo.raiz);
    const mando = crear(documento, 'div', 'mm-mando');
    const pregunta = crear(documento, 'p', 'mm-pregunta', PREGUNTA_COMPARAR[fondo.categoria] ?? '¿Más o menos?');
    const botones = crear(documento, 'div', 'mm-botones');
    botones.setAttribute('role', 'group');
    botones.setAttribute('aria-label', 'Respuesta');
    const [textoMas, textoMenos] = etiquetasBotones(fondo.categoria);
    const crearBoton = (texto, eleccion) => {
      const b = crear(documento, 'button', 'mm-boton', texto);
      b.setAttribute('type', 'button');
      b.setAttribute('data-test', `mm-${eleccion}`);
      escuchar(b, 'click', () => { if (libre()) resolverComparar(eleccion); });
      return b;
    };
    botones.append(crearBoton(textoMas, 'mas'), crearBoton(textoMenos, 'menos'));
    mando.append(pregunta, botones);
    nodoCuerpo.append(tarjetas, mando);
    ronda.nodos = { tarjetas, tAbajo, tArriba, mando, botones };
    montarBarraComodines(mando);
    fase = 'comparar';
    armar();
    deps.vigia?.reiniciar();
    if (cambiarVista) deps.mostrarVista('masomenos');
  }

  function resolverComparar(eleccion) {
    if (fase !== 'comparar') return;
    fase = 'revelada';
    armar();
    const { cima, fondo, nodos } = ronda;
    const acierto = evaluarComparar(cima, fondo, eleccion);
    nodos.botones.hidden = true;
    contar(nodos.tAbajo.valor, fondo);
    nodos.tAbajo.raiz.classList.add(acierto ? 'mm-tarjeta--acierto' : 'mm-tarjeta--fallo');
    if (acierto) deps.celebrarAcierto(nodos.tAbajo.raiz);
    else deps.lamentarFallo(nodos.tAbajo.raiz);
    const salvada = !acierto && Boolean(ronda.salvavidas);
    const premio = anotar(acierto); // después de celebrar: el gesto del récord o del premio sustituye al del acierto

    const panel = panelResultado(acierto ? 'mm-resultado--ok' : 'mm-resultado--ko');
    panel.append(filaResultado(acierto ? '¡Correcto!' : `Fallaste${salvada ? ' · 🛟 racha salvada' : ''}`, acierto ? 'mm-resultado-titulo--ok' : 'mm-resultado-titulo--ko', () => siguienteComparar(acierto)));
    const diferencia = crear(documento, 'p', 'mm-diferencia', `${fondo.nombre}: ${diferenciaTexto(cima, fondo)}`);
    diferencia.setAttribute('data-test', 'mm-diferencia');
    panel.appendChild(diferencia);
    if (premio) {
      const p = crear(documento, 'p', 'mm-premio', premio);
      p.setAttribute('data-test', 'mm-premio');
      panel.appendChild(p);
    }
    if (typeof fondo.nota === 'string' && fondo.nota) {
      const n = crear(documento, 'p', 'mm-nota', fondo.nota);
      n.setAttribute('data-test', 'mm-nota');
      panel.appendChild(n);
    }
    panel.appendChild(huecoSaberMas(promptComparar(cima, fondo)));
    nodos.mando.replaceChildren(panel);

    // Las categorías de tamaño reutilizan la revelación a escala de Afinar: las dos fotos a su tamaño verdadero.
    if (CATEGORIAS[fondo.categoria].foto !== 'linea') revelarAEscala(cima, fondo, nodos);
  }

  function revelarAEscala(cima, fondo, nodos) {
    const altoDisponible = Math.max(80, nodos.tarjetas.clientHeight - 56);
    const modo = CATEGORIAS[fondo.categoria].foto === 'area' ? 'area' : 'alto';
    const ancho = nodos.tarjetas.clientWidth || 340;
    const maxPx = modo === 'area' ? Math.min(altoDisponible, Math.floor(ancho / 2) - 12) : altoDisponible;
    const contenedorEscala = crear(documento, 'div', 'mm-escala');
    contenedorEscala.setAttribute('data-test', 'mm-escala');
    const formato = (v) => valorConUnidad({ ...fondo, valor: v });
    nodos.tarjetas.replaceChildren(contenedorEscala);
    const escena = montarEscenaFotos(contenedorEscala, { ref: cima, misteriosa: fondo, modo, maxPx, formato, estimacion: false, documento }); // en Comparar nadie ha estimado nada
    escena.revelar(fondo.valor, { duracionMs: 600 });
    limpiarRonda = () => escena.destruir();
  }

  function siguienteComparar(acierto) {
    if (fase !== 'revelada') return;
    nuevaComparar(acierto ? ronda.fondo : null);
  }

  // --- AFINAR -------------------------------------------------------------------------------------------------

  function nuevaAfinar(cambiarVista = false) {
    vaciar();
    const par = elegirPar({ variante: 'afinar' });
    if (!par) {
      fase = 'destruido';
      deps.alSinParejas();
      return;
    }
    const [ref, mis] = par;
    const categoria = mis.categoria;
    const conFechas = esFecha(categoria);
    const esc = escalaBarra(ref, categoria);
    const pasos = conFechas ? Math.max(1, Math.round(esc.max - esc.min)) : PASOS_BARRA;
    ronda = { ref, mis, esc, pasos, categoria, estimado: ref.valor };

    const pregunta = (PREGUNTA_AFINAR[categoria] ?? ((n) => `¿Cuánto vale ${n}?`))(mis.nombre);
    const zona = crear(documento, 'div', 'mm-zona');
    zona.setAttribute('data-test', 'mm-zona');
    let escena = null;
    let linea = null;
    let foto = null;
    if (conFechas) {
      // Afinar con fechas: la foto del evento misterioso con la pregunta encima y la línea temporal en su banda.
      zona.classList.add('mm-zona--foto');
      const nodoFoto = crear(documento, 'div', 'mm-foto');
      zona.appendChild(nodoFoto);
      foto = montarFotoPregunta(nodoFoto, { enunciado: pregunta, imagen: mis.imagen, area: mis.area, documento });
      linea = montarLineaTemporal(nodoFoto.children[0] ?? nodoFoto, { ref, documento });
    } else {
      const texto = crear(documento, 'p', 'mm-enunciado', pregunta);
      texto.setAttribute('data-test', 'mm-enunciado');
      const referencia = crear(documento, 'p', 'mm-referencia', `${ref.nombre}: ${valorConUnidad(ref)}`);
      referencia.setAttribute('data-test', 'mm-referencia');
      const contenedorEscala = crear(documento, 'div', 'mm-escala');
      contenedorEscala.setAttribute('data-test', 'mm-escala');
      zona.append(texto, referencia, contenedorEscala);
      ronda.contenedorEscala = contenedorEscala;
    }

    const mando = crear(documento, 'div', 'mm-mando mm-mando--afinar');
    const lectura = crear(documento, 'p', 'mm-lectura');
    const valorEnVivo = crear(documento, 'span', 'mm-lectura-valor', valorConUnidad(ref));
    valorEnVivo.setAttribute('data-test', 'mm-estimacion');
    const etiquetaLectura = crear(documento, 'span', 'mm-lectura-etiqueta', 'Tu estimación');
    lectura.append(etiquetaLectura, valorEnVivo);
    const barra = crear(documento, 'input', 'mm-barra');
    barra.type = 'range';
    barra.min = '0';
    barra.max = String(pasos);
    barra.step = '1';
    barra.value = String(Math.round(posicionDesdeValor(esc, ref.valor) * pasos));
    barra.setAttribute('data-test', 'mm-barra');
    barra.setAttribute('aria-label', 'Tu estimación');
    const listo = crear(documento, 'button', 'boton boton-principal mm-listo', 'Listo');
    listo.setAttribute('type', 'button');
    listo.setAttribute('data-test', 'mm-listo');
    const fila = crear(documento, 'div', 'mm-barra-fila');
    fila.append(barra, listo);
    mando.append(lectura, fila);
    nodoCuerpo.append(zona, mando);
    ronda.nodos = { zona, mando, barra, listo, valorEnVivo };
    montarBarraComodines(mando);

    if (!conFechas) {
      // Hay que medir después de montar (y con la vista visible): el alto disponible es el de la zona de fotos.
      if (cambiarVista) deps.mostrarVista('masomenos');
      cambiarVista = false;
      const modo = CATEGORIAS[categoria].foto === 'area' ? 'area' : 'alto';
      const contenedorEscala = ronda.contenedorEscala;
      const alto = Math.max(60, (contenedorEscala.clientHeight || 160) - 40);
      const ancho = contenedorEscala.clientWidth || 340;
      const maxPx = modo === 'area' ? Math.min(alto, Math.floor(ancho / 2) - 12) : alto;
      escena = montarEscenaFotos(contenedorEscala, { ref, misteriosa: mis, modo, maxPx, formato: (v) => valorConUnidad({ ...mis, valor: v }), documento });
    }

    const estimar = () => {
      const t = Number(barra.value) / pasos;
      const valor = redondearEstimacion(valorDesdePosicion(esc, t), categoria);
      ronda.estimado = valor;
      valorEnVivo.textContent = conFechas ? formatearValor(valor, categoria) : valorConUnidad({ ...mis, valor });
      if (escena) escena.actualizar(valor);
      if (linea) linea.arrastrar(valor);
      deps.vigia?.reiniciar();
    };
    escuchar(barra, 'input', estimar);
    escuchar(listo, 'click', () => { if (libre()) resolverAfinar(escena, linea); });
    ronda.estimar = estimar;
    estimar();
    limpiarRonda = () => {
      if (escena) escena.destruir();
      if (linea) linea.destruir();
      if (foto) foto.destruir();
    };
    fase = 'afinar';
    armar();
    deps.vigia?.reiniciar();
    if (cambiarVista) deps.mostrarVista('masomenos');
  }

  function resolverAfinar(escena, linea) {
    if (fase !== 'afinar') return;
    fase = 'revelada';
    armar();
    const { mis, categoria, estimado, nodos } = ronda;
    const calif = calificar(mis.valor, estimado, categoria);
    const acierto = cuentaParaRacha(calif);
    nodos.barra.disabled = true;
    nodos.listo.hidden = true;
    if (escena) escena.revelar(mis.valor, { duracionMs: 700 });
    if (linea) linea.revelar(mis.valor);

    const zonaEfecto = nodos.zona;
    if (calif === 'clavado') deps.celebrarPremio('clavado'); // confeti + fanfarria + esfinge eufórica
    else if (acierto) deps.celebrarAcierto(zonaEfecto);
    else deps.lamentarFallo(zonaEfecto);
    const salvada = !acierto && Boolean(ronda.salvavidas);
    const premio = anotar(acierto);

    const panel = panelResultado(acierto ? 'mm-resultado--ok' : 'mm-resultado--ko');
    panel.setAttribute('data-calificacion', calif);
    const fila = filaResultado(`${TEXTO_CALIFICACION[calif]}${salvada ? ' · 🛟 racha salvada' : ''}`, acierto ? 'mm-resultado-titulo--ok' : 'mm-resultado-titulo--ko', () => nuevaAfinar());
    panel.appendChild(fila);
    // La cifra real se cuenta en el panel del resultado (la lectura de la barra desaparece al poner el panel).
    const real = crear(documento, 'p', 'mm-real');
    real.setAttribute('data-test', 'mm-real');
    const valorReal = crear(documento, 'span', 'mm-real-valor', valorConUnidad(mis));
    valorReal.setAttribute('data-test', 'mm-real-valor');
    real.append('Real: ', valorReal);
    panel.appendChild(real);
    const detalle = crear(documento, 'p', 'mm-diferencia', `Tu estimación: ${valorConUnidad({ ...mis, valor: estimado })}`);
    detalle.setAttribute('data-test', 'mm-diferencia');
    panel.appendChild(detalle);
    contar(valorReal, mis);
    if (premio) {
      const p = crear(documento, 'p', 'mm-premio', premio);
      p.setAttribute('data-test', 'mm-premio');
      panel.appendChild(p);
    }
    if (typeof mis.nota === 'string' && mis.nota) {
      const n = crear(documento, 'p', 'mm-nota', mis.nota);
      n.setAttribute('data-test', 'mm-nota');
      panel.appendChild(n);
    }
    panel.appendChild(huecoSaberMas(promptAfinar(mis, estimado)));
    nodos.mando.replaceChildren(panel);
  }

  // --- Interruptor y arranque -----------------------------------------------------------------------------------

  function cambiarVariante(nueva) {
    if (fase === 'destruido' || nueva === variante) return;
    variante = nueva;
    estado = { ...estado, variante };
    guardarMasomenos(estado, deps.almacen);
    pintarMarcador();
    if (variante === 'comparar') nuevaComparar();
    else nuevaAfinar();
  }

  escuchar(botonComparar, 'click', () => { if (libre()) cambiarVariante('comparar'); });
  escuchar(botonAfinar, 'click', () => { if (libre()) cambiarVariante('afinar'); });
  pintarMarcador();
  if (variante === 'afinar') nuevaAfinar(true);
  else nuevaComparar(null, true);

  const resumir = (c) => ({ id: c.id, nombre: c.nombre, categoria: c.categoria, valor: c.valor, unidad: c.unidad });

  return {
    destruir() {
      fase = 'destruido';
      for (const [n, tipo, fn] of oyentes) n.removeEventListener(tipo, fn);
      oyentes.length = 0;
      vaciar();
      deps.vigia?.parar();
    },
    /** Solo para los e2e (`?test=1`): la pareja en juego con sus valores reales. */
    parejaActual() {
      if (!ronda) return null;
      return variante === 'comparar'
        ? { variante, arriba: resumir(ronda.cima), abajo: resumir(ronda.fondo) }
        : { variante, arriba: resumir(ronda.ref), abajo: resumir(ronda.mis) };
    },
    /** Solo para los e2e: arranca una ronda nueva con esa pareja (Comparar: `idArriba` y `idAbajo`, la oculta; Afinar:
     * la referencia y la misteriosa). `false` si algún id no existe o no hay ronda en juego. */
    fijarParejaParaTest(idArriba, idAbajo) {
      const a = deps.cifras.find((c) => c.id === idArriba);
      const b = deps.cifras.find((c) => c.id === idAbajo);
      if (!a || !b || (fase !== 'comparar' && fase !== 'afinar' && fase !== 'revelada')) return false;
      parejaForzada = [a, b];
      if (variante === 'afinar') nuevaAfinar();
      else nuevaComparar();
      return true;
    },
    /** Solo para los e2e: responde Comparar bien o mal a propósito. */
    responderParaTest(correcta) {
      if (fase !== 'comparar' || !ronda) return false;
      const sube = ronda.fondo.valor > ronda.cima.valor;
      resolverComparar(correcta === sube ? 'mas' : 'menos');
      return true;
    },
    /** Solo para los e2e: coloca la barra para que la estimación sea `factor` × el valor real (fechas: `anos` de
     * diferencia con el año real) y devuelve la estimación. */
    estimarParaTest({ factor = 1, anos = 0, extremo = null } = {}) {
      if (fase !== 'afinar' || !ronda) return null;
      const objetivo = esFecha(ronda.categoria) ? ronda.mis.valor + anos : ronda.mis.valor * factor;
      // `extremo: 'lejos'`: la punta de la barra más alejada del valor real (el error más grande posible).
      const posicion = extremo === 'lejos' ? (posicionDesdeValor(ronda.esc, ronda.mis.valor) < 0.5 ? 1 : 0) : posicionDesdeValor(ronda.esc, objetivo);
      ronda.nodos.barra.value = String(Math.round(posicion * ronda.pasos));
      ronda.estimar();
      return ronda.estimado;
    },
  };
}
