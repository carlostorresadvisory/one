// avisos.js (v0.3.4 C): cuándo se pide el permiso de notificaciones, la suscripción Web Push y la URL del tema.
// Todo con un `window` de mentira: ni red, ni navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { almacenFalso, almacenRoto } from './almacen-falso.js';
import {
  appInstalada, avisosSoportados, decisionPermiso, pedirPermisoSiProcede, suscribirParaTanda, claveAplicacion,
  urlDeTema, filtroDeUrl, mostrarLineaInstalar, permisoRechazado, CLAVE_AVISOS,
} from '../avisos.js';

const FILTRO = { area: 'historia', ruta: ['Roma'], etiquetas: ['Roma'] };

/** `window` falso. `standalone` = app instalada; `permiso` = Notification.permission; `respuesta` = lo que contesta el diálogo. */
function ventana({ standalone = true, permiso = 'default', respuesta = 'granted', soportado = true, suscripcionPrevia = null } = {}) {
  const llamadas = { requestPermission: 0, subscribe: [], unsubscribe: 0 };
  const win = {
    navigator: {
      standalone,
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => suscripcionPrevia,
            subscribe: async (opciones) => {
              llamadas.subscribe.push(opciones);
              return { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }) };
            },
          },
        }),
      },
    },
    matchMedia: () => ({ matches: false }),
    Notification: {
      permission: permiso,
      requestPermission: () => {
        llamadas.requestPermission += 1;
        win.Notification.permission = respuesta;
        return Promise.resolve(respuesta);
      },
    },
    PushManager: function PushManager() {},
  };
  if (!soportado) {
    delete win.PushManager;
    delete win.Notification;
  }
  return { win, llamadas };
}

test('appInstalada: navigator.standalone (iOS) o display-mode: standalone; en el navegador normal, no', () => {
  assert.equal(appInstalada(ventana({ standalone: true }).win), true);
  assert.equal(appInstalada({ navigator: {}, matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }), true);
  assert.equal(appInstalada(ventana({ standalone: false }).win), false);
  assert.equal(appInstalada({ navigator: {} }), false);
  assert.equal(appInstalada({ navigator: {}, matchMedia: () => { throw new Error('sin matchMedia'); } }), false);
});

test('avisosSoportados: hacen falta service worker, PushManager y Notification (Safari normal de iOS no los tiene)', () => {
  assert.equal(avisosSoportados(ventana().win), true);
  assert.equal(avisosSoportados(ventana({ soportado: false }).win), false);
});

test('decisionPermiso: pide solo con la app instalada, sin permiso previo y sin un «no» recordado', () => {
  assert.equal(decisionPermiso({ win: ventana().win, almacen: almacenFalso() }), 'pedir');
  assert.equal(decisionPermiso({ win: ventana({ standalone: false }).win, almacen: almacenFalso() }), 'nada', 'Safari normal: no se pide');
  assert.equal(decisionPermiso({ win: ventana({ soportado: false }).win, almacen: almacenFalso() }), 'nada');
  assert.equal(decisionPermiso({ win: ventana({ permiso: 'denied' }).win, almacen: almacenFalso() }), 'nada');
  assert.equal(decisionPermiso({ win: ventana({ permiso: 'granted' }).win, almacen: almacenFalso() }), 'concedido');
  assert.equal(decisionPermiso({ win: ventana().win, almacen: almacenFalso({ [CLAVE_AVISOS]: 'rechazado' }) }), 'nada', 'ya dijo que no');
});

test('mostrarLineaInstalar: solo cuando la app no está instalada', () => {
  assert.equal(mostrarLineaInstalar(ventana({ standalone: false }).win), true);
  assert.equal(mostrarLineaInstalar(ventana({ standalone: true }).win), false);
});

test('pedirPermisoSiProcede: lanza el diálogo en el acto (síncrono, dentro del toque) y devuelve el permiso', async () => {
  const { win, llamadas } = ventana({ respuesta: 'granted' });
  const promesa = pedirPermisoSiProcede({ win, almacen: almacenFalso() });
  assert.equal(llamadas.requestPermission, 1, 'requestPermission ya se llamó, sin esperar a ningún await');
  assert.equal(await promesa, 'granted');
});

