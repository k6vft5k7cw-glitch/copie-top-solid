// Modèle du document : objets, transformations, reconstruction paramétrique et booléens
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { BASIC, buildHole, buildWeld, clean, prism, lathe, DEG } from './shapes.js';
import { buildPart, partLabel } from './library.js';
import { buildSheet, sheetLabel } from './sheet.js';
import { sketchShapes, revolveProfiles } from './sketch.js';
import { merge, creased } from './shapes.js';

export const MATERIALS = {
  'Acier': { density: 7.85, color: '#9aa4ad', metal: 0.55, rough: 0.42 },
  'Acier inoxydable': { density: 7.9, color: '#c9ced3', metal: 0.75, rough: 0.28 },
  'Acier galvanisé': { density: 7.85, color: '#b7bec4', metal: 0.6, rough: 0.55 },
  'Acier Corten': { density: 7.85, color: '#8a4b2a', metal: 0.2, rough: 0.85 },
  'Acier peint RAL 7035 (gris clair)': { density: 7.85, color: '#cbd0cc', metal: 0.05, rough: 0.5 },
  'Acier peint RAL 5010 (bleu)': { density: 7.85, color: '#1e4f8a', metal: 0.05, rough: 0.45 },
  'Acier peint RAL 3020 (rouge)': { density: 7.85, color: '#c1121c', metal: 0.05, rough: 0.45 },
  'Acier peint RAL 1023 (jaune)': { density: 7.85, color: '#f0c000', metal: 0.05, rough: 0.45 },
  'Acier peint RAL 6018 (vert)': { density: 7.85, color: '#57a639', metal: 0.05, rough: 0.45 },
  'Acier peint RAL 9005 (noir)': { density: 7.85, color: '#1b1c1e', metal: 0.05, rough: 0.4 },
  'Acier peint RAL 9010 (blanc)': { density: 7.85, color: '#f1ede1', metal: 0.05, rough: 0.45 },
  'Aluminium': { density: 2.7, color: '#d5d9de', metal: 0.7, rough: 0.35 },
  'Aluminium anodisé noir': { density: 2.7, color: '#2b2d31', metal: 0.5, rough: 0.35 },
  'Laiton': { density: 8.5, color: '#d4b44a', metal: 0.85, rough: 0.3 },
  'Bronze': { density: 8.8, color: '#b0793c', metal: 0.8, rough: 0.35 },
  'Cuivre': { density: 8.96, color: '#c77b4a', metal: 0.85, rough: 0.3 },
  'Fonte': { density: 7.2, color: '#6d7378', metal: 0.4, rough: 0.75 },
  'Titane': { density: 4.5, color: '#a8a39a', metal: 0.7, rough: 0.4 },
  'PLA': { density: 1.24, color: '#4f9de0', metal: 0, rough: 0.55 },
  'ABS': { density: 1.04, color: '#e8e2d4', metal: 0, rough: 0.6 },
  'PETG': { density: 1.27, color: '#5fbf8f', metal: 0, rough: 0.4 },
  'Nylon (PA)': { density: 1.14, color: '#efece4', metal: 0, rough: 0.6 },
  'POM (Delrin)': { density: 1.41, color: '#f4f4f0', metal: 0, rough: 0.45 },
  'PEHD': { density: 0.95, color: '#f2f2ee', metal: 0, rough: 0.6 },
  'Plexiglas (PMMA)': { density: 1.19, color: '#d8eef7', metal: 0, rough: 0.1 },
  'Bois (chêne)': { density: 0.75, color: '#b08454', metal: 0, rough: 0.8 },
  'Contreplaqué': { density: 0.6, color: '#d2b48c', metal: 0, rough: 0.8 },
  'Caoutchouc': { density: 1.2, color: '#333638', metal: 0, rough: 0.9 },
};

export const ROLE_OPS = { cut: SUBTRACTION, add: ADDITION, inter: INTERSECTION };
export const ROLE_LABEL = { cut: 'Enlèvement', add: 'Union', inter: 'Intersection' };

export const TYPE_LABEL = {
  ...Object.fromEntries(Object.entries(BASIC).map(([k, v]) => [k, v.label])),
  part: 'Composant normalisé', sheet: 'Chaudronnerie / tôlerie', sketch: 'Esquisse', extrude: 'Extrusion', revolve: 'Révolution', hole: 'Perçage', weld: 'Cordon de soudure', mesh: 'Corps importé',
};

