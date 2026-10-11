// CLI: imágenes de las 6 tarjetas del hub (spec v0.3 §7, tarea 7.5b). Para cada tarjeta puntúa la
// imagen actual (modos.js) con el modelo con visión; si saca menos de 4 la sustituye por una de
// Commons / bancos libres y, si no hay buena, por una generada con IA (cuenta para el cupo diario).
// Deja cada imagen final como WebP en imagenes-hub/<id>.webp y escribe datos/imagenes-hub.json con
// sus créditos reales; modos.js se rellena a partir de ese fichero.
//
// Uso: node --env-file=.env tools/imagenes-hub.js [--sin-ia] [--rehacer id,id]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { MODOS } from '../modos.js';
import { esBuena } from './nota-imagen.js';
import { generarImagen, crearCupo, aWebp, ESTILO_ONE } from '../servidor/imagen-ia.js';
import { bajar, dataUrlWebp, candidatasCommons, candidatasBancos, puntuarHastaBuena, puntuarConReintento } from './mejorar-imagenes.js';


const DIR = 'imagenes-hub';
const SALIDA = 'datos/imagenes-hub.json';

// Qué debe ver el jugador en cada fondo (el enunciado que se le da al modelo de visión) y con qué
// términos se busca. Los fondos van con la tarjeta encima y poca opacidad: lo que importa es el
// color y un protagonista claro.
export const TARJETAS = [
  { id: 'clasico', nombre: 'Clásico', tema: 'conocimiento y cultura general: una biblioteca antigua llena de libros', terminos: ['library interior books', 'old library'], ia: 'a grand ancient library with glowing books' },
  { id: 'repaso', nombre: 'Repaso', tema: 'repasar lo aprendido: una biblioteca o ruinas antiguas', terminos: ['ancient library ruins', 'Celsus Library Ephesus'], ia: 'ancient library ruins at dusk, columns and scrolls' },
  { id: 'ordago', nombre: 'Órdago', tema: 'apostar todo a una carta: una ruleta o fichas de casino', terminos: ['roulette wheel casino', 'poker chips'], ia: 'a roulette wheel and golden chips on a dark table' },
  { id: 'masomenos', nombre: 'Más o menos', tema: 'comparar cifras: contraste entre grande y pequeño, una cumbre', terminos: ['Mount Everest', 'mountain peak summit'], ia: 'a tall snowy mountain peak next to a tiny balance scale' },
  { id: 'contrarreloj', nombre: 'Contrarreloj', tema: 'carrera contra el tiempo: un reloj de arena', terminos: ['hourglass sand', 'sand timer'], ia: 'a glass hourglass with glowing sand running out' },
  { id: 'tienda', nombre: 'Tienda', tema: 'una tienda o un mercado de objetos curiosos', terminos: ['market stall bazaar', 'antique shop'], ia: 'a mysterious bazaar stall with lanterns and curious objects' },
];

async function actualDe(id) {
  const modo = MODOS.find((m) => m.id === id);
  if (modo) return { url: modo.imagen.url, pagina: modo.imagen.pagina, titulo: modo.imagen.titulo, autor: modo.imagen.autor, licencia: modo.imagen.licencia, fuente: 'Commons' };
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const sinIa = args.includes('--sin-ia');
  const rehacer = args.includes('--rehacer') ? args[args.indexOf('--rehacer') + 1].split(',') : null;
  const previas = JSON.parse(await readFile(SALIDA, 'utf8').catch(() => '{}'));
  const cupo = crearCupo({ ruta: 'datos/cupo-ia.json' });
  const estado = { fallosSeguidos: 0, puntuadas: 0 };
  await mkdir(DIR, { recursive: true });
  const resultado = { ...previas };

  for (const t of TARJETAS) {
    if (previas[t.id] && !(rehacer && rehacer.includes(t.id))) {
      console.log(`${t.id}: ya hecha (${previas[t.id].fuente}, nota ${previas[t.id].nota})`);
      continue;
    }
    const pregunta = { enunciado: `Fondo de la tarjeta «${t.nombre}» de una app de preguntas y respuestas. Debe evocar: ${t.tema}.`, area: '' };
    const actual = await actualDe(t.id);
    let elegida = null; // { c, webp }
    if (actual) {
      const r = await puntuarConReintento({ url: actual.url, pregunta });
      console.log(`${t.id}: imagen actual nota ${r?.nota ?? '?'} (${r?.motivo ?? ''})`);
      if (r && esBuena(r.nota)) {
        const webp = await aWebp(await bajar(actual.url));
        elegida = { c: { ...actual, nota: r.nota, notaModelo: r.modelo }, webp };
      }
    }
    if (!elegida) {
      const usadas = actual ? [actual.url] : [];
      for (const [nombreFuente, buscar] of [['Commons', candidatasCommons], ['bancos', candidatasBancos]]) {
        const buenas = await puntuarHastaBuena(await buscar(t.terminos, pregunta, usadas), pregunta, estado);
        if (buenas[0]) {
          const c = buenas[0];
          elegida = { c, webp: c.webp ?? (await aWebp(await bajar(c.url))) };
          console.log(`${t.id}: ${nombreFuente} -> ${c.fuente} nota ${c.nota}`);
          break;
        }
      }
    }
    if (!elegida && !sinIa && cupo.puede()) {
      const g = await generarImagen(`${t.ia}, ${ESTILO_ONE}`, { cupo });
      if (g) {
        const webp = await aWebp(g.buffer);
        const r = await puntuarConReintento({ url: dataUrlWebp(webp), pregunta });
        elegida = { c: { fuente: 'IA', autor: null, licencia: null, pagina: null, titulo: `Ilustración generada con IA: ${t.nombre}`, nota: r?.nota ?? null, notaModelo: r?.modelo ?? null }, webp };
        console.log(`${t.id}: IA (nota ${r?.nota ?? '?'})`);
      }
    }
    if (!elegida) {
      console.log(`${t.id}: SIN imagen buena (la tarjeta se queda con su color)`);
      continue;
    }
    await writeFile(`${DIR}/${t.id}.webp`, elegida.webp);
    const { webp: _webp, ...c } = elegida.c;
    resultado[t.id] = {
      url: `${DIR}/${t.id}.webp`,
      pagina: c.pagina ?? null,
      titulo: c.titulo ?? '',
      autor: c.autor ?? null,
      licencia: c.licencia ?? null,
      fuente: c.fuente,
      nota: c.nota ?? null,
      notaModelo: c.notaModelo ?? null,
    };
    await writeFile(SALIDA, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  }
  console.log('Cupo IA:', cupo.estadoHoy());
}

const esCLI = process.argv[1] && process.argv[1].endsWith('imagenes-hub.js');
if (esCLI) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
