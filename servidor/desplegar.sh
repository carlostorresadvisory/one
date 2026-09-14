#!/usr/bin/env bash
# Actualiza y relanza el servidor de generación de ONE en el VPS. Se ejecuta desde /opt/one:
#   ./servidor/desplegar.sh
# Tarea 3 del plan v0.2b1-servidor. Spec:
# docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.5.
set -euo pipefail

cd /opt/one
git pull --ff-only
docker compose -f servidor/docker-compose.yml up -d --build
sleep 5
# Ronda final (revisión, 14-sep-2026) -- Menor (M7): sin el `exit 1` de aquí, si /salud fallaba el
# script enseñaba los logs pero terminaba con éxito igualmente (el `docker compose ... logs` de la
# rama del `||` sale con 0 si el propio comando de logs funciona, aunque lo que cuenta -- el
# despliegue -- haya fallado). Así, quien mire el código de salida de este script (o lo dispare
# desde otro sitio) se entera de verdad si el despliegue salió bien o mal.
curl -fsS http://127.0.0.1:8787/salud || { docker compose -f servidor/docker-compose.yml logs --tail 50 one-servidor; exit 1; }
