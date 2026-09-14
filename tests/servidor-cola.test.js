// Tests de servidor/almacen.js y servidor/cola.js (Tarea 2 del plan v0.2b1-servidor).
// Sin red: todo `producirTanda` es una función falsa inyectada. Carpeta temporal por test
// (fs.mkdtemp), como pide el controlador. Spec que manda:
// docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.1, §3.2 y §3.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crearAlmacen } from '../servidor/almacen.js';
import { crearCola } from '../servidor/cola.js';

async function carpetaTmp() {
  return mkdtemp(path.join(os.tmpdir(), 'one-servidor-'));
}

// Espera activa con temporizador REAL (no microtareas) hasta que `condicion()` sea verdadera. Se
// usa porque almacen.js hace I/O de disco real incluso en tests (carpeta temporal): un simple
// `await Promise.resolve()` no basta para dejar que una lectura/escritura real de fichero termine.
async function hastaQue(condicion, { intentos = 400, esperaMs = 5 } = {}) {
  for (let i = 0; i < intentos; i++) {
    if (condicion()) return;
    await new Promise((resolver) => setTimeout(resolver, esperaMs));
  }
  throw new Error('hastaQue: la condición no se cumplió a tiempo');
}

function aprobada(area, n = 1, extra = {}) {
  return {
    id: `srv-${area.slice(0, 3)}-${Math.random().toString(36).slice(2, 8)}`,
    area,
    tipo: 'vf',
    nivel: 2,
    enunciado: `Enunciado ${area} #${n}`,
    explicacion: 'una explicación corta',
    respuesta: true,
    visual: null,
    ...extra,
  };
}

function resultadoOk(area, n, aprobadas = 1) {
  const lista = Array.from({ length: aprobadas }, (_, i) => aprobada(area, i));
  return { aprobadas: lista, rechazadas: [], coste: 0.0001, modelos: ['modelo-falso'], fallos: [], pedidas: n, obtenidas: aprobadas };
}

function resultadoVacio(n) {
  return { aprobadas: [], rechazadas: [], coste: 0, modelos: [], fallos: [], pedidas: n, obtenidas: 0 };
}

// === servidor/almacen.js ======================================================================

test('almacen: leerColchon/leerRechazadas/leerAnillos/leerReportadas devuelven vacío si el fichero no existe', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  assert.deepEqual(await almacen.leerColchon(), []);
  assert.deepEqual(await almacen.leerRechazadas(), []);
  assert.deepEqual(await almacen.leerAnillos(), {});
  assert.deepEqual(await almacen.leerReportadas(), []);
});

test('almacen: guardarColchon escribe JSON válido de forma atómica (no queda .tmp) y se puede releer', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const lista = [{ id: 'srv-eco-a1', area: 'economia' }];

  await almacen.guardarColchon(lista);

  const ficheros = await readdir(dir);
  assert.ok(!ficheros.some((f) => f.endsWith('.tmp')), 'no debe quedar ningún .tmp tras escribir');
  assert.ok(ficheros.includes('colchon.json'));

  const releido = await almacen.leerColchon();
  assert.deepEqual(releido, lista);

  const textoCrudo = await readFile(path.join(dir, 'colchon.json'), 'utf8');
  assert.equal(textoCrudo, JSON.stringify(lista, null, 1), 'JSON "pretty" de 1 espacio');
});

test('almacen: mkdir -p -- crea la carpeta de datos si no existe todavía', async () => {
  const base = await carpetaTmp();
  const dir = path.join(base, 'sub', 'anidada');
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([{ id: 'x' }]);
  assert.deepEqual(await almacen.leerColchon(), [{ id: 'x' }]);
});

test('almacen: un colchon.json corrupto se renombra a .roto-<ISO> y se parte de vacío, sin lanzar', async () => {
  const dir = await carpetaTmp();
  await writeFile(path.join(dir, 'colchon.json'), '{ esto no es json', 'utf8');
  const almacen = crearAlmacen(dir);

  const leido = await almacen.leerColchon();
  assert.deepEqual(leido, []);

  const ficheros = await readdir(dir);
  assert.ok(!ficheros.includes('colchon.json'), 'el fichero corrupto ya no está con su nombre original');
  assert.ok(ficheros.some((f) => f.startsWith('colchon.json.roto-')), 'debe existir el .roto-<ISO>');
});

