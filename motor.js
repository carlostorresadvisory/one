// motor.js — lógica pura de ONE (sin window, document ni localStorage).
// Todas las funciones son puras: reciben estado y devuelven estado nuevo.

export const AREAS = [
  'economia',
  'historia',
  'ciencia',
  'tecnologia',
  'geografia',
  'filosofia',
  'arte',
  'logica',
];

export const XP_BASE = { vf: 5, test4: 8, ordenar: 12, error: 12 };

// Días de espera del repaso Leitner según la caja 0..4.
export const INTERVALOS = [1, 3, 7, 14, 30];

// Objetivo de mezcla de tipos por partida de 10 preguntas.
export const MEZCLA = { vf: 3, test4: 4, ordenar: 2, error: 1 };

// Niveles de confianza que el jugador puede declarar al responder (selector de 3
// segmentos en la UI, "que se note" 2026-09-12). Por defecto 'media'; 'baja' y
// 'alta' afectan XP, Leitner y los contadores de calibración — ver
// `registrarRespuesta` y `resumenProgreso`.
export const CONFIANZAS = ['baja', 'media', 'alta'];

/** 'YYYY-MM-DD' + n días → 'YYYY-MM-DD'. Usa UTC para no arrastrar el huso horario local. */
export function sumarDias(fecha, n) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Estado inicial para el día `hoy` ('YYYY-MM-DD').
 * Versión 2 (spec "que se note" 2026-09-12): añade `recuperadas`, `confianza` y
 * `mision` sobre la v1 original. `normalizarEstado`/`importar` migran un JSON v1
 * viejo a esta forma rellenando estos campos con sus valores por defecto.
 */
export function crearEstado(hoy) {
  const areas = {};
  for (const area of AREAS) {
    // noLoSe: veces que se ha pulsado "No lo sé" en preguntas de esta área (solo cuenta).
    areas[area] = { nivel: 1, seguidosOk: 0, seguidosKo: 0, ultimas: [], noLoSe: 0 };
  }
  return {
    version: 2,
    xp: 0,
    combo: 0,
    // Escalera inmediata (1..5): sube/baja con cada respuesta, se ve en cada pregunta
    // y persiste entre partidas. Distinta del nivel por área, que solo sube con 3
    // aciertos seguidos no-vf y es más lento a propósito.
    nivelPartida: 1,
    racha: { dias: 0, ultimaFecha: null },
    hoy: { fecha: hoy, respondidas: 0, aciertos: 0 },
    areas,
    tarjetas: {},
    reportadas: [],
    historial: [],
    recuperadas: 0, // total histórico de tarjetas recuperadas (pendiente -> acierto)
    confianza: { altas: 0, altasOk: 0, bajas: 0, bajasOk: 0 },
    mision: null, // { fecha, ids: [..hasta 3], hechas: [ids], completada: bool }
  };
}

/**
 * Evalúa la respuesta a una pregunta según su tipo.
 * vf: respuesta boolean · test4: índice · ordenar: array de índices originales
 * en el orden elegido (correcto = [0,1,...,n-1]) · error: índice.
 */
export function evaluar(pregunta, respuesta) {
  switch (pregunta.tipo) {
    case 'vf':
      return respuesta === pregunta.respuesta;
    case 'test4':
      return respuesta === pregunta.correcta;
    case 'ordenar': {
      const objetivo = pregunta.items.map((_, i) => i);
      return (
        Array.isArray(respuesta) &&
        respuesta.length === objetivo.length &&
        respuesta.every((v, i) => v === objetivo[i])
      );
    }
    case 'error':
      return respuesta === pregunta.sospechoso;
    default:
      throw new Error(`Tipo de pregunta desconocido: ${pregunta.tipo}`);
  }
}

/** Baraja Fisher-Yates con rng inyectable, sin mutar el array de entrada. */
function barajar(array, rng) {
  const copia = array.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Reparte `restantes` preguntas entre los tipos de MEZCLA, escalado proporcionalmente. */
function objetivoTipos(restantes) {
  const total = Object.values(MEZCLA).reduce((a, b) => a + b, 0);
  const tipos = Object.keys(MEZCLA);
  const objetivo = {};
  let asignado = 0;
  for (const tipo of tipos) {
    objetivo[tipo] = Math.round((MEZCLA[tipo] / total) * restantes);
    asignado += objetivo[tipo];
  }
  let diferencia = restantes - asignado;
  const ordenPeso = [...tipos].sort((a, b) => MEZCLA[b] - MEZCLA[a]);
  let i = 0;
  while (diferencia !== 0 && ordenPeso.length > 0) {
    const tipo = ordenPeso[i % ordenPeso.length];
    if (diferencia > 0) {
      objetivo[tipo] += 1;
      diferencia -= 1;
    } else if (objetivo[tipo] > 0) {
      objetivo[tipo] -= 1;
      diferencia += 1;
    }
    i += 1;
  }
  return objetivo;
}

/** Busca en `banco` una pregunta nueva de `area`+`tipo`, priorizando cercanía al nivel del área. */
function elegirCandidato(banco, area, tipo, nivelArea, usados, distancia) {
  const candidatos = banco.filter(
    (p) =>
      p.area === area &&
      p.tipo === tipo &&
      !usados.has(p.id) &&
      Math.abs(p.nivel - nivelArea) <= distancia
  );
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => Math.abs(a.nivel - nivelArea) - Math.abs(b.nivel - nivelArea));
  return candidatos[0];
}

