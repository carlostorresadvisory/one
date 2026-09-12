// CLI: verifica los borradores con el modelo verificador de la cascada,
// escribe datos/banco.json (aprobadas) y datos/rechazadas.json (con motivo).
// Uso: node tools/verificar-preguntas.js [--entrada datos/borradores] [--umbral 0.7]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { llamar, extraerJson, MODELOS } from './openrouter.js';
import { validarBanco, AREAS } from './validar-banco.js';

// Lotes pequeños: igual que en generar-preguntas.js, los modelos gratis de la cascada
// gastan tokens ocultos de razonamiento y con lotes de 10 preguntas el JSON de salida
// queda truncado (confirmado en la Tarea 4 contra la API real: nex-agi/nex-n2.5-pro:free
// devolvía 'Unexpected end of JSON input' con TAMANO_LOTE=10). Con lotes de 4 no ha
// vuelto a truncarse.
const TAMANO_LOTE = 4;

const PROMPT_SISTEMA =
  'Eres un verificador escéptico de preguntas de examen. Para cada pregunta, comprueba ' +
  'si la respuesta marcada es correcta, si es la única correcta entre las opciones y si ' +
  'el enunciado es inequívoco. Sé estricto: ante la duda, rechaza. Devuelve SOLO JSON ' +
  'con la forma {"resultados":[{"id":"…","correcta":true,"unica":true,"inequivoca":true,' +
  '"confianza":0.9,"motivo":"…"}]}';

function imprimirAyuda() {
  console.log(`Uso: node tools/verificar-preguntas.js [--entrada datos/borradores] [--umbral 0.7]

Lee todos los borradores de preguntas, los verifica en lotes de ${TAMANO_LOTE} con el
modelo verificador (cascada gratis → pago barato, de pago desactivada salvo
--permitir-pago --tope-eur N), y escribe datos/banco.json (aprobadas) y
datos/rechazadas.json (con motivo).

Opciones:
  --entrada <ruta>    Carpeta con los borradores (por defecto datos/borradores).
  --umbral <n>        Confianza mínima para aprobar (por defecto 0.7).
  --permitir-pago     Permite usar modelos de pago de la cascada si todos los gratis fallan.
  --tope-eur <n>      Tope de gasto en euros (solo con --permitir-pago).
  --ayuda             Muestra esta ayuda y sale.
`);
}

function parsearArgs(argv) {
  const args = { entrada: 'datos/borradores', umbral: 0.7, permitirPago: false, topeEur: 0, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') args.ayuda = true;
    else if (a === '--entrada') args.entrada = argv[++i];
    else if (a === '--umbral') args.umbral = Number(argv[++i]);
    else if (a === '--permitir-pago') args.permitirPago = true;
    else if (a === '--tope-eur') args.topeEur = Number(argv[++i]);
  }
  return args;
}

function partirEnLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) {
    lotes.push(lista.slice(i, i + tamano));
  }
  return lotes;
}

async function leerBorradores(carpeta) {
  let ficheros;
  try {
    ficheros = await readdir(carpeta);
  } catch {
    return [];
  }
  const preguntas = [];
  for (const f of ficheros) {
    if (!f.endsWith('.json')) continue;
    try {
      const texto = await readFile(`${carpeta}/${f}`, 'utf8');
      const lista = JSON.parse(texto);
      if (Array.isArray(lista)) preguntas.push(...lista);
    } catch (err) {
      console.error(`No se pudo leer ${f}: ${err.message}`);
    }
  }
  return preguntas;
}

function promptUsuario(lote) {
  const resumen = lote.map((p) => {
    const base = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion };
    if (p.tipo === 'vf') base.respuesta = p.respuesta;
    if (p.tipo === 'test4') {
      base.opciones = p.opciones;
      base.correcta = p.correcta;
    }
    if (p.tipo === 'ordenar') {
      base.criterio = p.criterio;
      base.items = p.items;
    }
    if (p.tipo === 'error') {
      base.tarjeta = p.tarjeta;
      base.sospechoso = p.sospechoso;
    }
    return base;
  });
  return `Verifica estas ${lote.length} preguntas:\n${JSON.stringify(resumen)}`;
}

