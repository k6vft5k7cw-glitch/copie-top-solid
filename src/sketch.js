// Esquisse 2D : entités, profils fermés et éditeur interactif
import * as THREE from 'three';
import { circlePts, arcPts, slotPts, makeShape } from './shapes.js';

const D2R = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmt = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');

// ---------------------------------------------------------------- entités
// line {a,b} | rect {x,y,w,h} | circle {c,r} | arc {c,r,a0,a1 (deg, sens trigo)} | polygon {c,r,n,rot} | slot {a,b,r}

export function slotOutline(e) {
  const L = dist(e.a, e.b), ang = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]);
  const cx = (e.a[0] + e.b[0]) / 2, cy = (e.a[1] + e.b[1]) / 2;
  const c = Math.cos(ang), s = Math.sin(ang);
  return slotPts(L, 2 * e.r).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

export function polygonPts(e) {
  const p = [];
  for (let i = 0; i < e.n; i++) {
    const a = (e.rot || 0) * D2R + (i / e.n) * Math.PI * 2;
    p.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
  }
  return p;
}

export function rectPts(e) {
  const x0 = Math.min(e.x, e.x + e.w), y0 = Math.min(e.y, e.y + e.h), w = Math.abs(e.w), h = Math.abs(e.h);
  return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
}

export function arcSample(e, segDeg = 6) {
  let a1 = e.a1;
  while (a1 <= e.a0) a1 += 360;
  const n = Math.max(2, Math.ceil((a1 - e.a0) / segDeg));
  return arcPts(e.c[0], e.c[1], e.r, e.a0 * D2R, a1 * D2R, n);
}

/** Polylignes d'affichage de chaque entité */
export function entityPolyline(e) {
  switch (e.type) {
    case 'line': return { pts: [e.a, e.b], closed: false };
    case 'rect': return { pts: rectPts(e), closed: true };
    case 'circle': return { pts: circlePts(e.r, 72, e.c[0], e.c[1]), closed: true };
    case 'arc': return { pts: arcSample(e), closed: false };
    case 'polygon': return { pts: polygonPts(e), closed: true };
    case 'slot': return { pts: slotOutline(e), closed: true };
    case 'poly': return { pts: e.pts, closed: !!e.closed };
  }
  return { pts: [], closed: false };
}

/** Points d'accroche (extrémités, centres, milieux) */
export function snapPoints(e) {
  switch (e.type) {
    case 'line': return [e.a, e.b, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]];
    case 'rect': return [...rectPts(e), [e.x + e.w / 2, e.y + e.h / 2]];
    case 'circle': return [e.c, [e.c[0] + e.r, e.c[1]], [e.c[0] - e.r, e.c[1]], [e.c[0], e.c[1] + e.r], [e.c[0], e.c[1] - e.r]];
    case 'arc': { const s = arcSample(e); return [e.c, s[0], s[s.length - 1]]; }
    case 'polygon': return [e.c, ...polygonPts(e)];
    case 'slot': return [e.a, e.b];
    case 'poly': return e.pts.length > 400 ? [e.pts[0], e.pts[e.pts.length - 1]] : e.pts;
  }
  return [];
}

function area(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Contours fermés : formes natives + chaînage des lignes / arcs bout à bout */
export function findLoops(entities, tol = 0.01) {
  const loops = [];
  const pieces = [];
  for (const e of entities) {
    if (e.construction) continue;
    const pl = entityPolyline(e);
    if (pl.closed) loops.push(pl.pts);
    else pieces.push(pl.pts.slice());
  }
  const used = new Array(pieces.length).fill(false);
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = pieces[i].slice();
    let grew = true;
    while (grew && dist(chain[0], chain[chain.length - 1]) > tol) {
      grew = false;
      const end = chain[chain.length - 1];
      for (let j = 0; j < pieces.length; j++) {
        if (used[j]) continue;
        const p = pieces[j];
        if (dist(p[0], end) <= tol) { chain = chain.concat(p.slice(1)); used[j] = true; grew = true; break; }
        if (dist(p[p.length - 1], end) <= tol) { chain = chain.concat(p.slice().reverse().slice(1)); used[j] = true; grew = true; break; }
      }
    }
    if (chain.length > 2 && dist(chain[0], chain[chain.length - 1]) <= tol) {
      chain.pop();
      loops.push(chain);
    }
  }
  return loops.filter((l) => Math.abs(area(l)) > 1e-6);
}

