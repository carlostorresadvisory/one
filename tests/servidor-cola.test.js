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
    // `await` sobre un valor síncrono lo deja pasar tal cual, así que esto sirve tanto para una
    // `condicion` normal como para una `async` (necesaria en algún test de la Ronda 2, que
    // comprueba el colchón en disco dentro de la propia condición).
    if (await condicion()) return;
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

// Ronda final (revisión, 14-sep-2026) -- Menor (M6): el motivo se guarda aparte (reportadas.json
// sigue siendo el array plano de ids que ya usa cola.js#servir, sin tocar ese contrato).
test('almacen: anadirReportada(id, motivo) guarda el motivo recortado a 200 caracteres, sin tocar reportadas.json', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const motivoLargo = 'x'.repeat(250);

  await almacen.anadirReportada('srv-eco-a1', motivoLargo);
  await almacen.anadirReportada('srv-eco-a2'); // sin motivo: no debe romper nada

  assert.deepEqual(await almacen.leerReportadas(), ['srv-eco-a1', 'srv-eco-a2']);
  const motivos = await almacen.leerMotivosReportados();
  assert.equal(motivos['srv-eco-a1'].length, 200);
  assert.equal(motivos['srv-eco-a1'], 'x'.repeat(200));
  assert.equal(motivos['srv-eco-a2'], undefined);
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

test('almacen: conCerrojo serializa llamadas para el mismo nombre (nunca dos fn del mismo fichero a la vez) y respeta el orden de llegada', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  let enCurso = 0;
  let maxEnCurso = 0;
  const orden = [];

  const trabajo = (etiqueta, ms) => async () => {
    enCurso++;
    maxEnCurso = Math.max(maxEnCurso, enCurso);
    await new Promise((r) => setTimeout(r, ms));
    orden.push(etiqueta);
    enCurso--;
    return etiqueta;
  };

  const [r1, r2, r3] = await Promise.all([
    almacen.conCerrojo('colchon.json', trabajo('a', 20)),
    almacen.conCerrojo('colchon.json', trabajo('b', 5)),
    almacen.conCerrojo('colchon.json', trabajo('c', 1)),
  ]);

  assert.equal(maxEnCurso, 1, 'nunca dos funciones del mismo nombre en curso a la vez');
  assert.deepEqual(orden, ['a', 'b', 'c'], 'se respeta el orden de llegada, no el de duración');
  assert.deepEqual([r1, r2, r3], ['a', 'b', 'c'], 'cada llamada recibe SU PROPIO resultado');
});

test('almacen: conCerrojo -- una fn que lanza no bloquea las siguientes llamadas para el mismo nombre', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);

  await assert.rejects(
    () => almacen.conCerrojo('colchon.json', async () => { throw new Error('boom'); }),
    /boom/,
  );

  // Si el fallo hubiera dejado la cola "atascada", esta segunda llamada nunca resolvería.
  const resultado = await almacen.conCerrojo('colchon.json', async () => 'sigue-funcionando');
  assert.equal(resultado, 'sigue-funcionando');
});

test('almacen: conCerrojo -- nombres distintos no se bloquean entre sí', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const orden = [];

  const lento = almacen.conCerrojo('colchon.json', async () => {
    await new Promise((r) => setTimeout(r, 30));
    orden.push('colchon');
  });
  const rapido = almacen.conCerrojo('reportadas.json', async () => {
    orden.push('reportadas');
  });

  await Promise.all([lento, rapido]);
  assert.deepEqual(orden, ['reportadas', 'colchon'], 'reportadas.json no espera a que termine colchon.json');
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

test('cola (Ronda 1): un urgente se cuela ENTRE LOTES de un fondo ya en marcha; el fondo retoma después y termina "lista"', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const llamadas = []; // 'fondo-loteN' / 'urgente-loteN', en el orden real de llamada a producirTanda
  const pendientesUrgente = [];
  let loteFondo = 0;
  let loteUrgente = 0;
  const producirTandaFalso = async (params) => {
    if (params.area === 'historia') {
      loteFondo++;
      llamadas.push(`fondo-lote${loteFondo}`);
      return resultadoOk('historia', params.n, 5); // no se pausa: cada lote de fondo resuelve solo
    }
    loteUrgente++;
    llamadas.push(`urgente-lote${loteUrgente}`);
    return new Promise((resolver) => pendientesUrgente.push(resolver));
  };
  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });

  const { trabajoId: idFondo } = cola.encolar({ area: 'historia', ruta: [], n: 10, urgente: false });
  // Encolado en la MISMA vuelta síncrona que el de fondo: el fondo todavía no ha llegado ni a
  // llamar a producirTanda para su primer lote (sigue en el `await` real de calcularEvitar), así
  // que este urgente queda en cola ANTES de que el fondo procese su primer lote -- justo el
  // escenario "llega mientras corre el primer lote de fondo" que pide el controlador.
  cola.encolar({ area: 'economia', ruta: [], n: 10, urgente: true });

  await hastaQue(() => llamadas.includes('urgente-lote1'));
  assert.deepEqual(llamadas, ['fondo-lote1', 'urgente-lote1'], 'el urgente se cuela justo tras el primer lote del fondo');

  const mientrasEspera = cola.estadoTrabajo(idFondo);
  assert.equal(mientrasEspera.hechas, 5, 'el fondo conserva su progreso al ceder');
  assert.equal(mientrasEspera.preguntas.length, 5, 'las 5 aprobadas del primer lote ya están guardadas');
  assert.equal(mientrasEspera.estado, 'parcial');

  pendientesUrgente[0](resultadoOk('economia', 5, 5));
  await hastaQue(() => llamadas.includes('urgente-lote2'));
  pendientesUrgente[1](resultadoOk('economia', 5, 5));

  await hastaQue(() => cola.estadoTrabajo(idFondo)?.estado === 'lista');
  assert.deepEqual(llamadas, ['fondo-lote1', 'urgente-lote1', 'urgente-lote2', 'fondo-lote2']);
  const final = cola.estadoTrabajo(idFondo);
  assert.equal(final.hechas, 10);
  assert.equal(final.preguntas.length, 10);
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

// === servidor/cola.js: segundosPorPregunta / preguntasPorDelante (v0.2b4 §6c) =================

