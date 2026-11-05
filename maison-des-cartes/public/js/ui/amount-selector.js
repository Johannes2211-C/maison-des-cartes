// Sélecteur de montant universel : curseur 20–100 € (pas de 1 €), saisie directe, valeurs rapides.
// Cartes à valeurs fixes : le curseur s'aimante sur les seules valeurs commercialisées.
import { h, moneyShort } from '../core/format.js';

export function createAmountSelector(product, selector, onChange) {
  const a = product.amounts;
  const fixed = a.type === 'fixed';
  const allowed = fixed ? a.values.slice() : null;
  const min = fixed ? selector.min : a.min;
  const max = fixed ? selector.max : a.max;
  const step = fixed ? 1 : a.step || 1;
  const quickValues = selector.quickValues.filter((v) => (fixed ? allowed.includes(v) : v >= min && v <= max));
  // pour une carte fixe, on propose aussi en raccourci les valeurs commercialisées absentes de la grille
  if (fixed) for (const v of allowed) if (!quickValues.includes(v)) quickValues.push(v);
  quickValues.sort((x, y) => x - y);

  const initial = fixed
    ? (allowed.includes(50) ? 50 : allowed[Math.floor((allowed.length - 1) / 2)])
    : Math.min(max, Math.max(min, 50));
  let value = initial;

  const nearest = (v) => {
    if (!fixed) return Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
    return allowed.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), allowed[0]);
  };

  const id = `amount-${product.id}`;
  const range = h('input', {
    class: 'amount__range', type: 'range', id, min, max, step, value,
    'aria-label': 'Montant de la carte', 'aria-valuetext': moneyShort(value),
    disabled: fixed && allowed.length < 2,
  });
  const input = h('input', { type: 'number', inputmode: 'numeric', min, max, step, value, 'aria-label': 'Saisir le montant en euros', disabled: fixed && allowed.length < 2 });
  const ticks = h('div', { class: 'amount__ticks', 'aria-hidden': 'true' });
  if (fixed) for (const v of allowed) {
    const t = h('i');
    t.style.left = `${((v - min) / (max - min)) * 100}%`;
    ticks.append(t);
  }
  const note = h('span', { class: 'amount__note' });
  const quick = h('div', { class: 'quick', role: 'group', 'aria-label': 'Valeurs rapides' },
    quickValues.map((v) => h('button', { type: 'button', 'data-v': v, 'aria-pressed': 'false', text: moneyShort(v), onclick: () => set(v, true) })));

  function paint() {
    range.value = value;
    range.setAttribute('aria-valuetext', moneyShort(value));
    range.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
    if (document.activeElement !== input) input.value = value;
    for (const b of quick.children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === value));
  }
  function set(v, notify = true) {
    const n = nearest(Number(v));
    if (!Number.isFinite(n)) return;
    const changed = n !== value;
    value = n;
    paint();
    if (notify && changed) onChange?.(value);
    return n;
  }

  range.addEventListener('input', () => {
    const raw = Number(range.value);
    set(raw);
    if (fixed) range.value = value; // aimantation immédiate sur une valeur commercialisée
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v) || input.value === '') return;
    if (!fixed && v >= min && v <= max && Number.isInteger((v - min) / step)) { value = v; paint(); onChange?.(value); note.textContent = ''; }
  });
  input.addEventListener('change', () => {
    const want = Number(input.value);
    const got = set(want);
    input.value = value;
    if (Number.isFinite(want) && got !== want) {
      note.textContent = fixed
        ? `Montant ajusté à ${moneyShort(value)} : valeurs proposées ${allowed.map(moneyShort).join(', ')}.`
        : `Montant ajusté à ${moneyShort(value)} (de ${moneyShort(min)} à ${moneyShort(max)}).`;
    } else note.textContent = '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  const el = h('section', { class: 'amount', 'aria-labelledby': `${id}-title` },
    h('h3', { class: 'amount__title', id: `${id}-title`, text: 'Choisissez votre montant' }),
    h('div', { class: 'amount__track' }, range, ticks),
    h('div', { class: 'amount__bounds' }, h('span', { text: moneyShort(min) }), h('span', { text: moneyShort(max) })),
    h('div', { class: 'amount__value' },
      h('label', { for: `${id}-input`, text: 'Votre sélection' }),
      h('span', { class: 'amount__input' }, Object.assign(input, { id: `${id}-input` }), h('span', { text: '€' }))),
    quick,
    h('p', { class: 'amount__note' }, fixed
      ? (allowed.length < 2 ? `Cette carte existe uniquement en ${moneyShort(allowed[0])}.` : `Valeurs commercialisées : ${allowed.map(moneyShort).join(', ')}.`)
      : `Montant libre, de ${moneyShort(min)} à ${moneyShort(max)} par pas de ${step} €.`),
    note,
  );
  paint();
  return { el, get value() { return value; }, set };
}
