// Architecture et mobilier de la boutique « Maison des Cartes ».
// Repère : x vers la droite, y vers le haut, z vers la rue. Façade en z = 0, fond en z = -16.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '/vendor/three/addons/RoundedBoxGeometry.js';
import { storefrontSign, aisleSign, shelfLabel, receptionLogo, smallPlaque, devPlaceholderTexture } from './signage.js';

export const ROOM = { minX: -9, maxX: 9, minZ: -16, maxZ: 0, H: 3.2, H2: 3.5 };
const BAY = 1.2;
const CARD_RATIO = 85.6 / 54; // format ISO/CEI 7810 ID-1

export function buildStore({ scene, mats, quality, catalog, cardTextures }) {
  const colliders = [];
  const interactive = [];
  const floors = [];
  const lights = [];
  const root = new THREE.Group();
  scene.add(root);
  const high = quality === 'high';

  // ---------- utilitaires ----------
  const boxGeo = new Map();
  function geo(w, h, d) {
    const k = `${w}|${h}|${d}`;
    if (!boxGeo.has(k)) boxGeo.set(k, new THREE.BoxGeometry(w, h, d));
    return boxGeo.get(k);
  }
  function box(mat, w, h, d, x, y, z, parent = root, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast && high;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  }
  function plane(mat, w, h, x, y, z, rx = 0, ry = 0, parent = root) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function contactShadow(x, z, w, d, opacity = 0.55, parent = root) {
    const m = plane(mats.contactShadow, w, d, x, 0.003, z, -Math.PI / 2, 0, parent);
    if (opacity !== 0.55) { m.material = mats.contactShadow.clone(); m.material.opacity = opacity; }
    m.renderOrder = 1;
    return m;
  }
  function collide(minX, maxX, minZ, maxZ) { colliders.push({ minX, maxX, minZ, maxZ }); }
  function worldCollider(obj, pad = 0) {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    collide(b.min.x - pad, b.max.x + pad, b.min.z - pad, b.max.z + pad);
  }
  function labelMat(texture) {
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 });
  }
  function signMat(texture, emissive = 0.55) {
    return new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: new THREE.Color(1, 0.9, 0.78).multiplyScalar(emissive), roughness: 0.4, metalness: 0.1 });
  }
  const priceText = (p) => {
    const a = p.amounts;
    if (a.type === 'variable') return `${a.min} à ${a.max} €`;
    if (a.values.length === 1) return `${a.values[0]} €`;
    return `${a.values[0]} à ${a.values[a.values.length - 1]} €`;
  };

  // ---------- cartes cadeaux ----------
  const cardFaceMats = new Map();
  function faceMaterial(product) {
    if (cardFaceMats.has(product.id)) return cardFaceMats.get(product.id);
    const t = cardTextures.get(product.id) || devPlaceholderTexture(product);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.32, metalness: 0, envMapIntensity: 0.7 });
    cardFaceMats.set(product.id, m);
    return m;
  }
  const cardGeos = new Map();
  function makeCard(product, width) {
    const tex = cardTextures.get(product.id);
    const ratio = tex?.image ? tex.image.width / tex.image.height : CARD_RATIO; // proportions d'origine respectées
    const h = width / ratio;
    const key = `${width.toFixed(3)}|${h.toFixed(3)}`;
    if (!cardGeos.has(key)) cardGeos.set(key, new RoundedBoxGeometry(width, h, 0.0024, 2, Math.min(width, h) * 0.045));
    const face = faceMaterial(product);
    // RoundedBoxGeometry n'a qu'un groupe : on superpose une face texturée légèrement en avant.
    const g = new THREE.Group();
    const body = new THREE.Mesh(cardGeos.get(key), mats.cardEdge);
    const front = new THREE.Mesh(roundedPlane(width, h, Math.min(width, h) * 0.045), face);
    front.position.z = 0.00125;
    g.add(body, front);
    body.castShadow = high;
    for (const m of [body, front]) { m.userData.productId = product.id; interactive.push(m); }
    g.userData = { productId: product.id, height: h, width };
    return g;
  }
  const rpCache = new Map();
  function roundedPlane(w, h, r) {
    const k = `${w}|${h}`;
    if (rpCache.has(k)) return rpCache.get(k);
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const geom = new THREE.ShapeGeometry(s, 6);
    const pos = geom.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) - x) / w; uv[i * 2 + 1] = (pos.getY(i) - y) / h; }
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    rpCache.set(k, geom);
    return geom;
  }

  /** Carte posée sur un chevalet en acrylique (jamais suspendue dans le vide). */
  function standCard(product, width, x, y, z, parent, tilt = 0.17) {
    const g = new THREE.Group();
    const card = makeCard(product, width);
    const h = card.userData.height;
    card.rotation.x = -tilt;
    card.position.set(0, 0.006 + (h / 2) * Math.cos(tilt), -Math.sin(tilt) * h / 2 + 0.012);
    g.add(card);
    const base = new THREE.Mesh(geo(width * 0.62, 0.006, 0.07), mats.acrylic);
    base.position.set(0, 0.003, 0.0);
    const back = new THREE.Mesh(geo(width * 0.5, h * 0.55, 0.004), mats.acrylic);
    back.position.set(0, 0.006 + h * 0.26, -Math.sin(tilt) * h * 0.55 - 0.004);
    back.rotation.x = -tilt;
    const lip = new THREE.Mesh(geo(width * 0.62, 0.012, 0.004), mats.acrylic);
    lip.position.set(0, 0.012, 0.03);
    g.add(base, back, lip);
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  // ---------- sols ----------
  const floor = plane(mats.floor, 18, 16, 0, 0, -8, -Math.PI / 2);
  floors.push(floor);
  const sidewalk = plane(mats.paving, 60, 6, 0, -0.001, 3, -Math.PI / 2);
  floors.push(sidewalk);
  box(mats.stoneTrim, 60, 0.14, 0.25, 0, 0.0, 6.0, root, { cast: false });
  plane(mats.asphalt, 60, 30, 0, -0.12, 21, -Math.PI / 2);
  // seuil
  box(mats.anthracite, 2.4, 0.012, 0.3, 0, 0.006, -0.05, root, { cast: false });
  // tapis d'entrée encastré
  plane(mats.rug, 2.2, 1.8, 0, 0.004, -1.25, -Math.PI / 2);

  // ---------- murs, plinthes, plafonds ----------
  const { H, H2 } = ROOM;
  plane(mats.plaster, 16, H, -9, H / 2, -8, 0, Math.PI / 2);
  plane(mats.plaster, 16, H, 9, H / 2, -8, 0, -Math.PI / 2);
  plane(mats.plasterWarm, 18, H, 0, H / 2, -16, 0, 0);
  box(mats.blackMatte, 0.02, 0.08, 16, -8.99, 0.04, -8, root, { cast: false });
  box(mats.blackMatte, 0.02, 0.08, 16, 8.99, 0.04, -8, root, { cast: false });
  box(mats.blackMatte, 18, 0.08, 0.02, 0, 0.04, -15.99, root, { cast: false });
  collide(-20, -8.95, -17, 0.2); collide(8.95, 20, -17, 0.2); collide(-20, 20, -20, -15.95);

  // plafond principal (cadre autour du caisson central)
  const cof = { x0: -4.5, x1: 4.5, z0: -13, z1: -3 };
  const ceil = (w, d, x, z, y = H) => plane(mats.ceiling, w, d, x, y, z, Math.PI / 2);
  ceil(18, 3, 0, -1.5); ceil(18, 3, 0, -14.5);
  ceil(4.5, 10, -6.75, -8); ceil(4.5, 10, 6.75, -8);
  ceil(9, 10, 0, -8, H2);
  // retombées du caisson + gorge lumineuse (éclairage indirect)
  const fasc = (w, x, z, ry) => { const p = plane(mats.ceiling, w, H2 - H, x, (H + H2) / 2, z, 0, ry); p.material = mats.ceiling; };
  fasc(9, 0, cof.z1, Math.PI); fasc(9, 0, cof.z0, 0); fasc(10, cof.x0, -8, Math.PI / 2); fasc(10, cof.x1, -8, -Math.PI / 2);
  // bande LED dissimulée + lavage lumineux du plafond haut (dégradé dirigé vers le centre du caisson)
  const washGeo = (w) => { const gg = new THREE.PlaneGeometry(w, 1.6); gg.rotateX(Math.PI / 2); return gg; };
  const coves = [
    { w: 9, x: 0, z: cof.z1 - 0.8, ry: 0, sx: 0, sz: cof.z1 - 0.05, len: 9, alongX: true },
    { w: 9, x: 0, z: cof.z0 + 0.8, ry: Math.PI, sx: 0, sz: cof.z0 + 0.05, len: 9, alongX: true },
    { w: 10, x: cof.x0 + 0.8, z: -8, ry: -Math.PI / 2, sx: cof.x0 + 0.05, sz: -8, len: 10, alongX: false },
    { w: 10, x: cof.x1 - 0.8, z: -8, ry: Math.PI / 2, sx: cof.x1 - 0.05, sz: -8, len: 10, alongX: false },
  ];
  for (const c of coves) {
    const wm = new THREE.Mesh(washGeo(c.w), mats.wash);
    wm.position.set(c.x, H2 - 0.004, c.z);
    wm.rotation.y = c.ry;
    wm.renderOrder = 2;
    root.add(wm);
  }

  // ---------- spots encastrés (visuels) + lumières ----------
  const dlGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.004, 24);
  const trimGeo = new THREE.TorusGeometry(0.068, 0.009, 8, 28);
  function downlight(x, z, y = H) {
    const d = new THREE.Mesh(dlGeo, mats.downlight);
    d.position.set(x, y - 0.004, z);
    const t = new THREE.Mesh(trimGeo, mats.trim);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, y - 0.006, z);
    root.add(d, t);
  }
  function spot(x, y, z, tx, ty, tz, intensity, angle = 0.62, shadow = false, color = 0xffe1bd) {
    const s = new THREE.SpotLight(color, intensity, 0, angle, 0.85, 2);
    s.position.set(x, y, z);
    s.target.position.set(tx, ty, tz);
    if (shadow && high) {
      s.castShadow = true;
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.02;
      s.shadow.radius = 4;
      s.shadow.camera.near = 0.3;
      s.shadow.camera.far = 8;
    }
    root.add(s, s.target);
    lights.push(s);
    return s;
  }

  // ---------- RAYONS MURAUX ----------
  const cats = Object.fromEntries(catalog.categories.map((c) => [c.id, c]));
  const byCat = (id) => catalog.products.filter((p) => p.category === id);

  function wallUnit({ side, zStart, products, category, wood = mats.oak }) {
    const count = products.length;
    if (!count) return null; // rayon sans produit publié : aucun meuble vide
    const L = count * BAY + 0.04;
    const g = new THREE.Group();
    if (side < 0) { g.rotation.y = Math.PI / 2; g.position.set(-9, 0, zStart); }
    else { g.rotation.y = -Math.PI / 2; g.position.set(9, 0, zStart - L); }
    root.add(g);
    const ordered = side < 0 ? products : [...products].reverse();
    const cx = L / 2;
    box(mats.blackMatte, L, 0.1, 0.4, cx, 0.05, 0.2, g, { cast: false });
    box(mats.walnut, L, 0.75, 0.46, cx, 0.475, 0.23, g);
    for (let x = 0.6; x < L - 0.1; x += 0.6) box(mats.blackMatte, 0.004, 0.72, 0.004, x + 0.02, 0.475, 0.461, g, { cast: false });
    for (let x = 0.3; x < L; x += 0.6) box(mats.brass, 0.22, 0.012, 0.018, x + 0.02, 0.79, 0.47, g, { cast: false });
    box(mats.marble, L + 0.02, 0.03, 0.5, cx, 0.865, 0.25, g);
    box(wood, L, 1.6, 0.02, cx, 1.68, 0.01, g, { cast: false });
    box(mats.walnut, L, 0.12, 0.36, cx, 2.54, 0.18, g);
    
    for (let i = 0; i <= count; i++) box(mats.walnut, 0.04, 1.62, 0.34, 0.02 + i * BAY, 1.69, 0.17, g);

    ordered.forEach((p, i) => {
      const bx = 0.02 + i * BAY + BAY / 2;
      const shelfYs = [1.22, 1.62, 2.02];
      for (const sy of shelfYs) {
        box(mats.oakShelf, BAY - 0.04, 0.025, 0.3, bx, sy, 0.16, g);
        box(mats.ledWarm, BAY - 0.12, 0.004, 0.008, bx, sy - 0.0145, 0.24, g, { cast: false });
        const w = plane(mats.wash, BAY - 0.06, 0.36, bx, sy - 0.013 - 0.18, 0.022, 0, 0, g);
        w.renderOrder = 2;
      }
      // présentation : 3 cartes en bas, 2 grandes à hauteur des yeux, 3 en haut
      for (let k = -1; k <= 1; k++) standCard(p, 0.17, bx + k * 0.33, 1.2325, 0.14, g);
      for (let k = -1; k <= 1; k += 2) standCard(p, 0.22, bx + k * 0.24, 1.6325, 0.14, g);
      for (let k = -1; k <= 1; k++) standCard(p, 0.16, bx + k * 0.33, 2.0325, 0.14, g, 0.12);
      standCard(p, 0.2, bx, 0.88, 0.25, g, 0.32);
      const lbl = plane(labelMat(shelfLabel(p.name, priceText(p))), 0.48, 0.06, bx, 1.6, 0.3105, 0, 0, g);
      lbl.renderOrder = 3;
      const lbl2 = plane(labelMat(shelfLabel(p.name, priceText(p))), 0.48, 0.06, bx, 0.835, 0.4615, 0, 0, g);
      lbl2.renderOrder = 3;
    });

    // enseigne du rayon, fixée au mur au-dessus du meuble
    const c = cats[category];
    const sw = Math.min(L - 0.3, 3.0);
    box(mats.anthracite, sw + 0.04, sw / 6 + 0.04, 0.025, cx, 2.92, 0.012, g, { cast: false });
    plane(signMat(aisleSign(c.name, c.tagline), 0.35), sw, sw / 6, cx, 2.92, 0.026, 0, 0, g);

    // éclairage : spots encastrés devant chaque travée, projecteurs réels toutes les deux travées
    const toWorld = (lx) => new THREE.Vector3(lx, 0, 0).applyMatrix4(g.matrix.compose(g.position, g.quaternion, g.scale));
    const inward = side < 0 ? 1 : -1;
    ordered.forEach((p, i) => { const wp = toWorld(0.02 + i * BAY + BAY / 2); downlight(wp.x + inward * 1.1, wp.z); });
    const groups = high ? Math.ceil(count / 2) : 1;
    for (let k = 0; k < groups; k++) {
      const span = count / groups;
      const wp = toWorld(0.02 + (k + 0.5) * span * BAY);
      spot(wp.x + inward * 1.3, H - 0.02, wp.z, wp.x + inward * 0.05, 1.5, wp.z, (high ? 9 : 12) * Math.max(1, span / 2), high ? 0.72 : 0.95);
    }
    g.updateMatrixWorld(true);
    worldCollider(g, 0.02);
    const fp = new THREE.Vector3(L / 2, 0, 0.3).applyMatrix4(g.matrixWorld);
    contactShadow(fp.x, fp.z, side ? 0.9 : L, side ? L + 0.2 : 0.9, 0.5).rotation.z = 0;
    return g;
  }

  wallUnit({ side: -1, zStart: -2.6, products: byCat('gaming'), category: 'gaming' });
  wallUnit({ side: -1, zStart: -8.0, products: byCat('apple-google'), category: 'apple-google', wood: mats.oak });
  wallUnit({ side: 1, zStart: -2.6, products: byCat('divertissement'), category: 'divertissement' });
  wallUnit({ side: 1, zStart: -5.6, products: byCat('shopping'), category: 'shopping' });

  // ---------- VITRINES EN VERRE ----------
  function vitrine({ x, z, w, d, baseH = 0.86, caseH = 0.3, products, rotY = 0, plaque }) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    root.add(g);
    box(mats.blackMatte, w - 0.06, 0.08, d - 0.06, 0, 0.04, 0, g, { cast: false });
    box(mats.walnut, w, baseH - 0.08, d, 0, 0.08 + (baseH - 0.08) / 2, 0, g);
    box(mats.brass, w + 0.01, 0.012, d + 0.01, 0, baseH, 0, g, { cast: false });
    box(mats.felt, w - 0.04, 0.01, d - 0.04, 0, baseH + 0.011, 0, g, { cast: false });
    const gy = baseH + 0.006 + caseH / 2;
    const glassT = 0.008;
    const panes = [[w, caseH, glassT, 0, gy, d / 2], [w, caseH, glassT, 0, gy, -d / 2], [glassT, caseH, d, w / 2, gy, 0], [glassT, caseH, d, -w / 2, gy, 0], [w, glassT, d, 0, baseH + caseH + 0.006, 0]];
    for (const [pw, ph, pd, px, py, pz] of panes) {
      const pane = box(mats.glass, pw, ph, pd, px, py, pz, g, { cast: false, receive: false });
      pane.renderOrder = 5;
    }
    // arêtes métalliques fines
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(mats.brass, 0.012, caseH, 0.012, sx * w / 2, gy, sz * d / 2, g, { cast: false });
    for (const sz of [-1, 1]) box(mats.brass, w, 0.01, 0.012, 0, baseH + caseH + 0.006, sz * d / 2, g, { cast: false });
    for (const sx of [-1, 1]) box(mats.brass, 0.012, 0.01, d, sx * w / 2, baseH + caseH + 0.006, 0, g, { cast: false });
    // cartes sur pupitres inclinés
    const n = products.length;
    products.forEach((p, i) => {
      const px = -w / 2 + (w / n) * (i + 0.5);
      const riser = box(mats.felt, 0.24, 0.05, 0.16, px, baseH + 0.04, 0.02, g, { cast: false });
      riser.rotation.x = -0.35;
      const card = makeCard(p, Math.min(0.2, (w / n) * 0.75));
      card.rotation.x = -Math.PI / 2 + 0.55;
      card.position.set(px, baseH + 0.075, 0.05);
      g.add(card);
    });
    if (plaque) {
      const pl = plane(signMat(smallPlaque(plaque), 0.25), 0.5, 0.125, 0, baseH - 0.12, d / 2 + 0.002, 0, 0, g);
      pl.renderOrder = 3;
    }
    g.updateMatrixWorld(true);
    worldCollider(g, 0.05);
    contactShadow(x, z, (Math.abs(Math.sin(rotY)) > 0.5 ? d : w) + 0.5, (Math.abs(Math.sin(rotY)) > 0.5 ? w : d) + 0.5, 0.6);
    return g;
  }

  const pick = (ids) => ids.map((id) => catalog.products.find((p) => p.id === id)).filter(Boolean);
  // îlot central : Services numériques
  const services = byCat('services');
  if (services.length) vitrine({ x: 0, z: -8.6, w: 2.4, d: 0.8, products: [...services, ...services].slice(0, Math.max(2, services.length * 2)), plaque: 'Services numériques' });
  // fronton de l'îlot : enseigne de rayon portée par deux montants laiton fixés au meuble
  const sc = cats.services;
  const pedi = new THREE.Group();
  pedi.visible = services.length > 0;
  pedi.position.set(0, 0, -8.6 - 0.43);
  root.add(pedi);
  for (const sx of [-0.82, 0.82]) box(mats.brass, 0.02, 0.72, 0.02, sx, 0.86 + 0.36, 0, pedi);
  box(mats.anthracite, 1.72, 0.3, 0.025, 0, 1.43, 0, pedi);
  plane(signMat(aisleSign(sc.name, sc.tagline), 0.35), 1.68, 0.28, 0, 1.43, 0.0135, 0, 0, pedi);
  plane(signMat(aisleSign(sc.name, sc.tagline), 0.35), 1.68, 0.28, 0, 1.43, -0.0135, 0, Math.PI, pedi);

  // vitrines « incontournables » près de l'entrée
  const featL = pick(['steam', 'playstation', 'apple']);
  const featR = pick(['netflix', 'amazon', 'google-play']);
  if (featL.length) vitrine({ x: -3.1, z: -4.9, w: 1.5, d: 0.6, products: featL, plaque: 'Les incontournables' });
  if (featR.length) vitrine({ x: 3.1, z: -4.9, w: 1.5, d: 0.6, products: featR, plaque: 'Les incontournables' });

  // ---------- ACCUEIL ----------
  const acc = new THREE.Group();
  acc.position.set(0, 0, -13.4);
  root.add(acc);
  box(mats.blackMatte, 4.2, 0.08, 0.66, 0, 0.04, 0, acc, { cast: false });
  box(mats.walnut, 4.3, 0.98, 0.7, 0, 0.57, 0, acc);
  for (let x = -2.1; x <= 2.1001; x += 0.06) box(mats.walnut, 0.04, 0.9, 0.025, x, 0.55, 0.36, acc, { cast: false });
  box(mats.marble, 4.4, 0.04, 0.78, 0, 1.08, 0.02, acc);
  box(mats.ledWarm, 4.2, 0.005, 0.01, 0, 0.09, 0.38, acc, { cast: false });
  // terminal de paiement + vase
  box(mats.blackMatte, 0.09, 0.03, 0.16, 1.2, 1.115, 0.05, acc);
  const term = box(mats.blackMatte, 0.18, 0.13, 0.012, 1.2, 1.18, -0.01, acc);
  term.rotation.x = -0.35;
  const vase = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.22], [0.035, 0.3], [0.045, 0.32]].map(([a, b]) => new THREE.Vector2(a, b)), 32), mats.ceramic);
  vase.position.set(-1.4, 1.1, 0);
  vase.castShadow = high;
  acc.add(vase);
  const plq = plane(signMat(smallPlaque('Accueil'), 0.25), 0.5, 0.125, 0, 0.82, 0.375, 0, 0, acc);
  plq.renderOrder = 3;
  worldCollider(acc, 0.05);
  contactShadow(0, -13.4, 4.8, 1.2, 0.6);
  // mur du fond : lames de noyer + logo laiton
  const back = new THREE.Group();
  back.position.set(0, 0, -15.98);
  root.add(back);
  box(mats.walnut, 6.4, H, 0.03, 0, H / 2, 0.0, back, { cast: false });
  for (let x = -3.15; x <= 3.1501; x += 0.1) box(mats.walnut, 0.06, H, 0.03, x, H / 2, 0.03, back, { cast: false });
  const logo = plane(new THREE.MeshStandardMaterial({ map: receptionLogo(), transparent: true, roughness: 0.3, metalness: 0.9, emissive: 0xb08a55, emissiveIntensity: 0.55, emissiveMap: receptionLogo() }), 2.4, 0.9, 0, 2.15, 0.06, 0, 0, back);
  logo.renderOrder = 3;
  // suspensions au-dessus du comptoir
  for (const px of [-1.3, 0, 1.3]) {
    const cord = box(mats.blackMatte, 0.006, 0.9, 0.006, px, H - 0.45, -13.4, root, { cast: false });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.2, 32, 1, true), mats.brass);
    shade.position.set(px, H - 1.0, -13.4);
    shade.material.side = THREE.DoubleSide;
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), mats.downlight);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(px, H - 1.08, -13.4);
    root.add(shade, bulb);
    box(mats.blackMatte, 0.06, 0.012, 0.06, px, H - 0.006, -13.4, root, { cast: false });
  }
  spot(0, H - 0.05, -12.2, 0, 1.0, -13.4, 9, 0.9, true);
  spot(0, H - 0.05, -14.6, 0, 2.0, -15.98, 10, 0.75, false);

  // ---------- étagères décoratives (fond de boutique) ----------
  function decorShelf(side, zFrom, zTo) {
    const len = zFrom - zTo;
    const g = new THREE.Group();
    g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.position.set(side < 0 ? -9 : 9, 0, side < 0 ? zFrom : zTo);
    root.add(g);
    box(mats.walnut, len, 2.6, 0.02, len / 2, 1.3, 0.01, g, { cast: false });
    for (const sy of [0.45, 1.05, 1.65, 2.25]) {
      box(mats.walnut, len - 0.04, 0.035, 0.36, len / 2, sy, 0.18, g);
      box(mats.ledWarm, len - 0.12, 0.004, 0.008, len / 2, sy - 0.019, 0.28, g, { cast: false });
      plane(mats.wash, len - 0.1, 0.4, len / 2, sy - 0.22, 0.022, 0, 0, g).renderOrder = 2;
    }
    for (const sx of [0.02, len - 0.02]) box(mats.walnut, 0.04, 2.6, 0.38, sx, 1.3, 0.19, g);
    // objets : livres, céramiques
    let t = 0;
    for (const sy of [0.4675, 1.0675, 1.6675, 2.2675]) {
      for (let x = 0.25; x < len - 0.25; x += 0.7) {
        t++;
        if (t % 3 === 0) {
          const v = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.08, 0.06], [0.07, 0.16], [0.03, 0.24], [0.035, 0.26]].map(([a, b]) => new THREE.Vector2(a, b)), 28), t % 2 ? mats.ceramic : mats.ceramicDark);
          v.position.set(x + 0.2, sy, 0.17);
          v.castShadow = high;
          g.add(v);
        } else {
          let bx = x;
          for (let k = 0; k < 6 + (t % 4); k++) {
            const bh = 0.19 + ((k * 37 + t * 11) % 7) * 0.012;
            box(mats.book[(k + t) % 5], 0.028, bh, 0.2, bx, sy + bh / 2, 0.14, g);
            bx += 0.031;
          }
        }
      }
    }
    g.updateMatrixWorld(true);
    worldCollider(g, 0.02);
  }
  decorShelf(-1, -12.2, -15.6);
  decorShelf(1, -9.8, -15.6);

  // spots généraux
  for (const [x, z] of [[-6.6, -1.4], [6.6, -1.4], [-2.4, -1.4], [2.4, -1.4], [-6.6, -14.6], [6.6, -14.6], [-2.6, -14.6], [2.6, -14.6]]) downlight(x, z);
  for (const x of [-3, 0, 3]) for (const z of [-5, -8, -11]) downlight(x, z, H2);
  spot(0, H2 - 0.05, -8.0, 0, 0.9, -8.6, 12, 0.7, true);
  if (high) {
    spot(-3.1, H - 0.05, -3.6, -3.1, 0.9, -4.9, 6, 0.7, true);
    spot(3.1, H - 0.05, -3.6, 3.1, 0.9, -4.9, 6, 0.7, true);
  }
  spot(-6.6, H - 0.05, -13.9, -9, 1.3, -13.9, 6, 0.8);
  spot(6.6, H - 0.05, -12.7, 9, 1.3, -12.7, 6, 0.8);
  if (high) for (const x of [-2.4, 2.4]) spot(x, H - 0.05, -1.4, x * 0.6, 0, -2.6, 5, 0.95);

  // ---------- FAÇADE ----------
  buildFacade({ root, mats, box, plane, colliders, high, spot, collide });

  return { root, colliders, interactive, floors, lights };
}

