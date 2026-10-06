// ONE · respaldo.js — Exportar/Importar de v0.3 (spec §9). El respaldo v3 envuelve el estado del
// motor (el JSON v2 de siempre, sin tocar motor.js) y añade `modos`: las claves de localStorage de
// v0.3 en una LISTA BLANCA (cada fase que añade una clave la suma aquí). Importar acepta también el
// formato antiguo (v1/v2, sin modos) tal cual lo exportaba la app hasta v0.2.

import { exportar, importar } from './motor.js';

export const VERSION_RESPALDO = 3;
export const CLAVES_RESPALDO = Object.freeze(['one.mochila', 'one.ultimoModo', 'one.filtros', 'one.silencio', 'one.indiceRutas']);
const MAX_LONGITUD_VALOR = 500000;

export function exportarRespaldo(estado, almacen) {
  const modos = {};
  for (const clave of CLAVES_RESPALDO) {
    try {
      const valor = (almacen ?? globalThis.localStorage).getItem(clave);
      if (typeof valor === 'string') modos[clave] = valor;
    } catch {
      // Almacén no disponible: se exporta el estado sin modos.
    }
  }
  return JSON.stringify({ version: VERSION_RESPALDO, estado: JSON.parse(exportar(estado)), modos });
}

export function importarRespaldo(json) {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('JSON inválido');
  }
  if (obj && obj.version === VERSION_RESPALDO) {
    if (!obj.estado || typeof obj.estado !== 'object') throw new Error('Falta el estado en el respaldo');
    const estado = importar(JSON.stringify(obj.estado));
    const modos = {};
    if (obj.modos && typeof obj.modos === 'object' && !Array.isArray(obj.modos)) {
      for (const clave of CLAVES_RESPALDO) {
        const valor = obj.modos[clave];
        if (typeof valor === 'string' && valor.length <= MAX_LONGITUD_VALOR) modos[clave] = valor;
      }
    }
    return { estado, modos };
  }
  return { estado: importar(json), modos: {} };
}

export function aplicarModos(modos, almacen) {
  let escritas = 0;
  for (const [clave, valor] of Object.entries(modos || {})) {
    if (!CLAVES_RESPALDO.includes(clave) || typeof valor !== 'string') continue;
    try {
      (almacen ?? globalThis.localStorage).setItem(clave, valor);
      escritas += 1;
    } catch {
      // Sin almacén: lo que no se pueda escribir se queda con su valor por defecto.
    }
  }
  return escritas;
}
