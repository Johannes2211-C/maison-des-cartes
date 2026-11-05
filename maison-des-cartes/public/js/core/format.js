// Formats et petites aides d'interface.
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurShort = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (v) => eur.format(v);
export const moneyShort = (v) => (Number.isInteger(v) ? eurShort.format(v) : eur.format(v));

export function priceRange(p) {
  const a = p.amounts;
  if (a.type === 'variable') return `${moneyShort(a.min)} à ${moneyShort(a.max)}`;
  if (!a.values.length) return 'Momentanément indisponible';
  if (a.values.length === 1) return moneyShort(a.values[0]);
  return `${moneyShort(a.values[0])} à ${moneyShort(a.values[a.values.length - 1])}`;
}

export function amountList(p) {
  const a = p.amounts;
  if (a.type === 'variable') return `Montant libre de ${moneyShort(a.min)} à ${moneyShort(a.max)}, par pas de ${a.step} €`;
  return a.values.map(moneyShort).join(', ');
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let toastT;
export function toast(message, action) {
  const t = document.getElementById('toast');
  t.replaceChildren(h('span', { text: message }));
  if (action) t.append(h('button', { type: 'button', text: action.label, onclick: () => { action.run(); t.classList.remove('is-shown'); } }));
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('is-shown'));
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.remove('is-shown'); setTimeout(() => (t.hidden = true), 320); }, action ? 6500 : 3200);
}
