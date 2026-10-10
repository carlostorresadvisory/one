// Primer juez de naturalidad: manda cada tira de fotogramas a un modelo gratis con visión de OpenRouter.
// Contenido 🟢 (dibujo propio, sin datos). Uso: node juez.mjs tiras/*.png  → escribe juez.json
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const MODELOS = ['openrouter/free', 'openrouter/free', 'google/gemma-4-31b-it:free', 'openrouter/free'];
function clave() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'OPENROUTER_API_KEY'], { encoding: 'utf8' });
  return out.match(/OPENROUTER_API_KEY\s+REG_\w+\s+(\S+)/)[1];
}
const PROMPT = `Esta imagen es una tira de fotogramas CONSECUTIVOS de una animación de un personaje (izquierda a derecha y luego la fila siguiente), a 60 fotogramas por segundo, así que entre uno y el siguiente el cambio debe ser pequeño y continuo.
Los 4 primeros y los 4 últimos son fotogramas reales; los del medio se han inventado por interpolación para unirlos.
Examina con mucho cuidado los del medio y di si un espectador notaría la unión. Señales de que se nota: una parte del cuerpo (pata, orejas, cabeza) que se desvanece o aparece semitransparente en vez de moverse (fundido), doble contorno o fantasma, un salto brusco de posición o expresión entre dos fotogramas seguidos, deformaciones.
Responde SOLO con JSON: {"veredicto": "natural" | "se nota", "motivo": "<una frase>", "fotogramas": [<números 1..n de los fotogramas sospechosos>]}`;

const k = clave(), res = {};
async function juzgar(f) {
  const img = (f.endsWith('.jpg') ? 'data:image/jpeg;base64,' : 'data:image/png;base64,') + readFileSync(f).toString('base64');
  for (const m of MODELOS) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: img } }] }] }),
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json();
      const t = j.choices?.[0]?.message?.content;
      if (!r.ok || !t) throw new Error(j.error?.message || r.status);
      const v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      res[f] = { modelo: j.model || m, ...v };
      appendFileSync(homedir() + '/.claude/openrouter-uso.log', `${new Date().toISOString()} origen=esfinge-juez modelo=${m} coste=0\n`);
      console.log(`${f}: ${v.veredicto} (${j.model || m}) — ${v.motivo}`);
      break;
    } catch (e) { console.log(`${f}: ${m} falló (${String(e.message).slice(0, 300)}), siguiente`); }
  }
}
const fs = process.argv.slice(2);
for (let i = 0; i < fs.length; i += 4) await Promise.all(fs.slice(i, i + 4).map(juzgar));
writeFileSync('juez.json', JSON.stringify(res, null, 1));