// Reloj falso inyectable (v0.2b4 §6c): la media móvil mide segundos reales, y un test no puede
// esperar 20 s por tanda. `avanzar(ms)` simula el paso del tiempo entre lotes.
function relojFalso(inicio = 0) {
  let ahora = inicio;
  return { leer: () => ahora, avanzar: (ms) => { ahora += ms; } };
}

test('cola v0.2b4 §6c: segundosPorPregunta arranca en 20 y pasa a ser la media de las tandas medidas', async () => {
  const carpeta = await carpetaTmp();
  const almacen = crearAlmacen(carpeta);
  const reloj = relojFalso();
  const producirTanda = async ({ area, n }) => {
    reloj.avanzar(n * 6000); // 6 s por pregunta en este lote
    return resultadoOk(area, n, n);
  };
  const cola = crearCola({ almacen, producirTanda, reloj: reloj.leer });

  assert.equal(cola.estadisticas().segundosPorPregunta, 20); // arranque en frío

  const { trabajoId } = cola.encolar({ area: 'economia', n: 5, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(trabajoId)?.estado === 'lista');
  assert.equal(cola.estadisticas().segundosPorPregunta, 6);
  // `/trabajo/:id` la devuelve para que el móvil afine su cuenta atrás.
  assert.equal(cola.estadoTrabajo(trabajoId).segundosPorPregunta, 6);
});

// Ronda de corrección 1 (revisión Opus, Important #2): un trabajo de fondo que cede el turno a un
// urgente conservaba `inicio` desde su primer lote -- la muestra medía tiempo de PARED de punta a
// punta, así que se comía íntegro el tiempo que el urgente tardó mientras el de fondo esperaba su
// turno. `rellenarHaciaObjetivo` se dispara en cada /estado (servidor/index.js), así que fondo y
// urgentes conviven a diario: con ventana de 5 muestras, una sola cesión inflaba el estimadoSeg de
// TODOS los usuarios siguientes. La media debe medir solo el tiempo ACTIVO de este trabajo (sus
// propios lotes), nunca el tiempo que pasó aparcado mientras otro trabajo ocupaba al trabajador.
test('cola v0.2b4 §6c (corrección 1): un fondo que cede el turno a un urgente NO incorpora el tiempo del urgente a su propia muestra', async () => {
  const carpeta = await carpetaTmp();
  const almacen = crearAlmacen(carpeta);
  const reloj = relojFalso();
  const producirTanda = async ({ area, n }) => {
    if (area === 'historia') {
      reloj.avanzar(10000); // 10 s de trabajo ACTIVO real por lote (2 lotes de 5 -> 20 s en total)
      return resultadoOk(area, n, n);
    }
    // El urgente ('economia') tarda muchísimo MIENTRAS el de fondo está cedido/aparcado, y no debe
    // dejar ninguna muestra propia (0 aprobadas -> 'fallida', fuera de la ventana de medición) para
    // que la única muestra que acabe en la media sea la del propio 'historia'.
    reloj.avanzar(100000); // 100 s "perdidos" por el de fondo si el bug sigue vivo
    return resultadoVacio(n);
  };
  const cola = crearCola({ almacen, producirTanda, reloj: reloj.leer });

  // Mismo patrón que el test de Ronda 1 en la sección de arriba: el urgente se encola en la MISMA
  // vuelta síncrona que el de fondo, así que ya está en `colaUrgente` cuando el primer lote de
  // 'historia' termina y decide si cede.
  const { trabajoId: idFondo } = cola.encolar({ area: 'historia', n: 10, urgente: false });
  cola.encolar({ area: 'economia', n: 5, urgente: true });

  await hastaQue(() => cola.estadoTrabajo(idFondo)?.estado === 'lista');

  // Con el fix: 20 s de trabajo activo / 10 preguntas = 2 s/pregunta. Con el bug (tiempo de pared
  // de punta a punta): (10 + 100 + 10) s / 10 preguntas = 12 s/pregunta.
  assert.equal(cola.estadisticas().segundosPorPregunta, 2);
});

test('cola v0.2b4 §6c: la media usa solo las últimas 5 tandas y las fallidas no cuentan', async () => {
  const carpeta = await carpetaTmp();
  const almacen = crearAlmacen(carpeta);
  const reloj = relojFalso();
  let segPorPregunta = 10;
  const producirTanda = async ({ area, n }) => {
    reloj.avanzar(n * segPorPregunta * 1000);
    return resultadoOk(area, n, n);
  };
  const cola = crearCola({ almacen, producirTanda, reloj: reloj.leer });
  for (let i = 0; i < 5; i += 1) {
    const { trabajoId } = cola.encolar({ area: 'economia', n: 5, urgente: true });
    await hastaQue(() => cola.estadoTrabajo(trabajoId)?.estado === 'lista');
  }
  assert.equal(cola.estadisticas().segundosPorPregunta, 10);
  segPorPregunta = 20;
  for (let i = 0; i < 5; i += 1) {
    const { trabajoId } = cola.encolar({ area: 'economia', n: 5, urgente: true });
    await hastaQue(() => cola.estadoTrabajo(trabajoId)?.estado === 'lista');
  }
  assert.equal(cola.estadisticas().segundosPorPregunta, 20); // las 5 viejas ya salieron de la ventana
});

test('cola v0.2b4 §6c: encolar dice cuántas preguntas hay POR DELANTE, no cuántos trabajos', async () => {
  const carpeta = await carpetaTmp();
  const almacen = crearAlmacen(carpeta);
  let resolverLote;
  const producirTanda = ({ area, n }) => new Promise((r) => { resolverLote = () => r(resultadoOk(area, n, n)); });
  const cola = crearCola({ almacen, producirTanda });

  const a = cola.encolar({ area: 'economia', n: 10, urgente: true });
  assert.equal(a.preguntasPorDelante, 0);
  assert.equal(a.pedidas, 10);
  await hastaQue(() => typeof resolverLote === 'function');
  const b = cola.encolar({ area: 'historia', n: 10, urgente: true });
  // El activo tiene 10 pedidas y 0 hechas: 10 preguntas por delante de `b`.
  assert.equal(b.preguntasPorDelante, 10);
  resolverLote();
});

test('cola v0.2b4 §6c: una tanda fallida (0 hechas antes de terminar) no ensucia la media móvil', async () => {
  // Caso borde pedido en la autorrevisión: un trabajo puede terminar 'fallida' con preguntas.length
  // === 0 -- finalizarTrabajo no debe intentar dividir por trabajo.hechas === 0 ni registrar una
  // muestra falsa. La media móvil debe seguir en el valor inicial (20) tras un fallo total.
  const carpeta = await carpetaTmp();
  const almacen = crearAlmacen(carpeta);
  const reloj = relojFalso();
  const cola = crearCola({ almacen, producirTanda: async (params) => resultadoVacio(params.n), reloj: reloj.leer });

  const { trabajoId } = cola.encolar({ area: 'historia', n: 5, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(trabajoId)?.estado === 'fallida');

  assert.equal(cola.estadisticas().segundosPorPregunta, 20, 'una tanda sin ninguna aprobada no debe alterar la media');
});

test('cola v0.2b4 §1: un trabajo terminado se conserva al menos 1 h (antes se tiraba al llegar a 100)', async () => {
  const carpeta = await carpetaTmp();
  const almacen = crearAlmacen(carpeta);
  const reloj = relojFalso();
  const cola = crearCola({ almacen, producirTanda: async ({ area, n }) => resultadoOk(area, n, n), reloj: reloj.leer });

  const primero = cola.encolar({ area: 'economia', n: 5, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(primero.trabajoId)?.estado === 'lista');

  // 150 tandas más (muy por encima del viejo tope de 100) dentro de la misma hora.
  for (let i = 0; i < 150; i += 1) {
    const { trabajoId } = cola.encolar({ area: 'historia', n: 5, urgente: true });
    await hastaQue(() => cola.estadoTrabajo(trabajoId)?.estado === 'lista');
    reloj.avanzar(1000);
  }
  assert.notEqual(cola.estadoTrabajo(primero.trabajoId), null); // sigue ahí: no ha pasado la hora

  reloj.avanzar(60 * 60 * 1000);
  const ultimo = cola.encolar({ area: 'ciencia', n: 5, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(ultimo.trabajoId)?.estado === 'lista');
  assert.equal(cola.estadoTrabajo(primero.trabajoId), null); // ya pasó la hora: se purga
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

// Ola final v0.2b4.1 (C2): `rellenarHaciaObjetivo` se dispara en CADA `POST /estado`, y el relleno
// del colchón es lo último que importa cuando hay un jugador esperando su tanda: cada trabajo de
// fondo que entra en la cola es un turno más que el urgente puede acabar esperando (medido en
// vivo el 15-sep: 5 m 23 s detrás de UN lote de fondo). Si hay un urgente en cola o en curso, el
// colchón espera al siguiente /estado -- no se pierde nada, se llama cada pocos segundos.
test('rellenarHaciaObjetivo (C2): no encola nada de fondo mientras hay un urgente en cola o en curso', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const pendientes = [];
  const cola = crearCola({
    almacen,
    producirTanda: async (params) => new Promise((resolver) => pendientes.push({ resolver, area: params.area })),
  });

  const resumen = { areas: { economia: { nivel: 1, aciertoReciente: 0.1 } } };
  cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: true }); // un solo lote: termina de una
  await hastaQue(() => pendientes.length === 1, { intentos: 100 });
  assert.equal(pendientes[0].area, 'historia', 'el urgente es lo que está en curso');

  const encolados = await cola.rellenarHaciaObjetivo(resumen, []);
  assert.deepEqual(encolados, [], 'con un urgente en curso, el relleno del colchón se salta entero');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(pendientes.length, 1, 'no ha arrancado ningún trabajo de fondo');

  // En cuanto el urgente termina, el siguiente /estado sí rellena.
  pendientes[0].resolver(resultadoVacio(5));
  await hastaQue(() => cola.estadisticas().enCola === 0 && cola.estadisticas().activo === 0);
  const despues = await cola.rellenarHaciaObjetivo(resumen, []);
  assert.ok(despues.length > 0, 'sin urgentes, el relleno vuelve a funcionar como siempre');
  await hastaQue(() => pendientes.length > 1, { intentos: 100 });
  for (const p of pendientes.slice(1)) p.resolver(resultadoVacio(5));
});

test('cola (C2): un lote de FONDO recibe `hayUrgente`, y dice la verdad sobre la cola de urgentes', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const vistas = [];
  let resolverFondo;
  const cola = crearCola({
    almacen,
    producirTanda: (params, opciones) => {
      vistas.push({ area: params.area, urgente: opciones.urgente, hayUrgente: opciones.hayUrgente });
      return new Promise((r) => { resolverFondo = () => r(resultadoVacio(params.n)); });
    },
  });

  cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => vistas.length === 1);
  assert.equal(typeof vistas[0].hayUrgente, 'function', 'la cola inyecta la consulta en cada lote');
  assert.equal(vistas[0].hayUrgente(), false, 'nadie esperando todavía');

  cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: true });
  assert.equal(vistas[0].hayUrgente(), true, 'el urgente recién encolado se ve desde el lote en curso');

  resolverFondo();
  await hastaQue(() => vistas.length >= 2);
  resolverFondo();
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
  // Ronda final (revisión, 14-sep-2026) -- Menor (M4): lo que se devuelve nunca lleva los campos de
  // gestión interna del colchón -- `servida` (y origen/creada/ruta) son cosa de este módulo, no del
  // cliente. La marca sí se persiste en disco (comprobado justo debajo, sobre almacen.leerColchon()).
  assert.equal(servidas[0].servida, undefined, 'la respuesta al cliente no lleva "servida"');
  assert.equal(servidas[0].creada, undefined, 'ni "creada"');
  assert.equal(servidas[0].origen, undefined, 'ni "origen"');
  assert.equal(servidas[0].ruta, undefined, 'ni "ruta"');

  const colchonTrasServir = await almacen.leerColchon();
  const guardada = colchonTrasServir.find((p) => p.id === 'srv-eco-1');
  assert.ok(guardada.servida, 'la marca servida se persiste en disco');
  assert.equal(colchonTrasServir.find((p) => p.id === 'srv-eco-2').servida, null, 'la reportada no se toca');
  // Ronda final (revisión, 14-sep-2026) -- Critical (C3): la conocida NO se vuelve a servir (no
  // aparece en `servidas`), pero SÍ se marca `servida` en disco -- si no, se queda `servida: null`
  // para siempre (nunca se purga, y calcularObjetivo la sigue contando como "colchón disponible"
  // aunque el móvil ya la tenga y no vaya a volver a pedirla).
  assert.ok(colchonTrasServir.find((p) => p.id === 'srv-eco-3').servida, 'la conocida se marca servida aunque no se reenvíe');
});

