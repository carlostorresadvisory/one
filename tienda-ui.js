// ONE · tienda-ui.js — pantalla Tienda (spec v0.3 §6): el fondo de Órdago es el dinero; por objeto, su icono, nombre,
// rareza con etiqueta de color (solo el épico, dorado, lleva resplandor), «Tienes N», «Comprar · precio» y «Vender ·
// mitad». Las cuentas viven en mochila.js (`comprar`, `vender`); aquí solo se leen y se guardan el fondo y la mochila.
// Cada operación lee el estado guardado en el momento (nunca una copia vieja) y se cierra con un antirrebote: un doble
// toque en Comprar o Vender es una sola operación.

import { OBJETOS, comprar, vender, cargarMochila, guardarMochila } from './mochila.js';
import { cargarOrdago, guardarOrdago, conFondo, formatearCifra } from './ordago.js';
import { MS_ANTIREBOTE } from './ordago-ui.js';

const ETIQUETA_RAREZA = { comun: 'Común', raro: 'Raro', epico: 'Épico' };
export const MS_AVISO = 2200;

function crear(documento, etiqueta, clase, texto) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/**
 * Monta la Tienda en `contenedor` (la `<section data-vista="tienda">`). Dependencias: `pedirGesto(evento)` y opcionales
 * `almacen`, `documento`, `ahora`, `temporizador`. Devuelve `{ actualizar(), destruir() }`.
 */
export function montarTienda(contenedor, deps) {
  const documento = deps.documento ?? contenedor.ownerDocument ?? globalThis.document;
  const nodo = (id) => contenedor.querySelector(`[data-test="${id}"]`);
  const nodoFondo = nodo('tienda-fondo');
  const nodoAviso = nodo('tienda-aviso');
  const lista = nodo('tienda-mochila');
  const ahora = deps.ahora ?? (() => performance.now());
  const temporizador = deps.temporizador ?? globalThis;
  let desbloqueoEn = 0;
  let avisoId = null;
  let vivo = true;
  const filas = {}; // id -> { cantidad, comprar, vender }

  function construirFila(objeto) {
    const fila = crear(documento, 'li', 'tienda-objeto');
    fila.setAttribute('data-test', `tienda-objeto-${objeto.id}`);
    const cabecera = crear(documento, 'div', 'tienda-objeto-cabecera');
    const icono = crear(documento, 'span', 'tienda-objeto-icono', objeto.icono);
    icono.setAttribute('aria-hidden', 'true');
    const nombre = crear(documento, 'span', 'tienda-objeto-nombre', objeto.nombre);
    const rareza = crear(documento, 'span', `cofre-etiqueta cofre-etiqueta--${objeto.rareza}`, ETIQUETA_RAREZA[objeto.rareza]);
    rareza.setAttribute('data-test', `tienda-rareza-${objeto.id}`);
    const cantidad = crear(documento, 'span', 'tienda-objeto-cantidad');
    cantidad.setAttribute('data-test', `tienda-cantidad-${objeto.id}`);
    cabecera.append(icono, nombre, rareza, cantidad);
    const acciones = crear(documento, 'div', 'tienda-objeto-acciones');
    const botonComprar = crear(documento, 'button', 'boton tienda-boton', `Comprar · ${formatearCifra(objeto.precio)}`);
    botonComprar.setAttribute('type', 'button');
    botonComprar.setAttribute('data-test', `tienda-comprar-${objeto.id}`);
    botonComprar.addEventListener('click', () => operar('comprar', objeto));
    const botonVender = crear(documento, 'button', 'boton tienda-boton', `Vender · ${formatearCifra(Math.floor(objeto.precio / 2))}`);
    botonVender.setAttribute('type', 'button');
    botonVender.setAttribute('data-test', `tienda-vender-${objeto.id}`);
    botonVender.addEventListener('click', () => operar('vender', objeto));
    acciones.append(botonComprar, botonVender);
    fila.append(cabecera, acciones);
    filas[objeto.id] = { cantidad, comprar: botonComprar, vender: botonVender };
    return fila;
  }

  function avisar(texto) {
    nodoAviso.textContent = texto;
    if (avisoId !== null) temporizador.clearTimeout(avisoId);
    avisoId = temporizador.setTimeout(() => { avisoId = null; if (vivo) nodoAviso.textContent = ''; }, MS_AVISO);
  }

  /** Repinta el fondo, las cantidades y qué botones se pueden pulsar, leyendo lo guardado. */
  function actualizar() {
    if (!vivo) return;
    const { fondo } = cargarOrdago(deps.almacen);
    const mochila = cargarMochila(deps.almacen);
    nodoFondo.textContent = formatearCifra(fondo);
    for (const objeto of Object.values(OBJETOS)) {
      const fila = filas[objeto.id];
      const tienes = mochila.objetos[objeto.id];
      fila.cantidad.textContent = `Tienes ${tienes}`;
      fila.comprar.disabled = fondo < objeto.precio;
      fila.vender.disabled = tienes < 1;
    }
  }

  function operar(que, objeto) {
    if (!vivo || ahora() < desbloqueoEn) return;
    const estado = cargarOrdago(deps.almacen);
    const mochila = cargarMochila(deps.almacen);
    const resultado = que === 'comprar' ? comprar(mochila, estado.fondo, objeto.id) : vender(mochila, estado.fondo, objeto.id);
    if (!resultado.ok) return;
    desbloqueoEn = ahora() + MS_ANTIREBOTE;
    guardarMochila(resultado.mochila, deps.almacen);
    guardarOrdago(conFondo(estado, resultado.fondo), deps.almacen);
    const delta = Math.abs(resultado.fondo - estado.fondo);
    avisar(que === 'comprar'
      ? `${objeto.icono} ${objeto.nombre} comprado · −${formatearCifra(delta)}`
      : `${objeto.icono} ${objeto.nombre} vendido · +${formatearCifra(delta)}`);
    actualizar();
    if (que === 'comprar') deps.pedirGesto('acierto');
  }

  lista.replaceChildren(...Object.values(OBJETOS).map(construirFila));
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
