// ONE · tienda-ui.js — pantalla Tienda (spec v0.3 §6): el fondo de Órdago es el dinero. Tres grupos que hacen scroll
// dentro de la lista (la página no se desplaza): «Comodines» (por objeto, su icono, nombre, rareza con etiqueta de color,
// qué hace, «Tienes N», «Comprar · precio» y «Vender · mitad»), «Cofre» (se abre al comprarlo y enseña sus probabilidades)
// y «Títulos» (se compran una vez, se equipan y no se venden). Solo lo épico, dorado (Salvavidas y el título Leyenda),
// lleva resplandor. Las cuentas viven en mochila.js; aquí solo se leen y se guardan el fondo y la mochila.
// Cada operación lee el estado guardado en el momento (nunca una copia vieja) y se cierra con un antirrebote: un doble
// toque en Comprar, Vender o Equipar es una sola operación.

import {
  OBJETOS, TITULOS, COFRE_TIENDA, PROBABILIDADES_COFRE, MAX_ESCUDOS,
  comprar, vender, comprarCofre, comprarTitulo, equiparTitulo, cargarMochila, guardarMochila,
} from './mochila.js';
import { cargarOrdagoResuelto, guardarOrdago, conFondo, formatearCifra } from './ordago.js';
import { MS_ANTIREBOTE } from './ordago-ui.js';

const ETIQUETA_RAREZA = { comun: 'Común', raro: 'Raro', epico: 'Épico' };
export const MS_AVISO = 2200;

function crear(documento, etiqueta, clase, texto) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** «+5 s 30 % · Saltar 25 % · …»: las probabilidades del cofre de la Tienda, escritas en su fila. */
export function textoProbabilidades() {
  return PROBABILIDADES_COFRE.tienda.map(([id, p]) => `${OBJETOS[id].nombre} ${Math.round(p * 100)} %`).join(' · ');
}

/**
 * Monta la Tienda en `contenedor` (la `<section data-vista="tienda">`). Dependencias: `pedirGesto(evento)` y opcionales
 * `almacen`, `documento`, `ahora`, `temporizador`, `rng` (el del cofre). Devuelve `{ actualizar(), destruir() }`.
 */
