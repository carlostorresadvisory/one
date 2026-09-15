// Reparto por cuota entre los eslabones de una cascada (spec v0.2b4.1 §2).
//
// Por qué existe: una tanda de 10 con visuales gasta ~35.000 tokens y Groq da 8.000 tokens/MINUTO
// POR MODELO (spec §0). Con un solo modelo serían 4-5 minutos de espera forzada. La única forma de
// bajar de 60 s sin pagar es repartir entre modelos y proveedores -- y para repartir bien hay que
// saber a quién le queda hueco, que es justo lo que este módulo recuerda.
//
// PURO a propósito: no importa nada, no hace red ni disco, no lee `process.env`. Se alimenta SOLO
// de cabeceras que ya vienen en respuestas que alguien más pidió. Quien no manda cabeceras (Gemini,
// NVIDIA, Cerebras hoy) simplemente no tiene registro, y "sin registro" significa DISPONIBLE: este
// módulo nunca puede bloquear un eslabón del que no sabe nada.

const CABECERA_TOKENS_RESTANTES = 'x-ratelimit-remaining-tokens';
const CABECERA_PETICIONES_RESTANTES = 'x-ratelimit-remaining-requests';
const CABECERA_RESET_TOKENS = 'x-ratelimit-reset-tokens';
const CABECERA_RETRY_AFTER = 'retry-after';

/** Ventana de la cuota de tokens de Groq: 8.000 tokens por MINUTO (spec §0). */
export const VENTANA_TOKENS_MS = 60000;
/** Las peticiones/día no se recuperan hasta mañana: como "cuándo vuelve", un día entero. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;
/** Spec §2: "Estimación de tokens = longitud del prompt / 3,5 + maxTokens". */
const CARACTERES_POR_TOKEN = 3.5;

/**
 * Tokens que va a costar, más o menos, una llamada. No hace falta que sea exacto: solo decide si
 * cabe en lo que queda de la ventana del minuto, y errar por exceso es lo prudente.
 * @param {{content?: string}[]} mensajes
 * @param {number} [maxTokens] margen de salida reservado
 * @returns {number}
 */
export function estimarTokens(mensajes, maxTokens = 0) {
  const caracteres = (Array.isArray(mensajes) ? mensajes : []).reduce(
    (suma, m) => suma + (typeof m?.content === 'string' ? m.content.length : 0),
    0,
  );
  return Math.ceil(caracteres / CARACTERES_POR_TOKEN) + (Number(maxTokens) || 0);
}

/**
 * Convierte a milisegundos los formatos de duración que devuelven de verdad estas APIs:
 * `retry-after` de HTTP es un número de SEGUNDOS; Groq manda `x-ratelimit-reset-*` como `2.5s`,
 * `500ms` o `1m30s`. Lo que no se entiende devuelve `null` (nunca `NaN`, que envenenaría las
 * comparaciones de más abajo y haría que un eslabón pareciera bloqueado para siempre).
 * @param {string|null|undefined} valor
 * @returns {number|null}
 */
