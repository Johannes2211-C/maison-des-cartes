// Intégration officielle du PayPal JavaScript SDK (boutons PayPal réels).
// Le navigateur n'envoie que la composition du panier ; le serveur calcule le montant,
// crée la commande PayPal et effectue la capture. Le secret PayPal reste sur le serveur.
import { api, ApiError } from '../core/api.js';
import { h } from '../core/format.js';

let sdkPromise = null;

export function loadPayPalSdk(cfg) {
  if (!cfg?.paypal?.enabled || !cfg.paypal.clientId) return Promise.reject(Object.assign(new Error('PayPal non configuré'), { code: 'NOT_CONFIGURED' }));
  if (window.paypal?.Buttons) return Promise.resolve(window.paypal);
  sdkPromise ||= new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      'client-id': cfg.paypal.clientId,
      currency: cfg.currency || 'EUR',
      intent: 'capture',
      components: 'buttons',
      locale: 'fr_FR',
      commit: 'true',
    });
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?${params}`;
    s.async = true;
    s.dataset.sdkIntegrationSource = 'button-factory';
    s.onload = () => (window.paypal?.Buttons ? resolve(window.paypal) : reject(new Error('SDK PayPal indisponible')));
    s.onerror = () => { sdkPromise = null; s.remove(); reject(Object.assign(new Error('Le module de paiement PayPal n’a pas pu être chargé.'), { code: 'SDK_LOAD' })); };
    document.head.append(s);
  });
  return sdkPromise;
}

/**
 * Affiche les boutons PayPal dans `container`. Garantit une seule instance par conteneur.
 * Retourne { close() }.
 */
export async function mountPayPalButtons(container, { cfg, getItems, origin, onSuccess, onMessage }) {
  // un seul jeu de boutons par conteneur, même en cas de double clic
  if (container._ppInstance) { await container._ppInstance.close?.().catch?.(() => {}); }
  container._ppToken = (container._ppToken || 0) + 1;
  const token = container._ppToken;
  container.replaceChildren();
  container.classList.add('is-loading');

  let paypal;
  try {
    paypal = await loadPayPalSdk(cfg);
  } catch (e) {
    container.classList.remove('is-loading');
    container.replaceChildren(h('p', { class: 'paypal-notice', text: e.code === 'NOT_CONFIGURED'
      ? (cfg?.production
        ? 'Le paiement est momentanément indisponible. Merci de réessayer plus tard.'
        : 'PayPal n’est pas encore configuré sur ce serveur : renseignez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET dans le fichier .env, puis redémarrez.')
      : e.message }));
    return { close: async () => {} };
  }
  if (token !== container._ppToken) return { close: async () => {} }; // remplacé entre-temps

  const sessions = new Map(); // id PayPal → { reference, accessToken }
  const buttons = paypal.Buttons({
    style: { layout: 'vertical', color: 'black', shape: 'rect', label: 'pay', height: 48, tagline: false },
    async createOrder() {
      onMessage?.('');
      const items = getItems();
      if (!items.length) throw new Error('Panier vide');
      try {
        const r = await api('/api/orders', { method: 'POST', body: { items, origin } });
        sessions.set(r.id, { reference: r.reference, accessToken: r.accessToken });
        return r.id;
      } catch (e) {
        onMessage?.(e.message);
        throw e;
      }
    },
    async onApprove(data, actions) {
      try {
        const summary = await api(`/api/orders/${encodeURIComponent(data.orderID)}/capture`, { method: 'POST' });
        const s = sessions.get(data.orderID);
        onSuccess?.(summary, s?.accessToken);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'INSTRUMENT_DECLINED') {
          onMessage?.(e.message);
          return actions.restart();
        }
        onMessage?.(e.message || 'Le paiement n’a pas pu être confirmé.');
      }
    },
    onCancel(data) {
      api(`/api/orders/${encodeURIComponent(data.orderID)}/cancel`, { method: 'POST' }).catch(() => {});
      onMessage?.('Paiement annulé. Vous pouvez reprendre quand vous voulez.');
    },
    onError(err) {
      const ids = [...sessions.keys()];
      const last = ids[ids.length - 1];
      if (last) api(`/api/orders/${encodeURIComponent(last)}/error`, { method: 'POST', body: { message: String(err?.message || err).slice(0, 300) } }).catch(() => {});
      onMessage?.((m) => m || 'Une erreur est survenue avec PayPal. Réessayez ou choisissez un autre moyen de paiement.');
    },
  });

  if (!buttons.isEligible()) {
    container.classList.remove('is-loading');
    container.replaceChildren(h('p', { class: 'paypal-notice', text: 'PayPal n’est pas disponible sur cet appareil.' }));
    return { close: async () => {} };
  }
  await buttons.render(container).catch(() => {});
  container.classList.remove('is-loading');
  const instance = { close: async () => { try { await buttons.close(); } catch { /* déjà fermé */ } container.replaceChildren(); } };
  container._ppInstance = instance;
  return instance;
}
