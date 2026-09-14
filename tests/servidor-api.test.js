// Tests de servidor/index.js (Tarea 3 del plan v0.2b1-servidor): API HTTP completa.
// Sin red real: `producirTanda` (inyectado en la cola) y `llamar` (inyectado en el servidor, para
// /subtemas) son funciones falsas. servidor/almacen.js y servidor/cola.js son los reales (Tareas
// 1-2, no se tocan) sobre una carpeta temporal por test. Servidor siempre en puerto 0.
// Spec que manda: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md
// §0, §3.1, §3.3, §3.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crearAlmacen } from '../servidor/almacen.js';
import { crearCola } from '../servidor/cola.js';
import {
  crearServidor,
  esHoraNocturna,
  rellenoNocturnoSiToca,
  comprobarEscritura,
  esperarInactividad,
} from '../servidor/index.js';
import { HILOS_POR_AREA } from '../tools/criterio.js';

const TOKEN = 'token-de-prueba-0123456789abcdef0123456789abcdef';
const ORIGEN_PWA = 'https://carlostorresadvisory.github.io';
const ORIGEN_LOCAL = 'http://localhost:8765';
const ORIGEN_AJENO = 'https://otro-sitio.example.com';

function cabeceras(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...extra };
}

async function carpetaTmp() {
  return mkdtemp(path.join(os.tmpdir(), 'one-servidor-api-'));
}

