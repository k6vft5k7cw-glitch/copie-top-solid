// Primitives géométriques de base (unités : mm, axe Z vers le haut)
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const DEG = Math.PI / 180;

/** Géométrie non indexée avec uniquement position + normal (requis pour le CSG et la fusion). */
export function clean(g) {
  const r = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', r.getAttribute('position').clone());
  if (r.getAttribute('normal')) out.setAttribute('normal', r.getAttribute('normal').clone());
  else out.computeVertexNormals();
  return out;
}

export function merge(list) {
  const parts = list.filter(Boolean).map(clean);
  if (parts.length === 1) return parts[0];
  return mergeGeometries(parts, false);
}

export function cyl(r, h, z0 = 0, seg = 48) {
  return new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2).translate(0, 0, z0 + h / 2);
}

export function cone(rBottom, rTop, h, z0 = 0, seg = 48) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg).rotateX(Math.PI / 2).translate(0, 0, z0 + h / 2);
}

export function circlePts(r, n = 48, cx = 0, cy = 0, a0 = 0) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

export function polyPts(n, R, rot = 0, cx = 0, cy = 0) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    p.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return p;
}

export function arcPts(cx, cy, r, a0, a1, n = 8) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

export function roundRectPts(w, h, r, cx = 0, cy = 0) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 1e-6) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  const x = w / 2 - r, y = h / 2 - r, H = Math.PI / 2;
  return [
    ...arcPts(cx + x, cy - y, r, -H, 0, 6),
    ...arcPts(cx + x, cy + y, r, 0, H, 6),
    ...arcPts(cx - x, cy + y, r, H, 2 * H, 6),
    ...arcPts(cx - x, cy - y, r, 2 * H, 3 * H, 6),
  ];
}

export function slotPts(L, w, cx = 0, cy = 0) {
  // oblong horizontal : entraxe L, largeur w
  const r = w / 2, H = Math.PI / 2;
  return [...arcPts(cx + L / 2, cy, r, -H, H, 16), ...arcPts(cx - L / 2, cy, r, H, 3 * H, 16)];
}

export function makeShape(outer, holes = []) {
  const s = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  return s;
}

export function prism(shape, h, z0 = 0) {
  const shapes = Array.isArray(shape) ? shape : [shape];
  return new THREE.ExtrudeGeometry(shapes, { depth: h, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, z0);
}

/** profil [[r, z], ...] tourné autour de Z */
export function lathe(profile, seg = 64, phi = Math.PI * 2) {
  return creased(new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p[0], p[1])), seg, 0, phi).rotateX(Math.PI / 2));
}

/** Normales lissées uniquement entre faces proches (< 30°) : arêtes vives nettes */
export function creased(g, angle = 30) {
  return toCreasedNormals(g.index ? g.toNonIndexed() : g, (angle * Math.PI) / 180);
}

/** Oriente une géométrie construite le long de +Z vers l'axe demandé */
export function orientAxis(g, axis) {
  if (axis === 'X') g.rotateY(Math.PI / 2);
  else if (axis === 'Y') g.rotateX(-Math.PI / 2);
  return g;
}

const P = (k, label, def, extra = {}) => ({ k, label, def, unit: 'mm', min: 0, ...extra });

