# Despliegue del servidor de ONE (v0.2)

Guía en lenguaje llano de cómo se pone en marcha (y se actualiza) el servidor de generación de
preguntas en el VPS de IONOS. Pensada para que la ejecute una sesión de Claude Code por SSH; Carlos
no tiene que teclear nada salvo lo que se marca explícitamente como **"Carlos, a mano"**.

Un par de términos que salen varias veces:

- **Contenedor** (Docker): una caja cerrada con el programa y todo lo que necesita para correr,
  siempre igual, sin depender de lo que haya instalado en la máquina que lo ejecuta.
- **Proxy inverso**: un programa que recibe todo el tráfico de un dominio (`one.ctadvisory.es`) y lo
  reenvía al contenedor correcto por dentro; aquí lo hace **Caddy**, y de paso consigue por su
  cuenta el candado HTTPS válido automáticamente (sin tener que comprarlo ni renovarlo a mano).
- **Registro DNS tipo A**: la entrada que dice "cuando alguien escriba `one.ctadvisory.es`, ve a esta
  IP". Sin ella, ni el navegador ni el móvil saben a qué servidor llamar.

## Ya está hecho (no hace falta repetirlo)

- **Registro DNS**: `one.ctadvisory.es` → `31.70.132.252` ya existe en el panel de IONOS.
- **Fichero `/opt/one/.env`** en el VPS: ya existe con `OPENROUTER_API_KEY`, `TOKEN_ONE`,
  `PERMITIR_PAGO`, `TOPE_EUR_DIA`, `PUERTO` y `RUTA_DATOS` rellenados. `servidor/.env.ejemplo` en
  este repo documenta los nombres (sin valores) por si hay que reconstruirlo alguna vez.

## Qué hace la sesión por SSH (primera vez)

1. Conectar al VPS: `ssh root@31.70.132.252`.
2. Clonar el repo si `/opt/one` todavía no existe (es un repo público, sin necesidad de ninguna
   llave): `git clone https://github.com/carlostorresadvisory/one /opt/one`.
3. Abrir en el cortafuegos (`ufw`) los puertos que necesita Caddy para servir HTTPS, si no lo
   estaban ya: `ufw allow 80/tcp` y `ufw allow 443/tcp`. (El puerto 8787 del servidor NO se abre al
   exterior: `docker-compose.yml` lo publica solo en `127.0.0.1`, así que únicamente Caddy puede
   hablar con él dentro del propio VPS.)
4. Construir y arrancar los dos contenedores (el servidor y Caddy) desde `/opt/one`:
   ```
   docker compose -f servidor/docker-compose.yml up -d --build
   ```
5. Comprobar que responde:
   ```
   curl https://one.ctadvisory.es/salud
   ```
   Si el certificado de Caddy todavía no está listo (puede tardar el primer arranque), comprobar
   desde dentro del propio VPS mientras tanto: `curl http://127.0.0.1:8787/salud`.

## Actualizaciones siguientes

`servidor/desplegar.sh` hace los pasos 2, 4 y 5 de golpe (baja los cambios del repo, reconstruye y
comprueba). Desde `/opt/one`:

```
./servidor/desplegar.sh
```

Si `/salud` no responde al final, el script enseña las últimas 50 líneas de log del contenedor del
servidor para ver qué ha pasado.

## Qué hace Carlos, a mano

**Hoy, nada** para este despliegue: el registro DNS y el `.env` ya están puestos. Si más adelante
hace falta cambiar algo, esto sí lo hace Carlos directamente (nunca se pega una clave real en este
repo ni se manda a nadie más):

- **Cambiar la clave de OpenRouter**: `nano /opt/one/.env` en el VPS, sustituir el valor de
  `OPENROUTER_API_KEY`, guardar, y `docker compose -f servidor/docker-compose.yml up -d` (sin
  `--build`: solo hace falta relanzar el contenedor para que recoja la variable nueva).
- **Regenerar el token de acceso del móvil** (si se sospecha que se ha filtrado): generar uno nuevo
  con `openssl rand -hex 32`, pegarlo en `TOKEN_ONE` del mismo `.env`, relanzar el contenedor igual
  que arriba, y actualizar la PWA con el token nuevo (si no, el móvil empezará a recibir 401).
- **Si el VPS cambiara de IP** algún día: actualizar el registro A de `one` en el panel DNS de
  IONOS con la IP nueva.
- **Añadir las claves gratis nuevas al VPS** (v0.2b4.1, `GROQ_API_KEY`, `NVIDIA_API_KEY`,
  `CEREBRAS_API_KEY`): las crea Carlos en cada web (Groq, NVIDIA, Cerebras — nivel gratuito, sin
  tarjeta) y quedan en `ONE/.env` en su portátil. La sesión de Claude Code las copia a
  `/opt/one/.env` por SSH **sin mostrarlas en pantalla en ningún momento**: se leen del `.env`
  local y se añaden al del VPS en un solo comando, y después se relanza el contenedor para que las
  recoja (`docker compose -f servidor/docker-compose.yml up -d`, sin `--build`: no cambia el
  código, solo el entorno). Comprobación de que llegaron, **sin imprimir ningún valor**:
  `docker compose -f servidor/docker-compose.yml exec one-servidor sh -c 'for v in GROQ_API_KEY
  NVIDIA_API_KEY CEREBRAS_API_KEY GEMINI_API_KEY_GRATIS; do eval "printf \"%s=%s caracteres\\n\" $v
  \${#$v}"; done'` — imprime la longitud de cada clave, nunca la clave.
  `servidor/docker-compose.yml` **no se toca**: `env_file: ../.env` ya pasa al contenedor todo lo
  que haya en `/opt/one/.env`, que es como llegó `GEMINI_API_KEY_GRATIS` desde v0.2b3.

## Verificación rápida

- `GET /salud` sin token debe devolver `{"ok": true, ...}` con el estado del colchón y el gasto de
  hoy.
- Logs del servidor: `docker compose -f servidor/docker-compose.yml logs --tail 50 one-servidor`
  (desde `/opt/one`).
- Los datos persistentes (preguntas, cola, log de llamadas) viven en `/opt/one-datos` en el VPS,
  fuera del contenedor: reconstruir o actualizar el contenedor nunca los borra.
