// Catalogue : chargement des produits, contrôle des visuels et des droits, validation des montants.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../config.js';

const CARDS_DIR = path.join(ROOT, 'public', 'images', 'cards');
const EXT = ['webp', 'avif', 'jpg', 'jpeg', 'png'];

let cache = null;
let cacheTime = 0;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function findImage(slug) {
  for (const ext of EXT) {
    const f = path.join(CARDS_DIR, `${slug}.${ext}`);
    if (fs.existsSync(f)) return { file: f, url: `/images/cards/${slug}.${ext}?v=${Math.floor(fs.statSync(f).mtimeMs)}` };
  }
  return null;
}

export function loadCatalog(force = false) {
  if (cache && !force && Date.now() - cacheTime < 10_000) return cache;
  const data = readJson(path.join(ROOT, 'data', 'products.json'), null);
  if (!data) throw new Error('data/products.json illisible');
  const rights = readJson(path.join(CARDS_DIR, 'rights.json'), {});
  const products = data.products.map((p) => {
    const img = findImage(p.image || p.id);
    const r = rights[p.id];
    const rightsOk = Boolean(r && r.source && r.license);
    let imageStatus = 'ok';
    if (!img) imageStatus = 'missing';
    else if (!rightsOk) imageStatus = 'rights-missing';
    const published = imageStatus === 'ok' || config.allowMissingImages;
    return { ...p, imageUrl: img ? img.url : null, imageStatus, published };
  });
  cache = { ...data, products, byId: new Map(products.map((p) => [p.id, p])) };
  cacheTime = Date.now();
  return cache;
}

/** Valeurs autorisées (en euros entiers) pour un produit, bornées par le sélecteur 20–100 €. */
export function allowedValues(product, selector) {
  const { min, max } = selector;
  if (product.amounts.type === 'fixed') return product.amounts.values.filter((v) => v >= min && v <= max);
  const lo = Math.max(min, product.amounts.min);
  const hi = Math.min(max, product.amounts.max);
  const step = product.amounts.step || 1;
  const out = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

export function isValidAmount(product, euros, selector) {
  if (!Number.isInteger(euros)) return false;
  const a = product.amounts;
  if (euros < selector.min || euros > selector.max) return false;
  if (a.type === 'fixed') return a.values.includes(euros);
  return euros >= a.min && euros <= a.max && (euros - a.min) % (a.step || 1) === 0;
}

/** Prix de vente = valeur faciale (aucun frais ajouté). Point unique à modifier pour une politique tarifaire. */
export function unitPriceCents(product, euros) {
  return euros * 100;
}

export function publicProduct(p, selector, stock) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description,
    region: p.region,
    terms: p.terms,
    amounts: p.amounts.type === 'fixed'
      ? { type: 'fixed', values: allowedValues(p, selector) }
      : { type: 'variable', min: Math.max(selector.min, p.amounts.min), max: Math.min(selector.max, p.amounts.max), step: p.amounts.step || 1 },
    inStock: stock ? stock : null,
    image: p.imageUrl,
    placeholder: p.imageStatus !== 'ok',
  };
}

export function imageReport() {
  const c = loadCatalog(true);
  return c.products.map((p) => ({ id: p.id, name: p.name, imageStatus: p.imageStatus, expectedFile: `public/images/cards/${p.image || p.id}.webp`, toConfirm: Boolean(p.toConfirm) }));
}