// Ronda final (revisión, 14-sep-2026), Critical C3: test dedicado al caso que motivó el fix --
// una pregunta que llegó por /trabajo/:id (POST /generar urgente) nunca pasa por `servir()` hasta
// que el móvil la reporta como conocida en un /estado posterior.
test('servir (Ronda final, C3): una conocida que nunca había pasado por servir() también se marca servida', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  // Simula lo que deja un trabajo urgente ya terminado: entra en el colchón vía guardarNuevasEnColchon
  // (aquí, directamente con guardarColchon) sin que nadie la haya servido todavía.
  await almacen.guardarColchon([
    { id: 'srv-eco-urgente-1', area: 'economia', creada: new Date().toISOString(), servida: null, enunciado: 'x' },
  ]);

  const servidas = await cola.servir({ idsConocidos: ['srv-eco-urgente-1'], resumen: {}, max: 10 });
  assert.equal(servidas.length, 0, 'no se reenvía: el móvil ya la conoce');

  const colchon = await almacen.leerColchon();
  assert.ok(colchon[0].servida, 'se marca servida en cuanto el móvil confirma que ya la conoce');
});

test('v0.2b4.1 §5: `visualPendiente` llega al cliente; los campos internos del colchón siguen sin salir', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    {
      ...aprobada('economia', 1, { visual: null, visualPendiente: true }),
      origen: 'servidor',
      creada: '2026-09-15T10:00:00.000Z',
      servida: null,
      actualizadaEn: '2026-09-15T10:05:00.000Z',
    },
  ]);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(0) });

  const [servida] = await cola.servir({ idsConocidos: [], resumen: {}, max: 5 });

  assert.equal(servida.visualPendiente, true, 'el cliente tiene que poder saber que falta el visual');
  assert.equal(servida.origen, undefined, 'campo interno del colchón');
  assert.equal(servida.creada, undefined);
  assert.equal(servida.actualizadaEn, undefined, 'la marca de actualización es logística, no contenido');
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

