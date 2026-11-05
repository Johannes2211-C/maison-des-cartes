// Gestion des commandes : calcul serveur des montants, création PayPal, capture, statuts.
import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { config } from '../config.js';
import { loadCatalog, isValidAmount, unitPriceCents } from './catalog.js';
import { createPayPalOrder, capturePayPalOrder, PayPalError } from './paypal.js';
import { reserveCodes, releaseOrderCodes, deliverOrder, deliveredCodes, sendEmail, confirmationEmail } from './delivery.js';

export const STATUS = {
  PENDING: 'EN_ATTENTE',
  CONFIRMED: 'PAIEMENT_CONFIRME',
  DECLINED: 'PAIEMENT_REFUSE',
  CANCELLED: 'PAIEMENT_ANNULE',
  ERROR: 'ERREUR_TECHNIQUE',
};

export class OrderError extends Error {
  constructor(message, status = 400, code = 'INVALID') { super(message); this.status = status; this.code = code; }
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

function newReference() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = [...crypto.randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('');
  return `MDC-${ymd}-${rnd}`;
}

function logEvent(orderId, type, data) {
  db.prepare('INSERT INTO order_events (order_id, type, data) VALUES (?,?,?)').run(orderId, type, data ? JSON.stringify(data) : null);
}

function setStatus(order, status, extra = {}) {
  const fields = { status, ...extra };
  const keys = Object.keys(fields);
  db.prepare(`UPDATE orders SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => fields[k]), order.id);
  logEvent(order.id, `STATUT:${status}`, extra.last_error ? { error: extra.last_error } : null);
}

/** Valide le panier envoyé par le navigateur et recalcule TOUT côté serveur (le prix client est ignoré). */
export function priceCart(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new OrderError('Panier vide');
  if (rawItems.length > 30) throw new OrderError('Trop de lignes dans le panier');
  const catalog = loadCatalog();
  const merged = new Map();
  for (const raw of rawItems) {
    const product = catalog.byId.get(String(raw?.productId || ''));
    if (!product || !product.published) throw new OrderError('Produit indisponible');
    const euros = Number(raw.amount);
    if (!isValidAmount(product, euros, catalog.selector)) throw new OrderError(`Montant non proposé pour ${product.name}`);
    const qty = Number(raw.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > config.maxQuantityPerLine) throw new OrderError('Quantité invalide');
    const key = `${product.id}:${euros}`;
    const prev = merged.get(key);
    const quantity = Math.min(config.maxQuantityPerLine, (prev?.quantity || 0) + qty);
    const unit = unitPriceCents(product, euros);
    merged.set(key, { productId: product.id, productName: product.name, valueCents: euros * 100, quantity, unitPriceCents: unit, lineTotalCents: unit * quantity });
  }
  const lines = [...merged.values()];
  const totalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  if (totalCents <= 0) throw new OrderError('Montant invalide');
  if (totalCents > config.maxOrderCents) throw new OrderError(`Le montant d’une commande est limité à ${config.maxOrderCents / 100} €`);
  return { lines, totalCents };
}

export async function createOrder(rawItems, origin) {
  const { lines, totalCents } = priceCart(rawItems);
  const reference = newReference();
  const accessToken = crypto.randomBytes(24).toString('base64url');

  // 1. Enregistrement local (EN_ATTENTE) + réservation du stock éventuelle, dans une transaction.
  const order = tx(() => {
    const r = db.prepare(`INSERT INTO orders (reference, status, origin, currency, total_cents, access_hash) VALUES (?,?,?,?,?,?)`)
      .run(reference, STATUS.PENDING, origin === 'fiche' ? 'fiche' : 'panier', config.currency, totalCents, hash(accessToken));
    const orderId = Number(r.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, value_cents, quantity, unit_price_cents, line_total_cents) VALUES (?,?,?,?,?,?,?)`);
    const items = lines.map((l) => ({ ...l, id: Number(ins.run(orderId, l.productId, l.productName, l.valueCents, l.quantity, l.unitPriceCents, l.lineTotalCents).lastInsertRowid) }));
    if (config.deliveryMode === 'inventory') {
      try { reserveCodes(items); } catch (e) {
        if (e.code === 'OUT_OF_STOCK') throw new OrderError(e.message, 409, 'OUT_OF_STOCK');
        throw e;
      }
    }
    logEvent(orderId, 'CREATION', { totalCents, lines: lines.length });
    return { id: orderId, reference };
  });

  // 2. Création de la commande PayPal avec le montant calculé par le serveur.
  try {
    const pp = await createPayPalOrder({ reference, lines, totalCents });
    db.prepare(`UPDATE orders SET paypal_order_id=?, updated_at=datetime('now') WHERE id=?`).run(pp.id, order.id);
    logEvent(order.id, 'PAYPAL_CREE', { paypalOrderId: pp.id });
    return { paypalOrderId: pp.id, reference, accessToken, totalCents };
  } catch (e) {
    releaseOrderCodes(order.id);
    setStatus(order, STATUS.ERROR, { last_error: String(e.message).slice(0, 500) });
    throw e instanceof PayPalError ? new OrderError('Le paiement PayPal ne peut pas être initialisé pour le moment.', e.status === 503 ? 503 : 502, 'PAYPAL') : e;
  }
}