async function verificarLote(lote, opts) {
  const mensajes = [
    { role: 'system', content: PROMPT_SISTEMA },
    { role: 'user', content: promptUsuario(lote) },
  ];
  const resultado = await llamar({
    modelos: MODELOS.verificador,
    mensajes,
    json: true,
    permitirPago: opts.permitirPago,
    topeEur: opts.topeEur,
  });
  const datos = extraerJson(resultado.texto);
  const resultados = Array.isArray(datos) ? datos : datos.resultados || [];
  return { resultados, modelo: resultado.modelo };
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirAyuda();
    process.exit(0);
    return;
  }

  const borradores = await leerBorradores(args.entrada);
  if (borradores.length === 0) {
    console.log(`Sin borradores en ${args.entrada}.`);
  }

  const lotes = partirEnLotes(borradores, TAMANO_LOTE);
  const porId = new Map(borradores.map((p) => [p.id, p]));
  const aprobadas = [];
  const rechazadas = [];

  for (const lote of lotes) {
    let salida;
    try {
      salida = await verificarLote(lote, args);
    } catch (err) {
      console.error(`Lote fallido (${lote.map((p) => p.id).join(', ')}): ${err.message}`);
      for (const p of lote) rechazadas.push({ ...p, motivo: `lote fallido: ${err.message}` });
      continue;
    }

    const vistos = new Set();
    for (const r of salida.resultados) {
      const pregunta = porId.get(r.id);
      if (!pregunta) continue;
      vistos.add(r.id);
      const aprueba = r.correcta && r.unica && r.inequivoca && Number(r.confianza) >= args.umbral;
      if (aprueba) {
        aprobadas.push({ ...pregunta, verificado: true, confianza: r.confianza, verificador: salida.modelo });
      } else {
        rechazadas.push({ ...pregunta, motivo: r.motivo || 'no aprobada por el verificador' });
      }
    }
    for (const p of lote) {
      if (!vistos.has(p.id)) {
        rechazadas.push({ ...p, motivo: 'sin resultado del verificador' });
      }
    }
  }

  aprobadas.sort((a, b) => (a.area === b.area ? a.id.localeCompare(b.id) : a.area.localeCompare(b.area)));

  await mkdir('datos', { recursive: true });
  await writeFile('datos/banco.json', JSON.stringify(aprobadas, null, 2), 'utf8');
  await writeFile('datos/rechazadas.json', JSON.stringify(rechazadas, null, 2), 'utf8');

  const { errores, avisos } = validarBanco(aprobadas);

  const porArea = {};
  for (const area of AREAS) porArea[area] = { aprobadas: 0, rechazadas: 0 };
  for (const p of aprobadas) if (porArea[p.area]) porArea[p.area].aprobadas++;
  for (const p of rechazadas) if (porArea[p.area]) porArea[p.area].rechazadas++;

  console.log('Por área (aprobadas/rechazadas):');
  for (const area of AREAS) {
    console.log(`  ${area}: ${porArea[area].aprobadas}/${porArea[area].rechazadas}`);
  }
  console.log(`Total aprobadas: ${aprobadas.length}, rechazadas: ${rechazadas.length}`);
  if (avisos.length > 0) {
    console.log('Avisos de validarBanco:');
    for (const a of avisos) console.log(`  - ${a}`);
  }
  if (errores.length > 0) {
    console.log('Errores de validarBanco:');
    for (const e of errores) console.log(`  - ${e}`);
  }
}

const esCLI = process.argv[1] && process.argv[1].endsWith('verificar-preguntas.js');
if (esCLI) {
  main();
}
