// Nota de calidad de una imagen (spec v0.3 §7): un modelo gratis con visión puntúa de 1 a 5 si la
// imagen "engancha" y encaja con la pregunta sin revelar la respuesta. Por debajo de 4 no vale.
// Datos públicos (imágenes con licencia libre y preguntas de cultura general): se pueden mandar a
// modelos gratis. Nunca lee ni imprime claves.
import { llamar, extraerJson } from './openrouter.js';
import { descargarAcotado } from '../servidor/politica-imagen.js';

const USER_AGENT = 'ONE-app/0.3 (aprendizaje personal; contacto via GitHub)';

// Primero Gemini gratis (clave propia en .env, acepta la imagen en base64), luego los ':free' de
// OpenRouter con visión (catálogo del 6-oct; ver tools/buscar-imagenes.js para los descartados).
export const MODELOS_VISION = [
  'gemini:gemini-flash-lite-latest',
  'gemini:gemini-3.6-flash',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

// Respaldo de pago ultrabarato (~0,0002 EUR por imagen; 13-oct-2026: los cuatro gratis dan 429 y el juez caído
// dejaba el relleno de imágenes parado). SOLO se añade a la cascada con `permitirPago` y `llamar` lo frena
// con `topeEur` contra `rutaLog` (el mismo contador diario que la generación del servidor).
export const MODELO_VISION_PAGO = 'google/gemini-2.5-flash-lite';

export const PROMPT_NOTA =
  'Puntúas de 1 a 5 una imagen para ilustrar la pregunta de un quiz. Criterio: 5 = la imagen engancha ' +
  'al ojo (protagonista claro, mucho color, encuadre cercano) y tiene que ver con la pregunta; ' +
  '4 = buena; 3 = correcta pero sosa; 2 = mapa descolorido, documento escaneado, foto pequeña o borrosa, ' +
  'esquema; 1 = irrelevante o inservible. Importa que la imagen NO revele la respuesta (texto, ' +
  'rótulos o etiqueta que la digan = nota 1-2). Nota MÁXIMA 2 para: capturas de pantalla o de una web, ' +
  'imágenes con texto, rótulos o logotipos protagonistas, y toda imagen que MUESTRE la respuesta ' +
  '(si la pregunta pide identificar una obra, persona, lugar u objeto y la imagen es justo eso). ' +
  'Sé exigente: ante la duda, una nota menos. Responde SOLO JSON: {"nota": 1-5, "motivo": "frase corta"}.';

export function esBuena(nota) {
  return Number.isFinite(nota) && nota >= 4;
}

export function parsearNota(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  let nota = null;
  let motivo = '';
  try {
    const datos = extraerJson(texto);
    if (datos && typeof datos === 'object') {
      nota = Number(datos.nota);
      motivo = typeof datos.motivo === 'string' ? datos.motivo : '';
    }
  } catch {
    const m = texto.match(/nota\D{0,5}([1-5])\b/i);
    if (m) {
      nota = Number(m[1]);
      motivo = texto.replace(m[0], '').trim().slice(0, 200);
    }
  }
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return null;
  return { nota, motivo };
}

function textoPregunta(pregunta) {
  if (typeof pregunta === 'string') return pregunta;
  const p = pregunta ?? {};
  return [p.enunciado ? `Enunciado: ${p.enunciado}` : '', p.explicacion ? `Respuesta (que la imagen NO debe revelar): ${p.explicacion}` : '']
    .filter(Boolean)
    .join('\n');
}

function tipoPorBytes(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

// Llamada real a un único modelo. Gemini no baja imágenes por URL: se le manda en base64.
async function llamarModeloReal({ modelo, mensajes, permitirPago = false, topeEur = 0, rutaLog = null }) {
  let enviados = mensajes;
  if (modelo.startsWith('gemini:')) {
    enviados = await Promise.all(
      mensajes.map(async (m) => {
        if (!Array.isArray(m.content)) return m;
        const content = await Promise.all(
          m.content.map(async (parte) => {
            if (parte.type !== 'image_url' || parte.image_url.url.startsWith('data:')) return parte;
            const buf = await descargarAcotado(parte.image_url.url, { userAgent: USER_AGENT, timeoutMs: 40000 });
            const tipo = tipoPorBytes(buf);
            return { type: 'image_url', image_url: { url: `data:${tipo};base64,${buf.toString('base64')}` } };
          }),
        );
        return { ...m, content };
      }),
    );
  }
  const salida = await llamar({
    modelos: [modelo],
    mensajes: enviados,
    json: false,
    temperatura: 0.2,
    maxTokens: 400,
    extra: { reasoning: { enabled: false, exclude: true } },
    timeoutMs: 60000,
    reintentoMs: 1500,
    permitirPago,
    topeEur,
    ...(rutaLog ? { rutaLog } : {}),
  });
  return salida.texto;
}

// Mensaje de error apto para el log: una línea corta y sin claves (por si algún proveedor las eco en la URL).
function motivoBreve(err) {
  return String(err?.message || err).replace(/(key|token)=[^&\s]+/gi, '$1=***').replace(/Bearer\s+\S+/gi, 'Bearer ***').replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * `{ url, pregunta }` -> `{ nota, motivo, modelo } | null` (null = ningún modelo supo puntuarla).
 * Con `permitirPago` (y `topeEur` > 0) la cascada termina en `MODELO_VISION_PAGO`; sin ello no se llama nunca a un
 * modelo de pago. `topeEur` y `rutaLog` viajan a `llamar`, que cuenta el gasto del día en ese log.
 */
export async function puntuarImagen(
  { url, pregunta },
  { llamarModelo = llamarModeloReal, modelos = MODELOS_VISION, permitirPago = false, topeEur = 0, rutaLog = null } = {},
) {
  const mensajes = [
    { role: 'system', content: PROMPT_NOTA },
    { role: 'user', content: [{ type: 'text', text: textoPregunta(pregunta) }, { type: 'image_url', image_url: { url } }] },
  ];
  const cascada = permitirPago && topeEur > 0 && !modelos.includes(MODELO_VISION_PAGO) ? [...modelos, MODELO_VISION_PAGO] : modelos;
  for (const modelo of cascada) {
    try {
      const nota = parsearNota(await llamarModelo({ modelo, mensajes, permitirPago, topeEur, rutaLog }));
      if (nota) return { ...nota, modelo };
      console.error(`nota-imagen: ${modelo} respondió algo que no es una nota`);
    } catch (err) {
      // el modelo falló o está saturado: se prueba con el siguiente (queda dicho por qué, sin claves)
      console.error(`nota-imagen: ${modelo} falló: ${motivoBreve(err)}`);
    }
  }
  return null;
}
