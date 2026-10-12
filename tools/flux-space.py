# Genera una imagen con el Space público de Hugging Face black-forest-labs/FLUX.1-schnell (API pública de ZeroGPU).
# Con HF_TOKEN en el entorno (token gratuito de solo lectura, huggingface.co/settings/tokens) usa el cupo de una
# cuenta registrada, mayor que el anónimo; sin token, cupo anónimo como siempre. El token nunca se imprime.
# Uso: python -I tools/flux-space.py "<prompt>" <salida.webp|png>. Salida 0 = ok; 3 = cupo agotado (stderr lleva el aviso y, si lo hay, los segundos de espera).
import os, sys, shutil
from gradio_client import Client
prompt, salida = sys.argv[1], sys.argv[2]
token = (os.environ.get("HF_TOKEN") or "").strip() or None
try:
    try:
        c = Client("black-forest-labs/FLUX.1-schnell", token=token, verbose=False)
    except TypeError:  # versiones antiguas de gradio_client
        c = Client("black-forest-labs/FLUX.1-schnell", hf_token=token, verbose=False)
    r = c.predict(prompt=prompt, seed=0, randomize_seed=True, width=768, height=768, num_inference_steps=4, api_name="/infer")
    shutil.copyfile(r[0], salida)
except Exception as e:
    m = str(e)
    if token:
        m = m.replace(token, "***")
    print(m[:400], file=sys.stderr)
    sys.exit(3 if ("quota" in m.lower() or "gpu" in m.lower() or "limit" in m.lower()) else 4)