test('pedirPermisoSiProcede: si dice que no se recuerda y la siguiente vez no se vuelve a pedir; si dice que sí, no se marca', async () => {
  const almacen = almacenFalso();
  const no = ventana({ respuesta: 'denied' });
  assert.equal(await pedirPermisoSiProcede({ win: no.win, almacen }), 'denied');
  assert.equal(permisoRechazado(almacen), true);
  // Otra tanda: el permiso del sistema sigue en 'default' (p. ej. se cerró el diálogo) pero no se insiste.
  const otra = ventana({ permiso: 'default' });
  assert.equal(pedirPermisoSiProcede({ win: otra.win, almacen }), null);
  assert.equal(otra.llamadas.requestPermission, 0);
  const si = almacenFalso();
  await pedirPermisoSiProcede({ win: ventana({ respuesta: 'granted' }).win, almacen: si });
  assert.equal(permisoRechazado(si), false);
});

test('pedirPermisoSiProcede: sin instalar no pide nada; con el almacenamiento roto no lanza', async () => {
  const sin = ventana({ standalone: false });
  assert.equal(pedirPermisoSiProcede({ win: sin.win, almacen: almacenFalso() }), null);
  assert.equal(sin.llamadas.requestPermission, 0);
  assert.equal(await pedirPermisoSiProcede({ win: ventana({ respuesta: 'denied' }).win, almacen: almacenRoto() }), 'denied');
});

test('pedirPermisoSiProcede: si requestPermission lanza o rechaza, el resultado es «denied» y nada se propaga', async () => {
  const lanza = ventana();
  lanza.win.Notification.requestPermission = () => { throw new Error('boom'); };
  assert.equal(await pedirPermisoSiProcede({ win: lanza.win, almacen: almacenFalso() }), 'denied');
  const rechaza = ventana();
  rechaza.win.Notification.requestPermission = () => Promise.reject(new Error('boom'));
  assert.equal(await pedirPermisoSiProcede({ win: rechaza.win, almacen: almacenFalso() }), 'denied');
});

test('claveAplicacion: base64url → bytes', () => {
  assert.deepEqual([...claveAplicacion('AQID')], [1, 2, 3]);
  assert.deepEqual([...claveAplicacion('-_8')], [251, 255]);
});

test('urlDeTema / filtroDeUrl: ida y vuelta del filtro; sin área válida o demasiado largo, «./»', () => {
  const url = urlDeTema(FILTRO);
  assert.match(url, /^\.\/\?tema=/);
  assert.deepEqual(filtroDeUrl(url), FILTRO);
  assert.equal(urlDeTema({ area: null, ruta: [], etiquetas: [] }), './');
  const larga = { area: 'historia', ruta: Array(6).fill('é'.repeat(160)), etiquetas: Array(6).fill('y'.repeat(40)) };
  assert.equal(urlDeTema(larga), './');
  assert.deepEqual(filtroDeUrl(`https://x.test/app/?tema=${encodeURIComponent(JSON.stringify(['economia', [], []]))}`), { area: 'economia', ruta: [], etiquetas: [] });
});

test('filtroDeUrl: URL sin tema, con JSON roto o con un área que no existe → null', () => {
  assert.equal(filtroDeUrl('./'), null);
  assert.equal(filtroDeUrl('./?tema=%7Bmal'), null);
  assert.equal(filtroDeUrl(`./?tema=${encodeURIComponent(JSON.stringify(['inventada', [], []]))}`), null);
  assert.equal(filtroDeUrl(`./?tema=${encodeURIComponent('"texto"')}`), null);
  assert.equal(filtroDeUrl(undefined), null);
});

