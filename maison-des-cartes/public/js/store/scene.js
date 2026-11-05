// Boutique 3D : rendu, chargement progressif, façade d'accueil, visite et interactions produits.
import * as THREE from 'three';
import { RoomEnvironment } from '/vendor/three/addons/RoomEnvironment.js';
import { makeMaterials, preloadTextures, TEXTURES } from './materials.js';
import { buildStore } from './build.js';
import { VisitorControls, attachJoystick } from './controls.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function detectQuality() {
  const params = new URLSearchParams(location.search);
  if (params.get('qualite')) return params.get('qualite') === 'haute' ? 'high' : 'low';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
  return coarse || small || lowMem ? 'low' : 'high';
}

const HOME_POSE = { pos: new THREE.Vector3(0, 1.7, 9.6), yaw: 0, pitch: 0.05 };
const INSIDE_POSE = { pos: new THREE.Vector3(0, 1.62, -2.2), yaw: 0, pitch: -0.04 };

export class Store {
  constructor({ container, catalog, onProduct, onProgress, onHover }) {
    this.container = container;
    this.catalog = catalog;
    this.onProduct = onProduct;
    this.onProgress = onProgress;
    this.onHover = onHover;
    this.quality = detectQuality();
    this.mode = 'facade';
    this.running = false;
    this.dirty = true;
    this.timer = new THREE.Timer();
  }

