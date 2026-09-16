// ONE · mazo.js — componente vertical reutilizable del mazo (spec v0.1c §1,
// §2.2, §6), extraído de app.js (Tarea 2, v0.2a): montarMazo, ajustarEncaje,
// calcularLineasClamp y los ayudantes que solo ellos usan (gesto vertical,
// chevrón/pista, registro de mazos activos). No sabe nada de preguntas ni de
// motor: la partida y el repaso (en app.js) deciden QUÉ tarjetas hay y cuándo
// hace falta una más (a través de `alCambiar` y `actualizarTarjetas`).
// Extracción pura: mismo código, mismos nombres, cero cambios de comportamiento.

// Mazos activos (partida y repaso): registro mínimo para que window.__one.irA()
// (solo con ?test=1) alcance al que esté visible.
const mazosActivos = [];

// ============================================================================
// --- MAZO: componente vertical reutilizable (spec v0.1c §1, §2.2, §6) ---
// Monta un mazo vertical sobre una lista de nodos de tarjeta YA CONSTRUIDOS:
// gestiona el gesto (pointerdown/move/up), las teclas (↑/↓, PageUp/PageDown),
// la columna de puntos, el chevrón y la pista, y la ventana de 3 nodos en el
// DOM (anterior/actual/siguiente). No sabe nada de preguntas ni de motor: la
// partida y el repaso (más abajo) son quienes deciden QUÉ tarjetas hay y
// cuándo hace falta una más (a través de `alCambiar` y `actualizarTarjetas`;
// el repaso, de tamaño fijo, no usa `alCambiar`). `test=1` en la URL expone
// window.__one.irA(indice) sobre el mazo que esté visible en cada momento.
// ============================================================================

const CLAVE_PISTA_MAZO = 'one.pistaMazo';
const LIMITE_PISTA_MAZO = 5;

function contarPistaMazoMostrada() {
  try {
    return Number(localStorage.getItem(CLAVE_PISTA_MAZO)) || 0;
  } catch (err) {
    return 0;
  }
}

function registrarPistaMazoMostrada(veces) {
  try {
    localStorage.setItem(CLAVE_PISTA_MAZO, String(veces));
  } catch (err) {
    // Sin contador persistente la pista se ve siempre: mejor de más que de menos.
  }
}

// Indicador de gesto (spec v0.1d §1): dos chevrones apilados que invitan a
// deslizar, sustituyen al antiguo chevrón fijo "⌃" (siempre visible tras las 5
// primeras vistas). Se apagan en cuanto el jugador desliza con éxito UNA VEZ
// en la sesión (sessionStorage, no localStorage: "vuelve en la sesión
// siguiente" según la spec) — a diferencia de la pista textual, que sigue
// gastando su propio presupuesto de 5 vistas en localStorage.
const CLAVE_GESTO_APRENDIDO = 'one.gestoAprendido';

function gestoYaAprendido() {
  try {
    return sessionStorage.getItem(CLAVE_GESTO_APRENDIDO) === '1';
  } catch (err) {
    return false;
  }
}

function marcarGestoAprendido() {
  try {
    sessionStorage.setItem(CLAVE_GESTO_APRENDIDO, '1');
  } catch (err) {
    // Sin sessionStorage el indicador se queda encendido: no rompe nada, solo
    // no se apaga tan pronto como debería.
  }
}

