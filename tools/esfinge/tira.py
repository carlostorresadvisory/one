import sys, subprocess, numpy as np, imageio_ffmpeg
from PIL import Image, ImageDraw
ff = imageio_ffmpeg.get_ffmpeg_exe()
src, ref, salida = sys.argv[1], sys.argv[2], sys.argv[3]
tramos = [tuple(map(float, t.split('-'))) for t in sys.argv[4:]]
w = 120
out = subprocess.run([ff, '-i', src, '-vf', f'scale={w}:{w}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
a = np.frombuffer(out, np.uint8).reshape(-1, w, w, 3); fps = 64
r = np.asarray(Image.open(ref).convert('RGB').resize((w, w))).astype(int)
d = np.abs(a.astype(int) - r).mean(axis=(1, 2, 3))
filas = []
for t0, t1 in tramos:
    idx = [int(round(t * fps)) for t in np.arange(t0, t1 + 1e-6, 0.1)]
    idx = [min(i, len(a) - 1) for i in idx]
    print(f'{t0}-{t1}:', ' '.join(f'{i/fps:.2f}:{d[i]:.1f}' for i in idx))
    filas.append(idx)
cols = max(len(f) for f in filas)
hoja = Image.new('RGB', (cols * w, len(filas) * (w + 12)), 'black'); dr = ImageDraw.Draw(hoja)
for y, f in enumerate(filas):
    for x, i in enumerate(f):
        hoja.paste(Image.fromarray(a[i]), (x * w, y * (w + 12) + 12)); dr.text((x * w + 2, y * (w + 12)), f'{i/fps:.1f} d{d[i]:.0f}', fill='white')
hoja.save(salida)