export const BASIC = {
  box: {
    label: 'Bloc', icon: 'box',
    params: [P('l', 'Longueur (X)', 100), P('w', 'Largeur (Y)', 60), P('h', 'Hauteur (Z)', 20), P('r', 'Congé des arêtes', 0)],
    build: (p) => {
      const r = Math.min(p.r || 0, p.l / 2 - 0.01, p.w / 2 - 0.01, p.h / 2 - 0.01);
      return (r > 0.01 ? new RoundedBoxGeometry(p.l, p.w, p.h, 4, r) : new THREE.BoxGeometry(p.l, p.w, p.h)).translate(0, 0, p.h / 2);
    },
  },
  cylinder: {
    label: 'Cylindre', icon: 'cylinder',
    params: [P('d', 'Diamètre', 40), P('h', 'Hauteur', 50), P('c', 'Chanfrein des bords (45°)', 0)],
    build: (p) => {
      const R = p.d / 2, c = Math.min(p.c || 0, R - 0.01, p.h / 2 - 0.01);
      if (c <= 0.01) return cyl(R, p.h, 0, 64);
      return lathe([[0, 0], [R - c, 0], [R, c], [R, p.h - c], [R - c, p.h], [0, p.h]], 64);
    },
  },
  tube: {
    label: 'Tube', icon: 'tube',
    params: [P('de', 'Ø extérieur', 40), P('di', 'Ø intérieur', 30), P('h', 'Hauteur', 50)],
    build: (p) => prism(makeShape(circlePts(p.de / 2, 64), [circlePts(Math.min(p.di, p.de * 0.99) / 2, 64)]), p.h),
  },
  cone: {
    label: 'Cône', icon: 'cone',
    params: [P('d1', 'Ø bas', 40), P('d2', 'Ø haut', 0), P('h', 'Hauteur', 50)],
    build: (p) => cone(p.d1 / 2, p.d2 / 2, p.h, 0, 64),
  },
  sphere: {
    label: 'Sphère', icon: 'sphere',
    params: [P('d', 'Diamètre', 40)],
    build: (p) => new THREE.SphereGeometry(p.d / 2, 48, 32).translate(0, 0, p.d / 2),
  },
  torus: {
    label: 'Tore', icon: 'torus',
    params: [P('D', 'Ø moyen', 60), P('d', 'Ø section', 10)],
    build: (p) => new THREE.TorusGeometry(p.D / 2, p.d / 2, 32, 96).translate(0, 0, p.d / 2),
  },
  wedge: {
    label: 'Coin / rampe', icon: 'wedge',
    params: [P('l', 'Longueur (X)', 100), P('w', 'Largeur (Y)', 50), P('h', 'Hauteur (Z)', 40)],
    build: (p) => prism(makeShape([[-p.l / 2, 0], [p.l / 2, 0], [-p.l / 2, p.h]]), p.w).rotateX(Math.PI / 2).translate(0, p.w / 2, 0),
  },
  plate: {
    label: 'Plaque percée', icon: 'plate',
    params: [P('l', 'Longueur (X)', 120), P('w', 'Largeur (Y)', 80), P('h', 'Épaisseur', 8), P('r', 'Rayon des coins', 5),
      P('hd', 'Ø des 4 trous', 9), P('m', 'Distance trous / bord', 10)],
    build: (p) => {
      const holes = [];
      if (p.hd > 0) {
        const x = p.l / 2 - p.m, y = p.w / 2 - p.m;
        for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) holes.push(circlePts(p.hd / 2, 32, sx * x, sy * y).reverse());
      }
      return prism(makeShape(roundRectPts(p.l, p.w, p.r), holes), p.h);
    },
  },
};

/** Cordon de soudure (représentation) : gorge a, longueur L, le long de +X */
export function buildWeld(p) {
  const r = Math.max(0.3, (p.a * Math.SQRT2) / 2);
  const L = Math.max(0.1, p.L);
  return new THREE.CapsuleGeometry(r, L, 4, 12).rotateZ(-Math.PI / 2).translate(L / 2, 0, 0);
}

/** Perçage : outil d'enlèvement le long de -Z (posé sur une face) */
export const HOLE_PRESETS = {
  'Passage M3': 3.4, 'Passage M4': 4.5, 'Passage M5': 5.5, 'Passage M6': 6.6, 'Passage M8': 9, 'Passage M10': 11,
  'Passage M12': 13.5, 'Passage M16': 17.5, 'Passage M20': 22,
  'Taraudage M3 (Ø2,5)': 2.5, 'Taraudage M4 (Ø3,3)': 3.3, 'Taraudage M5 (Ø4,2)': 4.2, 'Taraudage M6 (Ø5)': 5,
  'Taraudage M8 (Ø6,8)': 6.8, 'Taraudage M10 (Ø8,5)': 8.5, 'Taraudage M12 (Ø10,2)': 10.2, 'Taraudage M16 (Ø14)': 14,
};

export function buildHole(p) {
  const depth = p.through ? 5000 : p.depth;
  const eps = 0.05;
  const parts = [cyl(p.d / 2, depth + eps, -depth, 48)];
  if (p.kind === 'lamage' && p.D2 > p.d) parts.push(cyl(p.D2 / 2, p.h2 + eps, -p.h2, 48));
  if (p.kind === 'fraisage' && p.D2 > p.d) {
    const hc = (p.D2 - p.d) / 2; // fraisure à 90°
    parts.push(cone(p.d / 2, p.D2 / 2 + eps, hc + eps, -hc, 48));
  }
  return merge(parts);
}
