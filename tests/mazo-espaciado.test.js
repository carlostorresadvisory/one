// Paso (h) de la cascada de encaje de mazo.js (`tarjeta--espaciado-minimo`): su test e2e se perdió al
// borrarse los visuales dibujados. Aquí se comprueba con un nodo falso cuyo alto depende de las clases.
import test from 'node:test';
import assert from 'node:assert/strict';
// mazo.js registra oyentes en `window` al cargarse: se le da uno mínimo antes.
globalThis.window = { addEventListener() {}, getComputedStyle: () => ({ lineHeight: '18px' }) };
const { ajustarEncaje } = await import('../mazo.js');

function tarjetaFalsa(cabeSoloConEstasClases) {
  const clases = new Set();
  const contenido = {
    clientHeight: 100,
    get scrollHeight() {
      return cabeSoloConEstasClases.every((c) => clases.has(c)) ? 100 : 130;
    },
  };
  return {
    clases,
    dataset: { respondida: 'true' },
    style: { setProperty() {} },
    getBoundingClientRect: () => ({ height: 600 }),
    classList: {
      add: (...c) => c.forEach((x) => clases.add(x)),
      remove: (...c) => c.forEach((x) => clases.delete(x)),
      contains: (c) => clases.has(c),
    },
    querySelector: (sel) => (sel === '.tarjeta-contenido' ? contenido : null),
  };
}

test('mazo: sin sitio tras los pasos (a)-(g), la cascada aprieta el aire entre bloques (paso h)', () => {
  const t = tarjetaFalsa(['tarjeta--espaciado-minimo']);
  ajustarEncaje(t);
  assert.ok(t.clases.has('tarjeta--feedback-minimo'));
  assert.ok(t.clases.has('tarjeta--espaciado-minimo'));
  assert.ok(!t.clases.has('tarjeta--zona-color-baja'), 'si el aire basta no se toca la zona de color');
});

test('mazo: el espaciado mínimo se limpia al reajustar si ya cabe sin él', () => {
  const t = tarjetaFalsa(['tarjeta--espaciado-minimo']);
  ajustarEncaje(t);
  assert.ok(t.clases.has('tarjeta--espaciado-minimo'));
  t.classList.remove('tarjeta--espaciado-minimo');
  const holgada = tarjetaFalsa([]);
  holgada.clases.add('tarjeta--espaciado-minimo');
  ajustarEncaje(holgada);
  assert.ok(!holgada.clases.has('tarjeta--espaciado-minimo'));
});
