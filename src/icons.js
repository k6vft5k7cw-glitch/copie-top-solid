// Jeu d'icônes (traits, 24x24)
const P = {
  new: 'M6 3h8l4 4v14H6z M14 3v4h4 M12 11v6 M9 14h6',
  open: 'M3 7h6l2 2h10v10H3z M3 7v-2h6',
  save: 'M5 3h12l3 3v15H5z M8 3v5h8V3 M8 21v-7h8v7',
  undo: 'M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h3',
  import: 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
  export: 'M12 15V3 M7 8l5-5 5 5 M4 17v4h16v-4',
  sketch: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3 M3 21h18',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
  cylinder: 'M5 6a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0 M5 6v12a7 2.5 0 0 0 14 0V6',
  tube: 'M5 6a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0 M9 6a3 1 0 1 0 6 0a3 1 0 1 0-6 0 M5 6v12a7 2.5 0 0 0 14 0V6',
  cone: 'M12 3L5 18a7 2.5 0 0 0 14 0z',
  sphere: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M3 12a9 3 0 0 0 18 0',
  torus: 'M2 12a10 5 0 1 0 20 0a10 5 0 1 0-20 0 M8 12a4 1.5 0 1 0 8 0a4 1.5 0 1 0-8 0',
  wedge: 'M3 19h18L3 7z M3 7l5-3 M21 19l-3-3 M3 19l5-3',
  plate: 'M3 8h18v8H3z M7 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M14 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  extrude: 'M4 16l8 4 8-4-8-4z M12 12V4 M9 7l3-3 3 3',
  revolve: 'M12 3v18 M16 7a6 3 0 1 1-8 0 M7 17a5 2 0 0 0 10 0 M15 5l2 2-2 2',
  pocket: 'M3 8h18v10H3z M8 8v5h8V8 M12 3v7 M10 8l2 2 2-2',
  hole: 'M3 9h18v10H3z M9 9v10 M15 9v10 M7 5h10',
  catalog: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  move: 'M12 2v20 M2 12h20 M12 2l-3 3 M12 2l3 3 M22 12l-3-3 M22 12l-3 3 M12 22l-3-3 M12 22l3-3 M2 12l3-3 M2 12l3 3',
  rotate: 'M20 12a8 8 0 1 1-3-6.2 M20 4v5h-5',
  duplicate: 'M8 8h12v12H8z M4 16V4h12',
  patlin: 'M3 9h4v6H3z M10 9h4v6h-4z M17 9h4v6h-4z',
  patcirc: 'M12 3a2 2 0 1 0 0.01 0 M19 10a2 2 0 1 0 0.01 0 M16 19a2 2 0 1 0 0.01 0 M8 19a2 2 0 1 0 0.01 0 M5 10a2 2 0 1 0 0.01 0',
  union: 'M3 8a6 6 0 1 0 12 0a6 6 0 1 0-12 0 M9 16a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  subtract: 'M3 9h12v12H3z M15 9a6 6 0 0 0-6-6 M15 9h-6V3a6 6 0 0 1 6 6',
  intersect: 'M3 9a6 6 0 1 0 12 0a6 6 0 1 0-12 0 M9 15a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  ground: 'M8 4h8v10H8z M3 18h18 M5 21h2 M11 21h2 M17 21h2 M12 14v4',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 14h10l1-14 M9 7V4h6v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  eyeoff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6 M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.3-1',
  measure: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
  drawing: 'M3 4h18v16H3z M3 16h18 M14 16v4 M6 7h5v6H6z M14 7h4v4h-4z',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3z M8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  fit: 'M3 9V3h6 M21 9V3h-6 M3 15v6h6 M21 15v6h-6 M8 8h8v8H8z',
  iso: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
  front: 'M5 5h14v14H5z',
  top: 'M5 5h14v14H5z M5 5l4 4h6l4-4 M9 9v6h6V9',
  right: 'M5 5h14v14H5z M19 5l-4 4v6l4 4',
  grid: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
  wire: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 3v18 M4 7.5l16 9 M20 7.5l-16 9',
  persp: 'M4 6l16-3v18L4 18z M4 12h16',
  line: 'M4 20L20 4 M4 20a1.5 1.5 0 1 0 0.01 0 M20 4a1.5 1.5 0 1 0 0.01 0',
  rect: 'M4 6h16v12H4z',
  crect: 'M4 6h16v12H4z M12 10v4 M10 12h4',
  circle: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12h0.01',
  arc: 'M4 18a9 9 0 0 1 14-11 M12 18h0.01',
  polygon: 'M12 3l8.5 6-3.2 10H6.7L3.5 9z',
  slot: 'M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7z',
  select: 'M5 3l13 8-6 1.5L9 19z',
  check: 'M4 12l5 5L20 6',
  close: 'M5 5l14 14 M19 5L5 19',
  construction: 'M4 20L20 4',
  help: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5 M12 17h0.01',
  part: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z',
  screw: 'M8 3h8v4H8z M10 7v14 M14 7v14 M10 10l4 1.5 M10 13l4 1.5 M10 16l4 1.5',
  nut: 'M7 4h10l5 8-5 8H7l-5-8z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  bearing: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 5.5h0.01 M12 18.5h0.01 M5.5 12h0.01 M18.5 12h0.01',
  gear: 'M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1 M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0 M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  beam: 'M5 4h14v3h-5v10h5v3H5v-3h5V7H5z',
  spring: 'M6 4h12 M6 20h12 M7 4l10 3-10 3 10 3-10 3 10 3',
  mesh: 'M4 4l16 2-3 14-12-3z M4 4l13 16 M20 6L5 17',
  folder: 'M3 6h6l2 2h10v11H3z',
  sun: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  play: 'M7 4l13 8-13 8z',
  search: 'M4 10a6 6 0 1 0 12 0a6 6 0 1 0-12 0 M15 15l6 6',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  bent: 'M3 6v12h6 M6 6v9h3 M9 18h12 M9 15h12 M3 6h3',
  elbow: 'M4 20V12a8 8 0 0 1 8-8h8 M9 20v-8a3 3 0 0 1 3-3h8 M4 14h5 M6 8l4 3 M12 4v5',
  branch: 'M2 14h20 M2 20h20 M8 14V3 M14 14V3 M8 3h6',
  hopper: 'M3 4h18l-6 10v6H9v-6z M9 14h6',
  flat: 'M3 7h18v10H3z M9 7v10 M15 7v10',
  align: 'M4 4h7v7H4z M13 13h7v7h-7z M11 7.5h5v5 M14 10l2 2.5 2-2.5',
  explode: 'M9 9h6v6H9z M4 4l3 3 M20 4l-3 3 M4 20l3-3 M20 20l-3-3',
  weld: 'M3 20h18 M6 20l6-12 6 12 M9 14h6 M12 4v2',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  calc: 'M5 3h14v18H5z M8 7h8 M8 11h2 M14 11h2 M8 15h2 M14 15h2 M8 18h2 M14 18h2',
  filletc: 'M4 20V12a8 8 0 0 1 8-8h8 M4 4h4 M4 4v4',
  chamferc: 'M4 20V10l6-6h10 M4 4h3 M4 4v3',
  horiz: 'M3 12h18 M7 8v8 M17 8v8',
  vert: 'M12 3v18 M8 7h8 M8 17h8',
  para: 'M5 19L15 5 M9 19L19 5',
  perp: 'M5 19h14 M12 19V5 M12 15h4v4',
  equal: 'M5 9h14 M5 15h14',
  detach: 'M8 8h8v8H8z M3 3l4 4 M21 21l-4-4',
};

export function icon(name, size = 20) {
  const d = P[name] || P.part;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

export const TYPE_ICON = {
  box: 'box', cylinder: 'cylinder', tube: 'tube', cone: 'cone', sphere: 'sphere', torus: 'torus', wedge: 'wedge', plate: 'plate',
  sheet: 'bent', sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', hole: 'hole', mesh: 'mesh', part: 'part',
};

export const FAMILY_ICON = (fam) => {
  if (/^iso4032|iso7040|iso7089|iso7093/.test(fam.id)) return 'nut';
  if (fam.cat === 'Visserie') return 'screw';
  if (fam.id.startsWith('brg')) return 'bearing';
  if (fam.id === 'gear') return 'gear';
  if (fam.id === 'spring') return 'spring';
  if (fam.cat.startsWith('Profil')) return 'beam';
  if (fam.id === 'en10253') return 'elbow';
  if (fam.id === 'en1092') return 'plate';
  if (fam.cat.startsWith('Tuyauterie')) return 'tube';
  return 'part';
};
