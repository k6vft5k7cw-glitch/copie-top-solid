// Chaudronnerie / tôlerie : volumes 3D en tôle et leurs développés à plat (fibre neutre)
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { clean, merge, creased, prism, makeShape, circlePts } from './shapes.js';

const D2R = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- outils géométriques
/** Solide fermé à partir d'anneaux fermés de même nombre de points, reliés cycliquement */
export function ringsSolid(rings) {
  const R = rings.length, n = rings[0].length;
  const pos = [];
  const push = (...vs) => { for (const v of vs) pos.push(v.x, v.y, v.z); };
  for (let r = 0; r < R; r++) {
    const A = rings[r], B = rings[(r + 1) % R];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      push(A[i], A[j], B[j]);
      push(A[i], B[j], B[i]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  orient(g);
  return creased(g, 35);
}

/** Retourne les triangles si le volume signé est négatif (normales vers l'extérieur) */
function orient(g) {
  const p = g.getAttribute('position').array;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  if (v < 0) {
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    }
  }
}

/** Surface réglée (génératrices bas→haut, boucle fermée) épaissie de e de part et d'autre */
function ruledSolid(rulings, e) {
  const n = rulings.length;
  const offs = [];
  for (let i = 0; i < n; i++) {
    const [B, T] = rulings[i];
    const [Bp, Tp] = rulings[(i - 1 + n) % n], [Bn, Tn] = rulings[(i + 1) % n];
    const tan = Bn.clone().add(Tn).sub(Bp).sub(Tp);
    const nn = tan.cross(T.clone().sub(B)).normalize();
    // décalage horizontal pour garder les bords dans leurs plans (bas et haut)
    const h = nn.clone().setZ(0);
    offs.push(h.lengthSq() > 1e-9 ? h.normalize().multiplyScalar((e / 2) / Math.max(0.2, Math.hypot(nn.x, nn.y))) : nn.multiplyScalar(e / 2));
  }
  // un sommet partagé par plusieurs génératrices (éventail) reçoit un décalage unique : pas de repli
  const shared = (k) => {
    const acc = new Map();
    rulings.forEach((r, i) => { const a = acc.get(r[k]) || V(0, 0, 0); acc.set(r[k], a.add(offs[i])); });
    const cnt = new Map();
    rulings.forEach((r) => cnt.set(r[k], (cnt.get(r[k]) || 0) + 1));
    const len = new Map();
    rulings.forEach((r, i) => len.set(r[k], Math.max(len.get(r[k]) || 0, offs[i].length())));
    const one = new Map();
    for (const [key, a] of acc) one.set(key, a.clone().normalize().multiplyScalar(len.get(key)));
    return rulings.map((r, i) => (cnt.get(r[k]) > 1 ? one.get(r[k]) : offs[i]));
  };
  const ofB = shared(0), ofT = shared(1);
  const ob = [], ot = [], it = [], ib = [];
  rulings.forEach(([B, T], i) => {
    ob.push(B.clone().add(ofB[i])); ot.push(T.clone().add(ofT[i]));
    it.push(T.clone().sub(ofT[i])); ib.push(B.clone().sub(ofB[i]));
  });
  return ringsSolid([ob, ot, it, ib]);
}

/** Déplie une bande de génératrices (surface réglée développable) dans le plan */
function unfoldRulings(rulings) {
  const fb = [], ft = [];
  const place = (pa, pb, da, db, avoid) => {
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (da < 1e-9) return pa.slice();
    if (db < 1e-9) return pb.slice();
    const a = (da * da - db * db + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, da * da - a * a));
    const ux = (pb[0] - pa[0]) / d, uy = (pb[1] - pa[1]) / d;
    const mx = pa[0] + a * ux, my = pa[1] + a * uy;
    const c1 = [mx - h * uy, my + h * ux], c2 = [mx + h * uy, my - h * ux];
    const side = (c) => (pb[0] - pa[0]) * (c[1] - pa[1]) - (pb[1] - pa[1]) * (c[0] - pa[0]);
    if (!avoid) return c2;
    return Math.sign(side(c1)) !== Math.sign(side(avoid)) ? c1 : c2;
  };
  const [B0, T0] = rulings[0];
  fb.push([0, 0]); ft.push([0, B0.distanceTo(T0)]);
  let prevB = null;
  for (let i = 0; i + 1 < rulings.length; i++) {
    const [Bi, Ti] = rulings[i], [Bn, Tn] = rulings[i + 1];
    const tn = place(fb[i], ft[i], Bi.distanceTo(Tn), Ti.distanceTo(Tn), prevB);
    ft.push(tn);
    const bn = Bi.distanceTo(Bn) < 1e-9 ? fb[i].slice() : place(fb[i], tn, Bi.distanceTo(Bn), Tn.distanceTo(Bn), ft[i]);
    fb.push(bn);
    prevB = fb[i];
  }
  return { fb, ft };
}

