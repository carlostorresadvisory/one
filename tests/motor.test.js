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
  siguientePregunta,
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
    assert.equal(est.nivelPartida, 1); // escalera inmediata: arranca en 1
    assert.equal(Object.keys(est.areas).length, 8);
    for (const area of AREAS) {
      assert.deepStrictEqual(est.areas[area], { nivel: 1, seguidosOk: 0, seguidosKo: 0, ultimas: [], noLoSe: 0 });
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

  test('si falta un tipo, rellena el cupo con otros tipos hasta n (objeción adversarial 1)', () => {
    const soloVfYTest = banco.filter((p) => p.tipo === 'vf' || p.tipo === 'test4');
    const estado = crearEstado(HOY);
    const ids = seleccionarPartida(estado, soloVfYTest, HOY, 10, rngDeterminista());
    assert.equal(ids.length, 10);
    assert.equal(new Set(ids).size, 10);
  });

  test('con 12 preguntas de niveles 1-2 y área nivel 1 devuelve 10, no 6', () => {
    const doce = [];
    for (const area of AREAS.slice(0, 4)) {
      for (const tipo of ['vf', 'test4', 'ordenar']) {
        doce.push(crearPregunta(area, tipo, doce.length % 2 === 0 ? 1 : 2, 'x'));
      }
    }
    const ids = seleccionarPartida(crearEstado(HOY), doce, HOY, 10, rngDeterminista());
    assert.equal(ids.length, 10);
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
describe('siguientePregunta', () => {
  const banco = crearBancoPrueba();

  test('devuelve una pregunta de nivel == nivelPartida cuando hay disponible', () => {
    const estado = crearEstado(HOY);
    const p = siguientePregunta(estado, banco, HOY, new Set(), rngDeterminista());
    assert.ok(p);
    assert.equal(p.nivel, estado.nivelPartida);
  });

  test('si no hay del nivel exacto, amplía a ±1', () => {
    const sinNivel3 = banco.filter((p) => p.nivel !== 3);
    const estado = crearEstado(HOY);
    estado.nivelPartida = 3;
    const p = siguientePregunta(estado, sinNivel3, HOY, new Set(), rngDeterminista());
    assert.ok(p);
    assert.ok([2, 4].includes(p.nivel));
  });

  test('banco agotado devuelve null, nunca lanza', () => {
    const estado = crearEstado(HOY);
    let p;
    assert.doesNotThrow(() => {
      p = siguientePregunta(estado, [], HOY, new Set());
    });
    assert.equal(p, null);
  });

  test('no repite usados ni reportadas', () => {
    const tres = banco.filter((p) => p.area === 'economia' && p.tipo === 'test4').slice(0, 3);
    const estado = crearEstado(HOY);
    estado.reportadas = [tres[0].id];
    const usados = new Set([tres[1].id]);
    const p = siguientePregunta(estado, tres, HOY, usados, rngDeterminista());
    assert.ok(p);
    assert.equal(p.id, tres[2].id);
  });

  test('prefiere un repaso vencido cuando hay 5 o más pendientes (aunque el azar no lo pida)', () => {
    const estado = crearEstado(HOY);
    const idsRepaso = [
      'economia-test4-1',
      'historia-test4-1',
      'ciencia-test4-1',
      'tecnologia-test4-1',
      'geografia-test4-1',
    ];
    idsRepaso.forEach((id, i) => {
      estado.tarjetas[id] = { caja: 1, proximo: sumarDias(HOY, -(i + 1)), aciertos: 1, fallos: 0 };
    });
    const p = siguientePregunta(estado, banco, HOY, new Set(), () => 0.99);
    assert.ok(p);
    assert.ok(idsRepaso.includes(p.id));
    assert.equal(p.id, 'geografia-test4-1'); // el más atrasado (hoy - 5 días)
  });

  test('no repite tipo ni área de "ultima" cuando hay alternativa', () => {
    const estado = crearEstado(HOY);
    const ultima = banco.find((p) => p.area === 'economia' && p.tipo === 'test4' && p.nivel === 1);
    const p = siguientePregunta(estado, banco, HOY, new Set(), rngDeterminista(), ultima);
    assert.ok(p);
    assert.notEqual(p.tipo, ultima.tipo);
    assert.notEqual(p.area, ultima.area);
  });

  // --- filtro (7º parámetro): "practicar solo un área" ---
  test('con filtro por área, siempre devuelve preguntas de esa área (repetido varias veces)', () => {
    const estado = crearEstado(HOY);
    const usados = new Set();
    for (let i = 0; i < 15; i++) {
      const p = siguientePregunta(estado, banco, HOY, usados, rngDeterminista(), null, { area: 'historia' });
      assert.ok(p, `debería devolver pregunta en la vuelta ${i}`);
      assert.equal(p.area, 'historia');
      usados.add(p.id);
    }
  });

  test('con filtro, devuelve null si el área filtrada se agota aunque queden otras áreas', () => {
    const estado = crearEstado(HOY);
    // Banco reducido a una sola pregunta de historia; el resto de áreas siguen teniendo de sobra.
    const unaDeHistoria = banco.filter((p) => p.area === 'historia').slice(0, 1);
    const otrasAreas = banco.filter((p) => p.area !== 'historia');
    const bancoLimitado = [...unaDeHistoria, ...otrasAreas];
    const usados = new Set([unaDeHistoria[0].id]); // la única de historia ya está "usada" (agotada)
    const p = siguientePregunta(estado, bancoLimitado, HOY, usados, rngDeterminista(), null, { area: 'historia' });
    assert.equal(p, null);
  });

  test('el filtro también se aplica a los repasos vencidos, no solo a las nuevas', () => {
    const estado = crearEstado(HOY);
    // Tarjeta vencida de un área DISTINTA a la filtrada: no debe salir aunque el
    // azar "quiera" repaso (rng() < 0.3 siempre con () => 0).
    estado.tarjetas['tecnologia-test4-1'] = { caja: 1, proximo: sumarDias(HOY, -3), aciertos: 1, fallos: 0 };
    const p = siguientePregunta(estado, banco, HOY, new Set(), () => 0, null, { area: 'economia' });
    assert.ok(p);
    assert.equal(p.area, 'economia');
    assert.notEqual(p.id, 'tecnologia-test4-1');
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

  test('nivelPartida sube con acierto y baja con fallo, con topes 1 y 5', () => {
    let estado = crearEstado(HOY);
    const r1 = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, '-np1'), true, HOY);
    assert.equal(r1.estado.nivelPartida, 2);
    assert.equal(r1.delta.nivelPartida, 2);
    assert.equal(r1.delta.cambioNivelPartida, 1);

    const r2 = registrarRespuesta(r1.estado, crearPregunta('economia', 'test4', 1, '-np2'), false, HOY);
    assert.equal(r2.estado.nivelPartida, 1);
    assert.equal(r2.delta.cambioNivelPartida, -1);

    // Tope inferior: ya en 1, un fallo más no baja de 1.
    const r3 = registrarRespuesta(r2.estado, crearPregunta('economia', 'test4', 1, '-np3'), false, HOY);
    assert.equal(r3.estado.nivelPartida, 1);
    assert.equal(r3.delta.cambioNivelPartida, 0);

    // Tope superior: sube hasta 5 y no lo pasa.
    let estadoMax = crearEstado(HOY);
    for (let i = 0; i < 4; i++) {
      const r = registrarRespuesta(estadoMax, crearPregunta('economia', 'test4', 1, `-npmax${i}`), true, HOY);
      estadoMax = r.estado;
    }
    assert.equal(estadoMax.nivelPartida, 5);
    const r5 = registrarRespuesta(estadoMax, crearPregunta('economia', 'test4', 1, '-npmax4'), true, HOY);
    assert.equal(r5.estado.nivelPartida, 5);
    assert.equal(r5.delta.cambioNivelPartida, 0);
  });

  test('V/F también mueve la escalera de nivelPartida (aunque no mueva el nivel del área)', () => {
    const estado = crearEstado(HOY);
    const r1 = registrarRespuesta(estado, crearPregunta('economia', 'vf', 1, '-vfnp1'), true, HOY);
    assert.equal(r1.estado.nivelPartida, 2);
    const r2 = registrarRespuesta(r1.estado, crearPregunta('economia', 'vf', 1, '-vfnp2'), false, HOY);
    assert.equal(r2.estado.nivelPartida, 1);
  });

  test('delta incluye nivelPartida, cambioNivelPartida, nivelArea y cambioNivelArea; cambioNivelArea es +1 en el tercer acierto no-vf', () => {
    let estado = crearEstado(HOY);
    let ultimoDelta;
    for (let i = 0; i < 3; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-nv${i}`), true, HOY);
      estado = r.estado;
      ultimoDelta = r.delta;
    }
    assert.equal(estado.areas.economia.nivel, 2); // sube en el 3er acierto
    assert.equal(ultimoDelta.nivelPartida, 4); // 1 -> 2 -> 3 -> 4, un +1 por acierto
    assert.equal(ultimoDelta.cambioNivelPartida, 1);
    assert.equal(ultimoDelta.nivelArea, 2);
    assert.equal(ultimoDelta.cambioNivelArea, 1);
  });

  test('no muta el estado de entrada', () => {
    const estado = crearEstado(HOY);
    const copia = structuredClone(estado);
    registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, '-m1'), true, HOY);
    assert.deepStrictEqual(estado, copia);
  });

  // --- opciones.noLoSe: botón "No lo sé" ---
  test('noLoSe se trata como fallo: caja a 0, próximo a +1 día, XP 0, combo 0', () => {
    const estado = crearEstado(HOY);
    const pregunta = crearPregunta('economia', 'test4', 1, '-nls1');
    const { estado: nuevo, delta } = registrarRespuesta(estado, pregunta, true, HOY, { noLoSe: true });
    // Aunque se pase `correcta: true`, noLoSe manda: se trata igual que un fallo.
    assert.equal(delta.xp, 0);
    assert.equal(delta.combo, 0);
    assert.equal(delta.correcta, false);
    assert.equal(nuevo.tarjetas[pregunta.id].caja, 0);
    assert.equal(nuevo.tarjetas[pregunta.id].proximo, sumarDias(HOY, 1));
  });

  test('noLoSe baja el nivel de área y la escalera igual que un fallo normal', () => {
    let estado = crearEstado(HOY);
    estado.areas.economia.nivel = 2;
    estado.nivelPartida = 2;
    for (let i = 0; i < 2; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-nlsniv${i}`), false, HOY, { noLoSe: true });
      estado = r.estado;
    }
    assert.equal(estado.areas.economia.nivel, 1);
    assert.equal(estado.nivelPartida, 1);
  });

  test('el historial guarda noLoSe: true en la entrada de una respuesta "no lo sé"', () => {
    const estado = crearEstado(HOY);
    const pregunta = crearPregunta('economia', 'test4', 1, '-nlshist');
    const { estado: nuevo } = registrarRespuesta(estado, pregunta, false, HOY, { noLoSe: true });
    const entrada = nuevo.historial.find((h) => h.id === pregunta.id);
    assert.ok(entrada);
    assert.equal(entrada.noLoSe, true);

    const { estado: nuevo2 } = registrarRespuesta(nuevo, crearPregunta('economia', 'test4', 1, '-normal'), true, HOY);
    const entradaNormal = nuevo2.historial.find((h) => h.id === 'economia-test4-1-normal');
    assert.equal(entradaNormal.noLoSe, false);
  });

  test('areas[area].noLoSe cuenta las veces que se ha pulsado "no lo sé" en esa área', () => {
    let estado = crearEstado(HOY);
    for (let i = 0; i < 3; i++) {
      const r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, `-nlscount${i}`), false, HOY, { noLoSe: true });
      estado = r.estado;
    }
    const r = registrarRespuesta(estado, crearPregunta('historia', 'test4', 1, '-nlsotra'), false, HOY, { noLoSe: true });
    estado = r.estado;
    assert.equal(estado.areas.economia.noLoSe, 3);
    assert.equal(estado.areas.historia.noLoSe, 1);
    assert.equal(estado.areas.ciencia.noLoSe, 0);
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

  test('porArea incluye noLoSe por área (contador, no afecta a aciertoReciente)', () => {
    let estado = crearEstado(HOY);
    const r = registrarRespuesta(
      estado,
      crearPregunta('economia', 'test4', 1, '-resnls'),
      true,
      HOY,
      { noLoSe: true }
    );
    estado = r.estado;
    const resumen = resumenProgreso(estado, banco);
    const economia = resumen.porArea.find((a) => a.area === 'economia');
    assert.equal(economia.noLoSe, 1);
    // aciertoReciente sigue siendo la misma definición: % de acierto de `ultimas`,
    // y noLoSe cuenta como fallo dentro de esa serie.
    assert.equal(economia.aciertoReciente, 0);
  });

  test('resumenProgreso añade un total global {respondidas, aciertos, noLoSe} acumulado del historial', () => {
    let estado = crearEstado(HOY);
    let r = registrarRespuesta(estado, crearPregunta('economia', 'test4', 1, '-g1'), true, HOY);
    estado = r.estado;
    r = registrarRespuesta(estado, crearPregunta('historia', 'test4', 1, '-g2'), false, HOY);
    estado = r.estado;
    r = registrarRespuesta(estado, crearPregunta('ciencia', 'test4', 1, '-g3'), false, HOY, { noLoSe: true });
    estado = r.estado;
    const resumen = resumenProgreso(estado, banco);
    assert.deepStrictEqual(resumen.global, { respondidas: 3, aciertos: 1, noLoSe: 1 });
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

  test('importar con areas vacías y racha rota normaliza y permite jugar (objeción adversarial 2)', () => {
    const roto = {
      version: 1, xp: 0, combo: 0, racha: {}, hoy: { fecha: HOY, respondidas: 0, aciertos: 0 },
      areas: {}, tarjetas: { mala: { caja: 'x' } }, reportadas: 'no-array', historial: [],
    };
    const estado = importar(JSON.stringify(roto));
    assert.equal(estado.areas.economia.nivel, 1);
    assert.deepEqual(estado.racha, { dias: 0, ultimaFecha: null });
    assert.deepEqual(estado.reportadas, []);
    assert.equal(estado.tarjetas.mala, undefined);
    const pregunta = crearPregunta('economia', 'test4', 1);
    assert.doesNotThrow(() => registrarRespuesta(estado, pregunta, true, HOY));
  });

  test('importar {} lanza', () => {
    assert.throws(() => importar('{}'));
  });

  test('importar con version distinta de 1 lanza', () => {
    const estado = { ...crearEstado(HOY), version: 2 };
    assert.throws(() => importar(JSON.stringify(estado)));
  });

  test('importar sanea nivelPartida inválido (falta, fuera de rango o no entero) a 1', () => {
    const base = {
      version: 1, xp: 0, combo: 0, racha: { dias: 0, ultimaFecha: null },
      hoy: { fecha: HOY, respondidas: 0, aciertos: 0 },
      areas: {}, tarjetas: {}, reportadas: [], historial: [],
    };
    assert.equal(importar(JSON.stringify(base)).nivelPartida, 1); // falta el campo
    assert.equal(importar(JSON.stringify({ ...base, nivelPartida: 9 })).nivelPartida, 1); // fuera de rango
    assert.equal(importar(JSON.stringify({ ...base, nivelPartida: 'x' })).nivelPartida, 1); // no es entero
    assert.equal(importar(JSON.stringify({ ...base, nivelPartida: 3 })).nivelPartida, 3); // válido: se respeta
  });

  test('importar sanea areas[area].noLoSe inválido (falta o negativo) a 0, y respeta un valor válido', () => {
    const conAreaValida = {
      version: 1, xp: 0, combo: 0, racha: { dias: 0, ultimaFecha: null },
      hoy: { fecha: HOY, respondidas: 0, aciertos: 0 },
      areas: { economia: { nivel: 2, seguidosOk: 0, seguidosKo: 0, ultimas: [] } }, // sin noLoSe
      tarjetas: {}, reportadas: [], historial: [],
    };
    assert.equal(importar(JSON.stringify(conAreaValida)).areas.economia.noLoSe, 0);

    const conNoLoSeNegativo = {
      ...conAreaValida,
      areas: { economia: { nivel: 2, seguidosOk: 0, seguidosKo: 0, ultimas: [], noLoSe: -3 } },
    };
    assert.equal(importar(JSON.stringify(conNoLoSeNegativo)).areas.economia.noLoSe, 0);

    const conNoLoSeValido = {
      ...conAreaValida,
      areas: { economia: { nivel: 2, seguidosOk: 0, seguidosKo: 0, ultimas: [], noLoSe: 4 } },
    };
    assert.equal(importar(JSON.stringify(conNoLoSeValido)).areas.economia.noLoSe, 4);
  });
});