/** Reordena ids con su área para que no se repita área en posiciones consecutivas cuando hay alternativa. */
function ordenarSinRepetirArea(items, rng) {
  const grupos = new Map();
  for (const it of items) {
    if (!grupos.has(it.area)) grupos.set(it.area, []);
    grupos.get(it.area).push(it.id);
  }
  const resultado = [];
  let ultimaArea = null;
  const restantes = () => [...grupos.entries()].filter(([, ids]) => ids.length > 0);
  while (resultado.length < items.length) {
    let candidatos = restantes().filter(([area]) => area !== ultimaArea);
    if (candidatos.length === 0) candidatos = restantes(); // sin alternativa: toca repetir
    const maxLen = Math.max(...candidatos.map(([, ids]) => ids.length));
    const empatados = candidatos.filter(([, ids]) => ids.length === maxLen);
    const [area, ids] = empatados[Math.floor(rng() * empatados.length)];
    resultado.push(ids.shift());
    ultimaArea = area;
  }
  return resultado;
}

/**
 * Selecciona una partida de `n` ids: ~30% repasos vencidos (más atrasados primero),
 * el resto preguntas nuevas repartidas según MEZCLA y el nivel de cada área,
 * rotando áreas para no repetir en posiciones consecutivas. Nunca lanza.
 */
export function seleccionarPartida(estado, banco, hoy, n = 10, rng = Math.random) {
  const reportadas = new Set(estado.reportadas);
  const idsEnBanco = new Set(banco.map((p) => p.id));
  const usados = new Set();

  // 1. Repasos vencidos, los más atrasados primero.
  const repasosCandidatos = Object.entries(estado.tarjetas)
    .filter(([id, t]) => t.proximo <= hoy && !reportadas.has(id) && idsEnBanco.has(id))
    .sort((a, b) => (a[1].proximo < b[1].proximo ? -1 : a[1].proximo > b[1].proximo ? 1 : 0));

  const maxRepasos = Math.min(Math.round(0.3 * n), repasosCandidatos.length, n);
  const repasoIds = repasosCandidatos.slice(0, maxRepasos).map(([id]) => id);
  repasoIds.forEach((id) => usados.add(id));

  // 2. Nuevas: sin tarjeta, no reportadas.
  const restantes = n - repasoIds.length;
  const objetivo = objetivoTipos(restantes);
  const nuevasDisponibles = banco.filter((p) => !estado.tarjetas[p.id] && !reportadas.has(p.id));
  const areasOrden = barajar(AREAS, rng);

  const nuevaIds = [];
  for (const tipo of Object.keys(objetivo)) {
    let necesarias = objetivo[tipo];
    let ronda = 0;
    // Ensancha progresivamente la distancia de nivel admitida (0, ±1, ±2…) hasta cubrir
    // lo necesario o agotar el rango de niveles (1..5, distancia máxima 4).
    while (necesarias > 0 && ronda <= 4) {
      for (const area of areasOrden) {
        if (necesarias <= 0) break;
        const nivelArea = estado.areas[area].nivel;
        const candidato = elegirCandidato(nuevasDisponibles, area, tipo, nivelArea, usados, ronda);
        if (candidato) {
          nuevaIds.push(candidato.id);
          usados.add(candidato.id);
          necesarias -= 1;
        }
      }
      ronda += 1;
    }
  }

  // 2b. Relleno: si algún tipo no dio para su cupo, se completa con cualquier tipo,
  // primero por cercanía de nivel (0, ±1, …) y rotando áreas; después con repasos
  // extra no vencidos aún si sigue faltando. Objetivo blando: n manda sobre la mezcla.
  let distancia = 0;
  while (nuevaIds.length < restantes && distancia <= 4) {
    let anadida = false;
    for (const area of areasOrden) {
      if (nuevaIds.length >= restantes) break;
      const nivelArea = estado.areas[area].nivel;
      const candidatos = nuevasDisponibles
        .filter((p) => p.area === area && !usados.has(p.id) && Math.abs(p.nivel - nivelArea) <= distancia)
        .sort((a, b) => Math.abs(a.nivel - nivelArea) - Math.abs(b.nivel - nivelArea));
      if (candidatos.length > 0) {
        nuevaIds.push(candidatos[0].id);
        usados.add(candidatos[0].id);
        anadida = true;
      }
    }
    if (!anadida) distancia += 1;
  }
  const repasosExtra = [];
  if (repasoIds.length + nuevaIds.length < n) {
    for (const [id] of repasosCandidatos) {
      if (repasoIds.length + nuevaIds.length + repasosExtra.length >= n) break;
      if (!usados.has(id)) {
        repasosExtra.push(id);
        usados.add(id);
      }
    }
  }

  // 3. Orden final: repasos + nuevas, evitando área repetida en posiciones consecutivas.
  const bancoPorId = new Map(banco.map((p) => [p.id, p]));
  const items = [...repasoIds, ...repasosExtra, ...nuevaIds]
    .map((id) => bancoPorId.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, area: p.area }));

  return ordenarSinRepetirArea(items, rng);
}