// Espera activa con temporizador real, igual que en tests/servidor-cola.test.js (I/O de disco real
// de por medio: un `await Promise.resolve()` no basta).
async function hastaQue(condicion, { intentos = 400, esperaMs = 5 } = {}) {
  for (let i = 0; i < intentos; i++) {
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

function resultadoOk(area, n, aprobadasN = 1) {
  const lista = Array.from({ length: aprobadasN }, (_, i) => aprobada(area, i));
  return { aprobadas: lista, rechazadas: [], coste: 0.0001, modelos: ['modelo-falso'], fallos: [], pedidas: n, obtenidas: aprobadasN };
}

function resultadoVacio(n) {
  return { aprobadas: [], rechazadas: [], coste: 0, modelos: [], fallos: [], pedidas: n, obtenidas: 0 };
}

// Crea almacen (real) + cola (real, con producirTanda falso) + servidor (puerto 0) para un test.
// `producirTanda` y `llamar` son inyectables; por defecto no hacen nada útil (no se necesitan en
// la mayoría de los tests).
async function crearServidorDePrueba({ producirTanda, ...overridesServidor } = {}) {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const producirTandaFake = producirTanda || (async ({ n }) => resultadoVacio(n));
  const cola = crearCola({ almacen, producirTanda: producirTandaFake, opciones: {} });
  const servidor = crearServidor({
    cola,
    almacen,
    token: TOKEN,
    rutaDatos: dir,
    ...overridesServidor,
  });
  await new Promise((resolve) => servidor.listen(0, resolve));
  const puerto = servidor.address().port;
  const base = `http://127.0.0.1:${puerto}`;
  return {
    dir,
    almacen,
    cola,
    servidor,
    base,
    cerrar: () =>
      new Promise((resolve) => {
        servidor.closeAllConnections?.();
        servidor.close(() => resolve());
      }),
  };
}

// === GET /salud ================================================================================

test('GET /salud sin token responde 200 con colchon/cola/gastoHoyEur', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/salud`);
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.equal(datos.ok, true);
    assert.equal(typeof datos.version, 'string');
    assert.equal(typeof datos.colchon.total, 'number');
    assert.equal(typeof datos.colchon.listas, 'number');
    assert.deepEqual(datos.colchon.porArea, {});
    assert.equal(typeof datos.cola, 'number');
    assert.equal(typeof datos.gastoHoyEur, 'number');
    assert.equal(datos.ultimoError, null, 'sin generaciones todavía, no hay error que mostrar');
    assert.equal(datos.ultimaGeneracionOk, null);
  } finally {
    await cerrar();
  }
});

// Ronda final (revisión, 14-sep-2026), Critical C2: /salud debe reflejar la señal de salud real del
// trabajador (cola.estadisticas().ultimoError/ultimaGeneracionOk), no solo "el proceso sigue vivo".
test('GET /salud expone ultimoError y ultimaGeneracionOk tal cual los da cola.estadisticas()', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const colaFake = {
    estadisticas: () => ({
      enCola: 0,
      activo: 0,
      terminadosRecordados: 0,
      ultimoError: 'la cascada de test4 se agotó',
      ultimaGeneracionOk: '2026-01-01T00:00:00.000Z',
    }),
  };
  const servidor = crearServidor({ cola: colaFake, almacen, token: TOKEN, rutaDatos: dir });
  await new Promise((resolve) => servidor.listen(0, resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const resp = await fetch(`${base}/salud`);
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.equal(datos.ultimoError, 'la cascada de test4 se agotó');
    assert.equal(datos.ultimaGeneracionOk, '2026-01-01T00:00:00.000Z');
  } finally {
    await new Promise((resolve) => {
      servidor.closeAllConnections?.();
      servidor.close(() => resolve());
    });
  }
});

// Ronda final (revisión, 14-sep-2026), Critical C2: /salud mentía "ok:true" con el disco de datos
// ya inservible (nunca hacía una escritura real, solo lecturas sobre ficheros que ya existían).
test('GET /salud responde 503 {ok:false} si RUTA_DATOS no admite escritura', async () => {
  const dirBase = await carpetaTmp();
  const rutaFichero = path.join(dirBase, 'esto-es-un-fichero');
  await writeFile(rutaFichero, 'x', 'utf8');
  const rutaDatosMala = path.join(rutaFichero, 'subcarpeta'); // mkdir fallará: ENOTDIR

  const almacen = crearAlmacen(rutaDatosMala);
  const cola = crearCola({ almacen, producirTanda: async ({ n }) => resultadoVacio(n) });
  const servidor = crearServidor({ cola, almacen, token: TOKEN, rutaDatos: rutaDatosMala });
  await new Promise((resolve) => servidor.listen(0, resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const resp = await fetch(`${base}/salud`);
    assert.equal(resp.status, 503);
    const datos = await resp.json();
    assert.equal(datos.ok, false);
    assert.equal(typeof datos.error, 'string');
    assert.ok(!datos.error.includes(rutaDatosMala), 'el mensaje al cliente no debe filtrar la ruta interna');
  } finally {
    await new Promise((resolve) => {
      servidor.closeAllConnections?.();
      servidor.close(() => resolve());
    });
  }
});

// Ronda final (revisión, 14-sep-2026), Critical C1: prueba directa de la función de comprobación de
// escritura que usan tanto el arranque (bootstrap) como /salud.
test('comprobarEscritura: crea la carpeta si falta y no deja ningún fichero de prueba tras comprobar', async () => {
  const base = await carpetaTmp();
  const sub = path.join(base, 'nueva', 'mas-honda');
  await comprobarEscritura(sub);
  const ficheros = await readdir(sub);
  assert.deepEqual(ficheros, []);
});

test('GET /salud cuenta el colchón disponible por área y suma el gasto de llamadas.log', async () => {
  const { base, dir, almacen, cerrar } = await crearServidorDePrueba();
  try {
    const ahora = new Date().toISOString();
    await almacen.guardarColchon([
      { id: 'srv-eco-a1', area: 'economia', creada: ahora, servida: null },
      { id: 'srv-eco-a2', area: 'economia', creada: ahora, servida: ahora },
      { id: 'srv-his-a1', area: 'historia', creada: ahora, servida: null },
    ]);
    const hoy = new Date().toISOString().slice(0, 10);
    const lineas = [
      { fecha: `${hoy}T10:00:00.000Z`, modelo: 'm', coste: 0.01, tokens: 10, ok: true },
      { fecha: `${hoy}T11:00:00.000Z`, modelo: 'm', coste: 0.02, tokens: 10, ok: true },
      { fecha: '2000-01-01T00:00:00.000Z', modelo: 'm', coste: 99, tokens: 10, ok: true },
    ];
    await writeFile(path.join(dir, 'llamadas.log'), lineas.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    const resp = await fetch(`${base}/salud`);
    const datos = await resp.json();
    assert.equal(datos.colchon.total, 3);
    assert.equal(datos.colchon.listas, 2, 'solo cuentan las no servidas');
    assert.deepEqual(datos.colchon.porArea, { economia: 1, historia: 1 });
    assert.ok(Math.abs(datos.gastoHoyEur - 0.03) < 1e-9, 'solo suma el gasto de hoy, no el de otra fecha');
  } finally {
    await cerrar();
  }
});

// === Autenticación ==============================================================================

test('cualquier otra ruta sin token o con token malo responde 401 sin cuerpo', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const sinToken = await fetch(`${base}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(sinToken.status, 401);
    assert.equal((await sinToken.text()).length, 0);

    const tokenMalo = await fetch(`${base}/estado`, {
      method: 'POST',
      headers: cabeceras({ Authorization: 'Bearer esto-no-es-el-token' }),
      body: '{}',
    });
    assert.equal(tokenMalo.status, 401);
    assert.equal((await tokenMalo.text()).length, 0);

    const tokenOtraLongitud = await fetch(`${base}/generar`, {
      method: 'POST',
      headers: cabeceras({ Authorization: 'Bearer x' }),
      body: '{}',
    });
    assert.equal(tokenOtraLongitud.status, 401);
  } finally {
    await cerrar();
  }
});

// === POST /estado ================================================================================