export class Model {
  constructor() {
    this.reset();
    this.blobs = new Map(); // géométries importées (hors historique)
    this.cache = new Map();
    this.evaluator = new Evaluator();
    this.evaluator.attributes = ['position', 'normal'];
    this.evaluator.useGroups = false;
    this.errors = new Map();
  }

  reset() {
    this.objects = [];
    this.nextId = 1;
  }

  snapshot() { return JSON.stringify({ objects: this.objects, nextId: this.nextId }); }
  restore(s) { const d = JSON.parse(s); this.objects = d.objects; this.nextId = d.nextId; }

  get(id) { return this.objects.find((o) => o.id === id); }
  children(id) { return this.objects.filter((o) => o.parent === id); }
  roots() { return this.objects.filter((o) => o.parent == null); }

  add(o) {
    const obj = {
      id: this.nextId++, name: o.name || '', type: o.type, params: o.params || {},
      pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0], material: o.material || 'Acier', color: o.color || null,
      visible: o.visible !== false, parent: o.parent ?? null, role: o.role ?? null,
    };
    this.objects.push(obj);
    return obj;
  }

  remove(id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of this.objects) if (o.parent != null && ids.has(o.parent) && !ids.has(o.id)) { ids.add(o.id); grew = true; }
    }
    // les extrusions dépendantes d'une esquisse supprimée deviennent des corps figés
    for (const o of this.objects) {
      if (!ids.has(o.id) && (o.type === 'extrude' || o.type === 'revolve') && ids.has(o.params.sketch)) this.freeze(o);
    }
    this.objects = this.objects.filter((o) => !ids.has(o.id));
  }

  /** Remplace la géométrie paramétrique d'un objet par un maillage figé */
  freeze(o) {
    const g = this.baseGeometry(o);
    if (!g) return;
    const key = 'b' + this.nextId++;
    this.blobs.set(key, { position: g.getAttribute('position').array.slice() });
    o.type = 'mesh';
    o.params = { blob: key };
  }

  localMatrix(o) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG, 'XYZ'));
    m.compose(new THREE.Vector3(...o.pos), q, new THREE.Vector3(1, 1, 1));
    return m;
  }

  worldMatrix(o) {
    const m = this.localMatrix(o);
    if (o.parent != null) {
      const p = this.get(o.parent);
      if (p) return this.worldMatrix(p).multiply(m);
    }
    return m;
  }

  setWorldMatrix(o, world) {
    let local = world.clone();
    if (o.parent != null) {
      const p = this.get(o.parent);
      if (p) local = this.worldMatrix(p).invert().multiply(world);
    }
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(pos, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    o.pos = [pos.x, pos.y, pos.z].map(round);
    o.rot = [e.x / DEG, e.y / DEG, e.z / DEG].map(round);
  }

  isSolid(o) { return o && o.type !== 'sketch'; }

  baseKey(o) {
    if (o.type === 'extrude' || o.type === 'revolve') {
      const sk = this.get(o.params.sketch);
      return o.type + JSON.stringify(o.params) + JSON.stringify(sk ? sk.params.entities : null);
    }
    return o.type + JSON.stringify(o.params);
  }

  baseGeometry(o) {
    const p = o.params;
    if (BASIC[o.type]) return clean(BASIC[o.type].build(p));
    switch (o.type) {
      case 'part': { const g = buildPart(p); return g ? clean(g) : null; }
      case 'sheet': return buildSheet(p);
      case 'hole': return clean(buildHole(p));
      case 'weld': return clean(buildWeld(p));
      case 'mesh': {
        const b = this.blobs.get(p.blob);
        if (!b) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.position), 3));
        if (b.normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.normal), 3));
        else g.computeVertexNormals();
        return g;
      }
      case 'extrude': {
        const sk = this.get(p.sketch);
        if (!sk) return null;
        const shapes = sketchShapes(sk.params.entities);
        if (!shapes.length) throw new Error('Aucun contour fermé dans l\'esquisse');
        const h = Math.max(0.01, p.h);
        const g = prism(shapes, h);
        if (p.dir === 'Inverse') g.translate(0, 0, -h);
        if (p.dir === 'Symétrique') g.translate(0, 0, -h / 2);
        return clean(g);
      }
      case 'revolve': {
        const sk = this.get(p.sketch);
        if (!sk) return null;
        const profs = revolveProfiles(sk.params.entities);
        if (!profs.length) throw new Error('Aucun contour fermé dans l\'esquisse');
        // révolution autour de l'axe Y de l'esquisse
        const phi = Math.max(1, Math.min(360, p.angle)) * DEG;
        const g = merge(profs.map((prof) => creased(new THREE.LatheGeometry(prof.map((q) => new THREE.Vector2(q[0], q[1])), 96, 0, phi))));
        return clean(g);
      }
    }
    return null;
  }

  /** Géométrie finale (dans le repère local de l'objet) après opérations booléennes des enfants */
  finalGeometry(o, depth = 0) {
    if (!this.isSolid(o) || depth > 20) return null;
    const kids = this.children(o.id).filter((c) => c.role && this.isSolid(c));
    const parts = [];
    const base = this.cached('B' + this.baseKey(o), () => this.baseGeometry(o));
    if (!base) return null;
    parts.push(this.baseKey(o));
    const kidGeoms = [];
    for (const c of kids) {
      const g = this.finalGeometry(c, depth + 1);
      if (!g) continue;
      const lm = this.localMatrix(c);
      kidGeoms.push({ c, g: g.geom, m: lm });
      parts.push(c.role + g.key + lm.elements.map((v) => v.toFixed(4)).join(','));
    }
    const key = parts.join('|');
    if (!kidGeoms.length) return { geom: base, key };
    const geom = this.cached('F' + key, () => {
      let a = new Brush(base);
      a.updateMatrixWorld();
      for (const { c, g, m } of kidGeoms) {
        try {
          const b = new Brush(g);
          b.applyMatrix4(m);
          b.updateMatrixWorld();
          a = this.evaluator.evaluate(a, b, ROLE_OPS[c.role]);
          this.errors.delete(c.id);
        } catch (err) {
          this.errors.set(c.id, 'Opération booléenne impossible : ' + err.message);
        }
      }
      return clean(a.geometry);
    });
    return { geom, key };
  }

  cached(key, fn) {
    if (this.cache.has(key)) return this.cache.get(key);
    const v = fn();
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(key, v);
    return v;
  }

  displayName(o) {
    return o.name || (o.type === 'part' ? partLabel(o.params) : o.type === 'sheet' ? sheetLabel(o.params) : TYPE_LABEL[o.type]);
  }

  color(o) {
    return o.color || (MATERIALS[o.material] || MATERIALS['Acier']).color;
  }

  /** Volume (mm³) d'une géométrie fermée */
  static volume(g) {
    const p = g.getAttribute('position').array;
    let v = 0;
    for (let i = 0; i < p.length; i += 9) {
      v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
    }
    return Math.abs(v);
  }

  /** Liste des corps solides visibles de premier niveau (ou sélection) avec leur géométrie monde */
  worldBodies(ids = null) {
    const out = [];
    for (const o of this.objects) {
      if (!this.isSolid(o)) continue;
      if (o.role) continue; // consommé par un booléen
      if (ids ? !ids.includes(o.id) : !this.isVisible(o)) continue;
      let f;
      try { f = this.finalGeometry(o); } catch (e) { continue; }
      if (!f) continue;
      const g = f.geom.clone().applyMatrix4(this.worldMatrix(o));
      out.push({ obj: o, geom: g, name: this.displayName(o), color: this.color(o) });
    }
    return out;
  }

  isVisible(o) {
    if (!o.visible) return false;
    if (o.parent != null) { const p = this.get(o.parent); return p ? this.isVisible(p) : true; }
    return true;
  }

  // ------------------------------------------------------------ sérialisation projet
  toFile() {
    const blobs = {};
    const used = new Set(this.objects.filter((o) => o.type === 'mesh').map((o) => o.params.blob));
    for (const [k, v] of this.blobs) {
      if (!used.has(k)) continue;
      blobs[k] = { position: f32ToB64(v.position) };
      if (v.normal) blobs[k].normal = f32ToB64(v.normal);
    }
    return JSON.stringify({ app: 'FormaCAD', version: 1, objects: this.objects, nextId: this.nextId, blobs });
  }

  fromFile(txt) {
    const d = JSON.parse(txt);
    if (!d.objects) throw new Error('Fichier projet invalide');
    this.objects = d.objects;
    this.nextId = d.nextId || this.objects.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    this.blobs = new Map();
    for (const [k, v] of Object.entries(d.blobs || {})) {
      this.blobs.set(k, { position: b64ToF32(v.position), normal: v.normal ? b64ToF32(v.normal) : null });
    }
    this.cache.clear();
  }
}

export function round(v) { return Math.round(v * 1e4) / 1e4; }

function f32ToB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToF32(b) {
  const s = atob(b);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
