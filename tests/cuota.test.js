// Tests de tools/cuota.js (Tarea 2 del plan v0.2b4.1). Módulo PURO: sin red, sin disco, sin
// dependencias -- el reloj va inyectado para poder viajar en el tiempo sin esperas reales.
// Spec: docs/superpowers/specs/2026-09-15-one-v0.2b4.1-gratis-rapido-design.md §2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimarTokens, msDeCabecera, crearRegistroCuota, VENTANA_TOKENS_MS } from '../tools/cuota.js';

// === estimarTokens ================================================================================

test('estimarTokens: longitud del prompt / 3,5 más el margen de salida (spec §2)', () => {
  const mensajes = [{ role: 'system', content: 'a'.repeat(350) }, { role: 'user', content: 'b'.repeat(700) }];
  // 1050 caracteres / 3,5 = 300, + 800 de maxTokens = 1100.
  assert.equal(estimarTokens(mensajes, 800), 1100);
});

test('estimarTokens: sin mensajes, sin maxTokens o con contenido no-texto, devuelve 0 o solo el margen', () => {
  assert.equal(estimarTokens([], 0), 0);
  assert.equal(estimarTokens(undefined, 500), 500);
  assert.equal(estimarTokens([{ role: 'user' }, { role: 'user', content: 42 }], 0), 0);
});

// === msDeCabecera =================================================================================

test('msDeCabecera: entiende los formatos que devuelven de verdad Groq y OpenRouter', () => {
  assert.equal(msDeCabecera('12'), 12000, 'un número suelto son SEGUNDOS (retry-after de HTTP)');
  assert.equal(msDeCabecera('2.5s'), 2500);
  assert.equal(msDeCabecera('500ms'), 500);
  assert.equal(msDeCabecera('1m30s'), 90000);
  assert.equal(msDeCabecera('2m'), 120000);
  assert.equal(msDeCabecera(null), null);
  assert.equal(msDeCabecera('mañana'), null, 'lo que no se entiende es null, nunca NaN');
});

// === registrarRespuesta + hayHueco ================================================================

// Reloj falso compartido: `avanzar(ms)` viaja en el tiempo sin esperas reales.
function registroDePrueba() {
  let ahora = 1000000;
  const registro = crearRegistroCuota({ reloj: () => ahora });
  return { registro, avanzar: (ms) => { ahora += ms; }, ahora: () => ahora };
}

function respuestaConCabeceras(cabeceras, status = 200) {
  return { status, ok: status < 400, headers: new Headers(cabeceras) };
}

test('cuota: un modelo del que no se sabe nada SIEMPRE tiene hueco (Gemini/NVIDIA no mandan cabeceras)', () => {
  const { registro } = registroDePrueba();
  assert.equal(registro.hayHueco('gemini:gemini-flash-lite-latest', 999999), true);
  // Una respuesta 200 sin ninguna cabecera de cuota tampoco crea registro: sigue sin saberse nada.
  registro.registrarRespuesta('gemini:gemini-flash-lite-latest', respuestaConCabeceras({}));
  assert.equal(registro.hayHueco('gemini:gemini-flash-lite-latest', 999999), true);
});

test('cuota: con tokens restantes por debajo de lo estimado, el eslabón NO tiene hueco', () => {
  const { registro, avanzar } = registroDePrueba();
  registro.registrarRespuesta('groq:openai/gpt-oss-120b', respuestaConCabeceras({
    'x-ratelimit-remaining-tokens': '1200',
    'x-ratelimit-remaining-requests': '940',
    'x-ratelimit-reset-tokens': '7.5s',
  }));
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-120b', 1000), true, '1000 cabe en 1200');
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-120b', 4000), false, '4000 no cabe en 1200');
  // Pasado el minuto de la ventana, la medición caduca y se vuelve a dar por disponible.
  avanzar(VENTANA_TOKENS_MS);
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-120b', 4000), true);
});

test('cuota: sin peticiones al día, no hay hueco aunque queden tokens en el minuto', () => {
  const { registro, avanzar } = registroDePrueba();
  registro.registrarRespuesta('groq:openai/gpt-oss-20b', respuestaConCabeceras({
    'x-ratelimit-remaining-tokens': '8000',
    'x-ratelimit-remaining-requests': '0',
  }));
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-20b', 10), false);
  avanzar(VENTANA_TOKENS_MS * 5);
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-20b', 10), false, 'el día no se acaba en 5 minutos');
});

