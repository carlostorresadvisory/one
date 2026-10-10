import sys, subprocess, numpy as np, imageio_ffmpeg
from PIL import Image, ImageDraw
ff = imageio_ffmpeg.get_ffmpeg_exe()
def frames(path, w=160):
    info = subprocess.run([ff, '-i', path], capture_output=True, text=True).stderr
    out = subprocess.run([ff, '-i', path, '-vf', f'scale={w}:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    import re
    m = re.search(r'(\d+)x(\d+)[, ].*?(\d+(?:\.\d+)?) fps', info)
    W, H = int(m.group(1)), int(m.group(2)); fps = float(m.group(3))
    h = round(H * w / W / 2) * 2
    a = np.frombuffer(out, np.uint8).reshape(-1, h, w, 3)
    return a, fps, (W, H)
ref = np.asarray(Image.open(sys.argv[1]).convert('RGB').resize((160, 160)))
for k, path in enumerate(sys.argv[2:4]):
    a, fps, size = frames(path)
    n = len(a); print(path, 'frames', n, 'fps', fps, 'size', size, 'dur', round(n / fps, 2))
    r = np.asarray(Image.fromarray(ref).resize((a.shape[2], a.shape[1]))).astype(int)
    d = np.abs(a.astype(int) - r).mean(axis=(1, 2, 3))
    # perfil cada 0,25 s
    paso = max(1, int(fps / 4))
    print(' '.join(f'{i/fps:.2f}:{d[i]:.0f}' for i in range(0, n, paso)))
    # hoja: 1 fotograma cada 0,5 s
    idx = list(range(0, n, max(1, int(fps / 2))))
    cols = 7; rows = -(-len(idx) // cols); tw, th = a.shape[2], a.shape[1]
    hoja = Image.new('RGB', (cols * tw, rows * (th + 14)), 'black'); dr = ImageDraw.Draw(hoja)
    for j, i in enumerate(idx):
        x, y = (j % cols) * tw, (j // cols) * (th + 14)
        hoja.paste(Image.fromarray(a[i]), (x, y + 14)); dr.text((x + 2, y), f'{i/fps:.1f}s d{d[i]:.0f}', fill='white')
    hoja.save(sys.argv[4 + k])
