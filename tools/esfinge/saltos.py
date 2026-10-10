# Busca "saltos" entre fotogramas parecidos de los dos vídeos (técnica de video textures):
# permite cerrar un gesto volviendo al reposo hacia delante, sin marcha atrás.
import subprocess, numpy as np, imageio_ffmpeg, heapq
from PIL import Image
ff = imageio_ffmpeg.get_ffmpeg_exe(); W = 64; FPS = 64
def leer(p):
    o = subprocess.run([ff, '-i', p, '-vf', f'scale={W}:{W}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    return np.frombuffer(o, np.uint8).reshape(-1, W, W, 3).astype(np.float32)
A = leer('videos/v06.mp4'); B = leer('videos/v07.mp4')
X = np.concatenate([A, B]); nA = len(A); N = len(X)
ref = np.asarray(Image.open('../../../../OneDrive/Desktop/ONE/prototipos/avatares/esfinge-video/neutral.jpg'.replace('../../../../', 'C:/Users/torre/')).convert('RGB').resize((W, W))).astype(np.float32)
dref = np.abs(X - ref).mean(axis=(1, 2, 3))
F = X.reshape(N, -1)
# distancia media absoluta entre todos los pares (por bloques)
D = np.zeros((N, N), np.float32)
for i in range(0, N, 64):
    D[i:i+64] = np.abs(F[i:i+64, None, :] - F[None, :, :]).mean(axis=2)
nom = lambda i: (f'A{i/FPS:.2f}' if i < nA else f'B{(i-nA)/FPS:.2f}')
np.save('D.npy', D); np.save('dref.npy', dref)
# distancia típica entre fotogramas consecutivos (referencia de "salto invisible")
cons = np.array([D[i, i+1] for i in range(N-1) if i != nA-1])
print('paso normal entre fotogramas: mediana %.2f p95 %.2f' % (np.median(cons), np.percentile(cons, 95)))
neutros = [i for i in range(N) if dref[i] <= 13]
print('fotogramas casi neutros:', len(neutros), 'A:', sum(i < nA for i in neutros), 'B:', sum(i >= nA for i in neutros))
# Grafo: avanzar 1 fotograma (coste 1) o saltar a un fotograma parecido (coste 1 + penalización)
TH = float(np.percentile(cons, 95)) * 1.5
def vecinos(i):
    if i + 1 < N and i != nA - 1: yield i + 1, 1.0
    js = np.where(D[i] < TH)[0]
    for j in js:
        if abs(j - i) > 8: yield j, 4.0 + 10 * D[i, j] / TH
def camino(origenes, destino_ok, limite=400):
    dist = {o: 0 for o in origenes}; prev = {}; h = [(0, o) for o in origenes]
    while h:
        c, i = heapq.heappop(h)
        if c > dist.get(i, 1e9): continue
        if destino_ok(i) and i not in origenes:
            r = [i]
            while r[-1] in prev: r.append(prev[r[-1]])
            return c, r[::-1]
        if c > limite: break
        for j, w in vecinos(i):
            if c + w < dist.get(j, 1e9): dist[j] = c + w; prev[j] = i; heapq.heappush(h, (c + w, j))
    return None
# Para cada "pico" de gesto: camino neutro -> pico -> neutro
picos = {'saludo B0.90': nA + 58, 'saludo2 B7.70': nA + 493, 'pensando B2.20': nA + 141, 'sorpresa B3.30': nA + 211,
         'contenta-orejas B5.00': nA + 320, 'oh A3.00': 192, 'risa A4.40': 282, 'guino A7.50': 480, 'guino2 A9.50': 608}
for k, p in picos.items():
    ida = camino(set(neutros), lambda i, p=p: i == p)
    vuelta = camino({p}, lambda i: dref[i] <= 13)
    def resumen(r):
        if not r: return 'sin camino'
        c, ruta = r; saltos = [(nom(a), nom(b), round(float(D[a, b]), 1)) for a, b in zip(ruta, ruta[1:]) if b != a + 1]
        return f'{len(ruta)/FPS:.2f}s desde {nom(ruta[0])} hasta {nom(ruta[-1])}, saltos {saltos}'
    print(f'{k}: d={dref[p]:.0f}\n   ida:    {resumen(ida)}\n   vuelta: {resumen(vuelta)}')
