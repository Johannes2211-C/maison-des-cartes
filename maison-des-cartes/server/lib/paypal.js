// Client PayPal REST (Orders v2) côté serveur. Le secret ne quitte jamais le serveur.
import { config } from '../config.js';

let token = null;
let tokenExpiry = 0;

export class PayPalError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.issue = details?.details?.[0]?.issue || details?.name || null;
  }
}

async function safeFetch(url, init) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch (e) { throw new PayPalError(`PayPal injoignable : ${e.cause?.code || e.message}`, 503); }
}

async function accessToken() {
  if (token && Date.now() < tokenExpiry - 60_000) return token;
  const { clientId, clientSecret, apiBase } = config.paypal;
  if (!clientId || !clientSecret) throw new PayPalError('PayPal non configuré (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)', 503);
  const res = await safeFetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError('Authentification PayPal refusée', res.status, body);
  token = body.access_token;
  tokenExpiry = Date.now() + body.expires_in * 1000;
  return token;
}

async function call(method, pathname, body, requestId) {
  const t = await accessToken();
  const res = await safeFetch(`${config.paypal.apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError(json.message || `PayPal ${res.status}`, res.status, json);
  return json;
}

const money = (cents) => ({ currency_code: config.currency, value: (cents / 100).toFixed(2) });

/** Crée la commande PayPal à partir d'un récapitulatif calculé par le serveur. */
export function createPayPalOrder({ reference, lines, totalCents }) {
  return call('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: reference,
      custom_id: reference,
      invoice_id: reference,
      description: `${config.storeName} — commande ${reference}`.slice(0, 127),
      amount: { ...money(totalCents), breakdown: { item_total: money(totalCents) } },
      items: lines.map((l) => ({
        name: `${l.productName} ${l.valueCents / 100} €`.slice(0, 127),
        sku: `${l.productId}-${l.valueCents / 100}`.slice(0, 127),
        quantity: String(l.quantity),
        unit_amount: money(l.unitPriceCents),
        category: 'DIGITAL_GOODS',
      })),
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: config.storeName,
          locale: 'fr-FR',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      },
    },
  }, `${reference}-create`);
}

export function capturePayPalOrder(paypalOrderId, reference) {
  return call('POST', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {}, `${reference}-capture`);
}

export function getPayPalOrder(paypalOrderId) {
  return call('GET', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

/** Vérifie la signature d'un webhook auprès de PayPal. */
export async function verifyWebhook(headers, event) {
  if (!config.paypal.webhookId) return false;
  const r = await call('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: config.paypal.webhookId,
    webhook_event: event,
  });
  return r.verification_status === 'SUCCESS';
}