/** Construit des THREE.Shape : un contour inclus dans un autre devient un trou (règle pair / impair) */
export function sketchShapes(entities) {
  const loops = findLoops(entities).map((pts) => ({ pts, a: Math.abs(area(pts)), parent: null, depth: 0, holes: [] }));
  loops.sort((a, b) => b.a - a.a);
  for (let i = 0; i < loops.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (inside(loops[i].pts[0], loops[j].pts) || inside(centroid(loops[i].pts), loops[j].pts)) {
        // plus petit contenant = le dernier trouvé en remontant
        loops[i].parent = loops[j];
        break;
      }
    }
  }
  const depthOf = (l) => (l.parent ? depthOf(l.parent) + 1 : 0);
  const shapes = [];
  for (const l of loops) {
    l.depth = depthOf(l);
    if (l.depth % 2 === 1) l.parent.holes.push(l.pts);
  }
  for (const l of loops) if (l.depth % 2 === 0) shapes.push(makeShape(l.pts, l.holes));
  return shapes;
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** Profils pour révolution : contours extérieurs, rayon = |x|, orientés dans le sens trigonométrique */
export function revolveProfiles(entities) {
  const loops = findLoops(entities);
  const outer = loops.filter((l) => !loops.some((o) => o !== l && Math.abs(area(o)) > Math.abs(area(l)) && inside(l[0], o)));
  return outer.map((l) => {
    let q = l.map((p) => [Math.abs(p[0]), p[1]]);
    if (area(q) < 0) q = q.reverse();
    q.push(q[0]);
    return q;
  });
}