/**
 * Elige UNA pregunta para la escalera inmediata: una a la vez, en función de
 * `nivelPartida`, con repasos vencidos intercalados. Excluye reportadas y `usados`
 * (ids ya servidos en esta partida). Nunca lanza; devuelve `null` si no queda ninguna.
 *
 * Con probabilidad 0.3 (o siempre que haya ≥5 repasos vencidos pendientes) elige el
 * repaso más atrasado. Si no, una pregunta nueva (sin tarjeta) del nivel de la partida,
 * ampliando la distancia de nivel admitida (0, ±1, ±2…) hasta encontrar alguna.
 * Entre candidatas del mismo nivel, prioriza (si hay alternativa) un tipo distinto y
 * luego un área distinta de `ultima`; los empates se resuelven con `rng`.
 *
 * `filtro` (opcional) restringe la selección — modo "practicar":
 *   - string, o `{ area }`: solo esa área (repasos y nuevas), como antes.
 *   - `{ ids: [...] }`: partida cerrada a esa lista concreta de ids, servidos en su
 *     orden, sin repasos automáticos ni relleno con otras preguntas ("sin
 *     relleno"). Cuando se agotan (todos ya en `usados`, reportados o fuera del
 *     banco) devuelve `null`, aunque la partida lleve menos de 10 preguntas — así
 *     es como la UI sabe que hay que terminarla (misión del día, pendientes).
 * Sin `filtro` no cambia nada.
 */
export function siguientePregunta(estado, banco, hoy, usados, rng = Math.random, ultima = null, filtro = null) {
  const filtroNorm = typeof filtro === 'string' ? { area: filtro } : filtro;
  const reportadas = new Set(estado.reportadas);
  const idsEnBanco = new Set(banco.map((p) => p.id));
  const bancoPorId = new Map(banco.map((p) => [p.id, p]));
  const elegible = (id) => !usados.has(id) && !reportadas.has(id) && idsEnBanco.has(id);

  // Filtro { ids }: partida cerrada a una lista concreta. Se sirve el primer id
  // elegible en el orden dado; sin repasos ni relleno de otro tipo.
  if (filtroNorm && Array.isArray(filtroNorm.ids)) {
    const siguienteId = filtroNorm.ids.find(elegible);
    return siguienteId ? bancoPorId.get(siguienteId) || null : null;
  }

  const cumpleFiltro = (p) => !filtroNorm || !filtroNorm.area || p.area === filtroNorm.area;

  // Repasos vencidos pendientes (no usados ni reportados, del área filtrada si toca),
  // el más atrasado primero.
  const repasosPendientes = Object.entries(estado.tarjetas)
    .filter(([id, t]) => {
      if (t.proximo > hoy || !elegible(id)) return false;
      const pregunta = bancoPorId.get(id);
      return Boolean(pregunta) && cumpleFiltro(pregunta);
    })
    .sort((a, b) => (a[1].proximo < b[1].proximo ? -1 : a[1].proximo > b[1].proximo ? 1 : 0));

  function tomarRepaso() {
    if (repasosPendientes.length === 0) return null;
    return bancoPorId.get(repasosPendientes[0][0]) || null;
  }

  function tomarNueva() {
    const disponibles = banco.filter((p) => !estado.tarjetas[p.id] && elegible(p.id) && cumpleFiltro(p));
    if (disponibles.length === 0) return null;

    let candidatos = [];
    for (let distancia = 0; distancia <= 4; distancia++) {
      candidatos = disponibles.filter((p) => Math.abs(p.nivel - estado.nivelPartida) <= distancia);
      if (candidatos.length > 0) break;
    }
    if (candidatos.length === 0) return null;

    if (ultima) {
      const tipoDistinto = candidatos.filter((p) => p.tipo !== ultima.tipo);
      if (tipoDistinto.length > 0) candidatos = tipoDistinto;
      const areaDistinta = candidatos.filter((p) => p.area !== ultima.area);
      if (areaDistinta.length > 0) candidatos = areaDistinta;
    }
    return candidatos[Math.floor(rng() * candidatos.length)];
  }

  const quiereRepaso = repasosPendientes.length >= 5 || rng() < 0.3;
  return (quiereRepaso ? tomarRepaso() : null) || tomarNueva() || tomarRepaso() || null;
}