test('almacen: anadirRechazadas acumula y trunca a las últimas 500', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const primeras = Array.from({ length: 490 }, (_, i) => ({ borrador: { enunciado: `a${i}` }, motivo: 'x', fecha: '2026-01-01' }));
  await almacen.anadirRechazadas(primeras);
  const masTarde = Array.from({ length: 20 }, (_, i) => ({ borrador: { enunciado: `b${i}` }, motivo: 'y', fecha: '2026-01-02' }));
  await almacen.anadirRechazadas(masTarde);

  const todas = await almacen.leerRechazadas();
  assert.equal(todas.length, 500);
  assert.equal(todas[todas.length - 1].borrador.enunciado, 'b19');
  assert.equal(todas[0].borrador.enunciado, 'a10', 'se descartan las 10 más antiguas para caber en 500');
});

test('almacen: guardarAnillo hace merge por clave, no pisa las demás claves ya guardadas', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarAnillo('economia/Inflación', ['IPC', 'deflación']);
  await almacen.guardarAnillo('historia/Roma', ['República', 'Imperio']);

  const anillos = await almacen.leerAnillos();
  assert.deepEqual(anillos, {
    'economia/Inflación': ['IPC', 'deflación'],
    'historia/Roma': ['República', 'Imperio'],
  });
});

test('almacen: anadirReportada no duplica el mismo id', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.anadirReportada('srv-eco-a1');
  await almacen.anadirReportada('srv-eco-a1');
  await almacen.anadirReportada('srv-his-b2');

  assert.deepEqual(await almacen.leerReportadas(), ['srv-eco-a1', 'srv-his-b2']);
});

test('almacen: escribirAtomico es de propósito general (nombre de fichero cualquiera) y también es atómico', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.escribirAtomico('otra-cosa.json', { hola: 'mundo' });
  const ficheros = await readdir(dir);
  assert.ok(!ficheros.some((f) => f.endsWith('.tmp')));
  const texto = await readFile(path.join(dir, 'otra-cosa.json'), 'utf8');
  assert.deepEqual(JSON.parse(texto), { hola: 'mundo' });
});

// === servidor/cola.js: encolar / estadoTrabajo / prioridad / concurrencia ====================

test('cola: encolar valida que falte area, y estadoTrabajo de un id desconocido devuelve null', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });
  assert.throws(() => cola.encolar({}));
  assert.equal(cola.estadoTrabajo('t-no-existe'), null);
});

test('cola: estadoTrabajo pasa en-cola -> generando -> parcial -> lista (producirTanda falso, dos lotes de 5)', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const pendientes = [];
  const producirTandaFalso = async (params) => {
    return new Promise((resolver) => pendientes.push({ resolver, area: params.area, n: params.n }));
  };
  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });

  // Un "bloqueador" ocupa el único trabajador para poder observar el trabajo objetivo todavía
  // "en-cola" (si no hay nada corriendo, un trabajo nuevo arranca de inmediato y nunca se vería
  // ese estado).
  cola.encolar({ area: 'ciencia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => pendientes.length === 1);

  const { trabajoId } = cola.encolar({ area: 'economia', ruta: [], n: 10, urgente: false });
  assert.equal(cola.estadoTrabajo(trabajoId).estado, 'en-cola');

  // Libera el bloqueador (su resultado no importa) para que el trabajador pase al objetivo.
  pendientes[0].resolver(resultadoVacio(5));
  await hastaQue(() => pendientes.length === 2);
  assert.equal(cola.estadoTrabajo(trabajoId).estado, 'generando');
  assert.equal(pendientes[1].area, 'economia');
  assert.equal(pendientes[1].n, 5, 'lotes de 5, no los 10 pedidos de una vez');

  // Primer lote: 5 aprobadas de 10 pedidas -> parcial (hay aprobadas y queda un lote).
  pendientes[1].resolver(resultadoOk('economia', 5, 5));
  await hastaQue(() => cola.estadoTrabajo(trabajoId).hechas === 5);
  assert.equal(cola.estadoTrabajo(trabajoId).estado, 'parcial');

  await hastaQue(() => pendientes.length === 3);
  assert.equal(pendientes[2].n, 5);

  // Segundo lote: termina, sin fallos -> lista.
  pendientes[2].resolver(resultadoOk('economia', 5, 5));
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
  const final = cola.estadoTrabajo(trabajoId);
  assert.equal(final.hechas, 10);
  assert.equal(final.pedidas, 10);
  assert.equal(final.preguntas.length, 10);
});

