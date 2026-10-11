// Aviso grande «Preguntas generadas» (v0.3 fase 3): cola persistida de UN aviso pendiente, regla de
// cuándo puede verse y montaje del DOM. Lógica pura + un montaje mínimo; app.js solo lo enruta.

export const CLAVE_AVISO = 'one.avisoGeneradas';
export const MS_AVISO = 20000;

// Vistas donde pulsar el aviso abandonaría lo que se está haciendo: la partida (`pregunta`, `repaso`,
// `ordago`, `contrarreloj`, `caida` y `cofre`, este con el premio sin recoger) y la espera del Átomo,
// que ya trae su propio botón «Jugar la tanda».
const VISTAS_SIN_AVISO = ['pregunta', 'repaso', 'ordago', 'contrarreloj', 'caida', 'cofre', 'atomo-espera'];

function normalizar(valor) {
  if (!valor || !Array.isArray(valor.ids) || valor.ids.length === 0 || typeof valor.corto !== 'string') return null;
  return { ids: [...valor.ids], corto: valor.corto };
}

/** Cola de un solo aviso. Persistida para que, si la app estaba cerrada, el aviso siga al volver;
 * con el almacenamiento bloqueado vive en memoria y nada lanza. */
export function crearColaAviso({ almacen } = {}) {
  let enMemoria = null;
  return {
    encolar({ ids, corto }) {
      const nuevo = normalizar({ ids, corto });
      if (!nuevo) return;
      enMemoria = nuevo;
      try {
        (almacen ?? globalThis.localStorage).setItem(CLAVE_AVISO, JSON.stringify(nuevo));
      } catch (err) {
        /* solo memoria */
      }
    },
    pendiente() {
      try {
        const texto = (almacen ?? globalThis.localStorage).getItem(CLAVE_AVISO);
        return texto === null ? null : normalizar(JSON.parse(texto));
      } catch (err) {
        return enMemoria;
      }
    },
    descartar() {
      enMemoria = null;
      try {
        (almacen ?? globalThis.localStorage).removeItem(CLAVE_AVISO);
      } catch (err) {
        /* solo memoria */
      }
    },
  };
}

/** `false` con la app en segundo plano o en una vista donde pulsarlo abandonaría algo. */
export function puedeMostrarse({ vista, visible }) {
  return Boolean(visible) && !VISTAS_SIN_AVISO.includes(vista);
}

function crear(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** Pinta el aviso en `nodo` y lo muestra. `cerrar()` solo lo oculta (sin llamar a `alJugar` ni a
 * `alCerrar`); ✕ y el cierre a los `MS_AVISO` (contados desde que se muestra) llaman a `alCerrar`,
 * y tocar la banda a `alJugar`, una sola vez en total. */
export function montarAviso(nodo, { ids, corto }, { alJugar, alCerrar, temporizador = globalThis }) {
  let abierto = true;
  let idTemporizador = null;
  const cerrar = () => {
    if (!abierto) return;
    abierto = false;
    temporizador.clearTimeout(idTemporizador);
    nodo.hidden = true;
  };
  const accion = (fn) => () => {
    if (!abierto) return;
    cerrar();
    fn();
  };

  const jugar = crear('button', 'aviso-generadas-jugar');
  jugar.setAttribute('type', 'button');
  jugar.setAttribute('data-test', 'aviso-generadas-jugar');
  const icono = crear('span', 'aviso-generadas-icono', '✨');
  icono.setAttribute('aria-hidden', 'true');
  const textos = crear('span', 'aviso-generadas-textos');
  textos.append(
    crear('span', 'aviso-generadas-titulo', 'Preguntas generadas'),
    crear('span', 'aviso-generadas-detalle', `${corto} · ${ids.length}`),
  );
  jugar.append(icono, textos, crear('span', 'aviso-generadas-accion', 'Jugar ▶'));
  jugar.addEventListener('click', accion(alJugar));

  const cierre = crear('button', 'aviso-generadas-cerrar', '✕');
  cierre.setAttribute('type', 'button');
  cierre.setAttribute('data-test', 'aviso-generadas-cerrar');
  cierre.setAttribute('aria-label', 'Descartar el aviso');
  cierre.addEventListener('click', accion(alCerrar));

  nodo.textContent = '';
  nodo.append(jugar, cierre);
  nodo.hidden = false;
  idTemporizador = temporizador.setTimeout(accion(alCerrar), MS_AVISO);
  return { cerrar };
}