/**
 * Registra la respuesta a `pregunta` (acierto/fallo) en el día `hoy`.
 *
 * `opciones.confianza` ('baja'|'media'|'alta', por defecto 'media') es el selector
 * de confianza de la UI. `opciones.noLoSe === true` se sigue aceptando por
 * compatibilidad: equivale a `confianza: 'baja'` con `correcta` forzado a `false`
 * (ignora el `correcta` recibido), y además queda anotado aparte en el historial y
 * en un contador por área, para distinguirlo de un fallo con Baja "de verdad".
 *
 * Reglas de confianza (spec "que se note" 2026-09-12):
 * - Leitner: acierto sube de caja salvo con Baja (`fragil = true`, la caja no
 *   cambia); con Media/Alta consolida como siempre (`fragil = false`). Fallo:
 *   caja a 0 igual que antes, `fragil = false`.
 * - XP: acierto con Alta multiplica x1,5 el XP ya calculado (tras combo), redondeado.
 * - Contadores `estado.confianza`: Alta -> altas(+altasOk si acierta); Baja ->
 *   bajas(+bajasOk si acierta). Media no mueve estos contadores.
 * - Pendiente: fallo -> pendiente=true, prioridad=max(prioridad, alta?2:1),
 *   ultimoFallo=hoy, recuperada=false. Acierto -> pendiente=false, prioridad=0.
 * - Recuperada: acierto sobre una tarjeta que YA estaba pendiente antes de esta
 *   respuesta (incluida con Baja, aunque quede frágil) -> recuperada=true,
 *   `estado.recuperadas += 1`, `delta.recuperada = { fechaFallo }` (el
 *   `ultimoFallo` anterior); si no, `delta.recuperada = null`.
 * - Misión: si `estado.mision` es de hoy y `pregunta.id` está en `mision.ids` y
 *   no en `mision.hechas`, se añade a `hechas` (acierte o no); si con eso se
 *   completan todos los ids, `completada = true` y `delta.misionCompletada = true`.
 *
 * Devuelve { estado nuevo, delta: { xp, combo, correcta, noLoSe, confianza, fragil,
 * recuperada, misionCompletada, ... } }. No muta `estado`.
 */