test('POST /estado devuelve hasta max no conocidas y dispara el relleno del colchón', async () => {
  const { base, dir, almacen, cola, cerrar } = await crearServidorDePrueba();
  try {
    const ahora = new Date().toISOString();
    await almacen.guardarColchon([
      { id: 'srv-eco-a1', area: 'economia', tipo: 'vf', enunciado: 'E1', creada: ahora, servida: null },
      { id: 'srv-eco-a2', area: 'economia', tipo: 'vf', enunciado: 'E2', creada: ahora, servida: null },
      { id: 'srv-eco-a3', area: 'economia', tipo: 'vf', enunciado: 'E3', creada: ahora, servida: null },
    ]);

    const resp = await fetch(`${base}/estado`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ resumen: { areas: {}, idsConocidos: ['srv-eco-a1'] }, max: 5 }),
    });
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.equal(datos.preguntas.length, 2, 'no debe devolver la que ya conoce el móvil');
    assert.ok(datos.preguntas.every((p) => p.id !== 'srv-eco-a1'));
    assert.equal(typeof datos.enCola, 'number');

    // Ronda final (I1): el guardado de ultimo-resumen.json ahora es efecto de fondo (después de
    // responder), así que hay que esperar a que termine en vez de leerlo justo tras el fetch.
    const rutaResumen = path.join(dir, 'ultimo-resumen.json');
    await hastaQue(async () => {
      try {
        await readFile(rutaResumen, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
    const resumenGuardado = JSON.parse(await readFile(rutaResumen, 'utf8'));
    assert.deepEqual(resumenGuardado.idsConocidos, ['srv-eco-a1']);

    // Efecto de fondo: como el colchón (30 objetivo) está casi vacío, rellenarHaciaObjetivo debe
    // haber encolado algo -- se comprueba en la cola en vez de esperar a que termine (el
    // producirTanda falso por defecto no aprueba nada, pero SÍ se llama, así que la cola pasa a
    // tener trabajos y termina vacía otra vez cuando terminan).
    await hastaQue(() => cola.estadisticas().enCola > 0 || cola.estadisticas().activo > 0);
  } finally {
    await cerrar();
  }
});

test('POST /estado con resumen ausente no rompe (resumen.areas puede faltar)', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/estado`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({}) });
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.deepEqual(datos.preguntas, []);
  } finally {
    await cerrar();
  }
});

// Ronda final (revisión, 14-sep-2026), Important I1: si guardar ultimo-resumen.json falla, la
// respuesta con las preguntas (ya marcadas servida, ya persistidas por cola.servir()) no debe
// perderse -- antes, el await sobre ese guardado iba ANTES de responder, así que un fallo ahí hacía
// que el móvil nunca recibiera preguntas que el servidor ya había dado por entregadas.
test('POST /estado responde con las preguntas aunque falle el guardado de ultimo-resumen.json (I1)', async () => {
  const dir = await carpetaTmp();
  const almacenReal = crearAlmacen(dir);
  let intentoEscribirResumen = false;
  const almacen = {
    ...almacenReal,
    escribirAtomico: async (nombre, objeto) => {
      if (nombre === 'ultimo-resumen.json') {
        intentoEscribirResumen = true;
        throw new Error('disco simulado sin espacio');
      }
      return almacenReal.escribirAtomico(nombre, objeto);
    },
  };
  const cola = crearCola({ almacen, producirTanda: async ({ n }) => resultadoVacio(n) });
  const servidor = crearServidor({ cola, almacen, token: TOKEN, rutaDatos: dir });
  await new Promise((resolve) => servidor.listen(0, resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const ahora = new Date().toISOString();
    await almacenReal.guardarColchon([{ id: 'srv-eco-1', area: 'economia', creada: ahora, servida: null }]);

    const resp = await fetch(`${base}/estado`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ resumen: { areas: {} }, max: 5 }),
    });
    assert.equal(resp.status, 200, 'la respuesta debe llegar aunque falle el guardado del resumen');
    const datos = await resp.json();
    assert.equal(datos.preguntas.length, 1);

    await hastaQue(() => intentoEscribirResumen === true);

    // La pregunta servida sigue marcada como tal en disco pese al fallo del resumen -- I1 solo
    // cambia el ORDEN de la respuesta, no deshace lo que cola.servir() ya había persistido.
    const colchon = await almacenReal.leerColchon();
    assert.ok(colchon[0].servida);
  } finally {
    await new Promise((resolve) => {
      servidor.closeAllConnections?.();
      servidor.close(() => resolve());
    });
  }
});

// === POST /generar + GET /trabajo/:id ===========================================================

test('POST /generar encola una tanda; GET /trabajo/:id progresa hasta lista con el pipeline falso', async () => {
  const producirTandaFake = async ({ area, n }) => resultadoOk(area, n, n);
  const { base, cerrar } = await crearServidorDePrueba({ producirTanda: producirTandaFake });
  try {
    const resp = await fetch(`${base}/generar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: [], n: 3, urgente: true }),
    });
    assert.equal(resp.status, 200);
    const cuerpo = await resp.json();
    assert.ok(cuerpo.trabajoId);
    assert.equal(typeof cuerpo.enCola, 'number');
    assert.equal(typeof cuerpo.estimadoSeg, 'number');

    let ultimoEstado;
    await hastaQue(async () => {
      const r = await fetch(`${base}/trabajo/${cuerpo.trabajoId}`, { headers: cabeceras() });
      ultimoEstado = await r.json();
      return ultimoEstado.hechas >= ultimoEstado.pedidas;
    });
    assert.equal(ultimoEstado.estado, 'lista');
    assert.equal(ultimoEstado.preguntas.length, 3);
  } finally {
    await cerrar();
  }
});

