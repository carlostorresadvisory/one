# Busca escala, desplazamiento y color que hacen el reposo del vídeo B igual al del vídeo A.
import subprocess, numpy as np, imageio_ffmpeg, json
from PIL import Image
ff = imageio_ffmpeg.get_ffmpeg_exe(); S = 240
def fr(p, t):
    o = subprocess.run([ff, '-ss', str(t), '-i', p, '-frames:v', '1', '-vf', f'scale={S}:{S}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    return np.frombuffer(o, np.uint8).reshape(S, S, 3).astype(np.float32)
A = np.mean([fr('../../prototipos/avatares/esfinge-video/original.mp4', t) for t in (6.4, 8.2, 9.0)], axis=0)
Bs = [fr('../../prototipos/avatares/esfinge-candidatas/video-7oct.mp4', t) for t in (0.1, 6.6, 9.7)]
def transf(img, s, dx, dy):
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    c = S / 2
    # mapa inverso: salida (x,y) <- entrada ((x-c-dx)/s+c, (y-c-dy)/s+c)
    return np.asarray(im.transform((S, S), Image.AFFINE, (1/s, 0, c - (c + dx)/s, 0, 1/s, c - (c + dy)/s), resample=Image.BILINEAR)).astype(np.float32)
def color(src, ref):
    o = np.empty_like(src)
    for k in range(3):
        a, b = np.polyfit(src[..., k].ravel(), ref[..., k].ravel(), 1); o[..., k] = src[..., k] * a + b
    return o
mejor = None
for B in Bs[2:]:
    for s in np.arange(0.95, 1.051, 0.01):
        for dx in range(-8, 9, 2):
            for dy in range(-8, 9, 2):
                t = transf(B, s, dx, dy); d = np.abs(color(t, A) - A)[10:-10, 10:-10].mean()
                if mejor is None or d < mejor[0]: mejor = (d, s, dx, dy)
d0 = np.abs(Bs[2] - A).mean()
print('sin alinear %.2f · alineado %.2f con escala %.2f dx %d dy %d (px a %d)' % (d0, *mejor, S))
# refino fino
d, s, dx, dy = mejor
for s2 in np.arange(s - 0.01, s + 0.0101, 0.0025):
    for dx2 in np.arange(dx - 2, dx + 2.1, 0.5):
        for dy2 in np.arange(dy - 2, dy + 2.1, 0.5):
            t = transf(Bs[2], s2, dx2, dy2); d2 = np.abs(color(t, A) - A)[10:-10, 10:-10].mean()
            if d2 < mejor[0]: mejor = (d2, s2, dx2, dy2)
d, s, dx, dy = mejor
t = transf(Bs[2], s, dx, dy)
coef = [list(np.polyfit(t[..., k].ravel(), A[..., k].ravel(), 1)) for k in range(3)]
print('fino: %.2f escala %.4f dx %.1f dy %.1f' % mejor)
json.dump({'escala': s, 'dx': dx / S, 'dy': dy / S, 'color': coef}, open('alineado.json', 'w'))
