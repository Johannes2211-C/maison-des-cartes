// Visuel provisoire de DÉVELOPPEMENT uniquement (ALLOW_MISSING_IMAGES, jamais en production) :
// carte neutre clairement signalée, qui n'imite aucune marque. En production, un produit sans
// visuel authentique et sans droits déclarés n'est tout simplement pas publié.
const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = 'Jost, "Helvetica Neue", Arial, sans-serif';

export function devPlaceholderCanvas(product, w = 856, h = 540) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e3d8';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#b9ab95';
  g.setLineDash([14, 10]);
  g.lineWidth = 4;
  g.strokeRect(22, 22, w - 44, h - 44);
  g.setLineDash([]);
  g.textAlign = 'center';
  g.fillStyle = '#5c5146';
  g.font = `500 ${Math.round(h * 0.11)}px ${SERIF}`;
  g.fillText(product.name, w / 2, h * 0.47, w - 90);
  g.fillStyle = '#8a7b67';
  g.font = `400 ${Math.round(h * 0.052)}px ${SANS}`;
  g.fillText('Aperçu de développement — visuel officiel non intégré', w / 2, h * 0.63, w - 90);
  return c;
}

/** Élément image (visuel authentique) ou canvas provisoire en développement. */
export function cardVisual(product, { alt = true } = {}) {
  if (product.image) {
    const img = document.createElement('img');
    img.src = product.image;
    img.alt = alt ? `Visuel de la ${product.name}` : '';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }
  const c = devPlaceholderCanvas(product);
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `${product.name} — visuel non intégré (aperçu de développement)`);
  return c;
}
