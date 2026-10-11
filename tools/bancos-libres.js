// Bancos de imágenes libres con API (spec v0.3 §7), además de Commons: Openverse, Met, Art Institute
// of Chicago y NASA. Todo gratis, sin clave, datos públicos. Smithsonian queda fuera de la primera
// versión (pide clave de api.data.gov). Cada adaptador devuelve la forma común
// `{ url, pagina, titulo, autor, licencia, fuente, ancho, alto }` y solo deja pasar licencias libres.
// Cortesía: User-Agent identificable y una pausa entre peticiones al mismo banco.
import { licenciaPermitida } from './buscar-imagenes.js';

const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';
const LADO_MINIMO = 600;
const TIMEOUT_MS = 15000;
const PAUSA_MS = 400;
const MAX_OBJETOS_MET = 4;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pedirJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function grande(ancho, alto) {
  // Dimensión desconocida (null/0) no descarta: los museos sirven imágenes grandes.
  return (!ancho || ancho >= LADO_MINIMO) && (!alto || alto >= LADO_MINIMO);
}

function licenciaOpenverse(licencia, version) {
  const l = String(licencia || '').toLowerCase();
  if (l === 'cc0') return 'CC0';
  if (l === 'pdm') return 'Public domain';
  if (!l) return '';
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`;
}

export async function buscarOpenverse(termino, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ q: termino, license_type: 'commercial,modification', page_size: '8', mature: 'false' });
  const datos = await pedirJson(`https://api.openverse.org/v1/images/?${params}`, fetchImpl);
  return (datos.results ?? [])
    .map((r) => ({
      url: r.url,
      pagina: r.foreign_landing_url,
      titulo: r.title || '',
      autor: r.creator || '',
      licencia: licenciaOpenverse(r.license, r.license_version),
      fuente: 'Openverse',
      ancho: Number(r.width) || null,
      alto: Number(r.height) || null,
    }))
    .filter((c) => c.url && licenciaPermitida(c.licencia) && grande(c.ancho, c.alto));
}

export async function buscarMet(termino, { fetchImpl = fetch, pausaMs = PAUSA_MS } = {}) {
  const params = new URLSearchParams({ hasImages: 'true', q: termino, limit: String(MAX_OBJETOS_MET) });
  const busqueda = await pedirJson(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?${params}`, fetchImpl);
  const ids = (busqueda.objectIDs ?? []).slice(0, MAX_OBJETOS_MET);
  const salida = [];
  for (const id of ids) {
    await esperar(pausaMs);
    let o;
    try {
      o = await pedirJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, fetchImpl);
    } catch {
      continue;
    }
    // Solo dominio público confirmado por el propio museo.
    if (o.isPublicDomain !== true || !o.primaryImageSmall) continue;
    salida.push({
      url: o.primaryImageSmall,
      pagina: o.objectURL,
      titulo: o.title || '',
      autor: o.artistDisplayName || '',
      licencia: 'CC0',
      fuente: 'Met',
      ancho: null,
      alto: null,
    });
  }
  return salida;
}

export async function buscarAIC(termino, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ q: termino, fields: 'id,title,image_id,artist_title,is_public_domain', limit: '8' });
  const datos = await pedirJson(`https://api.artic.edu/api/v1/artworks/search?${params}`, fetchImpl);
  const iiif = datos.config?.iiif_url ?? 'https://www.artic.edu/iiif/2';
  return (datos.data ?? [])
    .filter((o) => o.is_public_domain === true && o.image_id)
    .map((o) => ({
      url: `${iiif}/${o.image_id}/full/843,/0/default.jpg`,
      pagina: `https://www.artic.edu/artworks/${o.id}`,
      titulo: o.title || '',
      autor: o.artist_title || '',
      licencia: 'CC0',
      fuente: 'Art Institute of Chicago',
      ancho: 843,
      alto: null,
    }));
}

export async function buscarNASA(termino, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ q: termino, media_type: 'image' });
  const datos = await pedirJson(`https://images-api.nasa.gov/search?${params}`, fetchImpl);
  const salida = [];
  for (const item of (datos.collection?.items ?? []).slice(0, 8)) {
    const meta = item.data?.[0];
    // La versión «large» (≈1536 px) o, si no, la «medium» (≈1024 px).
    const enlace = (item.links ?? []).find((l) => /~large\./.test(l.href)) ?? (item.links ?? []).find((l) => /~medium\./.test(l.href));
    if (!meta || !enlace) continue;
    salida.push({
      url: enlace.href,
      pagina: `https://images.nasa.gov/details/${meta.nasa_id}`,
      titulo: meta.title || '',
      autor: meta.photographer || meta.secondary_creator || 'NASA',
      licencia: 'Public domain',
      fuente: 'NASA',
      ancho: Number(enlace.width) || null,
      alto: Number(enlace.height) || null,
    });
  }
  return salida.filter((c) => grande(c.ancho, c.alto));
}

const MUSEOS = [buscarMet, buscarAIC];
const ORDEN = {
  arte: [...MUSEOS, buscarOpenverse],
  historia: [...MUSEOS, buscarOpenverse],
  ciencia: [buscarNASA, buscarOpenverse],
};

/** Busca en los bancos según el área (arte/historia: museos primero; ciencia: NASA primero; resto:
 * Openverse) y devuelve la lista concatenada en ese orden. Un banco que falla se salta. */
export async function buscarEnBancos(termino, { area = '', fetchImpl = fetch, pausaMs = PAUSA_MS } = {}) {
  const adaptadores = ORDEN[area] ?? [buscarOpenverse];
  const lista = [];
  for (const adaptador of adaptadores) {
    try {
      lista.push(...(await adaptador(termino, { fetchImpl, pausaMs })));
    } catch {
      // un banco caído o con límite de peticiones no detiene la búsqueda
    }
  }
  return lista.filter((c) => licenciaPermitida(c.licencia));
}
