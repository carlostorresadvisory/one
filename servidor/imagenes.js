// ONE · imagen de una pregunta generada en el servidor (spec v0.3 §7): sustituye al antiguo paso de
// visual. Orden: Commons -> otros bancos libres -> IA (último recurso). Cada candidata la puntúa un
// modelo gratis con visión y solo vale con nota >= 4. La IA NUNCA bloquea una pregunta: en una tanda
// urgente (`permitirIA: false`) no se usa; la pregunta sale con el color del área y la imagen llega
// en el trabajo de fondo (servidor/cola.js#completarImagenesPendientes).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buscarEnCommons, elegirImagen } from '../tools/buscar-imagenes.js';
import { buscarEnBancos } from '../tools/bancos-libres.js';
import { puntuarImagen, esBuena } from '../tools/nota-imagen.js';
import { llamar, extraerJson } from '../tools/openrouter.js';
import { escribirPrompt, generarImagen, crearCupo, aWebp, CREDITO_IA } from './imagen-ia.js';

export const MAX_CANDIDATAS_POR_FUENTE = 3;
const MODELOS_TEXTO = ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'];
const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';

/**
 * Busca la mejor imagen para `pregunta`. Todas las dependencias van inyectadas (los tests no tocan
 * la red). Nunca lanza.
 * @returns {Promise<{imagen: object|null}>} `imagen` = `{url, pagina, titulo, autor, licencia, fuente, nota}`
 */
export async function resolverImagen(pregunta, deps) {
  const {
    permitirIA = false,
    descartadas = [],
    signal = null,
    proponerTerminos,
    buscarCommons,
    buscarBancos,
    puntuar,
    guardarArchivo,
    generarIA,
    cupo,
  } = deps;
  const cortada = () => signal?.aborted === true;
  const vistas = new Set(descartadas);
  try {
    const terminos = (await proponerTerminos(pregunta)).filter(Boolean).slice(0, 2);
    const probar = async (candidatas, guardar) => {
      let n = 0;
      for (const c of candidatas) {
        if (cortada()) return null;
        if (!c?.url || vistas.has(c.url)) continue;
        vistas.add(c.url);
        if (++n > MAX_CANDIDATAS_POR_FUENTE) break;
        const r = await puntuar({ url: c.url, pregunta });
        if (r && esBuena(r.nota)) {
          const url = guardar ? await guardarArchivo(c, pregunta) : c.url;
          return { url, pagina: c.pagina ?? null, titulo: c.titulo ?? '', autor: c.autor ?? null, licencia: c.licencia ?? null, fuente: c.fuente, nota: r.nota };
        }
      }
      return null;
    };

    for (const t of terminos) {
      const c = await probar(await buscarCommons(t, pregunta), false);
      if (c) return { imagen: c };
      if (cortada()) return { imagen: null };
    }
    for (const t of terminos) {
      const c = await probar(await buscarBancos(t, pregunta.area), true);
      if (c) return { imagen: c };
      if (cortada()) return { imagen: null };
    }
    if (permitirIA && !cortada() && cupo.puede()) {
      const g = await generarIA(pregunta);
      if (g) return { imagen: { ...g, pagina: null, titulo: '', autor: CREDITO_IA.autor, licencia: CREDITO_IA.licencia, fuente: CREDITO_IA.fuente, nota: null } };
    }
  } catch {
    // Cualquier fallo de red o de modelo: la pregunta se queda sin imagen por ahora (pendiente).
  }
  return { imagen: null };
}

/**
 * Dependencias reales de `resolverImagen` para el servidor: las WebP de bancos distintos de Commons
 * y las de IA se guardan en `<rutaDatos>/imagenes/<id>.webp` y se sirven en `/imagenes/<id>.webp`.
 */
export function crearResolvedorReal({ rutaDatos, entorno = process.env, fetchImpl = fetch, cupo = null } = {}) {
  const carpeta = path.join(rutaDatos, 'imagenes');
  const cupoIA = cupo ?? crearCupo({ ruta: path.join(rutaDatos, 'cupo-ia.json') });
  const llamarModelo = async ({ mensajes }) =>
    (await llamar({ modelos: MODELOS_TEXTO, mensajes, temperatura: 0.4, maxTokens: 400, timeoutMs: 30000, reintentoMs: 1000 })).texto;

  async function guardarWebp(id, buffer) {
    await mkdir(carpeta, { recursive: true });
    await writeFile(path.join(carpeta, `${id}.webp`), await aWebp(buffer));
    return `/imagenes/${id}.webp`;
  }

  const deps = {
    cupo: cupoIA,
    async proponerTerminos(pregunta) {
      try {
        const texto = await llamarModelo({
          mensajes: [
            { role: 'system', content: 'Propones 2 términos de búsqueda en INGLÉS (1-4 palabras) para encontrar una foto libre llamativa, a color y de primer plano sobre el tema de una pregunta de quiz. Devuelve SOLO JSON {"terminos": ["a", "b"]}.' },
            { role: 'user', content: `${pregunta.enunciado} (respuesta: ${pregunta.explicacion ?? ''})`.slice(0, 500) },
          ],
        });
        const t = extraerJson(texto)?.terminos;
        if (Array.isArray(t) && t.length > 0) return t.filter((x) => typeof x === 'string');
      } catch {
        // sin modelo: se busca con el enunciado
      }
      return [String(pregunta.enunciado).slice(0, 60)];
    },
    async buscarCommons(termino, pregunta) {
      const { paginas } = await buscarEnCommons(termino, fetchImpl);
      const lista = [];
      for (const pagina of paginas) {
        const c = elegirImagen([pagina], pregunta);
        if (c) lista.push({ url: c.url, pagina: c.pagina, titulo: c.titulo, autor: c.autor, licencia: c.licencia, fuente: 'Commons' });
      }
      return lista;
    },
    buscarBancos: (termino, area) => buscarEnBancos(termino, { area, fetchImpl }),
    puntuar: (datos) => puntuarImagen(datos),
    async guardarArchivo(candidata, pregunta) {
      const r = await fetchImpl(candidata.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(40000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return guardarWebp(pregunta.id, Buffer.from(await r.arrayBuffer()));
    },
    async generarIA(pregunta) {
      const prompt = await escribirPrompt(pregunta, { llamarModelo });
      const g = await generarImagen(prompt, { fetchImpl, entorno, cupo: cupoIA });
      if (!g) return null;
      return { url: await guardarWebp(pregunta.id, g.buffer) };
    },
  };

  /** `(pregunta, { permitirIA, signal }) -> { imagen }`; recuerda las imágenes ya descartadas. */
  return (pregunta, { permitirIA = false, signal = null } = {}) =>
    resolverImagen(pregunta, { ...deps, permitirIA, signal, descartadas: pregunta.imagenesDescartadas ?? [] });
}
