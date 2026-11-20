// Bibliothèque de composants normalisés (dimensions issues des normes ISO / DIN / EN)
// Toutes les géométries sont générées de façon paramétrique : aucune donnée propriétaire.
import * as THREE from 'three';
import { cyl, cone, prism, makeShape, circlePts, polyPts, arcPts, roundRectPts, slotPts, lathe, merge, orientAxis } from './shapes.js';

const LENGTHS = [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];
const hexR = (s) => s / Math.sqrt(3); // rayon circonscrit d'un six pans de cote sur plats s

const L = (def = 20) => ({ k: 'L', label: 'Longueur', def, unit: 'mm', options: LENGTHS });
const LEN = (def = 500) => ({ k: 'L', label: 'Longueur', def, unit: 'mm', min: 1 });
const AXIS = { k: 'axis', label: 'Orientation', def: 'X', options: ['X', 'Y', 'Z'] };

function shank(d, Lg) {
  return cyl(d / 2, Lg, -Lg, 32);
}

const families = [
  // ------------------------------------------------------------------ VISSERIE
  {
    id: 'iso4762', cat: 'Visserie', name: 'Vis CHC – tête cylindrique six pans creux', std: 'ISO 4762',
    cols: ['d', 'dk', 'k', 's', 't'],
    sizes: {
      M3: [3, 5.5, 3, 2.5, 1.3], M4: [4, 7, 4, 3, 2], M5: [5, 8.5, 5, 4, 2.5], M6: [6, 10, 6, 5, 3], M8: [8, 13, 8, 6, 4],
      M10: [10, 16, 10, 8, 5], M12: [12, 18, 12, 10, 6], M14: [14, 21, 14, 12, 7], M16: [16, 24, 16, 14, 8],
      M20: [20, 30, 20, 17, 10], M24: [24, 36, 24, 19, 12],
    },
    extra: [L(20)], defSize: 'M6',
    build: ([d, dk, k, s, t], p) => merge([
      cyl(dk / 2, k - t, 0, 48),
      prism(makeShape(circlePts(dk / 2, 48), [polyPts(6, hexR(s))]), t, k - t),
      shank(d, p.L),
    ]),
    label: (sz, p) => `Vis CHC ${sz}x${p.L}`,
  },
  {
    id: 'iso4017', cat: 'Visserie', name: 'Vis H – tête hexagonale', std: 'ISO 4017',
    cols: ['d', 's', 'k'],
    sizes: {
      M3: [3, 5.5, 2], M4: [4, 7, 2.8], M5: [5, 8, 3.5], M6: [6, 10, 4], M8: [8, 13, 5.3], M10: [10, 16, 6.4], M12: [12, 18, 7.5],
      M14: [14, 21, 8.8], M16: [16, 24, 10], M20: [20, 30, 12.5], M24: [24, 36, 15],
    },
    extra: [L(25)], defSize: 'M8',
    build: ([d, s, k], p) => merge([prism(makeShape(polyPts(6, hexR(s))), k), shank(d, p.L)]),
    label: (sz, p) => `Vis H ${sz}x${p.L}`,
  },
  {
    id: 'iso10642', cat: 'Visserie', name: 'Vis FHC – tête fraisée six pans creux', std: 'ISO 10642',
    cols: ['d', 'dk', 's'],
    sizes: {
      M3: [3, 6.72, 2], M4: [4, 8.96, 2.5], M5: [5, 11.2, 3], M6: [6, 13.44, 4], M8: [8, 17.92, 5], M10: [10, 22.4, 6],
      M12: [12, 26.88, 8], M16: [16, 33.6, 10], M20: [20, 40.32, 12],
    },
    extra: [L(20)], defSize: 'M6',
    build: ([d, dk, s], p) => {
      const hc = (dk - d) / 2;
      const t = Math.min(hc * 0.8, s * 0.6);
      return merge([
        lathe([[0, -p.L], [d / 2, -p.L], [d / 2, -hc], [dk / 2, -t], [0, -t]], 48),
        prism(makeShape(circlePts(dk / 2, 48), [polyPts(6, hexR(s))]), t, -t),
      ]);
    },
    label: (sz, p) => `Vis FHC ${sz}x${p.L}`,
  },
  {
    id: 'iso7380', cat: 'Visserie', name: 'Vis BHC – tête bombée six pans creux', std: 'ISO 7380',
    cols: ['d', 'dk', 'k'],
    sizes: { M3: [3, 5.7, 1.65], M4: [4, 7.6, 2.2], M5: [5, 9.5, 2.75], M6: [6, 10.5, 3.3], M8: [8, 14, 4.4], M10: [10, 17.5, 5.5], M12: [12, 21, 6.6] },
    extra: [L(12)], defSize: 'M5',
    build: ([d, dk, k], p) => {
      const dome = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * (Math.PI / 2);
        dome.push([(dk / 2) * Math.cos(a), k * Math.sin(a)]);
      }
      return merge([lathe([[0, -p.L], [d / 2, -p.L], [d / 2, 0], ...dome, [0, k]], 48)]);
    },
    label: (sz, p) => `Vis BHC ${sz}x${p.L}`,
  },
  {
    id: 'iso4026', cat: 'Visserie', name: 'Vis sans tête six pans creux bout plat', std: 'ISO 4026',
    cols: ['d', 's'],
    sizes: { M3: [3, 1.5], M4: [4, 2], M5: [5, 2.5], M6: [6, 3], M8: [8, 4], M10: [10, 5], M12: [12, 6] },
    extra: [L(10)], defSize: 'M6',
    build: ([d, s], p) => merge([
      cyl(d / 2, p.L - s, -p.L, 32),
      prism(makeShape(circlePts(d / 2, 32), [polyPts(6, hexR(s))]), s, -s),
    ]),
    label: (sz, p) => `Vis STHC ${sz}x${p.L}`,
  },
  {
    id: 'din975', cat: 'Visserie', name: 'Tige filetée', std: 'DIN 975',
    cols: ['d'],
    sizes: { M3: [3], M4: [4], M5: [5], M6: [6], M8: [8], M10: [10], M12: [12], M16: [16], M20: [20], M24: [24] },
    extra: [LEN(200)], defSize: 'M8',
    build: ([d], p) => cyl(d / 2, p.L, 0, 32),
    label: (sz, p) => `Tige filetée ${sz} L${p.L}`,
  },
  {
    id: 'iso4032', cat: 'Visserie', name: 'Écrou hexagonal', std: 'ISO 4032',
    cols: ['d', 's', 'm'],
    sizes: {
      M3: [3, 5.5, 2.4], M4: [4, 7, 3.2], M5: [5, 8, 4.7], M6: [6, 10, 5.2], M8: [8, 13, 6.8], M10: [10, 16, 8.4], M12: [12, 18, 10.8],
      M14: [14, 21, 12.8], M16: [16, 24, 14.8], M20: [20, 30, 18], M24: [24, 36, 21.5],
    },
    extra: [], defSize: 'M8',
    build: ([d, s, m]) => prism(makeShape(polyPts(6, hexR(s)), [circlePts(d / 2, 32)]), m),
    label: (sz) => `Écrou H ${sz}`,
  },
  {
    id: 'iso7040', cat: 'Visserie', name: 'Écrou frein à bague nylon', std: 'ISO 7040',
    cols: ['d', 's', 'h'],
    sizes: { M3: [3, 5.5, 4], M4: [4, 7, 5], M5: [5, 8, 5], M6: [6, 10, 6], M8: [8, 13, 8], M10: [10, 16, 10], M12: [12, 18, 12], M16: [16, 24, 16], M20: [20, 30, 20] },
    extra: [], defSize: 'M8',
    build: ([d, s, h]) => merge([
      prism(makeShape(polyPts(6, hexR(s)), [circlePts(d / 2, 32)]), h * 0.72),
      prism(makeShape(circlePts(s * 0.46, 48), [circlePts(d / 2, 32)]), h * 0.28, h * 0.72),
    ]),
    label: (sz) => `Écrou Nylstop ${sz}`,
  },
  {
    id: 'iso7089', cat: 'Visserie', name: 'Rondelle plate', std: 'ISO 7089',
    cols: ['d1', 'd2', 'h'],
    sizes: {
      M3: [3.2, 7, 0.5], M4: [4.3, 9, 0.8], M5: [5.3, 10, 1], M6: [6.4, 12, 1.6], M8: [8.4, 16, 1.6], M10: [10.5, 20, 2], M12: [13, 24, 2.5],
      M14: [15, 28, 2.5], M16: [17, 30, 3], M20: [21, 37, 3], M24: [25, 44, 4],
    },
    extra: [], defSize: 'M8',
    build: ([d1, d2, h]) => prism(makeShape(circlePts(d2 / 2, 48), [circlePts(d1 / 2, 32)]), h),
    label: (sz) => `Rondelle ${sz}`,
  },
  {
    id: 'iso7093', cat: 'Visserie', name: 'Rondelle large', std: 'ISO 7093',
    cols: ['d1', 'd2', 'h'],
    sizes: { M3: [3.2, 9, 0.8], M4: [4.3, 12, 1], M5: [5.3, 15, 1.2], M6: [6.4, 18, 1.6], M8: [8.4, 24, 2], M10: [10.5, 30, 2.5], M12: [13, 37, 3], M16: [17, 50, 3], M20: [22, 60, 4] },
    extra: [], defSize: 'M8',
    build: ([d1, d2, h]) => prism(makeShape(circlePts(d2 / 2, 48), [circlePts(d1 / 2, 32)]), h),
    label: (sz) => `Rondelle large ${sz}`,
  },
  // ------------------------------------------------------------------ GUIDAGE
  ...[['6000', 'Roulement à billes série 60', {
    '6000': [10, 26, 8], '6001': [12, 28, 8], '6002': [15, 32, 9], '6003': [17, 35, 10], '6004': [20, 42, 12], '6005': [25, 47, 12],
    '6006': [30, 55, 13], '6007': [35, 62, 14], '6008': [40, 68, 15], '6009': [45, 75, 16], '6010': [50, 80, 16],
  }, '6004'], ['6200', 'Roulement à billes série 62', {
    '6200': [10, 30, 9], '6201': [12, 32, 10], '6202': [15, 35, 11], '6203': [17, 40, 12], '6204': [20, 47, 14], '6205': [25, 52, 15],
    '6206': [30, 62, 16], '6207': [35, 72, 17], '6208': [40, 80, 18], '6209': [45, 85, 19], '6210': [50, 90, 20],
  }, '6204'], ['6300', 'Roulement à billes série 63', {
    '6300': [10, 35, 11], '6301': [12, 37, 12], '6302': [15, 42, 13], '6303': [17, 47, 14], '6304': [20, 52, 15], '6305': [25, 62, 17],
    '6306': [30, 72, 19], '6307': [35, 80, 21], '6308': [40, 90, 23],
  }, '6304'], ['mini', 'Roulement miniature', {
    '623': [3, 10, 4], '624': [4, 13, 5], '625': [5, 16, 5], '626': [6, 19, 6], '608': [8, 22, 7], '688': [8, 16, 5], '609': [9, 24, 7],
  }, '608']].map(([id, name, sizes, def]) => ({
    id: 'brg' + id, cat: 'Guidage', name, std: 'ISO 15',
    cols: ['d', 'D', 'B'], sizes, defSize: def,
    extra: [{ k: 'seal', label: 'Exécution', def: '2RS (étanche)', options: ['2RS (étanche)', 'Ouvert'] }],
    build: ([d, D, B], p) => bearing(d, D, B, p.seal !== 'Ouvert'),
    label: (sz, p) => `Roulement ${sz}${p.seal !== 'Ouvert' ? '-2RS' : ''}`,
  })),
  {
    id: 'iso2338', cat: 'Guidage', name: 'Goupille cylindrique', std: 'ISO 2338',
    cols: ['d'], sizes: { 'Ø2': [2], 'Ø3': [3], 'Ø4': [4], 'Ø5': [5], 'Ø6': [6], 'Ø8': [8], 'Ø10': [10], 'Ø12': [12] },
    extra: [L(20)], defSize: 'Ø6',
    build: ([d], p) => cyl(d / 2, p.L, 0, 32),
    label: (sz, p) => `Goupille ${sz}x${p.L}`,
  },
  {
    id: 'iso8752', cat: 'Guidage', name: 'Goupille élastique', std: 'ISO 8752',
    cols: ['d', 's'], sizes: { 'Ø2': [2, 0.4], 'Ø3': [3, 0.6], 'Ø4': [4, 0.8], 'Ø5': [5, 1], 'Ø6': [6, 1.2], 'Ø8': [8, 1.5], 'Ø10': [10, 2] },
    extra: [L(20)], defSize: 'Ø6',
    build: ([d, s], p) => {
      const g = 0.25, R = d / 2, r = R - s;
      const outer = arcPts(0, 0, R, g, Math.PI * 2 - g, 40);
      const inner = arcPts(0, 0, r, Math.PI * 2 - g * 1.2, g * 1.2, 40);
      return prism(makeShape([...outer, ...inner]), p.L);
    },
    label: (sz, p) => `Goupille élastique ${sz}x${p.L}`,
  },
  // ------------------------------------------------------------------ TRANSMISSION
  {
    id: 'gear', cat: 'Transmission', name: 'Engrenage droit (denture en développante)', std: 'ISO 53',
    cols: ['m'], sizes: { 'm0.5': [0.5], 'm0.8': [0.8], 'm1': [1], 'm1.25': [1.25], 'm1.5': [1.5], 'm2': [2], 'm2.5': [2.5], 'm3': [3], 'm4': [4], 'm5': [5] },
    extra: [
      { k: 'z', label: 'Nombre de dents', def: 24, min: 6, step: 1, unit: '' },
      { k: 'b', label: 'Largeur de denture', def: 10, unit: 'mm', min: 0.1 },
      { k: 'bore', label: 'Ø alésage', def: 8, unit: 'mm', min: 0 },
    ], defSize: 'm1',
    build: ([m], p) => {
      const holes = p.bore > 0 ? [circlePts(p.bore / 2, 48)] : [];
      return prism(makeShape(gearPts(m, Math.max(6, Math.round(p.z))), holes), p.b);
    },
    label: (sz, p) => `Pignon ${sz} Z${p.z}`,
  },
  {
    id: 'din6885', cat: 'Transmission', name: 'Clavette parallèle forme A', std: 'DIN 6885',
    cols: ['b', 'h'], sizes: { '4x4': [4, 4], '5x5': [5, 5], '6x6': [6, 6], '8x7': [8, 7], '10x8': [10, 8], '12x8': [12, 8], '14x9': [14, 9], '16x10': [16, 10] },
    extra: [L(25)], defSize: '8x7',
    build: ([b, h], p) => prism(makeShape(slotPts(Math.max(0.01, p.L - b), b)), h),
    label: (sz, p) => `Clavette ${sz}x${p.L}`,
  },
  {
    id: 'spring', cat: 'Transmission', name: 'Ressort de compression', std: 'EN 13906',
    cols: ['dfil'], sizes: { 'fil 0.5': [0.5], 'fil 0.8': [0.8], 'fil 1': [1], 'fil 1.5': [1.5], 'fil 2': [2], 'fil 3': [3], 'fil 4': [4] },
    extra: [
      { k: 'De', label: 'Ø extérieur', def: 12, unit: 'mm', min: 1 },
      { k: 'L0', label: 'Longueur libre', def: 30, unit: 'mm', min: 1 },
      { k: 'n', label: 'Nombre de spires', def: 8, unit: '', min: 1, step: 1 },
    ], defSize: 'fil 1',
    build: ([dw], p) => spring(dw, p.De, p.L0, p.n),
    label: (sz, p) => `Ressort ${sz} De${p.De} L${p.L0}`,
  },
  // ------------------------------------------------------------------ PROFILÉS ACIER
  ...[['ipe', 'Poutrelle IPE', 'EN 10365', {
    80: [80, 46, 3.8, 5.2, 5], 100: [100, 55, 4.1, 5.7, 7], 120: [120, 64, 4.4, 6.3, 7], 140: [140, 73, 4.7, 6.9, 7], 160: [160, 82, 5, 7.4, 9],
    180: [180, 91, 5.3, 8, 9], 200: [200, 100, 5.6, 8.5, 12], 220: [220, 110, 5.9, 9.2, 12], 240: [240, 120, 6.2, 9.8, 15], 270: [270, 135, 6.6, 10.2, 15], 300: [300, 150, 7.1, 10.7, 15],
  }, '120'], ['hea', 'Poutrelle HEA', 'EN 10365', {
    100: [96, 100, 5, 8, 12], 120: [114, 120, 5, 8, 12], 140: [133, 140, 5.5, 8.5, 12], 160: [152, 160, 6, 9, 15], 180: [171, 180, 6, 9.5, 15],
    200: [190, 200, 6.5, 10, 18], 220: [210, 220, 7, 11, 18], 240: [230, 240, 7.5, 12, 21], 260: [250, 260, 7.5, 12.5, 24], 300: [290, 300, 8.5, 14, 27],
  }, '160'], ['heb', 'Poutrelle HEB', 'EN 10365', {
    100: [100, 100, 6, 10, 12], 120: [120, 120, 6.5, 11, 12], 140: [140, 140, 7, 12, 12], 160: [160, 160, 8, 13, 15], 180: [180, 180, 8.5, 14, 15],
    200: [200, 200, 9, 15, 18], 220: [220, 220, 9.5, 16, 18], 240: [240, 240, 10, 17, 21],
  }, '160']].map(([id, name, std, sizes, def]) => ({
    id, cat: 'Profilés acier', name, std, cols: ['h', 'b', 'tw', 'tf', 'r'],
    sizes: Object.fromEntries(Object.entries(sizes).map(([k, v]) => [id.toUpperCase() + ' ' + k, v])), defSize: id.toUpperCase() + ' ' + def,
    extra: [LEN(1000), AXIS],
    build: (s, p) => orientAxis(prism(makeShape(iBeamPts(...s)), p.L), p.axis),
    label: (sz, p) => `${sz} L${p.L}`,
  })),
  {
    id: 'upn', cat: 'Profilés acier', name: 'Profilé en U (UPN)', std: 'DIN 1026',
    cols: ['h', 'b', 'tw', 'tf'],
    sizes: { 'UPN 50': [50, 38, 5, 7], 'UPN 65': [65, 42, 5.5, 7.5], 'UPN 80': [80, 45, 6, 8], 'UPN 100': [100, 50, 6, 8.5], 'UPN 120': [120, 55, 7, 9], 'UPN 140': [140, 60, 7, 10], 'UPN 160': [160, 65, 7.5, 10.5], 'UPN 180': [180, 70, 8, 11], 'UPN 200': [200, 75, 8.5, 11.5] },
    extra: [LEN(1000), AXIS], defSize: 'UPN 100',
    build: ([h, b, tw, tf], p) => orientAxis(prism(makeShape([[0, -h / 2], [b, -h / 2], [b, -h / 2 + tf], [tw, -h / 2 + tf], [tw, h / 2 - tf], [b, h / 2 - tf], [b, h / 2], [0, h / 2]]), p.L), p.axis),
    label: (sz, p) => `${sz} L${p.L}`,
  },
  {
    id: 'angle', cat: 'Profilés acier', name: 'Cornière à ailes égales', std: 'EN 10056',
    cols: ['a', 't'],
    sizes: { 'L 20x3': [20, 3], 'L 25x3': [25, 3], 'L 30x3': [30, 3], 'L 40x4': [40, 4], 'L 50x5': [50, 5], 'L 60x6': [60, 6], 'L 70x7': [70, 7], 'L 80x8': [80, 8], 'L 100x10': [100, 10] },
    extra: [LEN(1000), AXIS], defSize: 'L 40x4',
    build: ([a, t], p) => orientAxis(prism(makeShape([[0, 0], [a, 0], [a, t], [t, t], [t, a], [0, a]]), p.L), p.axis),
    label: (sz, p) => `Cornière ${sz} L${p.L}`,
  },
  {
    id: 'sqtube', cat: 'Profilés acier', name: 'Tube carré / rectangulaire', std: 'EN 10219',
    cols: ['a', 'b', 't'],
    sizes: { '20x20x2': [20, 20, 2], '25x25x2': [25, 25, 2], '30x30x2': [30, 30, 2], '40x40x2': [40, 40, 2], '40x40x3': [40, 40, 3], '50x50x3': [50, 50, 3], '60x60x3': [60, 60, 3], '80x80x4': [80, 80, 4], '100x100x4': [100, 100, 4], '40x20x2': [40, 20, 2], '50x30x3': [50, 30, 3], '60x40x3': [60, 40, 3], '80x40x3': [80, 40, 3], '100x50x4': [100, 50, 4] },
    extra: [LEN(1000), AXIS], defSize: '40x40x2',
    build: ([a, b, t], p) => orientAxis(prism(makeShape(roundRectPts(a, b, 2 * t), [roundRectPts(a - 2 * t, b - 2 * t, t).reverse()]), p.L), p.axis),
    label: (sz, p) => `Tube ${sz} L${p.L}`,
  },
  {
    id: 'rdtube', cat: 'Profilés acier', name: 'Tube rond', std: 'EN 10255',
    cols: ['D', 't'],
    sizes: { '21.3x2.3': [21.3, 2.3], '26.9x2.3': [26.9, 2.3], '33.7x2.6': [33.7, 2.6], '42.4x2.6': [42.4, 2.6], '48.3x2.9': [48.3, 2.9], '60.3x2.9': [60.3, 2.9], '76.1x2.9': [76.1, 2.9], '88.9x3.2': [88.9, 3.2] },
    extra: [LEN(1000), AXIS], defSize: '42.4x2.6',
    build: ([D, t], p) => orientAxis(prism(makeShape(circlePts(D / 2, 64), [circlePts(D / 2 - t, 64)]), p.L), p.axis),
    label: (sz, p) => `Tube Ø${sz} L${p.L}`,
  },
  {
    id: 'flat', cat: 'Profilés acier', name: 'Fer plat', std: 'EN 10058',
    cols: ['b', 't'],
    sizes: { '20x3': [20, 3], '20x5': [20, 5], '30x5': [30, 5], '40x5': [40, 5], '40x8': [40, 8], '50x5': [50, 5], '50x10': [50, 10], '60x8': [60, 8], '80x10': [80, 10], '100x10': [100, 10] },
    extra: [LEN(500), AXIS], defSize: '40x5',
    build: ([b, t], p) => orientAxis(prism(makeShape(roundRectPts(b, t, 0)), p.L), p.axis),
    label: (sz, p) => `Plat ${sz} L${p.L}`,
  },
  {
    id: 'round', cat: 'Profilés acier', name: 'Rond plein', std: 'EN 10060',
    cols: ['d'],
    sizes: Object.fromEntries([6, 8, 10, 12, 16, 20, 25, 30, 40, 50, 60, 80].map((d) => ['Ø' + d, [d]])),
    extra: [LEN(500), AXIS], defSize: 'Ø20',
    build: ([d], p) => orientAxis(cyl(d / 2, p.L, 0, 48), p.axis),
    label: (sz, p) => `Rond ${sz} L${p.L}`,
  },
  // ------------------------------------------------------------------ PROFILÉS ALU
  {
    id: 'alu', cat: 'Profilés aluminium', name: 'Profilé aluminium rainuré (géométrie simplifiée)', std: 'Type B / I',
    cols: ['a', 's', 'n', 'w', 'w2', 'dep', 'hole'],
    sizes: {
      '20x20 rainure 6': [20, 6.2, 1.5, 11, 6, 4.5, 4.2], '30x30 rainure 8': [30, 8.2, 2.2, 16.5, 8, 6.8, 6.8],
      '40x40 rainure 8': [40, 8.2, 4.3, 20, 10, 7, 10.5], '45x45 rainure 10': [45, 10.2, 4.5, 22, 12, 8, 12],
      '40x80 rainure 8': [40, 8.2, 4.3, 20, 10, 7, 10.5],
    },
    extra: [LEN(500), AXIS], defSize: '40x40 rainure 8',
    build: (s, p) => orientAxis(prism(aluProfile(s, p.size), p.L), p.axis),
    label: (sz, p) => `Profilé alu ${sz.split(' ')[0]} L${p.L}`,
  },
];

