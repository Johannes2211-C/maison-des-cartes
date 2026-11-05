// Panier : conservé dans le navigateur. Les prix affichés sont indicatifs ;
// le serveur recalcule et vérifie chaque montant avant tout paiement.
const KEY = 'mdc-cart-v1';
const events = new EventTarget();
let lines = [];
try { lines = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { lines = []; }
if (!Array.isArray(lines)) lines = [];

const MAX_QTY = 10;
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* navigation privée */ }
  events.dispatchEvent(new Event('change'));
};

export const cart = {
  get lines() { return lines; },
  onChange(fn) { events.addEventListener('change', fn); },
  /** Retire les lignes dont le produit ou le montant n'est plus proposé. */
  reconcile(catalog) {
    const before = lines.length;
    lines = lines.filter((l) => {
      const p = catalog.byId.get(l.productId);
      if (!p) return false;
      const a = p.amounts;
      return a.type === 'variable' ? l.amount >= a.min && l.amount <= a.max : a.values.includes(l.amount);
    });
    if (lines.length !== before) save(); else events.dispatchEvent(new Event('change'));
  },
  add(productId, amount, quantity) {
    const existing = lines.find((l) => l.productId === productId && l.amount === amount);
    if (existing) existing.quantity = Math.min(MAX_QTY, existing.quantity + quantity);
    else lines.push({ productId, amount, quantity: Math.min(MAX_QTY, quantity) });
    save();
  },
  setQuantity(index, q) {
    if (!lines[index]) return;
    if (q <= 0) lines.splice(index, 1); else lines[index].quantity = Math.min(MAX_QTY, q);
    save();
  },
  remove(index) { lines.splice(index, 1); save(); },
  clear() { lines = []; save(); },
  count() { return lines.reduce((s, l) => s + l.quantity, 0); },
  total() { return lines.reduce((s, l) => s + l.amount * l.quantity, 0); },
  items() { return lines.map((l) => ({ productId: l.productId, amount: l.amount, quantity: l.quantity })); },
  MAX_QTY,
};
