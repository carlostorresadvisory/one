// ONE · service worker — stale-while-revalidate: responde con la caché al instante y la
// actualiza en segundo plano, así un despliegue nuevo llega en la siguiente apertura sin
// tener que cambiar el nombre de la caché. Sin caché y sin red, respuesta de error controlada.
const CACHE = 'one-v32';

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
const NUCLEO = [
  './', 'index.html', 'app.js', 'mazo.js', 'motor.js', 'visuales.js', 'sincronizacion.js', 'atomo.js', 'tanda.js',
  'sonido.js', 'efectos.js', 'avatar.js', 'mochila.js', 'respaldo.js', 'modos.js', 'filtro.js', 'aviso-generadas.js',
  'ordago.js', 'ordago-ui.js', 'foto-pregunta.js', 'contrarreloj.js', 'contrarreloj-ui.js',
  'masomenos.js', 'masomenos-ui.js', 'escala.js', 'comodines-ui.js', 'tienda-ui.js',
  'vendor/zzfx.js', 'vendor/canvas-confetti.js',
  'estilos.css', 'datos/banco.json', 'datos/cifras.json',
];

// Las 6 fotos del hub (≈ 0,25 MB) van precacheadas aquí: sin conexión el hub las tiene.
const SECUNDARIOS = [
  'manifest.json', 'datos/imagenes.json', 'iconos/180.png', 'iconos/192.png', 'iconos/512.png',
  'imagenes-hub/clasico.webp', 'imagenes-hub/contrarreloj.webp', 'imagenes-hub/masomenos.webp',
  'imagenes-hub/ordago.webp', 'imagenes-hub/repaso.webp', 'imagenes-hub/tienda.webp',
];

// Avatar (esfinge v2): el reposo, las anclas y las imágenes fijas se precachean tolerantes (sin un
// vídeo la app sigue con la imagen fija). Los 6 gestos no se precachean: el `fetch` de abajo guarda
// cualquier GET del mismo origen la primera vez que se pide.
const AVATAR = [
  'avatar/reposo.mp4', 'avatar/anclas.json',
  'avatar/neutral.webp', 'avatar/contenta.webp', 'avatar/triste.webp', 'avatar/euforica.webp',
];
const AVATAR_GESTOS = [
  'avatar/saludo.mp4', 'avatar/pensando.mp4', 'avatar/sorpresa.mp4',
  'avatar/triste.mp4', 'avatar/acierto.mp4', 'avatar/euforia.mp4',
];

// Fotos de las preguntas: NO se precachean ni van en la caché del núcleo. Se guardan al verlas en una caché
// APARTE (`one-fotos`), fuera del techo de ≈ 5 MB del núcleo (tests/sw.test.js lo vigila: 4,39 MiB medidos el
// 11-oct-2026, con las fotos del hub), y se acota por bytes (3 MB): al pasarse se borran las más antiguas.
// Esa caché NO se borra al subir la versión del núcleo (`activate`): las fotos no cambian con la app.
// Son fotos las de las carpetas propias (imagenes-ia/, imagenes-banco/; las del hub van en el precaché), las WebP del servidor
// (/imagenes/<id>.webp) y las de Commons (upload.wikimedia.org). Estas dos últimas son de otro origen: un `<img>`
// las pide sin CORS (respuesta opaca, que el navegador cuenta con ~7 MB de relleno cada una), así que el SW las
// vuelve a pedir con CORS (Commons lo permite) para guardar una respuesta normal; si el origen no lo permite, la
// foto se enseña igual pero sin guardarla.
const CACHE_FOTOS = 'one-fotos';
const MAX_BYTES_FOTOS = 3 * 1024 * 1024;
const CARPETAS_FOTOS = ['/imagenes-ia/', '/imagenes-banco/'];
const HOSTS_FOTOS = ['upload.wikimedia.org'];

function esFoto(url, peticion) {
  if (url.origin === self.location.origin) {
    return url.pathname.startsWith('/imagenes/') || CARPETAS_FOTOS.some((c) => url.pathname.includes(c));
  }
  return peticion.destination === 'image' && (HOSTS_FOTOS.includes(url.hostname) || /^\/imagenes\/[\w-]+\.webp$/.test(url.pathname));
}

async function acotarFotos(cache) {
  const claves = await cache.keys();
  let total = 0;
  // De la más nueva a la más antigua: se conservan las recientes mientras quepan.
  for (const clave of claves.reverse()) {
    const respuesta = await cache.match(clave);
    total += respuesta ? (await respuesta.blob()).size : 0;
    if (total > MAX_BYTES_FOTOS) await cache.delete(clave);
  }
}

// Las fotos no cambian: primero la caché; si no está, red y, si es una respuesta normal, se guarda.
async function responderFoto(peticion, url) {
  const fotos = await caches.open(CACHE_FOTOS);
  const guardada = await fotos.match(peticion.url);
  if (guardada) return guardada;
  const propia = url.origin === self.location.origin;
  let respuesta = null;
  try {
    respuesta = await (propia ? fetch(peticion) : fetch(peticion.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }));
  } catch {
    respuesta = null;
  }
  if (!respuesta && !propia) {
    try {
      respuesta = await fetch(peticion); // CORS denegado o red caída: se enseña (opaca) sin guardar
    } catch {
      respuesta = null;
    }
  }
  if (!respuesta) return new Response('Sin conexión y sin copia local', { status: 503, statusText: 'Sin conexión' });
  if (respuesta.ok && respuesta.type !== 'opaque') {
    fotos.put(peticion.url, respuesta.clone()).then(() => acotarFotos(fotos)).catch(() => {});
  }
  return respuesta;
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all([
        cache.addAll(NUCLEO),
        ...[...SECUNDARIOS, ...AVATAR].map((ruta) => cache.add(ruta).catch(() => {
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
      Promise.all(claves.filter((clave) => clave !== CACHE && clave !== CACHE_FOTOS).map((clave) => caches.delete(clave)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  if (evento.request.method !== 'GET') return;
  const url = new URL(evento.request.url);
  if (esFoto(url, evento.request)) {
    evento.respondWith(responderFoto(evento.request, url));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Ronda final de revisión (Critical #4): una navegación con `?servidor=...&token=...` (el
  // enlace especial de configuración, spec §4) no debe dejar esa query en la CLAVE de la caché.
  // `cache.match` ya usa `ignoreSearch` para LEER (línea de abajo), pero sin esto `cache.put`
  // guardaba el `Request` original tal cual -- con el token en la URL -- para SIEMPRE en Cache
  // Storage, aunque la barra de direcciones se limpiara al momento
  // (sincronizacion.js#guardarConfiguracionDesdeUrl). Cualquier URL con query se guarda bajo su
  // clave sin ella, no solo las navegaciones (mismo criterio, más simple de mantener).
  const claveCache = url.search ? new Request(url.origin + url.pathname) : evento.request;

  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const enCache = await cache.match(evento.request, { ignoreSearch: true });
      const actualizacion = fetch(evento.request)
        .then((respuesta) => {
          if (respuesta && respuesta.ok) cache.put(claveCache, respuesta.clone()).catch(() => {});
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
