// Validación del banco de preguntas (contrato en docs/superpowers/plans/2026-09-12-one-v0.md).
import { readFile } from 'node:fs/promises';

export const AREAS = [
  'economia',
  'historia',
  'ciencia',
  'tecnologia',
  'geografia',
  'filosofia',
  'arte',
  'logica',
];

const TIPOS = ['vf', 'test4', 'ordenar', 'error'];

function esTexto(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Valida una pregunta contra el contrato del banco.
 * @param {object} p
 * @returns {string[]} lista de errores; vacía si es válida.
 */
export function validarPregunta(p) {
  const errores = [];
  if (!p || typeof p !== 'object') {
    return ['la pregunta no es un objeto'];
  }

  if (!esTexto(p.id)) errores.push('falta id');
  if (!AREAS.includes(p.area)) errores.push(`area desconocida: ${p.area}`);
  if (!TIPOS.includes(p.tipo)) errores.push(`tipo desconocido: ${p.tipo}`);
  if (!Number.isInteger(p.nivel) || p.nivel < 1 || p.nivel > 5) {
    errores.push(`nivel fuera de rango 1-5: ${p.nivel}`);
  }
  if (!esTexto(p.enunciado)) errores.push('falta enunciado');
  if (!esTexto(p.explicacion)) errores.push('falta explicacion');
  if (typeof p.confianza !== 'number' || p.confianza < 0 || p.confianza > 1) {
    if (p.confianza !== null) errores.push(`confianza fuera de rango 0-1: ${p.confianza}`);
  }
  if (!esTexto(p.generador)) errores.push('falta generador');
  if (p.verificado === true && !esTexto(p.verificador)) errores.push('falta verificador');
  // "hilo" es opcional (campo nuevo, 12-sep-2026: el banco existente no lo tiene) — si viene,
  // debe ser un entero positivo (el índice dentro de HILOS_POR_AREA del área, ver criterio.js).
  if (p.hilo !== undefined && p.hilo !== null && (!Number.isInteger(p.hilo) || p.hilo < 1)) {
    errores.push(`hilo inválido: ${p.hilo}`);
  }

  switch (p.tipo) {
    case 'vf':
      if (typeof p.respuesta !== 'boolean') errores.push('vf: falta respuesta boolean');
      break;
    case 'test4':
      if (!Array.isArray(p.opciones) || p.opciones.length !== 4) {
        errores.push('test4: opciones debe tener 4 strings');
      } else if (!p.opciones.every(esTexto)) {
        errores.push('test4: opciones debe tener 4 strings no vacíos');
      }
      if (!Number.isInteger(p.correcta) || p.correcta < 0 || p.correcta > 3) {
        errores.push(`test4: correcta fuera de rango 0-3: ${p.correcta}`);
      }
      break;
    case 'ordenar':
      if (!esTexto(p.criterio)) errores.push('ordenar: falta criterio');
      if (!Array.isArray(p.items) || p.items.length !== 4) {
        errores.push('ordenar: items debe tener 4 strings');
      } else if (!p.items.every(esTexto)) {
        errores.push('ordenar: items debe tener 4 strings no vacíos');
      }
      break;
    case 'error':
      if (!p.tarjeta || typeof p.tarjeta !== 'object') {
        errores.push('error: falta tarjeta');
      } else {
        if (!esTexto(p.tarjeta.titulo)) errores.push('error: falta tarjeta.titulo');
        if (!Array.isArray(p.tarjeta.filas) || p.tarjeta.filas.length < 3 || p.tarjeta.filas.length > 5) {
          errores.push('error: tarjeta.filas debe tener 3-5 elementos');
        } else if (!p.tarjeta.filas.every((f) => f && esTexto(f.etiqueta) && esTexto(String(f.valor ?? '')))) {
          errores.push('error: cada fila necesita etiqueta y valor');
        }
        if (
          !Number.isInteger(p.sospechoso) ||
          !Array.isArray(p.tarjeta.filas) ||
          p.sospechoso < 0 ||
          p.sospechoso >= p.tarjeta.filas.length
        ) {
          errores.push(`error: sospechoso fuera de rango: ${p.sospechoso}`);
        }
      }
      break;
    default:
      break;
  }

  return errores;
}

/**
 * Valida el banco completo: cada pregunta, ids únicos y cobertura por área.
 * @param {object[]} banco
 * @returns {{errores: string[], avisos: string[]}}
 */
export function validarBanco(banco) {
  const errores = [];
  const avisos = [];
  const vistos = new Map();
  const porArea = {};

  for (const area of AREAS) porArea[area] = 0;

  banco.forEach((p, i) => {
    const errsPregunta = validarPregunta(p);
    for (const e of errsPregunta) errores.push(`[${p && p.id ? p.id : `índice ${i}`}] ${e}`);

    if (p && esTexto(p.id)) {
      if (vistos.has(p.id)) {
        errores.push(`id duplicado: ${p.id}`);
      } else {
        vistos.set(p.id, true);
      }
    }

    if (p && AREAS.includes(p.area)) {
      porArea[p.area] = (porArea[p.area] || 0) + 1;
    }
  });

  for (const area of AREAS) {
    if (porArea[area] < 20) {
      avisos.push(`área ${area} tiene ${porArea[area]} preguntas (< 20)`);
    }
  }

  return { errores, avisos };
}

async function main() {
  const args = process.argv.slice(2);
  const ruta = args[0] || 'datos/banco.json';

  let banco;
  try {
    const texto = await readFile(ruta, 'utf8');
    banco = JSON.parse(texto);
  } catch (err) {
    console.error(`No se pudo leer/parsear ${ruta}: ${err.message}`);
    process.exit(1);
    return;
  }

  if (!Array.isArray(banco)) {
    console.error(`${ruta} debe ser un array de preguntas`);
    process.exit(1);
    return;
  }

  const { errores, avisos } = validarBanco(banco);

  console.log(`Preguntas: ${banco.length}`);
  if (avisos.length > 0) {
    console.log(`Avisos (${avisos.length}):`);
    for (const a of avisos) console.log(`  - ${a}`);
  }
  if (errores.length > 0) {
    console.log(`Errores (${errores.length}):`);
    for (const e of errores) console.log(`  - ${e}`);
    process.exit(1);
    return;
  }

  console.log('Banco válido.');
  process.exit(0);
}

const esCLI = process.argv[1] && process.argv[1].endsWith('validar-banco.js');
if (esCLI) {
  main();
}