function findByPayPal(paypalOrderId) {
  const order = db.prepare('SELECT * FROM orders WHERE paypal_order_id=?').get(String(paypalOrderId || ''));
  if (!order) throw new OrderError('Commande introuvable', 404, 'NOT_FOUND');
  return order;
}

/** Applique la confirmation du paiement : statut, livraison, e-mails. Idempotent. */
async function confirmPaid(order, { captureId, payerEmail, payerName }) {
  if (order.status === STATUS.CONFIRMED) return;
  setStatus(order, STATUS.CONFIRMED, { capture_id: captureId || null, payer_email: payerEmail || null, payer_name: payerName || null });
  let delivery;
  try { delivery = deliverOrder(order); } catch (e) { delivery = { status: 'A_TRAITER', error: e.message }; }
  db.prepare(`UPDATE orders SET delivery_status=? WHERE id=?`).run(delivery.status, order.id);
  logEvent(order.id, `LIVRAISON:${delivery.status}`, delivery.missing ? { missing: delivery.missing } : null);

  const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  const codes = delivery.status === 'LIVREE' || delivery.status === 'PARTIELLE' ? deliveredCodes(order.id) : [];
  const mail = confirmationEmail(fresh, items, codes, `${config.publicUrl}/commande/${fresh.reference}`);
  if (payerEmail) {
    const r = await sendEmail({ to: payerEmail, ...mail }).catch((e) => ({ sent: false, reason: e.message }));
    logEvent(order.id, r.sent ? 'EMAIL_CLIENT_ENVOYE' : 'EMAIL_CLIENT_NON_ENVOYE', r.reason ? { reason: r.reason } : null);
  }
  if (config.email.merchant) {
    await sendEmail({ to: config.email.merchant, subject: `[Commande payée] ${fresh.reference} — ${delivery.status}`, html: mail.html, text: mail.text }).catch(() => {});
  }
}

export async function captureOrder(paypalOrderId) {
  const order = findByPayPal(paypalOrderId);
  if (order.status === STATUS.CONFIRMED) return summary(order);
  if (order.status !== STATUS.PENDING) throw new OrderError('Cette commande ne peut plus être payée', 409, 'STATE');

  let result;
  try {
    result = await capturePayPalOrder(paypalOrderId, order.reference);
  } catch (e) {
    if (e instanceof PayPalError && e.issue === 'INSTRUMENT_DECLINED') {
      // Le moyen de paiement a été refusé : le client peut en choisir un autre (actions.restart()).
      logEvent(order.id, 'PAIEMENT_REFUSE_INSTRUMENT', { issue: e.issue });
      throw new OrderError('Votre moyen de paiement a été refusé. Veuillez en choisir un autre.', 422, 'INSTRUMENT_DECLINED');
    }
    if (e instanceof PayPalError && e.issue === 'ORDER_ALREADY_CAPTURED') {
      return summary(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));
    }
    setStatus(order, STATUS.ERROR, { last_error: String(e.message).slice(0, 500) });
    throw new OrderError('Erreur technique lors de la confirmation du paiement.', 502, 'PAYPAL');
  }

  const unit = result.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const expected = (order.total_cents / 100).toFixed(2);
  const amountOk = capture && capture.amount?.value === expected && capture.amount?.currency_code === order.currency;
  const refOk = unit?.reference_id === order.reference || unit?.custom_id === order.reference || capture?.custom_id === order.reference;

  if (result.status === 'COMPLETED' && capture?.status === 'COMPLETED' && amountOk && refOk) {
    await confirmPaid(order, {
      captureId: capture.id,
      payerEmail: result.payer?.email_address || result.payment_source?.paypal?.email_address,
      payerName: [result.payer?.name?.given_name, result.payer?.name?.surname].filter(Boolean).join(' '),
    });
  } else if (capture?.status === 'PENDING') {
    // Paiement en cours de vérification chez PayPal : la confirmation arrivera par webhook.
    logEvent(order.id, 'CAPTURE_EN_ATTENTE', { reason: capture.status_details?.reason });
    db.prepare(`UPDATE orders SET capture_id=? WHERE id=?`).run(capture.id, order.id);
  } else if (capture?.status === 'DECLINED' || capture?.status === 'FAILED') {
    releaseOrderCodes(order.id);
    setStatus(order, STATUS.DECLINED, { capture_id: capture.id });
  } else {
    setStatus(order, STATUS.ERROR, { last_error: `Capture incohérente (statut ${capture?.status}, montant ${capture?.amount?.value}, attendu ${expected})` });
  }
  return summary(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));
}

