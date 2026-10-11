// ONE · foto-pregunta.js — la pantalla de pregunta con foto (spec v0.3 §4), común a Órdago,
// Contrarreloj y Afinar con fechas: la foto es la protagonista (todo el hueco libre entre la banda del
// avatar y las respuestas, recortada para cubrir), con un degradado oscuro abajo y el enunciado
// ENCIMA en blanco con sombra; crédito pequeño arriba a la derecha. Sin imagen, o si no carga, queda
// el color del área SIN emoji grande (nunca un hueco). Pregunta dorada: borde y brillo dorados (con
// los de la esfinge del «¡Nuevo máximo!» y el objeto épico, el único resplandor de la app).

const FUENTES = [
  [/(^|\.)commons\.wikimedia\.org$|(^|\.)upload\.wikimedia\.org$/, 'Commons'],
  [/(^|\.)wikidata\.org$/, 'Wikidata'],
  [/(^|\.)openverse\.org$/, 'Openverse'],
  [/(^|\.)metmuseum\.org$/, 'Met'],
  [/(^|\.)rijksmuseum\.nl$/, 'Rijksmuseum'],
  [/(^|\.)artic\.edu$/, 'Art Institute of Chicago'],
  [/(^|\.)si\.edu$/, 'Smithsonian'],
  [/(^|\.)nasa\.gov$/, 'NASA'],
];

/** Nombre de la fuente real: el campo `fuente` si existe; si no, el dominio de `pagina`/`url`. */
function nombreFuente(imagen) {
  if (typeof imagen.fuente === 'string' && imagen.fuente.trim()) return imagen.fuente.trim();
  for (const campo of [imagen.pagina, imagen.url]) {
    try {
      const host = new URL(campo).hostname;
      const hallada = FUENTES.find(([patron]) => patron.test(host));
      if (hallada) return hallada[1];
    } catch {
      // sin URL válida: se prueba con el siguiente campo
    }
  }
  return '';
}

/** `'Fuente · Autor · Licencia'`. El autor solo va si la licencia lo exige (CC BY…); una imagen de IA
 * dice `'Imagen generada con IA'`; sin imagen, cadena vacía. */
export function creditoTexto(imagen) {
  if (!imagen || typeof imagen !== 'object') return '';
  if (imagen.ia === true || /^ia$|^ai$/i.test(String(imagen.fuente || ''))) return 'Imagen generada con IA';
  const licencia = typeof imagen.licencia === 'string' ? imagen.licencia.trim() : '';
  const exigeAutor = /^cc[\s-]?by/i.test(licencia);
  const fuente = nombreFuente(imagen);
  // Algunos autores traen la fuente delante («Wikimedia Commons / Ana»): no se repite.
  const autor = typeof imagen.autor === 'string' ? imagen.autor.replace(/^\s*(wikimedia\s+)?commons\s*\/\s*/i, '').trim() : '';
  return [fuente, exigeAutor && autor.toLowerCase() !== fuente.toLowerCase() ? autor : '', licencia].filter(Boolean).join(' · ');
}

export const ESPERA_REINTENTO_IMAGEN_MS = 1500;

/** Ante el primer `error` de una imagen (429/503 de un origen ajeno, red que parpadea) reintenta UNA vez a los
 * 1,5 s con un parámetro de caché distinto (el navegador no reutiliza el fallo); si falla otra vez, `alFallar()`. */
export function reintentarImagen(img, alFallar, programar = (fn, ms) => globalThis.setTimeout(fn, ms)) {
  let reintentada = false;
  img.addEventListener('error', () => {
    if (reintentada) {
      alFallar();
      return;
    }
    reintentada = true;
    const url = String(img.src);
    programar(() => {
      // Imagen ya quitada del DOM, o con otra URL (otra pregunta): el reintento caduca sin tocar nada.
      if (img.isConnected === false || String(img.src) !== url) return;
      img.src = `${url}${url.includes('?') ? '&' : '?'}reintento=1`;
    }, ESPERA_REINTENTO_IMAGEN_MS);
  });
}

function crear(documento, etiqueta, clase) {
  const nodo = documento.createElement(etiqueta);
  nodo.className = clase;
  return nodo;
}

/** Monta la foto con el enunciado encima dentro de `contenedor`. Devuelve `{ nodoEnunciado,
 * ponerDorada(bool), destruir() }`. Nunca lanza por una imagen que no carga. */
