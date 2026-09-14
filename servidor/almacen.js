// Persistencia en disco del servidor de generación (Tarea 2 del plan v0.2b1-servidor).
// Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.2.
//
// Reglas fijadas por el controlador para esta tarea:
// - JSON "pretty" de 1 espacio (JSON.stringify(obj, null, 1)).
// - Escritura atómica: se escribe primero a "<nombre>.tmp" y se hace `rename` al nombre final, para
//   que un lector nunca vea un fichero a medio escribir. `mkdir -p` antes de escribir.
// - Una lectura de un fichero que no existe devuelve el valor vacío correspondiente (no lanza).
// - Un JSON corrupto se renombra a "<nombre>.roto-<ISO>" (los ':' del ISO se sustituyen por '-'
//   porque Windows no admite ':' en nombres de fichero) y se parte de vacío; se anota con
//   console.error -- la ÚNICA salida de consola permitida en este fichero.
// - Nada de este fichero lee OPENROUTER_API_KEY ni imprime prompts/respuestas (no tiene motivo para
//   tocar nada de eso: solo hace I/O de disco).
//
// Ronda 2 (revisión adversarial de la Tarea 2, 14-sep-2026) -- Critical: `servir()`/`reportar()` en
// cola.js hacían su propio leer->modificar->escribir de colchon.json sin serializarse frente al
// guardado de cada lote (`guardarNuevasEnColchon`) ni entre sí -- lost update real (misma pregunta
// sirviéndose dos veces, aprobadas perdidas, una reportada "revivida"). `conCerrojo(nombre, fn)` es
// el mutex por fichero que lo arregla: una cola de promesas encadenadas por nombre de fichero, para
// que quien haga un leer->modificar->escribir lo envuelva entero en una sola sección crítica. Vive
// aquí (no en cola.js) porque el cerrojo tiene que ser el mismo objeto para TODOS los llamantes que
// comparten el mismo `rutaDatos` -- éste es el módulo con ese ámbito.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function marcaIsoParaFichero() {
  return new Date().toISOString().replace(/:/g, '-');
}

async function leerJson(rutaDatos, nombre, vacio) {
  const rutaFichero = path.join(rutaDatos, nombre);
  let texto;
  try {
    texto = await readFile(rutaFichero, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return vacio;
    throw err;
  }

  try {
    return JSON.parse(texto);
  } catch (err) {
    const destino = path.join(rutaDatos, `${nombre}.roto-${marcaIsoParaFichero()}`);
    try {
      await rename(rutaFichero, destino);
    } catch {
      // Si ni siquiera se puede renombrar (p.ej. ya no existe), no hay nada más que hacer: se
      // sigue partiendo de vacío igualmente.
    }
    console.error(`servidor/almacen: ${nombre} tenía JSON inválido, movido a ${destino}; se parte de vacío.`);
    return vacio;
  }
}

async function escribirAtomicoEn(rutaDatos, nombre, objeto) {
  await mkdir(rutaDatos, { recursive: true });
  const rutaFinal = path.join(rutaDatos, nombre);
  const rutaTmp = `${rutaFinal}.tmp`;
  await writeFile(rutaTmp, JSON.stringify(objeto, null, 1), 'utf8');
  await rename(rutaTmp, rutaFinal);
}

/**
 * Crea el almacén de disco del servidor sobre la carpeta `rutaDatos` (p.ej. `/datos-servidor` en
 * el VPS, o una carpeta temporal en tests). Todas las operaciones son atómicas y ninguna lanza por
 * fichero ausente (devuelven el valor vacío correspondiente).
 * @param {string} rutaDatos
 */
export function crearAlmacen(rutaDatos) {
  async function escribirAtomico(nombre, objeto) {
    await escribirAtomicoEn(rutaDatos, nombre, objeto);
  }

  // Mutex por fichero: una `Promise` "cola" por nombre. `conCerrojo(nombre, fn)` encadena `fn`
  // detrás de lo último pendiente para ESE nombre (nunca dos `fn` del mismo fichero corriendo a la
  // vez, en orden de llamada) y devuelve el resultado/error de ESA `fn`, sin mezclarlo con el de
  // las demás. Guardamos en el mapa una versión que SIEMPRE resuelve (`.catch(() => {})`) para que
  // un `fn` que lanza no deje bloqueada la cola para las siguientes llamadas -- si no, un solo
  // fallo dejaría ese fichero sin poder escribirse nunca más.
  //
  // Deliberadamente NO se usa dentro de `leerColchon`/`guardarColchon` (ni de las demás lecturas y
  // escrituras sueltas de este fichero): este mutex no es reentrante, y cola.js necesita poder
  // hacer su propio leer->modificar->escribir de "colchon.json" como UNA sola sección crítica
  // (`almacen.conCerrojo('colchon.json', async () => { leer, modificar, escribir })`) -- si
  // `leerColchon`/`guardarColchon` intentaran coger el mismo cerrojo por su cuenta, esa llamada
  // interior se quedaría esperando a que termine la exterior que la contiene: interbloqueo.
  const colasPorFichero = new Map();
  function conCerrojo(nombre, fn) {
    const previa = colasPorFichero.get(nombre) || Promise.resolve();
    const resultado = previa.then(fn, fn);
    colasPorFichero.set(nombre, resultado.catch(() => {}));
    return resultado;
  }

  return {
    async leerColchon() {
      return leerJson(rutaDatos, 'colchon.json', []);
    },
    async guardarColchon(lista) {
      await escribirAtomico('colchon.json', lista);
    },
    async leerRechazadas() {
      return leerJson(rutaDatos, 'rechazadas.json', []);
    },
    async anadirRechazadas(items) {
      if (!items || items.length === 0) return;
      const actuales = await leerJson(rutaDatos, 'rechazadas.json', []);
      const combinadas = actuales.concat(items).slice(-500);
      await escribirAtomico('rechazadas.json', combinadas);
    },
    async leerAnillos() {
      return leerJson(rutaDatos, 'anillos.json', {});
    },
    async guardarAnillo(clave, subtemas) {
      const actuales = await leerJson(rutaDatos, 'anillos.json', {});
      actuales[clave] = subtemas;
      await escribirAtomico('anillos.json', actuales);
    },
    async leerReportadas() {
      return leerJson(rutaDatos, 'reportadas.json', []);
    },
    async anadirReportada(id) {
      const actuales = await leerJson(rutaDatos, 'reportadas.json', []);
      if (!actuales.includes(id)) {
        actuales.push(id);
        await escribirAtomico('reportadas.json', actuales);
      }
    },
    escribirAtomico,
    conCerrojo,
  };
}
