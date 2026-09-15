// Cola única de generación del servidor (Tarea 2 del plan v0.2b1-servidor).
// Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.1-§3.3.
//
// "Cola única en proceso: un solo trabajador consume la cola de generación en serie y es el único
// que escribe en disco (cerrojo en código, lección de los dos --aplicar)" (spec §3.1). Este fichero
// implementa ese cerrojo con un flag booleano (`procesando`) + un único bucle asíncrono
// (`procesarCola`) que va tomando trabajos uno a uno -- nunca hay dos llamadas a `producirTanda` en
// vuelo a la vez, ni dos escrituras al colchón solapadas.
//
// `producirTanda` se recibe INYECTADO (parámetro de `crearCola`), igual que en servidor/generacion.js
// -- así los tests no hacen red ni llaman a ningún modelo real. Este fichero no importa
// tools/openrouter.js ni lee OPENROUTER_API_KEY en ningún momento.
import { AREAS } from '../tools/validar-banco.js';

const TAMANO_LOTE = 5;
const PEDIDAS_DEFECTO = 10;
const OBJETIVO_TOTAL_COLCHON = 30;
const PARTE_AREAS = Math.round(OBJETIVO_TOTAL_COLCHON * 0.6); // 18 (60 %)
const PARTE_RUTAS = OBJETIVO_TOTAL_COLCHON - PARTE_AREAS; // 12 (40 %)
const MUESTRAS_SEG_POR_PREGUNTA = 5; // "las últimas 5 tandas" (spec v0.2b4 §6c)
const SEG_POR_PREGUNTA_INICIAL = 20; // arranque en frío, antes de haber medido ninguna
const RETENCION_TERMINADOS_MS = 60 * 60 * 1000; // spec v0.2b4 §1: al menos 1 h
const TERMINADOS_MAX = 500; // tope duro de memoria; solo entra en juego con 500 tandas en una hora
const UN_MES_MS = 30 * 24 * 60 * 60 * 1000;
const TOPE_COLCHON = 2000;
const TOPE_COLA_FONDO = 32; // Ronda 2 (revisión), punto 3 (Minor): las nuevas se descartan si está llena.
const CERROJO_COLCHON = 'colchon.json';
// v0.2b4.1 §5: cuántas preguntas se intentan completar en UNA pasada del trabajo de fondo. Un tope
// bajo a propósito -- procesarCola lo llama cada vez que se queda sin trabajos (potencialmente muy
// seguido), y cada visual es una llamada de red de segundos; no tiene sentido intentar de golpe
// todo lo que haya pendiente en el colchón.
const MAX_VISUALES_PENDIENTES_POR_PASADA = 10;

// Ronda final (revisión, 14-sep-2026) -- Menor (M4, segunda mitad): lo que `servir()` devuelve a
// quien llamó (la API, y a través de ella el móvil) nunca lleva los campos de gestión interna del
// colchón -- `origen`/`creada`/`ruta`/`servida` son cosa de este módulo, no del cliente. Duplicado
// a propósito de servidor/generacion.js#CAMPOS_CONTENIDO_PREGUNTA (más `id`/`area`/`tipo`/
// `confianza`, que ahí se ponen aparte): cola.js no debe depender del módulo de generación, es
// logística de cola/almacén, no del pipeline de contenido.
const CAMPOS_PUBLICOS_PREGUNTA = [
  'id',
  'area',
  'tipo',
  'nivel',
  'enunciado',
  'explicacion',
  'opciones',
  'correcta',
  'respuesta',
  'items',
  'criterio',
  'hilo',
  'visual',
  // v0.2b4.1 §5: "esta pregunta todavía no tiene su visual, pero lo tendrá". El cliente lo usa
  // para no dar por definitiva una tarjeta sin visual (y para saber que merece la pena volver a
  // preguntar). `actualizadaEn` NO entra aquí: es logística del colchón, como `creada`/`servida`.
  'visualPendiente',
  'tarjeta',
  'sospechoso',
  'confianza',
];

function paraCliente(pregunta) {
  const limpio = {};
  for (const campo of CAMPOS_PUBLICOS_PREGUNTA) {
    if (pregunta[campo] !== undefined) limpio[campo] = pregunta[campo];
  }
  return limpio;
}

function mismaRuta(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((valor, i) => valor === b[i]);
}

function generarIdTrabajo(contador) {
  return `t-${Date.now().toString(36)}-${contador}`;
}

// Reparte `total` en `n` enteros no negativos que suman exactamente `total`, lo más igualado
// posible (los primeros `resto` reciben una unidad de más). No hay una única forma "correcta" de
// redondear un reparto no exacto -- esta es una decisión del implementador, sin más exigencia de la
// spec que "reparte 60/40 y no pide lo que ya hay".
function repartirEntero(total, n) {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  let resto = total - base * n;
  const partes = new Array(n).fill(base);
  for (let i = 0; i < n && resto > 0; i++, resto--) partes[i] += 1;
  return partes;
}

