// CLI: saca una muestra al azar de datos/banco.json en Markdown para que Carlos la revise a mano.
// Uso: node tools/revisar-muestra.js [--n 30] [--semilla 20260912]
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function imprimirAyuda() {
  console.log(`Uso: node tools/revisar-muestra.js [--n 30] [--semilla 20260912]

Saca N preguntas al azar de datos/banco.json y escribe un Markdown en docs/ con una
casilla por pregunta para que Carlos anote si está mal.

Opciones:
  --n <numero>       Tamaño de la muestra (por defecto 30).
  --semilla <numero>  Semilla del generador determinista (por defecto 20260912).
  --banco <ruta>      Ruta del banco (por defecto datos/banco.json).
  --salida <ruta>     Ruta del Markdown de salida (por defecto docs/revision-muestra-<fecha>.md).
  --ayuda             Muestra esta ayuda y sale.
`);
}

function parsearArgs(argv) {
  const args = { n: 30, semilla: 20260912, banco: 'datos/banco.json', salida: null, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--n') args.n = Number(argv[++i]);
    else if (a === '--semilla') args.semilla = Number(argv[++i]);
    else if (a === '--banco') args.banco = argv[++i];
    else if (a === '--salida') args.salida = argv[++i];
  }
  return args;
}

// Generador determinista simple (LCG), igual de espíritu que el usado en los tests del motor.
function crearRng(semilla) {
  let s = semilla % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function elegirMuestra(banco, n, rng) {
  const copia = [...banco];
  // Fisher-Yates parcial determinista.
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, Math.min(n, copia.length));
}

function respuestaLegible(p) {
  switch (p.tipo) {
    case 'vf':
      return p.respuesta ? 'Verdadero' : 'Falso';
    case 'test4':
      return `${p.opciones?.[p.correcta]} (opcion ${p.correcta}; las otras: ${(p.opciones || []).filter((_, i) => i !== p.correcta).join(' / ')})`;
    case 'ordenar':
      return (p.items || []).join(' → ');
    case 'error': {
      // Tarjeta completa: sin las demas filas no se puede juzgar si la marcada es la unica sospechosa.
      const filas = (p.tarjeta?.filas || [])
        .map((f, i) => (i === p.sospechoso ? `**${f.etiqueta}: ${f.valor}** (marcada)` : `${f.etiqueta}: ${f.valor}`))
        .join(' / ');
      return `${p.tarjeta?.titulo || ''} -- ${filas}`;
    }
    default:
      return '';
  }
}

function renderPregunta(p) {
  return [
    `- [ ] **${p.id}** (${p.area}, ${p.tipo}, nivel ${p.nivel})`,
    `  Enunciado: ${p.enunciado}`,
    `  Respuesta marcada: ${respuestaLegible(p)}`,
    `  Explicación: ${p.explicacion}`,
    `  Está mal porque: `,
    '',
  ].join('\n');
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    process.exit(0);
    return;
  }

  let banco;
  try {
    banco = JSON.parse(await readFile(args.banco, 'utf8'));
  } catch (err) {
    console.error(`No se pudo leer ${args.banco}: ${err.message}`);
    process.exit(1);
    return;
  }

  const rng = crearRng(args.semilla);
  const muestra = elegirMuestra(banco, args.n, rng);

  const fecha = new Date().toISOString().slice(0, 10);
  const ruta = args.salida || `docs/revision-muestra-${fecha}.md`;

  const cuerpo = [
    `# Revisión manual de la muestra (${muestra.length} preguntas)`,
    '',
    `Generado el ${fecha}. Marca la casilla y anota por qué si una pregunta está mal.`,
    '',
    ...muestra.map(renderPregunta),
  ].join('\n');

  await mkdir('docs', { recursive: true });
  await writeFile(ruta, cuerpo, 'utf8');
  console.log(`Escrito ${ruta} con ${muestra.length} preguntas.`);
}

const esCLI = process.argv[1] && process.argv[1].endsWith('revisar-muestra.js');
if (esCLI) {
  main();
}
