// ONE · modos.js — registro de modos del hub v0.3 (spec §3). Cada fase que entrega un modo pone
// `disponible: true`, añade su caso en `marcadorModo` y su rama en app.js#arrancarModo. Imágenes de
// Wikimedia Commons (licencia libre, atribución en la hoja "Créditos" del pie del hub).

export const MODO_POR_DEFECTO = 'clasico';
export const CLAVE_ULTIMO_MODO = 'one.ultimoModo';

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/thumb';

export const MODOS = Object.freeze([
  Object.freeze({
    id: 'clasico', nombre: 'Clásico', icono: '🎯', disponible: true, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: `${COMMONS}/e/ec/Stiftsbibliothek_Admont.jpg/500px-Stiftsbibliothek_Admont.jpg`,
      pagina: 'https://commons.wikimedia.org/wiki/File:Stiftsbibliothek_Admont.jpg',
      titulo: 'Biblioteca de la abadía de Admont', autor: 'LitterART', licencia: 'CC BY-SA 4.0',
    }),
  }),
  Object.freeze({
    id: 'repaso', nombre: 'Repaso', icono: '🔁', disponible: true, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: `${COMMONS}/a/ad/Celsus_Library%2C_Ephesus.jpg/500px-Celsus_Library%2C_Ephesus.jpg`,
      pagina: 'https://commons.wikimedia.org/wiki/File:Celsus_Library,_Ephesus.jpg',
      titulo: 'Biblioteca de Celso, Éfeso', autor: 'Austrian Archaeological Institute', licencia: 'CC BY-SA 3.0',
    }),
  }),
  Object.freeze({
    id: 'apuesta', nombre: 'Apuesta', icono: '🎲', disponible: false, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: `${COMMONS}/1/1c/Roulette_-_detail.jpg/500px-Roulette_-_detail.jpg`,
      pagina: 'https://commons.wikimedia.org/wiki/File:Roulette_-_detail.jpg',
      titulo: 'Ruleta (detalle)', autor: 'Conor Ogle', licencia: 'CC BY 2.0',
    }),
  }),
  Object.freeze({
    id: 'masomenos', nombre: 'Más o menos', icono: '⚖️', disponible: false, nivelFiltro: 'area',
    imagen: Object.freeze({
      url: `${COMMONS}/e/e7/Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg/500px-Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg`,
      pagina: 'https://commons.wikimedia.org/wiki/File:Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg',
      titulo: 'Cara norte del Everest', autor: 'Luca Galuzzi (Lucag)', licencia: 'CC BY-SA 2.5',
    }),
  }),
  Object.freeze({
    id: 'contrarreloj', nombre: 'Contrarreloj', icono: '⏱️', disponible: false, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: `${COMMONS}/7/70/Wooden_hourglass_3.jpg/500px-Wooden_hourglass_3.jpg`,
      pagina: 'https://commons.wikimedia.org/wiki/File:Wooden_hourglass_3.jpg',
      titulo: 'Reloj de arena de madera', autor: 'S Sepp', licencia: 'CC BY-SA 3.0',
    }),
  }),
]);

export function modoPorId(id) {
  return MODOS.find((m) => m.id === id) || null;
}

// `almacen ?? globalThis.localStorage` se resuelve DENTRO del try: con el almacenamiento bloqueado
// el getter de `localStorage` lanza SecurityError y no debe escapar.
export function cargarUltimoModo(almacen) {
  try {
    const id = (almacen ?? globalThis.localStorage).getItem(CLAVE_ULTIMO_MODO);
    return modoPorId(id) ? id : MODO_POR_DEFECTO;
  } catch {
    return MODO_POR_DEFECTO;
  }
}

export function guardarUltimoModo(id, almacen) {
  if (!modoPorId(id)) return false;
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_ULTIMO_MODO, id);
    return true;
  } catch {
    return false;
  }
}

/** Marcador vivo de la tarjeta del hub (spec §3). `datos` lo calcula app.js#renderHub. */
export function marcadorModo(id, { aciertosHoy = 0, respondidasHoy = 0, porRepasar = 0 } = {}) {
  if (id === 'clasico') return `Hoy ${aciertosHoy}/${respondidasHoy}`;
  if (id === 'repaso') return porRepasar > 0 ? `${porRepasar} por repasar` : 'Al día';
  return 'Próximamente';
}
