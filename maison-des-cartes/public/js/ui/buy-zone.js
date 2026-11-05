// Zone d'achat partagée par la fiche produit (ACHETER) et le panier (COMMANDER) :
// le bouton s'efface puis les vrais boutons PayPal apparaissent à sa place, sans changement de page.
import { h, money } from '../core/format.js';
import { mountPayPalButtons } from './paypal.js';

export function createBuyZone({ cfg, secondary, triggerLabel, summaryLabel, getItems, origin, onSuccess, onBeforePay }) {
  const trigger = h('button', { type: 'button', class: 'btn btn--primary buy-zone__trigger' });
  const summary = h('div', { class: 'paypal-slot__summary' });
  const slotButtons = h('div', { class: 'paypal-slot__buttons' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const back = h('button', { type: 'button', class: 'link-btn paypal-slot__back', text: origin === 'fiche' ? 'Revenir aux options d’achat' : 'Modifier ma commande' });
  const slot = h('div', { class: 'paypal-slot', 'aria-live': 'polite' }, summary, slotButtons, error, back);
  const el = h('div', { class: 'buy-zone' }, secondary || null, trigger, slot);
  let state = 'idle'; // idle | leaving | paying
  let instance = null;
  let lastMsg = '';

  const setMsg = (m) => {
    const text = typeof m === 'function' ? m(lastMsg) : m;
    lastMsg = text || '';
    error.textContent = lastMsg;
  };

  function refresh() {
    trigger.textContent = triggerLabel();
    summary.replaceChildren(h('span', { text: 'Paiement sécurisé PayPal' }), h('strong', { text: summaryLabel() }));
    trigger.disabled = getItems().length === 0;
  }

  async function animateHeight(change) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const h0 = el.offsetHeight;
    change();
    if (reduce) return;
    const h1 = el.offsetHeight;
    el.style.height = `${h0}px`;
    el.style.overflow = 'hidden';
    el.getBoundingClientRect();
    el.style.height = `${Math.max(h1, 150)}px`;
    await new Promise((r) => setTimeout(r, 400));
    el.style.height = '';
    el.style.overflow = '';
  }

  trigger.addEventListener('click', async () => {
    if (state !== 'idle' || trigger.disabled) return;
    if (onBeforePay && onBeforePay() === false) return;
    state = 'leaving';
    setMsg('');
    el.classList.add('is-leaving');
    await new Promise((r) => setTimeout(r, 280));
    await animateHeight(() => { el.classList.add('is-paying'); el.classList.remove('is-leaving'); });
    requestAnimationFrame(() => el.classList.add('is-shown'));
    state = 'paying';
    slot.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    instance = await mountPayPalButtons(slotButtons, { cfg, getItems, origin, onSuccess, onMessage: setMsg });
    if (state !== 'paying') { await instance.close(); instance = null; }
  });

  async function reset() {
    if (state === 'idle') return;
    state = 'idle';
    el.classList.remove('is-shown');
    const inst = instance;
    instance = null;
    await new Promise((r) => setTimeout(r, 220));
    await animateHeight(() => { el.classList.remove('is-paying'); });
    if (inst) await inst.close(); else slotButtons.replaceChildren();
    setMsg('');
  }
  back.addEventListener('click', reset);

  refresh();
  return { el, refresh, reset, get paying() { return state !== 'idle'; } };
}

export const fmt = money;