test('GET /trabajo/:id con id desconocido responde 404', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/trabajo/no-existe`, { headers: cabeceras() });
    assert.equal(resp.status, 404);
    const datos = await resp.json();
    assert.equal(typeof datos.error, 'string');
  } finally {
    await cerrar();
  }
});

test('POST /generar sin area responde 400', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/generar`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({}) });
    assert.equal(resp.status, 400);
    assert.equal(typeof (await resp.json()).error, 'string');
  } finally {
    await cerrar();
  }
});

// Ronda 1 (revisión, 14-sep-2026), Important: un área que no existe se encolaba igual y fallaba en
// silencio varios pasos después, dentro del pipeline real -- ahora se rechaza al momento.
test('POST /generar con área desconocida responde 400', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/generar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'no-existe', n: 5 }),
    });
    assert.equal(resp.status, 400);
    assert.equal(typeof (await resp.json()).error, 'string');
  } finally {
    await cerrar();
  }
});

// Ronda final (revisión, 14-sep-2026), Menor M3: `enCola` de /generar debe contar también el
// trabajo activo (el que está corriendo AHORA), no solo los que esperan turno.
test('POST /generar: enCola cuenta también el trabajo activo (M3)', async () => {
  const pendientes = [];
  const producirTandaFake = () => new Promise((resolver) => pendientes.push(resolver));
  const { base, cola, cerrar } = await crearServidorDePrueba({ producirTanda: producirTandaFake });
  try {
    await fetch(`${base}/generar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', n: 3, urgente: true }),
    });
    await hastaQue(() => pendientes.length === 1);
    assert.equal(cola.estadisticas().activo, 1, 'el primero ya está activo');

    const resp2 = await fetch(`${base}/generar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'historia', n: 3, urgente: true }),
    });
    const datos2 = await resp2.json();
    assert.equal(datos2.enCola, 2, '1 en espera (el propio) + 1 activo (el primero)');

    pendientes[0](resultadoVacio(3));
    await hastaQue(() => pendientes.length === 2);
    pendientes[1](resultadoVacio(3));
  } finally {
    await cerrar();
  }
});