// ---------------------------------------------------------------- générateurs spécifiques
function bearing(d, D, B, sealed) {
  const w = (D - d) / 2;
  const ro0 = D / 2 - 0.32 * w, ri1 = d / 2 + 0.32 * w;
  const parts = [
    lathe([[ro0, 0], [D / 2, 0], [D / 2, B], [ro0, B], [ro0, 0]], 64),
    lathe([[d / 2, 0], [ri1, 0], [ri1, B], [d / 2, B], [d / 2, 0]], 64),
  ];
  const rm = (D + d) / 4, bd = Math.min(0.55 * w, 0.8 * B);
  const nb = Math.max(6, Math.floor((Math.PI * 2 * rm) / (bd * 1.35)));
  if (sealed) {
    const e = Math.min(0.6, B * 0.08);
    parts.push(lathe([[ri1, e], [ro0, e], [ro0, e + 0.4], [ri1, e + 0.4], [ri1, e]], 64));
    parts.push(lathe([[ri1, B - e - 0.4], [ro0, B - e - 0.4], [ro0, B - e], [ri1, B - e], [ri1, B - e - 0.4]], 64));
  }
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2;
    parts.push(new THREE.SphereGeometry(bd / 2, 16, 12).translate(rm * Math.cos(a), rm * Math.sin(a), B / 2));
  }
  return merge(parts);
}