export function registrarRespuesta(estado, pregunta, correcta, hoy, opciones = {}) {
  const noLoSe = opciones.noLoSe === true;
  if (noLoSe) correcta = false; // "no lo sé" es siempre fallo, nunca depende de lo recibido

  // noLoSe equivale a confianza 'baja'; si no, se usa la recibida (o 'media' si
  // falta o no es una de las 3 válidas).
  let confianza = noLoSe ? 'baja' : opciones.confianza;
  if (!CONFIANZAS.includes(confianza)) confianza = 'media';
  const esAlta = confianza === 'alta';
  const esBaja = confianza === 'baja';

  const nuevo = structuredClone(estado);

  // Reinicia "hoy" si cambia la fecha.
  if (nuevo.hoy.fecha !== hoy) {
    nuevo.hoy = { fecha: hoy, respondidas: 0, aciertos: 0 };
  }
  nuevo.hoy.respondidas += 1;
  if (correcta) nuevo.hoy.aciertos += 1;

  // Escalera inmediata: sube con cualquier acierto (incluido vf) y baja con cualquier
  // fallo. A diferencia del nivel por área, aquí vf sí cuenta: es lo que se siente
  // jugar, aunque el nivel por área lo siga ignorando para subir.
  const nivelPartidaAntes = nuevo.nivelPartida;
  nuevo.nivelPartida = correcta
    ? Math.min(5, nivelPartidaAntes + 1)
    : Math.max(1, nivelPartidaAntes - 1);
  const cambioNivelPartida = nuevo.nivelPartida - nivelPartidaAntes;

  // Combo y XP (el nivel usado para el XP es el de ANTES de aplicar la subida/bajada de este turno).
  const combo = correcta ? nuevo.combo + 1 : 0;
  const areaState = nuevo.areas[pregunta.area];
  const nivelAntes = areaState.nivel;
  let xp = correcta
    ? Math.round(XP_BASE[pregunta.tipo] * (1 + 0.1 * nivelAntes) * (combo >= 3 ? 1.5 : 1))
    : 0;
  // Confianza Alta + acierto: +50% de XP extra sobre el ya calculado, redondeado aparte.
  if (correcta && esAlta) xp = Math.round(xp * 1.5);
  nuevo.combo = combo;
  nuevo.xp += xp;

  // --- Tarjeta: Leitner + pendiente/prioridad/recuperada/fragil ---
  const plantillaTarjeta = {
    caja: 0,
    proximo: hoy,
    aciertos: 0,
    fallos: 0,
    ultimo: hoy,
    ultimoFallo: null,
    pendiente: false,
    prioridad: 0,
    recuperada: false,
    fragil: false,
  };
  const tarjeta = nuevo.tarjetas[pregunta.id]
    ? { ...nuevo.tarjetas[pregunta.id] }
    : { ...plantillaTarjeta };
  const eraPendiente = tarjeta.pendiente === true;
  const ultimoFalloAntes = tarjeta.ultimoFallo;

  if (correcta) {
    if (esBaja) {
      // Baja + acierto: cuenta pero no consolida. La caja no sube.
      tarjeta.fragil = true;
    } else {
      tarjeta.fragil = false;
      tarjeta.caja = Math.min(tarjeta.caja + 1, 4);
    }
    tarjeta.proximo = sumarDias(hoy, INTERVALOS[tarjeta.caja]);
    tarjeta.aciertos += 1;
    tarjeta.pendiente = false;
    tarjeta.prioridad = 0;
  } else {
    tarjeta.fragil = false;
    tarjeta.caja = 0;
    tarjeta.proximo = sumarDias(hoy, 1);
    tarjeta.fallos += 1;
    tarjeta.pendiente = true;
    tarjeta.prioridad = Math.max(tarjeta.prioridad, esAlta ? 2 : 1);
    tarjeta.ultimoFallo = hoy;
    tarjeta.recuperada = false;
  }
  tarjeta.ultimo = hoy;

  // Recuperada: acierto sobre una tarjeta que YA estaba pendiente antes de esta
  // respuesta (con cualquier confianza, incluida Baja aunque quede frágil).
  let deltaRecuperada = null;
  if (correcta && eraPendiente) {
    tarjeta.recuperada = true;
    nuevo.recuperadas += 1;
    deltaRecuperada = { fechaFallo: ultimoFalloAntes };
  }
  nuevo.tarjetas[pregunta.id] = tarjeta;

  // --- Contadores de confianza (calibración): solo Alta y Baja se cuentan. ---
  if (esAlta) {
    nuevo.confianza.altas += 1;
    if (correcta) nuevo.confianza.altasOk += 1;
  } else if (esBaja) {
    nuevo.confianza.bajas += 1;
    if (correcta) nuevo.confianza.bajasOk += 1;
  }

  // Nivel por área: seguidosOk solo cuenta aciertos de tipo != vf; seguidosKo cuenta cualquier fallo.
  if (correcta) {
    areaState.seguidosKo = 0;
    if (pregunta.tipo !== 'vf') {
      areaState.seguidosOk += 1;
      if (areaState.seguidosOk >= 3) {
        areaState.nivel = Math.min(areaState.nivel + 1, 5);
        areaState.seguidosOk = 0;
      }
    }
  } else {
    areaState.seguidosOk = 0;
    areaState.seguidosKo += 1;
    if (areaState.seguidosKo >= 2) {
      areaState.nivel = Math.max(areaState.nivel - 1, 1);
      areaState.seguidosKo = 0;
    }
  }
  if (noLoSe) {
    areaState.noLoSe = (areaState.noLoSe || 0) + 1;
  }
  areaState.ultimas = [...areaState.ultimas, correcta].slice(-20);
  const cambioNivelArea = areaState.nivel - nivelAntes;

  nuevo.historial = [...nuevo.historial, { id: pregunta.id, fecha: hoy, correcta, noLoSe, confianza }].slice(
    -500
  );

  // --- Misión del día: se marca la pregunta como hecha si pertenece a la misión de hoy. ---
  let misionCompletada = false;
  if (
    nuevo.mision &&
    nuevo.mision.fecha === hoy &&
    nuevo.mision.ids.includes(pregunta.id) &&
    !nuevo.mision.hechas.includes(pregunta.id)
  ) {
    const hechas = [...nuevo.mision.hechas, pregunta.id];
    const completada = hechas.length === nuevo.mision.ids.length;
    nuevo.mision = { ...nuevo.mision, hechas, completada: completada || nuevo.mision.completada };
    if (completada && !estado.mision.completada) misionCompletada = true;
  }

  return {
    estado: nuevo,
    delta: {
      xp,
      combo,
      correcta,
      noLoSe,
      confianza,
      fragil: tarjeta.fragil,
      recuperada: deltaRecuperada,
      misionCompletada,
      nivelPartida: nuevo.nivelPartida,
      cambioNivelPartida,
      nivelArea: areaState.nivel,
      cambioNivelArea,
    },
  };
}

/**
 * Tarjetas pendientes (falladas, sin recuperar todavía) listas para repasar:
 * prioridad descendente (2 = falló con confianza Alta, 1 = fallo normal) y, dentro
 * de la misma prioridad, la que falló hace más tiempo primero (`ultimoFallo` más
 * antiguo). Solo devuelve preguntas que siguen en `banco` — una reportada o
 * retirada del banco no debería poder jugarse aunque su tarjeta siga marcada
 * pendiente. Se usa para el chip "Pendientes" del hub y el filtro `{ ids }` de
 * `siguientePregunta`. Nunca lanza; sin pendientes devuelve `[]`.
 */
export function pendientes(estado, banco) {
  const bancoPorId = new Map(banco.map((p) => [p.id, p]));
  return Object.entries(estado.tarjetas)
    .filter(([id, t]) => t.pendiente === true && bancoPorId.has(id))
    .sort((a, b) => {
      const [, ta] = a;
      const [, tb] = b;
      if (tb.prioridad !== ta.prioridad) return tb.prioridad - ta.prioridad; // prioridad desc
      const fa = ta.ultimoFallo ?? '';
      const fb = tb.ultimoFallo ?? '';
      return fa < fb ? -1 : fa > fb ? 1 : 0; // ultimoFallo más antiguo primero
    })
    .map(([id]) => bancoPorId.get(id));
}

