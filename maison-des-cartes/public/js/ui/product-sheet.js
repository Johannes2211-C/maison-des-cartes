// Fiche produit : visuel, informations, sélecteur de montant, quantité, panier et achat direct PayPal.
import { h, money, moneyShort, amountList, toast } from '../core/format.js';
import { cart } from '../core/cart.js';
import { createAmountSelector } from './amount-selector.js';
import { createBuyZone } from './buy-zone.js';
import { cardVisual } from './placeholder.js';
import { openPanel, closePanel } from './panels.js';

const sheet = document.getElementById('product-sheet');
const content = document.getElementById('sheet-content');
let current = null;

export function openProductSheet(product, { catalog, cfg, onOrderComplete, openCart }) {
  current?.zone?.reset();
  let qty = 1;
  const selector = createAmountSelector(product, catalog.selector, () => update());
  const qtyOut = h('output', { 'aria-live': 'polite', text: '1' });
  const minus = h('button', { type: 'button', 'aria-label': 'Diminuer la quantité', text: '−', onclick: () => setQty(qty - 1) });
  const plus = h('button', { type: 'button', 'aria-label': 'Augmenter la quantité', text: '+', onclick: () => setQty(qty + 1) });
  const priceStrong = h('strong');
  const addBtn = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Ajouter au panier', 'data-autofocus': true });

  const zone = createBuyZone({
    cfg,
    origin: 'fiche',
    secondary: addBtn,
    triggerLabel: () => `Acheter · ${moneyShort(selector.value * qty)}`,
    summaryLabel: () => `${qty} × ${moneyShort(selector.value)} = ${money(selector.value * qty)}`,
    getItems: () => [{ productId: product.id, amount: selector.value, quantity: qty }],
    onSuccess: (summary, token) => { closePanel(sheet); onOrderComplete(summary, token, 'fiche'); },
  });

  function setQty(q) {
    qty = Math.max(1, Math.min(cart.MAX_QTY, q));
    qtyOut.textContent = String(qty);
    minus.disabled = qty <= 1;
    plus.disabled = qty >= cart.MAX_QTY;
    update();
  }
  function update() {
    priceStrong.textContent = money(selector.value * qty);
    zone.refresh();
  }
  addBtn.addEventListener('click', () => {
    cart.add(product.id, selector.value, qty);
    const btn = document.getElementById('cart-button');
    btn.classList.remove('is-bumped'); btn.getBoundingClientRect(); btn.classList.add('is-bumped');
    toast(`${product.name} ${moneyShort(selector.value)} × ${qty} ajoutée au panier`, { label: 'Voir le panier', run: openCart });
  });

  const visual = h('div', { class: 'sheet__visual' }, cardVisual(product));
  const body = [
    visual,
    h('p', { class: 'sheet__brand', text: product.brand }),
    h('h2', { id: 'sheet-title', text: product.name }),
    h('p', { class: 'sheet__desc', text: product.description }),
    product.placeholder ? h('p', { class: 'dev-note', text: 'Aperçu de développement : le visuel officiel de cette carte n’est pas encore intégré. Ce produit ne sera pas publié en production tant que son visuel et ses droits d’utilisation ne seront pas fournis.' }) : null,
    h('dl', { class: 'facts' },
      h('dt', { text: 'Validité' }), h('dd', { text: product.region }),
      h('dt', { text: 'Montants' }), h('dd', { text: amountList(product) }),
      h('dt', { text: 'Livraison' }), h('dd', { text: 'Code envoyé par e-mail après confirmation du paiement' })),
    h('details', { class: 'terms' }, h('summary', { text: 'Conditions d’utilisation' }), h('ul', {}, product.terms.map((t) => h('li', { text: t })))),
    selector.el,
    h('div', { class: 'qty-row' }, h('span', { text: 'Quantité' }), h('div', { class: 'stepper' }, minus, qtyOut, plus)),
    h('div', { class: 'price-line' }, h('span', { text: 'Prix' }), priceStrong),
    zone.el,
  ];
  content.replaceChildren(...body);
  content.scrollTop = 0;
  setQty(1);
  current = { product, zone };
  openPanel(sheet, { onClose: () => { zone.reset(); current = null; } });
}

export function closeProductSheet() { closePanel(sheet); }