function iBeamPts(h, b, tw, tf, r) {
  const H = Math.PI / 2, n = 6;
  return [
    [-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf],
    ...arcPts(tw / 2 + r, -h / 2 + tf + r, r, -H, -2 * H, n),
    ...arcPts(tw / 2 + r, h / 2 - tf - r, r, 2 * H, H, n),
    [b / 2, h / 2 - tf], [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf],
    ...arcPts(-tw / 2 - r, h / 2 - tf - r, r, H, 0, n),
    ...arcPts(-tw / 2 - r, -h / 2 + tf + r, r, 0, -H, n),
    [-b / 2, -h / 2 + tf],
  ];
}

export function gearPts(m, z) {
  const alpha = 20 * Math.PI / 180;
  const r = (m * z) / 2, rb = r * Math.cos(alpha), ra = r + m, rf = Math.max(r - 1.25 * m, 0.2 * r);
  const inv = (t) => t - Math.atan(t); // angle polaire de la développante
  const tOf = (R) => Math.sqrt(Math.max(0, (R / rb) ** 2 - 1));
  const phiP = Math.tan(alpha) - alpha;
  const psi = Math.PI / (2 * z);
  const t0 = tOf(Math.max(rb, rf)), t1 = tOf(ra);
  const N = 10, pts = [];
  for (let i = 0; i < z; i++) {
    const c = (i / z) * Math.PI * 2;
    const right = [], left = [];
    for (let j = 0; j <= N; j++) {
      const t = t0 + ((t1 - t0) * j) / N;
      const R = rb * Math.sqrt(1 + t * t);
      const da = inv(t) - phiP;
      right.push([R, c - psi + da]);
      left.push([R, c + psi - da]);
    }
    const base = right[0][1];
    pts.push([rf, c - Math.PI / z + 0.0001]);
    if (rf < rb - 1e-6) pts.push([rf, base]);
    for (const q of right) pts.push(q);
    for (const q of left.reverse()) pts.push(q);
    if (rf < rb - 1e-6) pts.push([rf, left[left.length - 1][1]]);
  }
  return pts.map(([R, a]) => [R * Math.cos(a), R * Math.sin(a)]);
}

