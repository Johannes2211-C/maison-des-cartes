// Signalétique de la boutique (textures dessinées sur canvas avec les polices de la marque).
import * as THREE from 'three';
import { devPlaceholderCanvas } from '../ui/placeholder.js';

const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = 'Jost, "Helvetica Neue", Arial, sans-serif';

function canvasTexture(w, h, draw, { anisotropy = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

function brassFill(g, y0, y1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#d9bf8c');
  gr.addColorStop(0.5, '#b08d57');
  gr.addColorStop(1, '#8d6c3e');
  return gr;
}

/** Enseigne de façade : lettres laiton rétroéclairées sur bandeau anthracite. */
export function storefrontSign() {
  return canvasTexture(2048, 256, (g, w, h) => {
    g.fillStyle = '#2b2c2f';
    g.fillRect(0, 0, w, h);
    g.font = `500 132px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.letterSpacing = '22px';
    g.shadowColor = 'rgba(255,214,160,0.55)';
    g.shadowBlur = 28;
    g.fillStyle = brassFill(g, 70, 190);
    g.fillText('MAISON DES CARTES', w / 2, h / 2 + 6);
  });
}

/** Panneau de rayon : nom en laiton + accroche discrète. */
export function aisleSign(name, tagline) {
  return canvasTexture(1536, 256, (g, w, h) => {
    g.fillStyle = '#2f3033';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(176,141,87,0.55)';
    g.lineWidth = 3;
    g.strokeRect(18, 18, w - 36, h - 36);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `500 104px ${SERIF}`;
    g.letterSpacing = '10px';
    g.fillStyle = brassFill(g, 50, 150);
    g.fillText(name, w / 2, 104);
    g.letterSpacing = '4px';
    g.font = `300 38px ${SANS}`;
    g.fillStyle = 'rgba(232,224,210,0.78)';
    g.fillText(tagline, w / 2, 192);
  });
}

/** Étiquette de bord de tablette (nom + fourchette de prix). */
export function shelfLabel(name, priceText) {
  return canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#f3efe8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f2c29';
    g.font = `500 26px ${SANS}`;
    g.textBaseline = 'middle';
    g.fillText(name, 16, h / 2);
    g.textAlign = 'right';
    g.font = `400 26px ${SANS}`;
    g.fillStyle = '#6d5a3f';
    g.fillText(priceText, w - 16, h / 2);
  }, { anisotropy: 4 });
}

/** Mur d'accueil : logo laiton sur lames de noyer (dessiné en surimpression). */
export function receptionLogo() {
  return canvasTexture(1024, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = brassFill(g, 60, 260);
    g.font = `400 150px ${SERIF}`;
    g.fillText('M', w / 2, 140);
    g.font = `500 64px ${SERIF}`;
    g.letterSpacing = '14px';
    g.fillText('MAISON DES CARTES', w / 2, 290);
  });
}

export function smallPlaque(text) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#2f3033';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `500 52px ${SERIF}`;
    g.letterSpacing = '4px';
    g.fillStyle = brassFill(g, 30, 100);
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

export function devPlaceholderTexture(product) {
  const t = new THREE.CanvasTexture(devPlaceholderCanvas(product));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
