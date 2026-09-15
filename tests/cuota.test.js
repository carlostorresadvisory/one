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