function spring(dw, De, L0, n) {
  const R = (De - dw) / 2, turns = n + 2; // + 2 spires d'extrémité
  const pts = [];
  const steps = Math.round(turns * 36);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * turns * Math.PI * 2;
    // spires d'extrémité rapprochées
    const tu = u * turns;
    let z;
    if (tu < 1) z = dw / 2 + tu * dw;
    else if (tu > turns - 1) z = L0 - dw / 2 - (turns - tu) * dw;
    else z = 1.5 * dw + ((tu - 1) / (turns - 2)) * (L0 - 3 * dw);
    pts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), Math.max(dw / 2, Math.min(L0 - dw / 2, z))));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, steps, dw / 2, 10, false);
}

function aluProfile([a, s, n, w, w2, dep, hole], size) {
  const tall = size.startsWith('40x80');
  const one = (A, B, cx, cy) => {
    // contour d'un carré A x B avec une rainure au milieu de chaque côté de longueur A (2 rainures si 80)
    const sidePts = (len, slots) => {
      const pts = [];
      const c = 0.8;
      pts.push([-len / 2 + c, 0]);
      for (const sc of slots) {
        pts.push([sc - s / 2, 0], [sc - s / 2, n], [sc - w / 2, n], [sc - w2 / 2, n + dep], [sc + w2 / 2, n + dep], [sc + w / 2, n], [sc + s / 2, n], [sc + s / 2, 0]);
      }
      pts.push([len / 2 - c, 0]);
      return pts;
    };
    const out = [];
    const sides = [
      { len: A, slots: [0], tr: (x, y) => [cx + x, cy - B / 2 + y] },
      { len: B, slots: B > A * 1.5 ? [-B / 4, B / 4] : [0], tr: (x, y) => [cx + A / 2 - y, cy + x] },
      { len: A, slots: [0], tr: (x, y) => [cx - x, cy + B / 2 - y] },
      { len: B, slots: B > A * 1.5 ? [-B / 4, B / 4] : [0], tr: (x, y) => [cx - A / 2 + y, cy - x] },
    ];
    for (const sd of sides) for (const [x, y] of sidePts(sd.len, sd.slots)) out.push(sd.tr(x, y));
    return out;
  };
  const A = a, B = tall ? 2 * a : a;
  const holes = tall ? [circlePts(hole / 2, 32, 0, -a / 2), circlePts(hole / 2, 32, 0, a / 2)] : [circlePts(hole / 2, 32)];
  return makeShape(one(A, B, 0, 0), holes);
}