// Ronda 1 (revisión, 14-sep-2026), Minor: camino sin cubrir -- cola.encolar() devuelve null cuando
// la cola de fondo (urgente:false) ya está en su tope (32, Tarea 2). Se inyecta una cola FALSA
// (no la real crearCola) para forzar ese caso sin tener que encolar 32 trabajos de verdad.
test('POST /generar con la cola de fondo llena responde 503', async () => {
  const dir = await carpetaTmp();
  const almacen = crearAlmacen(dir);
  const colaFake = {
    encolar: () => null,
    estadoTrabajo: () => null,
    estadisticas: () => ({ enCola: 0, activo: 0, terminadosRecordados: 0 }),
    servir: async () => [],
    reportar: async () => ({ ok: true }),
    rellenarHaciaObjetivo: async () => [],
    calcularObjetivo: async () => [],
  };
  const servidor = crearServidor({ cola: colaFake, almacen, token: TOKEN, rutaDatos: dir });
  await new Promise((resolve) => servidor.listen(0, resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const resp = await fetch(`${base}/generar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', n: 5, urgente: false }),
    });
    assert.equal(resp.status, 503);
    assert.equal(typeof (await resp.json()).error, 'string');
  } finally {
    await new Promise((resolve) => {
      servidor.closeAllConnections?.();
      servidor.close(() => resolve());
    });
  }
});

// Ronda final (revisión, 14-sep-2026), Adversarial A5: `ruta` viaja tal cual a los prompts del
// modelo y a colchon.json -- sin sanear, un cliente podría mandar una lista enorme, con elementos
// no-string, o con caracteres de control.
for (const [descripcion, rutaMala] of [
  ['más de 6 elementos', Array.from({ length: 7 }, (_, i) => `hilo-${i}`)],
  ['un elemento de más de 80 caracteres', ['x'.repeat(81)]],
  ['un elemento con carácter de control', ['hilo\u000amalicioso']],
  ['un elemento que no es string', [42]],
  ['no es un array', 'hilo-1'],
]) {
  test(`POST /generar con ruta inválida (${descripcion}) responde 400 (A5)`, async () => {
    const { base, cerrar } = await crearServidorDePrueba();
    try {
      const resp = await fetch(`${base}/generar`, {
        method: 'POST',
        headers: cabeceras(),
        body: JSON.stringify({ area: 'economia', ruta: rutaMala, n: 5 }),
      });
      assert.equal(resp.status, 400);
      assert.equal(typeof (await resp.json()).error, 'string');
    } finally {
      await cerrar();
    }
  });
}

// === POST /subtemas ==============================================================================

test('POST /subtemas con ruta=[] devuelve HILOS_POR_AREA sin llamar al modelo', async () => {
  let llamadas = 0;
  const llamarFake = async () => {
    llamadas++;
    throw new Error('no debería llamarse para el anillo 1');
  };
  const { base, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    const resp = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: [] }),
    });
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    // Cambiado (Tarea 2, v0.2b3): antes el anillo 1 devolvía TODOS los hilos del área de una vez
    // (economía tenía exactamente 6, así que coincidía por casualidad con HILOS_POR_AREA.economia.length).
    // Ahora economía tiene 10 hilos (se añaden 4 de finanzas en esta misma tarea) y el anillo 1
    // pagina de 6 en 6 -- sin `excluir`, la primera página son los 6 primeros, nunca la lista entera.
    assert.equal(datos.subtemas.length, 6);
    assert.ok(HILOS_POR_AREA.economia.length > 6, 'economía debe tener más de 6 hilos tras esta tarea');
    assert.ok(datos.subtemas.every((s) => typeof s.indice === 'number' && s.corto.length <= 40 && typeof s.completo === 'string'));
    assert.deepEqual(
      datos.subtemas.map((s) => s.completo),
      HILOS_POR_AREA.economia.slice(0, 6),
    );
    assert.equal(llamadas, 0);
  } finally {
    await cerrar();
  }
});

// === POST /subtemas con `excluir` (Tarea 2, v0.2b3) ==============================================
// Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §9.

test('POST /subtemas anillo 1 con excluir=primeros 6 devuelve los hilos 7.. sin llamar al modelo (caso a/b del brief)', async () => {
  let llamadas = 0;
  const llamarFake = async () => {
    llamadas++;
    throw new Error('no debería llamarse: aún quedan hilos sin excluir');
  };
  const { base, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    // Economía: 10 hilos tras esta tarea -- excluir los 6 primeros deja 4 sin excluir.
    const primeraPagina = HILOS_POR_AREA.economia.slice(0, 6);
    const resp = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: [], excluir: primeraPagina }),
    });
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.equal(datos.subtemas.length, 4, 'economía: 10 hilos - 6 excluidos = 4');
    assert.deepEqual(
      datos.subtemas.map((s) => s.completo),
      HILOS_POR_AREA.economia.slice(6),
    );
    // Los índices son 0..n-1 DENTRO de la página, no la posición global en HILOS_POR_AREA.
    assert.deepEqual(datos.subtemas.map((s) => s.indice), [0, 1, 2, 3]);
    assert.equal(llamadas, 0);

    // Ciencia: 7 hilos tras esta tarea -- excluir los 6 primeros deja 1 sin excluir.
    const primeraPaginaCiencia = HILOS_POR_AREA.ciencia.slice(0, 6);
    const respCiencia = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'ciencia', ruta: [], excluir: primeraPaginaCiencia }),
    });
    const datosCiencia = await respCiencia.json();
    assert.equal(datosCiencia.subtemas.length, 1, 'ciencia: 7 hilos - 6 excluidos = 1');
    assert.equal(llamadas, 0);
  } finally {
    await cerrar();
  }
});

test('POST /subtemas anillo 1 con TODOS los hilos excluidos llama al modelo con excluir en el prompt (caso c del brief)', async () => {
  let mensajesVistos = null;
  const llamarFake = async ({ modelos, mensajes }) => {
    mensajesVistos = mensajes;
    return { texto: JSON.stringify({ subtemas: ['Nuevo A', 'Nuevo B'] }), modelo: modelos[0], coste: 0 };
  };
  const { base, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    // Historia: 5 hilos, ninguno nuevo en esta tarea -- excluirlos todos agota la lista estática.
    const todosLosHilos = HILOS_POR_AREA.historia;
    const resp = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'historia', ruta: [], excluir: todosLosHilos }),
    });
    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.deepEqual(datos.subtemas.map((s) => s.completo), ['Nuevo A', 'Nuevo B']);
    assert.ok(mensajesVistos, 'debería haber llamado al modelo');
    const promptUsuario = mensajesVistos[1].content;
    for (const hilo of todosLosHilos) assert.ok(promptUsuario.includes(hilo), `el prompt debe incluir "${hilo}" en la exclusión`);
  } finally {
    await cerrar();
  }
});

test('POST /subtemas anillo ≥ 2 con excluir usa una clave de caché distinta de la de sin excluir (caso d del brief)', async () => {
  let llamadas = 0;
  const llamarFake = async ({ modelos }) => {
    llamadas++;
    return {
      texto: JSON.stringify({ subtemas: llamadas === 1 ? ['Sub A', 'Sub B'] : ['Sub C', 'Sub D'] }),
      modelo: modelos[0],
      coste: 0,
    };
  };
  const { base, dir, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    const r1 = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: ['hilo-1'] }),
    });
    const d1 = await r1.json();
    assert.deepEqual(d1.subtemas.map((s) => s.completo), ['Sub A', 'Sub B']);
    assert.equal(llamadas, 1);

    const r2 = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: ['hilo-1'], excluir: ['Sub A', 'Sub B'] }),
    });
    const d2 = await r2.json();
    assert.deepEqual(d2.subtemas.map((s) => s.completo), ['Sub C', 'Sub D']);
    assert.equal(llamadas, 2, 'con excluir debe ser una clave de caché nueva -- llama de nuevo al modelo');

    const anillos = JSON.parse(await readFile(path.join(dir, 'anillos.json'), 'utf8'));
    assert.ok(anillos[JSON.stringify(['economia', ['hilo-1']])], 'clave sin excluir, igual que hoy');
    assert.ok(anillos[JSON.stringify(['economia', ['hilo-1'], 2])], 'clave con excluir: [area, ruta, excluir.length]');

    // Repetir la primera petición (sin excluir) debe seguir usando su propia caché, sin llamar de nuevo.
    const r3 = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: ['hilo-1'] }),
    });
    const d3 = await r3.json();
    assert.deepEqual(d3.subtemas, d1.subtemas);
    assert.equal(llamadas, 2, 'la petición sin excluir ya estaba cacheada, no debe llamar de nuevo');
  } finally {
    await cerrar();
  }
});

test('POST /subtemas con excluir inválido responde 400 "Exclusión inválida" (caso e del brief)', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const casos = [
      { excluir: 'no-es-un-array' },
      { excluir: Array.from({ length: 31 }, (_, i) => `hilo-${i}`) },
      { excluir: ['x'.repeat(121)] },
      { excluir: ['con\x00control'] },
    ];
    for (const caso of casos) {
      const resp = await fetch(`${base}/subtemas`, {
        method: 'POST',
        headers: cabeceras(),
        body: JSON.stringify({ area: 'economia', ruta: [], ...caso }),
      });
      assert.equal(resp.status, 400, `caso ${JSON.stringify(caso)} debería ser 400`);
      const datos = await resp.json();
      assert.equal(datos.error, 'Exclusión inválida');
    }
  } finally {
    await cerrar();
  }
});

test('POST /subtemas: el prompt al modelo contiene "ramas hermanas" y "conceptos concretos" y la lista de exclusión (caso f del brief)', async () => {
  let mensajesVistos = null;
  const llamarFake = async ({ modelos, mensajes }) => {
    mensajesVistos = mensajes;
    return { texto: JSON.stringify({ subtemas: ['Sub nuevo'] }), modelo: modelos[0], coste: 0 };
  };
  const { base, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    const resp = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: ['hilo-1'], excluir: ['Ya mostrado antes'] }),
    });
    assert.equal(resp.status, 200);
    const promptUsuario = mensajesVistos[1].content;
    assert.ok(promptUsuario.includes('ramas hermanas'), 'debe contener literalmente "ramas hermanas"');
    assert.ok(promptUsuario.includes('conceptos concretos'), 'debe contener literalmente "conceptos concretos"');
    assert.ok(promptUsuario.includes('Ya mostrado antes'), 'debe incluir la lista de exclusión');
  } finally {
    await cerrar();
  }
});

test('POST /subtemas con ruta de 1 elemento llama una vez al modelo y cachea en anillos.json', async () => {
  let llamadas = 0;
  const llamarFake = async () => {
    llamadas++;
    return { texto: JSON.stringify({ subtemas: ['Sub uno', 'Sub dos', 'Sub tres', 'Sub cuatro'] }), modelo: 'modelo-falso', coste: 0 };
  };
  const { base, dir, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    const cuerpo = JSON.stringify({ area: 'economia', ruta: ['hilo-1'] });
    const r1 = await fetch(`${base}/subtemas`, { method: 'POST', headers: cabeceras(), body: cuerpo });
    assert.equal(r1.status, 200);
    const d1 = await r1.json();
    assert.equal(d1.subtemas.length, 4);
    assert.equal(llamadas, 1);

    const r2 = await fetch(`${base}/subtemas`, { method: 'POST', headers: cabeceras(), body: cuerpo });
    assert.equal(r2.status, 200);
    const d2 = await r2.json();
    assert.deepEqual(d2.subtemas, d1.subtemas);
    assert.equal(llamadas, 1, 'la segunda vez debe usar la caché, sin llamar de nuevo');

    const anillos = JSON.parse(await readFile(path.join(dir, 'anillos.json'), 'utf8'));
    assert.ok(anillos[JSON.stringify(['economia', ['hilo-1']])]);
  } finally {
    await cerrar();
  }
});

test('POST /subtemas con área desconocida responde 400', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/subtemas`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ area: 'no-existe', ruta: [] }) });
    assert.equal(resp.status, 400);
  } finally {
    await cerrar();
  }
});