export function montarMazo(contenedor, tarjetasIniciales, { alCambiar, contarPista = true, puntosNeutros = false } = {}) {
  let lista = tarjetasIniciales.slice();
  let indice = 0;
  let pistaVisibleActual = true;
  // Nodos que YA han pasado por un render (para no transicionar su PRIMERA
  // aparición, ver comentario en render() más abajo).
  const nodosYaMostrados = new WeakSet();

  const puntos = document.createElement('div');
  puntos.className = 'mazo-puntos';
  puntos.dataset.test = 'mazo-puntos';
  contenedor.appendChild(puntos);

  // Dos chevrones apilados, superpuestos (spec v0.1d §1): "sin ocupar altura"
  // (position:absolute en CSS), animación mazo-invitar en bucle, apagados por
  // gestoYaAprendido(). aria-hidden porque es puramente decorativo: la pista
  // textual de abajo ya describe el gesto para quien use lector de pantalla.
  const indicadorGesto = document.createElement('div');
  indicadorGesto.className = 'mazo-gesto';
  indicadorGesto.dataset.test = 'mazo-gesto';
  indicadorGesto.setAttribute('aria-hidden', 'true');
  indicadorGesto.innerHTML = '<span class="mazo-gesto-chevron">˄</span><span class="mazo-gesto-chevron">˄</span>';
  contenedor.appendChild(indicadorGesto);

  const pista = document.createElement('p');
  pista.className = 'pista-mazo';
  pista.dataset.test = 'pista-mazo';
  pista.textContent = 'Desliza ↑ para la siguiente · ↓ para volver';
  contenedor.appendChild(pista);

  function estaVisible() {
    const vista = contenedor.closest('.vista');
    return Boolean(vista && !vista.hidden);
  }

  /** Un punto por HUECO rellenado (spec v0.1c §2.2), no por nodo del mazo:
   * hallazgo adversarial B3, confirmado. La tarjeta de cierre de la partida
   * (spec §2.4) no es un hueco — se marca con `dataset.puntoOculto` al
   * construirse (ver construirTarjetaCierre) y no pinta punto. En el mazo de
   * RESUMEN (repaso, `puntosNeutros`) la semántica respondida/sin responder no
   * aplica a la tarjeta de cifras ni a la final (nunca llevan
   * `dataset.respondida`, a diferencia de cada tarjeta de repaso, que SÍ lo
   * lleva a 'true' por ser una tarjeta ya respondida reutilizada): pintarlas
   * distinto daba una columna incoherente (mezcla de aro y relleno sin
   * relación con nada). Con `puntosNeutros` todos los puntos del resumen son
   * neutros (aro), y solo el actual se tiñe en cian — "un punto por tarjeta".
   *
   * C1 (ronda final de revisión de rendimiento): con el repaso infinito
   * (v0.2a.1 §7) `lista` puede tener cientos de huecos (banco real) — una
   * columna de 295-590 puntos es una raya inútil (el punto actual cae cerca
   * de la mitad de la caja, sin que se distinga nada) y volver a pintarla
   * ENTERA en cada deslizamiento costaba 84 ms con CPU x4. Por encima de 12
   * huecos se pinta solo una VENTANA de 9 puntos centrada en `indice` (con el
   * actual siempre dentro), clampeada a los límites de `lista`; con 12 o
   * menos (la partida, que nunca pasa de ~11) se pinta como siempre. */
  function pintarPuntos() {
    puntos.innerHTML = '';
    const VENTANA = 9;
    let inicio = 0;
    let fin = lista.length;
    if (lista.length > 12) {
      inicio = Math.max(0, Math.min(indice - Math.floor(VENTANA / 2), lista.length - VENTANA));
      fin = Math.min(lista.length, inicio + VENTANA);
    }
    for (let i = inicio; i < fin; i += 1) {
      const nodo = lista[i];
      if (nodo.dataset && nodo.dataset.puntoOculto === 'true') continue;
      const punto = document.createElement('span');
      punto.className = 'mazo-punto';
      if (!puntosNeutros) {
        const respondida = Boolean(nodo.dataset && nodo.dataset.respondida === 'true');
        punto.classList.toggle('mazo-punto--respondida', respondida);
      }
      punto.classList.toggle('mazo-punto--actual', i === indice);
      puntos.appendChild(punto);
    }
  }

  function pintarChevronYPista() {
    const actual = lista[indice];
    // Si la tarjeta actual ya tiene su propio botón "Siguiente" (partida, ya
    // respondida), el indicador/pista se quitan de en medio en vez de competir
    // por el mismo hueco vertical con ese botón (corrección ronda 1, hallazgo
    // visual 5). Una tarjeta de SOLO LECTURA (repaso, spec v0.1c §6) no tiene
    // "Siguiente": ahí el gesto debe seguir indicado igual que antes de
    // responder, así que se mira si el botón existe de verdad (no el atajo
    // "respondida === true", que en repaso es cierto pero no hay botón).
    const tieneSiguiente = Boolean(actual && actual.querySelector && actual.querySelector('[data-test="siguiente"]'));
    const hayMas = indice + 1 < lista.length;
    const mostrarBase = hayMas && !tieneSiguiente;
    // El indicador de gesto (spec v0.1d §1) se apaga en cuanto se aprendió el
    // gesto EN ESTA SESIÓN, independientemente del presupuesto de 5 vistas de
    // la pista textual (que sigue su propia lógica, sin tocar).
    //
    // Hallazgo I1 (revisión final v0.1e, preexistente desde v0.1d): la pista
    // textual ("Desliza ↑ para la siguiente...", 5 primeras tarjetas de la
    // vida de la app y TODO el repaso) y el chevrón (`bottom:2px`, 22px de
    // alto real) se solapan 16px con la pista (`bottom:8px`, 16px de alto)
    // cuando los dos están visibles a la vez. En vez de tocar posiciones (la
    // pista ya reserva su propia banda de 30px vía `.mazo--con-pista`, y
    // mover el chevrón encima de esa banda le quita el "pie de tarjeta" que
    // pide la spec), la pista textual ya EXPLICA el gesto por sí sola, así
    // que el chevrón sobra mientras esté visible: se oculta también cuando
    // hay pista, no solo cuando ya se aprendió el gesto.
    pista.hidden = !mostrarBase || !pistaVisibleActual;
    indicadorGesto.hidden = !mostrarBase || gestoYaAprendido() || !pista.hidden;
    // Solo con la pista textual visible la tarjeta reserva la banda de 30px
    // (estilos.css .mazo--con-pista); sin ella, el contenido llega abajo.
    contenedor.classList.toggle("mazo--con-pista", !pista.hidden);
  }

  /** Se llama una vez por cada índice NUEVO mostrado (no en cada render): decide
   * si esta vista cuenta para el límite de 5 y avanza el contador persistente.
   * Hallazgo adversarial B4, confirmado: `montarMazo` es genérico y también se
   * monta sobre el resumen (repaso, spec v0.1c §6) — sin distinción, navegar
   * por el repaso gastaba del mismo contador de "vistas de la pista" que la
   * partida, agotando el límite de 5 (spec §2.2, "las 5 primeras tarjetas de
   * la vida de la app") con vistas que no son preguntas de partida. Con
   * `contarPista: false` (repaso) se sigue LEYENDO el contador persistente
   * (para reflejar bien si el límite global ya se agotó) pero no se
   * incrementa: solo la partida "gasta" del presupuesto de 5. */
  function contarVistaParaPista() {
    const vistas = contarPistaMazoMostrada();
    pistaVisibleActual = vistas < LIMITE_PISTA_MAZO;
    if (contarPista) registrarPistaMazoMostrada(vistas + 1);
  }

  function render(conTransicion) {
    // Antes del bucle, NO después (Añadido A, hallazgo al depurar el nuevo
    // recorte calculado del enunciado sin responder): pintarChevronYPista()
    // decide si el contenedor lleva mazo--con-pista, que cambia el
    // padding-bottom de .tarjeta-mazo (14px -> 30px, estilos.css) y por tanto
    // el alto real disponible para .tarjeta-contenido. Si se llama DESPUÉS
    // del bucle, ajustarEncaje mide cada tarjeta con el padding TODAVÍA
    // antiguo y calcula su cascada (incluido el line-clamp del enunciado)
    // contra un alto que deja de ser cierto en cuanto esta función añade la
    // banda de 30px — visto en la práctica: el recorte calculado del
    // enunciado se quedaba ~16px corto (justo la diferencia de padding) y la
    // tarjeta acababa con scroll real. Calculando el padding ANTES, todas las
    // tarjetas del bucle miden ya el alto final.
    const enDom = new Set(contenedor.querySelectorAll('.tarjeta-mazo'));
    pintarChevronYPista();
    for (let offset = -1; offset <= 1; offset += 1) {
      const i = indice + offset;
      if (i < 0 || i >= lista.length) continue;
      const nodo = lista[i];
      // La PRIMERA vez que un nodo entra en el mazo nunca transiciona (no hay
      // "antes" del que deslizarse: bastante tenía Chromium con calcular su
      // primer layout como para además animarlo, y en la práctica dejaba
      // alguna tarjeta con getBoundingClientRect() midiendo mal durante esa
      // primera aparición — hallazgo real de la ronda 1, visto en captura a
      // 430×932). Solo se transicionan los movimientos posteriores.
      const primeraVez = !nodosYaMostrados.has(nodo);
      nodosYaMostrados.add(nodo);
      nodo.classList.add('tarjeta-mazo');
      nodo.classList.toggle('tarjeta-mazo--actual', offset === 0);
      nodo.classList.toggle('tarjeta-mazo--arrastrando', !conTransicion || primeraVez);
      nodo.dataset.indice = String(i);
      // +-1px de margen sobre el 100% exacto: dos cajas con inset:0 en el mismo
      // contenedor deberían medir idéntico, pero el redondeo a píxel de
      // dispositivo puede dejarlas a un pixel de distancia y asomar un borde de
      // la vecina (visto en captura, 430×932). Un pixel extra las esconde del
      // todo sin que se note el desplazamiento.
      const colchon = offset === 0 ? 0 : offset > 0 ? 1 : -1;
      nodo.style.transform = `translateY(calc(${offset * 100}% + ${colchon}px))`;
      if (nodo.parentElement !== contenedor) contenedor.insertBefore(nodo, puntos);
      enDom.delete(nodo);
      ajustarEncaje(nodo);
    }
    // Solo se mantienen en el DOM la actual, la anterior y la siguiente (spec
    // v0.1c §2.2): el resto se retira.
    enDom.forEach((nodo) => nodo.remove());
    pintarPuntos();
    // Red de seguridad de la causa raíz de C1 (ola final): `.mazo` tenía
    // `overflow: hidden`, lo que lo convertía en contenedor de SCROLL de
    // verdad (las tarjetas vecinas en `translateY(±100%)` hacen que
    // `scrollHeight` sea el doble de `clientHeight`). Al sustituir el nodo de
    // la tarjeta actual (manejarRespuesta -> actualizarTarjetas), Chromium
    // desplazaba el `scrollTop` del contenedor y TODAS las tarjetas
    // (`position:absolute; inset:0`, ya con su `transform` correcto) subían
    // esa misma cantidad en pantalla — el "desajuste de posición" que las
    // rondas 1-2 de la Tarea 2 taparon con un autocorrector
    // (corregirPosicionSiHaceFalta, ahora eliminado) sin haber encontrado
    // nunca la causa real. El fix de fondo es CSS (`.mazo { overflow: clip }`,
    // que no crea contenedor de scroll); esto es solo el cinturón para
    // navegadores sin soporte de `overflow: clip` (Safari < 16), donde `.mazo`
    // sigue cayendo al `overflow: hidden` de respaldo.
    if (contenedor.scrollTop !== 0) contenedor.scrollTop = 0;
  }

  function animarRebote(sentido) {
    const nodo = lista[indice];
    if (!nodo) return;
    const desplazamiento = sentido === 'abajo' ? 14 : -14;
    nodo.classList.remove('tarjeta-mazo--arrastrando');
    nodo.style.transform = `translateY(${desplazamiento}px)`;
    setTimeout(() => {
      nodo.style.transform = 'translateY(0)';
    }, 110);
  }

  function intentarIr(nuevo, viaGesto = false) {
    if (nuevo < 0) {
      animarRebote('abajo');
      return;
    }
    if (nuevo >= lista.length) {
      animarRebote('arriba');
      return;
    }
    if (nuevo === indice) return;
    indice = nuevo;
    // Solo un deslizamiento REAL con éxito apaga el indicador (spec v0.1d §1:
    // "en cuanto el jugador desliza con éxito"); navegar con teclado o tocando
    // "Siguiente" no enseña el gesto, así que no cuenta.
    if (viaGesto) marcarGestoAprendido();
    contarVistaParaPista();
    render(true);
    if (alCambiar) alCambiar(indice);
  }

  // --- gesto vertical sobre el propio contenedor (nunca sobre botones) ---
  const UMBRAL_PX = 60;
  const UMBRAL_VELOCIDAD = 0.5; // px/ms
  const ARRANQUE = 10;
  let gesto = null; // { id, x, y, capturado, ultimaY, ultimoT }
  let deltaYActual = 0;
  let velocidadActual = 0;

  function alPointerDown(ev) {
    // Los enlaces "Preguntar a" (spec v0.1c §5) son <a>, no <button>: se
    // excluyen igual que los botones para que un toque los abra en vez de
    // arrancar el gesto de arrastre del mazo.
    if (ev.target.closest('button') || ev.target.closest('a')) return;
    gesto = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, capturado: false, ultimaY: ev.clientY, ultimoT: performance.now() };
    deltaYActual = 0;
    velocidadActual = 0;
  }

  function alPointerMove(ev) {
    if (!gesto || ev.pointerId !== gesto.id) return;
    const dx = ev.clientX - gesto.x;
    const dy = ev.clientY - gesto.y;
    if (!gesto.capturado) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > ARRANQUE) {
        gesto.capturado = true;
        try { contenedor.setPointerCapture(ev.pointerId); } catch (err) { /* ya liberado */ }
      } else if (Math.abs(dx) > ARRANQUE) {
        // Horizontal dominante: no es el gesto del mazo (vf lo captura por su cuenta).
        gesto = null;
        return;
      } else {
        return;
      }
    }
    const ahora = performance.now();
    const dt = ahora - gesto.ultimoT;
    if (dt > 0) velocidadActual = (ev.clientY - gesto.ultimaY) / dt;
    gesto.ultimoT = ahora;
    gesto.ultimaY = ev.clientY;
    deltaYActual = dy;

    const actual = lista[indice];
    if (actual) {
      actual.classList.add('tarjeta-mazo--arrastrando');
      actual.style.transform = `translateY(${dy}px)`;
    }
    const vecino = dy < 0 ? lista[indice + 1] : lista[indice - 1];
    if (vecino) {
      vecino.classList.add('tarjeta-mazo--arrastrando');
      const base = dy < 0 ? 100 : -100;
      vecino.style.transform = `translateY(calc(${base}% + ${dy}px))`;
    }
  }

  function alPointerFin(ev) {
    if (!gesto || ev.pointerId !== gesto.id) return;
    const fueCapturado = gesto.capturado;
    gesto = null;
    if (!fueCapturado) return;
    const dy = deltaYActual;
    const v = velocidadActual;
    deltaYActual = 0;
    if (dy < -UMBRAL_PX || v < -UMBRAL_VELOCIDAD) {
      intentarIr(indice + 1, true);
    } else if (dy > UMBRAL_PX || v > UMBRAL_VELOCIDAD) {
      intentarIr(indice - 1, true);
    } else {
      render(true); // vuelve a la posición de reposo
    }
  }

  contenedor.addEventListener('pointerdown', alPointerDown);
  contenedor.addEventListener('pointermove', alPointerMove);
  contenedor.addEventListener('pointerup', alPointerFin);
  contenedor.addEventListener('pointercancel', alPointerFin);

  function alKeydown(ev) {
    if (!estaVisible()) return;
    if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
      ev.preventDefault();
      intentarIr(indice + 1);
    } else if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
      ev.preventDefault();
      intentarIr(indice - 1);
    }
  }
  document.addEventListener('keydown', alKeydown);

  function destruir() {
    document.removeEventListener('keydown', alKeydown);
    contenedor.removeEventListener('pointerdown', alPointerDown);
    contenedor.removeEventListener('pointermove', alPointerMove);
    contenedor.removeEventListener('pointerup', alPointerFin);
    contenedor.removeEventListener('pointercancel', alPointerFin);
    contenedor.innerHTML = '';
    const pos = mazosActivos.indexOf(controlador);
    if (pos !== -1) mazosActivos.splice(pos, 1);
  }

  const controlador = {
    irA: intentarIr,
    siguiente: () => intentarIr(indice + 1),
    anterior: () => intentarIr(indice - 1),
    indiceActual: () => indice,
    total: () => lista.length,
    // `ajusteIndice` (spec v0.2a.1 §7, repaso "sin fin"): cuántos nodos se han
    // retirado por DELANTE del array (no al final) en esta misma llamada —
    // p. ej. al recortar la vuelta más antigua de un feed infinito. Sin este
    // ajuste, sustituir `lista` sin más dejaría `indice` apuntando a un nodo
    // distinto del que el usuario tenía delante (el array entero se corrió
    // hacia atrás bajo sus pies): se resta ANTES de clampear contra el nuevo
    // largo, así la tarjeta visible sigue siendo la misma, sin salto. Con el
    // uso habitual (solo añadir al final, `actualizarEstadoMazo` de la
    // partida) `ajusteIndice` es 0 y el comportamiento no cambia.
    actualizarTarjetas(nuevaLista, ajusteIndice = 0) {
      lista = nuevaLista.slice();
      indice = Math.max(0, indice - ajusteIndice);
      if (indice > lista.length - 1) indice = Math.max(0, lista.length - 1);
      render(true);
    },
    reajustar() { render(true); },
    estaVisible,
    destruir,
  };
  mazosActivos.push(controlador);
  contarVistaParaPista();
  render(true);
  // OJO: alCambiar NO se llama aquí en el montaje inicial (a diferencia de cada
  // intentarIr posterior): quien llama a montarMazo todavía no tiene asignada su
  // propia referencia al controlador devuelto (p. ej. `mazoControlador = montarMazo(...)`
  // no se habrá completado), así que un alCambiar síncrono aquí vería esa
  // referencia a `null`. El propio llamador dispara su lógica de arranque (p. ej.
  // asegurarSiguienteDisponible) explícitamente después de recibir el controlador.
  return controlador;
}

