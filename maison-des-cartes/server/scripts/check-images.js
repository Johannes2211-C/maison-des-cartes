// Vérifie, pour chaque produit, la présence du visuel authentique et de sa déclaration de droits.
// Usage : npm run check:images
import { imageReport } from '../lib/catalog.js';

const report = imageReport();
const label = { ok: 'OK', missing: 'VISUEL MANQUANT', 'rights-missing': 'DROITS NON DÉCLARÉS' };
let bad = 0;
for (const r of report) {
  if (r.imageStatus !== 'ok') bad++;
  console.log(`${label[r.imageStatus].padEnd(20)} ${r.id.padEnd(26)} ${r.imageStatus === 'missing' ? r.expectedFile : ''}${r.toConfirm ? '  (montants à confirmer avec le distributeur)' : ''}`);
}
console.log(`\n${report.length - bad}/${report.length} produit(s) publiables en production.`);
process.exit(bad ? 2 : 0);
