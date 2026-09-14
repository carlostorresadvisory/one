# Imagen del servidor de generación de ONE (Tarea 3 del plan v0.2b1-servidor).
# Contexto de build = raíz del repo: docker build -f servidor/Dockerfile .
# Spec: docs/superpowers/specs/2026-09-14-one-v0.2-generacion-y-repaso-design.md §3.5.
FROM node:22-alpine

WORKDIR /opt/one

COPY package.json ./
COPY servidor/ ./servidor/
COPY tools/ ./tools/
# servidor/generacion.js importa MEZCLA de motor.js (raíz del repo, no de servidor/ ni tools/) para
# repartir cada tanda entre los 4 tipos de pregunta con la misma proporción que el motor del móvil
# -- sin este fichero el contenedor no arranca (falla el import nada más cargar servidor/index.js).
COPY motor.js ./motor.js

USER node

HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/salud').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node","servidor/index.js"]
