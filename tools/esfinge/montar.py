# Monta clips a partir de tramos de los dos vídeos, con fundido de 3 fotogramas en cada salto.
import subprocess, sys, numpy as np, imageio_ffmpeg
ff = imageio_ffmpeg.get_ffmpeg_exe(); S = 480; FPS = 64
dref = np.load('dref.npy'); nA = 641
cache = {}
def video(k):
    if k not in cache:
        p = {'A': '../../prototipos/avatares/esfinge-video/original.mp4', 'B': '../../prototipos/avatares/esfinge-candidatas/video-7oct.mp4'}[k]
        o = subprocess.run([ff, '-i', p, '-vf', f'scale={S}:{S}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        cache[k] = np.frombuffer(o, np.uint8).reshape(-1, S, S, 3)
    return cache[k]
def montar(nombre, tramos, destino):
    cuadros = []
    for t in tramos:  # 'B0.16-0.92' o con '<' para marcha atrás: 'B6.70<4.10'
        k = t[0]; v = video(k)
        if '<' in t:
            a, b = map(float, t[1:].split('<')); idx = list(range(round(a * FPS), round(b * FPS) - 1, -1))
        else:
            a, b = map(float, t[1:].split('-')); idx = list(range(round(a * FPS), round(b * FPS) + 1))
        trozo = [v[min(i, len(v) - 1)].astype(np.float32) for i in idx]
        if cuadros:  # fundido de 3 fotogramas sobre el empalme
            for j in range(min(3, len(trozo))):
                w = (j + 1) / 4; trozo[j] = cuadros[-1] * (1 - w) + trozo[j] * w
        cuadros += trozo
        print(f'  {t}: d inicio {dref[idx[0] + (0 if k == "A" else nA)]:.0f} · d final {dref[idx[-1] + (0 if k == "A" else nA)]:.0f}')
    # 64 fps: todos los fotogramas del original, para máxima fluidez
    p = subprocess.Popen([ff, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{S}x{S}', '-r', '64', '-i', '-',
                          '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', f'{destino}/{nombre}.mp4'], stdin=subprocess.PIPE)
    p.stdin.write(np.clip(np.stack(cuadros), 0, 255).astype(np.uint8).tobytes()); p.stdin.close(); p.wait()
    print(f'{nombre}: {len(cuadros)/64:.2f} s')
D = sys.argv[1]
CLIPS = {
  'saludo-adelante': ['B0.16-0.92', 'B7.44-7.61', 'B7.92-8.55', 'B8.83-8.98', 'B9.28-9.66'],
  'sorpresa-oh': ['A2.27-3.27', 'A6.22-6.40'],
  'guino': ['A7.05-7.95'],
  'guino-2': ['A9.15-9.90'],
  'orgullosa': ['B6.70<5.30', 'B5.30-6.70'],
  'saludo': ['B0.00-1.20', 'B1.20<0.00'],
  'pensando': ['B9.80<8.60', 'B8.60-9.80'],
}
for n, t in CLIPS.items():
    if n in sys.argv[2:]: montar(n, t, D)
