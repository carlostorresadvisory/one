// tools/generar-vapid.js: el par que imprime tiene el formato exacto que exige web-push (v0.3.4 C).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generarParVapid } from '../tools/generar-vapid.js';

test('generarParVapid: pública de 65 bytes (punto sin comprimir) y privada de 32, en base64url', () => {
  const { publica, privada } = generarParVapid();
  assert.match(publica, /^[A-Za-z0-9_-]{87}$/);
  assert.match(privada, /^[A-Za-z0-9_-]{43}$/);
  const bytesPublica = Buffer.from(publica, 'base64url');
  assert.equal(bytesPublica.length, 65);
  assert.equal(bytesPublica[0], 0x04);
  assert.equal(Buffer.from(privada, 'base64url').length, 32);
});

test('generarParVapid: la pública corresponde a la privada (misma curva P-256) y cada llamada da un par nuevo', () => {
  const { publica, privada } = generarParVapid();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privada, 'base64url'));
  assert.equal(ecdh.getPublicKey().toString('base64url'), publica);
  assert.notEqual(generarParVapid().privada, privada);
});
