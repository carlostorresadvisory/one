// ONE · service worker — stale-while-revalidate: responde con la caché al instante y la
// actualiza en segundo plano, así un despliegue nuevo llega en la siguiente apertura sin
// tener que cambiar el nombre de la caché. Sin caché y sin red, respuesta de error controlada.
const CACHE = 'one-v4';

const ESTATICOS = [
  './',
  'estilos.css',
  'app.js',
  'motor.js',
  'manifest.json',
  'datos/banco.json',
  'iconos/180.png',
  'iconos/192.png',
  'iconos/512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        ESTATICOS.map((ruta) => cache.add(ruta).catch(() => {
          // Un recurso que falte no debe romper la instalación.
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

self.addEventListener('fetch', (evento) => {
  if (evento.request.method !== 'GET') return;
  const url = new URL(evento.request.url);
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const enCache = await cache.match(evento.request, { ignoreSearch: true });
      const actualizacion = fetch(evento.request)
        .then((respuesta) => {
          if (respuesta && respuesta.ok) cache.put(evento.request, respuesta.clone());
          return respuesta;
        })
        .catch(() => null);
      if (enCache) {
        // No se espera a la red: la actualización queda para la próxima apertura.
        evento.waitUntil(actualizacion);
        return enCache;
      }
      const deRed = await actualizacion;
      return deRed || new Response('Sin conexión y sin copia local', { status: 503, statusText: 'Sin conexión' });
    })
  );
});