// === servidor/cola.js: Ronda 2 (revisión) -- Critical #1, mutex del colchón ===================

test('cola (Ronda 2): 20 servir({max:1}) concurrentes sobre un colchón de 20 reparten 20 ids distintos, todos marcados servida', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(5) });

  const semilla = Array.from({ length: 20 }, (_, i) => ({
    id: `srv-eco-${i}`,
    area: 'economia',
    creada: new Date(2026, 0, 1 + i).toISOString(),
    servida: null,
  }));
  await almacen.guardarColchon(semilla);

  const resultados = await Promise.all(
    Array.from({ length: 20 }, () => cola.servir({ idsConocidos: [], resumen: {}, max: 1 })),
  );

  const idsServidos = resultados.map((r) => r[0]?.id);
  assert.equal(idsServidos.filter(Boolean).length, 20, 'las 20 llamadas consiguieron una pregunta cada una');
  assert.equal(new Set(idsServidos).size, 20, 'sin lost update: 20 ids distintos, ninguno repetido');

  const colchonFinal = await almacen.leerColchon();
  assert.equal(colchonFinal.length, 20, 'no se ha perdido ninguna entrada por una escritura solapada');
  assert.ok(colchonFinal.every((p) => p.servida), 'las 20 quedan marcadas servida en disco');
});

test('cola (Ronda 2): servir() concurrente con el guardado de un lote no pierde ninguna aprobada', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);

  // Un colchón inicial pequeño para que haya algo que servir mientras se guarda un lote nuevo.
  await almacen.guardarColchon([
    { id: 'srv-eco-viejo', area: 'economia', creada: '2026-01-01T00:00:00.000Z', servida: null },
  ]);

  const pendienteLote = {};
  const cola = crearCola({
    almacen,
    producirTanda: async (params) =>
      new Promise((resolver) => {
        pendienteLote.resolver = resolver;
        pendienteLote.params = params;
      }),
  });

  cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => !!pendienteLote.resolver);

  // Se lanzan a la vez: servir() (lee+marca+escribe) y la resolución del lote (que dispara
  // guardarNuevasEnColchon, también lee+concatena+escribe). Sin el cerrojo, uno de los dos
  // guardados podía pisar al otro.
  const promesaServir = cola.servir({ idsConocidos: [], resumen: {}, max: 10 });
  pendienteLote.resolver(resultadoOk('historia', 5, 5));

  await promesaServir;
  await hastaQue(async () => {
    const c = await almacen.leerColchon();
    return c.length === 6; // 1 servida (sigue en el colchón, solo marcada) + 5 nuevas del lote
  });

  const final = await almacen.leerColchon();
  assert.equal(final.length, 6, 'ni la vieja servida ni las 5 nuevas del lote se han perdido');
  assert.equal(final.filter((p) => p.area === 'historia').length, 5, 'las 5 aprobadas del lote están todas');
});

// === servidor/cola.js: Ronda 2 (revisión) -- Critical #2, resiliencia a fallos de disco =======

test('cola (Ronda 2): una excepción de disco en guardarColchon (fuera de producirTanda) no mata al trabajador', async () => {
  const dir = await carpetaTmp();
  const almacenReal = crearAlmacen(dir);
  let vecesLanzado = 0;
  const almacenFalso = {
    ...almacenReal,
    async guardarColchon(lista) {
      if (vecesLanzado === 0) {
        vecesLanzado++;
        throw new Error('EACCES simulado (guardarColchon)');
      }
      return almacenReal.guardarColchon(lista);
    },
  };
  const cola = crearCola({
    almacen: almacenFalso,
    producirTanda: async (params) => resultadoOk(params.area, params.n, 5),
  });

  const { trabajoId } = cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => cola.estadoTrabajo(trabajoId)?.hechas === 5);

  const final = cola.estadoTrabajo(trabajoId);
  assert.ok(['parcial', 'fallida'].includes(final.estado), 'el trabajo termina, no se queda colgado');
  assert.match(final.motivo, /EACCES simulado/, 'el motivo del fallo de disco queda registrado');
  assert.equal(cola.estadisticas().activo, 0, 'el trabajador queda libre, no "atascado" con el fallido');

  // El siguiente encolar debe procesarse con total normalidad -- el trabajador no quedó bloqueado
  // ni el proceso murió por un unhandledRejection.
  const { trabajoId: id2 } = cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => cola.estadoTrabajo(id2)?.estado === 'lista');
  assert.equal(cola.estadoTrabajo(id2).preguntas.length, 5);
});