export function montarFotoPregunta(contenedor, { enunciado, imagen, area, dorada = false, documento = contenedor.ownerDocument ?? globalThis.document }) {
  const raiz = crear(documento, 'div', 'foto-pregunta');
  if (area) {
    raiz.classList.add(`foto-pregunta--${area}`);
    raiz.setAttribute('data-area', area);
  }
  raiz.setAttribute('data-test', 'foto-pregunta');

  let credito = null;
  if (imagen && typeof imagen.url === 'string' && imagen.url) {
    const img = crear(documento, 'img', 'foto-pregunta-imagen');
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = imagen.url;
    // Si no carga, se quita (y con ella su crédito): queda el color del área, nunca un hueco.
    reintentarImagen(img, () => {
      img.remove();
      if (credito) credito.remove();
    });
    raiz.appendChild(img);
    const texto = creditoTexto(imagen);
    if (texto) {
      credito = crear(documento, 'span', 'foto-pregunta-credito');
      credito.setAttribute('data-test', 'foto-pregunta-credito');
      credito.textContent = texto;
    }
  }

  const degradado = crear(documento, 'div', 'foto-pregunta-degradado');
  degradado.setAttribute('aria-hidden', 'true');
  const nodoEnunciado = crear(documento, 'p', 'foto-pregunta-enunciado');
  nodoEnunciado.setAttribute('data-test', 'foto-pregunta-enunciado');
  nodoEnunciado.textContent = enunciado ?? '';
  raiz.append(degradado, nodoEnunciado);
  if (credito) raiz.appendChild(credito);

  const ponerDorada = (valor) => raiz.classList.toggle('foto-pregunta--dorada', Boolean(valor));
  ponerDorada(dorada);
  contenedor.appendChild(raiz);

  return {
    nodoEnunciado,
    ponerDorada,
    destruir() {
      raiz.remove();
    },
  };
}

// Imágenes que Carlos ha marcado como malas desde la tarjeta («Imagen mala»): dejan de enseñarse al
// instante y el lote de mejora (tools/mejorar-imagenes.js) las sustituye aunque tuvieran nota 4-5.
// Con el almacenamiento bloqueado nada lanza (patrón de modos.js).
export const CLAVE_IMAGENES_MALAS = 'one.imagenesMalas';
const MAX_IMAGENES_MALAS = 2000;

export function cargarImagenesMalas(almacen) {
  try {
    const lista = JSON.parse((almacen ?? globalThis.localStorage).getItem(CLAVE_IMAGENES_MALAS));
    return new Set(Array.isArray(lista) ? lista.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(-MAX_IMAGENES_MALAS) : []);
  } catch {
    return new Set();
  }
}

export function guardarImagenesMalas(ids, almacen) {
  try {
    (almacen ?? globalThis.localStorage).setItem(CLAVE_IMAGENES_MALAS, JSON.stringify([...ids].slice(-MAX_IMAGENES_MALAS)));
    return true;
  } catch {
    return false;
  }
}

/** ¿Se puede enlazar a esta página de origen? Solo https (nada de javascript:, data: ni http). */
export function esPaginaSegura(pagina) {
  return typeof pagina === 'string' && /^https:\/\//.test(pagina);
}

/** ¿Es una `imagen` que el servidor puede mandar? URL https (Commons y bancos) o una WebP propia del
 * servidor (`/imagenes/<id>.webp`); los demás campos, si están, son texto corto o nota 1-5. */
export function esImagenValida(imagen) {
  if (!imagen || typeof imagen !== 'object' || Array.isArray(imagen)) return false;
  const urlBuena = typeof imagen.url === 'string' && imagen.url.length <= 600 && (/^https:\/\//.test(imagen.url) || /^\/imagenes\/[\w-]{1,64}\.webp$/.test(imagen.url));
  if (!urlBuena) return false;
  if (imagen.pagina !== undefined && imagen.pagina !== null && !esPaginaSegura(imagen.pagina)) return false;
  for (const campo of ['pagina', 'titulo', 'autor', 'licencia', 'fuente']) {
    const v = imagen[campo];
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 400)) return false;
  }
  return imagen.nota === undefined || imagen.nota === null || (Number.isInteger(imagen.nota) && imagen.nota >= 1 && imagen.nota <= 5);
}
