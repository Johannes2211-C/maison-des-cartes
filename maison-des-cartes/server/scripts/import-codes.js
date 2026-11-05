// Import des codes cadeaux fournis par votre distributeur agréé (mode DELIVERY_MODE=inventory).
// Usage : node server/scripts/import-codes.js fichier.csv
// Format CSV (en-tête obligatoire) : product_id,value_eur,code
// Les codes sont chiffrés (AES-256-GCM) avant stockage ; le fichier source doit ensuite être supprimé de façon sûre.
import fs from 'node:fs';
import { loadCatalog, isValidAmount } from '../lib/catalog.js';
import { importCodes, stockSummary } from '../lib/delivery.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage : node server/scripts/import-codes.js codes.csv   (colonnes : product_id,value_eur,code)');
  process.exit(1);
}
const catalog = loadCatalog(true);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const header = lines.shift().split(',').map((h) => h.trim().toLowerCase());
const idx = { id: header.indexOf('product_id'), value: header.indexOf('value_eur'), code: header.indexOf('code') };
if (Object.values(idx).some((i) => i < 0)) { console.error('En-tête attendu : product_id,value_eur,code'); process.exit(1); }

const rows = [];
let rejected = 0;
lines.forEach((line, n) => {
  const cols = line.split(',');
  const product = catalog.byId.get(cols[idx.id]?.trim());
  const value = Number(cols[idx.value]);
  const code = cols.slice(idx.code).join(',').trim();
  if (!product || !isValidAmount(product, value, catalog.selector) || !code) {
    rejected++;
    console.warn(`Ligne ${n + 2} ignorée (produit, montant ou code invalide)`);
    return;
  }
  rows.push({ productId: product.id, valueCents: value * 100, code });
});
const r = importCodes(rows);
console.log(`${r.added} code(s) importé(s), ${r.duplicates} doublon(s) ignoré(s), ${rejected} ligne(s) rejetée(s).`);
console.log('Stock disponible :', JSON.stringify(stockSummary(), null, 2));
