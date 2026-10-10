# Vídeo continuo del personaje: encadena tramos hacia delante de los dos vídeos.
# En cada unión busca, en ±12 fotogramas, el par más parecido y funde 8 fotogramas.
import subprocess, sys, numpy as np, imageio_ffmpeg
ff = imageio_ffmpeg.get_ffmpeg_exe(); S = 480; FPS = 64; nA = 641
import json; AL = json.load(open('alineado.json'))
D = np.load('D.npy'); dref = np.load('dref.npy')
cons = np.array([D[i, i + 1] for i in range(len(D) - 1) if i != nA - 1])
print('paso normal: mediana %.2f · p95 %.2f · máx %.2f' % (np.median(cons), np.percentile(cons, 95), cons.max()))
def g(t):  # 'A2.27' -> índice global
    i = round(float(t[1:]) * FPS); return i if t[0] == 'A' else nA + i
cache = {}
def fot(i):
    k = 'A' if i < nA else 'B'
    if k not in cache:
        o = subprocess.run([ff, '-i', {'A': 'videos/v06.mp4', 'B': 'videos/v07.mp4'}[k], '-vf', f'scale={S}:{S}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        cache[k] = np.frombuffer(o, np.uint8).reshape(-1, S, S, 3)
    f = cache[k][i if k == 'A' else i - nA].astype(np.float32)
    if k == 'B':  # igualar color al vídeo A
        for c, (a, b) in enumerate(AL['color']): f[..., c] = f[..., c] * a + b
    return f
def mismo_video(a, b): return (a < nA) == (b < nA)
# tramos: (nombre, inicio, fin) hacia delante, sin marcha atrás
TRAMOS = [l.split() for l in open(sys.argv[1], encoding='utf-8') if l.strip() and not l.startswith('#')]
segs = [[n, g(a), g(a[0] + b)] for n, a, b in TRAMOS]
# afinar uniones: el par (fin de uno, inicio del siguiente) más parecido en ±12
for k in range(len(segs) - 1):
    a, b = segs[k], segs[k + 1]
    mejor = None
    for ea in range(a[2] - 12, a[2] + 13):
        for sb in range(b[1] - 12, b[1] + 13):
            if not (0 <= ea < len(D) and 0 <= sb < len(D)) or not mismo_video(ea, a[1]) or not mismo_video(sb, b[2]): continue
            if ea <= a[1] + 16 or sb >= b[2] - 16: continue
            if mejor is None or D[ea, sb] < mejor[0]: mejor = (D[ea, sb], ea, sb)
    if mejor is None: print("sin unión posible", a, b); continue
    a[2], b[1] = mejor[1], mejor[2]
    print(f'unión {a[0]} → {b[0]}: distancia {mejor[0]:.2f}')
cuadros = []; marcas = []
prev = None
for n, s, e in segs:
    trozo = [fot(i) for i in range(s, e + 1)]
    if cuadros:
        F = 8 if mismo_video(prev, s) else 20  # entre vídeos, fundido más largo sobre el reposo
        for j in range(F):
            w = (j + 1) / (F + 1); trozo[j] = cuadros[-F + j] * (1 - w) + trozo[j] * w
        cuadros = cuadros[:-F]
    marcas.append((n, len(cuadros) / FPS)); cuadros += trozo; prev = e
for n, t in marcas: print(f'{t:6.2f}s  {n}')
p = subprocess.Popen([ff, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{S}x{S}', '-r', str(FPS), '-i', '-',
                      '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sys.argv[2]], stdin=subprocess.PIPE)
for c in cuadros: p.stdin.write(np.clip(c, 0, 255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait(); print(f'total {len(cuadros)/FPS:.1f} s')