// Ronda final (revisión, 14-sep-2026), Adversarial A5: mismo saneo de `ruta` que /generar.
test('POST /subtemas con ruta inválida (más de 6 elementos) responde 400 (A5)', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const rutaMala = Array.from({ length: 7 }, (_, i) => `hilo-${i}`);
    const resp = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: rutaMala }),
    });
    assert.equal(resp.status, 400);
    assert.equal(typeof (await resp.json()).error, 'string');
  } finally {
    await cerrar();
  }
});

// Ronda 1 (revisión, 14-sep-2026), Minor: un fallo del proveedor externo (cascada agotada, red...)
// es 503 -- "Modelo no disponible", no 500 -- 500 queda solo para errores internos inesperados.
test('POST /subtemas responde 503 si la cascada del modelo falla (anillo ≥ 2)', async () => {
  const llamarFake = async () => {
    throw new Error('todos los modelos de la cascada fallaron');
  };
  const { base, cerrar } = await crearServidorDePrueba({ llamar: llamarFake });
  try {
    const resp = await fetch(`${base}/subtemas`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ area: 'economia', ruta: ['hilo-1'] }),
    });
    assert.equal(resp.status, 503);
    const datos = await resp.json();
    assert.equal(typeof datos.error, 'string');
  } finally {
    await cerrar();
  }
});

