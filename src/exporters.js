// Exports : DXF (2D esquisses, mise en plan, 3D), SVG, STL, OBJ, GLB, PLY, STEP
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { entityPolyline } from './sketch.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const f = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(5)).toString();

// =============================================================== DXF (R12, compatible avec tous les logiciels)
export class DxfWriter {
  constructor() {
    this.ents = [];
    this.layers = new Map([['0', 7]]);
  }
  layer(name, color = 7) { if (!this.layers.has(name)) this.layers.set(name, color); return name; }
  push(...pairs) { for (let i = 0; i < pairs.length; i += 2) this.ents.push(pairs[i], pairs[i + 1]); }
  line(a, b, layer = '0') { this.push(0, 'LINE', 8, layer, 10, f(a[0]), 20, f(a[1]), 30, f(a[2] || 0), 11, f(b[0]), 21, f(b[1]), 31, f(b[2] || 0)); }
  circle(c, r, layer = '0') { this.push(0, 'CIRCLE', 8, layer, 10, f(c[0]), 20, f(c[1]), 30, 0, 40, f(r)); }
  arc(c, r, a0, a1, layer = '0') { this.push(0, 'ARC', 8, layer, 10, f(c[0]), 20, f(c[1]), 30, 0, 40, f(r), 50, f(a0), 51, f(a1)); }
  polyline(pts, closed, layer = '0') {
    this.push(0, 'POLYLINE', 8, layer, 66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0);
    for (const p of pts) this.push(0, 'VERTEX', 8, layer, 10, f(p[0]), 20, f(p[1]), 30, 0);
    this.push(0, 'SEQEND', 8, layer);
  }
  text(p, h, txt, layer = '0') { this.push(0, 'TEXT', 8, layer, 10, f(p[0]), 20, f(p[1]), 30, 0, 40, f(h), 1, String(txt).replace(/[\r\n]/g, ' ')); }
  face3d(a, b, c, layer = '0') {
    this.push(0, '3DFACE', 8, layer, 10, f(a[0]), 20, f(a[1]), 30, f(a[2]), 11, f(b[0]), 21, f(b[1]), 31, f(b[2]),
      12, f(c[0]), 22, f(c[1]), 32, f(c[2]), 13, f(c[0]), 23, f(c[1]), 33, f(c[2]));
  }
  toString() {
    const o = [];
    const P = (...a) => { for (let i = 0; i < a.length; i += 2) o.push(String(a[i]), String(a[i + 1])); };
    P(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
    P(0, 'SECTION', 2, 'TABLES');
    P(0, 'TABLE', 2, 'LTYPE', 70, 2);
    P(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
    P(0, 'LTYPE', 2, 'DASHED', 70, 0, 3, '__ __ __', 72, 65, 73, 2, 40, 6, 49, 4, 49, -2);
    P(0, 'ENDTAB');
    P(0, 'TABLE', 2, 'LAYER', 70, this.layers.size);
    for (const [n, c] of this.layers) P(0, 'LAYER', 2, n, 70, 0, 62, c, 6, /CACHE|HIDDEN|AXE/.test(n) ? 'DASHED' : 'CONTINUOUS');
    P(0, 'ENDTAB', 0, 'ENDSEC');
    P(0, 'SECTION', 2, 'ENTITIES');
    for (let i = 0; i < this.ents.length; i++) o.push(String(this.ents[i]));
    P(0, 'ENDSEC', 0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }
}

/** Entités natives d'une esquisse vers DXF (cercles et arcs exacts) */
export function sketchToDxf(dxf, entities, layer = 'CONTOUR', offset = [0, 0]) {
  const L = dxf.layer(layer, 7), LC = dxf.layer('CONSTRUCTION', 8);
  const tr = (p) => [p[0] + offset[0], p[1] + offset[1]];
  for (const e of entities) {
    const ly = e.construction ? LC : L;
    if (e.type === 'line') dxf.line(tr(e.a), tr(e.b), ly);
    else if (e.type === 'circle') dxf.circle(tr(e.c), e.r, ly);
    else if (e.type === 'arc') dxf.arc(tr(e.c), e.r, e.a0, e.a1, ly);
    else {
      const { pts, closed } = entityPolyline(e);
      dxf.polyline(pts.map(tr), closed, ly);
    }
  }
}

// =============================================================== Mise en plan (projections avec lignes cachées)
export const VIEWS = {
  'Face': { dir: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  'Dessus': { dir: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  'Droite': { dir: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(0, 0, 1) },
  'Gauche': { dir: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, -1, 0), v: new THREE.Vector3(0, 0, 1) },
  'Dessous': { dir: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, -1, 0) },
  'Arrière': { dir: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(-1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  'Isométrique': { dir: new THREE.Vector3(1, -1, 1).normalize(), u: new THREE.Vector3(1, 1, 0).normalize(), v: new THREE.Vector3(-1, 1, 2).normalize() },
};

/** Arêtes vives (+ silhouettes si dir) d'une géométrie, robuste aux jonctions en T */
export function featureEdges(geom, { angle = 25, dir = null } = {}) {
  const cosT = Math.cos((angle * Math.PI) / 180);
  const segs3 = [];
  const b = { geom };
  const g = mergeVertices(b.geom.clone().deleteAttribute('normal'), 1e-4);
  const pos = g.getAttribute('position'), idx = g.index.array;
  const nTri = idx.length / 3;
  const normals = new Float32Array(nTri * 3);
  const degen = new Uint8Array(nTri);
  const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < nTri; t++) {
    a.fromBufferAttribute(pos, idx[3 * t]); bb.fromBufferAttribute(pos, idx[3 * t + 1]); c.fromBufferAttribute(pos, idx[3 * t + 2]);
    n.subVectors(c, bb).cross(a.clone().sub(bb));
    const maxE = Math.max(a.distanceToSquared(bb), bb.distanceToSquared(c), c.distanceToSquared(a));
    if (n.length() < 1e-6 * maxE || maxE < 1e-12) { degen[t] = 1; continue; } // triangle dégénéré
    n.normalize();
    normals[3 * t] = n.x; normals[3 * t + 1] = n.y; normals[3 * t + 2] = n.z;
  }
  const edges = new Map();
  for (let t = 0; t < nTri; t++) {
    if (degen[t]) continue;
    for (let k = 0; k < 3; k++) {
      const i0 = idx[3 * t + k], i1 = idx[3 * t + ((k + 1) % 3)];
      const key = i0 < i1 ? i0 + '_' + i1 : i1 + '_' + i0;
      const e = edges.get(key);
      if (e) e.push(t); else edges.set(key, [i0, i1, t]);
    }
  }
  const nn = (t) => new THREE.Vector3(normals[3 * t], normals[3 * t + 1], normals[3 * t + 2]);
  // index spatial des arêtes pour traiter les jonctions en T (résultats de booléens)
  const all = [...edges.values()];
  g.computeBoundingBox();
  const cell = Math.max(1e-3, g.boundingBox.getSize(new THREE.Vector3()).length() / 64);
  const grid = new Map();
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i);
  const ck = (x, y, z) => x + ',' + y + ',' + z;
  for (const e of all) {
    const a0 = P(e[0]), a1 = P(e[1]);
    const lo = a0.clone().min(a1).divideScalar(cell).floor(), hi = a0.clone().max(a1).divideScalar(cell).floor();
    if ((hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1) > 4096) continue;
    for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) {
      const k = ck(x, y, z);
      let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(e);
    }
  }
  const tol = cell * 1e-3;
  const neighbourNormal = (e) => {
    // cherche une autre arête colinéaire contenant le milieu de e
    const a0 = P(e[0]), a1 = P(e[1]);
    const mid = a0.clone().lerp(a1, 0.37);
    const c = mid.clone().divideScalar(cell).floor();
    const cand = grid.get(ck(c.x, c.y, c.z)) || [];
    const seg = new THREE.Line3(), cp = new THREE.Vector3();
    for (const o of cand) {
      if (o === e) continue;
      const t = o[2];
      if (t === e[2]) continue;
      seg.set(P(o[0]), P(o[1]));
      seg.closestPointToPoint(mid, true, cp);
      if (cp.distanceTo(mid) > tol) continue;
      const d1 = a1.clone().sub(a0).normalize(), d2 = seg.delta(new THREE.Vector3()).normalize();
      if (Math.abs(d1.dot(d2)) < 0.9999) continue;
      return nn(t);
    }
    return null;
  };
  for (const e of all) {
    let keep = false;
    if (e.length === 3) {
      const n2 = neighbourNormal(e);
      if (!n2) keep = true; // vrai bord libre
      else {
        const n1 = nn(e[2]);
        keep = n1.dot(n2) < cosT || (dir && Math.sign(n1.dot(dir)) !== Math.sign(n2.dot(dir)));
      }
    } else {
      for (let i = 2; i < e.length && !keep; i++) for (let j = i + 1; j < e.length && !keep; j++) {
        const n1 = nn(e[i]), n2 = nn(e[j]);
        if (n1.dot(n2) < cosT) keep = true; // arête vive
        else if (dir && Math.sign(n1.dot(dir)) !== Math.sign(n2.dot(dir))) keep = true; // silhouette
      }
    }
    if (keep) segs3.push([new THREE.Vector3().fromBufferAttribute(pos, e[0]), new THREE.Vector3().fromBufferAttribute(pos, e[1])]);
  }
  return segs3;
}
/**
 * Calcule les arêtes vives + silhouettes de chaque corps, projetées dans le plan de vue.
 * Renvoie { visible: [[x1,y1,x2,y2]...], hidden: [...], bbox }
 */
export function projectView(bodies, viewName, { hidden = true, angle = 25 } = {}) {
  const V = VIEWS[viewName];
  const dir = V.dir.clone().normalize(); // vers l'observateur
  const cosT = Math.cos((angle * Math.PI) / 180);
  const meshes = bodies.map((b) => {
    const g = b.geom.clone();
    g.computeBoundsTree();
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  });
  const segs3 = [];
  for (const b of bodies) for (const s of featureEdges(b.geom, { angle, dir })) segs3.push(s);
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const box = new THREE.Box3();
  for (const b of bodies) { b.geom.computeBoundingBox(); box.union(b.geom.boundingBox); }
  const far = box.isEmpty() ? 1000 : box.getSize(new THREE.Vector3()).length() * 2 + 10;
  const eps = box.isEmpty() ? 0.01 : Math.max(1e-3, box.getSize(new THREE.Vector3()).length() * 2e-4);
  const isHidden = (p) => {
    const o = p.clone().addScaledVector(dir, far);
    ray.set(o, dir.clone().negate());
    ray.far = far - eps;
    for (const m of meshes) if (ray.intersectObject(m, false).length) return true;
    return false;
  };
  const proj = (p) => [p.dot(V.u), p.dot(V.v)];
  const visible = [], hid = [];
  for (const [p, q] of segs3) {
    const len = p.distanceTo(q);
    const n = Math.min(8, Math.max(1, Math.ceil(len / (far / 60))));
    let prevHidden = null, start = p;
    for (let i = 0; i < n; i++) {
      const s0 = p.clone().lerp(q, i / n), s1 = p.clone().lerp(q, (i + 1) / n);
      const h = hidden ? isHidden(s0.clone().lerp(s1, 0.5)) : false;
      if (prevHidden === null) { prevHidden = h; start = s0; }
      else if (h !== prevHidden) {
        (prevHidden ? hid : visible).push([...proj(start), ...proj(s0)]);
        start = s0; prevHidden = h;
      }
      if (i === n - 1) (prevHidden ? hid : visible).push([...proj(start), ...proj(s1)]);
    }
  }
  meshes.forEach((m) => m.geometry.disposeBoundsTree?.());
  const pb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of [...visible, ...hid]) {
    pb.minX = Math.min(pb.minX, s[0], s[2]); pb.maxX = Math.max(pb.maxX, s[0], s[2]);
    pb.minY = Math.min(pb.minY, s[1], s[3]); pb.maxY = Math.max(pb.maxY, s[1], s[3]);
  }
  if (!isFinite(pb.minX)) Object.assign(pb, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const vis = dedupe(visible);
  return { visible: vis, hidden: removeCovered(dedupe(hid), vis), bbox: pb };
}

/** Supprime les traits cachés superposés à un trait visible */
function removeCovered(hidden, visible) {
  const tol = 1e-3;
  const onSeg = (x, y, s) => {
    const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return false;
    const t = ((x - s[0]) * dx + (y - s[1]) * dy) / l2;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(s[0] + t * dx - x, s[1] + t * dy - y) < tol;
  };
  return hidden.filter((h) => {
    for (const v of visible) {
      if (onSeg(h[0], h[1], v) && onSeg(h[2], h[3], v)) return false;
    }
    return true;
  });
}

function dedupe(segs) {
  const seen = new Set(), out = [];
  for (const s of segs) {
    if (Math.hypot(s[2] - s[0], s[3] - s[1]) < 1e-4) continue;
    const r = s.map((v) => v.toFixed(3));
    const k1 = r.join(','), k2 = [r[2], r[3], r[0], r[1]].join(',');
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1);
    out.push(s);
  }
  return out;
}

/** Disposition des vues sur une planche (méthode européenne) */
export function layoutDrawing(bodies, viewNames, opts = {}) {
  const gap = opts.gap ?? 30;
  const res = {};
  for (const v of viewNames) res[v] = projectView(bodies, v, opts);
  const W = (v) => res[v].bbox.maxX - res[v].bbox.minX, H = (v) => res[v].bbox.maxY - res[v].bbox.minY;
  const placed = [];
  const has = (v) => viewNames.includes(v);
  // vue de face au centre-haut, vue de dessus en dessous, vue de gauche à droite (projection européenne)
  const place = (v, x, y) => placed.push({ name: v, ox: x - res[v].bbox.minX, oy: y - res[v].bbox.minY, data: res[v], w: W(v), h: H(v) });
  let x0 = 0, y0 = 0;
  const main = has('Face') ? 'Face' : viewNames[0];
  const topH = has('Dessus') ? H('Dessus') + gap : 0;
  place(main, x0, y0 + topH);
  if (has('Dessus') && main !== 'Dessus') place('Dessus', x0, y0);
  let xr = x0 + W(main) + gap;
  for (const side of ['Gauche', 'Droite']) if (has(side) && side !== main) { place(side, xr, y0 + topH); xr += W(side) + gap; }
  for (const v of viewNames) {
    if (placed.find((p) => p.name === v)) continue;
    place(v, xr, y0 + topH);
    xr += W(v) + gap;
  }
  let maxX = 0, maxY = 0;
  for (const p of placed) { maxX = Math.max(maxX, p.ox + p.data.bbox.maxX); maxY = Math.max(maxY, p.oy + p.data.bbox.maxY); }
  return { views: placed, width: maxX, height: maxY };
}

export function drawingToDxf(layout, { hidden = true, dims = true, title = '' } = {}) {
  const dxf = new DxfWriter();
  const LV = dxf.layer('VISIBLE', 7), LH = dxf.layer('CACHE', 8), LT = dxf.layer('TEXTE', 3), LD = dxf.layer('COTES', 1);
  for (const v of layout.views) {
    for (const s of v.data.visible) dxf.line([s[0] + v.ox, s[1] + v.oy], [s[2] + v.ox, s[3] + v.oy], LV);
    if (hidden) for (const s of v.data.hidden) dxf.line([s[0] + v.ox, s[1] + v.oy], [s[2] + v.ox, s[3] + v.oy], LH);
    const b = v.data.bbox;
    const th = Math.max(2.5, Math.min(10, layout.width / 80));
    dxf.text([b.minX + v.ox, b.minY + v.oy - th * 2.2], th, v.name, LT);
    if (dims && v.name !== 'Isométrique') {
      const w = b.maxX - b.minX, h = b.maxY - b.minY, off = th * 1.5;
      const y = b.maxY + v.oy + off;
      dxf.line([b.minX + v.ox, y], [b.maxX + v.ox, y], LD);
      dxf.text([b.minX + v.ox + w / 2 - th * 1.5, y + th * 0.4], th * 0.8, fmtDim(w), LD);
      const x = b.maxX + v.ox + off;
      dxf.line([x, b.minY + v.oy], [x, b.maxY + v.oy], LD);
      dxf.text([x + th * 0.4, b.minY + v.oy + h / 2], th * 0.8, fmtDim(h), LD);
    }
  }
  if (title) dxf.text([0, -Math.max(10, layout.width / 30)], Math.max(3.5, layout.width / 60), title, LT);
  return dxf.toString();
}

const fmtDim = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');

export function drawingToSvg(layout, { hidden = true, dims = true, title = '', forScreen = false } = {}) {
  const m = Math.max(20, layout.width * 0.08);
  const W = layout.width + 2 * m, H = layout.height + 2 * m + (title ? m : 0);
  const sw = Math.max(0.25, layout.width / 900);
  const th = Math.max(2.5, Math.min(10, layout.width / 80));
  const y = (v) => H - m - v - (title ? m : 0); // SVG : axe Y vers le bas
  const parts = [];
  for (const v of layout.views) {
    const vis = v.data.visible.map((s) => `M${(s[0] + v.ox + m).toFixed(3)} ${y(s[1] + v.oy).toFixed(3)}L${(s[2] + v.ox + m).toFixed(3)} ${y(s[3] + v.oy).toFixed(3)}`).join('');
    parts.push(`<path d="${vis}" stroke="#111" stroke-width="${sw * 1.6}" fill="none" stroke-linecap="round"/>`);
    if (hidden && v.data.hidden.length) {
      const hd = v.data.hidden.map((s) => `M${(s[0] + v.ox + m).toFixed(3)} ${y(s[1] + v.oy).toFixed(3)}L${(s[2] + v.ox + m).toFixed(3)} ${y(s[3] + v.oy).toFixed(3)}`).join('');
      parts.push(`<path d="${hd}" stroke="#777" stroke-width="${sw}" stroke-dasharray="${sw * 6} ${sw * 4}" fill="none"/>`);
    }
    const b = v.data.bbox;
    parts.push(`<text x="${b.minX + v.ox + m}" y="${y(b.minY + v.oy) + th * 2.2}" font-size="${th}" font-family="Arial" fill="#1565c0">${v.name}</text>`);
    if (dims && v.name !== 'Isométrique') {
      const w = b.maxX - b.minX, h = b.maxY - b.minY, off = th * 1.6;
      const yy = y(b.maxY + v.oy) - off, x0 = b.minX + v.ox + m, x1 = b.maxX + v.ox + m;
      parts.push(`<g stroke="#c62828" stroke-width="${sw}" fill="#c62828" font-size="${th * 0.85}" font-family="Arial">`
        + `<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}"/><line x1="${x0}" y1="${yy - off / 2}" x2="${x0}" y2="${yy + off / 2}"/><line x1="${x1}" y1="${yy - off / 2}" x2="${x1}" y2="${yy + off / 2}"/>`
        + `<text x="${(x0 + x1) / 2}" y="${yy - th * 0.4}" text-anchor="middle" stroke="none">${fmtDim(w)}</text>`);
      const xx = x1 + off, ya = y(b.minY + v.oy), yb = y(b.maxY + v.oy);
      parts.push(`<line x1="${xx}" y1="${ya}" x2="${xx}" y2="${yb}"/><line x1="${xx - off / 2}" y1="${ya}" x2="${xx + off / 2}" y2="${ya}"/><line x1="${xx - off / 2}" y1="${yb}" x2="${xx + off / 2}" y2="${yb}"/>`
        + `<text x="${xx + th * 0.5}" y="${(ya + yb) / 2}" stroke="none">${fmtDim(h)}</text></g>`);
    }
  }
  if (title) parts.push(`<text x="${m}" y="${H - m * 0.5}" font-size="${th * 1.4}" font-family="Arial" fill="#111">${esc(title)}</text>`);
  const size = forScreen ? 'width="100%" height="100%"' : `width="${W}mm" height="${H}mm"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`;
}

export function sketchToSvg(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = entities.map((e) => { const p = entityPolyline(e); for (const q of p.pts) { minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]); } return { ...p, e }; });
  if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
  const m = 5, W = maxX - minX + 2 * m, H = maxY - minY + 2 * m;
  const d = polys.map(({ pts, closed, e }) => `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - minX + m).toFixed(4)} ${(maxY - p[1] + m).toFixed(4)}`).join('')}${closed ? 'Z' : ''}" stroke="${e.construction ? '#999' : '#000'}" ${e.construction ? 'stroke-dasharray="2 1"' : ''} stroke-width="0.2" fill="none"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${d}</svg>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// =============================================================== Formats 3D
