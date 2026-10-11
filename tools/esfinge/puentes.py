# Puentes del reposo al ancla (spec v0.3.1 §2). Un puente es un clip corto de movimiento real inventado por
# RIFE (clips.puente) que lleva la esfinge desde un fotograma del reposo hasta el ancla (fotograma 0 del reposo,
# el mismo con el que empiezan todos los gestos): nunca fundido, boomerang ni cosido por zonas.
# Uso (desde tools/esfinge/):  python puentes.py [fotograma ...]      sin argumentos: los candidatos aprobados
# Escribe ../../avatar/puente-<f>.mp4 (mismo formato que reposo.mp4), tiras en tiras/puentes/ y puentes.json.
# Los que pasen la revisión se declaran en ../../avatar/anclas.json (puentes: {"<f>": "puente-<f>.mp4"}).
# Revisados 8-110 cada 4: del 54 al 76 RIFE da un salto de cabeza (paso 0,8 frente a 0,54 real) y se quitan.
import os, sys, json, subprocess, numpy as np
from PIL import Image
import clips
from clips import dist, puente, montar, idx, vel, fot, REPOSO, N_ANCLA, alfa, S, SALIDA_FPS, ff

AVATAR = '../../avatar'
SALIDA_TIRAS = 'tiras/puentes'
CANDIDATOS = [8, 14, 22, 30, 38, 46, 54, 78, 86, 94, 102, 110, 116]
MAX_PUENTE = 10  # fotogramas nuevos como mucho (≈ 0,17 s)
CRF = '23'       # un poco más que reposo.mp4 (20): el fotograma I pesa ~15 KB por fichero

def reposo_cuadros():
    """Los cuadros del reposo antes de comprimir (se reconstruyen igual que en clips.py)."""
    cache = os.path.join(clips.TRAB, 'reposo.npy')
    if os.path.exists(cache): return list(np.load(cache))
    k, t = N_ANCLA; clips.N_IDX = (k, idx(t)); N = fot(k, idx(t)); vN = vel(k, idx(t))
    cuadros, _ = montar([(v, idx(a), idx(b)) for v, a, b in REPOSO], N, vN)
    np.save(cache, np.array(cuadros))
    return cuadros

def escribir_puente(nombre, cuadros):
    p = subprocess.Popen([ff, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{S}x{2 * S}', '-r', str(SALIDA_FPS), '-i', '-',
                          '-an', '-c:v', 'libx264', '-crf', CRF, '-preset', 'slow', '-pix_fmt', 'yuv420p', '-g', '60', '-movflags', '+faststart',
                          f'{AVATAR}/{nombre}.mp4'], stdin=subprocess.PIPE)
    for c in cuadros:
        col, a = alfa(c)
        p.stdin.write(np.concatenate([col, np.repeat(a[..., None], 3, -1)], 0).tobytes())
    p.stdin.close(); p.wait()

def tira(f, antes, nuevos, despues):
    os.makedirs(SALIDA_TIRAS, exist_ok=True)
    sel = antes + nuevos + despues
    CAJA = (100, 50, 380, 410); W, H, C = 140, 180, 12
    im = Image.new('RGB', (W * C, H * ((len(sel) + C - 1) // C)), 'white')
    for c, x in enumerate(sel): im.paste(Image.fromarray(x).crop(CAJA).resize((W, H)), ((c % C) * W, (c // C) * H))
    ruta = f'{SALIDA_TIRAS}/puente-{f}.png'; im.save(ruta); return ruta

if __name__ == '__main__':
    os.makedirs(clips.TRAB, exist_ok=True)
    cuadros = reposo_cuadros(); N = cuadros[0]; vN = vel(N_ANCLA[0], idx(N_ANCLA[1]))
    reales = [dist(cuadros[i], cuadros[i + 1]) for i in range(len(cuadros) - 1)]
    quiero = [int(x) for x in sys.argv[1:]] or CANDIDATOS
    informe = json.load(open('puentes.json')) if os.path.exists('puentes.json') else {}
    for f in quiero:
        a = cuadros[f]
        va = float(np.mean([dist(cuadros[i], cuadros[i + 1]) for i in range(max(0, f - 2), f + 2)]))
        p = puente(a, N, va, vN)
        if len(p) > MAX_PUENTE:
            p = [p[i] for i in np.linspace(0, len(p) - 1, MAX_PUENTE).round().astype(int)]
        pasos = [dist(x, y) for x, y in zip([a] + p, p + [N])]
        escribir_puente(f'puente-{f}', p)
        ruta = tira(f, [cuadros[i] for i in range(f - 3, f + 1)], p, [N] + [cuadros[i] for i in range(1, 4)])
        informe[str(f)] = {'fotogramas': len(p), 'dist_a_ancla': round(dist(a, N), 2), 'paso_max': round(max(pasos), 2),
                           'paso_real_p95': round(float(np.percentile(reales, 95)), 2),
                           'bytes': os.path.getsize(f'{AVATAR}/puente-{f}.mp4'), 'tira': ruta}
        print(f, json.dumps(informe[str(f)]), flush=True)
    json.dump(informe, open('puentes.json', 'w'), indent=1)
