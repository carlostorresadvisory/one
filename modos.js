// ONE · modos.js — registro de modos del hub v0.3 (spec §3). Cada fase que entrega un modo pone
// `disponible: true`, añade su caso en `marcadorModo` y su rama en app.js#arrancarModo. Imágenes de
// bancos libres (Commons, Openverse, Met…) puntuadas con modelo de visión (tools/imagenes-hub.js, WebP en
// imagenes-hub/); atribución real en la hoja "Créditos" del pie del hub.

import { formatearCifra } from './ordago.js';

/** Imagen de la tarjeta Tienda del hub (misma ficha y crédito real que las de los modos). */
export const TIENDA = Object.freeze({
  imagen: Object.freeze({
    url: 'imagenes-hub/tienda.webp',
    pagina: 'https://www.flickr.com/photos/56796376@N00/5373673363',
    titulo: 'Dubai\'s Spice Souks #3', autor: 'mckaysavage', licencia: 'CC BY 2.0', fuente: 'Openverse',
    credito: 'Openverse · mckaysavage · CC BY 2.0',
  }),
});

export const MODOS = Object.freeze([
  Object.freeze({
    id: 'clasico', nombre: 'Clásico', icono: '🎯', disponible: true, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: 'imagenes-hub/clasico.webp',
      pagina: 'https://commons.wikimedia.org/wiki/File:Stiftsbibliothek_Admont.jpg',
      titulo: 'Biblioteca de la abadía de Admont', autor: 'LitterART', licencia: 'CC BY-SA 4.0', fuente: 'Commons',
      credito: 'Commons · LitterART · CC BY-SA 4.0',
    }),
  }),
  Object.freeze({
    id: 'repaso', nombre: 'Repaso', icono: '🔁', disponible: true, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: 'imagenes-hub/repaso.webp',
      pagina: 'https://commons.wikimedia.org/wiki/File:Celsus_Library,_Ephesus.jpg',
      titulo: 'Biblioteca de Celso, Éfeso', autor: 'Austrian Archaeological Institute', licencia: 'CC BY-SA 3.0', fuente: 'Commons',
      credito: 'Commons · Austrian Archaeological Institute · CC BY-SA 3.0',
    }),
  }),
  Object.freeze({
    id: 'ordago', nombre: 'Órdago', icono: '🎲', disponible: true, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: 'imagenes-hub/ordago.webp',
      pagina: 'https://commons.wikimedia.org/wiki/File:Roulette_-_detail.jpg',
      titulo: 'Ruleta (detalle)', autor: 'Conor Ogle', licencia: 'CC BY 2.0', fuente: 'Commons',
      credito: 'Commons · Conor Ogle · CC BY 2.0',
    }),
  }),
  Object.freeze({
    id: 'masomenos', nombre: 'Más o menos', icono: '⚖️', disponible: true, nivelFiltro: 'area',
    imagen: Object.freeze({
      url: 'imagenes-hub/masomenos.webp',
      pagina: 'https://commons.wikimedia.org/wiki/File:Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg',
      titulo: 'Cara norte del Everest', autor: 'Luca Galuzzi (Lucag)', licencia: 'CC BY-SA 2.5', fuente: 'Commons',
      credito: 'Commons · Luca Galuzzi (Lucag) · CC BY-SA 2.5',
    }),
  }),
  Object.freeze({
    id: 'contrarreloj', nombre: 'Contrarreloj', icono: '⏱️', disponible: true, nivelFiltro: 'arbol',
    imagen: Object.freeze({
      url: 'imagenes-hub/contrarreloj.webp',
      pagina: 'https://www.flickr.com/photos/38389073@N04/5640739307',
      titulo: 'Hourglass', autor: 'Jamiesrabbits', licencia: 'CC BY 2.0', fuente: 'Openverse',
      credito: 'Openverse · Jamiesrabbits · CC BY 2.0',
    }),
  }),
]);

/** Órdago y Contrarreloj no sirven preguntas de nivel 1-2 (spec §4); Clásico y Repaso siguen desde el 1. */
export const NIVEL_MINIMO_DIFICIL = 3;

/** ¿Vale esta pregunta para un modo difícil? Solo V/F y test4 de nivel 3-5; sin `nivel` no vale. */
export function esJugableDificil(p) {
  return Boolean(p) && (p.tipo === 'vf' || p.tipo === 'test4')
    && Number.isInteger(p.nivel) && p.nivel >= NIVEL_MINIMO_DIFICIL && p.nivel <= 5;
}

export function modoPorId(id) {
  return MODOS.find((m) => m.id === id) || null;
}

/** Marcador vivo de la tarjeta del hub (spec §3). `datos` lo calcula app.js#renderHub. */
export function marcadorModo(id, { aciertosHoy = 0, respondidasHoy = 0, porRepasar = 0, fondo = 1000, marca = '', recordMasomenos = '' } = {}) {
  if (id === 'clasico') return `Hoy ${aciertosHoy}/${respondidasHoy}`;
  if (id === 'repaso') return porRepasar > 0 ? `${porRepasar} por repasar` : 'Al día';
  if (id === 'ordago') return formatearCifra(fondo);
  if (id === 'contrarreloj') return marca || 'Sin marca';
  if (id === 'masomenos') return recordMasomenos || 'Sin récord';
  return 'Pronto';
}
