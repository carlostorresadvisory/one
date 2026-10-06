// ONE · filtro.js — el filtro común de v0.3 (spec §4): chip "TODOS"/"Historia · Roma" en la cabecera
// de cada modo, hoja con el árbol de átomos y "Generar preguntas". Se recuerda POR MODO.
//
// Decisión del plan v0.3 fases 1-2: el servidor no manda la ruta de cada pregunta (solo
// `area`), y en estas fases no se toca el VPS. Así que el cliente lleva su propio índice
// `one.indiceRutas` (clave = JSON [area, ruta] → ids) que app.js alimenta cada vez que llega una
// tanda generada para un nodo del árbol. Filtrar por un área = `pregunta.area`; por un subtema = los
// ids de ese nodo y de todos sus subnodos. Un subtema nunca generado tiene 0 preguntas -> aviso de
// "pocos elementos" con "Generar preguntas" (spec §4, §11).
// Escrituras del índice: `registrarIdsRuta` relee y escribe sin ningún `await` de por medio, así que
// dentro de una pestaña dos tandas que terminan seguidas nunca se pisan (test). Entre DOS pestañas
// abiertas a la vez podría perderse un registro; el efecto es solo que ese subtema vuelve a pedir
// "Generar" -- aceptado, no merece un bloqueo entre pestañas. Ids del índice que ya no están en el
// banco (reportadas, banco renovado) se ignoran al filtrar: el predicado cruza siempre con `banco`.
//
// Almacenamiento: `almacen ?? globalThis.localStorage` se resuelve SIEMPRE dentro de un try (con el
// almacenamiento bloqueado el getter de `localStorage` lanza SecurityError): nada de aquí lanza.

import { AREAS } from './motor.js';

export const FILTRO_TODOS = Object.freeze({ area: null, ruta: Object.freeze([]), etiquetas: Object.freeze([]) });
export const MIN_JUGABLES = 5;
export const MAX_PARTIDA_FILTRO = 10;
export const CLAVE_FILTROS = 'one.filtros';
export const CLAVE_INDICE_RUTAS = 'one.indiceRutas';
const MAX_ANILLOS = 6;
const MAX_IDS_POR_RUTA = 500;
const MAX_RUTAS = 200;

const esTexto = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 300;
const esObjetoPlano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function leerJson(almacen, clave) {
  try {
    const crudo = (almacen ?? globalThis.localStorage).getItem(clave);
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}

export function normalizarFiltro(f) {
  if (!esObjetoPlano(f) || !AREAS.includes(f.area)) return { area: null, ruta: [], etiquetas: [] };
  const ruta = Array.isArray(f.ruta) ? f.ruta : [];
  const etiquetas = Array.isArray(f.etiquetas) ? f.etiquetas : [];
  const coherente =
    ruta.length === etiquetas.length && ruta.length <= MAX_ANILLOS && ruta.every(esTexto) && etiquetas.every(esTexto);
  if (!coherente) return { area: f.area, ruta: [], etiquetas: [] };
  return { area: f.area, ruta: [...ruta], etiquetas: [...etiquetas] };
}

export function esTodos(f) {
  return normalizarFiltro(f).area === null;
}

export function etiquetaFiltro(f, nombreArea = (a) => a) {
  const n = normalizarFiltro(f);
  if (!n.area) return 'TODOS';
  return n.etiquetas.length > 0 ? `${nombreArea(n.area)} · ${n.etiquetas[n.etiquetas.length - 1]}` : nombreArea(n.area);
}

export function claveRuta(area, ruta) {
  return JSON.stringify([area, ruta]);
}

export function filtroDeModo(modo, almacen) {
  const todos = leerJson(almacen, CLAVE_FILTROS);
  return normalizarFiltro(esObjetoPlano(todos) ? todos[modo] : null);
}

export function guardarFiltroDeModo(modo, filtro, almacen) {
  const todos = leerJson(almacen, CLAVE_FILTROS);
  const nuevo = { ...(esObjetoPlano(todos) ? todos : {}), [modo]: normalizarFiltro(filtro) };
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_FILTROS, JSON.stringify(nuevo));
    return true;
  } catch {
    return false;
  }
}