test('cola: un trabajo con 0 aprobadas al terminar todos sus lotes queda "fallida"', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async (params) => resultadoVacio(params.n) });

  const { trabajoId } = cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'fallida');
  assert.equal(cola.estadoTrabajo(trabajoId).preguntas.length, 0);
});

test('cola: un trabajo con fallos parciales pero al menos 1 aprobada termina "parcial", no "lista"', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  let llamada = 0;
  const producirTandaFalso = async (params) => {
    llamada++;
    if (llamada === 1) return resultadoOk('geografia', params.n, 3);
    throw new Error('cascada agotada (simulado)');
  };
  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });

  const { trabajoId } = cola.encolar({ area: 'geografia', ruta: [], n: 10, urgente: false });
  // OJO: 'parcial' es también el estado INTERMEDIO entre lotes (spec: "≥1 aprobada y quedan
  // lotes"), así que no sirve como señal de fin -- se espera a `hechas === pedidas` (todos los
  // lotes ya intentados) y solo entonces se lee el estado final.
  await hastaQue(() => cola.estadoTrabajo(trabajoId).hechas === 10);
  const final = cola.estadoTrabajo(trabajoId);
  assert.equal(final.estado, 'parcial', 'huboFallo=true con >=1 aprobada al terminar: parcial, no lista');
  assert.equal(final.preguntas.length, 3);
  assert.equal(final.hechas, 10, 'el lote fallido cuenta como consumido, no se reintenta infinitamente');
});

test('cola: un trabajo urgente encolado después de uno de fondo se procesa antes (prioridad)', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const ordenProcesado = [];
  const pendientesBloqueo = [];
  const producirTandaFalso = async (params) => {
    if (params.area === 'ciencia') {
      return new Promise((resolver) => pendientesBloqueo.push(resolver));
    }
    ordenProcesado.push(params.area);
    return resultadoOk(params.area, params.n, 1);
  };
  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });

  cola.encolar({ area: 'ciencia', ruta: [], n: 5, urgente: false }); // ocupa el único trabajador
  await hastaQue(() => pendientesBloqueo.length === 1);

  cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false }); // fondo, encolado primero
  cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: true }); // urgente, encolado después

  pendientesBloqueo[0](resultadoVacio(5));

  await hastaQue(() => ordenProcesado.length === 2);
  assert.deepEqual(ordenProcesado, ['economia', 'historia'], 'lo urgente se procesa antes aunque haya llegado después');
});

test('cola: dos encolar seguidos nunca dejan a producirTanda con más de 1 llamada en curso a la vez', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  let enCurso = 0;
  let maxEnCurso = 0;
  const producirTandaFalso = async (params) => {
    enCurso++;
    maxEnCurso = Math.max(maxEnCurso, enCurso);
    await new Promise((r) => setTimeout(r, 15));
    enCurso--;
    return resultadoOk(params.area, params.n, 1);
  };
  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });

  const t1 = cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: false });
  const t2 = cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });

  await hastaQue(
    () => cola.estadoTrabajo(t1.trabajoId)?.estado === 'lista' && cola.estadoTrabajo(t2.trabajoId)?.estado === 'lista',
  );
  assert.equal(maxEnCurso, 1, 'nunca debe haber más de 1 llamada a producirTanda en curso a la vez');
});