export function montarTienda(contenedor, deps) {
  const documento = deps.documento ?? contenedor.ownerDocument ?? globalThis.document;
  const nodo = (id) => contenedor.querySelector(`[data-test="${id}"]`);
  const nodoFondo = nodo('tienda-fondo');
  const nodoAviso = nodo('tienda-aviso');
  const nodoEquipado = nodo('tienda-titulo-equipado');
  const lista = nodo('tienda-mochila');
  const ahora = deps.ahora ?? (() => performance.now());
  const temporizador = deps.temporizador ?? globalThis;
  let desbloqueoEn = 0;
  let avisoId = null;
  let vivo = true;
  const filas = {}; // id de objeto -> { cantidad, comprar, vender }
  let filaCofre = null; // { comprar }
  const filasTitulo = {}; // id de título -> botón

  /** Fila con su cabecera (icono, nombre, etiqueta de rareza) y, si hay, su texto de ayuda. */
  function crearFila(id, { icono, nombre, rareza, descripcion }, simple = false) {
    const fila = crear(documento, 'li', `tienda-objeto${simple ? ' tienda-objeto--simple' : ''}`);
    fila.setAttribute('data-test', `tienda-objeto-${id}`);
    const cabecera = crear(documento, 'div', 'tienda-objeto-cabecera');
    const nodoIcono = crear(documento, 'span', 'tienda-objeto-icono', icono);
    nodoIcono.setAttribute('aria-hidden', 'true');
    const etiqueta = crear(documento, 'span', `cofre-etiqueta cofre-etiqueta--${rareza}`, ETIQUETA_RAREZA[rareza]);
    etiqueta.setAttribute('data-test', `tienda-rareza-${id}`);
    cabecera.append(nodoIcono, crear(documento, 'span', 'tienda-objeto-nombre', nombre), etiqueta);
    fila.appendChild(cabecera);
    if (descripcion) fila.appendChild(crear(documento, 'p', 'tienda-objeto-desc', descripcion));
    return { fila, cabecera };
  }

  function crearBoton(dataTest, texto, etiquetaAria, alPulsar) {
    const boton = crear(documento, 'button', 'boton tienda-boton', texto);
    boton.setAttribute('type', 'button');
    boton.setAttribute('aria-label', etiquetaAria);
    boton.setAttribute('data-test', dataTest);
    boton.addEventListener('click', alPulsar);
    return boton;
  }

  function construirFilaObjeto(objeto) {
    const { fila, cabecera } = crearFila(objeto.id, objeto);
    const cantidad = crear(documento, 'span', 'tienda-objeto-cantidad');
    cantidad.setAttribute('data-test', `tienda-cantidad-${objeto.id}`);
    cabecera.appendChild(cantidad);
    const mitad = formatearCifra(Math.floor(objeto.precio / 2));
    const acciones = crear(documento, 'div', 'tienda-objeto-acciones');
    const botonComprar = crearBoton(`tienda-comprar-${objeto.id}`, `Comprar · ${formatearCifra(objeto.precio)}`,
      `Comprar ${objeto.nombre} por ${formatearCifra(objeto.precio)}`, () => comprarObjeto(objeto));
    const botonVender = crearBoton(`tienda-vender-${objeto.id}`, `Vender · ${mitad}`,
      `Vender ${objeto.nombre} por ${mitad}`, () => venderObjeto(objeto));
    acciones.append(botonComprar, botonVender);
    fila.appendChild(acciones);
    filas[objeto.id] = { cantidad, comprar: botonComprar, vender: botonVender };
    return fila;
  }

  function construirFilaCofre() {
    const { fila } = crearFila(COFRE_TIENDA.id, { ...COFRE_TIENDA, descripcion: undefined }, true);
    const precio = formatearCifra(COFRE_TIENDA.precio);
    const botonComprar = crearBoton('tienda-comprar-cofre', `Comprar · ${precio}`, `Abrir un cofre por ${precio}`, abrirCofre);
    const acciones = crear(documento, 'div', 'tienda-objeto-acciones tienda-objeto-acciones--una');
    acciones.appendChild(botonComprar);
    const probabilidades = crear(documento, 'p', 'tienda-objeto-desc tienda-cofre-probabilidades', `Se abre al comprarlo: ${textoProbabilidades()}`);
    probabilidades.setAttribute('data-test', 'tienda-cofre-probabilidades');
    fila.append(acciones, probabilidades);
    filaCofre = { comprar: botonComprar };
    return fila;
  }

  function construirFilaTitulo(titulo) {
    const { fila } = crearFila(titulo.id, titulo, true);
    fila.classList.add('tienda-objeto--titulo');
    const acciones = crear(documento, 'div', 'tienda-objeto-acciones tienda-objeto-acciones--una');
    const boton = crearBoton(`tienda-titulo-${titulo.id}`, '', '', () => pulsarTitulo(titulo));
    acciones.appendChild(boton);
    fila.appendChild(acciones);
    filasTitulo[titulo.id] = boton;
    return fila;
  }

  function construirGrupo(id, titulo, filasGrupo) {
    const grupo = crear(documento, 'section', 'tienda-grupo');
    grupo.setAttribute('data-test', `tienda-grupo-${id}`);
    const cabecera = crear(documento, 'h3', 'tienda-grupo-titulo', titulo);
    const ul = crear(documento, 'ul', 'tienda-grupo-lista');
    ul.append(...filasGrupo);
    grupo.append(cabecera, ul);
    return grupo;
  }

  function avisar(texto) {
    nodoAviso.textContent = texto;
    if (avisoId !== null) temporizador.clearTimeout(avisoId);
    avisoId = temporizador.setTimeout(() => { avisoId = null; if (vivo) nodoAviso.textContent = ''; }, MS_AVISO);
  }

  /** Repinta el fondo, las cantidades, los títulos y qué botones se pueden pulsar, leyendo lo guardado. */
  function actualizar() {
    if (!vivo) return;
    const { fondo } = cargarOrdagoResuelto(deps.almacen);
    const mochila = cargarMochila(deps.almacen);
    nodoFondo.textContent = formatearCifra(fondo);
    for (const objeto of Object.values(OBJETOS)) {
      const fila = filas[objeto.id];
      const tienes = mochila.objetos[objeto.id];
      const alTope = objeto.id === 'escudo' && tienes >= MAX_ESCUDOS;
      fila.cantidad.textContent = `Tienes ${tienes}`;
      fila.comprar.disabled = fondo < objeto.precio || alTope;
      fila.vender.disabled = tienes < 1;
    }
    filaCofre.comprar.disabled = fondo < COFRE_TIENDA.precio;
    for (const titulo of TITULOS) {
      const boton = filasTitulo[titulo.id];
      const loTienes = mochila.titulos.includes(titulo.id);
      const equipado = mochila.titulo === titulo.id;
      const precio = formatearCifra(titulo.precio);
      boton.textContent = equipado ? 'Equipado' : loTienes ? 'Equipar' : `Comprar · ${precio}`;
      boton.setAttribute('aria-label', equipado ? `Título ${titulo.nombre} equipado` : loTienes ? `Equipar el título ${titulo.nombre}` : `Comprar el título ${titulo.nombre} por ${precio}`);
      boton.setAttribute('aria-pressed', String(equipado));
      boton.disabled = equipado || (!loTienes && fondo < titulo.precio);
    }
    const actual = TITULOS.find((t) => t.id === mochila.titulo);
    if (nodoEquipado) {
      nodoEquipado.hidden = !actual;
      nodoEquipado.textContent = actual ? `${actual.icono} ${actual.nombre}` : '';
      nodoEquipado.classList.toggle('titulo-equipado--leyenda', actual?.rareza === 'epico');
    }
  }

  /**
   * Una operación contra lo guardado: `hacer(mochila, fondo)` devuelve el resultado de mochila.js y `mensaje(resultado, delta)` el
   * aviso. Mochila y fondo se escriben juntos; si solo llega una de las dos se deshacen ambas.
   */
  function operar(hacer, mensaje, gesto) {
    if (!vivo || ahora() < desbloqueoEn) return;
    const estado = cargarOrdagoResuelto(deps.almacen);
    const mochila = cargarMochila(deps.almacen);
    const resultado = hacer(mochila, estado.fondo);
    if (!resultado.ok) {
      if (resultado.motivo === 'tope') avisar(`Ya tienes ${MAX_ESCUDOS} escudos: es el máximo`);
      return;
    }
    desbloqueoEn = ahora() + MS_ANTIREBOTE;
    const mochilaGuardada = guardarMochila(resultado.mochila, deps.almacen);
    if (resultado.fondo === undefined || resultado.fondo === estado.fondo) {
      // Equipar un título solo toca la mochila: nada que deshacer en el fondo.
    } else {
      const fondoGuardado = guardarOrdago(conFondo(estado, resultado.fondo), deps.almacen);
      if (mochilaGuardada !== fondoGuardado) {
        // Una escritura llegó y la otra no: se deshacen las dos para no pagar sin objeto ni cobrar sin vender.
        guardarMochila(mochila, deps.almacen);
        guardarOrdago(estado, deps.almacen);
        avisar('No se pudo guardar. No se ha hecho la operación.');
        actualizar();
        return;
      }
    }
    avisar(mensaje(resultado, Math.abs((resultado.fondo ?? estado.fondo) - estado.fondo)));
    actualizar();
    if (gesto) deps.pedirGesto(gesto);
  }

  const comprarObjeto = (objeto) => operar(
    (m, fondo) => comprar(m, fondo, objeto.id),
    (r, delta) => `${objeto.icono} ${objeto.nombre} comprado · −${formatearCifra(delta)}`,
    'acierto',
  );
  const venderObjeto = (objeto) => operar(
    (m, fondo) => vender(m, fondo, objeto.id),
    (r, delta) => `${objeto.icono} ${objeto.nombre} vendido · +${formatearCifra(delta)}`,
  );
  const abrirCofre = () => operar(
    (m, fondo) => comprarCofre(m, fondo, deps.rng),
    (r, delta) => `${COFRE_TIENDA.icono} Cofre abierto: ${OBJETOS[r.objeto].icono} ${OBJETOS[r.objeto].nombre} · −${formatearCifra(delta)}`,
    'acierto',
  );
  function pulsarTitulo(titulo) {
    if (cargarMochila(deps.almacen).titulos.includes(titulo.id)) {
      operar((m) => equiparTitulo(m, titulo.id), () => `${titulo.icono} Título «${titulo.nombre}» equipado`);
    } else {
      operar(
        (m, fondo) => comprarTitulo(m, fondo, titulo.id),
        (r, delta) => `${titulo.icono} Título «${titulo.nombre}» comprado · −${formatearCifra(delta)}`,
        'acierto',
      );
    }
  }

  lista.replaceChildren(
    construirGrupo('comodines', 'Comodines', Object.values(OBJETOS).map(construirFilaObjeto)),
    construirGrupo('cofre', 'Cofre', [construirFilaCofre()]),
    construirGrupo('titulos', 'Títulos', TITULOS.map(construirFilaTitulo)),
  );
  actualizar();

  return {
    actualizar,
    destruir() {
      vivo = false;
      if (avisoId !== null) temporizador.clearTimeout(avisoId);
      avisoId = null;
      lista.replaceChildren();
    },
  };
}
