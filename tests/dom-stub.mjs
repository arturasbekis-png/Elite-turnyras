// Minimalus DOM imitatorius, kad ranking/public-app.js būtų galima įvykdyti Node aplinkoje.
// Tai ne naršyklė: tikrinama, ar puslapio logika (maršrutai, įvykiai, būsenos) vykdoma be klaidų
// ir gamina tikėtiną HTML. Vizualinis vaizdas čia netikrinamas.

export function installDom({ hostname = 'localhost', search = '', hash = '' } = {}) {
  const elements = new Map();
  const listeners = {};
  const makeEl = (id) => {
    const handlers = {};
    return { id, innerHTML: '', textContent: '', value: '', dataset: {}, handlers, addEventListener(type, fn) { handlers[type] = fn; } };
  };
  const el = (id) => { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); };

  const selectors = new Map();
  globalThis.document = {
    getElementById: el,
    querySelectorAll: () => [],
    querySelector: (selector) => (selector === '.controls .count' ? el('count') : selectors.get(selector) || null),
    createElement: () => ({ click() {}, remove() {}, set href(_) {}, set download(_) {} }),
    body: { appendChild() {} },
  };
  const loc = {
    hostname, search, _hash: hash,
    get hash() { return this._hash; },
    set hash(value) { this._hash = value.startsWith('#') ? value : `#${value}`; (listeners.hashchange || []).forEach((fn) => fn()); },
  };
  globalThis.location = loc;
  globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, scrollTo() {}, scrollY: 0, confirm: () => true };
  return { el, loc, listeners, selectors };
}

export const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sukuria klaidos objektą, kuris atrodo kaip naršyklės įvykis. */
export function clickOn(selectorMap) {
  return { target: { closest: (selector) => selectorMap[selector] || null, matches: () => false } };
}
export function inputEvent(selector, value) {
  return { target: { value, matches: (s) => s === selector, dataset: {} } };
}
export function changeEvent(control, value) {
  return { target: { value, dataset: { control } } };
}

/** Administravimo įvykiai. */
export const act = (name, extra = {}) => ({ preventDefault() {}, target: { closest: (sel) => (sel === '[data-act]' ? { dataset: { act: name, ...extra } } : null) } });
export const submit = (form) => ({ preventDefault() {}, target: { dataset: { form } } });
export const adminInput = (entry, field, value) => ({ target: { value, dataset: { entry, field }, hasAttribute: () => false } });
export const adminChange = (dataset, value, extra = {}) => ({ target: { value, dataset, hasAttribute: (n) => Boolean(extra[n]), ...extra } });
