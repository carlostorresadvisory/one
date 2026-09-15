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

function esTextoNoVacio(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function esTandaValida(datos) {
  if (!datos || typeof datos !== 'object') return false;
  if (!esTextoNoVacio(datos.id) || !esTextoNoVacio(datos.corto)) return false;
  return Number.isFinite(datos.inicio) && Number.isInteger(datos.pedidas) && datos.pedidas > 0;
}

/** Tanda guardada, o null si no hay ninguna. Una clave corrupta (JSON roto, campos ausentes) se
 * trata como "no hay tanda": nunca lanza, misma política que cargarEstado en app.js. */
export function leerTanda() {
  try {
    const crudo = localStorage.getItem(CLAVE_TANDA);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (!esTandaValida(datos)) return null;
    return { id: datos.id, corto: datos.corto, inicio: datos.inicio, pedidas: datos.pedidas };
  } catch {
    return null;
  }
}

/** Guarda la tanda en curso. `false` si los datos no valen o si localStorage no admite escritura
 * (llena, modo privado): la sesión sigue funcionando en memoria, igual que guardarEstado. */
export function guardarTanda({ id, corto, inicio, pedidas } = {}) {
  if (!esTandaValida({ id, corto, inicio, pedidas })) return false;
  try {
    localStorage.setItem(CLAVE_TANDA, JSON.stringify({ id, corto, inicio, pedidas }));
    return true;
  } catch {
    return false;
  }
}

/** Se llama en estado terminal (tras mostrar "Tanda lista" o el fallo) y en 404 (spec §1). */
export function borrarTanda() {
  try {
    localStorage.removeItem(CLAVE_TANDA);
  } catch {
    // Si ni borrar se puede, leerTanda la volverá a ver en la próxima apertura y el sondeo dará
    // 404 -> "La tanda se perdió, genera otra". No hay nada mejor que hacer aquí.
  }
}

/**
 * Segundos que faltan (spec §2): el `segundosPorPregunta` que manda el servidor (su media móvil
 * real de generación) x las que faltan. Si no viene, respaldo con el ritmo propio medido
 * ((ahora - inicio) / hechas) cuando ya hay alguna hecha, y con SEG_POR_PREGUNTA_DEFECTO cuando no
 * hay ni eso. `null` cuando los datos no dan para nada (nunca NaN: el indicador nunca debe pintar
 * "~NaN s").
 *
 * Ola final v0.2b4 (M8): antes el ritmo propio ganaba en cuanto había >= 1 hecha, y eso mide desde
 * que se PIDIÓ la tanda -- incluye el rato parado en cola, sin que nadie estuviera generando nada.
 * Con una cola por delante daba estimaciones disparatadas ("~16 min" para lo que el servidor sabía
 * que le quedaban 30 s). El dato del servidor es tiempo de generación de verdad: manda él.
 */
export function calcularRestanteSeg({ inicio, ahora, hechas, pedidas, segundosPorPregunta } = {}) {
  if (!Number.isFinite(inicio) || !Number.isFinite(ahora)) return null;
  if (!Number.isInteger(pedidas) || pedidas <= 0) return null;
  const hechasValidas = Number.isInteger(hechas) && hechas > 0 ? Math.min(hechas, pedidas) : 0;
  const faltan = pedidas - hechasValidas;
  if (faltan <= 0) return 0;
  if (Number.isFinite(segundosPorPregunta) && segundosPorPregunta > 0) {
    return Math.max(1, Math.round(segundosPorPregunta * faltan));
  }
  const transcurridoSeg = (ahora - inicio) / 1000;
  if (hechasValidas >= 1 && transcurridoSeg > 0) {
    return Math.max(1, Math.round((transcurridoSeg / hechasValidas) * faltan));
  }
  return Math.max(1, Math.round(SEG_POR_PREGUNTA_DEFECTO * faltan));
}

/** "~40 s" por debajo del minuto (decenas, de 10 a 50 — "~60 s" sería un minuto mal escrito) y
 * "~2 min" a partir de 60 s. Cadena vacía cuando no hay nada que decir (spec §2: redondeo). */
export function formatearRestante(seg) {
  if (!Number.isFinite(seg) || seg <= 0) return '';
  if (seg < 60) return `~${Math.min(50, Math.max(10, Math.round(seg / 10) * 10))} s`;
  return `~${Math.max(1, Math.round(seg / 60))} min`;
}
