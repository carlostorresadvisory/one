// Genera un par de claves VAPID (P-256) para los avisos Web Push de ONE (v0.3.4 objetivo C).
// Uso, en el VPS:  node tools/generar-vapid.js   -> imprime tres líneas para pegar en /opt/one/.env.
// Sin dependencias: solo node:crypto. La clave PRIVADA solo se imprime por pantalla; nunca se guarda en
// ningún fichero del repo. NO volver a ejecutar una vez en uso: cada par nuevo invalida todas las
// suscripciones de los dispositivos (habría que pulsar «Generar» otra vez en cada uno para recrearlas).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CONTACTO_DEFECTO = 'https://carlostorresadvisory.github.io/one/';

/** Par VAPID en el formato de web-push: pública = punto sin comprimir (65 bytes) y privada = escalar (32 bytes), ambas en base64url. */
export function generarParVapid() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const publica = Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url');
  return { publica, privada: jwk.d };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { publica, privada } = generarParVapid();
  console.log(`VAPID_PUBLICA=${publica}`);
  console.log(`VAPID_PRIVADA=${privada}`);
  console.log(`VAPID_CONTACTO=${CONTACTO_DEFECTO}`);
  console.error(
    '\nPega estas tres líneas en /opt/one/.env (VAPID_CONTACTO puede ser también un mailto:) y relanza el contenedor.\n' +
      'La privada no se vuelve a mostrar ni va al repo. No generes otro par una vez en uso: se romperían las suscripciones.',
  );
}