window.addEventListener('resize', () => {
  mazosActivos.forEach((m) => m.reajustar());
});
window.addEventListener('orientationchange', () => {
  mazosActivos.forEach((m) => m.reajustar());
});

// Registro de mazos activos, expuesto para que app.js pueda resolver
// window.__one.irA(indice) sobre el que esté visible en cada momento
// (mismo mecanismo de siempre, solo que el array ahora vive aquí).
export { mazosActivos };

/** Calcula y aplica el recorte por `line-clamp` de `el` para que `contenedor`
 * (su `.tarjeta-contenido`) quepa en el alto que tiene disponible: líneas =
 * floor(alturaLibre / lineHeight), con `minimo` como suelo (1 para la
 * explicación, 2 para el enunciado — ver las dos llamadas en ajustarEncaje).
 * Ronda 1 de revisión: antes este cálculo estaba duplicado (explicación y
 * enunciado por separado); ahora vive en un solo sitio, con el margen de
 * seguridad de 4px también en un solo sitio (el redondeo del alto de línea
 * real frente al lineHeight calculado aquí puede dejar unos pocos px de
 * sobra que sin este margen se cuelan por encima de la tolerancia). */
export function calcularLineasClamp(el, contenedor, minimo) {
  const lineHeight = parseFloat(window.getComputedStyle(el).lineHeight) || 18;
  const restoAltura = contenedor.scrollHeight - el.scrollHeight;
  const alturaLibre = contenedor.clientHeight - restoAltura - 4;
  const lineas = Math.max(minimo, Math.floor(alturaLibre / lineHeight));
  el.style.webkitLineClamp = String(lineas);
  return lineas;
}

