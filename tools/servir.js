// Servidor estático sin dependencias para desarrollo local y pruebas (e2e).
// Sirve la raíz del repo. Puerto configurable con la variable de entorno PUERTO.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const PUERTO = Number(process.env.PUERTO) || 8765;

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function tipoMime(ruta) {
  const ext = path.extname(ruta).toLowerCase();
  if (ext === '.json' && ruta.endsWith('manifest.json')) {
    return TIPOS_MIME['.webmanifest'];
  }
  return TIPOS_MIME[ext] || 'application/octet-stream';
}

function resolverRuta(urlPath) {
  // Quita la query string y decodifica.
  let ruta = decodeURIComponent(urlPath.split('?')[0]);
  if (ruta === '/' || ruta === '') ruta = '/index.html';
  const rutaAbsoluta = path.normalize(path.join(RAIZ, ruta));
  // Evita salir de la raíz del repo (path traversal).
  if (!rutaAbsoluta.startsWith(RAIZ)) return null;
  return rutaAbsoluta;
}

export function crearServidor() {
  return http.createServer((req, res) => {
    const rutaAbsoluta = resolverRuta(req.url || '/');
    if (!rutaAbsoluta) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Petición inválida');
      return;
    }
    fs.readFile(rutaAbsoluta, (err, contenido) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No encontrado');
        return;
      }
      res.writeHead(200, {
        'Content-Type': tipoMime(rutaAbsoluta),
        'Cache-Control': 'no-store',
      });
      res.end(contenido);
    });
  });
}

// Solo arranca el servidor si el fichero se ejecuta directamente (no al importarlo en tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const servidor = crearServidor();
  servidor.listen(PUERTO, () => {
    console.log(`ONE sirviendo en http://localhost:${PUERTO}/`);
  });
}