export const LIBRARY = families;
export const CATEGORIES = [...new Set(families.map((f) => f.cat))];
export const familyById = (id) => families.find((f) => f.id === id);

export function partDefaults(fam, size) {
  const p = { family: fam.id, size: size || fam.defSize };
  for (const e of fam.extra) p[e.k] = e.def;
  return p;
}

export function buildPart(params) {
  const fam = familyById(params.family);
  if (!fam) return null;
  const s = fam.sizes[params.size] || fam.sizes[fam.defSize];
  return fam.build(s, params);
}

export function partLabel(params) {
  const fam = familyById(params.family);
  return fam ? fam.label(params.size, params) : 'Pièce';
}

/** Catalogues fabricants en ligne (modèles 3D gratuits au format STEP à importer) */
export const ONLINE_CATALOGS = [
  { name: 'TraceParts', url: 'https://www.traceparts.com/fr', desc: 'Des centaines de catalogues fabricants (SKF, Festo, Schneider…)' },
  { name: '3D ContentCentral', url: 'https://www.3dcontentcentral.com', desc: 'Composants fournisseurs et modèles communautaires' },
  { name: 'MISUMI', url: 'https://fr.misumi-ec.com', desc: 'Composants mécaniques configurables' },
  { name: 'GrabCAD Library', url: 'https://grabcad.com/library', desc: 'Bibliothèque communautaire de modèles' },
  { name: 'SKF', url: 'https://www.skf.com/fr', desc: 'Roulements, paliers, joints' },
  { name: 'Festo', url: 'https://www.festo.com/fr/fr/', desc: 'Pneumatique, vérins, distributeurs' },
  { name: 'Bosch Rexroth', url: 'https://www.boschrexroth.com/fr/fr/', desc: 'Profilés alu, guidages linéaires, hydraulique' },
  { name: 'item Industrietechnik', url: 'https://www.item24.com/fr-fr/', desc: 'Systèmes de profilés aluminium' },
  { name: 'igus', url: 'https://www.igus.fr', desc: 'Paliers lisses, chaînes porte-câbles' },
  { name: 'McMaster-Carr', url: 'https://www.mcmaster.com', desc: 'Quincaillerie industrielle (CAO téléchargeable)' },
  { name: 'RS Components', url: 'https://fr.rs-online.com', desc: 'Électronique et mécanique' },
  { name: 'HIWIN', url: 'https://www.hiwin.fr', desc: 'Guidages linéaires, vis à billes' },
];
