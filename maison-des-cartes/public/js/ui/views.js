// Vues classiques : catalogue filtrable, suivi de commande, pages d'information.
import { h, money, moneyShort, priceRange, toast } from '../core/format.js';
import { api } from '../core/api.js';
import { cardVisual } from './placeholder.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function renderCatalog({ catalog, category, query, onOpen }) {
  const filters = document.getElementById('filters');
  const body = document.getElementById('catalog-body');
  const status = document.getElementById('catalog-status');
  const title = document.getElementById('catalog-title');
  const cat = catalog.categories.find((c) => c.id === category);
  title.textContent = cat ? cat.name : 'Catalogue';
  document.querySelector('.catalog-head__lead').textContent = cat ? `${cat.tagline}. Choisissez votre carte, puis son montant.` : 'Choisissez votre carte, puis le montant qui vous convient.';

  filters.replaceChildren(
    h('a', { href: '/catalogue', 'data-link': true, role: 'tab', 'aria-selected': String(!cat), text: 'Toutes les cartes' }),
    ...catalog.categories.map((c) => h('a', { href: `/catalogue/${c.id}`, 'data-link': true, role: 'tab', 'aria-selected': String(cat?.id === c.id), text: c.name })),
  );

  const q = norm(query || '');
  const match = (p) => !q || norm(`${p.name} ${p.brand} ${p.description} ${catalog.categories.find((c) => c.id === p.category)?.name}`).includes(q);
  const cats = cat ? [cat] : catalog.categories;
  const sections = [];
  let total = 0;
  for (const c of cats) {
    const items = catalog.products.filter((p) => p.category === c.id && match(p));
    if (!items.length) continue;
    total += items.length;
    sections.push(h('section', { class: 'aisle', 'aria-labelledby': `aisle-${c.id}` },
      h('header', { class: 'aisle__head', hidden: Boolean(cat) },
        h('h2', { id: `aisle-${c.id}`, text: c.name }),
        h('p', { text: c.tagline }),
        h('span', { class: 'aisle__n', text: `Rayon ${c.aisle}` })),
      h('div', { class: 'grid' }, items.map((p) => h('button', { type: 'button', class: 'product-tile', onclick: () => onOpen(p), 'aria-label': `${p.name}, ${priceRange(p)}` },
        h('div', { class: 'product-tile__display' }, cardVisual(p, { alt: false })),
        h('span', { class: 'product-tile__name', text: p.name }),
        h('span', { class: 'product-tile__meta' }, h('span', { text: p.brand }), h('span', { class: 'product-tile__price', text: priceRange(p) })))))));
  }
  status.textContent = q ? `${total} résultat${total > 1 ? 's' : ''} pour « ${query} »` : '';
  if (!sections.length) {
    body.replaceChildren(h('div', { class: 'empty' },
      h('h2', { text: q ? 'Aucune carte ne correspond à votre recherche' : 'Aucune carte disponible pour le moment' }),
      h('p', { text: q ? 'Essayez un autre nom de marque, ou parcourez toutes les catégories.' : 'Revenez bientôt : de nouvelles cartes arrivent en rayon.' }),
      q ? h('a', { class: 'btn btn--secondary', href: '/catalogue', 'data-link': true, text: 'Voir toutes les cartes' }) : null));
  } else body.replaceChildren(...sections);
}

