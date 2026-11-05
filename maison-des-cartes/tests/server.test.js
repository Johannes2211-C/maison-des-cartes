// Tests d'intégration du serveur : calcul des prix, création/capture PayPal, statuts, livraison sécurisée.
// L'API PayPal est simulée localement (aucun paiement réel) pour vérifier la logique du serveur ;
// le parcours de bout en bout se teste ensuite en Sandbox PayPal avec vos identifiants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-test-'));
let mock, app, base, mode = 'ok';
const created = [];

function startMock() {
  const orders = new Map();
  return new Promise((resolve) => {
    mock = http.createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/v1/oauth2/token') return send(200, { access_token: 'tok', expires_in: 3600 });
      if (req.url === '/v2/checkout/orders' && req.method === 'POST') {
        const o = JSON.parse(body);
        const id = 'PP' + crypto.randomBytes(5).toString('hex').toUpperCase();
        orders.set(id, o);
        created.push(o);
        return send(201, { id, status: 'CREATED' });
      }
      const m = req.url.match(/^\/v2\/checkout\/orders\/(\w+)\/capture$/);
      if (m) {
        const o = orders.get(m[1]);
        if (mode === 'declined') return send(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] });
        const pu = o.purchase_units[0];
        const value = mode === 'tampered' ? '1.00' : pu.amount.value;
        return send(201, {
          id: m[1], status: 'COMPLETED',
          payer: { email_address: 'client@example.com', name: { given_name: 'Test', surname: 'Client' } },
          purchase_units: [{ reference_id: pu.reference_id, payments: { captures: [{ id: 'CAP' + m[1], status: 'COMPLETED', custom_id: pu.custom_id, amount: { currency_code: 'EUR', value } }] } }],
        });
      }
      send(404, { name: 'NOT_FOUND' });
    }).listen(0, '127.0.0.1', () => resolve(mock.address().port));
  });
}

const env = (extra) => ({
  ...process.env, NODE_ENV: 'test', PORT: '0', DB_FILE: path.join(tmp, 'test.sqlite'),
  PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', DELIVERY_MODE: 'inventory',
  CODES_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), ADMIN_TOKEN: 'admin-test', ...extra,
});