/** Actualiza la racha de días al completar la primera partida del día. Resetea el combo. */
export function actualizarRacha(estado, hoy) {
  const nuevo = structuredClone(estado);
  const { ultimaFecha } = nuevo.racha;
  if (ultimaFecha === hoy) {
    // no cambia
  } else if (ultimaFecha === sumarDias(hoy, -1)) {
    nuevo.racha.dias += 1;
  } else {
    nuevo.racha.dias = 1;
  }
  nuevo.racha.ultimaFecha = hoy;
  nuevo.combo = 0;
  return nuevo;
}

/**
 * Datos para la pantalla Progreso. Toda la aritmética vive aquí, la UI solo pinta.
 * `hoy` ('YYYY-MM-DD') es opcional y nuevo (spec "que se note"): sin él, `recientes`
 * es 0 en todas las áreas pero el resto del resumen funciona igual (compatibilidad).
 */
export function resumenProgreso(estado, banco, hoy) {
  const ayer = hoy ? sumarDias(hoy, -1) : null;
  const bancoPorId = new Map(banco.map((p) => [p.id, p]));
  const porArea = AREAS.map((area) => {
    const areaState = estado.areas[area];
    const ultimas = areaState.ultimas;
    const aciertoReciente =
      ultimas.length === 0 ? null : ultimas.filter(Boolean).length / ultimas.length;
    let solidas = 0;
    let recientes = 0;
    for (const [id, t] of Object.entries(estado.tarjetas)) {
      const pregunta = bancoPorId.get(id);
      if (!pregunta || pregunta.area !== area) continue;
      if (t.caja >= 3) solidas += 1;
      if (hoy && (t.ultimo === hoy || t.ultimo === ayer)) recientes += 1;
    }
    const total = banco.filter((p) => p.area === area).length;
    const puntuacion = puntuacionArea(areaState.nivel, aciertoReciente);
    return {
      area,
      nivel: areaState.nivel,
      aciertoReciente,
      estables: solidas, // alias retrocompatible: mismo valor que `solidas`
      solidas,
      recientes,
      solidez: Math.min(1, solidas / 12),
      total,
      noLoSe: areaState.noLoSe || 0,
      puntuacion,
      nota: notaArea(puntuacion, aciertoReciente),
    };
  });
  // Total global acumulado de TODO el historial (no solo hoy): sirve para medir
  // aciertos "por suerte" (aciertos / respondidas) frente a las veces que se ha
  // reconocido no saber la respuesta.
  const global = estado.historial.reduce(
    (acc, h) => {
      acc.respondidas += 1;
      if (h.correcta) acc.aciertos += 1;
      if (h.noLoSe) acc.noLoSe += 1;
      return acc;
    },
    { respondidas: 0, aciertos: 0, noLoSe: 0 }
  );
  const { altas, altasOk, bajas, bajasOk } = estado.confianza;
  // Calibración: qué tan bien calza la confianza Alta con acertar de verdad. Con
  // pocas respuestas de Alta el ratio es ruido, así que se oculta (null) hasta 5.
  const calibracion = altas >= 5 ? Math.round((altasOk / altas) * 100) / 100 : null;
  return {
    racha: estado.racha,
    xp: estado.xp,
    hoy: { respondidas: estado.hoy.respondidas, aciertos: estado.hoy.aciertos },
    porArea,
    global,
    recuperadas: estado.recuperadas,
    pendientes: pendientes(estado, banco).length,
    mision: estado.mision,
    confianza: { altas, altasOk, bajas, bajasOk, calibracion },
  };
}

/**
 * Misión del día: hasta 3 preguntas de las 2 áreas con menor puntuación (empate ->
 * orden de AREAS), para invitar a repasar donde más flojo se está — 2 de la más
 * floja y 1 de la segunda. Candidatas con nivel <= nivel del área + 1,
 * priorizando primero preguntas sin tarjeta (no vistas) y luego pendientes;
 * barajadas con `rng` dentro de cada grupo de prioridad. Si falta material
 * (banco pequeño) completa con la otra de las 2 áreas o, si tampoco alcanza, deja
 * la misión con menos de 3 ids.
 *
 * Si `estado.mision` ya es de `hoy` la devuelve sin cambios (idempotente: no crea
 * una segunda misión el mismo día). Si no, genera una nueva y la guarda en el
 * estado devuelto. Devuelve `{ estado, mision }`. No muta `estado`. Nunca lanza.
 */
