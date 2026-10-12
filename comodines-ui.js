// ONE · comodines-ui.js — barra de comodines bajo la tarjeta (spec v0.3 §4 y §6). Pinta los comodines aplicables
// al modo (los que tienes) con su cantidad; tocar = usar, antes de responder y solo para esa pregunta. No decide
// el efecto: cada modo lo aplica en `alUsar(id)` y descuenta de la mochila con `gastarComodin` SOLO cuando surte
// efecto (el 50/50, el +5 s y Saltar, al tocarlos; el Salvavidas y la Segunda oportunidad, cuando de verdad perdonan
// un fallo). Botones planos, sin resplandor; con la mochila vacía la barra no ocupa sitio. Un doble toque es un solo
// uso: el id entra en `usados` de forma síncrona antes de llamar al modo. Con 4 o 5 botones se quedan en icono y
// cantidad (clase `comodines--compacta`) para no ocupar dos filas.

import { OBJETOS, cargarMochila, guardarMochila, usar, puedeUsar, normalizarMochila } from './mochila.js';

const ORDEN = ['cincuenta', 'segunda', 'saltar', 'mas5', 'salvavidas'];
const SOLO_TEST4 = ['cincuenta', 'segunda'];
const COMPACTA_DESDE = 4;

/** Dos opciones incorrectas de un test4, como índices originales (el 50/50 deja la correcta y otra). */
export function descartesCincuenta(pregunta, rng = Math.random) {
  if (!pregunta || pregunta.tipo !== 'test4' || !Array.isArray(pregunta.opciones)) return [];
  const malas = pregunta.opciones.map((_, i) => i).filter((i) => i !== pregunta.correcta);
  for (let i = malas.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [malas[i], malas[j]] = [malas[j], malas[i]];
  }
  return malas.slice(0, 2);
}

/** Descuenta uno de la mochila guardada (con el almacén bloqueado vive en memoria, mochila.js). */
export function gastarComodin(id, almacen) {
  guardarMochila(usar(cargarMochila(almacen), id), almacen);
}

/**
 * Monta la barra en `nodo`. `mochila` es la mochila o una función que la devuelve (se relee en cada `actualizar`).
 * `alUsar(id)` lo llama la barra una vez por comodín y pregunta y devuelve `false` si no surtió efecto (entonces el comodín no se marca como usado).
 * Devuelve `{ actualizar({ tipoPregunta, usadosEnPregunta, filtro }), visible(si), aviso(texto), destruir() }`; `filtro(id)`
 * (opcional, persiste hasta el siguiente `actualizar` que lo traiga) deja fuera los comodines que no valen en ese momento
 * (p. ej. Órdago: Saltar solo antes de elegir ficha).
 */
export function montarComodines(nodo, { modo, mochila, tipoPregunta, alUsar, documento }) {
  const doc = documento ?? nodo.ownerDocument ?? globalThis.document;
  const leer = () => normalizarMochila(typeof mochila === 'function' ? mochila() : mochila);
  let tipo = tipoPregunta;
  let usados = [];
  let filtro = () => true;
  let vivo = true;
  let visible = true;
  nodo.classList.add('comodines');
  nodo.setAttribute('role', 'group');
  nodo.setAttribute('aria-label', 'Comodines');

  function pintar() {
    if (!vivo) return;
    const m = leer();
    const botones = ORDEN.filter((id) => OBJETOS[id].modos.includes(modo) && filtro(id)
      && (!SOLO_TEST4.includes(id) || tipo === 'test4')
      && (m.objetos[id] > 0 || usados.includes(id))).map((id) => {
      const objeto = OBJETOS[id];
      const boton = doc.createElement('button');
      boton.type = 'button';
      boton.className = 'comodin';
      boton.setAttribute('data-test', `comodin-${id}`);
      boton.setAttribute('aria-label', `${objeto.nombre}, tienes ${m.objetos[id]}`);
      boton.setAttribute('aria-pressed', String(usados.includes(id)));
      boton.disabled = !puedeUsar(m, id, { modo, tipoPregunta: tipo, usadosEnPregunta: usados });
      const icono = doc.createElement('span');
      icono.className = 'comodin-icono';
      icono.setAttribute('aria-hidden', 'true');
      icono.textContent = objeto.icono;
      const nombre = doc.createElement('span');
      nombre.className = 'comodin-nombre';
      nombre.textContent = objeto.nombre;
      const cantidad = doc.createElement('span');
      cantidad.className = 'comodin-cantidad';
      cantidad.setAttribute('data-test', `comodin-cantidad-${id}`);
      cantidad.textContent = `×${m.objetos[id]}`;
      boton.append(icono, nombre, cantidad);
      boton.addEventListener('click', () => usarComodin(id));
      return boton;
    });
    const hijoAviso = nodo.querySelector('.comodines-aviso');
    nodo.classList.toggle('comodines--compacta', botones.length >= COMPACTA_DESDE);
    nodo.replaceChildren(...botones, ...(hijoAviso ? [hijoAviso] : []));
    nodo.hidden = !visible || (botones.length === 0 && !hijoAviso);
  }

  function usarComodin(id) {
    if (!vivo || !puedeUsar(leer(), id, { modo, tipoPregunta: tipo, usadosEnPregunta: usados })) return;
    usados = [...usados, id]; // síncrono: el segundo toque de un doble toque ya no pasa
    if (alUsar(id) === false) usados = usados.filter((u) => u !== id); // el modo no pudo aplicarlo: no se marca ni se descuenta
    pintar();
  }

  pintar();
  return {
    actualizar(nuevo = {}) {
      if (nuevo.tipoPregunta !== undefined || 'tipoPregunta' in nuevo) tipo = nuevo.tipoPregunta;
      if ('filtro' in nuevo) filtro = nuevo.filtro ?? (() => true);
      if (Array.isArray(nuevo.usadosEnPregunta)) {
        usados = [...nuevo.usadosEnPregunta];
        nodo.querySelector('.comodines-aviso')?.remove();
      }
      pintar();
    },
    /** Oculta o vuelve a mostrar la barra entera (p. ej. mientras se enseña el resultado). */
    visible(si) {
      visible = Boolean(si);
      pintar();
    },
    /** Una línea de texto en la barra (p. ej. «Salvavidas: no cuenta como fallo»); se borra al cambiar de pregunta. */
    aviso(texto) {
      nodo.querySelector('.comodines-aviso')?.remove();
      const p = doc.createElement('span');
      p.className = 'comodines-aviso';
      p.setAttribute('data-test', 'comodines-aviso');
      p.textContent = texto;
      nodo.appendChild(p);
      pintar();
    },
    destruir() {
      vivo = false;
      nodo.replaceChildren();
      nodo.hidden = true;
      nodo.classList.remove('comodines');
    },
  };
}
