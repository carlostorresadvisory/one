# Genera una imagen con el Space público de Hugging Face black-forest-labs/FLUX.1-schnell (API pública, cupo anónimo
# de ZeroGPU, sin token). Uso: python -I tools/flux-space.py "<prompt>" <salida.webp|png>. Salida 0 = ok; 3 = cupo agotado (stderr lleva el aviso y, si lo hay, los segundos de espera).
import sys, shutil
from gradio_client import Client
prompt, salida = sys.argv[1], sys.argv[2]
try:
    c = Client("black-forest-labs/FLUX.1-schnell", verbose=False)
    r = c.predict(prompt=prompt, seed=0, randomize_seed=True, width=768, height=768, num_inference_steps=4, api_name="/infer")
    shutil.copyfile(r[0], salida)
except Exception as e:
    m = str(e)
    print(m[:400], file=sys.stderr)
    sys.exit(3 if ("quota" in m.lower() or "gpu" in m.lower() or "limit" in m.lower()) else 4)