// Purga de colchon.json (spec §3.3, decisión del controlador para servir()): "las servidas se
// conservan (para evitar y estadísticas), pero pasado un mes se purgan (tope 2.000 entradas)".
// Solo se purgan entradas SERVIDAS (una no servida es trabajo pendiente real, nunca se descarta
// aquí); si tras quitar las de más de un mes se sigue por encima del tope, se quitan las servidas
// más antiguas hasta bajar a 2.000.
function purgarColchon(lista) {
  const ahora = Date.now();
  let filtrada = lista.filter((p) => {
    if (!p.servida) return true;
    const edadMs = ahora - new Date(p.servida).getTime();
    return !(Number.isFinite(edadMs) && edadMs >= UN_MES_MS);
  });

  if (filtrada.length > TOPE_COLCHON) {
    const servidas = filtrada
      .filter((p) => p.servida)
      .sort((a, b) => new Date(a.servida).getTime() - new Date(b.servida).getTime());
    const exceso = filtrada.length - TOPE_COLCHON;
    const idsAQuitar = new Set(servidas.slice(0, Math.min(exceso, servidas.length)).map((p) => p.id));
    if (idsAQuitar.size > 0) {
      filtrada = filtrada.filter((p) => !idsAQuitar.has(p.id));
    }
  }

  return filtrada;
}

/**
 * Cola única de generación en proceso. `producirTanda` se inyecta (misma firma que
 * servidor/generacion.js#producirTanda) para que los tests usen una falsa sin red.
 * @param {object} params
 * @param {ReturnType<import('./almacen.js').crearAlmacen>} params.almacen
 * @param {Function} params.producirTanda
 * @param {Function} [params.completarVisual] v0.2b4.1 §5: misma firma que
 *   servidor/generacion.js#completarVisual. Opcional -- sin ella, `completarVisualesPendientes` es
 *   un no-op (ver más abajo); así los tests que no necesitan el trabajo de fondo no tienen que
 *   inyectarla.
 * @param {object} [params.opciones] opciones base pasadas a producirTanda en cada lote (llamar,
 *   permitirPago, topeEur, rutaLog); `urgente` se añade/sobrescribe por trabajo.
 */
