// Panier : lignes modifiables, récapitulatif et paiement global en une seule transaction PayPal.
import { h, money, moneyShort } from '../core/format.js';
import { cart } from '../core/cart.js';
import { createBuyZone } from './buy-zone.js';
import { cardVisual } from './placeholder.js';
import { openPanel, closePanel, isOpen } from './panels.js';

const drawer = document.getElementById('cart-drawer');
const body = document.getElementById('cart-body');
const foot = document.getElementById('cart-foot');
const button = document.getElementById('cart-button');
let ctx = null;
let zone = null;

export function initCart(context) {
  ctx = context;
  zone = createBuyZone({
    cfg: ctx.cfg,
    origin: 'panier',
    triggerLabel: () => 'Commander',
    summaryLabel: () => money(cart.total()),
    getItems: () => cart.items(),
    onSuccess: (summary, token) => { cart.clear(); closePanel(drawer); ctx.onOrderComplete(summary, token, 'panier'); },
  });
  button.addEventListener('click', () => (isOpen(drawer) ? closePanel(drawer) : openCart()));
  cart.onChange(render);
  render();
}

export function openCart() {
  render();
  openPanel(drawer, { onClose: () => { zone.reset(); button.setAttribute('aria-expanded', 'false'); } });
  button.setAttribute('aria-expanded', 'true');
}

function render() {
  document.getElementById('cart-count').textContent = String(cart.count());
  if (!ctx) return;
  const lines = cart.lines;
  if (!lines.length) {
    zone?.reset();
    body.replaceChildren(h('div', { class: 'empty' },
      h('h2', { text: 'Votre panier est vide' }),
      h('p', { text: 'Choisissez une carte en boutique ou dans le catalogue, puis son montant.' }),
      h('p', {}, h('a', { class: 'btn btn--secondary', href: '/catalogue', 'data-link': true, onclick: () => closePanel(drawer), text: 'Parcourir le catalogue' }))));
    foot.replaceChildren();
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
  body.replaceChildren(...lines.map((l, i) => {
    const p = ctx.catalog.byId.get(l.productId);
    if (!p) return null;
    const minus = h('button', { type: 'button', 'aria-label': `Diminuer la quantité de ${p.name}`, text: '−', onclick: () => cart.setQuantity(i, l.quantity - 1) });
    const plus = h('button', { type: 'button', 'aria-label': `Augmenter la quantité de ${p.name}`, text: '+', disabled: l.quantity >= cart.MAX_QTY, onclick: () => cart.setQuantity(i, l.quantity + 1) });
    return h('article', { class: 'cart-line' },
      h('div', { class: 'cart-line__img' }, cardVisual(p, { alt: false })),
      h('div', {},
        h('p', { class: 'cart-line__name', text: p.name }),
        h('p', { class: 'cart-line__meta', text: `Montant ${moneyShort(l.amount)} · prix unitaire ${money(l.amount)}` }),
        h('div', { class: 'cart-line__actions' },
          h('div', { class: 'stepper' }, minus, h('output', { text: String(l.quantity) }), plus),
          h('button', { type: 'button', class: 'link-btn', text: 'Supprimer', onclick: () => cart.remove(i) }))),
      h('p', { class: 'cart-line__total', text: money(l.amount * l.quantity) }));
  }));
  const count = cart.count();
  if (!foot.contains(zone.el)) {
    foot.replaceChildren(h('div', { class: 'summary', id: 'cart-summary' }), zone.el);
  }
  foot.querySelector('#cart-summary').replaceChildren(
    h('p', { class: 'summary__title', text: 'Récapitulatif de commande' }),
    h('div', { class: 'summary__row' }, h('span', { text: `${count} carte${count > 1 ? 's' : ''}` }), h('span', { text: money(cart.total()) })),
    h('div', { class: 'summary__row' }, h('span', { text: 'Livraison numérique' }), h('span', { text: 'Incluse' })),
    h('div', { class: 'summary__row summary__row--total' }, h('span', { text: 'Total' }), h('strong', { text: money(cart.total()) })));
  zone.refresh();
}