// === servidor/cola.js: calcularObjetivo / rellenarHaciaObjetivo ==============================

test('calcularObjetivo: sin áreas flojas y sin rutasAtomo, reparte los 30 entre TODAS las áreas', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  const resumen = { areas: { economia: { nivel: 4, aciertoReciente: 0.9 } } }; // ninguna floja
  const objetivo = await cola.calcularObjetivo(resumen, []);

  const total = objetivo.reduce((suma, o) => suma + o.faltan, 0);
  assert.equal(total, 30);
  assert.ok(objetivo.every((o) => o.ruta.length === 0), 'sin rutasAtomo, todo va a nivel de área');
});

test('calcularObjetivo: 60 % a las áreas flojas (aciertoReciente<0.6 o nivel<=2), 40 % a rutasAtomo', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  const resumen = {
    areas: {
      economia: { nivel: 4, aciertoReciente: 0.4 }, // floja por acierto
      historia: { nivel: 2, aciertoReciente: 0.9 }, // floja por nivel
      ciencia: { nivel: 5, aciertoReciente: 0.95 }, // no floja
    },
  };
  const rutasAtomo = [{ area: 'ciencia', ruta: ['Física del día a día'] }];

  const objetivo = await cola.calcularObjetivo(resumen, rutasAtomo);

  const totalAreas = objetivo.filter((o) => o.ruta.length === 0).reduce((s, o) => s + o.faltan, 0);
  const totalRutas = objetivo.filter((o) => o.ruta.length > 0).reduce((s, o) => s + o.faltan, 0);
  assert.equal(totalAreas, 18, '60 % repartido entre economia e historia (las flojas)');
  assert.equal(totalRutas, 12, '40 % a la ruta del átomo recibida');
  assert.ok(objetivo.some((o) => o.area === 'economia' && o.ruta.length === 0));
  assert.ok(objetivo.some((o) => o.area === 'historia' && o.ruta.length === 0));
  assert.ok(!objetivo.some((o) => o.area === 'ciencia' && o.ruta.length === 0), 'ciencia no es floja: sin cuota de área');
  assert.ok(objetivo.some((o) => o.area === 'ciencia' && o.ruta.length > 0));
});

test('calcularObjetivo: descuenta lo que ya hay en el colchón no servido y omite lo que ya está cubierto', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  // Con una sola área floja, le tocarían los 30 enteros; sembramos 30 ya en el colchón (no
  // servidas) para esa área y comprobamos que no se pide nada más.
  const yaHay = Array.from({ length: 30 }, (_, i) => ({
    id: `srv-eco-${i}`,
    area: 'economia',
    ruta: ['economia'],
    creada: new Date(2026, 0, 1 + i).toISOString(),
    servida: null,
  }));
  await almacen.guardarColchon(yaHay);

  const resumen = { areas: { economia: { nivel: 1, aciertoReciente: 0.1 } } };
  const objetivo = await cola.calcularObjetivo(resumen, []);
  assert.deepEqual(objetivo, [], 'ya hay 30 sin servir de la única área floja: no falta nada');
});

test('rellenarHaciaObjetivo: encola un trabajo de fondo por entrada faltante, sin duplicar uno ya en cola', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const pendientes = [];
  const cola = crearCola({
    almacen,
    producirTanda: async (params) => new Promise((resolver) => pendientes.push({ resolver, area: params.area })),
  });

  const resumen = { areas: { economia: { nivel: 1, aciertoReciente: 0.1 } } }; // única floja
  await cola.rellenarHaciaObjetivo(resumen, []);
  await hastaQue(() => pendientes.length === 1, { intentos: 100 });
  assert.equal(pendientes[0].area, 'economia');

  // Volver a llamar mientras el trabajo de "economia" sigue en curso no debe encolar un segundo
  // trabajo de fondo para la misma área/ruta.
  await cola.rellenarHaciaObjetivo(resumen, []);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(pendientes.length, 1, 'no se duplica un trabajo de fondo ya en cola para la misma área');

  pendientes[0].resolver(resultadoVacio(30));
});