test('cola (Ronda 2): una excepción de disco en leerColchon (calcularEvitar, antes de producirTanda) tampoco mata al trabajador', async () => {
  const dir = await carpetaTmp();
  const almacenReal = crearAlmacen(dir);
  let vecesLanzado = 0;
  const almacenFalso = {
    ...almacenReal,
    async leerColchon() {
      if (vecesLanzado === 0) {
        vecesLanzado++;
        throw new Error('EACCES simulado (leerColchon)');
      }
      return almacenReal.leerColchon();
    },
  };
  let seLlamoProducirTanda = false;
  const cola = crearCola({
    almacen: almacenFalso,
    producirTanda: async (params) => {
      seLlamoProducirTanda = true;
      return resultadoOk(params.area, params.n, 5);
    },
  });

  const { trabajoId } = cola.encolar({ area: 'ciencia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => cola.estadoTrabajo(trabajoId)?.hechas === 5);

  assert.equal(seLlamoProducirTanda, false, 'el fallo ocurre calculando "evitar", antes de llegar a producirTanda');
  const final = cola.estadoTrabajo(trabajoId);
  assert.equal(final.estado, 'fallida', '0 aprobadas: el lote nunca llegó a pedir preguntas');
  assert.match(final.motivo, /EACCES simulado/);
  assert.equal(cola.estadisticas().activo, 0);
});

// === servidor/cola.js: Ronda 2 (revisión) -- Minor #3, tope de colaFondo ======================

test('cola (Ronda 2): colaFondo tiene un tope de 32 -- las nuevas peticiones de fondo se descartan si está llena', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const pendientes = [];
  const cola = crearCola({
    almacen,
    producirTanda: async () => new Promise((resolver) => pendientes.push(resolver)),
  });

  // El primero ocupa el único trabajador; los siguientes 32 se quedan en colaFondo (llenándola).
  cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: false });
  await hastaQue(() => pendientes.length === 1);

  for (let i = 0; i < 32; i++) {
    const r = cola.encolar({ area: 'historia', ruta: [], n: 5, urgente: false });
    assert.ok(r, `job ${i} debería encolarse (colaFondo todavía no está llena)`);
  }

  const descartado = cola.encolar({ area: 'geografia', ruta: [], n: 5, urgente: false });
  assert.equal(descartado, null, 'con colaFondo llena (32), la siguiente petición de fondo se descarta');

  // Un urgente NO se ve afectado por este tope.
  const urgente = cola.encolar({ area: 'arte', ruta: [], n: 5, urgente: true });
  assert.ok(urgente, 'los urgentes nunca se descartan por el tope de colaFondo');

  pendientes[0](resultadoVacio(5));
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

// === Ronda final (14-sep-2026): almacen.anadirLineaLog (I4) =====================================

test('almacen: anadirLineaLog añade una línea JSON por llamada, sin pisar las anteriores', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);

  await almacen.anadirLineaLog('servidor.log', { fecha: '2026-01-01T00:00:00.000Z', a: 1 });
  await almacen.anadirLineaLog('servidor.log', { fecha: '2026-01-01T00:00:01.000Z', a: 2 });

  const contenido = await readFile(path.join(dir, 'servidor.log'), 'utf8');
  const lineas = contenido.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].a, 1);
  assert.equal(lineas[1].a, 2);
});

test('almacen: anadirLineaLog no lanza si la escritura falla', async () => {
  const dir = await carpetaTmp();
  // rutaDatos apunta DENTRO de un fichero normal (no un directorio): mkdir(rutaDatos) falla con
  // ENOTDIR, tal como pediría un disco de solo lectura o sin permisos en el VPS.
  const rutaFichero = path.join(dir, 'esto-es-un-fichero');
  await writeFile(rutaFichero, 'x', 'utf8');
  const almacen = crearAlmacen(path.join(rutaFichero, 'subcarpeta'));

  await assert.doesNotReject(() => almacen.anadirLineaLog('servidor.log', { a: 1 }));
});

// === Ronda final (14-sep-2026): ultimoError/ultimaGeneracionOk (C2) =============================

test('cola.estadisticas(): ultimaGeneracionOk se actualiza tras un lote sin fallo; ultimoError sigue null', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async ({ area, n }) => resultadoOk(area, n, n) });

  cola.encolar({ area: 'economia', ruta: [], n: 3, urgente: true });
  await hastaQue(() => cola.estadisticas().ultimaGeneracionOk !== null);

  const stats = cola.estadisticas();
  assert.equal(stats.ultimoError, null);
  assert.ok(stats.ultimaGeneracionOk);
  assert.ok(!Number.isNaN(new Date(stats.ultimaGeneracionOk).getTime()));
});

test('cola.estadisticas(): ultimoError se actualiza (corto, sin traza) cuando producirTanda falla', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({
    almacen,
    producirTanda: async () => {
      throw new Error('la cascada de este tipo se agotó del todo');
    },
  });

  cola.encolar({ area: 'economia', ruta: [], n: 3, urgente: true });
  await hastaQue(() => cola.estadisticas().ultimoError !== null);

  const stats = cola.estadisticas();
  assert.match(stats.ultimoError, /la cascada de este tipo se agotó del todo/);
  assert.ok(!stats.ultimoError.includes(dir), 'no debe filtrar rutas internas del disco');
});

// === Ronda final (14-sep-2026): trazabilidad por lote (I4) ======================================

