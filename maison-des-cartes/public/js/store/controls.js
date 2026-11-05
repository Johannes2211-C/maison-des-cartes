// Déplacement à hauteur humaine : clavier (ZQSD / WASD / flèches), glisser pour regarder,
// joystick tactile discret, toucher le sol pour s'y rendre. Mouvements amortis, sans effet « jeu vidéo ».
import * as THREE from 'three';

const EYE = 1.62;
const RADIUS = 0.32;
const WALK = 1.35;   // m/s — allure de visite
const BRISK = 2.3;   // avec Maj

export class VisitorControls {
  constructor(camera, dom, colliders) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.enabled = false;
    this.position = new THREE.Vector3(0, EYE, 6);
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.velocity = new THREE.Vector2();
    this.keys = new Set();
    this.joy = new THREE.Vector2();
    this.auto = null; // déplacement guidé { to: Vector3, yaw, pitch, done }
    this.onTap = null; // (clientX, clientY) → appelé pour un clic/toucher sans glisser
    this.onActivity = null;
    this._bind();
  }

  _bind() {
    const el = this.dom;
    const look = { id: null, x: 0, y: 0, sx: 0, sy: 0, moved: false, t: 0 };
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || look.id !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      look.id = e.pointerId; look.x = look.sx = e.clientX; look.y = look.sy = e.clientY; look.moved = false; look.t = performance.now();
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== look.id) return;
      const dx = e.clientX - look.x, dy = e.clientY - look.y;
      look.x = e.clientX; look.y = e.clientY;
      if (Math.hypot(e.clientX - look.sx, e.clientY - look.sy) > 6) look.moved = true;
      if (!look.moved) return;
      const k = e.pointerType === 'touch' ? 0.0055 : 0.0032;
      // on « saisit » la scène : glisser vers la droite fait pivoter le regard vers la gauche
      this.targetYaw += dx * k;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy * k, -0.85, 0.7);
      this.auto = null;
      this.onActivity?.();
    });
    const end = (e) => {
      if (e.pointerId !== look.id) return;
      look.id = null;
      if (!look.moved && performance.now() - look.t < 450) this.onTap?.(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { if (e.pointerId === look.id) look.id = null; });

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const handled = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
      if (handled.includes(e.code)) {
        // e.code désigne la touche physique : ZQSD sur AZERTY = WASD sur QWERTY.
        this.keys.add(e.code);
        this.auto = null;
        this.onActivity?.();
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setPose(pos, yaw, pitch = 0) {
    this.position.copy(pos);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.velocity.set(0, 0);
    this.apply();
  }

  /** S'approcher d'un point en douceur, puis regarder une cible. */
  walkTo(point, lookAt, onDone, { free = false, pass = false } = {}) {
    const to = new THREE.Vector3(point.x, EYE, point.z);
    const yaw = lookAt ? Math.atan2(-(lookAt.x - to.x), -(lookAt.z - to.z)) : null;
    const pitch = lookAt ? Math.atan2(lookAt.y - EYE, Math.hypot(lookAt.x - to.x, lookAt.z - to.z)) : null;
    this.auto = { to, yaw, pitch, onDone, free, pass };
  }

  /** Parcours guidé par points de passage (allée centrale), regard dans le sens de la marche. */
  walkPath(points, lookAt, onDone) {
    const go = (i) => {
      const last = i === points.length - 1;
      const next = last ? lookAt : new THREE.Vector3(points[i + 1].x, EYE, points[i + 1].z);
      const ahead = last ? lookAt : new THREE.Vector3(points[i].x * 2 - this.position.x, EYE, points[i].z * 2 - this.position.z);
      this.walkTo(points[i], last ? lookAt : (Math.hypot(points[i].x - this.position.x, points[i].z - this.position.z) > 0.5 ? ahead : next), last ? onDone : () => go(i + 1), { free: true, pass: !last });
    };
    go(0);
  }

  _collide(p) {
    for (const c of this.colliders) {
      if (p.x > c.minX - RADIUS && p.x < c.maxX + RADIUS && p.z > c.minZ - RADIUS && p.z < c.maxZ + RADIUS) return true;
    }
    return false;
  }

  _tryMove(dx, dz) {
    const p = this.position;
    const nx = { x: p.x + dx, z: p.z };
    if (!this._collide(nx)) p.x = nx.x; else this.velocity.x *= 0.2;
    const nz = { x: p.x, z: p.z + dz };
    if (!this._collide(nz)) p.z = nz.z; else this.velocity.y *= 0.2;
  }

  update(dt) {
    if (!this.enabled) return false;
    dt = Math.min(dt, 0.05);
    let moving = false;
    const k = this.keys;
    let fx = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let sx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    if (turn) this.targetYaw += turn * 1.4 * dt;
    fx += -this.joy.y; sx += this.joy.x;
    const len = Math.hypot(fx, sx);
    if (len > 1) { fx /= len; sx /= len; }
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? BRISK : WALK;

    let wantX = 0, wantZ = 0;
    if (this.auto) {
      const d = new THREE.Vector2(this.auto.to.x - this.position.x, this.auto.to.z - this.position.z);
      const dist = d.length();
      if (this.auto.yaw !== null) {
        let dy = this.auto.yaw - this.targetYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.targetYaw += dy * Math.min(1, dt * 3.2);
        this.targetPitch += (this.auto.pitch - this.targetPitch) * Math.min(1, dt * 3.2);
      }
      if (this.auto.pass && dist < 0.3) {
        const cb = this.auto.onDone; this.auto = null; cb?.();
      } else if (dist < 0.04) {
        const settled = this.auto.yaw === null || Math.abs(Math.atan2(Math.sin(this.auto.yaw - this.yaw), Math.cos(this.auto.yaw - this.yaw))) < 0.03;
        if (settled) { const cb = this.auto.onDone; this.auto = null; cb?.(); }
      } else {
        const v = Math.min(speed * 1.2, dist * 2.2 + 0.2);
        d.normalize().multiplyScalar(v);
        wantX = d.x; wantZ = d.y;
      }
      moving = true;
    } else if (len > 0.01) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      wantX = (-sin * fx + cos * sx) * speed;
      wantZ = (-cos * fx - sin * sx) * speed;
    }
    // accélération / freinage progressifs
    const a = 1 - Math.exp(-dt * 6);
    this.velocity.x += (wantX - this.velocity.x) * a;
    this.velocity.y += (wantZ - this.velocity.y) * a;
    if (this.velocity.lengthSq() > 1e-5) {
      const before = this.position.clone();
      if (this.auto?.free) { this.position.x += this.velocity.x * dt; this.position.z += this.velocity.y * dt; }
      else this._tryMove(this.velocity.x * dt, this.velocity.y * dt);
      if (this.auto && before.distanceToSquared(this.position) < 1e-9 && Math.hypot(wantX, wantZ) > 0.1) {
        // bloqué par un meuble : on s'arrête simplement et on termine l'approche
        const cb = this.auto.onDone; this.auto = null; cb?.();
      }
      moving = true;
    }
    const ry = 1 - Math.exp(-dt * 12);
    const dyaw = this.targetYaw - this.yaw;
    const dp = this.targetPitch - this.pitch;
    if (Math.abs(dyaw) > 1e-4 || Math.abs(dp) > 1e-4) moving = true;
    this.yaw += dyaw * ry;
    this.pitch += dp * ry;
    this.apply();
    return moving;
  }

  apply() {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

/** Joystick virtuel discret (écrans tactiles). */
export function attachJoystick(el, controls) {
  const knob = el.querySelector('.joystick__knob');
  let id = null, cx = 0, cy = 0;
  const R = 46;
  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    el.setPointerCapture(id);
    move(e);
    e.stopPropagation();
  });
  const move = (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    controls.joy.set(dx / R, dy / R);
    controls.auto = null;
    controls.onActivity?.();
  };
  el.addEventListener('pointermove', move);
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = '';
    controls.joy.set(0, 0);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
