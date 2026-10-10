# Esfinge v2: reposo en bucle y un clip por gesto, todos empiezan y acaban en el mismo fotograma ancla N.
# Las uniones las inventa RIFE (interpolación de movimiento real), nunca un fundido.
# Uso (desde tools/esfinge/):  python clips.py [gesto ...]     sin argumentos monta todo
# Necesita rife-ncnn-vulkan en %LOCALAPPDATA%\rife-ncnn-vulkan\rife-ncnn-vulkan-20221029-windows
import os, sys, json, shutil, subprocess, numpy as np, imageio_ffmpeg
from PIL import Image
ff = imageio_ffmpeg.get_ffmpeg_exe(); S = 480; FPS = 64; SALIDA_FPS = 60
VID = {'A': '../../prototipos/avatares/esfinge-video/original.mp4', 'B': '../../prototipos/avatares/esfinge-candidatas/video-7oct.mp4'}
DEST = '../../prototipos/avatares/esfinge-v2'
RIFE = os.path.join(os.environ['LOCALAPPDATA'], 'rife-ncnn-vulkan', 'rife-ncnn-vulkan-20221029-windows')
TRAB = 'trabajo'; TIRAS = 'tiras'
AL = json.load(open('alineado.json'))
N_ANCLA = ('A', 8.17)
# Reposo: tramos limpios de A (sin guiños ni chispas), hacia delante; empieza y acaba en N.
REPOSO = [('A', 8.17, 8.84), ('A', 6.35, 7.05), ('A', 7.95, 8.155)]

