// Matériaux PBR de la boutique : bois, pierre, verre, métal brossé, enduit.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

export function tex(name, { repeat = [1, 1], color = true, rotation = 0, anisotropy = 8 } = {}) {
  const key = `${name}|${repeat}|${color}|${rotation}`;
  if (cache.has(key)) return cache.get(key);
  const base = cache.get(`raw:${name}`) || loader.load(`/textures/${name}`);
  cache.set(`raw:${name}`, base);
  const t = base.clone();
  // les clones partagent l'image source : on force la mise à jour une fois chargée
  if (base.image) t.needsUpdate = true; else base.addEventListener?.('load', () => (t.needsUpdate = true));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.rotation = rotation;
  t.anisotropy = anisotropy;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, t);
  return t;
}

/** Précharge toutes les textures (progression affichée par le chargeur). */
export function preloadTextures(names, onProgress) {
  let done = 0;
  return Promise.all(names.map((n) => new Promise((resolve) => {
    loader.load(`/textures/${n}`, (t) => {
      cache.set(`raw:${n}`, t);
      onProgress?.(++done / names.length);
      resolve();
    }, undefined, () => { onProgress?.(++done / names.length); resolve(); });
  })));
}

export const TEXTURES = ['floor-tile.webp', 'floor-tile-rough.webp', 'plaster.webp', 'oak.webp', 'oak-rough.webp', 'walnut.webp', 'walnut-rough.webp', 'marble.webp', 'stone.webp', 'paving.webp', 'brushed-rough.webp', 'felt.webp', 'contact-shadow.png', 'glow.png', 'wash.png'];

export function makeMaterials(quality) {
  const aniso = quality === 'high' ? 8 : 4;
  const m = {};
  m.floor = new THREE.MeshStandardMaterial({
    map: tex('floor-tile.webp', { repeat: [18 / 1.2, 16 / 1.2], anisotropy: aniso }),
    roughnessMap: tex('floor-tile-rough.webp', { repeat: [18 / 1.2, 16 / 1.2], color: false, anisotropy: aniso }),
    roughness: 0.9, metalness: 0, envMapIntensity: 0.9,
  });
  m.plaster = new THREE.MeshStandardMaterial({ map: tex('plaster.webp', { repeat: [6, 2] }), color: 0xf3eee6, roughness: 0.92 });
  m.plasterWarm = new THREE.MeshStandardMaterial({ map: tex('plaster.webp', { repeat: [6, 2] }), color: 0xe2d5c0, roughness: 0.94 });
  m.ceiling = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.96 });
  const wood = (name, repeat, color = 0xffffff) => new THREE.MeshStandardMaterial({
    map: tex(`${name}.webp`, { repeat, anisotropy: aniso }),
    roughnessMap: tex(`${name}-rough.webp`, { repeat, color: false, anisotropy: aniso }),
    color, roughness: 0.85, metalness: 0, envMapIntensity: 0.6,
  });
  m.oak = wood('oak', [1, 1]);
  m.oakShelf = wood('oak', [1, 0.08]);
  m.walnut = wood('walnut', [1, 1]);
  m.walnutTall = wood('walnut', [0.4, 1], 0xffffff);
  m.walnut.map.rotation = 0;
  m.marble = new THREE.MeshStandardMaterial({ map: tex('marble.webp', { repeat: [1, 0.5] }), roughness: 0.18, metalness: 0, envMapIntensity: 1 });
  m.stone = new THREE.MeshStandardMaterial({ map: tex('stone.webp', { repeat: [12, 4] }), roughness: 0.82 });
  m.stoneTrim = new THREE.MeshStandardMaterial({ map: tex('stone.webp', { repeat: [1, 1] }), roughness: 0.8 });
  m.paving = new THREE.MeshStandardMaterial({ map: tex('paving.webp', { repeat: [30, 8] }), roughness: 0.9, color: 0xc8c6c2 });
  m.asphalt = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.95 });
  m.blackMatte = new THREE.MeshStandardMaterial({ color: 0x1c1c1d, roughness: 0.62, metalness: 0.2 });
  m.anthracite = new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.5, metalness: 0.55, roughnessMap: tex('brushed-rough.webp', { color: false }) });
  m.brass = new THREE.MeshStandardMaterial({ color: 0xb49260, roughness: 0.32, metalness: 1, roughnessMap: tex('brushed-rough.webp', { color: false }) });
  m.chrome = new THREE.MeshStandardMaterial({ color: 0xd8d8d6, roughness: 0.2, metalness: 1 });
  m.white = new THREE.MeshStandardMaterial({ color: 0xf6f4f0, roughness: 0.6 });
  m.felt = new THREE.MeshStandardMaterial({ map: tex('felt.webp', { repeat: [3, 2] }), roughness: 1 });
  m.glass = new THREE.MeshPhysicalMaterial({
    color: 0xf4f8f6, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.12,
    envMapIntensity: 1.6, specularIntensity: 1, ior: 1.5, depthWrite: false, side: THREE.DoubleSide,
  });
  m.storefrontGlass = m.glass.clone();
  m.storefrontGlass.opacity = 0.1;
  m.glassEdge = new THREE.MeshStandardMaterial({ color: 0x9fb8ae, roughness: 0.1, transparent: true, opacity: 0.45 });
  m.acrylic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.2 });
  m.ledWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.58).multiplyScalar(0.85), toneMapped: true });
  m.downlight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.9, 0.76).multiplyScalar(6) });
  m.trim = new THREE.MeshStandardMaterial({ color: 0xece9e4, roughness: 0.4, metalness: 0.3 });
  m.cardEdge = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.4 });
  m.contactShadow = new THREE.MeshBasicMaterial({ map: tex('contact-shadow.png', { color: true }), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 });
  m.contactShadow.map.wrapS = m.contactShadow.map.wrapT = THREE.ClampToEdgeWrapping;
  m.wash = new THREE.MeshBasicMaterial({ map: tex('wash.png'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1, 0.8, 0.6), opacity: 0.32 });
  m.wash.map.wrapS = m.wash.map.wrapT = THREE.ClampToEdgeWrapping;
  m.glow = new THREE.MeshBasicMaterial({ map: tex('glow.png'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1, 0.85, 0.65), opacity: 0.5 });
  m.glow.map.wrapS = m.glow.map.wrapT = THREE.ClampToEdgeWrapping;
  m.ceramic = new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.45 });
  m.ceramicDark = new THREE.MeshStandardMaterial({ color: 0x3b3835, roughness: 0.55 });
  m.book = [0x7d6a55, 0xc9bba4, 0x3e4245, 0xa39582, 0x5b4636].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  m.leaf = new THREE.MeshStandardMaterial({ color: 0x4d5a3d, roughness: 0.7, side: THREE.DoubleSide });
  m.rug = new THREE.MeshStandardMaterial({ map: tex('felt.webp', { repeat: [6, 3] }), color: 0x8a8580, roughness: 1 });
  return m;
}
