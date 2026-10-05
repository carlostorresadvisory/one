// Prototipos desechables (5-oct-2026): genera prototipos/datos.js a partir del banco.
// Uso: node prototipos/construir-datos.cjs
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const banco = JSON.parse(fs.readFileSync(path.join(raiz, 'datos/banco.json'), 'utf8'));
const imagenes = JSON.parse(fs.readFileSync(path.join(raiz, 'datos/imagenes.json'), 'utf8'));

const preguntas = banco
  .filter((q) => q.verificado !== false && (q.tipo === 'vf' || q.tipo === 'test4'))
  .map((q) => {
    const img = imagenes[q.id];
    const p = { id: q.id, area: q.area, tipo: q.tipo, nivel: q.nivel, enunciado: q.enunciado, explicacion: q.explicacion };
    if (q.tipo === 'vf') p.respuesta = q.respuesta;
    else { p.opciones = q.opciones; p.correcta = q.correcta; }
    if (img && img.url && img.revalidacionVisual !== 'mal') p.img = img.url;
    return p;
  });

// Vecinos por similitud de texto (TF-IDF + coseno) para la madriguera.
const VACIAS = new Set('el la los las de del y o u a en un una unos unas que se su sus por para con al lo es fue son como más mas pero no sin sobre entre este esta estos estas ese esa cual cuál qué que hoy muy ya le les ha han era sus también tras desde hasta cuando donde porque así ser siglo'.split(' '));
const tokens = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-zñ0-9]{4,}/g)?.filter((w) => !VACIAS.has(w)) || [];
const docs = preguntas.map((p) => tokens(p.enunciado + ' ' + p.explicacion + ' ' + (p.opciones || []).join(' ')));
const df = {};
docs.forEach((d) => new Set(d).forEach((w) => (df[w] = (df[w] || 0) + 1)));
const vec = docs.map((d) => {
  const tf = {};
  d.forEach((w) => (tf[w] = (tf[w] || 0) + 1));
  const v = {};
  let n = 0;
  for (const w in tf) { v[w] = tf[w] * Math.log(preguntas.length / df[w]); n += v[w] * v[w]; }
  n = Math.sqrt(n) || 1;
  for (const w in v) v[w] /= n;
  return v;
});
preguntas.forEach((p, i) => {
  const sims = preguntas.map((q, j) => {
    if (i === j) return [j, -1];
    let s = 0;
    for (const w in vec[i]) if (vec[j][w]) s += vec[i][w] * vec[j][w];
    if (q.area === p.area) s += 0.05;
    return [j, s];
  });
  sims.sort((a, b) => b[1] - a[1]);
  p.vecinos = sims.slice(0, 6).map(([j]) => preguntas[j].id);
});

fs.writeFileSync(path.join(__dirname, 'datos.js'), '// Generado por construir-datos.cjs — no editar\nwindow.PREGUNTAS = ' + JSON.stringify(preguntas) + ';\n');
console.log('preguntas', preguntas.length, 'con imagen', preguntas.filter((p) => p.img).length, 'bytes', fs.statSync(path.join(__dirname, 'datos.js')).size);
const muestra = preguntas.find((p) => p.id === 'art-001');
console.log(muestra.enunciado, '→', muestra.vecinos.map((id) => preguntas.find((q) => q.id === id).enunciado.slice(0, 60)));
