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