export function leerIndiceRutas(almacen) {
  const crudo = leerJson(almacen, CLAVE_INDICE_RUTAS);
  const indice = {};
  if (!esObjetoPlano(crudo)) return indice;
  for (const [clave, ids] of Object.entries(crudo)) {
    let partes;
    try {
      partes = JSON.parse(clave);
    } catch {
      continue;
    }
    if (!Array.isArray(partes) || !AREAS.includes(partes[0]) || !Array.isArray(partes[1]) || !Array.isArray(ids)) continue;
    indice[clave] = ids.filter((id) => typeof id === 'string');
  }
  return indice;
}

export function registrarIdsRuta(area, ruta, ids, almacen) {
  if (!AREAS.includes(area) || !Array.isArray(ruta) || !ruta.every(esTexto) || !Array.isArray(ids)) return false;
  const indice = leerIndiceRutas(almacen);
  const clave = claveRuta(area, ruta);
  const previos = indice[clave] || [];
  delete indice[clave]; // se reinserta al final: las rutas más recientes son las últimas en caer
  indice[clave] = [...new Set([...previos, ...ids.filter((id) => typeof id === 'string')])].slice(-MAX_IDS_POR_RUTA);
  const claves = Object.keys(indice);
  for (const vieja of claves.slice(0, Math.max(0, claves.length - MAX_RUTAS))) delete indice[vieja];
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_INDICE_RUTAS, JSON.stringify(indice));
    return true;
  } catch {
    return false;
  }
}

export function idsDeRuta(indice, area, ruta) {
  const ids = new Set();
  for (const [clave, lista] of Object.entries(indice)) {
    const [a, r] = JSON.parse(clave);
    if (a !== area || r.length < ruta.length) continue;
    if (ruta.every((tramo, i) => r[i] === tramo)) lista.forEach((id) => ids.add(id));
  }
  return ids;
}

export function crearPredicado(filtro, indice) {
  const f = normalizarFiltro(filtro);
  if (!f.area) return () => true;
  if (f.ruta.length === 0) return (p) => p.area === f.area;
  const ids = idsDeRuta(indice, f.area, f.ruta);
  return (p) => p.area === f.area && ids.has(p.id);
}

export function preguntasDelFiltro(banco, filtro, indice, reportadas = []) {
  const fuera = new Set(reportadas);
  const cumple = crearPredicado(filtro, indice);
  return banco.filter((p) => !fuera.has(p.id) && cumple(p));
}

export function contarJugables(banco, filtro, indice, reportadas = []) {
  return preguntasDelFiltro(banco, filtro, indice, reportadas).length;
}

/** Lo que `app.js#empezarPartida` entiende: null (todo), {area} o {ids, etiqueta} (sin relleno). */
export function filtroParaPartida(filtro, banco, indice, estado, nombreArea = (a) => a) {
  const f = normalizarFiltro(filtro);
  if (!f.area) return null;
  if (f.ruta.length === 0) return { area: f.area };
  const tarjetas = (estado && estado.tarjetas) || {};
  const candidatas = preguntasDelFiltro(banco, f, indice, (estado && estado.reportadas) || []);
  const ordenadas = [...candidatas].sort((a, b) => {
    const jugadaA = tarjetas[a.id] ? 1 : 0;
    const jugadaB = tarjetas[b.id] ? 1 : 0;
    if (jugadaA !== jugadaB) return jugadaA - jugadaB; // sin jugar primero
    return String((tarjetas[a.id] || {}).proximo || '').localeCompare(String((tarjetas[b.id] || {}).proximo || ''));
  });
  return { ids: ordenadas.slice(0, MAX_PARTIDA_FILTRO).map((p) => p.id), etiqueta: etiquetaFiltro(f, nombreArea) };
}