export function misionDelDia(estado, banco, hoy, rng = Math.random) {
  if (estado.mision && estado.mision.fecha === hoy) {
    return { estado, mision: estado.mision };
  }

  const resumen = resumenProgreso(estado, banco, hoy);
  const porPuntuacion = [...resumen.porArea].sort((a, b) =>
    a.puntuacion !== b.puntuacion
      ? a.puntuacion - b.puntuacion
      : AREAS.indexOf(a.area) - AREAS.indexOf(b.area)
  );
  const areaFloja = porPuntuacion[0]?.area ?? null;
  const areaSegunda = porPuntuacion[1]?.area ?? null;

  const reportadas = new Set(estado.reportadas);
  function candidatasDeArea(area) {
    if (!area) return [];
    const nivelMax = estado.areas[area].nivel + 1;
    // La spec no lo dice explícitamente, pero excluir reportadas es consistente con
    // el resto del motor (seleccionarPartida, siguientePregunta): una pregunta
    // marcada como mala no debería poder aparecer en la misión del día.
    const enBanco = banco.filter((p) => p.area === area && p.nivel <= nivelMax && !reportadas.has(p.id));
    const sinTarjeta = barajar(
      enBanco.filter((p) => !estado.tarjetas[p.id]),
      rng
    );
    const conPendiente = barajar(
      enBanco.filter((p) => estado.tarjetas[p.id]?.pendiente),
      rng
    );
    const resto = barajar(
      enBanco.filter((p) => estado.tarjetas[p.id] && !estado.tarjetas[p.id].pendiente),
      rng
    );
    return [...sinTarjeta, ...conPendiente, ...resto];
  }

  const candFloja = candidatasDeArea(areaFloja);
  const candSegunda = candidatasDeArea(areaSegunda);
  const usados = new Set();
  const ids = [];

  function tomar(lista, cuantas) {
    let tomadas = 0;
    for (const p of lista) {
      if (tomadas >= cuantas) break;
      if (usados.has(p.id)) continue;
      ids.push(p.id);
      usados.add(p.id);
      tomadas += 1;
    }
    return tomadas;
  }

  const deFloja = tomar(candFloja, 2);
  const deSegunda = tomar(candSegunda, 1);
  // Si falta material, se completa con la otra de las 2 áreas; si aun así no
  // alcanza, la misión queda con menos de 3 preguntas (banco pequeño).
  let faltan = 3 - deFloja - deSegunda;
  if (faltan > 0) faltan -= tomar(candSegunda, faltan);
  if (faltan > 0) faltan -= tomar(candFloja, faltan);

  const mision = { fecha: hoy, ids, hechas: [], completada: false };
  const nuevo = structuredClone(estado);
  nuevo.mision = mision;
  return { estado: nuevo, mision };
}

/**
 * Puntuación 0..1 de un área para el radar y la nota: 60 % el nivel alcanzado (1..5) y
 * 40 % el acierto reciente (0..1). Sin acierto reciente (null) se puntúa solo el nivel.
 */
export function puntuacionArea(nivel, aciertoReciente) {
  const nivelNorm = (Math.min(5, Math.max(1, nivel)) - 1) / 4;
  if (aciertoReciente === null || aciertoReciente === undefined) return Math.round(nivelNorm * 100) / 100;
  return Math.round((nivelNorm * 0.6 + Math.min(1, Math.max(0, aciertoReciente)) * 0.4) * 100) / 100;
}

/** Nota tipo videojuego a partir de la puntuación 0..1: S+, S, A, B, C, D. Sin datos → '—'. */
export function notaArea(puntuacion, aciertoReciente) {
  if (aciertoReciente === null || aciertoReciente === undefined) return '—';
  if (puntuacion >= 0.9) return 'S+';
  if (puntuacion >= 0.75) return 'S';
  if (puntuacion >= 0.6) return 'A';
  if (puntuacion >= 0.45) return 'B';
  if (puntuacion >= 0.3) return 'C';
  return 'D';
}

/** Serializa el estado a JSON. */
export function exportar(estado) {
  return JSON.stringify(estado);
}

/**
 * Deserializa y valida un estado exportado. Lanza si la versión no está soportada
 * (1 o 2) o falta estructura. Un JSON v1 (de antes de "que se note") se migra a v2
 * con valores por defecto en `normalizarEstado` — importar un estado viejo nunca rompe.
 */
export function importar(json) {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('JSON inválido');
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('Estado inválido');
  }
  if (obj.version !== 1 && obj.version !== 2) {
    throw new Error('Versión de estado no soportada');
  }
  const camposRequeridos = [
    'xp',
    'combo',
    'racha',
    'hoy',
    'areas',
    'tarjetas',
    'reportadas',
    'historial',
  ];
  for (const campo of camposRequeridos) {
    if (!(campo in obj)) {
      throw new Error(`Falta el campo '${campo}' en el estado`);
    }
  }
  return normalizarEstado(obj);
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Repara la estructura interna de un estado importado: áreas que faltan vuelven a sus
 * valores iniciales, tarjetas malformadas se descartan, racha/hoy/arrays se saneam.
 * Así un JSON manipulado a mano no rompe registrarRespuesta ni resumenProgreso.
 *
 * También migra v1 -> v2: un estado v1 (sin `recuperadas`/`confianza`/`mision`, y
 * con tarjetas sin sus campos nuevos) se completa con los valores por defecto de
 * v2 en vez de fallar. El resultado siempre es un estado v2 completo.
 */