  async init() {
    const q = this.quality;
    const renderer = new THREE.WebGLRenderer({ antialias: q === 'high', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.75 : 1.3));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = q === 'high';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'store-canvas';
    renderer.domElement.setAttribute('aria-label', 'Boutique Maison des Cartes en 3D');
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1f252c);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120);

    this.onProgress?.(0.05, 'Préparation des matériaux');
    await Promise.all([
      preloadTextures(TEXTURES, (f) => this.onProgress?.(0.05 + f * 0.45, 'Chargement des matériaux')),
      document.fonts?.load('500 64px "Cormorant Garamond"').catch(() => {}),
      document.fonts?.load('400 32px Jost').catch(() => {}),
    ]);
    const cardTextures = await this._loadCardImages((f) => this.onProgress?.(0.5 + f * 0.35, 'Mise en place des cartes'));
    this.onProgress?.(0.88, 'Installation des vitrines');

    const mats = makeMaterials(q);
    this.mats = mats;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    scene.add(new THREE.HemisphereLight(0xfff1de, 0x8a7a66, q === 'high' ? 0.35 : 0.75));

    const built = buildStore({ scene, mats, quality: q, catalog: this.catalog, cardTextures });
    this.built = built;
    this.interactive = built.interactive;

    // Réflexions réalistes : on capture la boutique elle-même comme carte d'environnement.
    await new Promise((r) => requestAnimationFrame(r));
    const envRT = pmrem.fromScene(scene, 0.02, 0.1, 60, { size: q === 'high' ? 256 : 128, position: new THREE.Vector3(0, 1.7, -7.5) });
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.controls = new VisitorControls(this.camera, renderer.domElement, built.colliders);
    this.controls.setPose(HOME_POSE.pos, HOME_POSE.yaw, HOME_POSE.pitch);
    this.controls.onTap = (x, y) => this._tap(x, y);
    this.controls.onActivity = () => { this.dirty = true; this._hideHint(); };
    const joy = this.container.querySelector('.joystick');
    if (joy) attachJoystick(joy, this.controls);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.006;
    scene.add(this.marker);
    renderer.domElement.addEventListener('pointermove', (e) => this._hover(e));
    renderer.domElement.addEventListener('pointerleave', () => { this.onHover?.(null); this.marker.material.opacity = 0; this.dirty = true; });

    new ResizeObserver(() => this._resize()).observe(this.container);
    this._resize();
    renderer.compile(scene, this.camera);
    this.onProgress?.(1, 'Bienvenue');
    this.start();
  }

  async _loadCardImages(onProgress) {
    const loader = new THREE.TextureLoader();
    const map = new Map();
    const list = this.catalog.products.filter((p) => p.image);
    let n = 0;
    await Promise.all(list.map((p) => new Promise((resolve) => {
      loader.load(p.image, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        map.set(p.id, t);
        onProgress?.(++n / list.length);
        resolve();
      }, undefined, () => { onProgress?.(++n / list.length); resolve(); });
    })));
    if (!list.length) onProgress?.(1);
    return map;
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 70 : 58;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  _ndc(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  _pickCard() {
    // premier objet opaque rencontré : on ne sélectionne jamais une carte à travers un mur ou un meuble
    // (le verre des vitrines et les éclairages ne font pas obstacle)
    const hits = this.raycaster.intersectObjects(this.built.root.children, true);
    for (const hit of hits) {
      const m = hit.object.material;
      if (!hit.object.visible || (m && m.transparent) || hit.object.isLight) continue;
      if (hit.object.userData.productId && hit.distance < 9) return hit;
      return null;
    }
    return null;
  }

  /** Position écran d'une carte (aide aux tests automatisés). */
  cardScreenPosition(productId) {
    this.camera.updateMatrixWorld();
    const cam = this.camera.position;
    const v = new THREE.Vector3();
    let best = null;
    for (const m of this.interactive) {
      if (m.userData.productId !== productId || m.material === this.mats.cardEdge) continue;
      m.getWorldPosition(v);
      const d = v.distanceTo(cam);
      const s = v.clone().project(this.camera);
      if (Math.abs(s.x) > 0.95 || Math.abs(s.y) > 0.95 || s.z > 1) continue;
      if (!best || d < best.d) best = { d, p: s };
    }
    if (!best) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (best.p.x + 1) / 2 * r.width, y: r.top + (1 - best.p.y) / 2 * r.height, d: best.d };
  }

  _hover(e) {
    if (this.mode !== 'inside' || e.pointerType === 'touch') return;
    this._ndc(e.clientX, e.clientY);
    const hit = this._pickCard();
    if (hit) {
      const p = this.catalog.products.find((x) => x.id === hit.object.userData.productId);
      this.onHover?.(p ? { product: p, x: e.clientX, y: e.clientY } : null);
      this.renderer.domElement.style.cursor = 'pointer';
      this.marker.material.opacity = 0;
    } else {
      this.onHover?.(null);
      const f = this.raycaster.intersectObjects(this.built.floors, false)[0];
      if (f && f.distance < 12 && f.point.z < -0.3) {
        this.marker.position.set(f.point.x, 0.006, f.point.z);
        this.marker.material.opacity = 0.35;
        this.renderer.domElement.style.cursor = 'pointer';
      } else {
        this.marker.material.opacity = 0;
        this.renderer.domElement.style.cursor = 'grab';
      }
    }
    this.dirty = true;
  }

  _tap(x, y) {
    if (this.mode !== 'inside') return;
    this._ndc(x, y);
    const hit = this._pickCard();
    if (hit) return this.approach(hit.object.userData.productId, hit.point, hit.face?.normal ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null);
    const f = this.raycaster.intersectObjects(this.built.floors, false)[0];
    if (f && f.distance < 14 && f.point.z < -0.3) {
      this.controls.walkTo(f.point, null);
      this.dirty = true;
    }
  }

  /** S'approche de la carte touchée, puis ouvre sa fiche. */
  approach(productId, point, normal) {
    const product = this.catalog.products.find((p) => p.id === productId);
    if (!product) return;
    const n = normal ? new THREE.Vector3(normal.x, 0, normal.z) : new THREE.Vector3();
    if (n.lengthSq() < 0.05) n.set(this.camera.position.x - point.x, 0, this.camera.position.z - point.z);
    n.normalize();
    const stand = point.clone().addScaledVector(n, 1.55);
    const cur = this.controls.position;
    const far = cur.distanceTo(new THREE.Vector3(stand.x, cur.y, stand.z)) > 0.35;
    this.onHover?.(null);
    if (!far) { this.onProduct?.(product); return; }
    this.controls.walkTo(stand, point, () => this.onProduct?.(product));
    this.dirty = true;
  }

  /** Se rendre devant un rayon par l'allée centrale. */
  goToAisle(id) {
    const A = {
      gaming: [[-7.0, -5.0], [-9, 1.55, -5.0]],
      'apple-google': [[-7.0, -9.8], [-9, 1.55, -9.8]],
      divertissement: [[7.0, -3.8], [9, 1.55, -3.8]],
      shopping: [[7.0, -7.4], [9, 1.55, -7.4]],
      services: [[0, -6.9], [0, 1.0, -8.6]],
      accueil: [[0, -11.4], [0, 1.4, -13.6]],
    }[id];
    if (!A || this.mode !== 'inside') return;
    const [[tx, tz], look] = A;
    const cur = this.controls.position;
    const lane = tx === 0 ? (cur.x < 0 ? -1.75 : 1.75) : Math.sign(tx) * 1.75;
    const pts = [];
    if (Math.abs(cur.x - lane) > 0.4 && Math.abs(cur.z - tz) > 0.6) pts.push(new THREE.Vector3(lane, 0, THREE.MathUtils.clamp(cur.z, -12, -1)));
    if (Math.abs(tz - cur.z) > 0.6) pts.push(new THREE.Vector3(tx === 0 ? lane : lane, 0, tz));
    pts.push(new THREE.Vector3(tx, 0, tz));
    this.controls.walkPath(pts, new THREE.Vector3(...look), null);
    this.dirty = true;
  }

  /** Entrée dans la boutique depuis la façade (travelling à travers la porte). */
  enter({ instant = false } = {}) {
    if (this.mode === 'inside') return;
    this.mode = 'entering';
    const start = this.camera.position.clone();
    const startPitch = this.controls.pitch;
    const mid = new THREE.Vector3(0, 1.66, 1.2);
    const end = INSIDE_POSE.pos.clone();
    const curve = new THREE.CatmullRomCurve3([start, mid, new THREE.Vector3(0, 1.64, -0.6), end]);
    const dur = instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3.2;
    this.anim = {
      t: 0, dur,
      step: (k) => {
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        this.controls.position.copy(curve.getPoint(e));
        this.controls.yaw = this.controls.targetYaw = 0;
        this.controls.pitch = this.controls.targetPitch = THREE.MathUtils.lerp(startPitch, INSIDE_POSE.pitch, e);
        this.controls.apply();
      },
      done: () => {
        this.mode = 'inside';
        this.controls.enabled = true;
        this.container.classList.add('is-inside');
        this._showHint();
      },
    };
    if (dur === 0) { this.anim.step(1); this.anim.done(); this.anim = null; }
    this.dirty = true;
    this.resume();
  }

  toFacade() {
    this.mode = 'facade';
    this.controls.enabled = false;
    this.container.classList.remove('is-inside');
    this.controls.setPose(HOME_POSE.pos, HOME_POSE.yaw, HOME_POSE.pitch);
    this.dirty = true;
  }

  _showHint() {
    const h = this.container.querySelector('.store-hint');
    if (!h) return;
    h.hidden = false;
    h.classList.remove('is-fading');
    this._hintShown = performance.now();
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => h.classList.add('is-fading'), 9000);
  }
  _hideHint() {
    const h = this.container.querySelector('.store-hint');
    if (h && !h.hidden && this.mode === 'inside' && performance.now() - this._hintShown > 2500) h.classList.add('is-fading');
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.update();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.timer.update();
      const dt = this.timer.getDelta();
      let active = false;
      if (this.anim) {
        this.anim.t += dt;
        const k = Math.min(1, this.anim.t / this.anim.dur);
        this.anim.step(k);
        if (k >= 1) { const d = this.anim.done; this.anim = null; d(); }
        active = true;
      } else if (this.mode === 'facade') {
        // très léger mouvement de respiration de la caméra devant la vitrine
        const t = performance.now() / 1000;
        const portrait = this.camera.aspect < 0.8;
        this.camera.position.set(Math.sin(t * 0.12) * 0.35, portrait ? 1.6 : 1.7, portrait ? 13.5 : 9.6);
        this.camera.lookAt(0, portrait ? 0.9 : 2.15, -2);
        active = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      if (this.controls.update(dt)) active = true;
      if (active || this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
    };
    loop();
  }

  pause() { this.running = false; cancelAnimationFrame(this.raf); this.controls && (this.controls.keys.clear()); }
  resume() { if (!this.running) { this.dirty = true; this.start(); } }
}
