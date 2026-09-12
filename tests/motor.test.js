import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREAS,
  XP_BASE,
  INTERVALOS,
  MEZCLA,
  sumarDias,
  crearEstado,
  evaluar,
  seleccionarPartida,
  registrarRespuesta,
  actualizarRacha,
  resumenProgreso,
  exportar,
  importar,
} from '../motor.js';

const HOY = '2026-09-12';
const TIPOS = ['vf', 'test4', 'ordenar', 'error'];

/** rng determinista (congruencial lineal), reproducible entre llamadas de un mismo test. */
function rngDeterminista() {
  let s = 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function crearPregunta(area, tipo, nivel, idExtra = '') {
  const base = {
    id: `${area}-${tipo}-${nivel}${idExtra}`,
    area,
    tipo,
    nivel,
    enunciado: `Enunciado ${area} ${tipo} ${nivel}`,
    explicacion: 'Explicación de prueba',
    confianza: 0.9,
    generador: 'test',
    verificador: 'test',
    verificado: true,
  };
  switch (tipo) {
    case 'vf':
      return { ...base, respuesta: true };
    case 'test4':
      return { ...base, opciones: ['a', 'b', 'c', 'd'], correcta: 0 };
    case 'ordenar':
      return { ...base, criterio: 'de menor a mayor', items: ['a', 'b', 'c', 'd'] };
    case 'error':
      return {
        ...base,
        tarjeta: {
          titulo: 'Tarjeta',
          filas: [
            { etiqueta: 'a', valor: '1' },
            { etiqueta: 'b', valor: '2' },
            { etiqueta: 'c', valor: '3' },
          ],
        },
        sospechoso: 1,
      };
    default:
      throw new Error(`tipo desconocido en test: ${tipo}`);
  }
}

/** 8 áreas × 5 niveles × 4 tipos = 160 preguntas sintéticas. */
function crearBancoPrueba() {
  const banco = [];
  for (const area of AREAS) {
    for (let nivel = 1; nivel <= 5; nivel++) {
      for (const tipo of TIPOS) {
        banco.push(crearPregunta(area, tipo, nivel));
      }
    }
  }
  return banco;
}

// ---------------------------------------------------------------------------
describe('sumarDias', () => {
  test('suma un día dentro del mismo mes', () => {
    assert.equal(sumarDias('2026-09-12', 1), '2026-09-13');
  });
  test('cruza fin de año', () => {
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  });
  test('resta un día', () => {
    assert.equal(sumarDias('2026-09-12', -1), '2026-09-11');
  });
});

// ---------------------------------------------------------------------------
describe('crearEstado', () => {
  test('estructura inicial completa', () => {
    const est = crearEstado(HOY);
    assert.equal(est.version, 1);
    assert.equal(est.xp, 0);
    assert.equal(est.combo, 0);
    assert.equal(Object.keys(est.areas).length, 8);
    for (const area of AREAS) {
      assert.deepStrictEqual(est.areas[area], { nivel: 1, seguidosOk: 0, seguidosKo: 0, ultimas: [] });
    }
    assert.deepStrictEqual(est.tarjetas, {});
    assert.deepStrictEqual(est.reportadas, []);
    assert.deepStrictEqual(est.historial, []);
    assert.deepStrictEqual(est.racha, { dias: 0, ultimaFecha: null });
    assert.deepStrictEqual(est.hoy, { fecha: HOY, respondidas: 0, aciertos: 0 });
  });
});

// ---------------------------------------------------------------------------
describe('evaluar', () => {
  test('vf acierto y fallo', () => {
    const p = crearPregunta('economia', 'vf', 1);
    assert.equal(evaluar(p, true), true);
    assert.equal(evaluar(p, false), false);
  });
  test('test4 acierto y fallo', () => {
    const p = crearPregunta('economia', 'test4', 1); // correcta: 0
    assert.equal(evaluar(p, 0), true);
    assert.equal(evaluar(p, 1), false);
  });
  test('ordenar acepta [0,1,2,3] y rechaza otro orden', () => {
    const p = crearPregunta('economia', 'ordenar', 1);
    assert.equal(evaluar(p, [0, 1, 2, 3]), true);
    assert.equal(evaluar(p, [1, 0, 2, 3]), false);
  });
  test('error acierto y fallo', () => {
    const p = crearPregunta('economia', 'error', 1); // sospechoso: 1
    assert.equal(evaluar(p, 1), true);
    assert.equal(evaluar(p, 0), false);
  });
});

// ---------------------------------------------------------------------------
describe('seleccionarPartida', () => {
  const banco = crearBancoPrueba();

  test('estado nuevo: 10 ids, todos nivel 1, sin repetidos, mezcla correcta', () => {
    const estado = crearEstado(HOY);
    const ids = seleccionarPartida(estado, banco, HOY, 10, rngDeterminista());
    assert.equal(ids.length, 10);
    assert.equal(new Set(ids).size, 10);

    const porId = new Map(banco.map((p) => [p.id, p]));
    const conteoTipos = { vf: 0, test4: 0, ordenar: 0, error: 0 };
    for (const id of ids) {
      const p = porId.get(id);
      assert.ok(p, `id ${id} debe existir en el banco`);
      assert.equal(p.nivel, 1);
      conteoTipos[p.tipo] += 1;
    }
    assert.deepStrictEqual(conteoTipos, MEZCLA);
  });

  test('ninguna área repetida en posiciones consecutivas', () => {
    const estado = crearEstado(HOY);
    const ids = seleccionarPartida(estado, banco, HOY, 10, rngDeterminista());
    const porId = new Map(banco.map((p) => [p.id, p]));
    for (let i = 1; i < ids.length; i++) {
      assert.notEqual(porId.get(ids[i]).area, porId.get(ids[i - 1]).area);
    }
  });

  test('excluye reportadas', () => {
    const estado = crearEstado(HOY);
    const primera = seleccionarPartida(estado, banco, HOY, 10, rngDeterminista());
    const reportadas = primera.slice(0, 3);
    const estado2 = { ...estado, reportadas };
    const segunda = seleccionarPartida(estado2, banco, HOY, 10, rngDeterminista());
    for (const id of reportadas) {
      assert.ok(!segunda.includes(id), `${id} está reportada y no debería salir`);
    }
  });

  test('con 5 tarjetas vencidas devuelve exactamente las 3 más atrasadas como repasos', () => {
    const estado = crearEstado(HOY);
    const vencidas = [
      { id: 'economia-vf-1', proximo: '2026-09-01' },
      { id: 'historia-vf-1', proximo: '2026-09-02' },
      { id: 'ciencia-vf-1', proximo: '2026-09-03' },
      { id: 'tecnologia-vf-1', proximo: '2026-09-04' },
      { id: 'geografia-vf-1', proximo: '2026-09-05' },
    ];
    for (const v of vencidas) {
      estado.tarjetas[v.id] = { caja: 1, proximo: v.proximo, aciertos: 1, fallos: 0 };
    }
    const ids = seleccionarPartida(estado, banco, HOY, 10, rngDeterminista());
    const vencidasEnResultado = vencidas.map((v) => v.id).filter((id) => ids.includes(id));
    assert.equal(vencidasEnResultado.length, 3);
    const esperadas = vencidas.slice(0, 3).map((v) => v.id); // las 3 más atrasadas (fechas más antiguas)
    for (const id of esperadas) {
      assert.ok(ids.includes(id), `${id} debería estar entre los repasos seleccionados`);
    }
  });

  test('banco de 4 preguntas devuelve 4, no lanza', () => {
    const bancoPequeno = banco.slice(0, 4);
    const estado = crearEstado(HOY);
    let ids;
    assert.doesNotThrow(() => {
      ids = seleccionarPartida(estado, bancoPequeno, HOY, 10, rngDeterminista());
    });
    assert.equal(ids.length, 4);
  });

  test('área en nivel 3 sin preguntas de nivel 3 entra con nivel 2 o 4', () => {
    const bancoEconomiaSinNivel3 = banco.filter((p) => !(p.area === 'economia' && p.nivel === 3));
    const soloEconomia = bancoEconomiaSinNivel3.filter((p) => p.area === 'economia');
    const estado = crearEstado(HOY);
    estado.areas.economia.nivel = 3;
    const ids = seleccionarPartida(estado, soloEconomia, HOY, 4, rngDeterminista());
    assert.equal(ids.length, 4);
    const porId = new Map(soloEconomia.map((p) => [p.id, p]));
    for (const id of ids) {
      const nivel = porId.get(id).nivel;
      assert.ok([2, 4].includes(nivel), `nivel ${nivel} debería ser 2 o 4`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('registrarRespuesta', () => {
  test('acierto test4 nivel 1 desde estado nuevo', () => {
    const estado = crearEstado(HOY);
    const pregunta = crearPregunta('economia', 'test4', 1);
    const { estado: nuevo, delta } = registrarRespuesta(estado, pregunta, true, HOY);
    assert.equal(delta.xp, 9); // 8 * 1.1 = 8.8 -> 9
    assert.equal(delta.combo, 1);
    assert.equal(nuevo.tarjetas[pregunta.id].caja, 1);
    assert.equal(nuevo.tarjetas[pregunta.id].proximo, sumarDias(HOY, INTERVALOS[1]));
  });

  test('fallo reinicia caja y XP a 0', () => {
    const estado = crearEstado(HOY);
    const pregunta = crearPregunta('economia', 'test4', 1);
    const { estado: nuevo, delta } = registrarRespuesta(estado, pregunta, false, HOY);
    assert.equal(delta.xp, 0);
    assert.equal(delta.combo, 0);
    assert.equal(nuevo.tarjetas[pregunta.id].caja, 0);
    assert.equal(nuevo.tarjetas[pregunta.id].proximo, sumarDias(HOY, 1));
    assert.equal(nuevo.areas.economia.seguidosKo, 1);
  });

  test('3 aciertos test4 seguidos suben el nivel del área; 3 vf seguidos no', () => {
    let estado = crearEstado(HOY);
    for (let i = 0; i < 3; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-${i}`), true, HOY);
      estado = r.estado;
    }
    assert.equal(estado.areas.economia.nivel, 2);
    assert.equal(estado.areas.economia.seguidosOk, 0);

    let estadoVf = crearEstado(HOY);
    for (let i = 0; i < 3; i++) {
      const r = registrarRespuesta(estadoVf, crearPregunta('economia', 'vf', 1, `-${i}`), true, HOY);
      estadoVf = r.estado;
    }
    assert.equal(estadoVf.areas.economia.nivel, 1);
  });

  test('2 fallos seguidos bajan el nivel; no baja de 1 ni sube de 5', () => {
    let estado = crearEstado(HOY);
    estado.areas.economia.nivel = 2;
    for (let i = 0; i < 2; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-f${i}`), false, HOY);
      estado = r.estado;
    }
    assert.equal(estado.areas.economia.nivel, 1);

    let estadoMin = crearEstado(HOY); // ya en nivel 1
    for (let i = 0; i < 2; i++) {
      const r = registrarRespuesta(estadoMin, crearPregunta('economia', 'test4', 1, `-g${i}`), false, HOY);
      estadoMin = r.estado;
    }
    assert.equal(estadoMin.areas.economia.nivel, 1);

    let estadoMax = crearEstado(HOY);
    estadoMax.areas.economia.nivel = 5;
    for (let i = 0; i < 3; i++) {
      const r = registrarRespuesta(estadoMax, crearPregunta('economia', 'test4', 5, `-h${i}`), true, HOY);
      estadoMax = r.estado;
    }
    assert.equal(estadoMax.areas.economia.nivel, 5);
  });

  test('tercer acierto seguido aplica combo x1.5 al XP', () => {
    let estado = crearEstado(HOY);
    let ultimoDelta;
    for (let i = 0; i < 3; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-x${i}`), true, HOY);
      estado = r.estado;
      ultimoDelta = r.delta;
    }
    assert.equal(ultimoDelta.xp, 13); // 8 * 1.1 * 1.5 = 13.2 -> 13
  });

  test('hoy.respondidas/aciertos suben y el cambio de fecha reinicia hoy', () => {
    const estado = crearEstado(HOY);
    const r1 = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, '-r1'), true, HOY);
    assert.equal(r1.estado.hoy.respondidas, 1);
    assert.equal(r1.estado.hoy.aciertos, 1);

    const otroDia = sumarDias(HOY, 1);
    const r2 = registrarRespuesta(r1.estado, crearPregunta('economia', 'test4', 1, '-r2'), false, otroDia);
    assert.equal(r2.estado.hoy.fecha, otroDia);
    assert.equal(r2.estado.hoy.respondidas, 1);
    assert.equal(r2.estado.hoy.aciertos, 0);
  });

  test('ultimas no pasa de 20 y historial no pasa de 500', () => {
    let estado = crearEstado(HOY);
    for (let i = 0; i < 25; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-u${i}`), i % 2 === 0, HOY);
      estado = r.estado;
    }
    assert.equal(estado.areas.economia.ultimas.length, 20);

    let estadoHist = crearEstado(HOY);
    for (let i = 0; i < 510; i++) {
      const r = registrarRespuesta(estadoHist, crearPregunta('economia', 'test4', 1, `-h${i}`), true, HOY);
      estadoHist = r.estado;
    }
    assert.equal(estadoHist.historial.length, 500);
  });

  test('no muta el estado de entrada', () => {
    const estado = crearEstado(HOY);
    const copia = structuredClone(estado);
    registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, '-m1'), true, HOY);
    assert.deepStrictEqual(estado, copia);
  });
});

// ---------------------------------------------------------------------------
describe('actualizarRacha', () => {
  test('estado nuevo -> racha 1', () => {
    const estado = actualizarRacha(crearEstado(HOY), HOY);
    assert.equal(estado.racha.dias, 1);
    assert.equal(estado.racha.ultimaFecha, HOY);
  });

  test('jugó ayer -> +1', () => {
    let estado = actualizarRacha(crearEstado(HOY), HOY); // dias 1
    const manana = sumarDias(HOY, 1);
    estado = actualizarRacha(estado, manana);
    assert.equal(estado.racha.dias, 2);
  });

  test('hueco de 2 días -> vuelve a 1', () => {
    let estado = actualizarRacha(crearEstado(HOY), HOY); // dias 1
    const dosDiasDespues = sumarDias(HOY, 2);
    estado = actualizarRacha(estado, dosDiasDespues);
    assert.equal(estado.racha.dias, 1);
  });

  test('mismo día dos veces no cambia la racha', () => {
    let estado = actualizarRacha(crearEstado(HOY), HOY); // dias 1
    estado = actualizarRacha(estado, HOY);
    assert.equal(estado.racha.dias, 1);
  });

  test('resetea el combo', () => {
    const estado = crearEstado(HOY);
    estado.combo = 5;
    const nuevo = actualizarRacha(estado, HOY);
    assert.equal(nuevo.combo, 0);
  });
});

// ---------------------------------------------------------------------------
describe('resumenProgreso', () => {
  const banco = crearBancoPrueba();

  test('aciertoReciente null sin datos', () => {
    const estado = crearEstado(HOY);
    const resumen = resumenProgreso(estado, banco);
    const economia = resumen.porArea.find((a) => a.area === 'economia');
    assert.equal(economia.aciertoReciente, null);
  });

  test('aciertoReciente 0.5 con [true, false]', () => {
    const estado = crearEstado(HOY);
    estado.areas.economia.ultimas = [true, false];
    const resumen = resumenProgreso(estado, banco);
    const economia = resumen.porArea.find((a) => a.area === 'economia');
    assert.equal(economia.aciertoReciente, 0.5);
  });

  test('estables cuenta tarjetas con caja >= 3; total = preguntas del área', () => {
    const estado = crearEstado(HOY);
    estado.tarjetas['economia-test4-1'] = { caja: 3, proximo: HOY, aciertos: 3, fallos: 0 };
    estado.tarjetas['economia-test4-2'] = { caja: 2, proximo: HOY, aciertos: 2, fallos: 0 };
    const resumen = resumenProgreso(estado, banco);
    const economia = resumen.porArea.find((a) => a.area === 'economia');
    assert.equal(economia.estables, 1);
    assert.equal(economia.total, 20); // 5 niveles x 4 tipos
  });
});

// ---------------------------------------------------------------------------
describe('exportar / importar', () => {
  test('ida y vuelta idéntica', () => {
    const estado = crearEstado(HOY);
    const json = exportar(estado);
    const estado2 = importar(json);
    assert.deepStrictEqual(estado, estado2);
  });

  test('importar {} lanza', () => {
    assert.throws(() => importar('{}'));
  });

  test('importar con version distinta de 1 lanza', () => {
    const estado = { ...crearEstado(HOY), version: 2 };
    assert.throws(() => importar(JSON.stringify(estado)));
  });
});
