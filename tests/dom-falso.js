// DOM mínimo compartido por los tests de `node:test` que construyen nodos (visuales-clave-dom,
// visuales-alto). Solo implementa lo que visuales.js usa de verdad: createElement/createElementNS,
// setAttribute/getAttribute, appendChild, textContent, classList, dataset y style. Se instala en
// `globalThis` SOLO dentro de cada test (nunca a nivel de módulo) para no filtrar un `document`
// de mentira al resto de la suite -- por eso `instalarDomFalso` devuelve su propia desinstalación.
export class ElementoFalso {
  constructor(tagName) {
    this.tagName = tagName;
    this.attrs = {};
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this._clases = new Set();
  }
  setAttribute(nombre, valor) { this.attrs[nombre] = String(valor); }
  getAttribute(nombre) { return Object.prototype.hasOwnProperty.call(this.attrs, nombre) ? this.attrs[nombre] : null; }
  appendChild(hijo) { this.children.push(hijo); return hijo; }
  append(...hijos) { hijos.forEach((h) => this.children.push(h)); }
  get classList() {
    const clases = this._clases;
    return {
      add: (...c) => c.forEach((x) => clases.add(x)),
      remove: (...c) => c.forEach((x) => clases.delete(x)),
      contains: (c) => clases.has(c),
    };
  }
  get className() { return [...this._clases].join(' '); }
  set className(valor) { this._clases = new Set(String(valor).split(/\s+/).filter(Boolean)); }
  /** Recorre el árbol y devuelve el primer descendiente con esa clase (solo por clase: es lo
   * único que necesitan los tests, no hace falta un motor de selectores). */
  buscarPorClase(clase) {
    for (const hijo of this.children) {
      if (hijo._clases && hijo._clases.has(clase)) return hijo;
      const dentro = hijo.buscarPorClase ? hijo.buscarPorClase(clase) : null;
      if (dentro) return dentro;
    }
    return null;
  }
  /** Todos los descendientes con esa clase, en orden de aparición. */
  buscarTodosPorClase(clase) {
    const encontrados = [];
    for (const hijo of this.children) {
      if (hijo._clases && hijo._clases.has(clase)) encontrados.push(hijo);
      if (hijo.buscarTodosPorClase) encontrados.push(...hijo.buscarTodosPorClase(clase));
    }
    return encontrados;
  }
  /** Texto de todo el árbol, para comprobar de un vistazo que un dato aparece en el bloque. */
  get textoPlano() {
    return [this.textContent, ...this.children.map((h) => (h.textoPlano !== undefined ? h.textoPlano : ''))]
      .filter(Boolean)
      .join(' ');
  }
}

export function instalarDomFalso() {
  const anterior = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new ElementoFalso(tag),
    createElementNS: (_ns, tag) => new ElementoFalso(tag),
  };
  return () => {
    if (anterior === undefined) delete globalThis.document;
    else globalThis.document = anterior;
  };
}