// === servidor/cola.js: servir / reportar ======================================================

test('servir: excluye idsConocidos y reportadas, marca servida y persiste', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  await almacen.guardarColchon([
    { id: 'srv-eco-1', area: 'economia', creada: '2026-01-01T00:00:00.000Z', servida: null, enunciado: 'a' },
    { id: 'srv-eco-2', area: 'economia', creada: '2026-01-02T00:00:00.000Z', servida: null, enunciado: 'b' },
    { id: 'srv-eco-3', area: 'economia', creada: '2026-01-03T00:00:00.000Z', servida: null, enunciado: 'c' },
  ]);
  await almacen.anadirReportada('srv-eco-2');

  const servidas = await cola.servir({ idsConocidos: ['srv-eco-3'], resumen: {}, max: 10 });

  assert.equal(servidas.length, 1);
  assert.equal(servidas[0].id, 'srv-eco-1');
  assert.ok(servidas[0].servida, 'la pregunta devuelta ya lleva la marca servida');

  const colchonTrasServir = await almacen.leerColchon();
  const guardada = colchonTrasServir.find((p) => p.id === 'srv-eco-1');
  assert.ok(guardada.servida, 'la marca servida se persiste en disco');
  assert.equal(colchonTrasServir.find((p) => p.id === 'srv-eco-2').servida, null, 'la reportada no se toca');
  assert.equal(colchonTrasServir.find((p) => p.id === 'srv-eco-3').servida, null, 'la conocida no se sirve');
});

test('servir: prioriza el área con menor aciertoReciente (sin datos cuenta como 0.5), luego la más antigua', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  await almacen.guardarColchon([
    { id: 'srv-cie-1', area: 'ciencia', creada: '2026-01-01T00:00:00.000Z', servida: null }, // acierto 0.9
    { id: 'srv-his-1', area: 'historia', creada: '2026-01-02T00:00:00.000Z', servida: null }, // sin datos -> 0.5
    { id: 'srv-eco-1', area: 'economia', creada: '2026-01-03T00:00:00.000Z', servida: null }, // acierto 0.2 (peor)
    { id: 'srv-eco-2', area: 'economia', creada: '2026-01-01T12:00:00.000Z', servida: null }, // acierto 0.2, más antigua
  ]);

  const resumen = { areas: { ciencia: { aciertoReciente: 0.9 }, economia: { aciertoReciente: 0.2 } } };
  const servidas = await cola.servir({ idsConocidos: [], resumen, max: 4 });

  const ids = servidas.map((p) => p.id);
  assert.deepEqual(ids, ['srv-eco-2', 'srv-eco-1', 'srv-his-1', 'srv-cie-1']);
});

test('reportar: quita la pregunta del colchón y no se vuelve a servir', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  await almacen.guardarColchon([
    { id: 'srv-eco-1', area: 'economia', creada: '2026-01-01T00:00:00.000Z', servida: null },
    { id: 'srv-eco-2', area: 'economia', creada: '2026-01-02T00:00:00.000Z', servida: null },
  ]);

  await cola.reportar('srv-eco-1');

  const colchon = await almacen.leerColchon();
  assert.equal(colchon.length, 1);
  assert.equal(colchon[0].id, 'srv-eco-2');
  assert.deepEqual(await almacen.leerReportadas(), ['srv-eco-1']);

  const servidas = await cola.servir({ idsConocidos: [], resumen: {}, max: 10 });
  assert.ok(!servidas.some((p) => p.id === 'srv-eco-1'), 'una reportada nunca se sirve, aunque ya no esté en el colchón');
});

test('cola.estadisticas() refleja el tamaño de la cola de espera', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const pendientes = [];
  const cola = crearCola({
    almacen,
    producirTanda: async () => new Promise((resolver) => pendientes.push(resolver)),
  });

  cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => pendientes.length === 1);
  cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });

  const stats = cola.estadisticas();
  assert.equal(stats.activo, 1);
  assert.equal(stats.enCola, 1);

  pendientes[0](resultadoVacio(5));
});