test('ejecutarUnLote (I4): registra rechazadas en rechazadas.json y una línea por lote en servidor.log', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const resultadoConRechazo = {
    aprobadas: [aprobada('economia', 1)],
    rechazadas: [{ borrador: { enunciado: 'mala' }, motivo: 'no supera validarPregunta' }],
    coste: 0.002,
    modelos: ['modelo-a', 'modelo-b'],
    fallos: [],
    pedidas: 5,
    obtenidas: 1,
  };
  const cola = crearCola({ almacen, producirTanda: async () => resultadoConRechazo });

  cola.encolar({ area: 'economia', ruta: [], n: 5, urgente: true });

  // Se espera a servidor.log, no a colchon.json: dentro de ejecutarUnLote, colchon.json (aprobadas)
  // se escribe ANTES que rechazadas.json, y registrarLoteEnLog es lo ÚLTIMO que hace el lote --
  // esperar solo a colchon.json dejaba una ventana real donde rechazadas.json todavía no existía
  // (visto de forma intermitente al repetir la suite varias veces seguidas).
  await hastaQue(async () => {
    try {
      const contenido = await readFile(path.join(dir, 'servidor.log'), 'utf8');
      return contenido.trim().length > 0;
    } catch {
      return false;
    }
  });

  const rechazadas = await almacen.leerRechazadas();
  assert.equal(rechazadas.length, 1);
  assert.equal(rechazadas[0].motivo, 'no supera validarPregunta');

  const contenido = await readFile(path.join(dir, 'servidor.log'), 'utf8');
  const lineas = contenido.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].area, 'economia');
  assert.equal(lineas[0].aprobadas, 1);
  assert.equal(lineas[0].rechazadas, 1);
  assert.equal(lineas[0].coste, 0.002);
  assert.deepEqual(lineas[0].modelos, ['modelo-a', 'modelo-b']);
  assert.ok(lineas[0].trabajoId);
  assert.ok(lineas[0].fecha);
});

// --- v0.2b4.1 §6: `hechas` avanza por pregunta verificada, no por lote -----------------------

test('v0.2b4.1 §6: `hechas` del trabajo avanza pregunta a pregunta, no de 5 en 5', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const vistos = [];
  let soltarLote;
  const enEspera = new Promise((r) => { soltarLote = r; });

  const producirTandaFalso = async ({ n }, { onProgreso }) => {
    for (let i = 1; i <= n; i++) onProgreso?.({ verificadas: i, pedidas: n });
    await enEspera; // el lote no termina hasta que el test haya podido mirar el estado
    return resultadoOk('economia', n, n);
  };

  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });

  await hastaQue(() => cola.estadoTrabajo(trabajoId).hechas === 5);
  vistos.push(cola.estadoTrabajo(trabajoId).hechas);
  soltarLote();

  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
  const final = cola.estadoTrabajo(trabajoId);
  assert.equal(final.hechas, 10, 'al cerrar, hechas cuadra exactamente con pedidas');
  assert.deepEqual(vistos, [5], 'y por el camino se vio el progreso dentro del lote');
});

test('v0.2b4.1 §6: si producirTanda avisa de más preguntas de las del lote, `hechas` nunca pasa de `pedidas`', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const producirTandaFalso = async ({ n }, { onProgreso }) => {
    for (let i = 1; i <= n + 7; i++) onProgreso?.({ verificadas: i, pedidas: n });
    return resultadoOk('economia', n, n);
  };
  const cola = crearCola({ almacen, producirTanda: producirTandaFalso });
  const { trabajoId } = cola.encolar({ area: 'economia', n: 10, urgente: true });
  await hastaQue(() => cola.estadoTrabajo(trabajoId).estado === 'lista');
  assert.equal(cola.estadoTrabajo(trabajoId).hechas, 10);
});

// --- v0.2b4.1 §5: trabajo de fondo que completa visuales pendientes + actualizadas -------------

test('v0.2b4.1 §5: la cola completa los visuales pendientes del colchón y marca actualizadaEn', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    { ...aprobada('economia', 1, { visual: null, visualPendiente: true }), servida: null, creada: '2026-09-15T10:00:00.000Z' },
    { ...aprobada('historia', 2, { visual: { tipo: 'dato' }, visualPendiente: false }), servida: null, creada: '2026-09-15T10:00:00.000Z' },
  ]);

  const pedidas = [];
  const completarVisualFalso = async (pregunta) => {
    pedidas.push(pregunta.id);
    return { visual: { tipo: 'formula', texto: 'a = b', leyenda: 'Prueba' }, explicacion: pregunta.explicacion, coste: 0 };
  };

  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(0), completarVisual: completarVisualFalso });
  const resultado = await cola.completarVisualesPendientes();

  assert.equal(resultado.completadas, 1);
  assert.equal(pedidas.length, 1, 'solo la que tenía el visual pendiente');

  const colchon = await almacen.leerColchon();
  const completada = colchon.find((p) => p.id === pedidas[0]);
  assert.equal(completada.visualPendiente, false);
  assert.equal(completada.visual.tipo, 'formula');
  assert.ok(typeof completada.actualizadaEn === 'string' && completada.actualizadaEn.includes('T'), 'marca ISO');
  // La otra no se toca: ni visual, ni marca.
  const intacta = colchon.find((p) => p.id !== pedidas[0]);
  assert.equal(intacta.actualizadaEn, undefined);
});

test('v0.2b4.1 §5: si completarVisual no consigue visual, la pregunta sigue pendiente para otra pasada', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    { ...aprobada('economia', 1, { visual: null, visualPendiente: true }), servida: null, creada: '2026-09-15T10:00:00.000Z' },
  ]);
  const cola = crearCola({
    almacen,
    producirTanda: async () => resultadoVacio(0),
    completarVisual: async (p) => ({ visual: null, explicacion: p.explicacion, coste: 0 }),
  });

  const resultado = await cola.completarVisualesPendientes();

  assert.equal(resultado.completadas, 0);
  const [p] = await almacen.leerColchon();
  assert.equal(p.visualPendiente, true, 'sigue en la lista de pendientes');
  assert.equal(p.actualizadaEn, undefined, 'nada cambió, así que no hay nada que anunciar al cliente');
});

test('v0.2b4.1 §5: sin completarVisual inyectado, completarVisualesPendientes no hace nada (y no rompe)', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(0) });
  assert.deepEqual(await cola.completarVisualesPendientes(), { completadas: 0, pendientes: 0 });
});

