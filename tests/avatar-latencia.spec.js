// e2e «esfinge al instante» (v0.3.1, spec §2): latencia desde que se pide un gesto hasta su primer fotograma
// pintado, a tiempos aleatorios del bucle del reposo, con la caché del service worker caliente.
// Instrumentado solo con ?depurar=avatar (window.__one.avatarLatencias). Se lanza aparte:
//   npx playwright test -c playwright.avatar.config.js --workers=1
import { test, expect } from '@playwright/test';

const DURACION_MS = { saludo: 2670, pensando: 4220, sorpresa: 4170, triste: 6480, acierto: 2780, euforia: 3550 };
const RAPIDOS = ['acierto', 'triste'];
const RESTO = ['saludo', 'pensando', 'sorpresa', 'euforia'];

const p95 = (valores) => {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil(0.95 * orden.length) - 1)];
};
const espera = (page, ms) => page.waitForTimeout(ms);

/** La esfinge solo hace un gesto a la vez: si la app lanzó el suyo («pensando» tras 8 s quieta) y sigue sonando,
 * la petición esperaría a que acabe (por diseño). El test no mide eso: espera a que acabe. */
async function esperarSinGestoAjeno(page) {
  for (let i = 0; i < 20; i += 1) {
    const resto = await page.evaluate((duraciones) => {
      const ahora = performance.now();
      return Math.max(0, ...window.__one.avatarLatencias.map((l) => l.en + duraciones[l.gesto] + 600 - ahora));
    }, DURACION_MS);
    if (resto <= 0) return;
    await espera(page, resto);
  }
}

async function pedirYMedir(page, gesto) {
  await esperarSinGestoAjeno(page);
  const antes = await page.evaluate(() => window.__one.avatarLatencias.length);
  expect(await page.evaluate((g) => window.__one.pedirGestoAvatar(g), gesto)).toBe(true);
  await page.waitForFunction((n) => window.__one.avatarLatencias.length > n, antes, { timeout: 8000 });
  const ultima = await page.evaluate(() => window.__one.avatarLatencias.at(-1));
  expect(ultima.gesto).toBe(gesto);
  return ultima.ms;
}

test('esfinge al instante: acierto/triste p95 ≤ 350 ms en 40 peticiones, el resto p95 ≤ 700 ms en 20', async ({ page }) => {
  await page.goto('/?depurar=avatar');
  await page.waitForFunction(() => window.__one && window.__one.listo === true);
  // Caché del service worker caliente: los 6 gestos y los puentes ya guardados (el arranque los pide en ocioso).
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()) !== undefined, null, { timeout: 15000 });
  await page.waitForFunction(async () => {
    const rutas = ['saludo', 'pensando', 'sorpresa', 'triste', 'acierto', 'euforia'].map((g) => `avatar/${g}.mp4`);
    const hallados = await Promise.all(rutas.map((r) => caches.match(r)));
    return hallados.every(Boolean);
  }, null, { timeout: 40000, polling: 500 });
  // Una vista de modo: ahí acierto y triste quedan residentes.
  await page.locator('[data-test="modo-clasico"]').click();
  await expect(page.locator('[data-vista="pregunta"]')).toBeVisible();
  await expect(page.locator('.avatar-lienzo')).toBeAttached();
  await espera(page, 4000); // acaba el saludo de apertura y se asientan las cargas
  await page.evaluate(() => { window.__one.avatarLatencias.length = 0; });

  const rapidas = [];
  for (let i = 0; i < 40; i += 1) {
    const gesto = RAPIDOS[i % 2];
    await espera(page, Math.random() * 2200);
    rapidas.push(await pedirYMedir(page, gesto));
    await espera(page, DURACION_MS[gesto] + 500);
  }
  const resto = [];
  for (let i = 0; i < 20; i += 1) {
    const gesto = RESTO[i % 4];
    await espera(page, Math.random() * 2200);
    resto.push(await pedirYMedir(page, gesto));
    await espera(page, DURACION_MS[gesto] + 500);
  }
  const cifra = (v) => `n=${v.length} min=${Math.min(...v)} mediana=${[...v].sort((a, b) => a - b)[v.length >> 1]} p95=${p95(v)} max=${Math.max(...v)}`;
  console.log(`LATENCIA acierto+triste (ms): ${cifra(rapidas)}`);
  console.log(`LATENCIA saludo/pensando/sorpresa/euforia (ms): ${cifra(resto)}`);
  console.log(`LATENCIAS rapidas: ${rapidas.join(',')}`);
  console.log(`LATENCIAS resto: ${resto.join(',')}`);
  expect(p95(rapidas)).toBeLessThanOrEqual(350);
  expect(p95(resto)).toBeLessThanOrEqual(700);
});
