// CLI: genera borradores de preguntas por área llamando al modelo generador de la cascada.
// Uso: node tools/generar-preguntas.js [--area <area>] [--n 25] [--salida datos/borradores]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { llamar, extraerJson, MODELOS } from './openrouter.js';
import { validarPregunta, AREAS } from './validar-banco.js';

const PREFIJOS = {
  economia: 'eco',
  historia: 'his',
  ciencia: 'cie',
  tecnologia: 'tec',
  geografia: 'geo',
  filosofia: 'fil',
  arte: 'art',
  logica: 'log',
};

const TIPOS = ['vf', 'test4', 'ordenar', 'error'];
const CANTIDAD_POR_TIPO = { vf: 7, test4: 9, ordenar: 5, error: 4 };

const PROMPT_SISTEMA =
  'Eres un autor de preguntas de un juego de aprendizaje para un adulto con formación ' +
  'universitaria. Escribe en español. Devuelve SOLO un objeto JSON con la forma ' +
  '{"preguntas": [ ... ]}, sin texto alrededor. Cada pregunta debe ser factualmente ' +
  'correcta, inequívoca y con una sola respuesta válida. Nivel 1 = cultura general ' +
  'sólida; nivel 5 = experto. Evita trivialidades y evita preguntas de fechas exactas ' +
  'o cifras que cambien con el tiempo.';

const EJEMPLOS = {
  // Dos ejemplos para V/F: sin uno falso el generador sesga a "verdadero" (69 % en el primer lote).
  vf: [
    { enunciado: 'El agua hierve a 100°C al nivel del mar.', respuesta: true },
    { enunciado: 'La Revolución Francesa comenzó en 1799.', respuesta: false },
  ],
  test4: {
    enunciado: '¿Cuál es la capital de Francia?',
    opciones: ['Madrid', 'París', 'Roma', 'Berlín'],
    correcta: 1,
  },
  ordenar: {
    enunciado: 'Ordena de menor a mayor.',
    criterio: 'de menor a mayor',
    items: ['1', '10', '100', '1000'],
  },
  error: {
    enunciado: 'Encuentra el dato erróneo en la tarjeta.',
    tarjeta: {
      titulo: 'Planetas',
      filas: [
        { etiqueta: 'Mercurio', valor: 'más cercano al Sol' },
        { etiqueta: 'Venus', valor: 'tiene lunas' },
        { etiqueta: 'Marte', valor: 'planeta rojo' },
      ],
    },
    sospechoso: 1,
  },
};

function esquemaTipo(tipo) {
  switch (tipo) {
    case 'vf':
      return (
        '{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "respuesta": true|false }. ' +
        'OBLIGATORIO: exactamente la mitad de las afirmaciones con "respuesta": false. Las falsas deben ser ' +
        'plausibles (un dato, fecha, autor o relación cambiados por otro verosímil), nunca absurdas ni obvias.'
      );
    case 'test4':
      return '{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "opciones": ["s","s","s","s"], "correcta": 0..3 }';
    case 'ordenar':
      return '{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "criterio": "de menor a mayor …", "items": ["s","s","s","s"] }';
    case 'error':
      return '{ "enunciado": "string", "explicacion": "string", "nivel": 1..5, "tarjeta": { "titulo": "s", "filas": [{"etiqueta":"s","valor":"s"}, …3..5] }, "sospechoso": índice }';
    default:
      return '';
  }
}

function promptUsuario(area, tipo, cantidad) {
  return (
    `Área: ${area}. Tipo de pregunta: ${tipo}. Genera ${cantidad} preguntas nuevas, ` +
    `repartidas entre los niveles 1 a 5 (una o dos por nivel). Responde con un objeto ` +
    `JSON {"preguntas": [ ... ]} donde cada elemento del array "preguntas" tiene ` +
    `exactamente este esquema:\n${esquemaTipo(tipo)}\n` +
    `Ejemplo válido de un elemento (no lo repitas, es solo formato):\n${JSON.stringify(EJEMPLOS[tipo])}`
  );
}

function imprimirAyuda() {
  console.log(`Uso: node tools/generar-preguntas.js [--area <area>] [--n 25] [--salida datos/borradores]

Genera borradores de preguntas con el modelo generador (cascada gratis → pago barato,
de pago desactivada salvo --permitir-pago --tope-eur N).

Opciones:
  --area <area>      Una de: ${AREAS.join(', ')}. Si se omite, recorre las 8.
  --n <numero>        Objetivo de preguntas por área (informativo; el reparto real sigue
                       {vf:7, test4:9, ordenar:5, error:4}).
  --salida <ruta>     Carpeta de salida (por defecto datos/borradores).
  --permitir-pago     Permite usar modelos de pago de la cascada si todos los gratis fallan.
  --tope-eur <n>      Tope de gasto en euros (solo con --permitir-pago).
  --ayuda             Muestra esta ayuda y sale.
`);
}

function parsearArgs(argv) {
  const args = { area: null, n: 25, salida: 'datos/borradores', permitirPago: false, topeEur: 0, ayuda: false, tipos: null, cantidad: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--area') args.area = argv[++i];
    else if (a === '--n') args.n = Number(argv[++i]);
    else if (a === '--salida') args.salida = argv[++i];
    else if (a === '--tipos') args.tipos = argv[++i].split(',').filter((t) => TIPOS.includes(t));
    else if (a === '--cantidad') args.cantidad = Number(argv[++i]);
    else if (a === '--permitir-pago') args.permitirPago = true;
    else if (a === '--tope-eur') args.topeEur = Number(argv[++i]);
  }
  return args;
}

