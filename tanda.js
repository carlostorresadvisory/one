// ONE · tanda.js — estado de la tanda de generación en curso (spec v0.2b4 §1 y §2). Mismo criterio
// de extracción que mazo.js/atomo.js: lo que se puede probar sin DOM ni red vive aquí, con sus
// propios tests (tests/tanda.test.js); el indicador (DOM) se queda en app.js.
//
// Por qué existe: `atomoTrabajoId` vivía SOLO en memoria (app.js:179). iOS recarga la PWA al
// cambiar de app o bloquear el móvil, así que la app olvidaba la tanda, dejaba de sondear y el
// aviso "Tanda lista" no llegaba nunca (diagnóstico de la spec §0, visto por Carlos el 15-sep 09:52).

export const CLAVE_TANDA = 'one.atomoTrabajo';

// Estimación mientras el servidor no ha hecho ni una pregunta de esta tanda y todavía no ha
// mandado su propio `segundosPorPregunta` (Tarea 3): misma cifra de arranque que usa el servidor.
export const SEG_POR_PREGUNTA_DEFECTO = 20;

/**
 * Segundos que faltan (spec §2): con >= 1 pregunta hecha, el ritmo REAL medido
 * ((ahora - inicio) / hechas) x las que faltan; con 0 hechas, la estimación del servidor
 * (`segundosPorPregunta`, o SEG_POR_PREGUNTA_DEFECTO). `null` cuando los datos no dan para nada
 * (nunca NaN: el indicador nunca debe pintar "~NaN s").
 */
export function calcularRestanteSeg({ inicio, ahora, hechas, pedidas, segundosPorPregunta } = {}) {
  if (!Number.isFinite(inicio) || !Number.isFinite(ahora)) return null;
  if (!Number.isInteger(pedidas) || pedidas <= 0) return null;
  const hechasValidas = Number.isInteger(hechas) && hechas > 0 ? Math.min(hechas, pedidas) : 0;
  const faltan = pedidas - hechasValidas;
  if (faltan <= 0) return 0;
  const transcurridoSeg = (ahora - inicio) / 1000;
  if (hechasValidas >= 1 && transcurridoSeg > 0) {
    return Math.max(1, Math.round((transcurridoSeg / hechasValidas) * faltan));
  }
  const porPregunta =
    Number.isFinite(segundosPorPregunta) && segundosPorPregunta > 0
      ? segundosPorPregunta
      : SEG_POR_PREGUNTA_DEFECTO;
  return Math.max(1, Math.round(porPregunta * faltan));
}

/** "~40 s" por debajo del minuto (decenas, de 10 a 50 — "~60 s" sería un minuto mal escrito) y
 * "~2 min" a partir de 60 s. Cadena vacía cuando no hay nada que decir (spec §2: redondeo). */
export function formatearRestante(seg) {
  if (!Number.isFinite(seg) || seg <= 0) return '';
  if (seg < 60) return `~${Math.min(50, Math.max(10, Math.round(seg / 10) * 10))} s`;
  return `~${Math.max(1, Math.round(seg / 60))} min`;
}