export function toDxf3D(bodies) {
  const dxf = new DxfWriter();
  for (const b of bodies) {
    const ly = dxf.layer(b.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30) || 'CORPS', 7);
    const p = b.geom.getAttribute('position').array;
    for (let i = 0; i < p.length; i += 9) dxf.face3d([p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], ly);
  }
  return dxf.toString();
}

export function toSTL(bodies) {
  let n = 0;
  for (const b of bodies) n += b.geom.getAttribute('position').count / 3;
  const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const header = 'FormaCAD STL binaire (mm)';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const b of bodies) {
    const p = b.geom.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b2.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      nn.subVectors(c, b2).cross(a.clone().sub(b2)).normalize();
      for (const v of [nn, a, b2, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return buf;
}

export function toOBJ(bodies) {
  const out = ['# FormaCAD – unités : mm', 'mtllib formacad.mtl'];
  let base = 1;
  for (const b of bodies) {
    const g = mergeVertices(b.geom.clone().deleteAttribute('normal'), 1e-5);
    const p = g.getAttribute('position'), idx = g.index.array;
    out.push(`o ${b.name.replace(/\s+/g, '_')}`);
    for (let i = 0; i < p.count; i++) out.push(`v ${f(p.getX(i))} ${f(p.getY(i))} ${f(p.getZ(i))}`);
    for (let i = 0; i < idx.length; i += 3) out.push(`f ${idx[i] + base} ${idx[i + 1] + base} ${idx[i + 2] + base}`);
    base += p.count;
  }
  return out.join('\n') + '\n';
}

export function toPLY(bodies) {
  const verts = [], faces = [];
  let base = 0;
  for (const b of bodies) {
    const g = mergeVertices(b.geom.clone().deleteAttribute('normal'), 1e-5);
    const p = g.getAttribute('position'), idx = g.index.array;
    const col = new THREE.Color(b.color);
    const rgb = [col.r, col.g, col.b].map((v) => Math.round(v * 255)).join(' ');
    for (let i = 0; i < p.count; i++) verts.push(`${f(p.getX(i))} ${f(p.getY(i))} ${f(p.getZ(i))} ${rgb}`);
    for (let i = 0; i < idx.length; i += 3) faces.push(`3 ${idx[i] + base} ${idx[i + 1] + base} ${idx[i + 2] + base}`);
    base += p.count;
  }
  return ['ply', 'format ascii 1.0', 'comment FormaCAD (mm)', `element vertex ${verts.length}`, 'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue', `element face ${faces.length}`, 'property list uchar int vertex_indices', 'end_header', ...verts, ...faces].join('\n') + '\n';
}

export async function toGLB(bodies) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const scene = new THREE.Scene();
  for (const b of bodies) {
    const m = new THREE.Mesh(b.geom, new THREE.MeshStandardMaterial({ color: b.color, metalness: 0.3, roughness: 0.5 }));
    m.name = b.name;
    m.scale.setScalar(0.001); // glTF en mètres
    m.rotation.x = -Math.PI / 2; // glTF : Y vers le haut
    const g = new THREE.Group(); g.add(m); scene.add(g);
  }
  return new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true }));
}

