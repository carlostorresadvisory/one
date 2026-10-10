// ONE · sonido.js — efectos de sonido sintetizados con ZzFX (vendor/zzfx.js, MIT), sin ficheros
// de audio (spec v0.3 §7). ZzFX crea su AudioContext al importarse, así que el motor se carga
// perezoso (`precargar`, al arrancar la app) y nunca a nivel de módulo: en `node --test` o en un
// navegador sin AudioContext el import falla y la app sigue muda, nunca rota (Review Focus 1).
// iOS solo deja sonar un AudioContext si su `resume()` se inicia DENTRO de un gesto del usuario:
// `desbloquear()` es síncrono a propósito y app.js lo llama en cada pointerdown/keydown hasta
// que devuelve true.

export const CLAVE_SILENCIO = 'one.silencio';

// Parámetros de zzfx(volumen, aleatoriedad, frecuencia, ataque, sostenido, caída, forma, curva,
// deslizamiento, deltaDesliz, saltoTono, tiempoSalto, repetición, ruido, modulación, bitcrush,
// retardo, volumenSostenido, decay). Se afinan a oído aquí sin tocar nada más.
export const SONIDOS = Object.freeze({
  ding: Object.freeze([0.9, 0, 1320, 0, 0.02, 0.25, 0, 1.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.04]),
  monedas: Object.freeze([0.9, 0.05, 1675, 0, 0.06, 0.24, 1, 1.82, 0, 0, 837, 0.06]),
  golpe: Object.freeze([1.2, 0.05, 90, 0, 0.04, 0.3, 3, 1.4, -1.5, 0, 0, 0, 0, 0.5]),
  tictac: Object.freeze([0.35, 0, 1900, 0, 0, 0.025, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4]),
  fanfarria: Object.freeze([1, 0, 523, 0.02, 0.18, 0.35, 0, 1.4, 0, 0, 262, 0.09, 0.12, 0, 0, 0, 0, 0.7, 0.05]),
});

/** true/false si el almacén tiene '1'/'0'; null si no hay valor válido o el almacén lanza. */
function leerSilencio(almacen) {
  try {
    const valor = almacen.getItem(CLAVE_SILENCIO);
    if (valor === '1') return true;
    if (valor === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/** `globalThis.localStorage` puede lanzar SecurityError con el almacenamiento bloqueado: null en ese caso. */
function almacenPorDefecto() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function ahora() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function crearSonido({
  almacen = almacenPorDefecto(),
  cargarMotor = () => import('./vendor/zzfx.js'),
  registro = null,
} = {}) {
  let motor = null;
  let carga = null;
  let silencioEnMemoria = false; // respaldo si el almacén no deja leer/escribir
  // Diagnóstico de solo lectura (?depurar=sonido): no altera el comportamiento del sonido.
  const MAX_INTENTOS = 20;
  const intentos = [];
  let tiempoCargaMs = null;

  function estaSilenciado() {
    const guardado = leerSilencio(almacen);
    return guardado === null ? silencioEnMemoria : guardado;
  }

  return {
    precargar() {
      if (!carga) {
        const inicioCarga = ahora();
        carga = Promise.resolve()
          .then(() => cargarMotor())
          .then((modulo) => {
            motor = modulo && typeof modulo.zzfx === 'function' ? modulo : null;
            tiempoCargaMs = ahora() - inicioCarga;
            return Boolean(motor);
          })
          .catch(() => {
            motor = null;
            return false;
          });
      }
      return carga;
    },
    desbloquear(evento = null) {
      const contexto = motor && motor.ZZFX && motor.ZZFX.audioContext;
      const intento = {
        evento,
        estadoAntes: contexto ? contexto.state : 'sin-motor',
        estadoDespues: contexto ? contexto.state : 'sin-motor',
        msResume: null,
        error: null,
      };
      intentos.push(intento);
      if (intentos.length > MAX_INTENTOS) intentos.shift();
      if (!contexto) return false;
      if (contexto.state === 'running') return true;
      try {
        const inicio = ahora();
        const promesa = contexto.resume();
        if (promesa && typeof promesa.then === 'function') {
          promesa.then(
            () => {
              intento.msResume = ahora() - inicio;
              intento.estadoDespues = contexto.state;
            },
            (e) => {
              intento.msResume = ahora() - inicio;
              intento.estadoDespues = contexto.state;
              intento.error = (e && e.name) || String(e);
            },
          );
        }
      } catch (e) {
        intento.error = (e && e.name) || String(e);
      }
      intento.estadoDespues = contexto.state;
      return contexto.state === 'running';
    },
    /** Copia de solo lectura del registro de intentos de desbloqueo (panel ?depurar=sonido). */
    diagnostico() {
      const contexto = motor && motor.ZZFX && motor.ZZFX.audioContext;
      let audioSession = null;
      try {
        audioSession = globalThis.navigator?.audioSession?.type ?? null;
      } catch {
        audioSession = null;
      }
      return {
        motorCargado: Boolean(motor),
        estado: contexto ? contexto.state : 'sin-motor',
        tiempoCargaMs,
        audioSession,
        intentos: intentos.map((i) => ({ ...i })),
      };
    },
    /** 'sin-motor' | 'suspended' | 'running' | … — para el e2e del desbloqueo en iOS. */
    estadoContexto() {
      const contexto = motor && motor.ZZFX && motor.ZZFX.audioContext;
      return contexto ? contexto.state : 'sin-motor';
    },
    reproducir(nombre) {
      if (!motor || !Object.prototype.hasOwnProperty.call(SONIDOS, nombre) || estaSilenciado()) return false;
      try {
        motor.zzfx(...SONIDOS[nombre]);
        if (Array.isArray(registro)) registro.push(nombre);
        return true;
      } catch {
        return false;
      }
    },
    estaSilenciado,
    alternarSilencio() {
      silencioEnMemoria = !estaSilenciado();
      try {
        almacen.setItem(CLAVE_SILENCIO, silencioEnMemoria ? '1' : '0');
      } catch {
        // Modo privado / cuota: el silencio vale para esta sesión.
      }
      return silencioEnMemoria;
    },
  };
}