function dedupePts(pts, tol = 1e-6) {
  const out = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > tol) out.push(p);
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < tol) out.pop();
  return out;
}

function normalizeFlat(entities, texts = []) {
  let minX = Infinity, minY = Infinity;
  const each = (p) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); };
  for (const e of entities) {
    if (e.type === 'poly') e.pts.forEach(each);
    else if (e.type === 'line') { each(e.a); each(e.b); }
    else if (e.type === 'arc' || e.type === 'circle') each([e.c[0] - e.r, e.c[1] - e.r]);
  }
  const sh = (p) => [p[0] - minX, p[1] - minY];
  for (const e of entities) {
    if (e.type === 'poly') e.pts = e.pts.map(sh);
    else if (e.type === 'line') { e.a = sh(e.a); e.b = sh(e.b); }
    else if (e.c) e.c = sh(e.c);
  }
  for (const t of texts) t.p = sh(t.p);
  return { entities, texts };
}

/** Diamètres moyens (fibre neutre) selon la cote donnée */
function radii(D, e, ref) {
  const o = ref === 'Intérieur' ? D / 2 + e : ref === 'Fibre neutre' ? D / 2 + e / 2 : D / 2;
  return { ro: o, ri: o - e, rm: o - e / 2 };
}

const P = (k, label, def, extra = {}) => ({ k, label, def, unit: 'mm', min: 0, ...extra });
const REF = { k: 'ref', label: 'Cotes données à', def: 'Extérieur', options: ['Extérieur', 'Intérieur', 'Fibre neutre'] };
const E = P('e', 'Épaisseur tôle', 3, { min: 0.1 });

