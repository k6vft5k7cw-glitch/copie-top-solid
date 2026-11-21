// Fabrication : contours de découpe, compensation d'outil, G-code (laser / plasma / oxycoupage / fraisage), imbrication
import ClipperLib from 'clipper-lib';
import { findLoops, entityPolyline } from './sketch.js';
import { BASIC, roundRectPts, circlePts } from './shapes.js';

const SC = 1000; // précision Clipper : µm

function area(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
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
const centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };

/** Contours fermés d'un profil, classés extérieur / trou (règle pair-impair) */
export function profileLoops(entities) {
  const loops = findLoops(entities.filter((e) => !e.construction)).map((pts) => ({ pts, a: Math.abs(area(pts)), depth: 0 }));
  loops.sort((a, b) => b.a - a.a);
  for (let i = 0; i < loops.length; i++) {
    let d = 0;
    for (let j = 0; j < i; j++) if (inside(loops[i].pts[0], loops[j].pts)) d++;
    loops[i].depth = d;
  }
  return loops.map((l) => ({ pts: l.pts, hole: l.depth % 2 === 1, area: l.a }));
}

/** Profil 2D (entités d'esquisse) et épaisseur d'un objet du projet, ou null */
export function objectProfile(o, model, sheetFlat) {
  const p = o.params;
  if (o.type === 'sketch') return { entities: p.entities, thickness: null };
  if (o.type === 'extrude' && model.get(p.sketch)) return { entities: model.get(p.sketch).params.entities, thickness: p.h };
  if (o.type === 'sheet') { try { const f = sheetFlat(p); return { entities: f.entities, thickness: p.e }; } catch { return null; } }
  if (o.type === 'plate') {
    const ents = [{ type: 'poly', pts: roundRectPts(p.l, p.w, p.r), closed: true }];
    if (p.hd > 0) { const x = p.l / 2 - p.m, y = p.w / 2 - p.m; for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) ents.push({ type: 'circle', c: [sx * x, sy * y], r: p.hd / 2 }); }
    return { entities: ents, thickness: p.h };
  }
  if (o.type === 'box') return { entities: [{ type: 'rect', x: -p.l / 2, y: -p.w / 2, w: p.l, h: p.w }], thickness: p.h };
  if (o.type === 'cylinder') return { entities: [{ type: 'circle', c: [0, 0], r: p.d / 2 }], thickness: p.h };
  if (o.type === 'tube') return { entities: [{ type: 'circle', c: [0, 0], r: p.de / 2 }, { type: 'circle', c: [0, 0], r: p.di / 2 }], thickness: p.h };
  return null;
}

/** Décale un contour fermé de d (mm, >0 vers l'extérieur) ; renvoie des contours */
export function offsetLoop(pts, d) {
  if (Math.abs(d) < 1e-6) return [pts];
  const path = pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
  if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
  const co = new ClipperLib.ClipperOffset(2, 0.01 * SC);
  co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, d * SC);
  return sol.map((pth) => pth.map((q) => [q.X / SC, q.Y / SC]));
}

/**
 * Trajectoires de découpe / contournage.
 * opts : comp (rayon de compensation : demi-saignée ou rayon outil), lead (amorçage mm), drillMax (Ø max percé en G81, fraisage)
 * Renvoie { paths: [{pts, hole, lead:[x,y]|null}], drills: [{c:[x,y], d}] } dans l'ordre d'exécution (trous d'abord)
 */
