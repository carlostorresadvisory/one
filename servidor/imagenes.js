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
import { iaPermitida, iaMejoraActual, imagenPublicable, creditoCompleto, descargarAcotado } from './politica-imagen.js';

export const MAX_CANDIDATAS_POR_FUENTE = 6;
const MODELOS_TEXTO = ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'];
const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';

/**
 * Busca la mejor imagen para `pregunta`. Todas las dependencias van inyectadas (los tests no tocan
 * la red). Nunca lanza.
 * Distingue «fuente agotada» (todas las candidatas se puntuaron y ninguna llegó a 4) de un fallo
 * técnico (visión que no responde, descarga fallida, búsqueda caída): un fallo técnico NO baja a la
 * IA y devuelve `tecnico: true` para que la pregunta siga pendiente sin gastar un intento.
 * Con `permitirIA` y galerías agotadas, `imagen: null` lleva además `iaNoAplica: true` (la política no admite IA para
 * esta pregunta: arte, o historia/geografía con algo concreto) o `sinIAHoy: true` (cupo diario o proveedor sin
 * respuesta: mañana puede). Sin ninguna de las dos, la IA generó y el juez la rechazó.
 * @returns {Promise<{imagen: object|null, tecnico?: boolean, iaNoAplica?: boolean, sinIAHoy?: boolean}>} `imagen` = `{url, pagina, titulo, autor, licencia, fuente, nota}`
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
  let tecnico = false;
  try {
    const terminos = [...new Set((await proponerTerminos(pregunta)).filter(Boolean))].slice(0, 3);
    const probar = async (candidatas, guardar) => {
      let n = 0;
      for (const c of candidatas) {
        if (cortada()) return null;
        if (!c?.url || vistas.has(c.url)) continue;
        // Lo que acabaría publicado: una imagen de otro banco se sirve desde /imagenes/, la de Commons tal cual.
        if (!(guardar ? creditoCompleto(c) : imagenPublicable(c))) continue;
        vistas.add(c.url);
        if (++n > MAX_CANDIDATAS_POR_FUENTE) break;
        let r = null;
        try {
          r = await puntuar({ url: c.url, pregunta });
        } catch {
          r = null;
        }
        if (!r) {
          tecnico = true;
          continue;
        }
        if (!esBuena(r.nota)) continue;
        try {
          const url = guardar ? await guardarArchivo(c, pregunta) : c.url;
          return { url, pagina: c.pagina ?? null, titulo: c.titulo ?? '', autor: c.autor ?? null, licencia: c.licencia ?? null, fuente: c.fuente, nota: r.nota };
        } catch {
          tecnico = true;
        }
      }
      return null;
    };
    const buscar = async (fuente, termino) => {
      try {
        return await fuente(termino, pregunta);
      } catch {
        tecnico = true;
        return [];
      }
    };

    for (const t of terminos) {
      const c = await probar(await buscar(buscarCommons, t), false);
      if (c) return { imagen: c };
      if (cortada()) return { imagen: null };
    }
    for (const t of terminos) {
      const c = await probar(await buscar((x, p) => buscarBancos(x, p.area), t), true);
      if (c) return { imagen: c };
      if (cortada()) return { imagen: null };
    }
    if (permitirIA && !tecnico && !cortada()) {
      // Galerías agotadas de verdad. Tres salidas distintas, para que la cola sepa si hay algo que esperar:
      // esta pregunta no admite IA (política), hoy no se puede generar (cupo o proveedor) o se generó y no valió.
      if (!iaPermitida(pregunta)) return { imagen: null, iaNoAplica: true };
      if (!cupo.puede()) return { imagen: null, sinIAHoy: true };
      const g = await generarIA(pregunta);
      if (!g) return { imagen: null, sinIAHoy: true };
      const r = await puntuar({ url: g.dataUrl, pregunta });
      if (!r) tecnico = true;
      else if (iaMejoraActual(r.nota, null)) {
        const url = await g.guardar();
        return { imagen: { url, pagina: null, titulo: '', autor: CREDITO_IA.autor, licencia: CREDITO_IA.licencia, fuente: CREDITO_IA.fuente, nota: r.nota } };
      }
    }
  } catch {
    tecnico = true; // cualquier fallo de red o de modelo: la pregunta queda pendiente
  }
  return tecnico ? { imagen: null, tecnico: true } : { imagen: null };
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

  async function guardarWebp(id, webp) {
    await mkdir(carpeta, { recursive: true });
    await writeFile(path.join(carpeta, `${id}.webp`), webp);
    return `/imagenes/${id}.webp`;
  }

  const deps = {
    cupo: cupoIA,
    // Términos en inglés del modelo y, además, el enunciado (por si el banco lo describe mejor).
    async proponerTerminos(pregunta) {
      const enunciado = String(pregunta.enunciado).slice(0, 60);
      const ingles = [];
      try {
        const texto = await llamarModelo({
          mensajes: [
            { role: 'system', content: 'Propones 2 términos de búsqueda en INGLÉS (1-4 palabras) para encontrar una foto libre llamativa, a color y de primer plano sobre el tema de una pregunta de quiz. Devuelve SOLO JSON {"terminos": ["a", "b"]}.' },
            { role: 'user', content: `${pregunta.enunciado} (respuesta: ${pregunta.explicacion ?? ''})`.slice(0, 500) },
          ],
        });
        const t = extraerJson(texto)?.terminos;
        if (Array.isArray(t)) ingles.push(...t.filter((x) => typeof x === 'string').slice(0, 2));
      } catch {
        // sin modelo: se busca con el enunciado
      }
      return [...ingles, enunciado];
    },
    async buscarCommons(termino, pregunta) {
      const { paginas, error } = await buscarEnCommons(termino, fetchImpl);
      if (error && paginas.length === 0) throw new Error(error); // fallo de Commons, no «sin resultados»
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
      const bruto = await descargarAcotado(candidata.url, { fetchImpl, userAgent: USER_AGENT });
      return guardarWebp(pregunta.id, await aWebp(bruto));
    },
    // La imagen se puntúa ANTES de guardarla: `guardar()` solo se llama si entra.
    async generarIA(pregunta) {
      const prompt = await escribirPrompt(pregunta, { llamarModelo });
      const g = await generarImagen(prompt, { fetchImpl, entorno, cupo: cupoIA });
      if (!g) return null;
      const webp = await aWebp(g.buffer);
      return { dataUrl: `data:image/webp;base64,${webp.toString('base64')}`, guardar: () => guardarWebp(pregunta.id, webp) };
    },
  };

  /** `(pregunta, { permitirIA, signal }) -> { imagen, tecnico? }`; recuerda las imágenes ya descartadas. */
  return (pregunta, { permitirIA = false, signal = null } = {}) =>
    resolverImagen(pregunta, { ...deps, permitirIA, signal, descartadas: pregunta.imagenesDescartadas ?? [] });
}
