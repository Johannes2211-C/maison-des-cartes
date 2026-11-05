// Livraison numérique : stock de codes chiffrés (AES-256-GCM), réservation, remise après paiement, e-mails.
// Aucun code n'est jamais généré ici : les codes proviennent exclusivement de votre distributeur agréé.
import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { config } from '../config.js';

function key() {
  const k = Buffer.from(config.codesKey || '', 'base64');
  if (k.length !== 32) throw new Error('CODES_ENCRYPTION_KEY doit contenir 32 octets encodés en base64 (openssl rand -base64 32)');
  return k;
}

export function encryptCode(code) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const cipher = Buffer.concat([c.update(code, 'utf8'), c.final()]);
  return { cipher: cipher.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

export function decryptCode(row) {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(row.iv, 'base64'));
  d.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(row.cipher, 'base64')), d.final()]).toString('utf8');
}

export function fingerprint(code) {
  return crypto.createHmac('sha256', key()).update(code.trim()).digest('hex');
}

/** Importe des codes fournis par le distributeur. Retourne { added, duplicates }. */
export function importCodes(rows) {
  let added = 0, duplicates = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO gift_codes (product_id, value_cents, cipher, iv, tag, fingerprint) VALUES (?,?,?,?,?,?)');
  tx(() => {
    for (const r of rows) {
      const enc = encryptCode(r.code.trim());
      const res = ins.run(r.productId, r.valueCents, enc.cipher, enc.iv, enc.tag, fingerprint(r.code));
      if (res.changes) added++; else duplicates++;
    }
  });
  return { added, duplicates };
}

export function releaseExpiredReservations() {
  db.prepare(`UPDATE gift_codes SET status='DISPONIBLE', order_item_id=NULL, reserved_until=NULL
              WHERE status='RESERVE' AND reserved_until < datetime('now')`).run();
}

/** Stock disponible par produit : { productId: { valueEuros: count } } */
export function stockSummary() {
  releaseExpiredReservations();
  const out = {};
  for (const r of db.prepare(`SELECT product_id, value_cents, COUNT(*) n FROM gift_codes WHERE status='DISPONIBLE' GROUP BY product_id, value_cents`).all()) {
    (out[r.product_id] ||= {})[r.value_cents / 100] = r.n;
  }
  return out;
}

/** Réserve les codes nécessaires (mode inventaire). Doit être appelé dans une transaction. */
export function reserveCodes(orderItems) {
  const pick = db.prepare(`SELECT id FROM gift_codes WHERE product_id=? AND value_cents=? AND status='DISPONIBLE' ORDER BY id LIMIT ?`);
  const reserve = db.prepare(`UPDATE gift_codes SET status='RESERVE', order_item_id=?, reserved_until=datetime('now', ?) WHERE id=?`);
  for (const it of orderItems) {
    const ids = pick.all(it.productId, it.valueCents, it.quantity);
    if (ids.length < it.quantity) {
      const e = new Error(`Stock insuffisant : ${it.productName} ${it.valueCents / 100} €`);
      e.code = 'OUT_OF_STOCK';
      throw e;
    }
    for (const { id } of ids) reserve.run(it.id, `+${config.reservationMinutes} minutes`, id);
  }
}

export function releaseOrderCodes(orderId) {
  db.prepare(`UPDATE gift_codes SET status='DISPONIBLE', order_item_id=NULL, reserved_until=NULL
              WHERE status='RESERVE' AND order_item_id IN (SELECT id FROM order_items WHERE order_id=?)`).run(orderId);
}

/**
 * Remet les codes d'une commande dont le paiement est CONFIRMÉ.
 * Vérifie la disponibilité de chaque code ; à défaut, la commande passe en livraison manuelle.
 */
export function deliverOrder(order) {
  if (config.deliveryMode !== 'inventory') return { status: 'A_TRAITER' };
  return tx(() => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
    let missing = 0;
    for (const it of items) {
      const have = db.prepare(`SELECT id FROM gift_codes WHERE order_item_id=? AND status IN ('RESERVE','LIVRE')`).all(it.id);
      let need = it.quantity - have.length;
      if (need > 0) {
        // Réservation expirée : on tente de reprendre des codes encore disponibles.
        const more = db.prepare(`SELECT id FROM gift_codes WHERE product_id=? AND value_cents=? AND status='DISPONIBLE' ORDER BY id LIMIT ?`).all(it.product_id, it.value_cents, need);
        for (const { id } of more) db.prepare(`UPDATE gift_codes SET status='RESERVE', order_item_id=? WHERE id=?`).run(it.id, id);
        need -= more.length;
      }
      missing += Math.max(0, need);
    }
    db.prepare(`UPDATE gift_codes SET status='LIVRE', delivered_at=datetime('now'), reserved_until=NULL
                WHERE status='RESERVE' AND order_item_id IN (SELECT id FROM order_items WHERE order_id=?)`).run(order.id);
    return { status: missing ? 'PARTIELLE' : 'LIVREE', missing };
  });
}