cache = {}
def video(k):
    if k not in cache:
        o = subprocess.run([ff, '-i', VID[k], '-vf', f'scale={S}:{S}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        X = np.frombuffer(o, np.uint8).reshape(-1, S, S, 3)
        if k == 'B':  # igualar color al vídeo A
            Y = X.astype(np.float32)
            for c, (a, b) in enumerate(AL['color']): Y[..., c] = Y[..., c] * a + b
            X = np.clip(Y, 0, 255).astype(np.uint8)
        cache[k] = X
    return cache[k]
def idx(t): return round(t * FPS)
def fot(k, i): return video(k)[i]
def peq(img): return np.asarray(Image.fromarray(img).resize((120, 120), Image.BILINEAR), np.float32)
def dist(a, b): return float(np.abs(peq(a) - peq(b)).mean())

def rife(a, b, M=64):
    """M+1 fotogramas de a (t=0) a b (t=1) en pasos de 1/M, inventados por RIFE."""
    di, do = os.path.join(TRAB, 'in'), os.path.join(TRAB, 'out')
    for d in (di, do): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    Image.fromarray(a).save(os.path.join(di, '00000001.png')); Image.fromarray(b).save(os.path.join(di, '00000002.png'))
    subprocess.run([os.path.join(RIFE, 'rife-ncnn-vulkan.exe'), '-i', os.path.abspath(di), '-o', os.path.abspath(do), '-m', 'rife-v4.6', '-n', str(2 * M)],
                   cwd=RIFE, capture_output=True, check=True)
    return [np.asarray(Image.open(os.path.join(do, f'{j + 1:08d}.png')).convert('RGB')) for j in range(M + 1)]

def lento_x2(trozo):
    """El tramo a media velocidad: RIFE inventa un fotograma entre cada par."""
    di, do = os.path.join(TRAB, 'in'), os.path.join(TRAB, 'out')
    for d in (di, do): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for j, c in enumerate(trozo): Image.fromarray(c).save(os.path.join(di, f'{j + 1:08d}.png'))
    subprocess.run([os.path.join(RIFE, 'rife-ncnn-vulkan.exe'), '-i', os.path.abspath(di), '-o', os.path.abspath(do), '-m', 'rife-v4.6', '-n', str(2 * len(trozo))],
                   cwd=RIFE, capture_output=True, check=True)
    return [np.asarray(Image.open(os.path.join(do, f'{j + 1:08d}.png')).convert('RGB')) for j in range(2 * len(trozo) - 1)]

def puente(a, b, va, vb):
    """Fotogramas intermedios (sin a ni b). Se reparten por cambio visible (no por tiempo de RIFE, que en cambios
    de expresión salta de golpe) y siguen una curva de Hermite: sale de a a velocidad va y llega a b a velocidad vb."""
    if dist(a, b) < 0.8: return []
    densos = rife(a, b)
    pasos = [dist(densos[j], densos[j + 1]) for j in range(len(densos) - 1)]
    cum = np.concatenate([[0], np.cumsum(pasos)]); L = cum[-1]
    vm = max(0.6, (va + vb) / 2)
    K = int(np.clip(round(1.3 * L / vm), 4, 28))  # cuántos fotogramas nuevos
    m0, m1 = [np.clip(v * (K + 1) / L, 0, 2.5) for v in (va, vb)]
    r = []
    for k in range(1, K + 1):
        u = k / (K + 1)
        s = (u**3 - 2*u**2 + u) * m0 + (-2*u**3 + 3*u**2) + (u**3 - u**2) * m1
        x = np.clip(s, 0, 1) * L; j = min(int(np.searchsorted(cum, x, 'right')) - 1, len(pasos) - 1)
        w = (x - cum[j]) / pasos[j] if pasos[j] > 0 else 0  # entre dos densos casi iguales: mezcla
        r.append(np.clip(densos[j] * (1 - w) + densos[j + 1] * w, 0, 255).astype(np.uint8))
    return r

def vel(k, i):  # paso típico alrededor del fotograma i (velocidad del movimiento real)
    X = video(k); j = np.clip([i - 2, i + 2], 0, len(X) - 1)
    return dist(X[j[0]], X[j[1]]) / max(1, j[1] - j[0])

def afinar(k, a, b, N):
    """Busca hasta 0,15 s después del inicio y antes del fin el fotograma más cercano al ancla (el gesto nunca se alarga)."""
    X = video(k); w = 10
    ia = min(range(idx(a), idx(a) + w + 1) if b >= a else range(idx(a) - w, idx(a) + 1), key=lambda i: dist(X[i], N))
    ib = min(range(idx(b) - w, idx(b) + 1) if b >= a else range(idx(b), idx(b) + w + 1), key=lambda i: dist(X[i], N))
    return ia, ib

def montar(tramos, N, vN):
    """tramos: [(vídeo, i0, i1)] reales hacia delante. Puentes RIFE de N al primero, entre tramos y del último a N."""
    cuadros, uniones = [N], []
    prev, vprev = N, vN
    for k, i0, i1 in tramos:
        lento = len(k) - len(k.rstrip('~')); k = k.rstrip('~'); X = video(k); paso = 1 if i1 >= i0 else -1
        if (k, i0) != N_IDX:
            p = puente(prev, X[i0], vprev, vel(k, i0)); uniones.append((len(cuadros), len(p))); cuadros += p
        trozo = [X[i] for i in range(i0 + paso * ((k, i0) == N_IDX), i1 + paso, paso)]
        for _ in range(lento): trozo = lento_x2(trozo)
        cuadros += trozo
        prev, vprev = X[i1], vel(k, i1) / 2 ** lento
    p = puente(prev, N, vprev, vN); uniones.append((len(cuadros), len(p))); cuadros += p
    return cuadros, uniones  # el último cuadro es el anterior a N: el siguiente clip empieza en N

def alfa(rgb):
    """Croma: transparente donde el verde domina a rojo y azul; quita el reflejo verde del borde."""
    x = rgb.astype(np.float32); r, g, b = x[..., 0], x[..., 1], x[..., 2]
    exceso = g - np.maximum(r, b)
    a = np.clip(1 - (exceso - 18) / (60 - 18), 0, 1)
    g2 = np.minimum(g, np.maximum(r, b) + 8 * a)  # despill
    return np.clip(np.stack([r, g2, b], -1), 0, 255).astype(np.uint8), (a * 255).astype(np.uint8)

def escribir(nombre, cuadros):
    os.makedirs(DEST, exist_ok=True)
    p = subprocess.Popen([ff, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{S}x{2 * S}', '-r', str(SALIDA_FPS), '-i', '-',
                          '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-g', '60', '-movflags', '+faststart',
                          f'{DEST}/{nombre}.mp4'], stdin=subprocess.PIPE)
    for c in cuadros:
        col, a = alfa(c)
        p.stdin.write(np.concatenate([col, np.repeat(a[..., None], 3, -1)], 0).tobytes())
    p.stdin.close(); p.wait()

def tiras(nombre, cuadros, uniones):
    """Por unión: 4 reales antes · puente · 4 reales después, en una fila. Y saltos raros entre fotogramas seguidos."""
    os.makedirs(TIRAS, exist_ok=True)
    for f in os.listdir(TIRAS):
        if f.startswith(nombre + '-'): os.remove(os.path.join(TIRAS, f))
    pasos = [dist(cuadros[i], cuadros[(i + 1) % len(cuadros)]) for i in range(len(cuadros))]
    out = []
    for n, (s, L) in enumerate(uniones):
        sel = [(s + j) % len(cuadros) for j in range(-4, L + 4)]
        CAJA = (100, 50, 380, 410); W, H, C = 140, 180, 12  # recorte del personaje, 12 por fila
        im = Image.new('RGB', (W * C, H * ((len(sel) + C - 1) // C)), 'white')
        for c, i in enumerate(sel): im.paste(Image.fromarray(cuadros[i]).crop(CAJA).resize((W, H)), ((c % C) * W, (c // C) * H))
        f = f'{TIRAS}/{nombre}-{n}.jpg'; im.save(f, quality=88); out.append(f)
    return pasos, out

if __name__ == '__main__':
    os.makedirs(TRAB, exist_ok=True)
    k, t = N_ANCLA; N_IDX = (k, idx(t)); N = fot(k, idx(t)); vN = vel(k, idx(t))
    quiero = sys.argv[1:]
    gestos = [l.split() for l in open('gestos.txt', encoding='utf-8') if l.strip() and not l.startswith('#')]
    informe = json.load(open(f'{DEST}/informe.json')) if os.path.exists(f'{DEST}/informe.json') else {}
    trabajos = [('reposo', [(v, idx(a), idx(b)) for v, a, b in REPOSO])]
    for g, *r in gestos:  # varios tramos seguidos: vídeo inicio fin vídeo inicio fin ...
        tr = [(r[j], idx(float(r[j + 1])), idx(float(r[j + 2]))) for j in range(0, len(r), 3)]
        i0, _ = afinar(tr[0][0].rstrip('~'), tr[0][1] / FPS, tr[0][2] / FPS, N); _, i1 = afinar(tr[-1][0].rstrip('~'), tr[-1][1] / FPS, tr[-1][2] / FPS, N)
        tr[0] = (tr[0][0], i0, tr[0][2]); tr[-1] = (tr[-1][0], tr[-1][1], i1)
        trabajos.append((g, tr))
    for nombre, tramos in trabajos:
        if quiero and nombre not in quiero: continue
        cuadros, uniones = montar(tramos, N, vN)
        pasos, fs = tiras(nombre, cuadros, uniones)
        escribir(nombre, cuadros)
        real = [dist(video(v.rstrip('~'))[i], video(v.rstrip('~'))[i + 1]) for v, i0, i1 in tramos for i in range(min(i0, i1), max(i0, i1))]
        p95 = float(np.percentile(real, 95)) if real else 1
        malos = [(i, round(p, 2)) for i, p in enumerate(pasos) if p > max(1.5 * p95, 1.5)]
        salidas = [i for i, c in enumerate(cuadros) if dist(c, N) <= 0.6] if nombre == 'reposo' else []
        informe[nombre] = {'tramos': [(v, round(i0 / FPS, 3), round(i1 / FPS, 3)) for v, i0, i1 in tramos], 'cuadros': len(cuadros),
                           'segundos': round(len(cuadros) / SALIDA_FPS, 2), 'uniones': uniones, 'p95_real': round(p95, 2),
                           'saltos_raros': malos, 'tiras': fs, **({'salidas': salidas} if salidas else {})}
        print(nombre, json.dumps(informe[nombre], ensure_ascii=False))
    json.dump(informe, open(f'{DEST}/informe.json', 'w'), ensure_ascii=False, indent=1)
    if 'reposo' in informe:
        json.dump({'fps': SALIDA_FPS, 'salidas': informe['reposo'].get('salidas', [0])}, open(f'{DEST}/anclas.json', 'w'))