export function crearCola({ almacen, producirTanda, completarVisual = null, opciones = {}, reloj = () => Date.now() } = {}) {
  if (!almacen) throw new Error('crearCola: falta almacen');
  if (typeof producirTanda !== 'function') throw new Error('crearCola: falta producirTanda');

  const colaUrgente = [];
  const colaFondo = [];
  const registro = new Map(); // trabajos en-cola o en curso, por id
  const terminados = new Map(); // últimos 100 trabajos terminados, por id (no se persisten)
  // v0.2b4 §6c: media móvil de segundos por pregunta. En memoria a propósito (no se persiste): tras
  // reiniciar el servidor se vuelve al valor inicial y se recalibra sola con la primera tanda.
  const muestrasSegPorPregunta = [];
  let activo = null;
  let procesando = false;
  let contadorId = 0;
  // v0.2b4.1 §5: cerrojo propio (booleano, igual patrón que `procesando`) para que dos disparos de
  // completarVisualesPendientes -- uno desde procesarCola al vaciarse, otro desde POST /estado -- no
  // se solapen pidiendo el mismo visual pendiente dos veces a la vez.
  let completandoVisuales = false;
  // Ronda final (revisión, 14-sep-2026) -- Critical (C2): señal de salud del trabajador, para que
  // /salud pueda decir algo más que "el proceso sigue vivo". `ultimoError` es el motivo (corto, sin
  // trazas) del último lote que falló de cualquier forma; `ultimaGeneracionOk` es el ISO del último
  // lote que terminó sin fallo. Ambas se actualizan en `ejecutarUnLote`, se leen en `estadisticas()`.
  let ultimoError = null;
  let ultimaGeneracionOk = null;

  function todosLosPendientesOArea(area, ruta) {
    // Para rellenarHaciaObjetivo: ¿ya hay un trabajo de fondo en cola (o en curso) para esta misma
    // área/ruta? No se duplica trabajo ya pedido.
    const enListas = [...colaFondo, ...colaUrgente, ...(activo ? [activo] : [])];
    return enListas.some((t) => !t.urgente && t.area === area && mismaRuta(t.ruta, ruta));
  }

  function calcularPosicion(trabajo) {
    let delante = activo ? 1 : 0;
    if (trabajo.urgente) {
      delante += colaUrgente.indexOf(trabajo);
    } else {
      delante += colaUrgente.length + colaFondo.indexOf(trabajo);
    }
    return delante;
  }

  function segundosPorPregunta() {
    if (muestrasSegPorPregunta.length === 0) return SEG_POR_PREGUNTA_INICIAL;
    const suma = muestrasSegPorPregunta.reduce((a, b) => a + b, 0);
    return Math.max(1, Math.round(suma / muestrasSegPorPregunta.length));
  }

  /** Preguntas que hay POR DELANTE de `trabajo` (incluido lo que le queda al activo): eso, y no
   * "cuántos trabajos hay en cola", es lo que determina cuánto va a esperar quien acaba de pedir. */
  function preguntasPorDelante(trabajo) {
    const pendientesDe = (t) => Math.max(0, t.pedidas - t.hechas);
    let total = activo && activo !== trabajo ? pendientesDe(activo) : 0;
    // Ola final v0.2b4 (M9): `indexOf` puede devolver -1 (el trabajo ya no está en su cola: es el
    // activo, o terminó entre medias) y `slice(0, -1)` no es "nada por delante", es TODA la cola
    // menos el último -- justo lo contrario. Hoy solo se llama justo después de encolar, así que
    // no se ve; la guarda evita que un cambio futuro lo convierta en una estimación absurda.
    const posicion = trabajo.urgente ? colaUrgente.indexOf(trabajo) : colaFondo.indexOf(trabajo);
    const hasta = posicion >= 0 ? posicion : 0;
    const antes = trabajo.urgente
      ? colaUrgente.slice(0, hasta)
      : [...colaUrgente, ...colaFondo.slice(0, hasta)];
    for (const t of antes) total += pendientesDe(t);
    return total;
  }

  function tomarSiguiente() {
    if (colaUrgente.length > 0) return colaUrgente.shift();
    if (colaFondo.length > 0) return colaFondo.shift();
    return null;
  }

  function guardarTerminado(trabajo) {
    registro.delete(trabajo.id);
    trabajo.terminadoEn = reloj();
    terminados.set(trabajo.id, trabajo);
    purgarTerminados();
  }

  /** v0.2b4 §1: un terminado se conserva AL MENOS 1 h. Antes se tiraba el más antiguo en cuanto
   * había 100, así que un móvil que reabriera la app y retomara el sondeo de su tanda guardada
   * (`one.atomoTrabajo`) podía comerse un 404 con el servidor perfectamente vivo. Solo se descarta
   * lo que ya pasó la hora; el tope duro es la red de seguridad contra un crecimiento sin límite. */
  function purgarTerminados() {
    const ahora = reloj();
    for (const [id, t] of terminados) {
      if (ahora - t.terminadoEn >= RETENCION_TERMINADOS_MS) terminados.delete(id);
    }
    while (terminados.size > TERMINADOS_MAX) {
      terminados.delete(terminados.keys().next().value);
    }
  }

  async function calcularEvitar(area) {
    const colchon = await almacen.leerColchon();
    return colchon
      .filter((p) => p.area === area)
      .slice(-50)
      .map((p) => p.enunciado)
      .filter(Boolean);
  }

  function aColchon(pregunta, trabajo) {
    return {
      ...pregunta,
      origen: 'servidor',
      ruta: [trabajo.area, ...(trabajo.ruta || [])],
      creada: new Date().toISOString(),
      servida: null,
    };
  }

  // Ronda 2 (revisión), punto 1 -- Critical: leer->modificar->escribir de colchon.json envuelto
  // ENTERO en `almacen.conCerrojo('colchon.json', ...)`, igual que servir()/reportar() más abajo.
  // Antes esto podía intercalarse con esos dos (o con otra llamada a guardarNuevasEnColchon si
  // algún día hubiera más de un trabajador) y perder aprobadas por un "lost update" clásico.
  async function guardarNuevasEnColchon(nuevas) {
    if (nuevas.length === 0) return;
    await almacen.conCerrojo(CERROJO_COLCHON, async () => {
      const colchon = await almacen.leerColchon();
      await almacen.guardarColchon(purgarColchon(colchon.concat(nuevas)));
    });
  }

  // Ronda final (I4): una línea JSON por lote en servidor.log, con lo justo para auditar qué se
  // generó sin volcar nada confidencial (nunca prompts, nunca claves -- solo cifras e ids/nombres
  // de modelo, que ya se ven igual en llamadas.log). Un fallo al escribir este log NUNCA debe tumbar
  // la generación: se traga con un único console.error, igual criterio que C1 en tools/openrouter.js.
  async function registrarLoteEnLog(trabajo, tamanoLote, resultado) {
    await almacen.anadirLineaLog('servidor.log', {
      fecha: new Date().toISOString(),
      trabajoId: trabajo.id,
      area: trabajo.area,
      ruta: trabajo.ruta,
      pedidas: tamanoLote,
      aprobadas: resultado.aprobadas?.length || 0,
      rechazadas: resultado.rechazadas?.length || 0,
      fallos: resultado.fallos || [],
      coste: resultado.coste || 0,
      modelos: resultado.modelos || [],
    });
  }

  // Ejecuta UN SOLO lote del trabajo (no el trabajo completo -- Ronda 1, ver más abajo). Deja
  // `trabajo.hechas`/`trabajo.preguntas`/`trabajo.huboFallo`/`trabajo.motivo` al día; NO toca
  // `trabajo.estado` (eso lo decide procesarCola justo después, según si el trabajo cede el turno
  // o no).
  //
  // Ronda 2 (revisión), punto 2 -- Critical: el try/catch original solo cubría la llamada a
  // `producirTanda`. Un fallo de disco (p.ej. EACCES) en `calcularEvitar` (lee colchon.json) o en
  // `guardarNuevasEnColchon` (lee+escribe colchon.json) escapaba de esta función, de
  // `procesarCola` y acababa en un `unhandledRejection` sin nadie que lo capturase -- podía tumbar
  // el proceso entero. Ahora TODO el cuerpo del lote va dentro de un único try/catch: cualquier
  // excepción (de `producirTanda` o de disco) se trata igual, marca `huboFallo` + `motivo` y el
  // lote se cuenta como "consumido" hacia `pedidas` en el `finally` (evita bucles infinitos, y
  // garantiza que `hechas` avanza pase lo que pase, sea cual sea el punto exacto del fallo).
  async function ejecutarUnLote(trabajo) {
    const tamanoLote = Math.min(TAMANO_LOTE, trabajo.pedidas - trabajo.hechas);
    // v0.2b4.1 §6: `hechas` al empezar el lote. El progreso DENTRO del lote se pinta sobre esta
    // base y el `finally` la cierra sumando el lote entero -- así el indicador puede enseñar
    // 1..10 sin que un fallo a mitad deje el contador a medias y el trabajo reintentando siempre
    // el mismo lote (que es justo lo que garantizaba el `hechas += tamanoLote` de antes).
    const hechasAlEmpezar = trabajo.hechas;
    // Ronda de corrección 1 (revisión Opus, Important #2): tiempo de PARED de ESTE lote en
    // concreto, no de punta a punta del trabajo -- un trabajo de fondo que cede el turno (ver
    // procesarCola) puede pasar minutos aparcado en colaFondo mientras otro trabajo ocupa al
    // trabajador; ese tiempo aparcado NUNCA debe contar como "tiempo de generar" en la media móvil
    // de §6c. Se acumula en `trabajo.msActivos` (finally, debajo) y es lo único que usa
    // finalizarTrabajo para calcular la muestra.
    const inicioLote = reloj();
    // Ronda final (C2): resultado de ESTE lote en concreto (no de `trabajo.huboFallo`, que puede
    // venir ya en `true` de un lote anterior del mismo trabajo) -- es lo que alimenta
    // `ultimoError`/`ultimaGeneracionOk` al final, en el `finally`.
    let falloEsteLote = null;
    try {
      const evitar = await calcularEvitar(trabajo.area);

      let resultado = null;
      try {
        resultado = await producirTanda(
          { area: trabajo.area, ruta: trabajo.ruta, n: tamanoLote, evitar },
          {
            ...opciones,
            urgente: trabajo.urgente,
            onProgreso: ({ verificadas }) => {
              const dentroDelLote = Math.min(Math.max(0, verificadas), tamanoLote);
              trabajo.hechas = Math.min(hechasAlEmpezar + dentroDelLote, trabajo.pedidas);
            },
          },
        );
      } catch (err) {
        trabajo.huboFallo = true;
        trabajo.motivo = err?.message || 'producirTanda falló';
        falloEsteLote = trabajo.motivo;
      }

      if (resultado) {
        if (resultado.fallos && resultado.fallos.length > 0) {
          trabajo.huboFallo = true;
          falloEsteLote = falloEsteLote || resultado.fallos.map((f) => `${f.tipo}: ${f.motivo}`).join('; ');
        }
        if (resultado.aprobadas && resultado.aprobadas.length > 0) {
          const guardadas = resultado.aprobadas.map((p) => aColchon(p, trabajo));
          // Solo se añaden a `trabajo.preguntas` (lo que ve estadoTrabajo) DESPUÉS de guardarlas
          // de verdad: si `guardarNuevasEnColchon` lanza, no se cuentan como aprobadas -- el
          // estado en memoria no debe adelantarse a lo que hay realmente en disco.
          await guardarNuevasEnColchon(guardadas);
          trabajo.preguntas = trabajo.preguntas.concat(guardadas);
        }

        // Ronda final (I4): trazabilidad -- las rechazadas de este lote en rechazadas.json (propio
        // cerrojo, igual mecanismo que colchon.json pero por su propio nombre de fichero: son
        // ficheros distintos, el mutex de almacen.conCerrojo es por nombre) y una línea JSON en
        // servidor.log (fecha, trabajoId, area, ruta, pedidas/aprobadas/rechazadas/fallos, coste,
        // modelos -- nunca prompts ni claves). Solo si el lote llegó a producir un `resultado` de
        // verdad (si `producirTanda` lanzó, no hay nada que registrar más allá de `falloEsteLote`).
        if (resultado.rechazadas && resultado.rechazadas.length > 0) {
          await almacen.conCerrojo('rechazadas.json', () => almacen.anadirRechazadas(resultado.rechazadas));
        }
        await registrarLoteEnLog(trabajo, tamanoLote, resultado);
      }
    } catch (err) {
      // Cualquier fallo de disco (leer o guardar colchon.json) fuera de producirTanda: antes esto
      // escapaba de ejecutarUnLote entero y, sin capturar, tumbaba al trabajador (ver arriba).
      trabajo.huboFallo = true;
      trabajo.motivo = err?.message || 'fallo de disco en este lote';
      falloEsteLote = trabajo.motivo;
    } finally {
      // Sin más `await` de este lote a partir de aquí: `hechas` cambia en el mismo tramo síncrono
      // en el que procesarCola decide el `estado` que sigue. Antes `hechas` se actualizaba ANTES
      // de guardar en disco y `estado` DESPUÉS del guardado -- un observador externo
      // (estadoTrabajo) podía ver `hechas` ya al día pero `estado` todavía con el valor del lote
      // anterior (condición de carrera real de la ronda de estabilidad anterior). El `finally`
      // además garantiza que `hechas` avanza SIEMPRE, incluso si el `try` lanzó antes de llegar
      // aquí -- nunca se queda un trabajo colgado reintentando el mismo lote para siempre.
      //
      // El lote se cuenta SIEMPRE entero, haya ido bien o mal: es lo que evita que un trabajo se
      // quede reintentando el mismo lote para siempre. `onProgreso` solo puede adelantar el
      // contador dentro de este mismo tramo, nunca pasarse ni quedarse corto al cerrar.
      trabajo.hechas = Math.min(hechasAlEmpezar + tamanoLote, trabajo.pedidas);
      // Solo el tiempo de ESTE lote (desde que el trabajador lo cogió hasta que lo suelta), nunca
      // el tiempo aparcado entre cesiones -- ver comentario de `inicioLote` arriba.
      trabajo.msActivos = (trabajo.msActivos || 0) + (reloj() - inicioLote);
      if (falloEsteLote) {
        ultimoError = String(falloEsteLote).slice(0, 300);
      } else {
        ultimaGeneracionOk = new Date().toISOString();
      }
    }
  }

  function finalizarTrabajo(trabajo) {
    trabajo.estado = trabajo.preguntas.length > 0 ? (trabajo.huboFallo ? 'parcial' : 'lista') : 'fallida';
    // v0.2b4 §6c: media móvil de segundos por pregunta. Solo cuentan las tandas que de verdad
    // produjeron algo: una 'fallida' mide el tiempo de un fallo (429 en cadena, red caída), no el de
    // generar, y contaminaría la estimación. Ronda de corrección 1: usa `msActivos` (tiempo activo
    // acumulado lote a lote, ver ejecutarUnLote), NUNCA el tiempo de pared desde que el trabajo
    // arrancó -- un trabajo que cedió el turno pasó parte de ese tiempo aparcado, no generando.
    if (trabajo.preguntas.length > 0 && Number.isFinite(trabajo.msActivos) && trabajo.hechas > 0) {
      const seg = trabajo.msActivos / 1000 / trabajo.hechas;
      if (seg > 0) {
        muestrasSegPorPregunta.push(seg);
        if (muestrasSegPorPregunta.length > MUESTRAS_SEG_POR_PREGUNTA) muestrasSegPorPregunta.shift();
      }
    }
  }

  /**
   * v0.2b4.1 §5: el trabajo de fondo que completa los visuales que la tanda urgente no esperó.
   * Es lo último que hace el trabajador (ver procesarCola, debajo): nunca compite con una tanda
   * que el jugador está esperando. Cada pregunta completada queda marcada con `actualizadaEn` para
   * que `POST /estado` pueda contársela al móvil que ya tiene esa pregunta (ver `actualizadas`).
   * Sin `completarVisual` inyectado (crearCola sin esa opción) es un no-op: así los tests que no
   * necesitan el trabajo de fondo no tienen que simularla.
   * @param {{max?: number}} [params]
   * @returns {Promise<{completadas: number, pendientes: number}>}
   */
  async function completarVisualesPendientes({ max = MAX_VISUALES_PENDIENTES_POR_PASADA } = {}) {
    if (typeof completarVisual !== 'function' || completandoVisuales) return { completadas: 0, pendientes: 0 };
    completandoVisuales = true;
    try {
      const colchon = await almacen.leerColchon();
      const pendientes = colchon.filter((p) => p.visualPendiente === true);
      if (pendientes.length === 0) return { completadas: 0, pendientes: 0 };

      // Se resuelven FUERA del cerrojo (son llamadas a modelos, de segundos a minutos: tener el
      // colchón bloqueado ese rato pararía servir() y el guardado de cualquier lote en curso) y
      // después se aplica el cambio dentro del cerrojo, releyendo -- el colchón puede haber
      // cambiado mientras tanto (una tanda nueva, un reportar...).
      const elegidas = pendientes.slice(0, Math.max(0, max));
      const resueltas = new Map();
      for (const pregunta of elegidas) {
        try {
          const salida = await completarVisual(pregunta, opciones);
          if (salida && salida.visual) resueltas.set(pregunta.id, salida.visual);
        } catch (err) {
          // Igual criterio que ejecutarUnLote: un fallo aquí nunca puede tumbar al trabajador.
          ultimoError = String(err?.message || err).slice(0, 300);
        }
      }
      if (resueltas.size === 0) return { completadas: 0, pendientes: pendientes.length };

      await almacen.conCerrojo(CERROJO_COLCHON, async () => {
        const actual = await almacen.leerColchon();
        const ahora = new Date().toISOString();
        const actualizado = actual.map((p) =>
          resueltas.has(p.id) && p.visualPendiente === true
            ? { ...p, visual: resueltas.get(p.id), visualPendiente: false, actualizadaEn: ahora }
            : p,
        );
        await almacen.guardarColchon(purgarColchon(actualizado));
      });

      return { completadas: resueltas.size, pendientes: pendientes.length - resueltas.size };
    } finally {
      completandoVisuales = false;
    }
  }

  // Ronda 1 (ruling del controlador, 14-sep-2026): "un usuario esperando 40 s no puede quedarse
  // detrás" de un trabajo de fondo que tarda varios minutos. El trabajador ya no ejecuta un
  // trabajo hasta el final antes de mirar la cola otra vez -- mira DESPUÉS DE CADA LOTE. Si el
  // trabajo que acaba de correr es de fondo, le quedan lotes y hay algún urgente esperando, cede
  // el turno: vuelve a la cola conservando su progreso (`hechas`, aprobadas ya guardadas; estado
  // `parcial` si ya tiene aprobadas, `en-cola` si todavía no tiene ninguna) y se pone al frente de
  // `colaFondo` (para retomar antes que un trabajo de fondo que nunca ha empezado). Un urgente
  // NUNCA cede (la condición de ceder exige `!trabajo.urgente`): una vez elegido, corre todos sus
  // lotes seguidos sin que otro urgente que llegue después lo adelante -- se pone al frente de
  // `colaUrgente` al continuar, así el siguiente `tomarSiguiente()` lo vuelve a coger a él antes
  // que a cualquier urgente más reciente (FIFO real entre urgentes). Sigue habiendo un solo
  // trabajo activo a la vez (concurrencia 1): `tomarSiguiente()`/`activo` no cambian de sitio.
  async function procesarCola() {
    let siguiente;
    // eslint-disable-next-line no-cond-assign
    while ((siguiente = tomarSiguiente())) {
      activo = siguiente;
      // 'generando' solo la primera vez que el trabajo corre (todavía sin ninguna aprobada). Si
      // retoma tras ceder con >=1 aprobada, su estado ya es 'parcial' y se queda así -- no vuelve
      // a 'generando' (mismo principio que ya regía antes de esta ronda: en cuanto hay resultados
      // parciales, se muestran hasta el final).
      if (siguiente.preguntas.length === 0) {
        siguiente.estado = 'generando';
      }

      // Ronda 2 (revisión), punto 2: `activo` se libera SIEMPRE en un `finally`, aunque
      // ejecutarUnLote ya no debería lanzar nunca (lo captura todo internamente) -- defensa en
      // profundidad, tal como pidió la revisión, por si un fallo futuro se cuela de todos modos.
      try {
        await ejecutarUnLote(siguiente);
      } finally {
        activo = null;
      }

      if (siguiente.hechas >= siguiente.pedidas) {
        finalizarTrabajo(siguiente);
        guardarTerminado(siguiente);
        continue;
      }

      const debeCeder = !siguiente.urgente && colaUrgente.length > 0;
      if (debeCeder) {
        siguiente.estado = siguiente.preguntas.length > 0 ? 'parcial' : 'en-cola';
        colaFondo.unshift(siguiente);
      } else {
        siguiente.estado = siguiente.preguntas.length > 0 ? 'parcial' : 'generando';
        if (siguiente.urgente) colaUrgente.unshift(siguiente);
        else colaFondo.unshift(siguiente);
      }
    }

    // El trabajador se ha quedado sin trabajos: es el momento exacto de completar visuales
    // pendientes -- lo más bajo de la escala de prioridad, detrás de todo urgente y de todo fondo.
    await completarVisualesPendientes().catch((err) => {
      console.error(`servidor/cola: fallo al completar visuales pendientes: ${err?.message || err}`);
    });
  }

  // Ronda 2 (revisión), punto 2: si, pese a todo, `procesarCola` llegara a rechazar (defensa en
  // profundidad: hoy ejecutarUnLote ya no deja escapar nada), este `.catch` evita el
  // `unhandledRejection` que antes podía tumbar el proceso -- se anota con `console.error` (nunca
  // trazas de prompts/respuestas, solo el mensaje) y `procesando` se libera igual en el `finally`
  // de debajo, así el trabajador queda listo para que el siguiente `encolar()` lo relance.
  function dispararProcesamiento() {
    if (procesando) return;
    procesando = true;
    procesarCola()
      .catch((err) => {
        console.error(`servidor/cola: el trabajador se detuvo por un error inesperado: ${err?.message || err}`);
      })
      .finally(() => {
        procesando = false;
      });
  }

  function encolar({ area, ruta = [], n = PEDIDAS_DEFECTO, urgente = false } = {}) {
    if (!area) throw new Error('encolar: falta area');

    // Ronda 2 (revisión), punto 3 (Minor): tope de 32 en `colaFondo` -- las nuevas peticiones de
    // fondo se descartan (no se crean) si ya está llena. No afecta a los urgentes (un usuario
    // esperando su tanda no debería toparse con este límite).
    if (!urgente && colaFondo.length >= TOPE_COLA_FONDO) {
      return null;
    }

    const id = generarIdTrabajo(contadorId++);
    const trabajo = {
      id,
      area,
      ruta,
      urgente: !!urgente,
      pedidas: n,
      hechas: 0,
      estado: 'en-cola',
      preguntas: [],
      huboFallo: false,
      motivo: null,
    };
    registro.set(id, trabajo);
    if (trabajo.urgente) colaUrgente.push(trabajo);
    else colaFondo.push(trabajo);

    const posicion = calcularPosicion(trabajo);
    const delante = preguntasPorDelante(trabajo);
    dispararProcesamiento();
    return { trabajoId: id, posicion, preguntasPorDelante: delante, pedidas: trabajo.pedidas };
  }

  function estadoTrabajo(id) {
    const trabajo = registro.get(id) || terminados.get(id);
    if (!trabajo) return null;
    return {
      estado: trabajo.estado,
      hechas: trabajo.hechas,
      pedidas: trabajo.pedidas,
      preguntas: trabajo.preguntas,
      motivo: trabajo.motivo,
      // v0.2b4 §6c: para que el móvil afine su propia cuenta atrás mientras sondea.
      segundosPorPregunta: segundosPorPregunta(),
    };
  }

  // calcularObjetivo(resumen, rutasAtomo) -- spec §3.1/§3.3: objetivo total 30 en colchón NO
  // servido. 60 % (18) a "áreas flojas" (aciertoReciente < 0.6 o nivel <= 2); si ninguna área es
  // floja, ese 60 % se reparte entre TODAS las áreas. 40 % (12) a las rutas del átomo recibidas; si
  // no hay ninguna, ese 40 % se suma también al reparto por áreas (hasta 30 entre las áreas
  // objetivo). Se descuenta lo que ya hay en el colchón (no servido) por área/ruta y solo se
  // devuelven entradas con `faltan > 0`.
  //
  // Decisión del controlador (sin fijar en el brief): `rutasAtomo` es un array de
  // `{ area, ruta }` -- una ruta del átomo pertenece siempre a un área concreta (igual que
  // `POST /generar` recibe `{area, ruta}` por separado en la spec §3.3); no tendría sentido generar
  // para una ruta sin saber en qué área. Documentado para que el controlador lo confirme o corrija.
  async function calcularObjetivo(resumen, rutasAtomo = []) {
    const colchon = await almacen.leerColchon();
    const noServido = colchon.filter((p) => !p.servida);

    const esFloja = (area) => {
      const info = resumen?.areas?.[area];
      if (!info) return false;
      const aciertoBajo = typeof info.aciertoReciente === 'number' && info.aciertoReciente < 0.6;
      const nivelBajo = typeof info.nivel === 'number' && info.nivel <= 2;
      return aciertoBajo || nivelBajo;
    };
    const flojas = AREAS.filter(esFloja);
    const areasObjetivo = flojas.length > 0 ? flojas : AREAS;

    const rutasValidas = (rutasAtomo || []).filter(
      (r) => r && typeof r.area === 'string' && Array.isArray(r.ruta),
    );

    // clave = JSON.stringify([area, ruta]) -- sin separadores ambiguos: una entrada "toda el área" (ruta: []) y una
    // entrada de ruta concreta dentro de la misma área nunca chocan.
    const objetivos = new Map();
    function sumar(area, ruta, cantidad) {
      if (cantidad <= 0) return;
      const clave = JSON.stringify([area, ruta]);
      if (!objetivos.has(clave)) objetivos.set(clave, { area, ruta, cantidad: 0 });
      objetivos.get(clave).cantidad += cantidad;
    }

    const totalParaAreas = rutasValidas.length > 0 ? PARTE_AREAS : PARTE_AREAS + PARTE_RUTAS;
    const repartoAreas = repartirEntero(totalParaAreas, areasObjetivo.length);
    areasObjetivo.forEach((area, i) => sumar(area, [], repartoAreas[i]));

    if (rutasValidas.length > 0) {
      const repartoRutas = repartirEntero(PARTE_RUTAS, rutasValidas.length);
      rutasValidas.forEach((r, i) => sumar(r.area, r.ruta, repartoRutas[i]));
    }

    const resultado = [];
    for (const { area, ruta, cantidad } of objetivos.values()) {
      const yaHay =
        ruta.length === 0
          ? noServido.filter((p) => p.area === area).length
          : noServido.filter((p) => p.area === area && mismaRuta((p.ruta || []).slice(1), ruta)).length;
      const faltan = cantidad - yaHay;
      if (faltan > 0) resultado.push({ area, ruta, faltan });
    }
    return resultado;
  }

  async function rellenarHaciaObjetivo(resumen, rutasAtomo) {
    const objetivo = await calcularObjetivo(resumen, rutasAtomo);
    const encolados = [];
    for (const { area, ruta, faltan } of objetivo) {
      if (todosLosPendientesOArea(area, ruta)) continue;
      encolados.push(encolar({ area, ruta, n: faltan, urgente: false }));
    }
    return encolados;
  }

  // servir({ idsConocidos, resumen, max }) -- spec §3.3 (POST /estado) y decisión del controlador:
  // candidatas = colchón no servido, no reportado, no conocido; orden: área con menor
  // aciertoReciente primero (sin datos en el resumen cuenta como 0.5), luego `creada` más antigua.
  // Marca `servida` con ISO y persiste (con purga, ver purgarColchon).
  //
  // Ronda 2 (revisión), punto 1 -- Critical: TODO el leer->elegir->marcar->escribir va dentro de
  // `almacen.conCerrojo('colchon.json', ...)`, igual que guardarNuevasEnColchon. Antes, dos
  // llamadas concurrentes a servir() (o una servir() y un guardado de lote) leían el mismo colchón
  // "de antes", cada una elegía sus candidatas sin ver lo que la otra ya había marcado, y la
  // escritura que ganaba la carrera se comía la de la otra -- podía servir la misma pregunta dos
  // veces o perder aprobadas recién guardadas. Con el cerrojo, cada llamada ve siempre el colchón
  // ya actualizado por la anterior.
  async function servir({ idsConocidos = [], resumen = {}, max = 10 } = {}) {
    return almacen.conCerrojo(CERROJO_COLCHON, async () => {
      const colchon = await almacen.leerColchon();
      const reportadas = await almacen.leerReportadas();
      const conocidos = new Set(idsConocidos);
      const reportadasSet = new Set(reportadas);

      const candidatas = colchon.filter(
        (p) => !p.servida && !reportadasSet.has(p.id) && !conocidos.has(p.id),
      );

      const aciertoDeArea = (area) => {
        const info = resumen?.areas?.[area];
        if (!info || typeof info.aciertoReciente !== 'number') return 0.5;
        return info.aciertoReciente;
      };

      candidatas.sort((a, b) => {
        const diff = aciertoDeArea(a.area) - aciertoDeArea(b.area);
        if (diff !== 0) return diff;
        return new Date(a.creada).getTime() - new Date(b.creada).getTime();
      });

      const elegidas = candidatas.slice(0, Math.max(0, max));

      // Ronda final (revisión, 14-sep-2026) -- Critical (C3): una pregunta que el móvil ya conoce
      // (viene en `idsConocidos`) puede no haber pasado nunca por AQUÍ -- llegó por /trabajo/:id
      // (un `POST /generar` urgente), que guarda en el colchón pero no marca `servida`. Sin este
      // fix esas entradas se quedaban `servida: null` para siempre: `calcularObjetivo` las seguía
      // contando como "colchón disponible" (nunca se generaba de más para reemplazarlas, aunque el
      // móvil nunca fuera a volver a pedirlas) y `purgarColchon` nunca las purgaba (solo purga
      // servidas). Se marcan `servida` aquí, dentro del mismo cerrojo, aunque NO formen parte de
      // `elegidas` -- el móvil ya las tiene, no se le vuelven a mandar, pero el colchón debe saber
      // que ya están "gastadas".
      const idsAMarcar = new Set(elegidas.map((p) => p.id));
      for (const p of colchon) {
        if (!p.servida && conocidos.has(p.id)) idsAMarcar.add(p.id);
      }

      if (idsAMarcar.size > 0) {
        const ahora = new Date().toISOString();
        const actualizado = colchon.map((p) => (idsAMarcar.has(p.id) ? { ...p, servida: ahora } : p));
        await almacen.guardarColchon(purgarColchon(actualizado));
      }
      // M4: se devuelve la versión saneada (ver CAMPOS_PUBLICOS_PREGUNTA) -- `elegidas` en sí ya no
      // hace falta mutarla con `servida`, el colchón en disco es la única fuente de verdad de eso.
      return elegidas.map(paraCliente);
    });
  }

  /**
   * v0.2b4.1 §5: qué ha cambiado, de lo que el móvil YA tiene, desde la última vez que preguntó.
   * Solo `visual` y `explicacion`: son los dos únicos campos que este servidor reescribe después de
   * haber servido una pregunta (el trabajo de fondo de `completarVisualesPendientes`). Mandar la
   * pregunta entera sería invitar a que el cliente pise un enunciado que el jugador está leyendo.
   * No toca el disco más que para leer: no marca nada, no purga, no sirve nada nuevo.
   * @param {{idsConocidos?: string[], desde?: string}} params `desde` en ISO; sin él, todo lo marcado
   * @returns {Promise<{id: string, visual: object|null, explicacion: string}[]>}
   */
  async function actualizadas({ idsConocidos = [], desde = null } = {}) {
    const conocidos = new Set(idsConocidos);
    if (conocidos.size === 0) return [];
    const colchon = await almacen.leerColchon();
    const limite = typeof desde === 'string' ? new Date(desde).getTime() : NaN;
    return colchon
      .filter((p) => {
        if (!conocidos.has(p.id) || typeof p.actualizadaEn !== 'string') return false;
        if (!Number.isFinite(limite)) return true; // sin `desde` válido: todo lo que tenga marca
        const marca = new Date(p.actualizadaEn).getTime();
        return Number.isFinite(marca) && marca > limite;
      })
      .map((p) => ({ id: p.id, visual: p.visual ?? null, explicacion: p.explicacion }));
  }

  // Ronda 2 (revisión), punto 1: el borrado de colchon.json también va dentro del mismo cerrojo
  // ("reportada que revive" era exactamente este caso -- un servir() concurrente podía
  // reescribir el colchón entero justo después de que reportar() leyera pero antes de que
  // escribiera, resucitando la pregunta que se acababa de quitar).
  async function reportar(id, motivo) {
    await almacen.anadirReportada(id, motivo);
    await almacen.conCerrojo(CERROJO_COLCHON, async () => {
      const colchon = await almacen.leerColchon();
      const actualizado = colchon.filter((p) => p.id !== id);
      if (actualizado.length !== colchon.length) {
        await almacen.guardarColchon(actualizado);
      }
    });
    return { ok: true };
  }

  function estadisticas() {
    return {
      enCola: colaUrgente.length + colaFondo.length,
      activo: activo ? 1 : 0,
      terminadosRecordados: terminados.size,
      // Ronda final (C2): señal de salud del trabajador para /salud (ver ejecutarUnLote).
      ultimoError,
      ultimaGeneracionOk,
      // v0.2b4 §6c: media móvil real, no la heurística fija de 90 s por puesto (ver servidor/index.js).
      segundosPorPregunta: segundosPorPregunta(),
    };
  }

  return {
    encolar,
    estadoTrabajo,
    calcularObjetivo,
    rellenarHaciaObjetivo,
    servir,
    reportar,
    estadisticas,
    segundosPorPregunta,
    completarVisualesPendientes,
    actualizadas,
  };
}