/**
 * Repaso (decisión de Carlos, 5-oct): partida con las falladas sin recuperar, como el antiguo botón
 * "Pendientes". `pendientesLista` = `motor.js#pendientes(estado, banco)` (preguntas, ya en su orden
 * de prioridad). Aplica el filtro de Repaso y quita las reportadas; como mucho 10. `null` si no
 * queda ninguna (la UI avisa "Nada por repasar" en vez de fingir una partida).
 */
export function filtroParaRepaso(pendientesLista, filtro, indice, reportadas = [], nombreArea = (a) => a) {
  const fuera = new Set(reportadas);
  const cumple = crearPredicado(filtro, indice);
  const ids = (Array.isArray(pendientesLista) ? pendientesLista : [])
    .filter((p) => p && !fuera.has(p.id) && cumple(p))
    .slice(0, MAX_PARTIDA_FILTRO)
    .map((p) => p.id);
  if (ids.length === 0) return null;
  const f = normalizarFiltro(filtro);
  return { ids, etiqueta: f.area ? `Repaso · ${etiquetaFiltro(f, nombreArea)}` : 'Repaso' };
}

/**
 * Aviso de "menos de 5" (spec §4/§11), regla y textos en un solo sitio (puro, con test).
 * `null` si no hay aviso: filtro TODOS o `n >= MIN_JUGABLES`. Si no: `{texto, generar, jugar}` donde
 * `jugar` es el texto del botón ("Jugar las 2", "Repasar la 1") o `null` con 0 elementos, y `generar`
 * dice si se ofrece "Generar preguntas" (nunca en Repaso: lo generado es nuevo, no pendiente).
 */
export function avisoFiltroCorto({ modo, filtro, n, nombreArea = (a) => a }) {
  const f = normalizarFiltro(filtro);
  if (!f.area || n >= MIN_JUGABLES) return null;
  const etiqueta = etiquetaFiltro(f, nombreArea);
  const esRepaso = modo === 'repaso';
  const cosa = esRepaso ? (n === 1 ? 'pendiente' : 'pendientes') : n === 1 ? 'pregunta' : 'preguntas';
  const texto = n === 0
    ? (esRepaso ? `Nada por repasar de ${etiqueta}` : `Aún no hay preguntas de ${etiqueta}`)
    : `Solo hay ${n} ${cosa} de ${etiqueta}`;
  const jugar = n === 0 ? null : `${esRepaso ? 'Repasar' : 'Jugar'} ${n === 1 ? 'la' : 'las'} ${n}`;
  return { texto, generar: !esRepaso, jugar };
}

// --- DOM (lo mínimo; la orquestación de la hoja y del átomo vive en app.js) -------------------

export function pintarChip(boton, texto) {
  boton.textContent = texto;
  boton.title = texto;
  boton.setAttribute('aria-label', `Filtro: ${texto}. Toca para cambiarlo`);
}

/** Primer nivel de la hoja del filtro: TODOS + un botón por área. `alElegir(null|area)`. */
export function construirListaAreas({ areas, nombreArea, emojiArea, filtroActual, alElegir }) {
  const actual = normalizarFiltro(filtroActual).area;
  const lista = document.createElement('div');
  lista.className = 'filtro-areas-lista';
  const opciones = [{ area: null, texto: 'TODOS', emoji: '✨', test: 'filtro-todos' }].concat(
    areas.map((area) => ({ area, texto: nombreArea(area), emoji: emojiArea(area), test: `filtro-area-${area}` }))
  );
  for (const { area, texto, emoji, test } of opciones) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'filtro-area';
    boton.dataset.test = test;
    boton.setAttribute('aria-pressed', String(area === actual));
    if (area === actual) boton.classList.add('filtro-area--activa');
    boton.textContent = `${emoji} ${texto}`;
    boton.addEventListener('click', () => alElegir(area));
    lista.appendChild(boton);
  }
  return lista;
}
