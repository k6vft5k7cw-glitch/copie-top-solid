// Imports : STEP / IGES / BREP (noyau OpenCascade en WebAssembly), STL, OBJ, glTF/GLB, PLY, 3MF, DXF
import * as THREE from 'three';

let occtPromise = null;
async function getOcct() {
  if (!occtPromise) {
    occtPromise = (async () => {
      const [{ default: occtimportjs }, { default: wasmUrl }] = await Promise.all([
        import('occt-import-js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      let buf;
      if (wasmUrl.startsWith('data:')) {
        const bin = atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1));
        buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      } else buf = await (await fetch(wasmUrl)).arrayBuffer();
      return occtimportjs({ wasmBinary: buf });
    })();
  }
  return occtPromise;
}

/** Renvoie [{ name, position: Float32Array (non indexé), color }] ou { sketch: entities } pour un DXF */
export async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  const base = file.name.replace(/\.[^.]+$/, '');
  if (['step', 'stp', 'iges', 'igs', 'brep', 'brp'].includes(ext)) {
    const occt = await getOcct();
    const data = new Uint8Array(buf);
    const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 };
    const r = ext.startsWith('st') ? occt.ReadStepFile(data, params) : ext.startsWith('ig') ? occt.ReadIgesFile(data, params) : occt.ReadBrepFile(data, params);
    if (!r.success) throw new Error('Lecture du fichier impossible');
    const bodies = [];
    for (const m of r.meshes) {
      const pos = m.attributes.position.array, idx = m.index.array;
      const out = new Float32Array(idx.length * 3);
      for (let i = 0; i < idx.length; i++) { out[3 * i] = pos[3 * idx[i]]; out[3 * i + 1] = pos[3 * idx[i] + 1]; out[3 * i + 2] = pos[3 * idx[i] + 2]; }
      const c = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]).getHexString() : null;
      bodies.push({ name: m.name || base, position: out, color: c ? '#' + c : null });
    }
    return { bodies: mergeBodies(bodies, base) };
  }
  if (ext === 'stl') {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    return { bodies: [fromGeometry(new STLLoader().parse(buf), base)] };
  }
  if (ext === 'ply') {
    const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
    return { bodies: [fromGeometry(new PLYLoader().parse(buf), base)] };
  }
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    return { bodies: fromObject(new OBJLoader().parse(new TextDecoder().decode(buf)), base, 1) };
  }
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    // glTF : mètres et Y vers le haut -> mm et Z vers le haut
    const root = gltf.scene;
    root.scale.setScalar(1000);
    root.rotation.x = Math.PI / 2;
    return { bodies: fromObject(root, base, 1) };
  }
  if (ext === '3mf') {
    const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
    return { bodies: fromObject(new ThreeMFLoader().parse(buf), base, 1) };
  }
  if (ext === 'dxf') {
    return { sketch: parseDxf(new TextDecoder().decode(buf)), name: base };
  }
  throw new Error(`Format .${ext} non pris en charge`);
}

function fromGeometry(g, name) {
  const ng = g.index ? g.toNonIndexed() : g;
  return { name, position: new Float32Array(ng.getAttribute('position').array), color: null };
}

function fromObject(root, name) {
  root.updateMatrixWorld(true);
  const bodies = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const col = o.material && o.material.color ? '#' + o.material.color.getHexString() : null;
    bodies.push({ name: o.name || name, position: new Float32Array(g.getAttribute('position').array), color: col });
  });
  return mergeBodies(bodies, name);
}

function mergeBodies(bodies, name) {
  if (bodies.length <= 1) return bodies.map((b) => ({ ...b, name }));
  let n = 0;
  for (const b of bodies) n += b.position.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const b of bodies) { out.set(b.position, o); o += b.position.length; }
  return [{ name, position: out, color: bodies.find((b) => b.color)?.color || null, count: bodies.length }];
}

// ---------------------------------------------------------------- DXF -> entités d'esquisse
export function parseDxf(txt) {
  const lines = txt.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  let i = 0;
  // aller à la section ENTITIES
  while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES')) i++;
  const ents = [];
  let cur = null;
  let poly = null;
  const flush = () => {
    if (!cur) return;
    const g = cur.g;
    const n = (c, d = 0) => (g[c] != null ? parseFloat(g[c][0]) : d);
    switch (cur.type) {
      case 'LINE': ents.push({ type: 'line', a: [n(10), n(20)], b: [n(11), n(21)] }); break;
      case 'CIRCLE': ents.push({ type: 'circle', c: [n(10), n(20)], r: n(40) }); break;
      case 'ARC': ents.push({ type: 'arc', c: [n(10), n(20)], r: n(40), a0: n(50), a1: n(51) }); break;
      case 'LWPOLYLINE': {
        const xs = (g[10] || []).map(Number), ys = (g[20] || []).map(Number);
        const bul = cur.bulges || [];
        const closed = (parseInt(g[70]?.[0] || '0', 10) & 1) === 1;
        pushPoly(ents, xs.map((x, k) => [x, ys[k]]), bul, closed);
        break;
      }
      case 'POLYLINE': poly = { pts: [], bul: [], closed: (parseInt(g[70]?.[0] || '0', 10) & 1) === 1 }; break;
      case 'VERTEX': if (poly) { poly.pts.push([n(10), n(20)]); poly.bul.push(n(42)); } break;
      case 'SEQEND': if (poly) { pushPoly(ents, poly.pts, poly.bul, poly.closed); poly = null; } break;
    }
    cur = null;
  };
  for (; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      flush();
      if (v === 'ENDSEC' || v === 'EOF') break;
      cur = { type: v, g: {}, bulges: [] };
      continue;
    }
    if (!cur) continue;
    if (c === 42 && cur.type === 'LWPOLYLINE') {
      // bulge associé au dernier sommet
      const k = (cur.g[10] || []).length - 1;
      cur.bulges[k] = parseFloat(v);
      continue;
    }
    (cur.g[c] = cur.g[c] || []).push(v);
  }
  flush();
  return ents;
}

function pushPoly(ents, pts, bul, closed) {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[(k + 1) % n], bg = bul[k] || 0;
    if (Math.abs(bg) < 1e-9) { ents.push({ type: 'line', a, b }); continue; }
    // arc défini par le renflement (bulge)
    const theta = 4 * Math.atan(bg);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const r = d / (2 * Math.sin(theta / 2));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const h = r * Math.cos(theta / 2);
    const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
    const c = [mx + nx * h, my + ny * h];
    let a0 = (Math.atan2(a[1] - c[1], a[0] - c[0]) * 180) / Math.PI, a1 = (Math.atan2(b[1] - c[1], b[0] - c[0]) * 180) / Math.PI;
    if (bg < 0) [a0, a1] = [a1, a0];
    ents.push({ type: 'arc', c, r: Math.abs(r), a0, a1 });
  }
}
