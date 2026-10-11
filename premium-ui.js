// ONE · premium-ui.js — pantalla «Esfinx Premium» (spec v0.3.1 §7). Plan de prueba: activar no cobra nada.
// El HTML es estático (index.html, vista `premium`); aquí solo se alterna entre «Activar» y «Activo desde…» y se
// guardan el plan y los 1.000 puntos de bienvenida (premium.js#activarYGuardar, atómico y una sola vez en la vida).
// Un antirrebote cierra el doble toque en Activar y Desactivar.

import { activarYGuardar, desactivarYGuardar, cargarPremium, PUNTOS_BIENVENIDA } from './premium.js';
import { formatearCifra } from './ordago.js';

export const MS_ANTIREBOTE_PREMIUM = 400;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-11' → '11 oct 2026'. */
export function fechaCorta(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia));
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? ''} ${m[1]}` : '';
}

/**
 * Monta la pantalla en `contenedor` (la `<section data-vista="premium">`). Dependencias: `hoy()` (día local
 * 'AAAA-MM-DD'), `pedirGesto(evento)`, `alCambiar()` (repinta la cabecera y el hub) y opcionales `almacen`, `ahora`,
 * `motivo` (texto que explica por qué se abrió, p. ej. cupo gratis agotado). Devuelve `{ actualizar, destruir }`.
 */
export function montarPremium(contenedor, deps) {
  const nodo = (id) => contenedor.querySelector(`[data-test="${id}"]`);
  const nodoEstado = nodo('premium-estado');
  const nodoMotivo = nodo('premium-motivo');
  const nodoAviso = nodo('premium-aviso');
  const botonActivar = nodo('premium-activar');
  const botonDesactivar = nodo('premium-desactivar');
  const bloquePrecios = nodo('premium-precios');
  const ahora = deps.ahora ?? (() => performance.now());
  let desbloqueoEn = 0;
  let vivo = true;

  function actualizar() {
    if (!vivo) return;
    const premium = cargarPremium(deps.almacen);
    contenedor.classList.toggle('vista-premium--activo', premium.activo);
    botonActivar.hidden = premium.activo;
    bloquePrecios.hidden = premium.activo;
    botonDesactivar.hidden = !premium.activo;
    nodoEstado.hidden = !premium.activo;
    nodoEstado.textContent = premium.activo ? `Activo desde ${fechaCorta(premium.desde)}` : '';
    nodoMotivo.hidden = premium.activo || !deps.motivo;
    nodoMotivo.textContent = deps.motivo ?? '';
  }

  function operar(accion) {
    if (!vivo || ahora() < desbloqueoEn) return;
    desbloqueoEn = ahora() + MS_ANTIREBOTE_PREMIUM;
    if (accion === 'activar') {
      const { ok, puntos } = activarYGuardar(deps.hoy(), deps.almacen);
      if (!ok) {
        nodoAviso.textContent = 'No se pudo guardar. No se ha activado nada.';
      } else {
        nodoAviso.textContent = puntos > 0 ? `+${formatearCifra(PUNTOS_BIENVENIDA)} puntos para la Tienda` : '';
        deps.pedirGesto('record'); // euforia de la esfinge
      }
    } else {
      nodoAviso.textContent = desactivarYGuardar(deps.almacen) ? '' : 'No se pudo guardar.';
    }
    actualizar();
    deps.alCambiar?.();
  }

  const alActivar = () => operar('activar');
  const alDesactivar = () => operar('desactivar');
  botonActivar.addEventListener('click', alActivar);
  botonDesactivar.addEventListener('click', alDesactivar);
  nodoAviso.textContent = '';
  actualizar();

  return {
    actualizar,
    destruir() {
      vivo = false;
      botonActivar.removeEventListener('click', alActivar);
      botonDesactivar.removeEventListener('click', alDesactivar);
    },
  };
}