before(async () => {
  const mockPort = await startMock();
  const port = 3900 + Math.floor(Math.random() * 90);
  const e = env({ PAYPAL_API_BASE: `http://127.0.0.1:${mockPort}`, PORT: String(port) });
  // Codes de test (fictifs) importés dans le stock chiffré
  fs.writeFileSync(path.join(tmp, 'codes.csv'), 'product_id,value_eur,code\nsteam,50,TEST-STEAM-0001\nsteam,50,TEST-STEAM-0002\nplaystation,20,TEST-PSN-0001\nsteam,21,INVALIDE\n');
  process.env.TEST_ENV = JSON.stringify(e);
  execFileSync(process.execPath, ['--no-warnings', 'server/scripts/import-codes.js', path.join(tmp, 'codes.csv')], { cwd: ROOT, env: e, stdio: 'pipe' });
  app = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env: e, stdio: 'pipe' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/api/config'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('serveur non démarré');
});
after(() => { app?.kill(); mock?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

test('le catalogue expose uniquement les montants en stock (mode inventaire)', async () => {
  const r = await (await fetch(base + '/api/products')).json();
  const steam = r.products.find((p) => p.id === 'steam');
  assert.deepEqual(steam.amounts.values, [50]);
  assert.equal(r.products.find((p) => p.id === 'xbox').inStock, false);
});

test('un montant non commercialisé est refusé par le serveur', async () => {
  const r = await post('/api/orders', { items: [{ productId: 'steam', amount: 21, quantity: 1 }] });
  assert.equal(r.status, 400);
});

test('un prix envoyé par le navigateur est ignoré : le serveur recalcule', async () => {
  const r = await post('/api/orders', { items: [{ productId: 'steam', amount: 50, quantity: 1, price: 0.01 }] });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.total, 50);
  const sent = created.at(-1);
  assert.equal(sent.purchase_units[0].amount.value, '50.00');
  assert.equal(sent.purchase_units[0].items[0].category, 'DIGITAL_GOODS');
  // annulation → codes libérés
  const c = await post(`/api/orders/${j.id}/cancel`);
  assert.equal((await c.json()).status, 'PAIEMENT_ANNULE');
});

test('rupture de stock détectée avant le paiement', async () => {
  const r = await post('/api/orders', { items: [{ productId: 'steam', amount: 50, quantity: 3 }] });
  assert.equal(r.status, 409);
});

test('paiement capturé → commande confirmée, codes délivrés uniquement avec le jeton', async () => {
  mode = 'ok';
  const r = await (await post('/api/orders', { items: [{ productId: 'steam', amount: 50, quantity: 2 }, { productId: 'playstation', amount: 20, quantity: 1 }] })).json();
  assert.equal(r.total, 120);
  const cap = await (await post(`/api/orders/${r.id}/capture`)).json();
  assert.equal(cap.status, 'PAIEMENT_CONFIRME');
  assert.equal(cap.deliveryStatus, 'LIVREE');
  assert.equal(cap.codes.length, 0, 'aucun code dans la réponse de capture');
  const no = await fetch(`${base}/api/orders/${r.reference}`);
  assert.equal(no.status, 404);
  const ok = await (await fetch(`${base}/api/orders/${r.reference}`, { headers: { 'X-Order-Token': r.accessToken } })).json();
  assert.equal(ok.codes.length, 3);
  assert.deepEqual(ok.codes.map((c) => c.code).sort(), ['TEST-PSN-0001', 'TEST-STEAM-0001', 'TEST-STEAM-0002']);
  // double capture : idempotent
  const again = await (await post(`/api/orders/${r.id}/capture`)).json();
  assert.equal(again.status, 'PAIEMENT_CONFIRME');
});

test('montant capturé incohérent → erreur technique, aucun code délivré', async () => {
  const e = JSON.parse(process.env.TEST_ENV);
  fs.writeFileSync(path.join(tmp, 'c2.csv'), 'product_id,value_eur,code\nnetflix,25,TEST-NFX-0001\n');
  execFileSync(process.execPath, ['--no-warnings', 'server/scripts/import-codes.js', path.join(tmp, 'c2.csv')], { cwd: ROOT, env: e, stdio: 'pipe' });
  mode = 'tampered';
  const r = await (await post('/api/orders', { items: [{ productId: 'netflix', amount: 25, quantity: 1 }] })).json();
  const cap = await (await post(`/api/orders/${r.id}/capture`)).json();
  assert.equal(cap.status, 'ERREUR_TECHNIQUE');
  const o = await (await fetch(`${base}/api/orders/${r.reference}`, { headers: { 'X-Order-Token': r.accessToken } })).json();
  assert.equal(o.codes.length, 0);
});

test('moyen de paiement refusé → 422 INSTRUMENT_DECLINED (le client peut réessayer)', async () => {
  mode = 'declined';
  fs.writeFileSync(path.join(tmp, 'c3.csv'), 'product_id,value_eur,code\nnetflix,50,TEST-NFX-0002\n');
  execFileSync(process.execPath, ['--no-warnings', 'server/scripts/import-codes.js', path.join(tmp, 'c3.csv')], { cwd: ROOT, env: JSON.parse(process.env.TEST_ENV), stdio: 'pipe' });
  const r = await (await post('/api/orders', { items: [{ productId: 'netflix', amount: 50, quantity: 1 }] })).json();
  const cap = await post(`/api/orders/${r.id}/capture`);
  assert.equal(cap.status, 422);
  assert.equal((await cap.json()).code, 'INSTRUMENT_DECLINED');
  mode = 'ok';
});

test('administration protégée et secret PayPal jamais exposé', async () => {
  assert.equal((await fetch(`${base}/api/admin/orders`)).status, 401);
  const list = await (await fetch(`${base}/api/admin/orders`, { headers: { Authorization: 'Bearer admin-test' } })).json();
  assert.ok(list.length >= 3);
  const cfg = await (await fetch(`${base}/api/config`)).text();
  assert.ok(!cfg.includes('test-secret'));
  const html = await (await fetch(base + '/')).text();
  assert.ok(!html.includes('test-secret'));
});

test('requête cross-origin refusée sur la création de commande', async () => {
  const r = await post('/api/orders', { items: [{ productId: 'steam', amount: 50, quantity: 1 }] }, { Origin: 'https://site-malveillant.example' });
  assert.equal(r.status, 403);
});
