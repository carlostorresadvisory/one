// ONE · relleno por lotes de las imágenes del colchón del servidor (plan v0.3.5, punto 3).
// Toma las preguntas de <datos>/colchon.json que siguen sin imagen y les busca una con LA MISMA búsqueda que usa el
// servidor (servidor/imagenes.js#crearResolvedorReal): Commons -> bancos libres -> IA (Cloudflare FLUX; Runware solo
// si Cloudflare agota el tramo, hay clave y el gasto del día no pasa de 0,10 EUR), con el juez de visión (>= 4) y el
// cupo propio de IA (<datos>/cupo-ia.json, 100/día). Reutiliza servidor/cola.js#completarImagenesPendientes, así que
// las reglas son exactamente las del servidor: las viejas sin imagen se marcan pendientes al cargar, un fallo técnico
// no gasta intento, si hoy no hay IA la pregunta espera (6 h) y solo se rinde la que la política no deja ilustrar con IA.
//
// Uso (desde la raíz del repo; las claves llegan por el entorno, el script nunca las lee ni las imprime):
//   node --env-file=.env tools/rellenar-colchon.js --datos /opt/one-datos --dry-run
//   node --env-file=.env tools/rellenar-colchon.js --datos /opt/one-datos --limite 50 [--lote 10]
//   --datos   carpeta con colchon.json (por defecto RUTA_DATOS o /opt/one-datos)
//   --limite  máximo de preguntas a intentar en esta ejecución (por defecto 50)
//   --lote    preguntas por pasada (por defecto 10, el tope de pasada del servidor)
//   --dry-run solo cuenta (no hace red, no escribe nada) y dice cuántas hay por procesar
// IMPORTANTE: el cerrojo del colchón vive dentro de cada proceso. Para el servidor mientras dura el relleno (o trabaja
// sobre una copia de la carpeta de datos y devuélvela entera, colchon.json e imagenes/), o dos procesos se pisarían.
// Solo datos públicos (preguntas de cultura general e imágenes libres).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { crearAlmacen } from '../servidor/almacen.js';
import { crearCola } from '../servidor/cola.js';

const LOTE_DEFECTO = 10;
const LIMITE_DEFECTO = 50;

/** `{ datos, limite, lote, dryRun, error? }` a partir de los argumentos de la línea de órdenes. */
export function parsearArgs(argv, entorno = process.env) {
  const salida = { datos: entorno.RUTA_DATOS || '/opt/one-datos', limite: LIMITE_DEFECTO, lote: LOTE_DEFECTO, dryRun: false };
  const entero = (valor) => (/^\d+$/.test(String(valor ?? '')) ? Number(valor) : null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') salida.dryRun = true;
    else if (a === '--datos') salida.datos = argv[++i] ?? '';
    else if (a === '--limite' || a === '--lote') {
      const n = entero(argv[++i]);
      if (n === null || (a === '--lote' && n < 1)) return { ...salida, error: `${a} necesita un número entero${a === '--lote' ? ' mayor que 0' : ''}` };
      salida[a.slice(2)] = n;
    } else return { ...salida, error: `argumento desconocido: ${a}` };
  }
  if (!salida.datos) return { ...salida, error: '--datos necesita una carpeta' };
  return salida;
}

/**
 * Recuento del colchón. `porProcesar` = sin imagen y sin rendir (lo que el servidor volverá a intentar);
 * `enEspera` = de esas, las que esperan a mañana (sin IA hoy); `rendidas` = las que la política no deja ilustrar con IA.
 */
export function contarColchon(lista, ahoraMs = Date.now()) {
  const r = { total: lista.length, conImagen: 0, sinImagen: 0, porProcesar: 0, enEspera: 0, rendidas: 0, sinImagenConVisual: 0, porFuente: {} };
  for (const p of lista) {
    if (p.imagen) {
      r.conImagen += 1;
      const fuente = p.imagen.fuente || 'desconocida';
      r.porFuente[fuente] = (r.porFuente[fuente] ?? 0) + 1;
      continue;
    }
    r.sinImagen += 1;
    if (p.visual) r.sinImagenConVisual += 1;
    if (p.imagenRendida === true) r.rendidas += 1;
    else {
      r.porProcesar += 1;
      if (Date.parse(p.imagenReintentarDesde) > ahoraMs) r.enEspera += 1;
    }
  }
  return r;
}

