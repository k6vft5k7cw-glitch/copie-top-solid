// Calculs d'atelier : ajustements ISO 286, pliage, perçage / taraudage
// Valeurs en micromètres issues des tables ISO 286-2 (diamètres 1 à 500 mm).

const RANGES = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
const IT = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
};
// écart supérieur es des arbres d, e, f, g (négatifs) ; écart inférieur ei des arbres k, m, n, p
const ES = {
  d: [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230],
  e: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135],
  f: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
  g: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
  h: new Array(13).fill(0),
};
const EI = {
  k: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5],
  m: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
  n: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
  p: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
};

export const HOLES = ['H6', 'H7', 'H8', 'H9', 'H11', 'G7', 'F7', 'F8', 'E9', 'D10', 'JS7'];
export const SHAFTS = ['d9', 'e8', 'f7', 'g6', 'h6', 'h7', 'h8', 'h9', 'h11', 'js6', 'k6', 'm6', 'n6', 'p6'];
export const COMMON_FITS = [
  ['H7', 'p6', 'Serré : montage à la presse, pas de démontage'],
  ['H7', 'n6', 'Serré léger : montage au maillet'],
  ['H7', 'k6', 'Incertain : roulements sur arbre, pignons'],
  ['H7', 'h6', 'Glissant juste : centrage précis, démontable'],
  ['H7', 'g6', 'Glissant : guidage précis avec jeu faible'],
  ['H8', 'f7', 'Tournant : paliers lisses, rotation normale'],
  ['H8', 'e8', 'Tournant large : grandes vitesses'],
  ['H11', 'd9', 'Libre : jeu important, montage facile'],
];

function idx(D) {
  if (!(D > 0) || D > 500) return -1;
  return RANGES.findIndex((r) => D <= r);
}

function parse(c) { const m = /^([A-Za-z]+)(\d+)$/.exec(c); return { l: m[1], g: +m[2] }; }

/** Écarts en µm : { up, low } */
export function deviation(D, code) {
  const i = idx(D);
  if (i < 0) return null;
  const { l, g } = parse(code);
  const it = IT[g][i];
  const lower = l.toLowerCase();
  if (lower === 'js') return { up: it / 2, low: -it / 2 };
  if (l === lower) { // arbre
    if (ES[l]) return { up: ES[l][i], low: ES[l][i] - it };
    if (EI[l]) { const ei = l === 'k' && g > 7 ? 0 : EI[l][i]; return { up: ei + it, low: ei }; }
  } else { // alésage : lettres A à H, EI = -es de l'arbre correspondant
    const es = ES[lower];
    if (es) return { up: -es[i] + it, low: -es[i] };
  }
  return null;
}

export function fit(D, hole, shaft) {
  const H = deviation(D, hole), S = deviation(D, shaft);
  if (!H || !S) return null;
  const jmax = H.up - S.low, jmin = H.low - S.up;
  const type = jmin >= 0 ? 'Avec jeu' : jmax <= 0 ? 'Avec serrage' : 'Incertain';
  return { H, S, jmax, jmin, type };
}

/** Développé d'un pli unique : cotes extérieures a et b */
export function bend({ a, b, A, e, Ri, K }) {
  const t = (Math.min(Math.abs(A), 179) * Math.PI) / 360;
  const sb = (Ri + e) * Math.tan(t);
  const ba = (Math.abs(A) * Math.PI / 180) * (Ri + K * e);
  return { sb, ba, bd: 2 * sb - ba, L: a + b - 2 * sb + ba };
}

// Taraudage métrique ISO gros pas : [pas, Ø taraudage, Ø passage moyen ISO 273, Ø lamage CHC, prof. lamage, couple indicatif 8.8 (N·m)]
export const THREADS = {
  M3: [0.5, 2.5, 3.4, 6.5, 3.4, 1.3], M4: [0.7, 3.3, 4.5, 8, 4.4, 3], M5: [0.8, 4.2, 5.5, 10, 5.4, 6], M6: [1, 5, 6.6, 11, 6.4, 10],
  M8: [1.25, 6.8, 9, 15, 8.6, 25], M10: [1.5, 8.5, 11, 18, 10.8, 49], M12: [1.75, 10.2, 13.5, 20, 13, 85], M14: [2, 12, 15.5, 24, 15, 135],
  M16: [2, 14, 17.5, 26, 17.5, 210], M20: [2.5, 17.5, 22, 33, 21.5, 410], M24: [3, 21, 26, 40, 25.5, 710],
};

// ------------------------------------------------------------------ USINAGE : conditions de coupe indicatives (m/min)
export const CUT_MATERIALS = {
  'Acier doux (S235, C35)': { hss: 30, carb: 180, turn: 200 },
  'Acier allié / traité (42CrMo4)': { hss: 20, carb: 120, turn: 150 },
  'Acier inoxydable (304, 316)': { hss: 15, carb: 100, turn: 130 },
  'Fonte grise': { hss: 20, carb: 150, turn: 160 },
  'Aluminium': { hss: 100, carb: 400, turn: 500 },
  'Laiton / bronze': { hss: 60, carb: 250, turn: 250 },
  'Titane': { hss: 8, carb: 50, turn: 60 },
  'Plastiques (POM, PA, PEHD)': { hss: 80, carb: 300, turn: 300 },
};
/** avance par dent indicative (mm/dent) selon Ø fraise */
export const fzFor = (D, mat) => {
  const base = D <= 4 ? 0.02 : D <= 8 ? 0.04 : D <= 12 ? 0.06 : D <= 20 ? 0.08 : 0.1;
  return /Aluminium|Plastiques/.test(mat) ? base * 1.6 : /inox|Titane/.test(mat) ? base * 0.7 : base;
};

