// Maison des Cartes — serveur HTTP (Node ≥ 22.13, aucune dépendance npm).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config } from './config.js';
import { loadCatalog, publicProduct, imageReport, allowedValues } from './lib/catalog.js';
import { createOrder, captureOrder, cancelOrder, failOrder, getOrderForCustomer, listOrders, getOrderByReference, handleWebhookEvent, OrderError, STATUS } from './lib/orders.js';
import { stockSummary, attachManualCodes, deliveredCodes, sendEmail, confirmationEmail } from './lib/delivery.js';
import { verifyWebhook } from './lib/paypal.js';
import { db } from './lib/db.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const SPA_ROUTES = [/^\/$/, /^\/boutique\/?$/, /^\/catalogue(\/[\w-]+)?\/?$/, /^\/panier\/?$/, /^\/commande\/[\w-]+\/?$/, /^\/aide\/?$/, /^\/conditions\/?$/, /^\/mentions-legales\/?$/];

// --- Page principale : hachage CSP des scripts en ligne (import map) calculé au démarrage ---
let indexHtml = '';
let inlineHashes = [];
function loadIndex() {
  indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  inlineHashes = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
}
loadIndex();

function securityHeaders(res) {
  const pp = 'https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' ${inlineHashes.join(' ')} ${pp}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${pp}`,
    `connect-src 'self' ${pp}`,
    `frame-src ${pp}`,
    "worker-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com")');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new OrderError('Requête trop volumineuse', 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new OrderError('JSON invalide'); }
}

// --- Limitation de débit simple (mémoire) ---
const buckets = new Map();
function rateLimited(ip, key, max, windowMs) {
  const k = `${key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(k) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++;
  buckets.set(k, b);
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60_000).unref();

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function isAdmin(req) {
  const h = req.headers.authorization || '';
  if (!config.adminToken || !h.startsWith('Bearer ')) return false;
  const a = Buffer.from(h.slice(7));
  const b = Buffer.from(config.adminToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function catalogPayload() {
  const c = loadCatalog();
  const stock = config.deliveryMode === 'inventory' ? stockSummary() : null;
  const products = c.products.filter((p) => p.published).map((p) => {
    let pub = publicProduct(p, c.selector, null);
    if (stock) {
      const s = stock[p.id] || {};
      const values = allowedValues(p, c.selector).filter((v) => s[v] > 0);
      pub = { ...pub, amounts: { type: 'fixed', values }, inStock: values.length > 0 };
    } else pub.inStock = true;
    return pub;
  });
  return { currency: c.currency, selector: c.selector, categories: c.categories, products };
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress || 'unknown';
  const m = req.method;
  const p = url.pathname;

  if (m === 'GET' && p === '/api/config') {
    return json(res, 200, {
      storeName: config.storeName,
      production: config.isProd,
      currency: config.currency,
      paypal: { enabled: config.paypal.enabled, clientId: config.paypal.clientId || null, env: config.paypal.env },
      deliveryMode: config.deliveryMode,
      devPreview: config.allowMissingImages,
    });
  }
  if (m === 'GET' && p === '/api/products') return json(res, 200, catalogPayload());

  if (m === 'POST' && p.startsWith('/api/') && !sameOrigin(req) && p !== '/api/paypal/webhook') throw new OrderError('Origine refusée', 403);

  if (m === 'POST' && p === '/api/orders') {
    if (rateLimited(ip, 'create', 20, 60_000)) throw new OrderError('Trop de tentatives, réessayez dans une minute.', 429);
    const body = await readJson(req);
    const r = await createOrder(body.items, body.origin);
    return json(res, 201, { id: r.paypalOrderId, reference: r.reference, accessToken: r.accessToken, total: r.totalCents / 100 });
  }
  let mm;
  if (m === 'POST' && (mm = p.match(/^\/api\/orders\/([\w-]+)\/capture$/))) {
    if (rateLimited(ip, 'capture', 30, 60_000)) throw new OrderError('Trop de tentatives', 429);
    return json(res, 200, await captureOrder(mm[1]));
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/orders\/([\w-]+)\/cancel$/))) return json(res, 200, cancelOrder(mm[1]));
  if (m === 'POST' && (mm = p.match(/^\/api\/orders\/([\w-]+)\/error$/))) {
    const body = await readJson(req).catch(() => ({}));
    failOrder(mm[1], body.message);
    return json(res, 200, { status: STATUS.ERROR });
  }
  if (m === 'GET' && (mm = p.match(/^\/api\/orders\/(MDC-[\w-]+)$/))) {
    if (rateLimited(ip, 'lookup', 60, 60_000)) throw new OrderError('Trop de tentatives', 429);
    return json(res, 200, getOrderForCustomer(mm[1], req.headers['x-order-token']));
  }

  if (m === 'POST' && p === '/api/paypal/webhook') {
    const body = await readJson(req, 256 * 1024);
    const ok = await verifyWebhook(req.headers, body).catch(() => false);
    if (!ok) return json(res, 400, { error: 'Signature de webhook invalide' });
    await handleWebhookEvent(body);
    return json(res, 200, { received: true });
  }

  // --- Administration (jeton ADMIN_TOKEN) ---
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return json(res, 401, { error: 'Non autorisé' });
    if (m === 'GET' && p === '/api/admin/orders') return json(res, 200, listOrders());
    if (m === 'GET' && p === '/api/admin/report') {
      return json(res, 200, { deliveryMode: config.deliveryMode, paypal: { env: config.paypal.env, configured: config.paypal.enabled }, images: imageReport(), stock: stockSummary() });
    }
    if (m === 'POST' && (mm = p.match(/^\/api\/admin\/orders\/(MDC-[\w-]+)\/codes$/))) {
      const order = getOrderByReference(mm[1]);
      if (!order) return json(res, 404, { error: 'Commande introuvable' });
      if (order.status !== STATUS.CONFIRMED) return json(res, 409, { error: 'Paiement non confirmé : aucun code ne peut être délivré.' });
      const body = await readJson(req);
      const status = attachManualCodes(order, body.codes || []);
      db.prepare('UPDATE orders SET delivery_status=? WHERE id=?').run(status, order.id);
      const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
      const mail = confirmationEmail(order, items, deliveredCodes(order.id), `${config.publicUrl}/commande/${order.reference}`);
      const sent = order.payer_email ? await sendEmail({ to: order.payer_email, ...mail }) : { sent: false };
      return json(res, 200, { deliveryStatus: status, emailSent: sent.sent });
    }
  }
  return json(res, 404, { error: 'Introuvable' });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (SPA_ROUTES.some((r) => r.test(pathname))) {
    if (!config.isProd) loadIndex();
    securityHeaders(res);
    return send(res, 200, indexHtml, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep) || path.basename(file).startsWith('.') || file.endsWith('rights.json')) return send(res, 404, 'Introuvable');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Introuvable', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) return send(res, 304, '');
    const immutable = /\/(vendor|textures)\//.test(pathname) || url.searchParams.has('v');
    securityHeaders(res);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      ETag: etag,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : (config.isProd ? 'public, max-age=3600' : 'no-cache'),
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      securityHeaders(res);
      return await api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof OrderError) return json(res, e.status, { error: e.message, code: e.code });
    console.error('[erreur]', e);
    return json(res, 500, { error: 'Erreur interne' });
  }
});

server.listen(config.port, config.host, () => {
  const c = loadCatalog(true);
  const missing = c.products.filter((p) => p.imageStatus !== 'ok');
  console.log(`\n  Maison des Cartes — ${config.publicUrl}`);
  console.log(`  PayPal : ${config.paypal.enabled ? `configuré (${config.paypal.env})` : 'NON configuré — renseignez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET'}`);
  console.log(`  Livraison : mode ${config.deliveryMode}${config.deliveryMode === 'inventory' && !config.codesKey ? ' — CODES_ENCRYPTION_KEY manquante' : ''}`);
  if (missing.length) {
    console.log(`  Visuels : ${missing.length}/${c.products.length} produit(s) sans visuel authentique ou sans déclaration de droits${config.allowMissingImages ? ' (aperçu de développement activé)' : ' → non publiés'} :`);
    for (const p of missing) console.log(`    · ${p.id.padEnd(26)} ${p.imageStatus === 'missing' ? `image attendue : public/images/cards/${p.image}.webp` : 'droits à déclarer dans public/images/cards/rights.json'}`);
  }
  console.log('');
});