/**
 * Procesa el colchón por pasadas de `lote` hasta intentar `limite` preguntas o quedarse sin nada elegible.
 * `completarImagen` es la misma función que recibe la cola del servidor: `(pregunta) -> { imagen, tecnico?, ... }`.
 * @returns {Promise<{intentadas: number, completadas: number, tecnicos: number, sinIAHoy: number, iaNoAplica: number, pasadas: number, antes: object, despues: object}>}
 */
export async function rellenarColchon({ almacen, completarImagen, limite = LIMITE_DEFECTO, lote = LOTE_DEFECTO }) {
  const antes = contarColchon(await almacen.leerColchon());
  const cuenta = { intentadas: 0, completadas: 0, tecnicos: 0, sinIAHoy: 0, iaNoAplica: 0, pasadas: 0 };
  const medida = async (pregunta, opciones) => {
    cuenta.intentadas += 1;
    const salida = await completarImagen(pregunta, opciones);
    if (salida?.imagen) cuenta.completadas += 1;
    else if (salida?.tecnico) cuenta.tecnicos += 1;
    else if (salida?.sinIAHoy) cuenta.sinIAHoy += 1;
    else if (salida?.iaNoAplica) cuenta.iaNoAplica += 1;
    return salida;
  };
  const cola = crearCola({ almacen, producirTanda: async () => ({ aprobadas: [], rechazadas: [], coste: 0, modelos: [], fallos: [], pedidas: 0, obtenidas: 0 }), completarImagen: medida });
  while (cuenta.intentadas < limite) {
    const antesPasada = cuenta.intentadas;
    await cola.completarImagenesPendientes({ max: Math.min(lote, limite - cuenta.intentadas) });
    cuenta.pasadas += 1;
    if (cuenta.intentadas === antesPasada) break; // nada elegible: no queda nada que intentar hoy
  }
  return { ...cuenta, antes, despues: contarColchon(await almacen.leerColchon()) };
}

function imprimirRecuento(titulo, c, log) {
  log(`${titulo}: ${c.total} preguntas · ${c.conImagen} con imagen · ${c.sinImagen} sin imagen`);
  log(`  por procesar: ${c.porProcesar} (${c.enEspera} esperando a mañana por falta de IA) · rendidas por política: ${c.rendidas} · sin imagen pero con visual: ${c.sinImagenConVisual}`);
  log(`  imágenes por fuente: ${JSON.stringify(c.porFuente)}`);
}

async function principal(argv) {
  const args = parsearArgs(argv);
  if (args.error) {
    console.error(`rellenar-colchon: ${args.error}`);
    process.exit(1);
  }
  const almacen = crearAlmacen(args.datos);
  if (args.dryRun) {
    imprimirRecuento('Colchón (dry-run, no se toca nada)', contarColchon(await almacen.leerColchon()), console.log);
    return;
  }
  const { crearResolvedorReal } = await import('../servidor/imagenes.js');
  const { completarImagen } = await import('../servidor/generacion.js');
  const { crearCupo } = await import('../servidor/imagen-ia.js');
  const resolverImagen = crearResolvedorReal({ rutaDatos: args.datos });
  const res = await rellenarColchon({
    almacen,
    completarImagen: (pregunta, opciones) => completarImagen(pregunta, { ...opciones, resolverImagen }),
    limite: args.limite,
    lote: args.lote,
  });
  imprimirRecuento('Antes', res.antes, console.log);
  console.log(`Intentadas ${res.intentadas} en ${res.pasadas} pasadas: ${res.completadas} con imagen nueva · ${res.sinIAHoy} sin IA hoy · ${res.iaNoAplica} que la política no deja ilustrar con IA · ${res.tecnicos} fallos técnicos (sin gastar intento).`);
  imprimirRecuento('Después', res.despues, console.log);
  const cupo = crearCupo({ ruta: path.join(args.datos, 'cupo-ia.json') }).estadoHoy();
  console.log(`Cupo de IA de hoy: ${cupo.n}/100 imágenes · gasto ${cupo.gastoHoyEur} EUR (tope 0,10).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  principal(process.argv.slice(2)).catch((err) => {
    console.error(`rellenar-colchon: ${err?.message || err}`);
    process.exit(1);
  });
}
