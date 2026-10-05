// localStorage de mentira para los tests de node:test (sonido, mochila, filtro, modos, respaldo).
// `almacenRoto` simula modo privado/cuota llena: cualquier acceso lanza.
export function almacenFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => {
      datos.set(clave, String(valor));
    },
    removeItem: (clave) => {
      datos.delete(clave);
    },
    datos,
  };
}

export function almacenRoto() {
  const lanzar = () => {
    throw new Error('almacén no disponible');
  };
  return { getItem: lanzar, setItem: lanzar, removeItem: lanzar };
}