test('v0.2b4.1 §5: `actualizadas` devuelve solo lo que el móvil YA conoce y ha cambiado desde `desde`', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const base = { servida: '2026-09-15T09:00:00.000Z', creada: '2026-09-15T08:00:00.000Z' };
  const conocida = { ...aprobada('economia', 1), ...base, id: 'srv-eco-conocida', actualizadaEn: '2026-09-15T10:00:00.000Z', visual: { tipo: 'dato' } };
  const vieja = { ...aprobada('economia', 2), ...base, id: 'srv-eco-vieja', actualizadaEn: '2026-09-15T08:30:00.000Z' };
  const desconocida = { ...aprobada('economia', 3), ...base, id: 'srv-eco-ajena', actualizadaEn: '2026-09-15T10:00:00.000Z' };
  const sinMarca = { ...aprobada('economia', 4), ...base, id: 'srv-eco-sinmarca' };
  await almacen.guardarColchon([conocida, vieja, desconocida, sinMarca]);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(0) });

  const salida = await cola.actualizadas({
    idsConocidos: ['srv-eco-conocida', 'srv-eco-vieja', 'srv-eco-sinmarca'],
    desde: '2026-09-15T09:30:00.000Z',
  });

  assert.deepEqual(salida.map((p) => p.id), ['srv-eco-conocida']);
  assert.deepEqual(salida[0].visual, { tipo: 'dato' });
  assert.equal(typeof salida[0].explicacion, 'string');
  assert.equal(salida[0].enunciado, undefined, 'solo lo que puede haber cambiado, no la pregunta entera');
});

test('v0.2b4.1 §5: sin `desde`, `actualizadas` devuelve TODO lo conocido que tenga marca (primera vez)', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    { ...aprobada('economia', 1), id: 'srv-eco-1', servida: null, creada: '2026-09-15T08:00:00.000Z', actualizadaEn: '2026-09-15T08:30:00.000Z' },
  ]);
  const cola = crearCola({ almacen, producirTanda: async () => resultadoVacio(0) });
  const salida = await cola.actualizadas({ idsConocidos: ['srv-eco-1'] });
  assert.deepEqual(salida.map((p) => p.id), ['srv-eco-1']);
  // Y sin ids conocidos no hay nada que actualizar: no se manda contenido que el móvil no tiene.
  assert.deepEqual(await cola.actualizadas({ idsConocidos: [] }), []);
});

// Autorrevisión (Tarea 4): procesarCola dispara completarVisualesPendientes() DESPUÉS de que su
// `while` se vacíe, y esa llamada puede tardar de verdad (red). `dispararProcesamiento` solo mira
// el flag `procesando` -- si un trabajo (sobre todo uno urgente, un jugador esperando) llega
// MIENTRAS completarVisualesPendientes sigue en marcha, `encolar()` lo empuja a la cola pero
// `dispararProcesamiento()` no hace nada (procesando ya es true) y NADA vuelve a mirar la cola
// cuando termina -- el trabajo se queda atascado hasta que un encolar() futuro y no relacionado lo
// destrabe por pura casualidad. Este test demuestra que NO pasa: procesarCola debe recomprobar la
// cola al terminar el trabajo de fondo y seguir procesando lo que haya llegado mientras tanto.
test('v0.2b4.1 §5: un trabajo que llega MIENTRAS se completan visuales pendientes no se queda atascado en la cola', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    { ...aprobada('economia', 1, { visual: null, visualPendiente: true }), servida: null, creada: '2026-09-15T10:00:00.000Z' },
  ]);

  let soltar;
  const enEspera = new Promise((r) => { soltar = r; });
  let empezoCompletar = false;
  const completarVisualFalso = async (pregunta) => {
    empezoCompletar = true;
    await enEspera;
    return { visual: { tipo: 'formula', texto: 'a = b', leyenda: 'x' }, explicacion: pregunta.explicacion, coste: 0 };
  };

  const cola = crearCola({
    almacen,
    // El trabajo inicial (n=0) no aprueba nada -- solo sirve para disparar procesarCola. El
    // urgente sí necesita aprobadas de verdad para poder llegar a 'lista'.
    producirTanda: async ({ area, n }) => resultadoOk(area, n, n),
    completarVisual: completarVisualFalso,
  });

  // Trabajo mínimo (0 preguntas pedidas) que termina al instante: al vaciarse la cola justo
  // después, procesarCola entra en completarVisualesPendientes() y se queda colgado de `enEspera`.
  cola.encolar({ area: 'economia', n: 0, urgente: false });
  await hastaQue(() => empezoCompletar);

  // Mientras el trabajo de fondo sigue bloqueado, llega un urgente real -- un jugador esperando.
  const { trabajoId } = cola.encolar({ area: 'historia', n: 1, urgente: true });

  soltar(); // el trabajo de fondo por fin termina

  // El urgente debe procesarse solo, sin que haga falta un tercer encolar() que "desatasque" la cola.
  await hastaQue(() => cola.estadoTrabajo(trabajoId)?.estado === 'lista');
  assert.equal(cola.estadoTrabajo(trabajoId).hechas, 1);
});

// --- Ronda de corrección 1 (revisión Opus): I1, I2, Minor -------------------------------------

// I1: antes, un urgente que llegaba a mitad de la pasada de visuales pendientes esperaba a que la
// pasada ENTERA terminara (hasta 10 preguntas secuenciales). Ahora `completarVisualesPendientes`
// corta el bucle ENTRE preguntas en cuanto ve un urgente en cola -- el urgente solo espera al
// visual que ya estaba en curso, nunca al resto de la pasada.
test('v0.2b4.1 §5 (I1): un urgente que llega durante la pasada de visuales se atiende sin esperar a que termine toda la pasada', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const pendientes = Array.from({ length: 5 }, (_, i) => ({
    ...aprobada('economia', i, { visual: null, visualPendiente: true }),
    servida: null,
    creada: new Date(Date.UTC(2026, 8, 15, 10, 0, i)).toISOString(),
  }));
  await almacen.guardarColchon(pendientes);

  const eventos = [];
  let soltar;
  const enEspera = new Promise((r) => { soltar = r; });
  let cola; // referenciada desde dentro de completarVisualFalso, asignada más abajo

  const completarVisualFalso = async (pregunta) => {
    eventos.push(`visual:${pregunta.id}`);
    if (eventos.length === 1) {
      // Mientras se procesa la 1ª pendiente, llega un urgente real (un jugador esperando).
      cola.encolar({ area: 'historia', n: 1, urgente: true });
      await enEspera; // no deja avanzar a la 2ª pendiente hasta que el test lo permita
    }
    return { visual: { tipo: 'formula', texto: 'a = b', leyenda: 'x' }, explicacion: pregunta.explicacion, coste: 0 };
  };
  const producirTandaFalso = async ({ area, n }) => {
    if (area === 'historia') eventos.push('urgente:historia');
    return resultadoOk(area, n, n);
  };

  cola = crearCola({ almacen, producirTanda: producirTandaFalso, completarVisual: completarVisualFalso });

  cola.encolar({ area: 'economia', n: 0, urgente: false }); // dispara la pasada de fondo
  await hastaQue(() => eventos.includes(`visual:${pendientes[0].id}`));

  // El urgente ya está encolado (dentro de completarVisualFalso) pero la pasada sigue bloqueada en
  // el `await enEspera` de la 1ª pendiente -- todavía no debería haberse procesado.
  assert.ok(!eventos.includes('urgente:historia'), 'el urgente no debe procesarse mientras la 1ª pendiente sigue en curso');

  soltar(); // termina el completarVisual de la 1ª pendiente -- el bucle debe cortarse aquí (I1)

  await hastaQue(() => eventos.includes('urgente:historia'));
  const indiceUrgente = eventos.indexOf('urgente:historia');
  const indiceSegundaPendiente = eventos.indexOf(`visual:${pendientes[1].id}`);
  assert.equal(indiceSegundaPendiente, -1, 'el bucle se corta tras la 1ª: la 2ª pendiente no debe llegar a intentarse');
  assert.ok(indiceUrgente >= 0, 'el urgente sí debe procesarse');
});

