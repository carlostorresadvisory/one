// Tests de sonido.js (spec v0.3 §7): sin AudioContext real -- el motor ZzFX se inyecta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSonido, SONIDOS, CLAVE_SILENCIO } from '../sonido.js';
import { almacenFalso, almacenRoto } from './almacen-falso.js';

function motorFalso({ estado = 'suspended' } = {}) {
  const llamadas = [];
  const contexto = {
    state: estado,
    reanudaciones: 0,
    resume() {
      this.reanudaciones += 1;
      this.state = 'running';
      return Promise.resolve();
    },
  };
  return { llamadas, contexto, modulo: { zzfx: (...p) => llamadas.push(p), ZZFX: { audioContext: contexto } } };
}

test('SONIDOS: los cinco sonidos de la spec, cada uno con parámetros numéricos', () => {
  assert.deepEqual(Object.keys(SONIDOS).sort(), ['ding', 'fanfarria', 'golpe', 'monedas', 'tictac']);
  for (const parametros of Object.values(SONIDOS)) {
    assert.ok(parametros.length >= 3);
    assert.ok(parametros.every((n) => typeof n === 'number' && Number.isFinite(n)));
  }
});

test('reproducir antes de precargar no suena ni lanza', () => {
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => motorFalso().modulo });
  assert.equal(sonido.reproducir('ding'), false);
});

test('precargar + reproducir llama a zzfx con los parámetros del sonido y lo apunta en el registro', async () => {
  const motor = motorFalso();
  const registro = [];
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => motor.modulo, registro });
  assert.equal(await sonido.precargar(), true);
  assert.equal(sonido.reproducir('ding'), true);
  assert.deepEqual(motor.llamadas, [[...SONIDOS.ding]]);
  assert.deepEqual(registro, ['ding']);
});

test('reproducir un nombre desconocido devuelve false sin llamar al motor', async () => {
  const motor = motorFalso();
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => motor.modulo });
  await sonido.precargar();
  assert.equal(sonido.reproducir('trompeta'), false);
  assert.equal(motor.llamadas.length, 0);
});

test('Review Focus 1: cargarMotor que rechaza (sin AudioContext) deja la app muda, sin lanzar', async () => {
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => { throw new Error('AudioContext is not defined'); } });
  assert.equal(await sonido.precargar(), false);
  assert.equal(sonido.desbloquear(), false);
  assert.equal(sonido.reproducir('golpe'), false);
});

test('precargar es idempotente: una sola carga del motor', async () => {
  let cargas = 0;
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => { cargas += 1; return motorFalso().modulo; } });
  await Promise.all([sonido.precargar(), sonido.precargar()]);
  await sonido.precargar();
  assert.equal(cargas, 1);
});

test('desbloquear llama a resume() de forma síncrona y devuelve true cuando el contexto ya corre', async () => {
  const motor = motorFalso();
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => motor.modulo });
  await sonido.precargar();
  sonido.desbloquear(); // dentro del gesto: inicia el resume
  assert.equal(motor.contexto.reanudaciones, 1);
  assert.equal(sonido.desbloquear(), true); // ya 'running': no hace falta reanudar más
  assert.equal(motor.contexto.reanudaciones, 1);
});

test('audio iOS: la precarga deja el contexto suspendido y SOLO el gesto (desbloquear, síncrono) lo reanuda', async () => {
  const motor = motorFalso({ estado: 'suspended' });
  const sonido = crearSonido({ almacen: almacenFalso(), cargarMotor: async () => motor.modulo });
  assert.equal(sonido.estadoContexto(), 'sin-motor');
  assert.equal(sonido.desbloquear(), false); // gesto antes de que termine la precarga: no lanza
  await sonido.precargar();
  assert.equal(sonido.estadoContexto(), 'suspended');
  assert.equal(motor.contexto.reanudaciones, 0); // precargar NO reanuda (fuera de gesto no serviría en iOS)
  sonido.desbloquear();
  assert.equal(motor.contexto.reanudaciones, 1); // resume() llamado sin await de por medio
  assert.equal(sonido.estadoContexto(), 'running');
});

test('silencio: alterna, persiste en one.silencio y silencia reproducir', async () => {
  const almacen = almacenFalso();
  const motor = motorFalso();
  const sonido = crearSonido({ almacen, cargarMotor: async () => motor.modulo });
  await sonido.precargar();
  assert.equal(sonido.estaSilenciado(), false);
  assert.equal(sonido.alternarSilencio(), true);
  assert.equal(almacen.getItem(CLAVE_SILENCIO), '1');
  assert.equal(sonido.reproducir('ding'), false);
  assert.equal(sonido.alternarSilencio(), false);
  assert.equal(almacen.getItem(CLAVE_SILENCIO), '0');
  assert.equal(sonido.reproducir('ding'), true);
});

test('silencio leído del almacén en cada llamada (un Importar lo cambia sin recrear el módulo)', () => {
  const almacen = almacenFalso();
  const sonido = crearSonido({ almacen, cargarMotor: async () => motorFalso().modulo });
  almacen.setItem(CLAVE_SILENCIO, '1');
  assert.equal(sonido.estaSilenciado(), true);
});

test('Review Focus 2: almacén roto -- silencio en memoria, nada lanza', () => {
  const sonido = crearSonido({ almacen: almacenRoto(), cargarMotor: async () => motorFalso().modulo });
  assert.equal(sonido.estaSilenciado(), false);
  assert.equal(sonido.alternarSilencio(), true);
  assert.equal(sonido.estaSilenciado(), true);
});

test('valor basura en one.silencio cuenta como no silenciado', () => {
  const sonido = crearSonido({ almacen: almacenFalso({ [CLAVE_SILENCIO]: 'tal vez' }), cargarMotor: async () => motorFalso().modulo });
  assert.equal(sonido.estaSilenciado(), false);
});

test('Review Focus 2: el getter de globalThis.localStorage lanza (almacenamiento bloqueado) -- crearSonido() no lanza y el silencio va en memoria', () => {
  const previo = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: almacenamiento bloqueado');
    },
  });
  try {
    const sonido = crearSonido({ cargarMotor: async () => motorFalso().modulo });
    assert.equal(sonido.estaSilenciado(), false);
    assert.equal(sonido.alternarSilencio(), true);
    assert.equal(sonido.estaSilenciado(), true);
  } finally {
    if (previo) Object.defineProperty(globalThis, 'localStorage', previo);
    else delete globalThis.localStorage;
  }
});
