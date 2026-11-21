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
    const ly = e.layer ? dxf.layer(e.layer, e.layer === 'PLIAGE' ? 1 : 8) : e.construction ? LC : L;
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

export const PAPERS = { 'A4': [297, 210], 'A3': [420, 297], 'A2': [594, 420], 'A1': [841, 594], 'A0': [1189, 841] };
const SCALES = [10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500];
const fmtDim = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');
export const scaleLabel = (s) => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

/**
 * Primitives de la planche (coordonnées papier en mm, Y vers le haut).
 * opts : hidden, dims, title, paper ('A4'…'A0' ou 'Aucun'), fields {societe, auteur, matiere, indice, masse}, bom [{rep, qty, name, mat, mass}]
 */
export function drawingPrims(layout, opts = {}) {
  const { hidden = true, dims = true, title = '', paper = 'A3', fields = {}, bom = null } = opts;
  const prims = [];
  const line = (a, b, layer) => prims.push({ t: 'line', a, b, layer });
  const text = (p, h, txt, layer, anchor = 'start') => prims.push({ t: 'text', p, h, txt: String(txt ?? ''), layer, anchor });
  const rect = (x0, y0, x1, y1, layer) => { line([x0, y0], [x1, y0], layer); line([x1, y0], [x1, y1], layer); line([x1, y1], [x0, y1], layer); line([x0, y1], [x0, y0], layer); };
  let PW, PH, s, ox, oy, th;
  const bomRows = bom && bom.length ? bom : null;
  if (paper === 'Aucun' || !PAPERS[paper]) {
    s = 1;
    const m = Math.max(20, layout.width * 0.08);
    th = Math.max(2.5, Math.min(10, layout.width / 80));
    PW = layout.width + 2 * m; PH = layout.height + 2 * m + (title ? m : 0);
    ox = m; oy = m + (title ? m : 0);
    if (title) text([m, m * 0.5], th * 1.4, title, 'TEXTE');
  } else {
    [PW, PH] = PAPERS[paper];
    th = paper === 'A4' ? 2.5 : 3.5;
    const tbW = 180, tbH = 36, rowH = 6;
    const bomH = bomRows ? (Math.min(bomRows.length, 30) + 1) * rowH : 0;
    // zone utile : cadre moins le cartouche (+ nomenclature) en bas à droite
    const fx0 = 20, fy0 = 10, fx1 = PW - 10, fy1 = PH - 10;
    const availW = fx1 - fx0 - 20, availH = fy1 - fy0 - tbH - bomH - 25;
    s = SCALES.find((k) => layout.width * k <= availW && layout.height * k <= Math.max(availH, (fy1 - fy0) * 0.45)) || SCALES[SCALES.length - 1];
    ox = fx0 + 10 + (availW - layout.width * s) / 2;
    oy = fy0 + tbH + bomH + 15 + Math.max(0, (availH - layout.height * s) / 2);
    rect(fx0, fy0, fx1, fy1, 'CADRE');
    rect(5, 5, PW - 5, PH - 5, 'CADRE');
    // cartouche
    const x0 = fx1 - tbW, y0 = fy0, y1 = fy0 + tbH;
    rect(x0, y0, fx1, y1, 'CADRE');
    line([x0, y0 + 24], [fx1, y0 + 24], 'CADRE');
    line([x0, y0 + 12], [fx1, y0 + 12], 'CADRE');
    for (const x of [45, 90, 135]) line([x0 + x, y0], [x0 + x, y0 + 12], 'CADRE');
    line([x0 + 120, y0 + 12], [x0 + 120, y0 + 24], 'CADRE');
    text([x0 + 3, y0 + 28], 6, title || 'Sans titre', 'TEXTE');
    text([x0 + 3, y0 + 18.5], 2.5, 'Société', 'TEXTE'); text([x0 + 3, y0 + 14], 3.2, fields.societe || '', 'TEXTE');
    text([x0 + 123, y0 + 18.5], 2.5, 'Matière', 'TEXTE'); text([x0 + 123, y0 + 14], 3.2, fields.matiere || '', 'TEXTE');
    const cells = [['Dessiné par', fields.auteur || ''], ['Date', fields.date || ''], ['Échelle', scaleLabel(s)], ['Format / Indice', `${paper}  ind. ${fields.indice || 'A'}`]];
    cells.forEach(([k, v], i) => { text([x0 + i * 45 + 2, y0 + 8.5], 2.3, k, 'TEXTE'); text([x0 + i * 45 + 2, y0 + 3], 3.2, v, 'TEXTE'); });
    if (fields.masse) text([fx1 - 3, y0 + 28], 2.8, fields.masse, 'TEXTE', 'end');
    // nomenclature au-dessus du cartouche
    if (bomRows) {
      const cols = [[0, 'Rep.'], [12, 'Qté'], [24, 'Désignation'], [118, 'Matière / norme'], [160, 'Masse']];
      const rows = bomRows.slice(0, 30);
      const by0 = y1;
      rect(x0, by0, fx1, by0 + (rows.length + 1) * rowH, 'CADRE');
      for (const [cx] of cols.slice(1)) line([x0 + cx, by0], [x0 + cx, by0 + (rows.length + 1) * rowH], 'CADRE');
      // en-tête en bas (convention : la nomenclature se lit de bas en haut)
      cols.forEach(([cx, lab]) => text([x0 + cx + 1.5, by0 + 1.8], 2.5, lab, 'TEXTE'));
      rows.forEach((r, i) => {
        const yy = by0 + (i + 1) * rowH;
        line([x0, yy], [fx1, yy], 'CADRE');
        const vals = [r.rep, r.qty, r.name, r.mat, r.mass];
        cols.forEach(([cx], k) => text([x0 + cx + 1.5, yy + 1.8], 2.5, String(vals[k]).slice(0, k === 2 ? 42 : 20), 'TEXTE'));
      });
      if (bomRows.length > 30) text([x0, by0 + (rows.length + 1) * rowH + 2], 2.5, `… ${bomRows.length - 30} lignes de plus (voir export CSV)`, 'TEXTE');
    }
  }
  const P = (v, x, y) => [ox + (x + v.ox) * s, oy + (y + v.oy) * s];
  for (const v of layout.views) {
    for (const q of v.data.visible) line(P(v, q[0], q[1]), P(v, q[2], q[3]), 'VISIBLE');
    if (hidden) for (const q of v.data.hidden) line(P(v, q[0], q[1]), P(v, q[2], q[3]), 'CACHE');
    const b = v.data.bbox;
    const [lx, ly] = P(v, b.minX, b.minY);
    text([lx, ly - th * 2.4], th, v.name.toUpperCase(), 'TEXTE');
    if (dims && v.name !== 'Isométrique') {
      const off = th * 2.2;
      const [ax, ay] = P(v, b.minX, b.maxY), [bx] = P(v, b.maxX, b.maxY);
      const y = ay + off;
      line([ax, y], [bx, y], 'COTES'); line([ax, ay + 1], [ax, y + 1.5], 'COTES'); line([bx, ay + 1], [bx, y + 1.5], 'COTES');
      line([ax, y], [ax + 2.5, y + 0.8], 'COTES'); line([ax, y], [ax + 2.5, y - 0.8], 'COTES'); line([bx, y], [bx - 2.5, y + 0.8], 'COTES'); line([bx, y], [bx - 2.5, y - 0.8], 'COTES');
      text([(ax + bx) / 2, y + 0.8], th * 0.9, fmtDim(b.maxX - b.minX), 'COTES', 'middle');
      const [cx, cy] = P(v, b.maxX, b.minY), [, dy] = P(v, b.maxX, b.maxY);
      const x = cx + off;
      line([x, cy], [x, dy], 'COTES'); line([cx + 1, cy], [x + 1.5, cy], 'COTES'); line([cx + 1, dy], [x + 1.5, dy], 'COTES');
      line([x, cy], [x + 0.8, cy + 2.5], 'COTES'); line([x, cy], [x - 0.8, cy + 2.5], 'COTES'); line([x, dy], [x + 0.8, dy - 2.5], 'COTES'); line([x, dy], [x - 0.8, dy - 2.5], 'COTES');
      text([x + 1.2, (cy + dy) / 2], th * 0.9, fmtDim(b.maxY - b.minY), 'COTES');
    }
  }
  // symboles de soudure (ISO 2553) sur la première vue orthogonale
  if (opts.welds && opts.welds.length) {
    const v = layout.views.find((x) => x.name !== 'Isométrique');
    if (v) {
      const Vw = VIEWS[v.name];
      opts.welds.forEach((w, i) => {
        const [px, py] = P(v, w.mid.dot(Vw.u), w.mid.dot(Vw.v));
        const k = 1 + (i % 4) * 0.45;
        const ex = px + 10 * k, ey = py + 10 * k;
        line([px, py], [ex, ey], 'SOUDURE');
        line([px, py], [px + 2.2, py + 0.9], 'SOUDURE'); line([px, py], [px + 0.9, py + 2.2], 'SOUDURE');
        line([ex, ey], [ex + 26, ey], 'SOUDURE');
        // triangle du cordon d'angle sous la ligne de référence (côté flèche)
        line([ex + 9, ey], [ex + 9, ey - 3.5], 'SOUDURE'); line([ex + 9, ey - 3.5], [ex + 12.5, ey], 'SOUDURE');
        text([ex + 1, ey - 3.2], 2.5, `a${w.a}`, 'SOUDURE');
        text([ex + 14, ey - 3.2], 2.5, `${Math.round(w.L)}`, 'SOUDURE');
      });
    }
  }
  return { prims, W: PW, H: PH, scale: s, paper: PAPERS[paper] ? paper : null };
}