export function toolpaths(entities, { comp = 0, lead = 0, drillMax = 0, offset = [0, 0] } = {}) {
  const loops = profileLoops(entities);
  const drills = [];
  const paths = [];
  const circles = entities.filter((e) => e.type === 'circle' && !e.construction);
  for (const l of loops) {
    if (l.hole && drillMax > 0) {
      const c = circles.find((e) => Math.abs(Math.PI * e.r * e.r - l.area) / l.area < 0.02 && inside(e.c, l.pts));
      if (c && 2 * c.r <= drillMax + 1e-6) { drills.push({ c: [c.c[0] + offset[0], c.c[1] + offset[1]], d: 2 * c.r }); continue; }
    }
    for (const pts of offsetLoop(l.pts, l.hole ? -comp : comp)) {
      if (pts.length < 3) continue;
      // sens : extérieur en sens horaire (G41 implicite côté matière à droite), trous en sens trigo – convention découpe
      let q = pts.map(([x, y]) => [x + offset[0], y + offset[1]]);
      const a = area(q);
      if ((!l.hole && a > 0) || (l.hole && a < 0)) q = q.reverse();
      // point de départ : le plus proche du bas-gauche pour l'extérieur, quelconque pour les trous
      let k = 0;
      if (!l.hole) { let best = Infinity; q.forEach((p, i) => { const s = p[0] + p[1]; if (s < best) { best = s; k = i; } }); }
      q = [...q.slice(k), ...q.slice(0, k)];
      let leadPt = null;
      if (lead > 0) {
        const c = centroid(q), s = q[0];
        const dx = s[0] - c[0], dy = s[1] - c[1], dl = Math.hypot(dx, dy) || 1;
        const L = l.hole ? Math.min(lead, dl * 0.6) : lead;
        leadPt = l.hole ? [s[0] - (dx / dl) * L, s[1] - (dy / dl) * L] : [s[0] + (dx / dl) * L, s[1] + (dy / dl) * L];
      }
      paths.push({ pts: q, hole: l.hole, lead: leadPt });
    }
  }
  // ordre : trous d'abord (au plus proche), puis contours extérieurs
  const order = (list) => {
    const out = [];
    let cur = [0, 0];
    const rest = list.slice();
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((p, i) => { const s = p.lead || p.pts[0]; const d = Math.hypot(s[0] - cur[0], s[1] - cur[1]); if (d < bd) { bd = d; bi = i; } });
      const p = rest.splice(bi, 1)[0];
      out.push(p);
      cur = p.pts[0];
    }
    return out;
  };
  return { paths: [...order(paths.filter((p) => p.hole)), ...order(paths.filter((p) => !p.hole))], drills };
}

const n3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

/**
 * G-code ISO (Fanuc / Linux CNC compatible).
 * o : { process: 'laser'|'plasma'|'oxy'|'mill', feed, on, off, pierce (s), safeZ, depth, stepDown, spindle, plungeFeed, name }
 */
export function gcode(tp, o) {
  const L = [];
  const mill = o.process === 'mill';
  L.push(`(FormaCAD - ${o.name || 'programme'})`);
  L.push(`(Procede : ${{ laser: 'Laser', plasma: 'Plasma', oxy: 'Oxycoupage', mill: 'Fraisage 2D' }[o.process]} - unites mm)`);
  L.push('G21 G90 G17 G40 G49 G80');
  let len = 0, rapid = 0, cur = [0, 0];
  const go = (p) => { rapid += Math.hypot(p[0] - cur[0], p[1] - cur[1]); cur = p; };
  const cut = (p) => { len += Math.hypot(p[0] - cur[0], p[1] - cur[1]); cur = p; };
  if (mill) {
    L.push(`G0 Z${n3(o.safeZ)}`, `S${Math.round(o.spindle)} M3`);
    for (const d of tp.drills) {
      L.push(`(Percage D${n3(d.d)})`);
      L.push(`G0 X${n3(d.c[0])} Y${n3(d.c[1])}`);
      go(d.c);
      L.push(`G81 X${n3(d.c[0])} Y${n3(d.c[1])} Z${n3(-o.depth - 0.5)} R${n3(Math.min(2, o.safeZ))} F${Math.round(o.plungeFeed)}`, 'G80');
    }
    const passes = Math.max(1, Math.ceil(o.depth / Math.max(0.05, o.stepDown)));
    for (const p of tp.paths) {
      L.push(`(${p.hole ? 'Contour interieur' : 'Contour exterieur'})`);
      const s = p.pts[0];
      L.push(`G0 X${n3(s[0])} Y${n3(s[1])}`);
      go(s);
      for (let k = 1; k <= passes; k++) {
        const z = -Math.min(o.depth, (o.depth * k) / passes);
        L.push(`G1 Z${n3(z)} F${Math.round(o.plungeFeed)}`);
        for (let i = 1; i <= p.pts.length; i++) { const q = p.pts[i % p.pts.length]; L.push(`G1 X${n3(q[0])} Y${n3(q[1])}${i === 1 ? ' F' + Math.round(o.feed) : ''}`); cut(q); }
      }
      L.push(`G0 Z${n3(o.safeZ)}`);
    }
    L.push('M5', `G0 Z${n3(o.safeZ)}`, 'G0 X0 Y0', 'M30');
  } else {
    for (const p of tp.paths) {
      L.push(`(${p.hole ? 'Contour interieur' : 'Contour exterieur'})`);
      const start = p.lead || p.pts[0];
      L.push(`G0 X${n3(start[0])} Y${n3(start[1])}`);
      go(start);
      L.push(o.on);
      if (o.pierce > 0) L.push(`G4 P${n3(o.pierce)}`);
      if (p.lead) { L.push(`G1 X${n3(p.pts[0][0])} Y${n3(p.pts[0][1])} F${Math.round(o.feed)}`); cut(p.pts[0]); }
      for (let i = 1; i <= p.pts.length; i++) { const q = p.pts[i % p.pts.length]; L.push(`G1 X${n3(q[0])} Y${n3(q[1])}${i === 1 && !p.lead ? ' F' + Math.round(o.feed) : ''}`); cut(q); }
      L.push(o.off);
    }
    L.push('G0 X0 Y0', 'M30');
  }
  const passes = mill ? Math.max(1, Math.ceil(o.depth / Math.max(0.05, o.stepDown))) : 1;
  const t = len / Math.max(1, o.feed) + rapid / 10000 + (mill ? 0 : tp.paths.length * (o.pierce || 0) / 60);
  return { text: L.join('\n') + '\n', length: len, rapid, minutes: t, pierces: tp.paths.length, drills: tp.drills.length, passes };
}