// ---------------------------------------------------------------- générateurs
export const SHEET = {
  // ------------------------------------------------------------ tôle pliée
  bent: {
    label: 'Tôle pliée', icon: 'bent',
    params: [
      { k: 'profile', label: 'Profil (long;angle;long…)', def: '40;90;80;90;40', unit: '', text: true },
      P('W', 'Largeur', 200), E, P('Ri', 'Rayon intérieur de pliage', 3), { k: 'K', label: 'Facteur K', def: 0.33, unit: '', min: 0, step: 0.01 },
    ],
    help: 'Longueurs = cotes extérieures (hors-tout) de chaque aile. Angles en degrés : positif = pli vers le haut, négatif = vers le bas (90 = équerre).',
    parse(p) {
      const v = String(p.profile).replace(/,/g, '.').split(/[;\s]+/).filter(Boolean).map(Number);
      if (v.length < 1 || v.length % 2 === 0 || v.some((x) => !Number.isFinite(x))) throw new Error('Profil invalide : alternez longueur;angle;longueur… (ex. 40;90;80)');
      const L = [], A = [];
      v.forEach((x, i) => (i % 2 ? A : L).push(x));
      const e = p.e, Ri = p.Ri;
      const sb = A.map((a) => (Ri + e) * Math.tan((Math.min(Math.abs(a), 179) * D2R) / 2));
      const straight = L.map((l, i) => l - (i > 0 ? sb[i - 1] : 0) - (i < A.length ? sb[i] : 0));
      if (straight.some((s) => s < -1e-6)) throw new Error('Aile trop courte pour ce rayon de pliage');
      const ba = A.map((a) => Math.abs(a) * D2R * (Ri + p.K * e));
      return { L, A, straight: straight.map((s) => Math.max(0, s)), ba };
    },
    build(p) {
      const { A, straight } = this.parse(p);
      const Rm = p.Ri + p.e / 2;
      const pts = [];
      let x = 0, y = 0, h = 0;
      const add = () => pts.push([x, y, h]);
      add();
      straight.forEach((s, i) => {
        x += s * Math.cos(h); y += s * Math.sin(h); add();
        if (i < A.length) {
          const a = A[i] * D2R, sg = Math.sign(a) || 1;
          const cx = x - sg * Rm * Math.sin(h), cy = y + sg * Rm * Math.cos(h);
          const n = Math.max(2, Math.ceil(Math.abs(A[i]) / 6));
          const h0 = h;
          for (let k = 1; k <= n; k++) {
            h = h0 + (a * k) / n;
            x = cx + sg * Rm * Math.sin(h); y = cy - sg * Rm * Math.cos(h); add();
          }
        }
      });
      const left = pts.map(([px, py, ph]) => [px - Math.sin(ph) * p.e / 2, py + Math.cos(ph) * p.e / 2]);
      const right = pts.map(([px, py, ph]) => [px + Math.sin(ph) * p.e / 2, py - Math.cos(ph) * p.e / 2]);
      const outline = dedupePts([...left, ...right.reverse()]);
      return prism(makeShape(outline), p.W).rotateX(Math.PI / 2).translate(0, p.W / 2, 0);
    },
    flat(p) {
      const { L, A, straight, ba } = this.parse(p);
      const total = straight.reduce((a, b) => a + b, 0) + ba.reduce((a, b) => a + b, 0);
      const ents = [{ type: 'poly', pts: [[0, 0], [total, 0], [total, p.W], [0, p.W]], closed: true }];
      const texts = [];
      let x = 0;
      straight.forEach((s, i) => {
        x += s;
        if (i < A.length) {
          const xc = x + ba[i] / 2;
          ents.push({ type: 'line', a: [xc, 0], b: [xc, p.W], construction: true, layer: 'PLIAGE' });
          texts.push({ p: [xc + 1, p.W / 2], h: Math.max(2.5, p.W / 40), txt: `Pli ${i + 1} : ${Math.abs(A[i])}° ${A[i] >= 0 ? 'haut' : 'bas'} Ri${p.Ri}`, layer: 'PLIAGE' });
          x += ba[i];
        }
      });
      const info = [
        ['Longueur développée', total], ['Largeur', p.W],
        ...A.map((a, i) => [`Pli ${i + 1} : ${a}° – longueur d'arc (BA)`, ba[i]]),
        ['Somme des cotes extérieures', L.reduce((a, b) => a + b, 0)],
      ];
      return { entities: ents, texts, info };
    },
  },

  // ------------------------------------------------------------ virole
  shell: {
    label: 'Virole', icon: 'tube',
    params: [P('D', 'Diamètre', 300), REF, E, P('H', 'Hauteur', 400)],
    build(p) {
      const { ro, ri } = radii(p.D, p.e, p.ref);
      return prism(makeShape(circlePts(ro, 96), [circlePts(ri, 96)]), p.H);
    },
    flat(p) {
      const { rm } = radii(p.D, p.e, p.ref);
      const L = 2 * Math.PI * rm;
      return { entities: [{ type: 'poly', pts: [[0, 0], [L, 0], [L, p.H], [0, p.H]], closed: true }], texts: [], info: [['Longueur développée (π × Dm)', L], ['Hauteur', p.H], ['Diamètre moyen', 2 * rm]] };
    },
  },

  // ------------------------------------------------------------ tronc de cône
  cone: {
    label: 'Tronc de cône', icon: 'cone',
    params: [P('D1', 'Diamètre bas', 400), P('D2', 'Diamètre haut', 200), REF, E, P('H', 'Hauteur', 250), P('ex', 'Excentration (cône oblique)', 0, { min: -1e6 })],
    rulings(p, n = 144) {
      const a = radii(p.D1, p.e, p.ref).rm, b = radii(p.D2, p.e, p.ref).rm;
      const r = [];
      for (let i = 0; i < n; i++) {
        const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
        r.push([V(a * Math.cos(t), a * Math.sin(t), 0), V(p.ex + b * Math.cos(t), b * Math.sin(t), p.H)]);
      }
      return r;
    },
    build(p) { return ruledSolid(this.rulings(p), p.e); },
    flat(p) {
      const a = radii(p.D1, p.e, p.ref).rm, b = radii(p.D2, p.e, p.ref).rm;
      if (Math.abs(p.ex) < 1e-9 && Math.abs(a - b) > 1e-6) {
        // cône droit : secteur d'anneau exact (arcs)
        const g = Math.hypot(p.H, a - b);
        const big = Math.max(a, b), small = Math.min(a, b);
        const L1 = (big * g) / (big - small), L2 = L1 - g;
        const th = (2 * Math.PI * big) / L1 / D2R;
        if (th >= 359.9) throw new Error('Cône trop plat : le développé dépasse un tour, faites-le en 2 parties');
        const a0 = 90 - th / 2, a1 = 90 + th / 2;
        const pt = (R, ang) => [R * Math.cos(ang * D2R), R * Math.sin(ang * D2R)];
        const ents = [
          { type: 'arc', c: [0, 0], r: L1, a0, a1 },
          { type: 'line', a: pt(L1, a1), b: pt(L2, a1) },
          { type: 'line', a: pt(L2, a0), b: pt(L1, a0) },
        ];
        if (L2 > 1e-6) ents.push({ type: 'arc', c: [0, 0], r: L2, a0, a1 });
        return { ...normalizeFlat(ents), info: [['Rayon extérieur du développé', L1], ['Rayon intérieur du développé', L2], ['Angle du secteur (°)', th], ['Génératrice', g]] };
      }
      const r = this.rulings(p);
      r.push(r[0]);
      const { fb, ft } = unfoldRulings(r);
      const pts = dedupePts([...fb, ...ft.slice().reverse()]);
      return { ...normalizeFlat([{ type: 'poly', pts, closed: true }]), info: [['Génératrice la plus longue', Math.max(...r.map(([B, T]) => B.distanceTo(T)))], ['Génératrice la plus courte', Math.min(...r.map(([B, T]) => B.distanceTo(T)))]] };
    },
  },

  // ------------------------------------------------------------ coude segmenté
  elbow: {
    label: 'Coude segmenté', icon: 'elbow',
    params: [P('D', 'Diamètre', 200), REF, E, P('R', 'Rayon de cintrage (axe)', 300), P('A', 'Angle total', 90, { unit: '°' }), { k: 'N', label: 'Nombre de segments', def: 4, min: 1, step: 1, unit: '' }],
    build(p) { return elbowSolid(p, 72); },
    flat(p) {
      const { rm } = radii(p.D, p.e, p.ref);
      const N = Math.max(1, Math.round(p.N)), g = ((p.A / N) * D2R) / 2;
      const n = 144, top = [], bot = [];
      for (let i = 0; i <= n; i++) {
        const f = (i / n) * Math.PI * 2;
        const t = (p.R + rm * Math.cos(f)) * Math.tan(g);
        top.push([rm * f, t]); bot.push([rm * f, -t]);
      }
      const pts = dedupePts([...bot, ...top.reverse()]);
      return { ...normalizeFlat([{ type: 'poly', pts, closed: true }]), info: [['Nombre de segments identiques à découper', N], ['Longueur développée (π × Dm)', 2 * Math.PI * rm], ['Génératrice extrados', 2 * (p.R + rm) * Math.tan(g)], ['Génératrice intrados', 2 * (p.R - rm) * Math.tan(g)]] };
    },
  },

  // ------------------------------------------------------------ piquage
  branch: {
    label: 'Piquage', icon: 'branch',
    params: [P('Dp', 'Ø tube principal', 300), P('Lp', 'Longueur tube principal', 600), P('d', 'Ø piquage', 150), REF, E,
      P('H', 'Hauteur piquage / axe principal', 300), P('ex', 'Excentration', 0, { min: -1e6 })],
    dims(p) {
      const M = radii(p.Dp, p.e, p.ref), b = radii(p.d, p.e, p.ref);
      if (Math.abs(p.ex) + b.ro > M.ro + 1e-6) throw new Error('Le piquage déborde du tube principal (diamètre + excentration trop grands)');
      if (p.H <= M.ro) throw new Error('La hauteur du piquage doit dépasser le rayon du tube principal');
      return { M, b };
    },
    build(p) {
      const { M, b } = this.dims(p);
      const n = 96, rings = [[], [], [], []];
      for (let i = 0; i < n; i++) {
        const f = (i / n) * Math.PI * 2;
        for (const [k, rho, top] of [[0, b.ro, false], [1, b.ro, true], [2, b.ri, true], [3, b.ri, false]]) {
          const x = rho * Math.cos(f), y = p.ex + rho * Math.sin(f);
          rings[k].push(V(x, y, top ? p.H : Math.sqrt(Math.max(0, M.ro * M.ro - y * y))));
        }
      }
      const br = ringsSolid(rings);
      const main = clean(prism(makeShape(circlePts(M.ro, 96), [circlePts(M.ri, 96)]), p.Lp).translate(0, 0, -p.Lp / 2).rotateY(Math.PI / 2));
      const tool = clean(prism(makeShape(circlePts(b.ri, 64, 0, p.ex)), M.ro + 10));
      let g = main;
      try {
        const ev = new Evaluator(); ev.attributes = ['position', 'normal']; ev.useGroups = false;
        const A = new Brush(main), B = new Brush(tool);
        A.updateMatrixWorld(); B.updateMatrixWorld();
        g = clean(ev.evaluate(A, B, SUBTRACTION).geometry);
      } catch { /* trou non calculé */ }
      return merge([g, br]);
    },
    flat(p) {
      const { M, b } = this.dims(p);
      const n = 144, cut = [];
      for (let i = 0; i <= n; i++) {
        const f = (i / n) * Math.PI * 2, y = p.ex + b.rm * Math.sin(f);
        cut.push([b.rm * f, Math.sqrt(Math.max(0, M.ro * M.ro - y * y))]);
      }
      const Lb = 2 * Math.PI * b.rm;
      const branchPts = dedupePts([...cut, [Lb, p.H], [0, p.H]]);
      const minY = Math.min(...cut.map((q) => q[1]));
      const brEnt = { type: 'poly', pts: branchPts.map((q) => [q[0], q[1] - minY]), closed: true };
      // tube principal développé avec le trou
      const W = 2 * Math.PI * M.rm, ox = Lb + 40;
      const hole = [];
      for (let i = 0; i < n; i++) {
        const f = (i / n) * Math.PI * 2;
        const x = b.ri * Math.cos(f), y = p.ex + b.ri * Math.sin(f);
        hole.push([ox + p.Lp / 2 + x, W / 2 + M.rm * Math.asin(Math.max(-1, Math.min(1, y / M.ro)))]);
      }
      const ents = [brEnt,
        { type: 'poly', pts: [[ox, 0], [ox + p.Lp, 0], [ox + p.Lp, W], [ox, W]], closed: true },
        { type: 'poly', pts: hole, closed: true },
        { type: 'line', a: [ox, W / 2], b: [ox + p.Lp, W / 2], construction: true, layer: 'AXE' }];
      const texts = [{ p: [0, -12], h: 6, txt: 'PIQUAGE' }, { p: [ox, -12], h: 6, txt: 'TUBE PRINCIPAL (axe du piquage en pointillé)' }];
      return { entities: ents, texts, info: [['Piquage : longueur développée', Lb], ['Piquage : hauteur maxi', p.H - minY], ['Tube principal : développé', W], ['Tube principal : longueur', p.Lp]] };
    },
  },

  // ------------------------------------------------------------ transitions
  transition: {
    label: 'Transition carré-rond', icon: 'hopper',
    params: [P('a', 'Rectangle bas : longueur (X)', 400), P('b', 'Rectangle bas : largeur (Y)', 300), { k: 'top', label: 'Forme du haut', def: 'Rond', options: ['Rond', 'Rectangle'] },
      P('D', 'Ø haut (si rond)', 200), P('c', 'Rect. haut : longueur (si rect.)', 150), P('d2', 'Rect. haut : largeur (si rect.)', 100),
      P('H', 'Hauteur', 300), P('ex', 'Décalage du haut en X', 0, { min: -1e6 }), P('ey', 'Décalage du haut en Y', 0, { min: -1e6 }), E],
    help: 'Cotes à la fibre neutre (milieu de l\'épaisseur). Les lignes de pliage / roulage sont sur le calque PLIAGE.',
    rulings(p, nArc = 12) {
      const a = p.a / 2, b = p.b / 2;
      const C = [V(a, b, 0), V(-a, b, 0), V(-a, -b, 0), V(a, -b, 0)];
      const M = V(a, 0, 0);
      const r = [];
      if (p.top === 'Rectangle') {
        const c = p.c / 2, d = p.d2 / 2;
        const T = [V(c, d, p.H), V(-c, d, p.H), V(-c, -d, p.H), V(c, -d, p.H)].map((v) => v.add(V(p.ex, p.ey, 0)));
        r.push([M, V(p.ex + c, p.ey, p.H)]);
        for (let k = 0; k < 4; k++) r.push([C[k], T[k]]);
        r.push([M, V(p.ex + c, p.ey, p.H)]);
        return { r, folds: [1, 2, 3, 4] };
      }
      const R = p.D / 2;
      const c = (t) => V(p.ex + R * Math.cos(t), p.ey + R * Math.sin(t), p.H);
      r.push([M, c(0)]);
      const folds = [];
      for (let k = 0; k < 4; k++) {
        for (let j = 0; j <= nArc; j++) {
          if (j === 0 || j === nArc) folds.push(r.length);
          r.push([C[k], c(((k + j / nArc) * Math.PI) / 2)]);
        }
      }
      r.push([M, c(Math.PI * 2)]);
      return { r, folds };
    },
    build(p) {
      const { r } = this.rulings(p);
      return ruledSolid(r.slice(0, -1), p.e);
    },
    flat(p) {
      const { r, folds } = this.rulings(p, 24);
      const { fb, ft } = unfoldRulings(r);
      const pts = dedupePts([...fb, ...ft.slice().reverse()]);
      const ents = [{ type: 'poly', pts, closed: true }];
      for (const i of folds) ents.push({ type: 'line', a: fb[i], b: ft[i], construction: true, layer: 'PLIAGE' });
      const lens = r.map(([B, T]) => B.distanceTo(T));
      return { ...normalizeFlat(ents), info: [['Génératrice la plus longue', Math.max(...lens)], ['Génératrice la plus courte', Math.min(...lens)], ['Joint de soudure', 'au milieu du côté X+']] };
    },
  },
};

