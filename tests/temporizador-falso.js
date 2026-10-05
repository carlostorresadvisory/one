// setTimeout/clearTimeout de mentira con reloj manual: `avanzar(ms)` ejecuta en orden lo que vence.
export function temporizadorFalso() {
  let ahora = 0;
  let siguienteId = 0;
  const pendientes = new Map();
  return {
    setTimeout(fn, ms) {
      siguienteId += 1;
      pendientes.set(siguienteId, { fn, en: ahora + ms });
      return siguienteId;
    },
    clearTimeout(id) {
      pendientes.delete(id);
    },
    avanzar(ms) {
      const fin = ahora + ms;
      for (;;) {
        let proximo = null;
        for (const [id, t] of pendientes) if (t.en <= fin && (!proximo || t.en < proximo[1].en)) proximo = [id, t];
        if (!proximo) break;
        pendientes.delete(proximo[0]);
        ahora = proximo[1].en;
        proximo[1].fn();
      }
      ahora = fin;
    },
    pendientes: () => pendientes.size,
  };
}