// ------------------------------------------------------------------ imbrication (par rectangles englobants)
/**
 * parts : [{ name, loops:[{pts,hole}], qty }]
 * sheet : { W, H, gap, margin, rotate }
 * Algorithme : rangement en étagères (hauteurs décroissantes), rotation 90° si utile.
 * Renvoie { sheets: [{ items: [{ part, x, y, rot }] }], used (surface pièces), sheetArea, unplaced }
 */
export function nest(parts, { W, H, gap = 5, margin = 10, rotate = true }) {
  const items = [];
  for (const p of parts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of p.loops) for (const [x, y] of l.pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const area = p.loops.reduce((a, l) => a + (l.hole ? -1 : 1) * Math.abs(area_(l.pts)), 0);
    for (let k = 0; k < p.qty; k++) items.push({ part: p, w: maxX - minX, h: maxY - minY, ox: minX, oy: minY, area });
  }
  const uw = W - 2 * margin, uh = H - 2 * margin;
  const unplaced = [];
  // orientation : la plus grande dimension à l'horizontale si elle tient
  for (const it of items) {
    it.rot = false;
    if (rotate && it.h > it.w && it.h <= uw && it.w <= uh) it.rot = true;
    if (rotate && (it.w > uw || it.h > uh) && it.h <= uw && it.w <= uh) it.rot = true;
  }
  const dims = (it) => (it.rot ? [it.h, it.w] : [it.w, it.h]);
  items.sort((a, b) => dims(b)[1] - dims(a)[1] || dims(b)[0] - dims(a)[0]);
  const sheets = [];
  let cur = null;
  const newSheet = () => { cur = { items: [], shelves: [] }; sheets.push(cur); };
  for (const it of items) {
    const [w, h] = dims(it);
    if (w > uw + 1e-6 || h > uh + 1e-6) { unplaced.push(it); continue; }
    let placed = false;
    for (const sh of sheets) {
      for (const s of sh.shelves) {
        if (h <= s.h + 1e-6 && s.x + w <= uw + 1e-6) { sh.items.push({ ...it, x: margin + s.x, y: margin + s.y }); s.x += w + gap; placed = true; break; }
      }
      if (placed) break;
      const top = sh.shelves.length ? sh.shelves[sh.shelves.length - 1].y + sh.shelves[sh.shelves.length - 1].h + gap : 0;
      if (top + h <= uh + 1e-6) { sh.shelves.push({ y: top, h, x: w + gap }); sh.items.push({ ...it, x: margin, y: margin + top }); placed = true; break; }
    }
    if (!placed) { newSheet(); cur.shelves.push({ y: 0, h, x: w + gap }); cur.items.push({ ...it, x: margin, y: margin }); }
  }
  const used = sheets.reduce((a, s) => a + s.items.reduce((b, i) => b + i.area, 0), 0);
  return { sheets, used, sheetArea: W * H, unplaced };
}
const area_ = (p) => area(p);

/** Coordonnées d'un contour de pièce imbriquée */
export function placedLoop(item, pts) {
  return pts.map(([x, y]) => {
    const lx = x - item.ox, ly = y - item.oy;
    return item.rot ? [item.x + (item.h - ly), item.y + lx] : [item.x + lx, item.y + ly];
  });
}

export { entityPolyline };