export function cancelOrder(paypalOrderId) {
  const order = findByPayPal(paypalOrderId);
  if (order.status === STATUS.PENDING) {
    releaseOrderCodes(order.id);
    setStatus(order, STATUS.CANCELLED);
  }
  return { status: STATUS.CANCELLED };
}

export function failOrder(paypalOrderId, message) {
  const order = db.prepare('SELECT * FROM orders WHERE paypal_order_id=?').get(String(paypalOrderId || ''));
  if (order && order.status === STATUS.PENDING) {
    releaseOrderCodes(order.id);
    setStatus(order, STATUS.ERROR, { last_error: String(message || 'Erreur PayPal côté navigateur').slice(0, 500) });
  }
}

/** Événements webhook PayPal (signature vérifiée en amont). */
export async function handleWebhookEvent(event) {
  const res = event.resource || {};
  const paypalOrderId = res.supplementary_data?.related_ids?.order_id;
  if (!paypalOrderId) return;
  const order = db.prepare('SELECT * FROM orders WHERE paypal_order_id=?').get(paypalOrderId);
  if (!order) return;
  logEvent(order.id, `WEBHOOK:${event.event_type}`, { id: event.id });
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && order.status === STATUS.PENDING) {
    if (res.amount?.value === (order.total_cents / 100).toFixed(2) && res.amount?.currency_code === order.currency) {
      await confirmPaid(order, { captureId: res.id });
    }
  } else if (event.event_type === 'PAYMENT.CAPTURE.DENIED' && order.status === STATUS.PENDING) {
    releaseOrderCodes(order.id);
    setStatus(order, STATUS.DECLINED, { capture_id: res.id });
  } else if (['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'].includes(event.event_type)) {
    logEvent(order.id, 'ALERTE_REMBOURSEMENT', { captureId: res.id });
  }
}

const LABELS = {
  EN_ATTENTE: 'En attente', PAIEMENT_CONFIRME: 'Paiement confirmé', PAIEMENT_REFUSE: 'Paiement refusé',
  PAIEMENT_ANNULE: 'Paiement annulé', ERREUR_TECHNIQUE: 'Erreur technique',
};
const DELIVERY_LABELS = {
  NON_DEMARREE: 'Non démarrée', A_TRAITER: 'En préparation par notre équipe', LIVREE: 'Codes délivrés', PARTIELLE: 'Livraison partielle — complément en cours',
};

export function summary(order, withCodes = false) {
  const items = db.prepare('SELECT product_id, product_name, value_cents, quantity, unit_price_cents, line_total_cents FROM order_items WHERE order_id=?').all(order.id);
  return {
    reference: order.reference,
    status: order.status,
    statusLabel: LABELS[order.status] || order.status,
    deliveryStatus: order.delivery_status,
    deliveryLabel: DELIVERY_LABELS[order.delivery_status] || order.delivery_status,
    total: order.total_cents / 100,
    currency: order.currency,
    createdAt: order.created_at,
    items: items.map((i) => ({ productId: i.product_id, name: i.product_name, amount: i.value_cents / 100, quantity: i.quantity, unitPrice: i.unit_price_cents / 100, lineTotal: i.line_total_cents / 100 })),
    codes: withCodes && order.status === STATUS.CONFIRMED ? deliveredCodes(order.id).map(({ product, value, code }) => ({ product, value, code })) : [],
  };
}

export function getOrderForCustomer(reference, accessToken) {
  const order = db.prepare('SELECT * FROM orders WHERE reference=?').get(String(reference || ''));
  if (!order || !accessToken) throw new OrderError('Commande introuvable', 404, 'NOT_FOUND');
  const a = Buffer.from(order.access_hash, 'hex');
  const b = Buffer.from(hash(String(accessToken)), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new OrderError('Commande introuvable', 404, 'NOT_FOUND');
  return summary(order, true);
}

export function listOrders(limit = 100) {
  return db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit).map((o) => ({ ...summary(o), paypalOrderId: o.paypal_order_id, payerEmail: o.payer_email, lastError: o.last_error, origin: o.origin }));
}

export function getOrderByReference(reference) {
  return db.prepare('SELECT * FROM orders WHERE reference=?').get(String(reference || ''));
}