test('cuota: un 429 con retry-after bloquea el eslabón exactamente ese tiempo', () => {
  const { registro, avanzar } = registroDePrueba();
  registro.registrarRespuesta('groq:qwen/qwen3.8-27b', respuestaConCabeceras({ 'retry-after': '3' }, 429));
  assert.equal(registro.hayHueco('groq:qwen/qwen3.8-27b', 10), false);
  avanzar(2999);
  assert.equal(registro.hayHueco('groq:qwen/qwen3.8-27b', 10), false);
  avanzar(2);
  assert.equal(registro.hayHueco('groq:qwen/qwen3.8-27b', 10), true);
});

test('cuota: un 429 SIN retry-after bloquea el minuto de la ventana (no adivina, asume lo conocido)', () => {
  const { registro, avanzar } = registroDePrueba();
  registro.registrarRespuesta('cerebras:gpt-oss-120b', respuestaConCabeceras({}, 503));
  assert.equal(registro.hayHueco('cerebras:gpt-oss-120b', 10), false);
  avanzar(VENTANA_TOKENS_MS + 1);
  assert.equal(registro.hayHueco('cerebras:gpt-oss-120b', 10), true);
});

test('cuota: olvidar() deja el registro como recién creado (aislamiento entre tests)', () => {
  const { registro } = registroDePrueba();
  registro.registrarRespuesta('groq:openai/gpt-oss-120b', respuestaConCabeceras({ 'retry-after': '60' }, 429));
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-120b', 10), false);
  registro.olvidar();
  assert.equal(registro.hayHueco('groq:openai/gpt-oss-120b', 10), true);
});

// === elegirModelo =================================================================================

const CASCADA = ['gemini:gemini-flash-lite-latest', 'groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b'];

test('elegirModelo: sin datos de nadie, devuelve el PRIMERO de la cascada (el orden manda)', () => {
  const { registro } = registroDePrueba();
  assert.equal(registro.elegirModelo(CASCADA, 5000), CASCADA[0]);
  assert.equal(registro.elegirModelo([], 5000), null);
});

test('elegirModelo: salta el eslabón sin hueco y devuelve el primero que sí lo tiene', () => {
  const { registro } = registroDePrueba();
  registro.registrarRespuesta('gemini:gemini-flash-lite-latest', respuestaConCabeceras({ 'retry-after': '30' }, 429));
  registro.registrarRespuesta('groq:openai/gpt-oss-120b', respuestaConCabeceras({ 'x-ratelimit-remaining-tokens': '500' }));
  // Gemini bloqueado 30 s, Groq 120b sin tokens para 5.000 -> gana el 20b, del que no se sabe nada.
  assert.equal(registro.elegirModelo(CASCADA, 5000), 'groq:openai/gpt-oss-20b');
  // Para una llamada pequeña, el 120b sí tiene hueco y recupera su sitio en el orden.
  assert.equal(registro.elegirModelo(CASCADA, 100), 'groq:openai/gpt-oss-120b');
});

test('elegirModelo: si NINGUNO tiene hueco, devuelve el que antes se recupera (spec §2)', () => {
  const { registro } = registroDePrueba();
  registro.registrarRespuesta('gemini:gemini-flash-lite-latest', respuestaConCabeceras({ 'retry-after': '40' }, 429));
  registro.registrarRespuesta('groq:openai/gpt-oss-120b', respuestaConCabeceras({ 'retry-after': '8' }, 429));
  registro.registrarRespuesta('groq:openai/gpt-oss-20b', respuestaConCabeceras({ 'retry-after': '25' }, 429));
  assert.equal(registro.elegirModelo(CASCADA, 5000), 'groq:openai/gpt-oss-120b', '8 s es antes que 25 y que 40');
});

test('elegirModelo: con dos empatados en "cuándo vuelve", gana el que va antes en la cascada', () => {
  const { registro } = registroDePrueba();
  for (const m of CASCADA) registro.registrarRespuesta(m, respuestaConCabeceras({ 'retry-after': '10' }, 429));
  assert.equal(registro.elegirModelo(CASCADA, 5000), CASCADA[0]);
});