/** Coude segmenté (ou lisse si N grand) : axe dans le plan XY, centre de cintrage à l'origine */
export function elbowSolid(p, n = 72) {
  const { ro, ri } = radii(p.D, p.e, p.ref);
  if (p.R <= ro) throw new Error('Le rayon de cintrage doit être supérieur au rayon du tube');
  const N = Math.max(1, Math.round(p.N)), al = (p.A / N) * D2R, g = al / 2;
  const parts = [];
  for (let k = 0; k < N; k++) {
    const th = (k + 0.5) * al;
    const Mx = p.R * Math.cos(th), My = p.R * Math.sin(th);
    const T = V(-Math.sin(th), Math.cos(th), 0), Nr = V(Math.cos(th), Math.sin(th), 0), Z = V(0, 0, 1);
    const rings = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const f = (i / n) * Math.PI * 2;
      for (const [idx, rho, sgn] of [[0, ro, -1], [1, ro, 1], [2, ri, 1], [3, ri, -1]]) {
        const t = sgn * (p.R + rho * Math.cos(f)) * Math.tan(g);
        rings[idx].push(V(Mx, My, 0).addScaledVector(Nr, rho * Math.cos(f)).addScaledVector(Z, rho * Math.sin(f)).addScaledVector(T, t));
      }
    }
    parts.push(ringsSolid(rings));
  }
  // posé : départ du coude centré sur l'origine, tube vertical au départ
  return merge(parts).translate(-p.R, 0, 0).rotateX(Math.PI / 2);
}

export const SHEET_DEFAULTS = (kind) => ({ kind, ...Object.fromEntries(SHEET[kind].params.map((q) => [q.k, q.def])) });

export function buildSheet(p) {
  const def = SHEET[p.kind];
  if (!def) return null;
  return clean(def.build(p));
}

export function sheetLabel(p) {
  const d = SHEET[p.kind];
  if (!d) return 'Tôle';
  switch (p.kind) {
    case 'bent': return `Tôle pliée ép.${p.e}`;
    case 'shell': return `Virole Ø${p.D} H${p.H}`;
    case 'cone': return `Tronc de cône Ø${p.D1}/Ø${p.D2}`;
    case 'elbow': return `Coude ${p.A}° Ø${p.D} (${p.N} seg.)`;
    case 'branch': return `Piquage Ø${p.d} sur Ø${p.Dp}`;
    case 'transition': return p.top === 'Rectangle' ? `Trémie ${p.a}x${p.b} → ${p.c}x${p.d2}` : `Carré-rond ${p.a}x${p.b} → Ø${p.D}`;
  }
  return d.label;
}

/** Développé : { entities (format esquisse), texts, info, area } */
export function sheetFlat(p) {
  const f = SHEET[p.kind].flat(p);
  return f;
}