test('suscribirParaTanda: con permiso concedido pide la clave, suscribe con ella y manda la suscripción con el id, el tema y la URL', async () => {
  const { win, llamadas } = ventana({ permiso: 'granted' });
  const enviado = [];
  const ok = await suscribirParaTanda({
    trabajoId: 't-1', tema: 'Roma', filtro: FILTRO, win,
    pedirClave: async () => 'AQID',
    registrar: async (datos) => { enviado.push(datos); return { ok: true, trabajo: true }; },
  });
  assert.equal(ok, true);
  assert.equal(llamadas.subscribe.length, 1);
  assert.equal(llamadas.subscribe[0].userVisibleOnly, true);
  assert.deepEqual([...llamadas.subscribe[0].applicationServerKey], [1, 2, 3]);
  assert.equal(enviado.length, 1);
  assert.equal(enviado[0].trabajoId, 't-1');
  assert.equal(enviado[0].tema, 'Roma');
  assert.equal(enviado[0].suscripcion.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
  assert.deepEqual(filtroDeUrl(enviado[0].url), FILTRO);
});

test('suscribirParaTanda: espera a que el jugador conteste el diálogo; si dice que no, no suscribe ni llama al servidor', async () => {
  const si = ventana();
  let enviados = 0;
  const registrar = async () => { enviados += 1; return { ok: true }; };
  const pendiente = pedirPermisoSiProcede({ win: si.win, almacen: almacenFalso() });
  assert.equal(await suscribirParaTanda({ trabajoId: 't', tema: 'x', filtro: FILTRO, win: si.win, permisoPendiente: pendiente, pedirClave: async () => 'AQID', registrar }), true);
  const no = ventana({ respuesta: 'denied' });
  const rechazo = pedirPermisoSiProcede({ win: no.win, almacen: almacenFalso() });
  assert.equal(await suscribirParaTanda({ trabajoId: 't', tema: 'x', filtro: FILTRO, win: no.win, permisoPendiente: rechazo, pedirClave: async () => 'AQID', registrar }), false);
  assert.equal(no.llamadas.subscribe.length, 0);
  assert.equal(enviados, 1);
});

test('suscribirParaTanda: sin instalar, sin servidor con avisos, sin id o con un error → false y nunca lanza', async () => {
  const base = { trabajoId: 't', tema: 'x', filtro: FILTRO, registrar: async () => ({ ok: true }) };
  assert.equal(await suscribirParaTanda({ ...base, win: ventana({ standalone: false, permiso: 'granted' }).win, pedirClave: async () => 'AQID' }), false);
  assert.equal(await suscribirParaTanda({ ...base, win: ventana({ permiso: 'granted' }).win, pedirClave: async () => null }), false, 'el servidor no tiene VAPID');
  assert.equal(await suscribirParaTanda({ ...base, trabajoId: '', win: ventana({ permiso: 'granted' }).win, pedirClave: async () => 'AQID' }), false);
  assert.equal(await suscribirParaTanda({ ...base, win: ventana({ permiso: 'granted' }).win, pedirClave: async () => { throw new Error('red'); } }), false);
  assert.equal(await suscribirParaTanda({ ...base, win: ventana({ permiso: 'granted' }).win, pedirClave: async () => 'AQID', registrar: async () => null }), false, 'el servidor no contestó');
});

test('suscribirParaTanda: reutiliza la suscripción existente y cambia la que tiene otra clave', async () => {
  const misma = {
    options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => { throw new Error('no debe darse de baja'); },
  };
  const a = ventana({ permiso: 'granted', suscripcionPrevia: misma });
  assert.equal(await suscribirParaTanda({ trabajoId: 't', tema: 'x', filtro: FILTRO, win: a.win, pedirClave: async () => 'AQID', registrar: async () => ({ ok: true }) }), true);
  assert.equal(a.llamadas.subscribe.length, 0, 'ya había una con esa clave');

  let baja = 0;
  const otra = { options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer }, unsubscribe: async () => { baja += 1; } };
  const b = ventana({ permiso: 'granted', suscripcionPrevia: otra });
  assert.equal(await suscribirParaTanda({ trabajoId: 't', tema: 'x', filtro: FILTRO, win: b.win, pedirClave: async () => 'AQID', registrar: async () => ({ ok: true }) }), true);
  assert.equal(baja, 1);
  assert.equal(b.llamadas.subscribe.length, 1);
});
