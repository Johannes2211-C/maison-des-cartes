// Configuration centralisée — lue depuis les variables d'environnement (+ fichier .env optionnel).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|oui)$/i.test(v));
const isProd = env.NODE_ENV === 'production';
const paypalEnv = (env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dbFile: path.resolve(ROOT, env.DB_FILE || 'data/maison-des-cartes.sqlite'),
  storeName: 'Maison des Cartes',
  currency: 'EUR',

  paypal: {
    env: paypalEnv,
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    apiBase: (env.NODE_ENV === 'test' && env.PAYPAL_API_BASE) || (paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
    get enabled() { return Boolean(this.clientId && this.clientSecret); },
  },

  // Visuels : en production, un produit n'est publié que si son image authentique ET la
  // déclaration de droits correspondante (public/images/cards/rights.json) sont présentes.
  allowMissingImages: bool(env.ALLOW_MISSING_IMAGES, !isProd),

  // Livraison : "manual" (commande payée → livraison par l'équipe) ou "inventory" (codes importés, chiffrés).
  deliveryMode: (env.DELIVERY_MODE || 'manual').toLowerCase() === 'inventory' ? 'inventory' : 'manual',
  reservationMinutes: Number(env.RESERVATION_MINUTES || 30),
  codesKey: env.CODES_ENCRYPTION_KEY || '',

  email: {
    provider: (env.EMAIL_PROVIDER || 'none').toLowerCase(), // none | resend | brevo
    apiKey: env.EMAIL_API_KEY || '',
    from: env.EMAIL_FROM || '',
    fromName: env.EMAIL_FROM_NAME || 'Maison des Cartes',
    merchant: env.MERCHANT_EMAIL || '',
  },

  adminToken: env.ADMIN_TOKEN || '',
  maxQuantityPerLine: 10,
  maxOrderCents: Number(env.MAX_ORDER_EUR || 1000) * 100,
};