// ------------------------------------------------------------------ RDM : poutres (formules classiques)
export const BEAM_CASES = {
  'Sur 2 appuis – charge au centre': { M: (F, q, L) => F * L / 4 + q * L * L / 8, f: (F, q, L, EI) => F * L ** 3 / (48 * EI) + 5 * q * L ** 4 / (384 * EI) },
  'Console (encastrée) – charge en bout': { M: (F, q, L) => F * L + q * L * L / 2, f: (F, q, L, EI) => F * L ** 3 / (3 * EI) + q * L ** 4 / (8 * EI) },
  'Bi-encastrée – charge au centre': { M: (F, q, L) => F * L / 8 + q * L * L / 12, f: (F, q, L, EI) => F * L ** 3 / (192 * EI) + q * L ** 4 / (384 * EI) },
};
export const STEELS = {
  'Acier S235': { E: 210000, fy: 235, fu: 360, bw: 0.8, rho: 7.85 },
  'Acier S275': { E: 210000, fy: 275, fu: 430, bw: 0.85, rho: 7.85 },
  'Acier S355': { E: 210000, fy: 355, fu: 490, bw: 0.9, rho: 7.85 },
  'Inox 304L': { E: 200000, fy: 220, fu: 520, bw: 0.8, rho: 7.9 },
  'Aluminium 6060 T6': { E: 69000, fy: 150, fu: 190, bw: 0.8, rho: 2.7 },
  'Aluminium 6082 T6': { E: 70000, fy: 250, fu: 290, bw: 0.8, rho: 2.7 },
};

/** Propriétés d'une section (géométrie extrudée de longueur Lz selon Z) : A, Ix, Iy (/centre de gravité), vmax */
export function sectionProps(geom, Lz) {
  const p = geom.getAttribute('position').array;
  let V = 0, Sx = 0, Sy = 0, Sxx = 0, Syy = 0;
  for (let i = 0; i < p.length; i += 9) {
    const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 3], p[i + 4], p[i + 5]], c = [p[i + 6], p[i + 7], p[i + 8]];
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    V += v;
    Sx += v * (a[0] + b[0] + c[0]) / 4; Sy += v * (a[1] + b[1] + c[1]) / 4;
    const sq = (k) => a[k] * a[k] + b[k] * b[k] + c[k] * c[k] + a[k] * b[k] + a[k] * c[k] + b[k] * c[k];
    Sxx += v * sq(0) / 10; Syy += v * sq(1) / 10;
  }
  const s = Math.sign(V) || 1;
  V *= s; Sx *= s; Sy *= s; Sxx *= s; Syy *= s;
  const cx = Sx / V, cy = Sy / V;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  return {
    A: V / Lz,
    Ix: (Syy - V * cy * cy) / Lz, // flexion autour de X (fibres en Y)
    Iy: (Sxx - V * cx * cx) / Lz,
    vy: Math.max(bb.max.y - cy, cy - bb.min.y),
    vx: Math.max(bb.max.x - cx, cx - bb.min.x),
  };
}

// ------------------------------------------------------------------ ASSEMBLAGES (EN 1993-1-8, méthode simplifiée)
export const BOLT_AS = { M8: 36.6, M10: 58, M12: 84.3, M14: 115, M16: 157, M20: 245, M22: 303, M24: 353, M27: 459, M30: 561 };
export const BOLT_CLASSES = { '4.6': { fub: 400, av: 0.6 }, '5.6': { fub: 500, av: 0.6 }, '8.8': { fub: 800, av: 0.6 }, '10.9': { fub: 1000, av: 0.5 } };
export const GM2 = 1.25;
export function boltCheck({ size, cls, n, planes, V, N }) {
  const As = BOLT_AS[size], c = BOLT_CLASSES[cls];
  const FvRd = (c.av * c.fub * As) / GM2 / 1000 * planes; // kN par boulon
  const FtRd = (0.9 * c.fub * As) / GM2 / 1000;
  const Fv = V / n, Ft = N / n;
  return { FvRd, FtRd, Fv, Ft, ratio: Fv / FvRd + Ft / (1.4 * FtRd), ratioT: Ft / FtRd };
}
export function weldCheck({ steel, a, L, F }) {
  const s = STEELS[steel];
  const fvw = s.fu / (Math.sqrt(3) * s.bw * GM2);
  const FwRd = fvw * a * L / 1000; // kN
  return { fvw, FwRd, ratio: F / FwRd };
}

// ------------------------------------------------------------------ TRANSMISSION
export const beltLength = (D, d, C) => 2 * C + Math.PI * (D + d) / 2 + (D - d) ** 2 / (4 * C);
export function chainLinks(p, z1, z2, C) {
  const X = 2 * C / p + (z1 + z2) / 2 + p * (z2 - z1) ** 2 / (4 * Math.PI ** 2 * C);
  let n = Math.ceil(X); if (n % 2) n++;
  return { X, n };
}
export const SPRING_G = { 'Acier à ressort (C, 1.1200)': 81500, 'Inox (1.4310)': 70000, 'Bronze phosphoreux': 41000 };
export const bearingLife = (C, P, N, roller) => { const L10 = (C / P) ** (roller ? 10 / 3 : 3); return { L10, hours: (L10 * 1e6) / (60 * N) }; };