// Tamaño máximo de preguntas pedidas en una sola llamada. Los modelos gratis de la
// cascada son "razonadores" (gastan tokens ocultos de razonamiento antes de responder,
// ver datos/llamadas.log campo usage.completion_tokens_details.reasoning_tokens) y con
// lotes grandes (p. ej. 9 preguntas de test4) agotan max_tokens y el JSON queda
// truncado a mitad de generar. Pedir en sub-lotes pequeños evita la truncación sin
// tener que adivinar un max_tokens arbitrariamente alto. Descubierto y corregido en
// la Tarea 4 al ejecutar el pipeline contra la API real.
const TAMANO_SUBLOTE = 4;

function repartirEnSublotes(cantidad, tamano) {
  const partes = [];
  let restante = cantidad;
  while (restante > 0) {
    const parte = Math.min(tamano, restante);
    partes.push(parte);
    restante -= parte;
  }
  return partes;
}

// Lee el borrador existente de un área (si lo hay) para que una segunda pasada
// (--area X, banco < 20 tras verificar) añada preguntas nuevas sin perder las ya
// generadas y continúe el correlativo del id en vez de reiniciarlo a 1 y pisar el
// fichero — tal como pide el plan ("los borradores nuevos se añaden, ids
// correlativos continúan"). Descubierto y corregido en la Tarea 4.
async function leerBorradorExistente(ruta) {
  try {
    const texto = await readFile(ruta, 'utf8');
    const lista = JSON.parse(texto);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function siguienteCorrelativo(existentes, prefijo) {
  let maximo = 0;
  for (const p of existentes) {
    if (typeof p?.id === 'string' && p.id.startsWith(`${prefijo}-`)) {
      const n = Number(p.id.slice(prefijo.length + 1));
      if (Number.isInteger(n) && n > maximo) maximo = n;
    }
  }
  return maximo + 1;
}

async function generarArea(area, opts, existentes = []) {
  const prefijo = PREFIJOS[area];
  let correlativo = siguienteCorrelativo(existentes, prefijo);
  const validas = [];
  let descartadas = 0;
  let pedidas = 0;

  // --tipos vf,test4 limita los tipos; --cantidad N fuerza cuántas por tipo (p. ej. reequilibrar V/F).
  for (const tipo of opts.tipos || TIPOS) {
    const cantidad = opts.cantidad || CANTIDAD_POR_TIPO[tipo];
    pedidas += cantidad;

    for (const subcantidad of repartirEnSublotes(cantidad, TAMANO_SUBLOTE)) {
      const mensajes = [
        { role: 'system', content: PROMPT_SISTEMA },
        { role: 'user', content: promptUsuario(area, tipo, subcantidad) },
      ];

      let resultado;
      try {
        resultado = await llamar({
          modelos: MODELOS.generador,
          mensajes,
          json: true,
          permitirPago: opts.permitirPago,
          topeEur: opts.topeEur,
        });
      } catch (err) {
        console.error(`  ${area}/${tipo}: fallo en la llamada — ${err.message}`);
        continue;
      }

      let lista;
      try {
        lista = extraerJson(resultado.texto);
        if (!Array.isArray(lista)) lista = lista.preguntas || lista.resultados || [];
      } catch (err) {
        console.error(`  ${area}/${tipo}: JSON inválido — ${err.message}`);
        continue;
      }

      for (const bruto of lista) {
        const id = `${prefijo}-${String(correlativo).padStart(3, '0')}`;
        const pregunta = {
          ...bruto,
          id,
          area,
          tipo,
          generador: resultado.modelo,
          confianza: null,
          verificado: false,
        };
        const errores = validarPregunta(pregunta);
        if (errores.length === 0) {
          validas.push(pregunta);
          correlativo++;
        } else {
          descartadas++;
        }
      }
    }
  }

  return { validas, descartadas, pedidas };
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    process.exit(0);
    return;
  }

  const areas = args.area ? [args.area] : AREAS;
  for (const area of areas) {
    if (!AREAS.includes(area)) {
      console.error(`Área desconocida: ${area}`);
      process.exit(1);
      return;
    }
  }

  await mkdir(args.salida, { recursive: true });

  for (const area of areas) {
    const rutaArea = `${args.salida}/${area}.json`;
    const existentes = await leerBorradorExistente(rutaArea);
    const { validas, descartadas, pedidas } = await generarArea(area, args, existentes);
    const combinadas = [...existentes, ...validas];
    await writeFile(rutaArea, JSON.stringify(combinadas, null, 2), 'utf8');
    console.log(
      `${area}: pedidas ${pedidas}, válidas ${validas.length}, descartadas ${descartadas}` +
        (existentes.length > 0 ? ` (+ ${existentes.length} ya existentes, total ${combinadas.length})` : '')
    );
  }
}

const esCLI = process.argv[1] && process.argv[1].endsWith('generar-preguntas.js');
if (esCLI) {
  main();
}
