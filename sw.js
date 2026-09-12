// ONE · service worker — cache-first de los estáticos, stale-while-revalidate del banco.
const CACHE = 'one-v1';

const ESTATICOS = [
  './',
  'index.html',
  'estilos.css',
  'app.js',
  'motor.js',
  'manifest.json',
  'datos/banco.json',
  'iconos/192.png',
  'iconos/512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        ESTATICOS.map((ruta) => cache.add(ruta).catch(() => {
          // Un recurso que falte (p. ej. banco.json aún no generado) no debe romper la instalación.
        }))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((clave) => clave !== CACHE).map((clave) => caches.delete(clave)))
    )
  );
  self.clients.claim();
});

function esBanco(url) {
  return url.pathname.endsWith('/datos/banco.json');
}

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);
  if (url.origin !== self.location.origin) return;

  if (esBanco(url)) {
    // stale-while-revalidate: responde con lo que haya en caché mientras actualiza en segundo plano.
    evento.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const enCache = await cache.match(evento.request);
        const actualizacion = fetch(evento.request)
          .then((respuesta) => {
            if (respuesta && respuesta.ok) cache.put(evento.request, respuesta.clone());
            return respuesta;
          })
          .catch(() => enCache);
        return enCache || actualizacion;
      })
    );
    return;
  }

  // cache-first para el resto de estáticos.
  evento.respondWith(
    caches.match(evento.request).then((enCache) => enCache || fetch(evento.request))
  );
});