/**
 * Regla de encaje sin scroll (spec v0.1c §4.2, cascada de la tarjeta revelada
 * reescrita en spec §8/v0.2a.2 — "protagonismo visual"). Ninguna tarjeta hace
 * scroll: lo que cede espacio primero es la respuesta ya fija, luego el
 * tamaño del enunciado, luego la explicación (recortada con line-clamp
 * calculado) y, en la tarjeta revelada, la propia visual (mínimo 30% de
 * `.tarjeta-contenido`, nunca se quita). Se llama tras cada render del mazo y
 * en resize/orientationchange.
 */
export function ajustarEncaje(tarjetaNodo) {
  if (!tarjetaNodo) return;
  tarjetaNodo.classList.remove(
    'tarjeta--compacta-1',
    'tarjeta--sin-respuestas',
    'tarjeta--enunciado-menor',
    'tarjeta--sin-enunciado',
    'tarjeta--opciones-compactas',
    'tarjeta--enunciado-clamp',
    'tarjeta--explicacion-menor',
    'tarjeta--explicacion-minima',
    'tarjeta--explicacion-clamp',
    // spec §8 / v0.2a.2 (Tarea 2): paso nuevo de la cascada revelada — 14px
    // de enunciado, un paso más compacto que tarjeta--enunciado-menor (15px,
    // que sigue siendo el paso (a) de la cascada SIN responder de más abajo).
    'tarjeta--enunciado-14'
  );
  const explicacionEl = tarjetaNodo.querySelector('.explicacion');
  if (explicacionEl) explicacionEl.style.webkitLineClamp = '';
  const enunciadoEl = tarjetaNodo.querySelector('.enunciado');
  if (enunciadoEl) enunciadoEl.style.webkitLineClamp = '';
  // zona-imagen--reducida (spec §8) vive en `.zona-imagen`, no en la tarjeta
  // (el CSS `.tarjeta--revelada .zona-imagen--reducida` la apunta ahí): se
  // resetea aparte, en las dos ramas de la cascada de abajo por igual.
  const zonaImagenEl = tarjetaNodo.querySelector('.zona-imagen');
  if (zonaImagenEl) zonaImagenEl.classList.remove('zona-imagen--reducida');

  // Se mide `.tarjeta-contenido`, NO la tarjeta entera (hallazgo de la Tarea
  // 3b probando con art-003 + su imagen real a 430×932): la tarjeta es una
  // caja de tamaño FIJO (posicionada en absoluto sobre #mazo, spec v0.1c
  // §4.1), así que su propio scrollHeight nunca puede superar su clientHeight
  // salvo que algo escape de su borde — y `.tarjeta-contenido` (flex:1 auto,
  // min-height:0, sin overflow:hidden propio) puede desbordar SU hueco
  // asignado sin que eso llegue nunca a notarse en la tarjeta: ese desborde
  // queda invisible para tarjeta.scrollHeight y en su lugar se solapa en
  // silencio con la zona de acción (Preguntar a/Siguiente), o recorta el
  // enunciado por debajo de sus propias 5 líneas sin puntos suspensivos. La
  // caja que de verdad compite por espacio, y la única que hay que medir, es
  // .tarjeta-contenido frente a lo que le queda tras reservar la zona de
  // acción (ver también flex-shrink:0 en estilos.css, que evita que flexbox
  // encoja esos hijos en silencio antes de que la cascada de aquí actúe).
  const contenidoEl = tarjetaNodo.querySelector('.tarjeta-contenido');
  const cabe = () => !contenidoEl || contenidoEl.scrollHeight <= contenidoEl.clientHeight + 2;
  if (cabe()) return;

  // Cascada de la tarjeta SIN RESPONDER (Añadido A, 13-sep tarde: feedback de
  // Carlos desde el iPhone — una captura mostraba el enunciado recortado a 5
  // líneas fijas con "…" mientras sobraba media tarjeta vacía arriba y abajo:
  // "No podemos tener preguntas que no caben"). Automática y sin ningún
  // toque, parando en el primer paso en que ya cabe. Con el banco actual (a)
  // y (b) no deberían hacer falta casi nunca; lo importante es que un
  // enunciado de 5-7 líneas se vea ENTERO cuando hay sitio, que es el caso de
  // la captura:
  //  (a) el enunciado baja un paso de tamaño (15px, tarjeta--enunciado-menor,
  //      ya existía para la tarjeta respondida).
  //  (b) las opciones/botones se compactan (tarjeta--opciones-compactas): más
  //      apretadas, mismo tamaño de letra.
  //  (c) último recurso: recorte con line-clamp CALCULADO sobre el enunciado
  //      (mismo método que la explicación de la tarjeta respondida — líneas =
  //      floor(alturaLibre / lineHeight), mínimo 2), con "…", sin ningún
  //      toque para desplegarlo.
  // `=== 'false'`, no `!== 'true'` (Minor 1, ronda final de revisión): la
  // tarjeta "sin responder" del repaso infinito (v0.2a.1 §7) tiene la MISMA
  // forma que una respondida (zona de respuesta + feedback, construida por
  // construirTarjetaRespondida) pero, a propósito, no lleva `dataset.respondida`
  // en absoluto (nunca se ha respondido de verdad). Solo la pregunta ACTIVA
  // de una partida sin responder (construirTarjetaSinResponder, distinta
  // forma: opciones tocables, sin zona de respuesta ni feedback) marca
  // `dataset.respondida = 'false'` explícitamente — es la única que debe
  // caer en esta cascada.
  if (tarjetaNodo.dataset.respondida === 'false') {
    tarjetaNodo.classList.add('tarjeta--enunciado-menor');
    if (cabe()) return;

    tarjetaNodo.classList.add('tarjeta--opciones-compactas');
    if (cabe()) return;

    if (!enunciadoEl || !contenidoEl) return;
    tarjetaNodo.classList.add('tarjeta--enunciado-clamp');
    calcularLineasClamp(enunciadoEl, contenidoEl, 2);
    return;
  }

  // Cascada de la tarjeta REVELADA (spec §8, enmienda 16-sep-2026, v0.2a.2
  // "protagonismo visual" — SUSTITUYE la cascada anterior de v0.1d §3/§4
  // entera: ya no hay tarjeta--sin-respuestas/--sin-enunciado/
  // --explicacion-menor/--explicacion-minima en esta rama, aunque su CSS
  // sigue en estilos.css por si acaso — grep confirma que la cascada SIN
  // responder de arriba no las usa). La visual NUNCA se pliega por debajo
  // del 30% ni se quita: es la penúltima en ceder, justo antes del recorte
  // final de la explicación. Se para en el primer paso en el que ya cabe:
  //  (a) la respuesta pasa a una sola línea ("Respuesta: X ✓" / "Orden: A ›
  //      B › C › D…", tarjeta--compacta-1, ya existía).
  //  (b) el enunciado baja a 14px (tarjeta--enunciado-14) — un paso más que
  //      los 15px fijos de la tarjeta revelada (ver .tarjeta--revelada
  //      .enunciado en estilos.css), no los 15px de tarjeta--enunciado-menor
  //      (paso (a) de la cascada SIN responder de arriba, que sigue partiendo
  //      del tamaño grande con clamp()).
  //  (c) la explicación se recorta con line-clamp CALCULADO, mínimo 2 líneas
  //      (mismo cálculo que calcularLineasClamp ya usaba, ver abajo).
  //  (d) la visual (imagen/visual de datos/tarjeta tipográfica, todas
  //      `.zona-imagen`) baja su suelo del 40% al 30% (zona-imagen--reducida).
  //  (e) último recurso (no debería hacer falta con el banco actual): la
  //      explicación se recorta aún más, a 1 línea mínima.
  tarjetaNodo.classList.add('tarjeta--compacta-1');
  if (cabe()) return;

  tarjetaNodo.classList.add('tarjeta--enunciado-14');
  if (cabe()) return;

  if (explicacionEl && contenidoEl) {
    tarjetaNodo.classList.add('tarjeta--explicacion-clamp');
    calcularLineasClamp(explicacionEl, contenidoEl, 2);
    if (cabe()) return;
  }

  if (zonaImagenEl) {
    zonaImagenEl.classList.add('zona-imagen--reducida');
    if (cabe()) return;
  }

  if (explicacionEl && contenidoEl) {
    calcularLineasClamp(explicacionEl, contenidoEl, 1);
  }
}
