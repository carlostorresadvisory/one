// CLI: audita el banco ya verificado con un modelo distinto del verificador, por lotes,
// buscando preguntas FALSAS o AMBIGUAS. Escribe datos/auditoria.json; con --aplicar mueve
// las señaladas de datos/banco.json a datos/rechazadas.json.
// Uso: node tools/auditar-banco.js [--lote 25] [--aplicar] [--permitir-pago --tope-eur N]
import { readFile, writeFile } from 'node:fs/promises';
import { llamar, extraerJson } from './openrouter.js';

// Auditor distinto del generador (nvidia): nex ya demostró criterio en la muestra de 30;
// gemma suele dar 429; gpt-5-mini (de pago) solo como caída con tope.
const AUDITORES = ['nex-agi/nex-n2.5-pro:free', 'google/gemma-4-31b-it:free', 'openai/gpt-5-mini'];

const PROMPT_SISTEMA =
  'Eres un corrector de exámenes hostil y muy culto. Para CADA pregunta decide si es FALSA (la respuesta ' +
  'marcada no es correcta), AMBIGUA (más de una respuesta defendible, enunciado impreciso, o el enunciado ' +
  'revela la respuesta) o CORRECTA. Sé estricto con hechos, fechas, autores y definiciones; en "ordenar" ' +
  'comprueba el orden dado; en "error" comprueba que la fila marcada sea realmente la sospechosa y las demás ' +
  'no. Devuelve SOLO JSON: {"resultados":[{"id":"…","veredicto":"FALSA|AMBIGUA|CORRECTA","motivo":"…"}]}';

function parsearArgs(argv) {
  const args = { lote: 25, aplicar: false, permitirPago: false, topeEur: 0, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h') args.ayuda = true;
    else if (a === '--lote') args.lote = Number(argv[++i]);
    else if (a === '--aplicar') args.aplicar = true;
    else if (a === '--permitir-pago') args.permitirPago = true;
    else if (a === '--tope-eur') args.topeEur = Number(argv[++i]);
  }
  return args;
}

function resumir(p) {
  const base = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion };
  if (p.tipo === 'vf') base.respuesta = p.respuesta;
  if (p.tipo === 'test4') Object.assign(base, { opciones: p.opciones, correcta: p.correcta });
  if (p.tipo === 'ordenar') Object.assign(base, { criterio: p.criterio, items_en_orden_correcto: p.items });
  if (p.tipo === 'error') Object.assign(base, { tarjeta: p.tarjeta, fila_sospechosa: p.sospechoso });
  return base;
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    console.log('Uso: node tools/auditar-banco.js [--lote 25] [--aplicar] [--permitir-pago --tope-eur N]');
    return;
  }
  const banco = JSON.parse(await readFile('datos/banco.json', 'utf8'));
  const totalLotes = Math.ceil(banco.length / args.lote);
  const resultados = [];
  for (let i = 0; i < banco.length; i += args.lote) {
    const lote = banco.slice(i, i + args.lote);
    const numero = i / args.lote + 1;
    try {
      const salida = await llamar({
        modelos: AUDITORES,
        mensajes: [
          { role: 'system', content: PROMPT_SISTEMA },
          { role: 'user', content: `Audita estas ${lote.length} preguntas:\n${JSON.stringify(lote.map(resumir))}` },
        ],
        json: true,
        temperatura: 0.2,
        maxTokens: 6000,
        permitirPago: args.permitirPago,
        topeEur: args.topeEur,
      });
      const { resultados: r = [] } = extraerJson(salida.texto);
      for (const x of r) resultados.push({ ...x, auditor: salida.modelo });
      const malas = r.filter((x) => x.veredicto !== 'CORRECTA').length;
      console.log(`lote ${numero}/${totalLotes}: ${r.length} juzgadas, ${malas} con problema (${salida.modelo})`);
    } catch (err) {
      console.error(`lote ${numero}/${totalLotes} fallido: ${err.message}`);
    }
  }
  await writeFile('datos/auditoria.json', JSON.stringify(resultados, null, 2), 'utf8');
  const problema = new Map(resultados.filter((x) => x.veredicto !== 'CORRECTA').map((x) => [x.id, x]));
  const falsas = resultados.filter((x) => x.veredicto === 'FALSA').length;
  const ambiguas = resultados.filter((x) => x.veredicto === 'AMBIGUA').length;
  console.log(`Auditadas ${resultados.length} de ${banco.length}. FALSAS: ${falsas}, AMBIGUAS: ${ambiguas}.`);
  if (args.aplicar && problema.size > 0) {
    const rechazadas = JSON.parse(await readFile('datos/rechazadas.json', 'utf8'));
    const quedan = banco.filter((p) => !problema.has(p.id));
    for (const p of banco.filter((p) => problema.has(p.id))) {
      const x = problema.get(p.id);
      rechazadas.push({ ...p, motivo: `auditoría (${x.veredicto}): ${x.motivo || ''}` });
    }
    await writeFile('datos/banco.json', JSON.stringify(quedan, null, 2), 'utf8');
    await writeFile('datos/rechazadas.json', JSON.stringify(rechazadas, null, 2), 'utf8');
    console.log(`Aplicado: banco ${banco.length} → ${quedan.length}; rechazadas +${problema.size}.`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