/** Ajoute manuellement des codes (fournis par le distributeur) à une commande payée. */
export function attachManualCodes(order, entries) {
  return tx(() => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
    for (const e of entries) {
      const it = items.find((i) => i.id === e.itemId);
      if (!it) throw new Error(`Ligne ${e.itemId} inconnue`);
      const enc = encryptCode(e.code.trim());
      db.prepare(`INSERT INTO gift_codes (product_id, value_cents, cipher, iv, tag, fingerprint, status, order_item_id, delivered_at)
                  VALUES (?,?,?,?,?,?, 'LIVRE', ?, datetime('now'))`).run(it.product_id, it.value_cents, enc.cipher, enc.iv, enc.tag, fingerprint(e.code), it.id);
    }
    const totalNeeded = items.reduce((s, i) => s + i.quantity, 0);
    const delivered = db.prepare(`SELECT COUNT(*) n FROM gift_codes WHERE status='LIVRE' AND order_item_id IN (SELECT id FROM order_items WHERE order_id=?)`).get(order.id).n;
    return delivered >= totalNeeded ? 'LIVREE' : 'PARTIELLE';
  });
}

export function deliveredCodes(orderId) {
  const rows = db.prepare(`SELECT c.*, i.product_name, i.value_cents AS item_value FROM gift_codes c JOIN order_items i ON i.id=c.order_item_id
                           WHERE c.status='LIVRE' AND i.order_id=? ORDER BY c.id`).all(orderId);
  return rows.map((r) => ({ itemId: r.order_item_id, product: r.product_name, value: r.item_value / 100, code: decryptCode(r) }));
}

// ---- E-mails transactionnels (Resend ou Brevo via HTTP, aucun SDK requis) ----
export async function sendEmail({ to, subject, html, text }) {
  const { provider, apiKey, from, fromName } = config.email;
  if (provider === 'none' || !apiKey || !from || !to) return { sent: false, reason: 'e-mail non configuré' };
  let res;
  if (provider === 'resend') {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, html, text }),
    });
  } else if (provider === 'brevo') {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
    });
  } else return { sent: false, reason: `fournisseur inconnu : ${provider}` };
  return { sent: res.ok, reason: res.ok ? null : `HTTP ${res.status}` };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function confirmationEmail(order, items, codes, link) {
  const rows = items.map((i) => `<tr><td style="padding:6px 0">${esc(i.product_name)} — ${i.value_cents / 100} €</td><td align="right">× ${i.quantity}</td><td align="right">${(i.line_total_cents / 100).toFixed(2)} €</td></tr>`).join('');
  const codeBlock = codes.length
    ? `<h3 style="font-family:Georgia,serif">Vos codes</h3>${codes.map((c) => `<p style="margin:4px 0">${esc(c.product)} ${c.value} € : <code style="background:#f3efe8;padding:3px 6px">${esc(c.code)}</code></p>`).join('')}`
    : '<p>Votre paiement est confirmé. Vos codes vous seront transmis par e-mail dès leur remise par notre équipe.</p>';
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#2b2724;max-width:560px">
    <h2 style="font-family:Georgia,serif;font-weight:400">Maison des Cartes</h2>
    <p>Merci pour votre commande <strong>${esc(order.reference)}</strong>.</p>
    <table width="100%" style="border-collapse:collapse">${rows}<tr><td colspan="3" style="border-top:1px solid #ddd;padding-top:8px" align="right"><strong>Total : ${(order.total_cents / 100).toFixed(2)} €</strong></td></tr></table>
    ${codeBlock}
    <p><a href="${esc(link)}">Consulter ma commande</a></p></div>`;
  const text = `Maison des Cartes — commande ${order.reference}\nTotal : ${(order.total_cents / 100).toFixed(2)} €\n` +
    (codes.length ? codes.map((c) => `${c.product} ${c.value} € : ${c.code}`).join('\n') : 'Paiement confirmé, codes à suivre.') + `\n${link}`;
  return { subject: `Votre commande ${order.reference} — Maison des Cartes`, html, text };
}