// I2: sin límite de reintentos, un visual que nunca sale se reintentaba para siempre. A partir de
// MAX_INTENTOS_VISUAL (3) intentos fallidos, la pregunta se rinde: deja de estar pendiente (se
// queda sin visual, igual que una rechazada por el verificador) y deja de elegirse.
test('v0.2b4.1 §5 (I2): tras 3 pasadas fallidas, la pregunta deja de estar pendiente (se rinde)', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    { ...aprobada('economia', 1, { visual: null, visualPendiente: true }), servida: null, creada: '2026-09-15T10:00:00.000Z' },
  ]);
  const cola = crearCola({
    almacen,
    producirTanda: async () => resultadoVacio(0),
    completarVisual: async (p) => ({ visual: null, explicacion: p.explicacion, coste: 0 }),
  });

  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    await cola.completarVisualesPendientes();
  }

  const [p] = await almacen.leerColchon();
  assert.equal(p.visualPendiente, false, 'se rinde tras agotar los intentos');
  assert.equal(p.visual, null, 'nunca llegó a tener visual');
  assert.equal(p.intentosVisual, 3);

  // Una pasada más no la vuelve a tocar (ya no es "pendiente": el filtro de arriba la descarta).
  const antes = await almacen.leerColchon();
  const resultado = await cola.completarVisualesPendientes();
  assert.equal(resultado.completadas, 0);
  assert.equal(resultado.pendientes, 0);
  assert.deepEqual(await almacen.leerColchon(), antes);
});

// I2 (rotación): con más pendientes que el tope de una pasada, las que se quedaron fuera (y las
// que nunca se han intentado) entran con prioridad en la pasada siguiente frente a las que ya
// fallaron una vez -- por eso se ordena por `intentosVisual` ascendente antes de recortar a `max`.
test('v0.2b4.1 §5 (I2, rotación): con 12 pendientes y tope 10, la 11ª y 12ª se intentan en la pasada siguiente', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const doce = Array.from({ length: 12 }, (_, i) => ({
    ...aprobada('economia', i, { visual: null, visualPendiente: true }),
    servida: null,
    creada: new Date(Date.UTC(2026, 8, 15, 10, 0, i)).toISOString(),
  }));
  await almacen.guardarColchon(doce);

  const pedidasPorPasada = [];
  let pedidas = [];
  const cola = crearCola({
    almacen,
    producirTanda: async () => resultadoVacio(0),
    // Todas fallan (visual: null) -- así ninguna sale de "pendiente" y se puede comprobar la
    // rotación (si alguna tuviera éxito, dejaría de competir por hueco en la pasada siguiente).
    completarVisual: async (p) => {
      pedidas.push(p.id);
      return { visual: null, explicacion: p.explicacion, coste: 0 };
    },
  });

  await cola.completarVisualesPendientes(); // pasada 1: las 10 más antiguas (índices 0-9)
  pedidasPorPasada.push(pedidas);
  pedidas = [];
  await cola.completarVisualesPendientes(); // pasada 2: deben entrar la 11ª y 12ª (nunca intentadas)
  pedidasPorPasada.push(pedidas);

  assert.equal(pedidasPorPasada[0].length, 10);
  assert.deepEqual(pedidasPorPasada[0].slice().sort(), doce.slice(0, 10).map((p) => p.id).sort());

  assert.ok(pedidasPorPasada[1].includes(doce[10].id), 'la 11ª (nunca intentada) debe entrar en la pasada siguiente');
  assert.ok(pedidasPorPasada[1].includes(doce[11].id), 'la 12ª (nunca intentada) debe entrar en la pasada siguiente');
});

// Minor (ronda de corrección 1): antes, "no hay nada pendiente" y "ya hay una pasada en marcha"
// devolvían exactamente lo mismo ({completadas:0, pendientes:0}) -- indistinguibles desde fuera.
test('v0.2b4.1 §5 (Minor): completarVisualesPendientes() reentrante devuelve un resultado distinguible de "nada pendiente"', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  await almacen.guardarColchon([
    { ...aprobada('economia', 1, { visual: null, visualPendiente: true }), servida: null, creada: '2026-09-15T10:00:00.000Z' },
  ]);
  let soltar;
  const enEspera = new Promise((r) => { soltar = r; });
  let entro = false;
  const cola = crearCola({
    almacen,
    producirTanda: async () => resultadoVacio(0),
    completarVisual: async (p) => {
      entro = true;
      await enEspera;
      return { visual: { tipo: 'formula', texto: 'a = b', leyenda: 'x' }, explicacion: p.explicacion, coste: 0 };
    },
  });

  const primera = cola.completarVisualesPendientes();
  await hastaQue(() => entro);

  const reentrante = await cola.completarVisualesPendientes();
  assert.deepEqual(reentrante, { completadas: 0, pendientes: null, enCurso: true });

  soltar();
  const resultado = await primera;
  assert.equal(resultado.completadas, 1);
});
