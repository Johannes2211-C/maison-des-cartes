// Maison des Cartes — application (routage, catalogue, boutique 3D, panier, paiement).
import { api } from './core/api.js';
import { cart } from './core/cart.js';
import { h, toast, priceRange } from './core/format.js';
import { openProductSheet, closeProductSheet } from './ui/product-sheet.js';
import { initCart, openCart } from './ui/cart-drawer.js';
import { renderCatalog, renderOrder, renderPage } from './ui/views.js';
import { onPanelsChange, anyOpen } from './ui/panels.js';

const $ = (id) => document.getElementById(id);
const views = { store: $('view-store'), catalog: $('view-catalog'), order: $('view-order'), page: $('view-page') };
const state = { cfg: null, catalog: null, store: null, storeLoading: null, view: null };

// ---------------- Données ----------------
async function boot() {
  const [cfg, data] = await Promise.all([api('/api/config'), api('/api/products')]);
  state.cfg = cfg;
  state.catalog = { ...data, byId: new Map(data.products.map((p) => [p.id, p])) };
  cart.reconcile(state.catalog);
  initCart({ cfg, catalog: state.catalog, onOrderComplete });
  buildCategoryMenu();
  route();
}

function onOrderComplete(summary, token, origin) {
  if (token) { try { sessionStorage.setItem(`mdc-order-${summary.reference}`, token); } catch { /* ignore */ } }
  navigate(`/commande/${summary.reference}#t=${token || ''}`);
  if (summary.status === 'PAIEMENT_CONFIRME') toast('Paiement confirmé. Merci pour votre commande.');
}

function openProduct(product) {
  openProductSheet(product, { catalog: state.catalog, cfg: state.cfg, onOrderComplete, openCart });
}

// ---------------- Navigation ----------------
export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  route();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  closeMenu();
  if (anyOpen()) { closeProductSheet(); }
  navigate(a.getAttribute('href'));
});
addEventListener('popstate', route);