// ---------------------------------------------------------------- rendu 3D d'une esquisse
export function sketchObject3D(entities, { selected = new Set(), showFill = true, active = false } = {}) {
  const g = new THREE.Group();
  const colN = active ? 0x1565c0 : 0x2e7d32, colS = 0xff6d00, colC = 0x9e9e9e;
  entities.forEach((e, i) => {
    const { pts, closed } = entityPolyline(e);
    if (!pts.length) return;
    const arr = pts.map((p) => new THREE.Vector3(p[0], p[1], 0));
    if (closed) arr.push(arr[0].clone());
    const geo = new THREE.BufferGeometry().setFromPoints(arr);
    const mat = e.construction
      ? new THREE.LineDashedMaterial({ color: selected.has(i) ? colS : colC, dashSize: 3, gapSize: 2 })
      : new THREE.LineBasicMaterial({ color: selected.has(i) ? colS : colN });
    const line = new THREE.Line(geo, mat);
    if (e.construction) line.computeLineDistances();
    line.userData.entity = i;
    line.renderOrder = 5;
    g.add(line);
  });
  if (showFill) {
    try {
      const shapes = sketchShapes(entities);
      if (shapes.length) {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 24),
          new THREE.MeshBasicMaterial({ color: active ? 0x64b5f6 : 0x81c784, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        m.userData.fill = true;
        g.add(m);
      }
    } catch (err) { /* profil invalide : pas de remplissage */ }
  }
  return g;
}

// ---------------------------------------------------------------- éditeur interactif
const HINTS = {
  select: 'Cliquez sur un élément pour le sélectionner (Maj = multiple). Suppr pour effacer.',
  line: ['Cliquez le point de départ (ou tapez x;y puis Entrée)', 'Cliquez le point suivant ou tapez une longueur (ex. 50 ou 50<30). Clic sur le 1er point = fermer, Échap = terminer'],
  rect: ['Cliquez le premier coin (ou tapez x;y)', 'Cliquez le coin opposé ou tapez largeur;hauteur (ex. 80;40)'],
  crect: ['Cliquez le centre du rectangle', 'Cliquez un coin ou tapez largeur;hauteur'],
  circle: ['Cliquez le centre (ou tapez x;y)', 'Cliquez un point du cercle ou tapez le diamètre'],
  arc: ['Cliquez le centre de l\'arc', 'Cliquez le point de départ (rayon)', 'Cliquez le point d\'arrivée (sens trigonométrique) ou tapez l\'angle'],
  polygon: ['Cliquez le centre du polygone', 'Cliquez un sommet ou tapez le diamètre circonscrit'],
  slot: ['Cliquez le centre du 1er arrondi', 'Cliquez le centre du 2e arrondi ou tapez l\'entraxe', 'Cliquez pour la largeur ou tapez-la'],
};

export class SketchEditor {
  constructor(app, obj) {
    this.app = app;
    this.obj = obj;
    this.tool = 'line';
    this.pts = [];
    this.cursor = [0, 0];
    this.selected = new Set();
    this.typed = '';
    this.polySides = 6;
    this.chainStart = null;
    this.preview = new THREE.Group();
    this.marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 2, 4), new THREE.MeshBasicMaterial({ color: 0xff6d00, depthTest: false, side: THREE.DoubleSide }));
    this.marker.renderOrder = 10;
    this.marker.visible = false;
  }

  get entities() { return this.obj.params.entities; }

  hint() {
    const h = HINTS[this.tool];
    if (typeof h === 'string') return h;
    return h[Math.min(this.pts.length, h.length - 1)];
  }

  setTool(t) {
    this.tool = t;
    this.pts = [];
    this.chainStart = null;
    this.typed = '';
    this.app.updateSketchUI();
  }

  /** Coordonnées locales + accrochage */
  snap(local, ev) {
    const app = this.app;
    let best = null, bestD = 12; // pixels
    const tryPt = (p, kind) => {
      const s = app.viewer.toScreen(this.toWorld(p));
      const d = Math.hypot(s.x - ev.clientX, s.y - ev.clientY);
      if (d < bestD) { bestD = d; best = { p: [p[0], p[1]], kind }; }
    };
    if (app.settings.snapPoints && !ev.shiftKey) {
      tryPt([0, 0], 'origine');
      this.entities.forEach((e) => snapPoints(e).forEach((p) => tryPt(p, 'point')));
      if (this.tool === 'line' && this.pts.length) tryPt(this.pts[0], 'point');
      if (this.chainStart) tryPt(this.chainStart, 'point');
    }
    if (best) return best;
    let p = [local.x, local.y];
    if (app.settings.snapGrid && !ev.shiftKey) {
      const g = app.settings.grid;
      p = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
    }
    // alignement horizontal / vertical en tracé de ligne
    if (this.tool === 'line' && this.pts.length && !ev.shiftKey) {
      const o = this.pts[this.pts.length - 1];
      const dx = p[0] - o[0], dy = p[1] - o[1];
      const ang = Math.abs(Math.atan2(dy, dx) / D2R);
      if (ang < 3 || ang > 177) p[1] = o[1];
      else if (Math.abs(ang - 90) < 3) p[0] = o[0];
    }
    return { p, kind: null };
  }

  toWorld(p) {
    return new THREE.Vector3(p[0], p[1], 0).applyMatrix4(this.app.worldMatrix(this.obj));
  }

  localFromEvent(ev) {
    const m = this.app.worldMatrix(this.obj);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const o = new THREE.Vector3().setFromMatrixPosition(m);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const ray = this.app.viewer.rayFromEvent(ev);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return null;
    return hit.applyMatrix4(m.clone().invert());
  }

  onMove(ev) {
    const l = this.localFromEvent(ev);
    if (!l) return;
    const s = this.snap(l, ev);
    this.cursor = s.p;
    this.marker.visible = !!s.kind;
    if (s.kind) this.marker.position.copy(this.toWorld(s.p));
    this.app.setCoords(`X ${fmt(s.p[0])}  Y ${fmt(s.p[1])}`);
    this.drawPreview();
  }

  onClick(ev) {
    const p = this.cursor.slice();
    if (this.tool === 'select') return this.pick(ev);
    this.addPoint(p);
  }

  addPoint(p) {
    const t = this.tool, P = this.pts;
    const ents = this.entities;
    const done = (e) => { ents.push(e); this.pts = []; this.app.sketchChanged(); };
    if (t === 'line') {
      if (P.length === 0) { P.push(p); this.chainStart = p; this.app.refreshHint(); return; }
      const a = P[P.length - 1];
      if (dist(a, p) < 1e-9) return;
      ents.push({ type: 'line', a, b: p });
      if (this.chainStart && dist(p, this.chainStart) < 1e-6) { this.pts = []; this.chainStart = null; }
      else this.pts = [p];
      this.app.sketchChanged();
      return;
    }
    P.push(p);
    if (t === 'rect' && P.length === 2) return done({ type: 'rect', x: P[0][0], y: P[0][1], w: P[1][0] - P[0][0], h: P[1][1] - P[0][1] });
    if (t === 'crect' && P.length === 2) {
      const w = 2 * Math.abs(P[1][0] - P[0][0]), h = 2 * Math.abs(P[1][1] - P[0][1]);
      return done({ type: 'rect', x: P[0][0] - w / 2, y: P[0][1] - h / 2, w, h });
    }
    if (t === 'circle' && P.length === 2) return done({ type: 'circle', c: P[0], r: dist(P[0], P[1]) });
    if (t === 'polygon' && P.length === 2) {
      return done({ type: 'polygon', c: P[0], r: dist(P[0], P[1]), n: this.polySides, rot: Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]) / D2R });
    }
    if (t === 'arc' && P.length === 3) {
      const r = dist(P[0], P[1]);
      const a0 = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]) / D2R;
      const a1 = Math.atan2(P[2][1] - P[0][1], P[2][0] - P[0][0]) / D2R;
      return done({ type: 'arc', c: P[0], r, a0, a1 });
    }
    if (t === 'slot' && P.length === 3) {
      const r = segDist(P[2], P[0], P[1]);
      return done({ type: 'slot', a: P[0], b: P[1], r: Math.max(r, 0.01) });
    }
    this.app.refreshHint();
    this.drawPreview();
  }

  /** Saisie clavier de valeurs (longueur, diamètre, x;y …) */
  applyTyped(txt) {
    txt = txt.trim().replace(/,/g, '.');
    if (!txt) return;
    const P = this.pts, t = this.tool;
    const nums = txt.split(/[;x*\s]+/).map(Number).filter((v) => !isNaN(v));
    const polar = txt.match(/^(-?[\d.]+)\s*<\s*(-?[\d.]+)$/);
    if (P.length === 0) {
      if (nums.length >= 2) this.addPoint([nums[0], nums[1]]);
      return;
    }
    const o = P[P.length - 1];
    const dirTo = () => {
      const dx = this.cursor[0] - o[0], dy = this.cursor[1] - o[1];
      const l = Math.hypot(dx, dy) || 1;
      return l < 1e-9 ? [1, 0] : [dx / l, dy / l];
    };
    if (t === 'line') {
      if (polar) {
        const L = +polar[1], a = +polar[2] * D2R;
        return this.addPoint([o[0] + L * Math.cos(a), o[1] + L * Math.sin(a)]);
      }
      if (nums.length >= 2) return this.addPoint([o[0] + nums[0], o[1] + nums[1]]);
      const d = dirTo();
      return this.addPoint([o[0] + d[0] * nums[0], o[1] + d[1] * nums[0]]);
    }
    if (t === 'rect' || t === 'crect') {
      const w = nums[0], h = nums.length > 1 ? nums[1] : nums[0];
      const sx = Math.sign(this.cursor[0] - o[0]) || 1, sy = Math.sign(this.cursor[1] - o[1]) || 1;
      return this.addPoint(t === 'rect' ? [o[0] + sx * w, o[1] + sy * h] : [o[0] + w / 2, o[1] + h / 2]);
    }
    if (t === 'circle' || t === 'polygon') {
      const d = dirTo();
      return this.addPoint([o[0] + d[0] * nums[0] / 2, o[1] + d[1] * nums[0] / 2]);
    }
    if (t === 'arc') {
      if (P.length === 1) { const d = dirTo(); return this.addPoint([o[0] + d[0] * nums[0], o[1] + d[1] * nums[0]]); }
      const c = P[0], r = dist(P[0], P[1]);
      const a = Math.atan2(P[1][1] - c[1], P[1][0] - c[0]) + nums[0] * D2R;
      return this.addPoint([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    if (t === 'slot') {
      if (P.length === 1) { const d = dirTo(); return this.addPoint([o[0] + d[0] * nums[0], o[1] + d[1] * nums[0]]); }
      const a = P[0], b = P[1];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
      return this.addPoint([a[0] + Math.cos(ang) * nums[0] / 2, a[1] + Math.sin(ang) * nums[0] / 2]);
    }
  }

  cancel() {
    if (this.pts.length || this.chainStart) { this.pts = []; this.chainStart = null; this.drawPreview(); this.app.refreshHint(); return true; }
    return false;
  }

  pick(ev) {
    const l = this.localFromEvent(ev);
    if (!l) return;
    const p = [l.x, l.y];
    let best = -1, bestD = Infinity;
    const tolPx = 8;
    this.entities.forEach((e, i) => {
      const { pts, closed } = entityPolyline(e);
      const arr = closed ? [...pts, pts[0]] : pts;
      for (let k = 0; k < arr.length - 1; k++) {
        const d = segDist(p, arr[k], arr[k + 1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    const pxSize = this.app.viewer.worldPerPixel(this.toWorld(p));
    if (!ev.shiftKey) this.selected.clear();
    if (best >= 0 && bestD < tolPx * pxSize) {
      if (this.selected.has(best)) this.selected.delete(best); else this.selected.add(best);
    }
    this.app.sketchChanged(false);
  }

  deleteSelected() {
    if (!this.selected.size) return false;
    const keep = this.entities.filter((_, i) => !this.selected.has(i));
    this.obj.params.entities = keep;
    this.selected.clear();
    this.app.sketchChanged();
    return true;
  }

  drawPreview() {
    const g = this.preview;
    while (g.children.length) { const c = g.children.pop(); c.geometry?.dispose(); }
    g.matrixAutoUpdate = false;
    g.matrix.copy(this.app.worldMatrix(this.obj));
    const P = this.pts, c = this.cursor, t = this.tool;
    let ent = null, label = '';
    if (P.length) {
      const o = P[P.length - 1];
      if (t === 'line') { ent = { type: 'line', a: o, b: c }; label = `L ${fmt(dist(o, c))}  ∠ ${fmt(Math.atan2(c[1] - o[1], c[0] - o[0]) / D2R)}°`; }
      if (t === 'rect') { ent = { type: 'rect', x: o[0], y: o[1], w: c[0] - o[0], h: c[1] - o[1] }; label = `${fmt(Math.abs(c[0] - o[0]))} × ${fmt(Math.abs(c[1] - o[1]))}`; }
      if (t === 'crect') { const w = 2 * Math.abs(c[0] - o[0]), h = 2 * Math.abs(c[1] - o[1]); ent = { type: 'rect', x: o[0] - w / 2, y: o[1] - h / 2, w, h }; label = `${fmt(w)} × ${fmt(h)}`; }
      if (t === 'circle') { ent = { type: 'circle', c: o, r: dist(o, c) }; label = `Ø ${fmt(2 * dist(o, c))}`; }
      if (t === 'polygon') { ent = { type: 'polygon', c: o, r: dist(o, c), n: this.polySides, rot: Math.atan2(c[1] - o[1], c[0] - o[0]) / D2R }; label = `Ø ${fmt(2 * dist(o, c))}  (${this.polySides} côtés)`; }
      if (t === 'arc') {
        if (P.length === 1) { ent = { type: 'line', a: o, b: c }; label = `R ${fmt(dist(o, c))}`; }
        else {
          const a0 = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]) / D2R, a1 = Math.atan2(c[1] - P[0][1], c[0] - P[0][0]) / D2R;
          ent = { type: 'arc', c: P[0], r: dist(P[0], P[1]), a0, a1 };
          let sw = a1 - a0; while (sw <= 0) sw += 360;
          label = `R ${fmt(dist(P[0], P[1]))}  ${fmt(sw)}°`;
        }
      }
      if (t === 'slot') {
        if (P.length === 1) { ent = { type: 'line', a: o, b: c }; label = `Entraxe ${fmt(dist(o, c))}`; }
        else { const r = Math.max(segDist(c, P[0], P[1]), 0.01); ent = { type: 'slot', a: P[0], b: P[1], r }; label = `Largeur ${fmt(2 * r)}`; }
      }
    }
    if (ent) {
      const { pts, closed } = entityPolyline(ent);
      const arr = pts.map((q) => new THREE.Vector3(q[0], q[1], 0));
      if (closed) arr.push(arr[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arr), new THREE.LineBasicMaterial({ color: 0xff6d00, depthTest: false }));
      line.renderOrder = 9;
      g.add(line);
    }
    this.app.setCursorLabel(label + (this.typed ? `   ⌨ ${this.typed}` : ''));
  }
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export const ENTITY_FIELDS = {
  line: [['a.0', 'X début'], ['a.1', 'Y début'], ['b.0', 'X fin'], ['b.1', 'Y fin']],
  rect: [['x', 'X coin'], ['y', 'Y coin'], ['w', 'Largeur'], ['h', 'Hauteur']],
  circle: [['c.0', 'X centre'], ['c.1', 'Y centre'], ['r', 'Rayon']],
  arc: [['c.0', 'X centre'], ['c.1', 'Y centre'], ['r', 'Rayon'], ['a0', 'Angle début (°)'], ['a1', 'Angle fin (°)']],
  polygon: [['c.0', 'X centre'], ['c.1', 'Y centre'], ['r', 'Rayon circonscrit'], ['n', 'Nombre de côtés'], ['rot', 'Rotation (°)']],
  poly: [],
  slot: [['a.0', 'X centre 1'], ['a.1', 'Y centre 1'], ['b.0', 'X centre 2'], ['b.1', 'Y centre 2'], ['r', 'Rayon']],
};
export const ENTITY_NAMES = { poly: 'Polyligne', line: 'Ligne', rect: 'Rectangle', circle: 'Cercle', arc: 'Arc', polygon: 'Polygone', slot: 'Oblong' };
