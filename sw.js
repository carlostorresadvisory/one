// ONE · service worker — stale-while-revalidate: responde con la caché al instante y la
// actualiza en segundo plano, así un despliegue nuevo llega en la siguiente apertura sin
// tener que cambiar el nombre de la caché. Sin caché y sin red, respuesta de error controlada.
const CACHE = 'one-v10';

// Hallazgo M1 (revisión final v0.1e): con un único `ESTATICOS` y
// `cache.add(ruta).catch(()=>{})` por recurso, la instalación "tenía éxito"
// aunque un núcleo con import estático (p. ej. `visuales.js`, que `app.js`
// importa con `import ... from` y por tanto NO puede tolerar un 404) se
// quedara sin cachear: offline, el navegador activa el service worker nuevo
// (ya "instalado" sin fallos aparentes), pero la app no arranca porque el
// import estático de `visuales.js` no tiene ni red ni caché — muerta sin
// ningún error visible para el usuario. Ahora el NÚCLEO se cachea con
// `cache.addAll` (atómico: si falla uno solo, falla la instalación entera,
// el navegador sigue sirviendo el service worker anterior — one-v8 — hasta
// que un despliegue con el núcleo completo consiga instalarse). Lo
// SECUNDARIO (iconos, manifest, el catálogo de imágenes) sigue siendo
// tolerante: que falte un icono no debe tumbar la app.
const NUCLEO = ['./', 'index.html', 'app.js', 'mazo.js', 'motor.js', 'visuales.js', 'estilos.css', 'datos/banco.json'];

const SECUNDARIOS = ['manifest.json', 'datos/imagenes.json', 'iconos/180.png', 'iconos/192.png', 'iconos/512.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all([
        cache.addAll(NUCLEO),
        ...SECUNDARIOS.map((ruta) => cache.add(ruta).catch(() => {
          // Un recurso secundario que falte no debe romper la instalación.
        })),
      ])
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