function show(name) {
  state.view = name;
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  document.body.classList.toggle('view-store', name === 'store');
  $('site-footer').hidden = name === 'store';
  for (const a of document.querySelectorAll('[data-nav]')) {
    const current = (a.dataset.nav === 'store' && name === 'store') || (a.dataset.nav === 'catalog' && name === 'catalog');
    if (current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (name !== 'store') state.store?.pause();
  else state.store?.resume();
  if (name !== 'store') window.scrollTo(0, 0);
}

function route() {
  if (!state.catalog) return;
  const { pathname, searchParams, hash } = new URL(location.href);
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const [root, arg] = parts;
  if (!root || root === 'boutique') {
    show('store');
    openStore(root === 'boutique');
    document.title = 'Maison des Cartes — la boutique';
  } else if (root === 'catalogue' || root === 'panier') {
    show('catalog');
    const q = searchParams.get('q') || '';
    $('search-input').value = q;
    renderCatalog({ catalog: state.catalog, category: arg, query: q, onOpen: openProduct });
    document.title = 'Catalogue — Maison des Cartes';
    if (root === 'panier') openCart();
  } else if (root === 'commande' && arg) {
    show('order');
    let token = new URLSearchParams(hash.slice(1)).get('t');
    try { token ||= sessionStorage.getItem(`mdc-order-${arg}`); } catch { /* ignore */ }
    renderOrder(arg, token);
    document.title = `Commande ${arg} — Maison des Cartes`;
  } else {
    show('page');
    renderPage(root);
    document.title = 'Maison des Cartes';
  }
}

// ---------------- Boutique 3D ----------------
async function openStore(inside) {
  const stage = $('store-stage');
  if (state.store) {
    if (inside && state.store.mode === 'facade') state.store.enter();
    if (!inside && state.store.mode !== 'facade') state.store.toFacade();
    return;
  }
  if (state.storeLoading) { await state.storeLoading; return openStore(inside); }
  const loader = $('store-loader');
  const bar = $('store-loader-bar');
  const text = $('store-loader-text');
  state.storeLoading = (async () => {
    const mod = await import('./store/scene.js');
    if (!mod.webglAvailable()) throw Object.assign(new Error('WebGL indisponible'), { code: 'NO_WEBGL' });
    const tooltip = $('store-tooltip');
    const store = new mod.Store({
      container: stage,
      catalog: state.catalog,
      onProduct: (p) => openProduct(p),
      onProgress: (f, label) => { bar.style.width = `${Math.round(f * 100)}%`; if (label) text.textContent = label; },
      onHover: (info) => {
        if (!info) { tooltip.hidden = true; return; }
        tooltip.replaceChildren(info.product.name, h('small', { text: priceRange(info.product) }));
        tooltip.style.left = `${info.x}px`;
        tooltip.style.top = `${info.y}px`;
        tooltip.hidden = false;
      },
    });
    await store.init();
    state.store = store;
    if (!state.cfg.production) window.__mdc = state; // aide au test en développement
    loader.classList.add('is-done');
    buildAisleJump(store);
    watchPerformance(store);
    if (state.view !== 'store') store.pause();
  })();
  try {
    await state.storeLoading;
    if (inside) state.store.enter();
  } catch (e) {
    console.error(e);
    state.storeLoading = null;
    navigate('/catalogue', { replace: true });
    toast(e.code === 'NO_WEBGL'
      ? 'Votre appareil ne permet pas d’afficher la boutique en 3D : voici le catalogue.'
      : 'La boutique 3D n’a pas pu se charger : voici le catalogue.');
  }
}

$('enter-store').addEventListener('click', () => {
  if (!state.store) return;
  history.pushState({}, '', '/boutique');
  stageClass('is-entering', true);
  state.store.enter();
  setTimeout(() => stageClass('is-entering', false), 3400);
});
const stageClass = (c, on) => $('store-stage').classList.toggle(c, on);

function buildAisleJump(store) {
  const el = $('aisle-jump');
  const list = [...state.catalog.categories.map((c) => [c.id, c.name]), ['accueil', 'Accueil']];
  el.replaceChildren(...list.map(([id, name]) => h('button', { type: 'button', text: name, onclick: () => store.goToAisle(id) })));
}

// Bascule proposée vers le catalogue si l'appareil peine à afficher la 3D.
function watchPerformance(store) {
  let frames = 0, t0 = performance.now(), warned = false;
  const tick = () => {
    if (warned) return;
    if (state.view === 'store' && store.mode === 'inside' && !document.hidden) {
      frames++;
      const dt = performance.now() - t0;
      if (dt > 5000) {
        const fps = (frames / dt) * 1000;
        if (fps < 16 && store.controls.velocity.length() > 0.05) {
          warned = true;
          toast('La boutique 3D semble lente sur cet appareil.', { label: 'Passer au catalogue', run: () => navigate('/catalogue') });
        }
        frames = 0; t0 = performance.now();
      }
    } else { frames = 0; t0 = performance.now(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Pendant qu'un panneau est ouvert, la visite est suspendue (pas de déplacement au clavier).
onPanelsChange((open) => {
  if (!state.store) return;
  state.store.controls.enabled = !open && state.store.mode === 'inside';
  if (open) state.store.controls.keys.clear();
  state.store.dirty = true;
});

// ---------------- En-tête : catégories, recherche ----------------
const menuBtn = document.querySelector('.nav-menu__toggle');
const menu = $('cat-menu');
function buildCategoryMenu() {
  menu.replaceChildren(...state.catalog.categories.map((c) => {
    const n = state.catalog.products.filter((p) => p.category === c.id).length;
    return h('a', { href: `/catalogue/${c.id}`, 'data-link': true }, c.name, h('span', { text: `${n} carte${n > 1 ? 's' : ''}` }));
  }));
}
function closeMenu() { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = menu.hidden;
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.nav-menu')) closeMenu(); });

let searchT;
const searchInput = $('search-input');
function runSearch(replace) {
  const q = searchInput.value.trim();
  const url = `/catalogue${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  if (state.view === 'catalog' && replace) {
    history.replaceState({}, '', url);
    renderCatalog({ catalog: state.catalog, category: null, query: q, onOpen: openProduct });
    document.getElementById('catalog-status').textContent ||= '';
  } else navigate(url);
}
searchInput.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { if (state.view === 'catalog') runSearch(true); }, 220); });
$('search-form').addEventListener('submit', (e) => { e.preventDefault(); searchInput.blur(); runSearch(state.view === 'catalog'); });

boot().catch((e) => {
  console.error(e);
  document.getElementById('main').prepend(h('p', { class: 'empty', style: 'padding-top:120px', text: 'Le service est momentanément indisponible. Réessayez dans quelques instants.' }));
});