export function drawingToDxf(layout, opts = {}) {
  const { prims } = drawingPrims(layout, opts);
  const dxf = new DxfWriter();
  const col = { VISIBLE: 7, CACHE: 8, COTES: 1, TEXTE: 3, CADRE: 5, SOUDURE: 6 };
  for (const p of prims) {
    const ly = dxf.layer(p.layer, col[p.layer] || 7);
    if (p.t === 'line') dxf.line(p.a, p.b, ly);
    else {
      const w = p.txt.length * p.h * 0.6;
      const x = p.anchor === 'middle' ? p.p[0] - w / 2 : p.anchor === 'end' ? p.p[0] - w : p.p[0];
      dxf.text([x, p.p[1]], p.h, p.txt, ly);
    }
  }
  return dxf.toString();
}

export function drawingToSvg(layout, opts = {}) {
  const { prims, W, H, paper } = drawingPrims(layout, opts);
  const base = paper ? 0.18 : Math.max(0.25, W / 900);
  const sty = {
    VISIBLE: `stroke="#111" stroke-width="${base * 2.6}" stroke-linecap="round"`,
    CACHE: `stroke="#777" stroke-width="${base * 1.3}" stroke-dasharray="${base * 10} ${base * 6}"`,
    COTES: `stroke="#c62828" stroke-width="${base * 1.1}"`,
    CADRE: `stroke="#222" stroke-width="${base * 2.2}"`,
    SOUDURE: `stroke="#6a1b9a" stroke-width="${base * 1.3}"`,
  };
  const groups = {};
  const texts = [];
  for (const p of prims) {
    if (p.t === 'line') (groups[p.layer] = groups[p.layer] || []).push(`M${p.a[0].toFixed(3)} ${(H - p.a[1]).toFixed(3)}L${p.b[0].toFixed(3)} ${(H - p.b[1]).toFixed(3)}`);
    else texts.push(`<text x="${p.p[0].toFixed(2)}" y="${(H - p.p[1]).toFixed(2)}" font-size="${p.h}" text-anchor="${p.anchor}" font-family="Arial" fill="${p.layer === 'SOUDURE' ? '#6a1b9a' : p.layer === 'COTES' ? '#c62828' : p.layer === 'TEXTE' && p.h < 3 ? '#555' : '#111'}">${esc(p.txt)}</text>`);
  }
  const paths = Object.entries(groups).map(([k, d]) => `<path d="${d.join('')}" fill="none" ${sty[k] || sty.VISIBLE}/>`).join('');
  const size = opts.forScreen ? 'width="100%" height="100%"' : `width="${W}mm" height="${H}mm"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${paths}${texts.join('')}</svg>`;
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
  const dirCache = new Map();
  const dirE = (v) => { const k = `${nf(v.x)},${nf(v.y)},${nf(v.z)}`; let d = dirCache.get(k); if (!d) { d = E(`DIRECTION('',(${k}))`); dirCache.set(k, d); } return d; };
  for (const b of bodies) {
    const g = mergeVertices(b.geom.clone().deleteAttribute('normal'), 1e-5);
    const p = g.getAttribute('position'), idx = g.index.array;
    const P = (i) => new THREE.Vector3().fromBufferAttribute(p, i);
    // triangles valides + normale
    const tris = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      const A = P(i0), n = P(i1).sub(A).cross(P(i2).sub(A));
      if (n.lengthSq() < 1e-14) continue;
      n.normalize();
      tris.push({ v: [i0, i1, i2], n, d: n.dot(A) });
    }
    // regroupe les triangles coplanaires voisins (union-find sur les arêtes partagées)
    const parent = tris.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edgeOwner = new Map();
    tris.forEach((t, ti) => {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k], c = t.v[(k + 1) % 3];
        const key = a < c ? a + '_' + c : c + '_' + a;
        const o = edgeOwner.get(key);
        if (o === undefined) edgeOwner.set(key, ti);
        else if (o >= 0) {
          const u = tris[o];
          if (u.n.dot(t.n) > 0.999999 && Math.abs(u.d - t.d) < 1e-4) parent[find(ti)] = find(o);
          edgeOwner.set(key, -1);
        }
      }
    });
    const groups = new Map();
    tris.forEach((t, ti) => { const r = find(ti); (groups.get(r) || groups.set(r, []).get(r)).push(t); });
    const pid = new Map();
    const pt = (i) => { let e = pid.get(i); if (!e) { e = E(`CARTESIAN_POINT('',(${nf(p.getX(i))},${nf(p.getY(i))},${nf(p.getZ(i))}))`); pid.set(i, e); } return e; };
    const faces = [];
    const triFace = (t) => {
      const pl = E(`PLANE('',#${E(`AXIS2_PLACEMENT_3D('',#${pt(t.v[0])},#${dirE(t.n)},$)`)})`);
      const loop = E(`POLY_LOOP('',(${t.v.map((i) => '#' + pt(i)).join(',')}))`);
      faces.push(E(`FACE_SURFACE('',(#${E(`FACE_OUTER_BOUND('',#${loop},.T.)`)}),#${pl},.T.)`));
    };
    for (const grp of groups.values()) {
      if (grp.length === 1) { triFace(grp[0]); continue; }
      // contour : arêtes orientées qui n'apparaissent qu'une fois dans le groupe
      const cnt = new Map();
      for (const t of grp) for (let k = 0; k < 3; k++) { const a = t.v[k], c = t.v[(k + 1) % 3]; const key = a < c ? a + '_' + c : c + '_' + a; cnt.set(key, (cnt.get(key) || 0) + 1); }
      const next = new Map();
      let multi = false;
      for (const t of grp) for (let k = 0; k < 3; k++) {
        const a = t.v[k], c = t.v[(k + 1) % 3]; const key = a < c ? a + '_' + c : c + '_' + a;
        if (cnt.get(key) === 1) { if (next.has(a)) multi = true; next.set(a, c); }
      }
      const loops = [];
      const seen = new Set();
      let fail = multi;
      for (const s0 of next.keys()) {
        if (fail || seen.has(s0)) continue;
        const loop = [s0]; seen.add(s0);
        let cur = next.get(s0), guard = 0;
        while (cur !== s0) { if (cur === undefined || seen.has(cur) || ++guard > 1e6) { fail = true; break; } loop.push(cur); seen.add(cur); cur = next.get(cur); }
        // retire les points alignés (jonctions en T)
        if (!fail) loops.push(loop);
      }
      if (fail || !loops.length) { grp.forEach(triFace); continue; }
      const n = grp[0].n;
      const area = (lp) => { let s2 = 0; for (let i = 0; i < lp.length; i++) { const a = P(lp[i]), c = P(lp[(i + 1) % lp.length]); s2 += a.clone().cross(c).dot(n); } return s2 / 2; };
      const areas = loops.map(area);
      const oi = areas.indexOf(Math.max(...areas));
      if (areas[oi] <= 0 || loops.some((lp) => lp.length < 3) || loops.length > 1) { grp.forEach(triFace); continue; } // faces percées : triangles (plus robuste à la relecture)
      const pl = E(`PLANE('',#${E(`AXIS2_PLACEMENT_3D('',#${pt(loops[oi][0])},#${dirE(n)},$)`)})`);
      const bounds = loops.map((lp, i) => E(`${i === oi ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${E(`POLY_LOOP('',(${lp.map((v) => '#' + pt(v)).join(',')}))`)},.T.)`));
      faces.push(E(`FACE_SURFACE('',(${bounds.map((x) => '#' + x).join(',')}),#${pl},.T.)`));
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
