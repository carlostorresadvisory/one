// ONE · reglas de imagen compartidas por el servidor y tools/ (spec v0.3 §7): cuándo vale una imagen
// de IA, qué imágenes se pueden publicar y cómo se descarga sin dejar que una respuesta enorme tumbe
// el proceso. Sin dependencias.

// --- Cuándo se admite una imagen de IA --------------------------------------------------------------

const CLAVES_SIN_TEXTO = new Set(['id', 'area', 'tipo', 'generador', 'verificador', 'imagen', 'visual', 'confianza', 'verificado', 'nivel', 'hilo']);
// Palabras que anuncian un mapa, una persona o un hecho concreto aunque vayan en minúscula.
const PIDE_ALGO_CONCRETO = /\b(mapas?|planos?|fronteras?|batallas?|guerras?|tratados?|reyes|reina|rey|emperador(?:es)?|presidentes?|l[ií]der(?:es)?|ca(?:udillo|pital)|ciudad(?:es)?|r[ií]os?|monte|monta[ñn]as?|desiertos?|islas?|estrechos?|oc[eé]anos?|mares?|pa[ií]s(?:es)?|imperios?|revoluci[oó]n|dictador|general)\b/i;

function textosDe(valor, salida = []) {
  if (typeof valor === 'string') salida.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textosDe(v, salida));
  else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) if (!CLAVES_SIN_TEXTO.has(k)) textosDe(v, salida);
  }
  return salida;
}

function tieneNombrePropioOFecha(texto) {
  if (/\d{3,4}/.test(texto)) return true;
  for (const frase of texto.split(/[.!?¿¡:;\n]+/)) {
    const palabras = frase.trim().split(/\s+/).slice(1);
    if (palabras.some((w) => /^["'«“(]?[A-ZÁÉÍÓÚÑ][\p{L}]{1,}/u.test(w))) return true;
  }
  return false;
}

/**
 * ¿Se puede ilustrar esta pregunta con una imagen generada por IA? Arte: nunca (obra real o nada).
 * Historia y geografía: solo si NADA de la pregunta pide un mapa, una persona, un lugar o un hecho
 * concreto (nombres propios, fechas o palabras como «mapa», «batalla», «río»...); si hay duda, no.
 */
export function iaPermitida(pregunta) {
  const area = String(pregunta?.area ?? '');
  if (area === 'arte') return false;
  if (area === 'historia' || area === 'geografia') {
    const texto = textosDe(pregunta).join('\n');
    if (PIDE_ALGO_CONCRETO.test(texto) || tieneNombrePropioOFecha(texto)) return false;
  }
  return true;
}

/** Una imagen de IA solo entra si su nota es >= 4 y supera la de la imagen actual (sin actual = 0). */
export function iaMejoraActual(notaIA, notaActual) {
  if (!Number.isFinite(notaIA) || notaIA < 4) return false;
  return notaIA > (Number.isFinite(notaActual) ? notaActual : 0);
}

// --- Qué se puede publicar --------------------------------------------------------------------------

const DOMINIOS_PERMITIDOS = new Set(['upload.wikimedia.org', 'commons.wikimedia.org']);

export function licenciaLibre(nombre) {
  const n = String(nombre ?? '').trim();
  if (!n) return false;
  if (/^public domain/i.test(n) || /^cc0/i.test(n)) return true;
  if (/^cc[\s-]?by/i.test(n)) return !/nc/i.test(n) && !/\bnd\b/i.test(n);
  return false;
}

/** CC BY y CC BY-SA obligan a nombrar al autor. */
export const exigeAutor = (licencia) => /^cc[\s-]?by/i.test(String(licencia ?? '').trim());

/** Crédito completo: licencia libre y, si la licencia lo exige (CC BY, BY-SA), autor. */
export const creditoCompleto = (img) => licenciaLibre(img?.licencia) && (!exigeAutor(img.licencia) || String(img.autor ?? '').trim() !== '');

/**
 * ¿Se puede enseñar esta imagen? IA: sin licencia ni autor, siempre con ruta propia. Resto: licencia
 * libre, autor si la licencia lo exige y URL https de un dominio conocido o la ruta propia /imagenes/.
 */
export function imagenPublicable(imagen) {
  if (!imagen || typeof imagen !== 'object' || typeof imagen.url !== 'string') return false;
  let propia = /^\/imagenes\/[\w.-]+\.webp$/.test(imagen.url);
  if (!propia) {
    try {
      const u = new URL(imagen.url);
      if (u.protocol !== 'https:' || !DOMINIOS_PERMITIDOS.has(u.hostname)) return false;
    } catch {
      return false;
    }
    propia = false;
  }
  if (imagen.fuente === 'IA') return propia;
  return creditoCompleto(imagen);
}

// --- Descarga acotada -------------------------------------------------------------------------------

export const MAX_BYTES_DESCARGA = 8 * 1024 * 1024;
export const MAX_PIXELES = 64e6;

/** Descarga `url` y corta si pasa de `maxBytes` (por Content-Length o al leer). Lanza si falla. */
export async function descargarAcotado(url, { fetchImpl = fetch, userAgent, maxBytes = MAX_BYTES_DESCARGA, timeoutMs = 40000 } = {}) {
  const r = await fetchImpl(url, { headers: userAgent ? { 'User-Agent': userAgent } : {}, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const declarado = Number(r.headers?.get?.('content-length'));
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    r.body?.cancel?.().catch?.(() => {});
    throw new Error(`imagen demasiado grande (${declarado} bytes)`);
  }
  if (!r.body?.getReader) {
    const todo = Buffer.from(await r.arrayBuffer());
    if (todo.length > maxBytes) throw new Error(`imagen demasiado grande (${todo.length} bytes)`);
    return todo;
  }
  const trozos = [];
  let total = 0;
  const lector = r.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      lector.cancel().catch(() => {});
      throw new Error(`imagen demasiado grande (más de ${maxBytes} bytes)`);
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos);
}