function normalizarEstado(obj) {
  const base = crearEstado(esObjeto(obj.hoy) && RE_FECHA.test(obj.hoy.fecha) ? obj.hoy.fecha : '1970-01-01');
  const estado = { ...base, version: 2 };
  estado.xp = Number.isFinite(obj.xp) && obj.xp >= 0 ? obj.xp : 0;
  estado.combo = Number.isInteger(obj.combo) && obj.combo >= 0 ? obj.combo : 0;
  estado.nivelPartida =
    Number.isInteger(obj.nivelPartida) && obj.nivelPartida >= 1 && obj.nivelPartida <= 5
      ? obj.nivelPartida
      : 1;
  if (esObjeto(obj.racha) && Number.isInteger(obj.racha.dias) && obj.racha.dias >= 0) {
    estado.racha = {
      dias: obj.racha.dias,
      ultimaFecha: RE_FECHA.test(obj.racha.ultimaFecha ?? '') ? obj.racha.ultimaFecha : null,
    };
  }
  if (esObjeto(obj.hoy) && RE_FECHA.test(obj.hoy.fecha)) {
    estado.hoy = {
      fecha: obj.hoy.fecha,
      respondidas: Number.isInteger(obj.hoy.respondidas) ? obj.hoy.respondidas : 0,
      aciertos: Number.isInteger(obj.hoy.aciertos) ? obj.hoy.aciertos : 0,
    };
  }
  for (const area of AREAS) {
    const a = esObjeto(obj.areas) ? obj.areas[area] : null;
    if (esObjeto(a) && Number.isInteger(a.nivel) && a.nivel >= 1 && a.nivel <= 5) {
      estado.areas[area] = {
        nivel: a.nivel,
        seguidosOk: Number.isInteger(a.seguidosOk) ? a.seguidosOk : 0,
        seguidosKo: Number.isInteger(a.seguidosKo) ? a.seguidosKo : 0,
        ultimas: Array.isArray(a.ultimas) ? a.ultimas.filter((x) => typeof x === 'boolean').slice(-20) : [],
        noLoSe: Number.isInteger(a.noLoSe) && a.noLoSe >= 0 ? a.noLoSe : 0,
      };
    }
  }
  estado.tarjetas = {};
  if (esObjeto(obj.tarjetas)) {
    for (const [id, t] of Object.entries(obj.tarjetas)) {
      if (esObjeto(t) && Number.isInteger(t.caja) && t.caja >= 0 && t.caja <= 4 && RE_FECHA.test(t.proximo ?? '')) {
        estado.tarjetas[id] = {
          caja: t.caja,
          proximo: t.proximo,
          aciertos: Number.isInteger(t.aciertos) ? t.aciertos : 0,
          fallos: Number.isInteger(t.fallos) ? t.fallos : 0,
          // Campos v2: si faltan (tarjeta v1), valores por defecto seguros: fecha
          // centinela que nunca cuenta como "reciente", y "no pendiente todavía".
          ultimo: RE_FECHA.test(t.ultimo ?? '') ? t.ultimo : '1970-01-01',
          ultimoFallo: RE_FECHA.test(t.ultimoFallo ?? '') ? t.ultimoFallo : null,
          pendiente: t.pendiente === true,
          prioridad: [0, 1, 2].includes(t.prioridad) ? t.prioridad : 0,
          recuperada: t.recuperada === true,
          fragil: t.fragil === true,
        };
      }
    }
  }
  estado.reportadas = Array.isArray(obj.reportadas) ? obj.reportadas.filter((x) => typeof x === 'string') : [];
  estado.historial = Array.isArray(obj.historial) ? obj.historial.filter(esObjeto).slice(-500) : [];

  // Campos v2 a nivel de estado (spec "que se note"): ausentes en un JSON v1.
  estado.recuperadas = Number.isInteger(obj.recuperadas) && obj.recuperadas >= 0 ? obj.recuperadas : 0;
  estado.confianza = normalizarConfianza(obj.confianza);
  estado.mision = normalizarMision(obj.mision);
  return estado;
}

/** Sanea `estado.confianza`: cada contador a entero >= 0, o todo a 0 si falta/es inválido. */
function normalizarConfianza(c) {
  const campo = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  if (!esObjeto(c)) return { altas: 0, altasOk: 0, bajas: 0, bajasOk: 0 };
  return {
    altas: campo(c.altas),
    altasOk: campo(c.altasOk),
    bajas: campo(c.bajas),
    bajasOk: campo(c.bajasOk),
  };
}

/** Sanea `estado.mision`: si no tiene una forma válida (fecha + ids), se descarta a null. */
function normalizarMision(m) {
  if (!esObjeto(m)) return null;
  const fechaValida = RE_FECHA.test(m.fecha ?? '');
  const idsValidos = Array.isArray(m.ids) && m.ids.length <= 3 && m.ids.every((x) => typeof x === 'string');
  if (!fechaValida || !idsValidos) return null;
  const hechas = Array.isArray(m.hechas)
    ? m.hechas.filter((x) => typeof x === 'string' && m.ids.includes(x))
    : [];
  return { fecha: m.fecha, ids: m.ids, hechas, completada: m.completada === true };
}