// === POST /reportar ==============================================================================

test('POST /reportar saca la pregunta del colchón y la añade a reportadas', async () => {
  const { base, almacen, cerrar } = await crearServidorDePrueba();
  try {
    await almacen.guardarColchon([{ id: 'srv-eco-z1', area: 'economia', enunciado: 'X', creada: new Date().toISOString(), servida: null }]);

    const resp = await fetch(`${base}/reportar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ id: 'srv-eco-z1', motivo: 'mal redactada' }),
    });
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { ok: true });

    const colchon = await almacen.leerColchon();
    assert.ok(!colchon.some((p) => p.id === 'srv-eco-z1'));
    const reportadas = await almacen.leerReportadas();
    assert.ok(reportadas.includes('srv-eco-z1'));
    // Ronda final (revisión, 14-sep-2026), Menor M6: el motivo viaja hasta almacen.js.
    const motivos = await almacen.leerMotivosReportados();
    assert.equal(motivos['srv-eco-z1'], 'mal redactada');
  } finally {
    await cerrar();
  }
});

test('POST /reportar sin id responde 400', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const resp = await fetch(`${base}/reportar`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({}) });
    assert.equal(resp.status, 400);
  } finally {
    await cerrar();
  }
});

// === Límites de cuerpo y de peticiones ===========================================================

test('cuerpo > 64 KB responde 413', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const grande = 'x'.repeat(70 * 1024);
    const resp = await fetch(`${base}/estado`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ resumen: {}, relleno: grande }),
    });
    assert.equal(resp.status, 413);
    const datos = await resp.json();
    assert.equal(typeof datos.error, 'string');
  } finally {
    await cerrar();
  }
});

test('61 peticiones en un minuto desde la misma IP: la 61 responde 429', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const estados = [];
    for (let i = 0; i < 61; i++) {
      const resp = await fetch(`${base}/salud`);
      estados.push(resp.status);
      await resp.text();
    }
    assert.equal(estados.slice(0, 60).every((s) => s === 200), true, 'las 60 primeras deben pasar');
    assert.equal(estados[60], 429);
  } finally {
    await cerrar();
  }
});

// Ronda final (revisión, 14-sep-2026), Important I3: el rate limit debe fiarse de la ÚLTIMA IP de
// x-forwarded-for (la que añade Caddy, el único proxy de confianza), no de la primera (la que un
// cliente malicioso puede inventarse libremente para esquivar el límite rotándola en cada petición).
test('rate limit usa la ÚLTIMA IP de x-forwarded-for, no la primera (I3)', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    let ultimoStatus;
    for (let i = 0; i < 61; i++) {
      // "primera" IP (falseable por el cliente) distinta en cada petición; "última" IP (la que
      // pondría Caddy) siempre la misma -- si se usara la primera, ninguna de las 61 se limitaría.
      const resp = await fetch(`${base}/salud`, { headers: { 'x-forwarded-for': `1.2.3.${i}, 9.9.9.9` } });
      ultimoStatus = resp.status;
      await resp.text();
    }
    assert.equal(ultimoStatus, 429, 'todas comparten la misma última IP: la 61 debe limitarse');
  } finally {
    await cerrar();
  }
});

test('rate limit: misma PRIMERA IP con última distinta no comparte cupo (I3)', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    for (let i = 0; i < 60; i++) {
      const resp = await fetch(`${base}/salud`, { headers: { 'x-forwarded-for': '1.1.1.1, 8.8.8.8' } });
      await resp.text();
      assert.equal(resp.status, 200);
    }
    const resp = await fetch(`${base}/salud`, { headers: { 'x-forwarded-for': '1.1.1.1, 7.7.7.7' } });
    await resp.text();
    assert.equal(resp.status, 200, 'la IP real (última) es distinta: no debe compartir cupo con 8.8.8.8');
  } finally {
    await cerrar();
  }
});

// === CORS =========================================================================================

test('CORS solo permite los dos orígenes fijados; preflight OPTIONS responde 204', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const preOk = await fetch(`${base}/estado`, { method: 'OPTIONS', headers: { Origin: ORIGEN_PWA } });
    assert.equal(preOk.status, 204);
    assert.equal(preOk.headers.get('access-control-allow-origin'), ORIGEN_PWA);

    const preLocal = await fetch(`${base}/estado`, { method: 'OPTIONS', headers: { Origin: ORIGEN_LOCAL } });
    assert.equal(preLocal.status, 204);
    assert.equal(preLocal.headers.get('access-control-allow-origin'), ORIGEN_LOCAL);

    const preAjeno = await fetch(`${base}/estado`, { method: 'OPTIONS', headers: { Origin: ORIGEN_AJENO } });
    assert.equal(preAjeno.status, 204);
    assert.equal(preAjeno.headers.get('access-control-allow-origin'), null);

    const conOrigenPermitido = await fetch(`${base}/salud`, { headers: { Origin: ORIGEN_PWA } });
    assert.equal(conOrigenPermitido.headers.get('access-control-allow-origin'), ORIGEN_PWA);

    const conOrigenAjeno = await fetch(`${base}/salud`, { headers: { Origin: ORIGEN_AJENO } });
    assert.equal(conOrigenAjeno.headers.get('access-control-allow-origin'), null);
  } finally {
    await cerrar();
  }
});

// === Errores en español, sin trazas ==============================================================

test('errores responden {error} en español y sin trazas ni rutas internas', async () => {
  const { base, cerrar } = await crearServidorDePrueba();
  try {
    const rutaDesconocida = await fetch(`${base}/no-existe`, { headers: cabeceras() });
    assert.equal(rutaDesconocida.status, 404);
    const datos = await rutaDesconocida.json();
    assert.equal(typeof datos.error, 'string');
    assert.ok(!('stack' in datos));
    assert.ok(!datos.error.includes(process.cwd()), 'no debe filtrar rutas internas del disco');
  } finally {
    await cerrar();
  }
});

// === Colchón nocturno =============================================================================

test('esHoraNocturna: dentro y fuera de la ventana 2:00-7:00 Europe/Madrid, con y sin cambio de hora', () => {
  assert.equal(esHoraNocturna(new Date('2026-09-14T00:30:00Z')), true); // CEST (verano): 02:30
  assert.equal(esHoraNocturna(new Date('2026-09-14T04:59:00Z')), true); // CEST: 06:59
  assert.equal(esHoraNocturna(new Date('2026-09-14T05:00:00Z')), false); // CEST: 07:00 (límite exclusivo)
  assert.equal(esHoraNocturna(new Date('2026-09-14T23:59:00Z')), false); // CEST: 01:59
  assert.equal(esHoraNocturna(new Date('2026-01-14T01:30:00Z')), true); // CET (invierno): 02:30
  assert.equal(esHoraNocturna(new Date('2026-01-14T05:30:00Z')), true); // CET: 06:30
  assert.equal(esHoraNocturna(new Date('2026-01-14T06:00:00Z')), false); // CET: 07:00
  assert.equal(esHoraNocturna(new Date('2026-09-14T12:00:00Z')), false); // mediodía
});

test('rellenoNocturnoSiToca: dentro de la ventana llama a rellenarHaciaObjetivo con el último resumen', async () => {
  const dir = await carpetaTmp();
  await writeFile(
    path.join(dir, 'ultimo-resumen.json'),
    JSON.stringify({ areas: { economia: { nivel: 1, aciertoReciente: 0.2 } }, rutasAtomo: [] }),
    'utf8',
  );
  const llamadas = [];
  const colaFake = {
    rellenarHaciaObjetivo: async (resumen, rutasAtomo) => {
      llamadas.push({ resumen, rutasAtomo });
      return [];
    },
  };

  const dentro = await rellenoNocturnoSiToca({ cola: colaFake, rutaDatos: dir, fecha: new Date('2026-09-14T02:00:00Z') }); // 04:00 Madrid
  assert.equal(dentro, true);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].resumen.areas.economia.nivel, 1);

  const fuera = await rellenoNocturnoSiToca({ cola: colaFake, rutaDatos: dir, fecha: new Date('2026-09-14T12:00:00Z') });
  assert.equal(fuera, false);
  assert.equal(llamadas.length, 1, 'fuera de la ventana no debe llamar de nuevo');
});

test('rellenoNocturnoSiToca: sin ultimo-resumen.json todavía, usa resumen vacío sin fallar', async () => {
  const dir = await carpetaTmp();
  const llamadas = [];
  const colaFake = {
    rellenarHaciaObjetivo: async (resumen, rutasAtomo) => {
      llamadas.push({ resumen, rutasAtomo });
      return [];
    },
  };
  const hizo = await rellenoNocturnoSiToca({ cola: colaFake, rutaDatos: dir, fecha: new Date('2026-09-14T02:00:00Z') });
  assert.equal(hizo, true);
  assert.deepEqual(llamadas[0].resumen, {});
  assert.deepEqual(llamadas[0].rutasAtomo, []);
});

// === Ronda final (14-sep-2026): esperarInactividad (M1, apagado ordenado) =======================

test('esperarInactividad: resuelve en cuanto activo pasa a 0, sin esperar el resto del máximo', async () => {
  let activo = 1;
  const colaFake = { estadisticas: () => ({ activo }) };
  setTimeout(() => {
    activo = 0;
  }, 30);

  const antes = Date.now();
  await esperarInactividad(colaFake, 5000, { intervaloMs: 10 });
  const transcurrido = Date.now() - antes;

  assert.ok(transcurrido < 500, `debía resolver poco después de los 30ms, tardó ${transcurrido}ms`);
});

test('esperarInactividad: si nunca queda inactivo, resuelve igualmente al llegar a maxMs (no se cuelga)', async () => {
  const colaFake = { estadisticas: () => ({ activo: 1 }) };

  const antes = Date.now();
  await esperarInactividad(colaFake, 100, { intervaloMs: 10 });
  const transcurrido = Date.now() - antes;

  assert.ok(transcurrido >= 100, 'debe respetar el máximo antes de resolver');
  assert.ok(transcurrido < 1000, 'no debe quedarse esperando mucho más del máximo');
});
