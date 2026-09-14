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
const TERMINADOS_MAX = 100;
const UN_MES_MS = 30 * 24 * 60 * 60 * 1000;
const TOPE_COLCHON = 2000;

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
 * @param {object} [params.opciones] opciones base pasadas a producirTanda en cada lote (llamar,
 *   permitirPago, topeEur, rutaLog); `urgente` se añade/sobrescribe por trabajo.
 */
export function crearCola({ almacen, producirTanda, opciones = {} } = {}) {
  if (!almacen) throw new Error('crearCola: falta almacen');
  if (typeof producirTanda !== 'function') throw new Error('crearCola: falta producirTanda');

  const colaUrgente = [];
  const colaFondo = [];
  const registro = new Map(); // trabajos en-cola o en curso, por id
  const terminados = new Map(); // últimos 100 trabajos terminados, por id (no se persisten)
  let activo = null;
  let procesando = false;
  let contadorId = 0;

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

  function tomarSiguiente() {
    if (colaUrgente.length > 0) return colaUrgente.shift();
    if (colaFondo.length > 0) return colaFondo.shift();
    return null;
  }

  function guardarTerminado(trabajo) {
    registro.delete(trabajo.id);
    terminados.set(trabajo.id, trabajo);
    if (terminados.size > TERMINADOS_MAX) {
      const primeraClave = terminados.keys().next().value;
      terminados.delete(primeraClave);
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

  async function guardarNuevasEnColchon(nuevas) {
    if (nuevas.length === 0) return;
    const colchon = await almacen.leerColchon();
    await almacen.guardarColchon(purgarColchon(colchon.concat(nuevas)));
  }

  // Ejecuta un trabajo completo: tantos lotes de TAMANO_LOTE como haga falta hasta `pedidas`.
  // Decisiones del controlador para los estados (ver brief de la Tarea 2):
  // - 'generando' mientras el trabajo aún no tiene NINGUNA aprobada (ni siquiera la primera).
  // - En cuanto hay >=1 aprobada, el trabajo pasa a 'parcial' y se queda ahí (visible para quien
  //   consulte estadoTrabajo) mientras se piden los lotes que faltan -- no vuelve a 'generando'.
  // - Un lote que falla (excepción de producirTanda) no aborta el trabajo: se cuenta como
  //   "consumido" hacia `pedidas` (evita bucles infinitos) y marca `huboFallo`.
  // - Al terminar todos los lotes: 'fallida' si no se consiguió ninguna aprobada; si no, 'lista'
  //   (todo fue bien) o 'parcial' (se completó pero con algún fallo por el camino).
  async function ejecutarTrabajo(trabajo) {
    trabajo.estado = 'generando';

    while (trabajo.hechas < trabajo.pedidas) {
      const tamanoLote = Math.min(TAMANO_LOTE, trabajo.pedidas - trabajo.hechas);
      const evitar = await calcularEvitar(trabajo.area);

      let resultado = null;
      try {
        resultado = await producirTanda(
          { area: trabajo.area, ruta: trabajo.ruta, n: tamanoLote, evitar },
          { ...opciones, urgente: trabajo.urgente },
        );
      } catch {
        trabajo.huboFallo = true;
      }

      trabajo.hechas += tamanoLote;

      if (resultado) {
        if (resultado.fallos && resultado.fallos.length > 0) trabajo.huboFallo = true;
        if (resultado.aprobadas && resultado.aprobadas.length > 0) {
          const guardadas = resultado.aprobadas.map((p) => aColchon(p, trabajo));
          trabajo.preguntas = trabajo.preguntas.concat(guardadas);
          await guardarNuevasEnColchon(guardadas);
        }
      }

      if (trabajo.hechas < trabajo.pedidas) {
        trabajo.estado = trabajo.preguntas.length > 0 ? 'parcial' : 'generando';
      }
    }

    trabajo.estado = trabajo.preguntas.length > 0 ? (trabajo.huboFallo ? 'parcial' : 'lista') : 'fallida';
  }

  async function procesarCola() {
    let siguiente;
    // eslint-disable-next-line no-cond-assign
    while ((siguiente = tomarSiguiente())) {
      activo = siguiente;
      await ejecutarTrabajo(siguiente);
      guardarTerminado(siguiente);
      activo = null;
    }
  }

  function dispararProcesamiento() {
    if (procesando) return;
    procesando = true;
    procesarCola().finally(() => {
      procesando = false;
    });
  }

  function encolar({ area, ruta = [], n = PEDIDAS_DEFECTO, urgente = false } = {}) {
    if (!area) throw new Error('encolar: falta area');
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
    };
    registro.set(id, trabajo);
    if (trabajo.urgente) colaUrgente.push(trabajo);
    else colaFondo.push(trabajo);

    const posicion = calcularPosicion(trabajo);
    dispararProcesamiento();
    return { trabajoId: id, posicion };
  }

  function estadoTrabajo(id) {
    const trabajo = registro.get(id) || terminados.get(id);
    if (!trabajo) return null;
    return {
      estado: trabajo.estado,
      hechas: trabajo.hechas,
      pedidas: trabajo.pedidas,
      preguntas: trabajo.preguntas,
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

    // clave = area + ' ' + ruta.join('/') -- así una entrada "toda el área" (ruta: []) y una
    // entrada de ruta concreta dentro de la misma área nunca chocan.
    const objetivos = new Map();
    function sumar(area, ruta, cantidad) {
      if (cantidad <= 0) return;
      const clave = `${area} ${ruta.join('/')}`;
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
  async function servir({ idsConocidos = [], resumen = {}, max = 10 } = {}) {
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
    if (elegidas.length > 0) {
      const ahora = new Date().toISOString();
      const idsElegidos = new Set(elegidas.map((p) => p.id));
      const actualizado = colchon.map((p) => (idsElegidos.has(p.id) ? { ...p, servida: ahora } : p));
      await almacen.guardarColchon(purgarColchon(actualizado));
      for (const p of elegidas) p.servida = ahora;
    }
    return elegidas;
  }

  async function reportar(id) {
    await almacen.anadirReportada(id);
    const colchon = await almacen.leerColchon();
    const actualizado = colchon.filter((p) => p.id !== id);
    if (actualizado.length !== colchon.length) {
      await almacen.guardarColchon(actualizado);
    }
    return { ok: true };
  }

  function estadisticas() {
    return {
      enCola: colaUrgente.length + colaFondo.length,
      activo: activo ? 1 : 0,
      terminadosRecordados: terminados.size,
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
  };
}
