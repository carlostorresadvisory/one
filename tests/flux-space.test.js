// tools/flux-space.py: usa HF_TOKEN si existe y no lo imprime nunca. Sin red: un gradio_client falso
// (carpeta temporal en PYTHONPATH) apunta con qué token se creó el cliente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hayPython = spawnSync('python', ['--version']).status === 0;

function lanzar(extraEntorno, { falla = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flux-'));
  const registro = join(dir, 'registro.json');
  const imagen = join(dir, 'origen.png');
  writeFileSync(imagen, 'png-falso');
  writeFileSync(join(dir, 'gradio_client.py'), `
import json, os
class Client:
    def __init__(self, src, token=None, verbose=False):
        json.dump({"src": src, "token": token}, open(os.environ["REGISTRO"], "w"))
        self.token = token
    def predict(self, **kw):
        if ${falla ? 'True' : 'False'}:
            raise RuntimeError("GPU quota exceeded for token " + str(self.token))
        return [os.environ["IMAGEN"], 1]
`);
  const salida = join(dir, 'salida.png');
  const env = { ...process.env, PYTHONPATH: dir, REGISTRO: registro, IMAGEN: imagen, ...extraEntorno };
  if (!('HF_TOKEN' in extraEntorno)) delete env.HF_TOKEN;
  const r = spawnSync('python', ['tools/flux-space.py', 'un prompt', salida], { env, encoding: 'utf8' });
  return { r, salida, leerRegistro: () => JSON.parse(readFileSync(registro, 'utf8')) };
}

test('flux-space.py: con HF_TOKEN crea el cliente con ese token', { skip: !hayPython }, () => {
  const { r, salida, leerRegistro } = lanzar({ HF_TOKEN: 'hf_secreto_de_prueba' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(leerRegistro().token, 'hf_secreto_de_prueba');
  assert.equal(readFileSync(salida, 'utf8'), 'png-falso');
});

test('flux-space.py: sin HF_TOKEN (o vacío) va anónimo, como antes', { skip: !hayPython }, () => {
  for (const extra of [{}, { HF_TOKEN: '  ' }]) {
    const { r, leerRegistro } = lanzar(extra);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(leerRegistro().token, null);
  }
});

test('flux-space.py: cupo agotado = salida 3 y el token no sale en stderr', { skip: !hayPython }, () => {
  const { r, salida } = lanzar({ HF_TOKEN: 'hf_secreto_de_prueba' }, { falla: true });
  assert.equal(r.status, 3);
  assert.doesNotMatch(r.stderr, /hf_secreto_de_prueba/);
  assert.match(r.stderr, /quota/i);
  assert.equal(existsSync(salida), false);
});
