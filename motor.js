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

/** Estado inicial para el día `hoy` ('YYYY-MM-DD'). */
export function crearEstado(hoy) {
  const areas = {};
  for (const area of AREAS) {
    // noLoSe: veces que se ha pulsado "No lo sé" en preguntas de esta área (solo cuenta).
    areas[area] = { nivel: 1, seguidosOk: 0, seguidosKo: 0, ultimas: [], noLoSe: 0 };
  }
  return {
    version: 1,
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
 * `filtro` (opcional, `{ area }`) restringe TODO lo anterior (repasos y nuevas) a un
 * área concreta — modo "practicar solo un área". Sin `filtro` no cambia nada.
 */
export function siguientePregunta(estado, banco, hoy, usados, rng = Math.random, ultima = null, filtro = null) {
  const reportadas = new Set(estado.reportadas);
  const idsEnBanco = new Set(banco.map((p) => p.id));
  const bancoPorId = new Map(banco.map((p) => [p.id, p]));
  const elegible = (id) => !usados.has(id) && !reportadas.has(id) && idsEnBanco.has(id);
  const cumpleFiltro = (p) => !filtro || !filtro.area || p.area === filtro.area;

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
 * `opciones.noLoSe === true` marca que el jugador ha pulsado "No lo sé": se trata
 * SIEMPRE como fallo (ignora el `correcta` recibido), pero queda anotado aparte en
 * el historial y en un contador por área, para poder distinguirlo de un fallo real.
 * Devuelve { estado nuevo, delta: { xp, combo, correcta, noLoSe, ... } }. No muta `estado`.
 */
export function registrarRespuesta(estado, pregunta, correcta, hoy, opciones = {}) {
  const noLoSe = opciones.noLoSe === true;
  if (noLoSe) correcta = false; // "no lo sé" es siempre fallo, nunca depende de lo recibido

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
  const xp = correcta
    ? Math.round(XP_BASE[pregunta.tipo] * (1 + 0.1 * nivelAntes) * (combo >= 3 ? 1.5 : 1))
    : 0;
  nuevo.combo = combo;
  nuevo.xp += xp;

  // Leitner: caja y próxima fecha de repaso de la tarjeta.
  const tarjeta = nuevo.tarjetas[pregunta.id] || { caja: 0, proximo: hoy, aciertos: 0, fallos: 0 };
  if (correcta) {
    tarjeta.caja = Math.min(tarjeta.caja + 1, 4);
    tarjeta.proximo = sumarDias(hoy, INTERVALOS[tarjeta.caja]);
    tarjeta.aciertos += 1;
  } else {
    tarjeta.caja = 0;
    tarjeta.proximo = sumarDias(hoy, 1);
    tarjeta.fallos += 1;
  }
  nuevo.tarjetas[pregunta.id] = tarjeta;

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

  nuevo.historial = [...nuevo.historial, { id: pregunta.id, fecha: hoy, correcta, noLoSe }].slice(-500);

  return {
    estado: nuevo,
    delta: {
      xp,
      combo,
      correcta,
      noLoSe,
      nivelPartida: nuevo.nivelPartida,
      cambioNivelPartida,
      nivelArea: areaState.nivel,
      cambioNivelArea,
    },
  };
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

/** Datos para la pantalla Progreso. Toda la aritmética vive aquí, la UI solo pinta. */
export function resumenProgreso(estado, banco) {
  const porArea = AREAS.map((area) => {
    const areaState = estado.areas[area];
    const ultimas = areaState.ultimas;
    const aciertoReciente =
      ultimas.length === 0 ? null : ultimas.filter(Boolean).length / ultimas.length;
    const estables = Object.entries(estado.tarjetas).filter(([id, t]) => {
      const pregunta = banco.find((p) => p.id === id);
      return pregunta && pregunta.area === area && t.caja >= 3;
    }).length;
    const total = banco.filter((p) => p.area === area).length;
    return {
      area,
      nivel: areaState.nivel,
      aciertoReciente,
      estables,
      total,
      noLoSe: areaState.noLoSe || 0,
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
  return {
    racha: estado.racha,
    xp: estado.xp,
    hoy: { respondidas: estado.hoy.respondidas, aciertos: estado.hoy.aciertos },
    porArea,
    global,
  };
}

/** Serializa el estado a JSON. */
export function exportar(estado) {
  return JSON.stringify(estado);
}

/** Deserializa y valida un estado exportado. Lanza si la versión no coincide o falta estructura. */
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
  if (obj.version !== 1) {
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
 */
function normalizarEstado(obj) {
  const base = crearEstado(esObjeto(obj.hoy) && RE_FECHA.test(obj.hoy.fecha) ? obj.hoy.fecha : '1970-01-01');
  const estado = { ...base, version: 1 };
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
        };
      }
    }
  }
  estado.reportadas = Array.isArray(obj.reportadas) ? obj.reportadas.filter((x) => typeof x === 'string') : [];
  estado.historial = Array.isArray(obj.historial) ? obj.historial.filter(esObjeto).slice(-500) : [];
  return estado;
}