function buildFacade({ root, mats, box, plane, high, spot, collide }) {
  const H = ROOM.H;
  const topGlass = 3.0;
  // menuiseries anthracite
  const mullions = [-9, -6, -3.2, -1.25, 1.25, 3.2, 6, 9];
  for (const x of mullions) box(mats.anthracite, 0.09, topGlass, 0.14, x, topGlass / 2, -0.07);
  box(mats.anthracite, 18.1, 0.12, 0.16, 0, topGlass + 0.04, -0.07);
  box(mats.anthracite, 18.1, 0.12, 0.16, 0, 0.06, -0.07);
  // vitrages fixes
  const panes = [[-9, -6], [-6, -3.2], [-3.2, -1.25], [1.25, 3.2], [3.2, 6], [6, 9]];
  for (const [a, b] of panes) {
    const g = box(mats.storefrontGlass, b - a - 0.09, topGlass - 0.12, 0.012, (a + b) / 2, topGlass / 2 + 0.0, -0.07, root, { cast: false, receive: false });
    g.renderOrder = 6;
    collide(a, b, -0.2, 0.06);
  }
  // imposte au-dessus de la porte + portes coulissantes ouvertes
  box(mats.storefrontGlass, 2.5, 0.35, 0.012, 0, 2.8, -0.07, root, { cast: false, receive: false }).renderOrder = 6;
  box(mats.anthracite, 2.5, 0.05, 0.1, 0, 2.6, -0.07);
  for (const s of [-1, 1]) {
    const door = box(mats.storefrontGlass, 1.2, 2.55, 0.012, s * 1.95, 1.3, -0.16, root, { cast: false, receive: false });
    door.renderOrder = 6;
    box(mats.anthracite, 1.22, 0.06, 0.05, s * 1.95, 2.58, -0.16);
    box(mats.anthracite, 1.22, 0.05, 0.05, s * 1.95, 0.03, -0.16);
    box(mats.anthracite, 0.04, 2.55, 0.05, s * 1.35, 1.3, -0.16);
    box(mats.brass, 0.02, 1.0, 0.03, s * 1.42, 1.1, -0.12);
  }
  // bandeau d'enseigne
  box(mats.anthracite, 18.2, 0.9, 0.22, 0, topGlass + 0.55, 0.0);
  const sign = plane(new THREE.MeshStandardMaterial({ map: storefrontSign(), emissiveMap: storefrontSign(), emissive: new THREE.Color(1, 0.86, 0.66).multiplyScalar(0.9), roughness: 0.4, metalness: 0.4 }), 7.2, 0.9, 0, topGlass + 0.55, 0.111);
  sign.renderOrder = 2;
  // intérieur : retour du linteau jusqu'au plafond
  box(mats.plaster, 18, H - topGlass + 0.1, 0.1, 0, (topGlass + H) / 2, -0.2, root, { cast: false });
  // pierre de façade
  const stoneMat = mats.stone;
  box(stoneMat, 2.6, 9, 0.5, -10.3, 4.5, -0.1);
  box(stoneMat, 2.6, 9, 0.5, 10.3, 4.5, -0.1);
  box(stoneMat, 23.2, 5.0, 0.5, 0, topGlass + 1.0 + 2.5, -0.1);
  box(mats.stoneTrim, 23.4, 0.12, 0.62, 0, topGlass + 1.0, -0.05);
  // fenêtres de l'étage
  for (const x of [-6, 0, 6]) {
    box(mats.anthracite, 1.6, 2.1, 0.1, x, 6.4, 0.16);
    const w = box(new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.12, metalness: 0.35, envMapIntensity: 2.2, emissive: 0x1b1d20 }), 1.46, 1.96, 0.02, x, 6.4, 0.2, root, { cast: false });
    box(mats.anthracite, 0.04, 1.96, 0.04, x, 6.4, 0.22);
    box(mats.stoneTrim, 1.8, 0.08, 0.28, x, 5.3, 0.24);
    if (x === 6) w.material = new THREE.MeshStandardMaterial({ color: 0x4a3c2c, emissive: 0x6a4c2a, emissiveIntensity: 0.55, roughness: 0.25 });
    // rideau intérieur clair, visible derrière le vitrage
    box(new THREE.MeshStandardMaterial({ color: 0xcfc4b2, roughness: 1, emissive: x === 6 ? 0x3a2a18 : 0x000000 }), 0.5, 1.9, 0.01, x - 0.45, 6.4, 0.185, root, { cast: false });
  }
  // immeubles voisins
  const neighbor = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.9, map: mats.stone.map });
  box(neighbor, 14, 10, 0.5, -18.6, 5, -0.3, root, { cast: false });
  box(neighbor, 14, 10, 0.5, 18.6, 5, -0.3, root, { cast: false });
  box(mats.blackMatte, 3.2, 2.6, 0.08, -14.5, 1.3, 0.0, root, { cast: false });
  box(mats.blackMatte, 3.2, 2.6, 0.08, 14.5, 1.3, 0.0, root, { cast: false });
  collide(-30, -9.0, -1, 0.4); collide(9.0, 30, -1, 0.4);
  // éclairage extérieur sous le bandeau
  for (const x of (high ? [-6, 0, 6] : [-4, 4])) spot(x, topGlass - 0.05, 0.45, x, 0, 2.2, high ? 14 : 18, 1.0, false, 0xffd9aa);
  // banc en pierre devant la vitrine
  box(mats.stoneTrim, 2.0, 0.45, 0.45, -5.5, 0.225, 1.1);
  box(mats.stoneTrim, 2.0, 0.45, 0.45, 5.5, 0.225, 1.1);
  collide(-6.6, -4.4, 0.8, 1.4); collide(4.4, 6.6, 0.8, 1.4);
}