/** STEP AP214 en B-rep à facettes (lisible par SolidWorks, FreeCAD, Fusion, TopSolid, CATIA…) */
export function toSTEP(bodies, filename = 'formacad.step') {
  let id = 0;
  const L = [];
  const E = (s) => { id++; L.push(`#${id}=${s};`); return id; };
  const now = new Date().toISOString().slice(0, 19);
  const ctxGeom = (() => {
    const lu = E('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
    const au = E('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
    const su = E('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
    const unc = E(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),#${lu},'distance_accuracy_value','confusion accuracy')`);
    return E(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lu},#${au},#${su}))REPRESENTATION_CONTEXT('Context3D','3D Context with 1E-05 uncertainty'))`);
  })();
  const appCtx = E("APPLICATION_CONTEXT('automotive design')");
  E(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const prodCtx = E(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const pdCtx = E(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const origin = E("CARTESIAN_POINT('',(0.,0.,0.))");
  const dz = E("DIRECTION('',(0.,0.,1.))"), dx = E("DIRECTION('',(1.,0.,0.))");
  const ax = E(`AXIS2_PLACEMENT_3D('',#${origin},#${dz},#${dx})`);
  const items = [];
  const nf = (v) => { const s = (Math.abs(v) < 1e-12 ? 0 : v).toPrecision(10); return s.includes('.') || s.includes('e') ? s.replace('e', 'E') : s + '.'; };
  for (const b of bodies) {
    const g = mergeVertices(b.geom.clone().deleteAttribute('normal'), 1e-5);
    const p = g.getAttribute('position'), idx = g.index.array;
    const pid = new Array(p.count);
    for (let i = 0; i < p.count; i++) pid[i] = E(`CARTESIAN_POINT('',(${nf(p.getX(i))},${nf(p.getY(i))},${nf(p.getZ(i))}))`);
    const faces = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      A.fromBufferAttribute(p, i0); B.fromBufferAttribute(p, i1); C.fromBufferAttribute(p, i2);
      if (B.clone().sub(A).cross(C.clone().sub(A)).lengthSq() < 1e-14) continue;
      const nrm = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
      const ref = B.clone().sub(A).normalize();
      const dn = E(`DIRECTION('',(${nf(nrm.x)},${nf(nrm.y)},${nf(nrm.z)}))`);
      const dr = E(`DIRECTION('',(${nf(ref.x)},${nf(ref.y)},${nf(ref.z)}))`);
      const pl = E(`PLANE('',#${E(`AXIS2_PLACEMENT_3D('',#${pid[i0]},#${dn},#${dr})`)})`);
      const loop = E(`POLY_LOOP('',(#${pid[i0]},#${pid[i1]},#${pid[i2]}))`);
      const bound = E(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      faces.push(E(`FACE_SURFACE('',(#${bound}),#${pl},.T.)`));
    }
    const shell = E(`CLOSED_SHELL('',(${faces.map((x) => '#' + x).join(',')}))`);
    items.push({ brep: E(`FACETED_BREP('${stepStr(b.name)}',#${shell})`), name: b.name });
  }
  const rep = E(`FACETED_BREP_SHAPE_REPRESENTATION('',(#${ax}${items.map((i) => ',#' + i.brep).join('')}),#${ctxGeom})`);
  const prod = E(`PRODUCT('FormaCAD','${stepStr(filename)}','',(#${prodCtx}))`);
  const pdf = E(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const pd = E(`PRODUCT_DEFINITION('design','',#${pdf},#${pdCtx})`);
  const pds = E(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  E(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
  E(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`);
  return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('FormaCAD export'),'2;1');",
    `FILE_NAME('${stepStr(filename)}','${now}',('FormaCAD'),(''),'FormaCAD','FormaCAD','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n') + '\n';
}

const stepStr = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/'/g, "''");
