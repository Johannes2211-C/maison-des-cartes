// Ouverture / fermeture des panneaux (fiche produit, panier) avec voile, Échap et gestion du focus.
const scrim = document.getElementById('scrim');
const stack = [];
const listeners = new Set();

export function onPanelsChange(fn) { listeners.add(fn); }
const notify = () => listeners.forEach((fn) => fn(stack.length > 0));

export function openPanel(el, { onClose } = {}) {
  if (stack.find((s) => s.el === el)) return;
  const entry = { el, onClose, returnFocus: document.activeElement };
  stack.push(entry);
  el.hidden = false;
  scrim.hidden = false;
  el.getBoundingClientRect();
  requestAnimationFrame(() => { el.classList.add('is-open'); scrim.classList.add('is-open'); });
  el.style.zIndex = 41 + stack.length;
  setTimeout(() => (el.querySelector('[data-autofocus]') || el.querySelector('[data-close]'))?.focus({ preventScroll: true }), 60);
  notify();
}

export function closePanel(el) {
  const i = stack.findIndex((s) => s.el === el);
  if (i < 0) return;
  const [entry] = stack.splice(i, 1);
  el.classList.remove('is-open');
  if (!stack.length) scrim.classList.remove('is-open');
  setTimeout(() => {
    if (!el.classList.contains('is-open')) el.hidden = true;
    if (!stack.length) scrim.hidden = true;
  }, 460);
  entry.onClose?.();
  if (entry.returnFocus?.isConnected) entry.returnFocus.focus({ preventScroll: true });
  notify();
}

export function isOpen(el) { return stack.some((s) => s.el === el); }
export function anyOpen() { return stack.length > 0; }

scrim.addEventListener('click', () => { const top = stack[stack.length - 1]; if (top) closePanel(top.el); });
document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') { closePanel(top.el); return; }
  if (e.key === 'Tab') {
    const f = [...top.el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) closePanel(c.closest('.sheet, .drawer'));
});