export function msDeCabecera(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().toLowerCase();
  if (!texto) return null;
  if (/^\d+(\.\d+)?$/.test(texto)) return Number(texto) * 1000;
  const partes = texto.match(/^(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?$/);
  if (partes && (partes[1] || partes[2])) {
    return (Number(partes[1] || 0) * 60 + Number(partes[2] || 0)) * 1000;
  }
  const enMs = texto.match(/^(\d+(?:\.\d+)?)ms$/);
  if (enMs) return Number(enMs[1]);
  return null;
}

// Una respuesta puede traer `headers` como un `Headers` real (fetch) o como un objeto plano (los
// dobles de los tests): se leen las dos formas, siempre en minúsculas (HTTP no distingue).
function leerCabecera(cabeceras, nombre) {
  if (!cabeceras) return null;
  const crudo = typeof cabeceras.get === 'function' ? cabeceras.get(nombre) : cabeceras[nombre] ?? cabeceras[nombre.toUpperCase()];
  if (crudo === undefined || crudo === null || crudo === '') return null;
  return String(crudo);
}

function numeroDeCabecera(valor) {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Registro en memoria de la cuota de cada eslabón, por su id COMPLETO de cascada
 * (`proveedor:modelo`, o el id de OpenRouter tal cual): dos modelos del mismo proveedor tienen
 * cuotas independientes (Groq: 8.000 tokens/min POR MODELO), así que la clave nunca es el proveedor.
 * En memoria a propósito, sin persistir: tras reiniciar el proceso se vuelve a "no sé nada de
 * nadie", que es el estado seguro (todos disponibles) y se recalibra solo con la primera respuesta.
 * @param {{reloj?: () => number}} [params]
 */
export function crearRegistroCuota({ reloj = () => Date.now() } = {}) {
  const porModelo = new Map();

  /** Anota lo que esta respuesta cuenta sobre la cuota de `modelo`. Nunca lanza. */
  function registrarRespuesta(modelo, respuesta) {
    const cabeceras = respuesta?.headers;
    const tokens = numeroDeCabecera(leerCabecera(cabeceras, CABECERA_TOKENS_RESTANTES));
    const peticiones = numeroDeCabecera(leerCabecera(cabeceras, CABECERA_PETICIONES_RESTANTES));
    const reset = msDeCabecera(leerCabecera(cabeceras, CABECERA_RESET_TOKENS));
    const retry = msDeCabecera(leerCabecera(cabeceras, CABECERA_RETRY_AFTER));
    const saturado = respuesta?.status === 429 || respuesta?.status === 503;

    // Sin ningún dato y sin saturación no hay nada que recordar: "sin registro" = disponible.
    if (tokens === null && peticiones === null && retry === null && !saturado) return;

    const ahora = reloj();
    const previo = porModelo.get(modelo) || {};
    porModelo.set(modelo, {
      tokensRestantesMinuto: tokens === null ? previo.tokensRestantesMinuto ?? null : tokens,
      peticionesRestantesDia: peticiones === null ? previo.peticionesRestantesDia ?? null : peticiones,
      resetTokensMs: reset === null ? previo.resetTokensMs ?? null : reset,
      medidoEn: ahora,
      // `hasta`: instante a partir del cual el eslabón vuelve a estar disponible. Solo lo fija una
      // saturación real -- una respuesta buena nunca bloquea nada, por bajos que vengan los restos.
      hasta: retry !== null ? ahora + retry : saturado ? ahora + VENTANA_TOKENS_MS : previo.hasta ?? 0,
    });
  }

  /** ¿Puede esta llamada, de `tokensEstimados`, entrar ahora mismo por este eslabón? */
  function hayHueco(modelo, tokensEstimados = 0) {
    const info = porModelo.get(modelo);
    if (!info) return true; // sin datos = disponible (spec §2)
    const ahora = reloj();
    if (info.hasta > ahora) return false;
    if (info.peticionesRestantesDia !== null && info.peticionesRestantesDia <= 0) return false;
    if (info.tokensRestantesMinuto === null) return true;
    // La cuota de tokens es por minuto: pasada la ventana desde la medición, se da por repuesta.
    if (ahora - info.medidoEn >= VENTANA_TOKENS_MS) return true;
    return info.tokensRestantesMinuto >= tokensEstimados;
  }

  /** Cuánto falta (ms) para que este eslabón vuelva a estar disponible. 0 si ya lo está. */
  function disponibleEnMs(modelo) {
    const info = porModelo.get(modelo);
    if (!info) return 0;
    const ahora = reloj();
    if (info.peticionesRestantesDia !== null && info.peticionesRestantesDia <= 0) return UN_DIA_MS;
    const porEspera = Math.max(0, info.hasta - ahora);
    const porVentana =
      info.tokensRestantesMinuto === null
        ? 0
        : Math.max(0, info.medidoEn + (info.resetTokensMs ?? VENTANA_TOKENS_MS) - ahora);
    return Math.max(porEspera, porVentana);
  }

  function olvidar() {
    porModelo.clear();
  }

  /**
   * Qué eslabón de `cascada` conviene probar AHORA para una llamada de `tokensEstimados`.
   * Regla de la spec §2: el primero con hueco (o del que no se sepa nada); si ninguno tiene hueco,
   * el que antes se recupere -- mejor esperar 8 s al segundo que 40 s al primero. El orden de la
   * cascada sigue mandando: solo se rompe cuando hay un motivo medido para romperlo.
   * @param {string[]} cascada
   * @param {number} [tokensEstimados]
   * @returns {string|null} `null` solo si la cascada viene vacía
   */
  function elegirModelo(cascada, tokensEstimados = 0) {
    const lista = Array.isArray(cascada) ? cascada : [];
    if (lista.length === 0) return null;
    const conHueco = lista.find((m) => hayHueco(m, tokensEstimados));
    if (conHueco) return conHueco;
    // `sort` es estable en Node, así que un empate conserva el orden de la cascada.
    return [...lista].sort((a, b) => disponibleEnMs(a) - disponibleEnMs(b))[0];
  }

  return { registrarRespuesta, hayHueco, disponibleEnMs, elegirModelo, olvidar };
}

/**
 * Registro que usa `tools/openrouter.js#llamar` por defecto: uno por proceso, así todas las
 * llamadas de una misma tanda comparten lo aprendido (que es justamente lo que hace útil el
 * reparto: el lote 2 ya sabe lo que el lote 1 gastó). Inyectable como opción `cuota` de `llamar`
 * para que cada test tenga el suyo y no se contaminen entre sí.
 */
export const cuotaGlobal = crearRegistroCuota();