export async function renderOrder(reference, token) {
  const view = document.getElementById('view-order');
  view.replaceChildren(h('div', { class: 'order' }, h('p', { text: 'Chargement de votre commande…' })));
  if (!token) {
    view.replaceChildren(h('div', { class: 'order' },
      h('h1', { text: 'Suivi de commande' }),
      h('p', { text: 'Pour des raisons de sécurité, ouvrez cette page depuis le lien reçu dans votre e-mail de confirmation.' })));
    return;
  }
  let o;
  try {
    o = await api(`/api/orders/${encodeURIComponent(reference)}`, { headers: { 'X-Order-Token': token } });
  } catch (e) {
    view.replaceChildren(h('div', { class: 'order' }, h('h1', { text: 'Commande introuvable' }), h('p', { text: e.message })));
    return;
  }
  const confirmed = o.status === 'PAIEMENT_CONFIRME';
  const headline = {
    PAIEMENT_CONFIRME: 'Merci, votre paiement est confirmé',
    EN_ATTENTE: 'Votre paiement est en cours de vérification',
    PAIEMENT_REFUSE: 'Votre paiement a été refusé',
    PAIEMENT_ANNULE: 'Votre paiement a été annulé',
    ERREUR_TECHNIQUE: 'Une erreur technique est survenue',
  }[o.status] || 'Votre commande';
  const copy = (code) => navigator.clipboard?.writeText(code).then(() => toast('Code copié'), () => toast('Copie impossible : sélectionnez le code manuellement'));

  view.replaceChildren(h('div', { class: 'order' },
    h('h1', { text: headline }),
    h('p', { class: 'order__ref' }, `Commande ${o.reference} — `, h('span', { class: `status-pill status-pill--${o.status}`, text: o.statusLabel })),
    h('div', { class: 'order__block' },
      h('h2', { text: 'Récapitulatif' }),
      h('table', {}, h('tbody', {},
        o.items.map((i) => h('tr', {}, h('td', { text: `${i.name} — ${moneyShort(i.amount)}` }), h('td', { text: `× ${i.quantity}` }), h('td', { text: money(i.lineTotal) }))),
        h('tr', {}, h('td', {}, h('strong', { text: 'Total payé' })), h('td'), h('td', {}, h('strong', { text: money(o.total) })))))),
    confirmed ? h('div', { class: 'order__block' },
      h('h2', { text: 'Vos codes' }),
      o.codes.length
        ? o.codes.map((c) => h('div', { class: 'code' }, h('span', { text: `${c.product} — ${moneyShort(c.value)}` }), h('code', { text: c.code }), h('button', { type: 'button', class: 'link-btn', text: 'Copier', onclick: () => copy(c.code) })))
        : h('p', { text: `${o.deliveryLabel}. Vos codes vous seront envoyés par e-mail à l’adresse de votre compte PayPal dès leur remise.` })) : null,
    o.status === 'EN_ATTENTE' ? h('p', { text: 'PayPal vérifie encore ce paiement. Vous recevrez un e-mail dès sa confirmation ; aucun code n’est délivré avant.' }) : null,
    h('p', {}, h('a', { class: 'btn btn--secondary', href: '/catalogue', 'data-link': true, text: 'Continuer mes achats' }))));
}

const PAGES = {
  aide: () => [
    h('h1', { text: 'Comment ça marche' }),
    h('h2', { text: 'Choisir sa carte' }),
    h('p', { text: 'Entrez dans la boutique et approchez-vous d’une vitrine, ou parcourez le catalogue. Chaque fiche indique la région de validité et les conditions d’utilisation de la carte.' }),
    h('h2', { text: 'Choisir le montant' }),
    h('p', { text: 'Réglez le montant avec le curseur, saisissez-le directement ou touchez une valeur rapide. Pour les cartes à valeurs fixes, seules les valeurs commercialisées par l’émetteur sont proposées.' }),
    h('h2', { text: 'Payer' }),
    h('p', { text: 'Achetez une carte directement depuis sa fiche, ou réunissez plusieurs cartes dans le panier et payez-les en une seule fois. Le paiement est traité par PayPal ; nous ne voyons jamais vos données bancaires.' }),
    h('h2', { text: 'Recevoir ses codes' }),
    h('p', { text: 'Vos codes sont délivrés uniquement après la confirmation du paiement, sur la page de votre commande et par e-mail.' }),
  ],
  conditions: () => [
    h('h1', { text: 'Conditions générales de vente' }),
    h('p', {}, 'Ce document doit être complété par l’exploitant avant la mise en ligne. Éléments obligatoires : identité du vendeur ', h('span', { class: 'todo', text: '[raison sociale, adresse, SIREN]' }), ', prix et modalités de paiement, livraison numérique, absence de droit de rétractation pour les contenus numériques fournis immédiatement avec l’accord du client (art. L221-28 du Code de la consommation), service client et médiation.'),
    h('h2', { text: 'Prix' }),
    h('p', { text: 'Les prix sont indiqués en euros toutes taxes comprises. Le montant facturé est celui de la valeur faciale de la carte choisie.' }),
    h('h2', { text: 'Paiement' }),
    h('p', { text: 'Le paiement s’effectue via PayPal. La commande est validée à la confirmation du paiement par PayPal.' }),
    h('h2', { text: 'Livraison' }),
    h('p', { text: 'Les codes sont transmis par voie électronique après confirmation du paiement et vérification de leur disponibilité.' }),
  ],
  'mentions-legales': () => [
    h('h1', { text: 'Mentions légales' }),
    h('p', {}, 'À compléter par l’exploitant : ', h('span', { class: 'todo', text: '[éditeur, adresse, directeur de la publication, hébergeur, contact]' }), '.'),
    h('p', { text: 'Les marques, logos et visuels de cartes cadeaux reproduits sur ce site appartiennent à leurs propriétaires respectifs et sont utilisés dans le cadre des accords de distribution correspondants.' }),
  ],
};

export function renderPage(name) {
  const view = document.getElementById('view-page');
  view.replaceChildren(h('article', { class: 'prose' }, ...(PAGES[name] || PAGES.aide)()));
}
