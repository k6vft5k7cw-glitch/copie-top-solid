// FormaCAD – application principale
import * as THREE from 'three';
import './style.css';
import { Viewer } from './viewer.js';
import { Model, MATERIALS, ROLE_LABEL, TYPE_LABEL } from './model.js';
import { BASIC, HOLE_PRESETS, DEG } from './shapes.js';
import { LIBRARY, CATEGORIES, familyById, partDefaults, partLabel, ONLINE_CATALOGS } from './library.js';
import { SketchEditor, sketchObject3D, findLoops, sketchShapes, ENTITY_FIELDS, ENTITY_NAMES } from './sketch.js';
import * as EX from './exporters.js';
import { importFile } from './importers.js';
import { SHEET, SHEET_DEFAULTS, sheetFlat } from './sheet.js';
import { icon, TYPE_ICON, FAMILY_ICON } from './icons.js';

// ------------------------------------------------------------------ utilitaires DOM
const $ = (s, r = document) => r.querySelector(s);
const E = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR', { maximumFractionDigits: d });
const fmtIn = (v) => String(Math.round(v * 1e4) / 1e4).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Calcul simple (+ - * / parenthèses) sans eval */
function evalNum(txt) {
  const s = String(txt).replace(/,/g, '.').replace(/\s/g, '');
  if (!s || !/^[0-9+\-*/().]+$/.test(s)) return null;
  let i = 0;
  const num = () => { const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\./.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const factor = () => {
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') throw 0; i++; return v; }
    return num();
  };
  const term = () => { let v = factor(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const w = factor(); v = op === '*' ? v * w : v / w; } return v; };
  const expr = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const w = term(); v = op === '+' ? v + w : v - w; } return v; };
  try { const v = expr(); return i === s.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

// Formats que la page claude.ai peut proposer directement ; les autres sont livrés dans un .zip
const DIRECT_EXT = new Set(['png', 'svg', 'json', 'zip', 'txt', 'html', 'csv', 'pdf']);
let dlCap;
async function download(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (dlCap === undefined) dlCap = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dlCap) {
    let file = blob, fname = name;
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'fcad') fname = name.replace(/\.fcad$/, '.fcad.json');
    else if (!DIRECT_EXT.has(ext)) {
      const { zipSync } = await import('three/addons/libs/fflate.module.js');
      file = new Blob([zipSync({ [name]: new Uint8Array(await blob.arrayBuffer()) })]);
      fname = name + '.zip';
    }
    try { await dlCap.save({ filename: fname, data: file }); } catch (e) { if (e?.code !== 'declined') window.app?.toast('Téléchargement impossible : ' + (e?.message || e?.code), true); }
    return;
  }
  const a = E('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const Z = new THREE.Vector3(0, 0, 1);
const safeName = (s) => String(s || 'formacad').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'formacad';

const PLANES = {
  XY: { label: 'Dessus (XY)', u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  XZ: { label: 'Face (XZ)', u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  YZ: { label: 'Droite (YZ)', u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

class App {
  constructor() {
    this.model = new Model();
    this.viewer = new Viewer($('#viewport'));
    this.selection = [];
    this.mode = 'normal';
    this.settings = { grid: 5, snapGrid: true, snapPoints: true, wire: false, ortho: false };
    this.undoStack = [];
    this.redoStack = [];
    this.groups = new Map();
    this.edgeCache = new Map();
    this.tab = 'create';
    this.docName = 'Sans titre';
    this.gizmoMode = 'translate';
    this.libOpen = new Set();
    try { if (localStorage.getItem('formacad.theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* stockage indisponible */ }
    this.setupUI();
    this.bindEvents();
    this.commit(false);
    this.refresh();
    this.viewer.setView(new THREE.Vector3(1, -1.3, 0.9));
  }

  // ================================================================ historique
  commit(save = true) {
    const s = this.model.snapshot();
    if (this.undoStack[this.undoStack.length - 1] === s) return;
    this.undoStack.push(s);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    if (save) this.autosave();
  }
  undo() {
    if (this.undoStack.length < 2) return this.toast('Rien à annuler');
    this.redoStack.push(this.undoStack.pop());
    this.model.restore(this.undoStack[this.undoStack.length - 1]);
    this.afterRestore();
  }
  redo() {
    if (!this.redoStack.length) return this.toast('Rien à rétablir');
    const s = this.redoStack.pop();
    this.undoStack.push(s);
    this.model.restore(s);
    this.afterRestore();
  }
  afterRestore() {
    if (this.mode === 'sketch') {
      const o = this.model.get(this.editor.obj.id);
      if (!o) this.exitSketch(true);
      else { this.editor.obj = o; this.editor.selected.clear(); this.editor.pts = []; }
    }
    this.selection = this.selection.filter((id) => this.model.get(id));
    this.refresh();
    this.autosave();
  }
  autosave() {
    try {
      const s = this.model.toFile();
      if (s.length < 4.5e6) localStorage.setItem('formacad.autosave', s);
    } catch { /* stockage plein ou indisponible */ }
  }

  // ================================================================ interface
  setupUI() {
    const quick = [
      ['new', 'Nouveau projet', () => this.newProject()],
      ['open', 'Ouvrir un projet (Ctrl+O)', () => this.openFile('.fcad,.json')],
      ['save', 'Enregistrer le projet (Ctrl+S)', () => this.saveProject()],
      ['undo', 'Annuler (Ctrl+Z)', () => this.undo()],
      ['redo', 'Rétablir (Ctrl+Y)', () => this.redo()],
    ];
    for (const [ic, t, fn] of quick) $('#quick').append(E('button', { title: t, html: icon(ic, 18), onclick: fn }));
    const tabs = [['create', 'Créer'], ['sheet', 'Chaudronnerie'], ['modify', 'Modifier'], ['tools', 'Mesurer'], ['export', 'Plan & Export'], ['help', 'Aide']];
    for (const [id, label] of tabs) $('#tabs').append(E('button', { 'data-tab': id, onclick: () => { this.tab = id; this.renderRibbon(); } }, label));

    const vb = $('#viewbar');
    const vbtn = (ic, t, fn, id) => vb.append(E('button', { title: t, html: icon(ic, 18), onclick: fn, id }));
    vbtn('iso', 'Vue isométrique (0)', () => this.setStdView('iso'));
    vbtn('front', 'Vue de face (1)', () => this.setStdView('front'));
    vbtn('top', 'Vue de dessus (7)', () => this.setStdView('top'));
    vbtn('right', 'Vue de droite (3)', () => this.setStdView('right'));
    vbtn('fit', 'Tout afficher (F)', () => this.fitView());
    vb.append(E('hr'));
    vbtn('persp', 'Perspective / orthographique', () => { this.settings.ortho = !this.settings.ortho; this.viewer.setOrtho(this.settings.ortho); $('#vb-ortho').classList.toggle('on', this.settings.ortho); }, 'vb-ortho');
    vbtn('wire', 'Mode filaire', () => { this.settings.wire = !this.settings.wire; $('#vb-wire').classList.toggle('on', this.settings.wire); this.rebuildScene(); }, 'vb-wire');
    vbtn('grid', 'Afficher / masquer la grille', () => { this.viewer.grid.visible = !this.viewer.grid.visible; $('#vb-grid').classList.toggle('on', !this.viewer.grid.visible); }, 'vb-grid');

    document.querySelectorAll('.paneltabs button').forEach((b) => b.addEventListener('click', () => this.showPane(b.dataset.pane)));
    $('#snapGrid').addEventListener('change', (e) => { this.settings.snapGrid = e.target.checked; this.updateGizmoSnap(); });
    $('#snapPoints').addEventListener('change', (e) => { this.settings.snapPoints = e.target.checked; });
    $('#gridStep').addEventListener('change', (e) => {
      this.settings.grid = parseFloat(e.target.value);
      const g = this.settings.grid;
      this.viewer.buildGrid(g >= 10 ? 2000 : g >= 1 ? 1000 : 200, g >= 1 ? Math.max(g, 5) : g * 10);
      this.updateGizmoSnap();
    });
    this.renderLibrary();
    this.renderRibbon();
  }

  showPane(p) {
    if (document.activeElement && document.activeElement.closest?.('.pane')) document.activeElement.blur();
    document.querySelectorAll('.paneltabs button').forEach((b) => b.classList.toggle('active', b.dataset.pane === p));
    $('#pane-tree').classList.toggle('hidden', p !== 'tree');
    $('#pane-lib').classList.toggle('hidden', p !== 'lib');
    if (p === 'lib') setTimeout(() => $('#libsearch')?.focus(), 50);
  }

  ribbonDef() {
    const sel = this.selObjs();
    const one = sel[0];
    if (this.mode === 'sketch') {
      const t = this.editor.tool;
      const tool = (id, label, ic, key) => ({ id, label, ic, fn: () => this.editor.setTool(id), active: t === id, title: `${label} (${key})` });
      return [
        { g: 'Dessin', b: [tool('select', 'Sélection', 'select', 'Échap'), tool('line', 'Ligne', 'line', 'L'), tool('rect', 'Rectangle', 'rect', 'R'), tool('crect', 'Rectangle centré', 'crect', 'Maj+R'),
          tool('circle', 'Cercle', 'circle', 'C'), tool('arc', 'Arc', 'arc', 'A'), tool('polygon', 'Polygone', 'polygon', 'P'), tool('slot', 'Oblong', 'slot', 'O')] },
        { g: 'Édition', b: [
          { label: 'Construction', ic: 'construction', fn: () => this.toggleConstruction(), title: 'Basculer en trait de construction (ignoré pour les volumes)' },
          { label: 'Supprimer', ic: 'trash', fn: () => this.editor.deleteSelected() || this.toast('Sélectionnez des éléments avec l\'outil Sélection'), title: 'Supprimer la sélection (Suppr)' },
          { label: 'Importer DXF', ic: 'import', fn: () => this.openFile('.dxf'), title: 'Ajouter les entités d\'un fichier DXF dans cette esquisse' },
        ] },
        { g: 'Créer un volume', b: [
          { label: 'Extruder', ic: 'extrude', fn: () => this.fromSketch('extrude') },
          { label: 'Poche (enlever)', ic: 'pocket', fn: () => this.fromSketch('pocket') },
          { label: 'Révolution', ic: 'revolve', fn: () => this.fromSketch('revolve'), title: 'Révolution autour de l\'axe vertical (Y) de l\'esquisse' },
        ] },
        { g: 'Esquisse', b: [{ label: 'Terminer', ic: 'check', fn: () => this.exitSketch(), primary: true, title: 'Terminer l\'esquisse (Entrée sans saisie)' }] },
      ];
    }
    const need = (cond, msg, fn) => () => (cond() ? fn() : this.toast(msg));
    const hasSel = () => this.selection.length > 0;
    switch (this.tab) {
      case 'create': return [
        { g: 'Esquisse 2D', b: [{ label: 'Nouvelle esquisse', ic: 'sketch', fn: () => this.newSketchDialog(), title: 'Dessiner un profil 2D (S)', primary: true }] },
        { g: 'Volumes paramétrés', b: Object.entries(BASIC).map(([k, v]) => ({ label: v.label, ic: v.icon, fn: () => this.placeBasic(k), title: `Ajouter : ${v.label} (cliquez dans la scène pour le placer)` })) },
        { g: 'Depuis l\'esquisse', b: [
          { label: 'Extruder', ic: 'extrude', fn: () => this.fromSketch('extrude') },
          { label: 'Poche', ic: 'pocket', fn: () => this.fromSketch('pocket') },
          { label: 'Révolution', ic: 'revolve', fn: () => this.fromSketch('revolve') },
        ] },
        { g: 'Usinage', b: [{ label: 'Perçage', ic: 'hole', fn: () => this.holeDialog(), title: 'Percer, tarauder, lamer ou fraiser sur une face (H)' }] },
        { g: 'Composants', b: [
          { label: 'Catalogue', ic: 'catalog', fn: () => this.showPane('lib'), title: 'Vis, écrous, roulements, profilés… (B)' },
          { label: 'Importer', ic: 'import', fn: () => this.openFile('.step,.stp,.iges,.igs,.brep,.stl,.obj,.glb,.gltf,.ply,.3mf,.dxf'), title: 'STEP, IGES, STL, OBJ, glTF, PLY, 3MF, DXF (I)' },
        ] },
      ];
      case 'sheet': return [
        { g: 'Tôlerie', b: [{ label: 'Tôle pliée', ic: 'bent', fn: () => this.placeSheet('bent'), title: 'Profil plié (U, L, Z, cornière…) avec facteur K et lignes de pliage' }] },
        { g: 'Chaudronnerie (développés)', b: [
          { label: 'Virole', ic: 'tube', fn: () => this.placeSheet('shell') },
          { label: 'Tronc de cône', ic: 'cone', fn: () => this.placeSheet('cone'), title: 'Droit ou excentré (oblique)' },
          { label: 'Coude segmenté', ic: 'elbow', fn: () => this.placeSheet('elbow'), title: 'Coude en tranches (« saucisson »)' },
          { label: 'Piquage', ic: 'branch', fn: () => this.placeSheet('branch'), title: 'Tube sur tube, avec excentration, et trou du tube principal' },
          { label: 'Carré-rond / trémie', ic: 'hopper', fn: () => this.placeSheet('transition'), title: 'Transition rectangle → rond ou rectangle → rectangle, centrée ou décalée' },
        ] },
        { g: 'Fabrication', b: [{ label: 'Développé (DXF)', ic: 'flat', primary: true, fn: () => { const o = this.selObjs().find((x) => x.type === 'sheet'); if (o) this.flatDialog(o); else this.toast('Sélectionnez une pièce de chaudronnerie / tôlerie', true); }, title: 'Mise à plat à la fibre neutre, prête pour laser / plasma / poinçonneuse' }] },
        { g: 'Tuyauterie (catalogue)', b: [
          { label: 'Brides', ic: 'plate', fn: () => this.libSearch('bride') },
          { label: 'Coudes', ic: 'elbow', fn: () => this.libSearch('coude') },
          { label: 'Tubes', ic: 'tube', fn: () => this.libSearch('EN 10220') },
          { label: 'Fonds bombés', ic: 'sphere', fn: () => this.libSearch('fond') },
        ] },
      ];
      case 'modify': return [
        { g: 'Placer', b: [
          { label: 'Déplacer', ic: 'move', fn: need(hasSel, 'Sélectionnez un objet', () => this.setGizmo('translate')), active: this.gizmoMode === 'translate' && hasSel(), title: 'Poignées de déplacement (M)' },
          { label: 'Tourner', ic: 'rotate', fn: need(hasSel, 'Sélectionnez un objet', () => this.setGizmo('rotate')), active: this.gizmoMode === 'rotate' && hasSel(), title: 'Poignées de rotation (T)' },
          { label: 'Poser au sol', ic: 'ground', fn: need(hasSel, 'Sélectionnez un objet', () => this.dropToGround()), title: 'Amène le point le plus bas à Z = 0' },
        ] },
        { g: 'Copier', b: [
          { label: 'Dupliquer', ic: 'duplicate', fn: need(hasSel, 'Sélectionnez un objet', () => this.duplicate()), title: 'Ctrl+D' },
          { label: 'Répétition linéaire', ic: 'patlin', fn: need(hasSel, 'Sélectionnez un objet', () => this.patternDialog('lin')) },
          { label: 'Répétition circulaire', ic: 'patcirc', fn: need(hasSel, 'Sélectionnez un objet', () => this.patternDialog('circ')) },
        ] },
        { g: 'Booléens (sélectionnez 2 objets ou plus)', b: [
          { label: 'Soustraire', ic: 'subtract', fn: () => this.booleanSel('cut'), title: 'Enlève les objets suivants du premier sélectionné' },
          { label: 'Unir', ic: 'union', fn: () => this.booleanSel('add') },
          { label: 'Intersection', ic: 'intersect', fn: () => this.booleanSel('inter') },
          { label: 'Détacher', ic: 'detach', fn: need(() => one && one.role, 'Sélectionnez un objet utilisé dans un booléen', () => this.setRelation(one, null, null)), title: 'Annule l\'opération booléenne de l\'objet' },
        ] },
        { g: 'Objet', b: [
          { label: 'Masquer / afficher', ic: 'eyeoff', fn: need(hasSel, 'Sélectionnez un objet', () => { for (const o of sel) o.visible = !o.visible; this.commit(); this.refresh(); }) },
          { label: 'Figer', ic: 'mesh', fn: need(() => one && one.type !== 'sketch', 'Sélectionnez un solide', () => this.freezeSel()), title: 'Convertit en corps simple (perd les paramètres)' },
          { label: 'Supprimer', ic: 'trash', fn: need(hasSel, 'Sélectionnez un objet', () => this.deleteSel()), title: 'Suppr' },
        ] },
      ];
      case 'tools': return [
        { g: 'Mesure', b: [{ label: 'Distance', ic: 'measure', fn: () => this.startMeasure(), active: this.mode === 'measure', title: 'Cliquez 2 points (accroche aux sommets) – (D)' }] },
        { g: 'Analyse', b: [{ label: 'Propriétés physiques', ic: 'layers', fn: () => this.physicalDialog(), title: 'Volume, masse, encombrement de tous les corps' }] },
      ];
      case 'export': return [
        { g: 'Mise en plan', b: [{ label: 'Plan 2D (DXF / PDF)', ic: 'drawing', fn: () => this.drawingDialog(), primary: true, title: 'Vues de face, dessus, côté, iso avec lignes cachées et cotes' }] },
        { g: 'Esquisse 2D', b: [
          { label: 'DXF esquisse', ic: 'export', fn: () => this.exportSketch('dxf'), title: 'Contour exact (lignes, cercles, arcs) pour découpe laser / CNC' },
          { label: 'SVG esquisse', ic: 'export', fn: () => this.exportSketch('svg') },
        ] },
        { g: 'Fichiers 3D', b: [
          { label: 'STEP', ic: 'export', fn: () => this.export3D('step'), title: 'Échange CAO (SolidWorks, TopSolid, Fusion, FreeCAD, CATIA…)' },
          { label: 'STL', ic: 'export', fn: () => this.export3D('stl'), title: 'Impression 3D' },
          { label: 'OBJ', ic: 'export', fn: () => this.export3D('obj') },
          { label: 'GLB', ic: 'export', fn: () => this.export3D('glb'), title: 'Web, réalité augmentée, Blender' },
          { label: 'PLY', ic: 'export', fn: () => this.export3D('ply') },
          { label: 'DXF 3D', ic: 'export', fn: () => this.export3D('dxf3d'), title: 'Maillage 3DFACE pour AutoCAD' },
        ] },
        { g: 'Autres', b: [
          { label: 'Image PNG', ic: 'camera', fn: () => this.exportPNG() },
          { label: 'Tous les formats…', ic: 'export', fn: () => this.exportDialog() },
          { label: 'Enregistrer projet', ic: 'save', fn: () => this.saveProject() },
        ] },
      ];
      case 'help': return [
        { g: 'Démarrer', b: [
          { label: 'Exemple', ic: 'play', fn: () => this.loadExample(), title: 'Charger un assemblage d\'exemple' },
          { label: 'Raccourcis', ic: 'help', fn: () => this.helpDialog() },
        ] },
        { g: 'Affichage', b: [{ label: 'Thème clair / sombre', ic: 'sun', fn: () => this.toggleTheme() }] },
      ];
    }
    return [];
  }

  renderRibbon() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab && this.mode !== 'sketch'));
    const r = $('#ribbon');
    r.innerHTML = '';
    for (const grp of this.ribbonDef()) {
      const btns = E('div', { class: 'btns' });
      for (const b of grp.b) {
        btns.append(E('button', { class: 'rbtn' + (b.active ? ' active' : '') + (b.primary ? ' primary' : ''), title: b.title || b.label, onclick: b.fn, html: icon(b.ic, 22) + `<span>${esc(b.label)}</span>` }));
      }
      r.append(E('div', { class: 'rgroup' }, btns, E('div', { class: 'gname' }, grp.g)));
    }
  }

  // ================================================================ événements
  bindEvents() {
    const cv = this.viewer.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, b: e.button, axis: this.viewer.tc.axis }; });
    cv.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || d.axis) return;
      if (d.b === 0) this.onClick(e);
      if (d.b === 2 && (this.mode === 'place' || this.mode === 'measure' || this.mode === 'pickface')) this.cancelMode();
    });
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    cv.addEventListener('dblclick', (e) => this.onDblClick(e));
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerleave', () => $('#cursorLabel').classList.add('hidden'));

    const tc = this.viewer.tc;
    tc.addEventListener('objectChange', () => {
      const g = tc.object, o = g && this.model.get(g.userData.id);
      if (!o) return;
      o.pos = [g.position.x, g.position.y, g.position.z].map((v) => Math.round(v * 1e4) / 1e4);
      const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'XYZ');
      o.rot = [e.x, e.y, e.z].map((v) => Math.round((v / DEG) * 1e4) / 1e4);
      this.updateXYZFields(o);
    });
    tc.addEventListener('mouseUp', () => { this.commit(); this.refresh(); });

    window.addEventListener('keydown', (e) => this.onKey(e));
    $('#fileInput').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; this.handleFiles(f); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); this.handleFiles([...(e.dataTransfer?.files || [])]); });
    this.viewer.onFrame = () => this.onFrame();
    $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') this.closeModal(); });
  }

  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = (tag === 'input' || tag === 'select' || tag === 'textarea') && e.target.offsetParent !== null;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); return this.saveProject(); }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); return this.openFile('.fcad,.json'); }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (!$('#modal').classList.contains('hidden')) { if (e.key === 'Escape') this.closeModal(); return; }
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); return this.undo(); }
    if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); return this.redo(); }
    if (this.mode === 'sketch') return this.onSketchKey(e);
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (this.selection.length) this.duplicate(); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(this.model.roots().map((o) => o.id)); return; }
    if (ctrl) return;
    switch (e.key) {
      case 'Escape': if (this.mode !== 'normal') this.cancelMode(); else this.select([]); break;
      case 'Delete': case 'Backspace': if (this.selection.length) this.deleteSel(); break;
      case 'f': case 'F': this.fitView(); break;
      case 'm': case 'M': if (this.selection.length) this.setGizmo('translate'); break;
      case 't': case 'T': if (this.selection.length) this.setGizmo('rotate'); break;
      case 's': case 'S': this.newSketchDialog(); break;
      case 'h': case 'H': this.holeDialog(); break;
      case 'b': case 'B': this.showPane('lib'); break;
      case 'i': case 'I': this.openFile('.step,.stp,.iges,.igs,.brep,.stl,.obj,.glb,.gltf,.ply,.3mf,.dxf'); break;
      case 'd': case 'D': this.startMeasure(); break;
      case 'e': case 'E': { const o = this.selObjs()[0]; if (o?.type === 'sketch') this.enterSketch(o); else if (o?.params?.sketch) this.enterSketch(this.model.get(o.params.sketch)); break; }
      case '0': this.setStdView('iso'); break;
      case '1': this.setStdView('front'); break;
      case '3': this.setStdView('right'); break;
      case '7': this.setStdView('top'); break;
    }
  }

  onSketchKey(e) {
    const ed = this.editor;
    if (/^[0-9.,;<\-x* ]$/.test(e.key) && ed.tool !== 'select') {
      if (e.key === ' ' && !ed.typed) return;
      ed.typed += e.key; ed.drawPreview(); e.preventDefault(); return;
    }
    if (e.key === 'Backspace' && ed.typed) { ed.typed = ed.typed.slice(0, -1); ed.drawPreview(); e.preventDefault(); return; }
    if (e.key === 'Enter') {
      if (ed.typed) { const t = ed.typed; ed.typed = ''; ed.applyTyped(t); ed.drawPreview(); }
      else if (!ed.pts.length) this.exitSketch();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (ed.typed) { ed.typed = ''; ed.drawPreview(); return; }
      if (!ed.cancel()) { if (ed.tool !== 'select') ed.setTool('select'); else this.exitSketch(); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { ed.deleteSelected(); return; }
    const k = e.key.toLowerCase();
    const map = { l: 'line', r: e.shiftKey ? 'crect' : 'rect', c: 'circle', a: 'arc', p: 'polygon', o: 'slot' };
    if (map[k]) ed.setTool(map[k]);
    if (k === 'f') this.fitView();
  }

  onClick(e) {
    if (this.mode === 'sketch') return this.editor.onClick(e);
    if (this.mode === 'place') return this.placeClick(e);
    if (this.mode === 'measure') return this.measureClick(e);
    if (this.mode === 'pickface') return this.pickFaceClick(e);
    const p = this.pickObject(e);
    if (!p) { if (!e.shiftKey && !e.ctrlKey) this.select([]); return; }
    if (e.shiftKey || e.ctrlKey) {
      const s = this.selection.slice();
      const i = s.indexOf(p.id);
      if (i >= 0) s.splice(i, 1); else s.push(p.id);
      this.select(s);
    } else this.select([p.id]);
  }

  onDblClick(e) {
    if (this.mode !== 'normal') return;
    const p = this.pickObject(e);
    if (!p) return;
    const o = this.model.get(p.id);
    if (o.type === 'sketch') this.enterSketch(o);
    else if (o.params?.sketch && this.model.get(o.params.sketch)) this.enterSketch(this.model.get(o.params.sketch));
  }

  onMove(e) {
    this.lastMouse = { clientX: e.clientX, clientY: e.clientY };
    if (this.mode === 'sketch') return this.editor.onMove(e);
    if (this.mode === 'place') return this.placeMove(e);
    if (this.mode === 'measure') return this.measureMove(e);
    const ray = this.viewer.rayFromEvent(e);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(new THREE.Plane(Z, 0), hit)) this.setCoords(`X ${fmt(hit.x, 1)}  Y ${fmt(hit.y, 1)}  Z 0`);
  }

  onFrame() {
    if (this.meas && this.meas.pts.length === 2) {
      const [a, b] = this.meas.pts;
      const s = this.viewer.toScreen(a.clone().add(b).multiplyScalar(0.5));
      const r = this.viewer.container.getBoundingClientRect();
      const l = $('#measureLabel');
      l.style.left = s.x - r.left + 'px';
      l.style.top = s.y - r.top + 'px';
    }
  }

  // ================================================================ sélection / scène
  selObjs() { return this.selection.map((id) => this.model.get(id)).filter(Boolean); }

  select(ids) {
    this.selection = [...new Set(ids)].filter((id) => this.model.get(id));
    this.refresh();
  }

  pickObject(e) {
    this.viewer.raycaster.params.Line.threshold = this.viewer.worldPerPixel(this.viewer.controls.target) * 5;
    const hits = this.viewer.pick(e, [this.viewer.world]);
    for (const h of hits) {
      if (!isShown(h.object)) continue;
      const id = h.object.userData.id;
      if (id != null) return { id, hit: h };
    }
    return null;
  }

  refresh() {
    const fk = document.activeElement?.dataset?.k;
    this.rebuildScene();
    this.renderTree();
    this.renderProps();
    this.renderRibbon();
    this.updateWelcome();
    $('#docname').textContent = this.docName;
    if (this.mode === 'normal') this.setHint(this.selection.length ? 'Glissez les flèches pour déplacer • Double-clic sur une esquisse pour la modifier • Suppr pour effacer' : 'Clic gauche : sélectionner • Glisser : tourner • Clic droit / molette : déplacer • Molette : zoom');
    if (fk) { const n = document.querySelector(`[data-k="${fk}"]`); if (n) { n.focus(); n.select?.(); } }
  }

  rebuildScene() {
    const w = this.viewer.world;
    while (w.children.length) w.remove(w.children[0]);
    this.groups.clear();
    for (const o of this.model.roots()) w.add(this.buildGroup(o));
    this.attachGizmo();
  }

  buildGroup(o) {
    const g = new THREE.Group();
    g.userData.id = o.id;
    this.model.localMatrix(o).decompose(g.position, g.quaternion, g.scale);
    const editing = this.mode === 'sketch' && this.editor.obj.id === o.id;
    g.visible = o.visible || editing;
    const sel = this.selection.includes(o.id);
    if (o.type === 'sketch') {
      const so = sketchObject3D(o.params.entities, { selected: editing ? this.editor.selected : new Set(), active: editing || sel, showFill: true });
      so.traverse((c) => { c.userData.id = o.id; });
      g.add(so);
    } else {
      let f = null;
      try { f = this.model.finalGeometry(o); this.model.errors.delete('b' + o.id); } catch (err) { this.model.errors.set('b' + o.id, err.message); }
      if (f) {
        if (o.role) {
          if (sel) {
            const col = { cut: 0xe53935, add: 0x43a047, inter: 0x8e24aa }[o.role];
            const m = new THREE.Mesh(f.geom, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
            m.userData.id = o.id;
            g.add(m, new THREE.LineSegments(this.edgesFor(f), new THREE.LineBasicMaterial({ color: col })));
          }
        } else {
          const mat = new THREE.MeshStandardMaterial({
            color: this.model.color(o), metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide, wireframe: this.settings.wire,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            emissive: sel ? 0x1e64c8 : 0x000000, emissiveIntensity: sel ? 0.4 : 0,
          });
          const mesh = new THREE.Mesh(f.geom, mat);
          mesh.userData.id = o.id;
          mesh.userData.solid = true;
          g.add(mesh);
          if (!this.settings.wire) {
            const ls = new THREE.LineSegments(this.edgesFor(f), new THREE.LineBasicMaterial({ color: sel ? 0x0d47a1 : 0x26313d, transparent: true, opacity: sel ? 0.95 : 0.6 }));
            ls.raycast = () => {};
            g.add(ls);
          }
        }
      }
    }
    for (const c of this.model.children(o.id)) g.add(this.buildGroup(c));
    this.groups.set(o.id, g);
    return g;
  }

  edgesFor(f) {
    let e = this.edgeCache.get(f.key);
    if (!e) {
      const n = f.geom.getAttribute('position').count / 3;
      const segs = n < 150000 ? EX.featureEdges(f.geom, { angle: 30 }) : [];
      const arr = new Float32Array(segs.length * 6);
      segs.forEach(([a, b], i) => { arr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); });
      e = new THREE.BufferGeometry();
      e.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      if (this.edgeCache.size > 300) this.edgeCache.clear();
      this.edgeCache.set(f.key, e);
    }
    return e;
  }

  attachGizmo() {
    const tc = this.viewer.tc;
    const o = this.selObjs()[0];
    if (this.mode !== 'normal' || this.selection.length !== 1 || !o || !o.visible) { tc.detach(); return; }
    const g = this.groups.get(o.id);
    if (!g) { tc.detach(); return; }
    tc.attach(g);
    tc.setMode(this.gizmoMode);
    tc.setSpace(o.parent != null ? 'local' : 'world');
    this.updateGizmoSnap();
  }

  setGizmo(m) { this.gizmoMode = m; this.attachGizmo(); this.renderRibbon(); }

  updateGizmoSnap() {
    const tc = this.viewer.tc;
    tc.setTranslationSnap(this.settings.snapGrid ? this.settings.grid : null);
    tc.setRotationSnap(this.settings.snapGrid ? 15 * DEG : null);
  }

  sceneBox(ids = null) {
    const box = new THREE.Box3();
    this.viewer.world.updateMatrixWorld(true);
    for (const [id, g] of this.groups) {
      if (ids && !ids.includes(id)) continue;
      if (!isShown(g)) continue;
      g.traverse((c) => { if ((c.isMesh || c.isLine) && c.userData.id === id && c.visible) box.expandByObject(c, true); });
    }
    return box;
  }

  fitView() {
    const box = this.sceneBox(this.selection.length ? this.selection : null);
    const dir = this.viewer.camera.position.clone().sub(this.viewer.controls.target);
    this.viewer.setView(dir, box.isEmpty() ? this.sceneBox() : box);
  }

  setStdView(v) {
    const dirs = { iso: [1, -1.3, 0.9], front: [0, -1, 0], top: [0, 0, 1], right: [1, 0, 0] };
    this.viewer.setView(new THREE.Vector3(...dirs[v]), this.sceneBox());
  }

  worldMatrix(o) { return this.model.worldMatrix(o); }

  // ================================================================ arbre
  renderTree() {
    const p = $('#pane-tree');
    p.innerHTML = '';
    const roots = this.model.roots();
    if (!roots.length) {
      p.append(E('div', { class: 'tree-empty', html: 'Le projet est vide.<br>Commencez par une <b>esquisse</b>, un <b>volume</b> ou un <b>composant du catalogue</b>.' }));
      return;
    }
    const row = (o, depth) => {
      const err = this.model.errors.get(o.id) || this.model.errors.get('b' + o.id);
      const r = E('div', {
        class: 'tree-row' + (this.selection.includes(o.id) ? ' sel' : '') + (o.visible ? '' : ' hiddenobj') + (err ? ' err' : ''),
        style: `padding-left:${6 + depth * 16}px`, title: err || '',
        onclick: (e) => {
          if (e.shiftKey || e.ctrlKey) { const s = this.selection.slice(); const i = s.indexOf(o.id); if (i >= 0) s.splice(i, 1); else s.push(o.id); this.select(s); } else this.select([o.id]);
        },
        ondblclick: () => { if (o.type === 'sketch') this.enterSketch(o); },
      });
      r.innerHTML = icon(o.type === 'part' ? FAMILY_ICON(familyById(o.params.family) || { id: '', cat: '' }) : TYPE_ICON[o.type] || 'part', 16);
      r.append(E('span', { class: 'name' }, this.model.displayName(o)));
      if (o.role) r.append(E('span', { class: 'tag ' + o.role }, { cut: '−', add: '+', inter: '∩' }[o.role] + ' ' + ROLE_LABEL[o.role]));
      r.append(E('button', { class: 'vis', title: o.visible ? 'Masquer' : 'Afficher', html: icon(o.visible ? 'eye' : 'eyeoff', 15), onclick: (e) => { e.stopPropagation(); o.visible = !o.visible; this.commit(); this.refresh(); } }));
      p.append(r);
      for (const c of this.model.children(o.id)) row(c, depth + 1);
    };
    for (const o of roots) row(o, 0);
  }

  // ================================================================ catalogue
  renderLibrary() {
    const p = $('#pane-lib');
    p.innerHTML = '';
    const search = E('input', { id: 'libsearch', type: 'search', placeholder: 'Rechercher : M8, 6204, IPE, rondelle…', oninput: () => this.renderLibList(search.value) });
    p.append(E('div', { class: 'lib-search' }, search), E('div', { id: 'liblist' }));
    this.renderLibList('');
  }

  renderLibList(q) {
    const list = $('#liblist');
    list.innerHTML = '';
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const terms = norm(q).split(/\s+/).filter(Boolean);
    for (const cat of CATEGORIES) {
      const fams = LIBRARY.filter((f) => f.cat === cat);
      const blocks = [];
      for (const f of fams) {
        const text = norm(`${f.name} ${f.std} ${f.cat}`);
        let sizes = Object.keys(f.sizes);
        if (terms.length) {
          const famMatch = terms.every((t) => text.includes(t));
          const sizeMatch = sizes.filter((s) => terms.some((t) => norm(s).includes(t)) && terms.every((t) => text.includes(t) || norm(s).includes(t)));
          if (!famMatch && !sizeMatch.length) continue;
          if (!famMatch) sizes = sizeMatch;
        }
        const open = terms.length > 0 || this.libOpen.has(f.id);
        const fam = E('div', { class: 'lib-fam' });
        const head = E('div', { class: 'head', onclick: () => { if (this.libOpen.has(f.id)) this.libOpen.delete(f.id); else this.libOpen.add(f.id); this.renderLibList($('#libsearch').value); } });
        head.innerHTML = icon(FAMILY_ICON(f), 22) + `<div class="t">${esc(f.name)}<small>${esc(f.std)} • ${Object.keys(f.sizes).length} tailles</small></div><span>${open ? '▾' : '▸'}</span>`;
        fam.append(head);
        if (open) {
          const sz = E('div', { class: 'sizes' });
          for (const s of sizes) sz.append(E('button', { class: 'chip', title: `Placer ${f.name} ${s}`, onclick: () => this.placePart(f, s) }, s));
          fam.append(sz);
        }
        blocks.push(fam);
      }
      if (blocks.length) list.append(E('div', { class: 'lib-cat' }, cat), ...blocks);
    }
    const online = E('div', { class: 'lib-online' });
    online.innerHTML = `<b>Catalogues fabricants</b><br><small>Téléchargez gratuitement le modèle du fabricant au format <b>STEP</b>, puis importez-le ici (ou glissez-le dans la vue 3D).</small>`;
    for (const c of ONLINE_CATALOGS) online.append(E('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.name, E('small', {}, c.desc)));
    online.append(E('div', { class: 'drop', onclick: () => this.openFile('.step,.stp,.iges,.igs,.brep,.stl,.obj,.glb,.gltf,.ply,.3mf') }, 'Importer un fichier STEP / IGES / STL…'));
    list.append(online);
  }

  // ================================================================ panneau de propriétés
  renderProps() {
    const p = $('#props');
    p.innerHTML = '';
    if (this.mode === 'sketch') return this.renderSketchProps(p);
    const sel = this.selObjs();
    if (!sel.length) return this.renderDocProps(p);
    if (sel.length > 1) return this.renderMultiProps(p, sel);
    const o = sel[0];
    const icn = o.type === 'part' ? FAMILY_ICON(familyById(o.params.family) || { id: '', cat: '' }) : TYPE_ICON[o.type];
    const name = E('input', { value: this.model.displayName(o), 'data-k': 'name', onchange: () => { o.name = name.value.trim(); this.commit(); this.refresh(); } });
    p.append(E('div', { class: 'ph', html: icon(icn, 22) }, name));
    p.append(E('div', { class: 'ptype' }, TYPE_LABEL[o.type] + (o.type === 'part' ? ` – ${familyById(o.params.family)?.std || ''}` : '')));
    const err = this.model.errors.get(o.id) || this.model.errors.get('b' + o.id);
    if (err) p.append(E('div', { class: 'errbox' }, err));

    const set = (fn) => { fn(); this.commit(); setTimeout(() => this.refresh(), 0); };
    const sec = (title) => { const s = E('div', { class: 'sec' }, E('h4', {}, title)); p.append(s); return s; };

    // ---- paramètres
    const ps = sec('Dimensions');
    if (BASIC[o.type]) {
      for (const d of BASIC[o.type].params) ps.append(this.numField(d.label, o.params[d.k], (v) => set(() => { o.params[d.k] = Math.max(d.min ?? -Infinity, v); }), d.unit, 'p.' + d.k));
    } else if (o.type === 'part') {
      const fam = familyById(o.params.family);
      ps.append(E('div', { class: 'note', style: 'margin-bottom:8px' }, fam.name));
      ps.append(this.selField('Taille', o.params.size, Object.keys(fam.sizes), (v) => set(() => { o.params.size = v; if (!o.nameLocked) o.name = ''; }), 'p.size'));
      for (const x of fam.extra) {
        if (x.options && typeof x.options[0] === 'string') ps.append(this.selField(x.label, o.params[x.k], x.options, (v) => set(() => { o.params[x.k] = v; o.name = ''; }), 'p.' + x.k));
        else ps.append(this.numField(x.label, o.params[x.k], (v) => set(() => { o.params[x.k] = Math.max(x.min ?? 0.01, x.step === 1 ? Math.round(v) : v); o.name = ''; }), x.unit, 'p.' + x.k, x.options));
      }
      const s = fam.sizes[o.params.size];
      ps.append(E('div', { class: 'info', style: 'margin-top:6px' }, ...fam.cols.flatMap((c, i) => [E('span', {}, c), E('b', {}, fmt(s[i]) + (c === 'm' || c === 'z' ? '' : ' mm'))])));
    } else if (o.type === 'sheet') {
      const def = SHEET[o.params.kind];
      if (def.help) ps.append(E('div', { class: 'note', style: 'margin-bottom:8px' }, def.help));
      for (const d of def.params) {
        if (d.options) ps.append(this.selField(d.label, o.params[d.k], d.options, (v) => set(() => { o.params[d.k] = v; }), 'p.' + d.k));
        else if (d.text) {
          const t = E('input', { type: 'text', value: o.params[d.k], 'data-k': 'p.' + d.k, onchange: () => set(() => { o.params[d.k] = t.value; }) });
          ps.append(E('div', { class: 'field' }, E('label', {}, d.label), t, E('span', { class: 'unit' })));
        } else ps.append(this.numField(d.label, o.params[d.k], (v) => set(() => { o.params[d.k] = Math.max(d.min ?? 0.01, d.step === 1 ? Math.round(v) : v); }), d.unit, 'p.' + d.k));
      }
      ps.append(E('button', { class: 'btn big primary', style: 'margin-top:6px', onclick: () => this.flatDialog(o), html: icon('flat', 16) + 'Développé à plat (DXF)' }));
    } else if (o.type === 'extrude') {
      ps.append(this.numField('Hauteur', o.params.h, (v) => set(() => { o.params.h = Math.max(0.01, v); }), 'mm', 'p.h'));
      ps.append(this.selField('Sens', o.params.dir, ['Normale', 'Inverse', 'Symétrique'], (v) => set(() => { o.params.dir = v; }), 'p.dir'));
      ps.append(this.sketchLink(o));
    } else if (o.type === 'revolve') {
      ps.append(this.numField('Angle', o.params.angle, (v) => set(() => { o.params.angle = Math.min(360, Math.max(1, v)); }), '°', 'p.angle'));
      ps.append(this.sketchLink(o));
    } else if (o.type === 'hole') {
      ps.append(this.selField('Type', o.params.kind, ['simple', 'lamage', 'fraisage'], (v) => set(() => { o.params.kind = v; }), 'p.kind'));
      ps.append(this.numField('Diamètre', o.params.d, (v) => set(() => { o.params.d = Math.max(0.1, v); }), 'mm', 'p.d'));
      const th = E('input', { type: 'checkbox', checked: o.params.through, onchange: () => set(() => { o.params.through = th.checked; }) });
      ps.append(E('div', { class: 'field' }, E('label', {}, 'Débouchant'), th, E('span', { class: 'unit' })));
      if (!o.params.through) ps.append(this.numField('Profondeur', o.params.depth, (v) => set(() => { o.params.depth = Math.max(0.1, v); }), 'mm', 'p.depth'));
      if (o.params.kind !== 'simple') {
        ps.append(this.numField(o.params.kind === 'lamage' ? 'Ø lamage' : 'Ø fraisure', o.params.D2, (v) => set(() => { o.params.D2 = v; }), 'mm', 'p.D2'));
        if (o.params.kind === 'lamage') ps.append(this.numField('Profondeur lamage', o.params.h2, (v) => set(() => { o.params.h2 = v; }), 'mm', 'p.h2'));
      }
    } else if (o.type === 'mesh') {
      const b = this.model.blobs.get(o.params.blob);
      ps.append(E('div', { class: 'note' }, `Corps importé${o.params.source ? ' depuis ' + o.params.source : ''} – ${b ? fmt(b.position.length / 9, 0) : '?'} facettes. Vous pouvez le déplacer, le percer, l'utiliser dans des booléens et l'exporter.`));
    } else if (o.type === 'sketch') {
      const n = findLoops(o.params.entities).length;
      ps.append(E('div', { class: 'note' }, `${o.params.entities.length} élément(s), ${n} contour(s) fermé(s).`));
      ps.append(E('div', { class: 'btnrow' },
        E('button', { class: 'btn primary', onclick: () => this.enterSketch(o), html: icon('sketch', 16) + 'Modifier' }),
        E('button', { class: 'btn', onclick: () => this.fromSketch('extrude', o), html: icon('extrude', 16) + 'Extruder' }),
        E('button', { class: 'btn', onclick: () => this.fromSketch('pocket', o), html: icon('pocket', 16) + 'Poche' }),
        E('button', { class: 'btn', onclick: () => this.fromSketch('revolve', o), html: icon('revolve', 16) + 'Révolution' }),
        E('button', { class: 'btn', onclick: () => this.exportSketch('dxf', o), html: icon('export', 16) + 'DXF' })));
    }

    // ---- position
    const pos = sec(o.parent != null ? 'Position (relative au parent)' : 'Position');
    pos.append(this.xyzField('Position', o.pos, (i, v) => set(() => { o.pos[i] = v; }), 'pos'));
    pos.append(E('div', { style: 'color:var(--muted);font-size:11px;margin:2px 0' }, 'Rotation (°)'));
    pos.append(this.xyzField('Rotation', o.rot, (i, v) => set(() => { o.rot[i] = v; }), 'rot'));
    pos.append(E('div', { class: 'btnrow' },
      E('button', { class: 'btn' + (this.gizmoMode === 'translate' ? ' primary' : ''), onclick: () => this.setGizmo('translate'), html: icon('move', 15) + 'Déplacer' }),
      E('button', { class: 'btn' + (this.gizmoMode === 'rotate' ? ' primary' : ''), onclick: () => this.setGizmo('rotate'), html: icon('rotate', 15) + 'Tourner' }),
      o.parent == null && o.type !== 'sketch' ? E('button', { class: 'btn', onclick: () => this.dropToGround(), html: icon('ground', 15) + 'Au sol' }) : null));

    if (o.type !== 'sketch') {
      // ---- opération booléenne
      const bs = sec('Opération');
      const roles = { '': 'Corps indépendant', cut: 'Enlever de la matière de…', add: 'Ajouter (unir) à…', inter: 'Intersection avec…' };
      const targets = this.model.objects.filter((t) => t.id !== o.id && this.model.isSolid(t) && !t.role && !this.isDescendant(t, o));
      bs.append(this.selField('Type', o.role || '', Object.entries(roles).map(([v, l]) => ({ v, l })), (v) => {
        if (!v) return this.setRelation(o, null, null);
        const tgt = o.parent != null ? this.model.get(o.parent) : targets[0];
        if (!tgt) return this.toast('Aucun autre solide disponible');
        this.setRelation(o, v, tgt.id);
      }, 'role'));
      if (o.role) bs.append(this.selField('Sur', o.parent, targets.map((t) => ({ v: t.id, l: this.model.displayName(t) })), (v) => this.setRelation(o, o.role, +v), 'target'));

      // ---- matériau
      if (!o.role) {
        const ms = sec('Matériau et couleur');
        ms.append(this.selField('Matériau', o.material, Object.keys(MATERIALS), (v) => set(() => { o.material = v; o.color = null; }), 'mat'));
        const col = E('input', { type: 'color', value: this.model.color(o), onchange: () => set(() => { o.color = col.value; }) });
        ms.append(E('div', { class: 'field' }, E('label', {}, 'Couleur'), col, E('span', { class: 'unit' })));
        // ---- propriétés physiques
        const info = sec('Propriétés physiques');
        try {
          const f = this.model.finalGeometry(o);
          if (f) {
            const g = f.geom.clone().applyMatrix4(this.model.worldMatrix(o));
            g.computeBoundingBox();
            const sz = g.boundingBox.getSize(new THREE.Vector3());
            const vol = Model.volume(f.geom);
            const mass = (vol / 1000) * (MATERIALS[o.material]?.density || 1);
            info.append(E('div', { class: 'info' },
              E('span', {}, 'Encombrement'), E('b', {}, `${fmt(sz.x, 1)} × ${fmt(sz.y, 1)} × ${fmt(sz.z, 1)} mm`),
              E('span', {}, 'Volume'), E('b', {}, `${fmt(vol / 1000, 2)} cm³`),
              E('span', {}, 'Masse'), E('b', {}, mass >= 1000 ? `${fmt(mass / 1000, 3)} kg` : `${fmt(mass, 1)} g`)));
          }
        } catch { /* géométrie invalide */ }
      }
    }

    // ---- actions
    const as = sec('Actions');
    as.append(E('div', { class: 'btnrow' },
      E('button', { class: 'btn', onclick: () => this.duplicate(), html: icon('duplicate', 15) + 'Dupliquer' }),
      E('button', { class: 'btn', onclick: () => this.patternDialog('lin'), html: icon('patlin', 15) + 'Répéter' }),
      E('button', { class: 'btn', onclick: () => { o.visible = !o.visible; this.commit(); this.refresh(); }, html: icon(o.visible ? 'eyeoff' : 'eye', 15) + (o.visible ? 'Masquer' : 'Afficher') }),
      E('button', { class: 'btn danger', onclick: () => this.deleteSel(), html: icon('trash', 15) + 'Supprimer' })));
  }

  sketchLink(o) {
    const sk = this.model.get(o.params.sketch);
    return E('div', { class: 'btnrow' }, sk ? E('button', { class: 'btn', onclick: () => this.enterSketch(sk), html: icon('sketch', 15) + `Modifier « ${esc(this.model.displayName(sk))} »` }) : E('span', { class: 'note' }, 'Esquisse supprimée'));
  }

  renderDocProps(p) {
    p.append(E('div', { class: 'ph', html: icon('folder', 22) }, E('input', { value: this.docName, 'data-k': 'doc', onchange: (e) => { this.docName = e.target.value || 'Sans titre'; $('#docname').textContent = this.docName; } })));
    const solids = this.model.objects.filter((o) => this.model.isSolid(o) && !o.role);
    const s = E('div', { class: 'sec' }, E('h4', {}, 'Projet'));
    s.append(E('div', { class: 'info' }, E('span', {}, 'Corps'), E('b', {}, String(solids.length)), E('span', {}, 'Esquisses'), E('b', {}, String(this.model.objects.filter((o) => o.type === 'sketch').length))));
    p.append(s);
    p.append(E('div', { class: 'sec' }, E('h4', {}, 'Pour bien démarrer'), E('div', { class: 'note', html: `
      <b>1.</b> Dessinez une <b>esquisse</b> <span class="kbd">S</span>, puis <b>Extruder</b>.<br>
      <b>2.</b> Ou posez un <b>volume</b> / un <b>composant</b> du catalogue <span class="kbd">B</span> en cliquant dans la vue.<br>
      <b>3.</b> <b>Perçage</b> <span class="kbd">H</span> : cliquez sur une face.<br>
      <b>4.</b> Les vis se posent automatiquement dans les trous.<br>
      <b>5.</b> Onglet <b>Plan & Export</b> : DXF, STEP, STL…<br><br>
      Dans les champs numériques, vous pouvez taper un calcul : <span class="kbd">120/2+5</span>` })));
  }

  renderMultiProps(p, sel) {
    p.append(E('div', { class: 'ph', html: icon('layers', 22) }, E('b', {}, `${sel.length} objets sélectionnés`)));
    const first = sel[0];
    const s = E('div', { class: 'sec' }, E('h4', {}, 'Opérations booléennes'));
    s.append(E('div', { class: 'note', style: 'margin-bottom:8px' }, `Corps principal : « ${this.model.displayName(first)} » (premier sélectionné).`));
    s.append(E('button', { class: 'btn big', onclick: () => this.booleanSel('cut'), html: icon('subtract', 16) + 'Soustraire du premier' }));
    s.append(E('div', { class: 'btnrow' },
      E('button', { class: 'btn', onclick: () => this.booleanSel('add'), html: icon('union', 15) + 'Unir' }),
      E('button', { class: 'btn', onclick: () => this.booleanSel('inter'), html: icon('intersect', 15) + 'Intersection' })));
    p.append(s);
    p.append(E('div', { class: 'sec' }, E('h4', {}, 'Actions'), E('div', { class: 'btnrow' },
      E('button', { class: 'btn', onclick: () => this.duplicate(), html: icon('duplicate', 15) + 'Dupliquer' }),
      E('button', { class: 'btn', onclick: () => this.export3D('step'), html: icon('export', 15) + 'Exporter STEP' }),
      E('button', { class: 'btn danger', onclick: () => this.deleteSel(), html: icon('trash', 15) + 'Supprimer' }))));
  }

  renderSketchProps(p) {
    const ed = this.editor, o = ed.obj;
    p.append(E('div', { class: 'ph', html: icon('sketch', 22) }, E('input', { value: this.model.displayName(o), 'data-k': 'skname', onchange: (e) => { o.name = e.target.value; this.commit(); this.renderTree(); } })));
    const loops = findLoops(o.params.entities).length;
    p.append(E('div', { class: 'sec' }, E('h4', {}, 'Esquisse'), E('div', { class: loops ? 'note' : 'note', html: loops ? `✅ <b>${loops} contour(s) fermé(s)</b> détecté(s) : prêt à extruder.` : '⚠️ Aucun contour fermé pour l\'instant. Fermez un profil pour pouvoir créer un volume.' })));
    if (ed.tool === 'polygon') {
      const s = E('div', { class: 'sec' }, E('h4', {}, 'Polygone'));
      s.append(this.numField('Nombre de côtés', ed.polySides, (v) => { ed.polySides = Math.max(3, Math.round(v)); this.renderProps(); }, '', 'polyn'));
      p.append(s);
    }
    const sel = [...ed.selected];
    if (sel.length === 1) {
      const e = o.params.entities[sel[0]];
      const s = E('div', { class: 'sec' }, E('h4', {}, ENTITY_NAMES[e.type] + (e.construction ? ' (construction)' : '')));
      for (const [path, label] of ENTITY_FIELDS[e.type] || []) {
        const [k, i] = path.split('.');
        const val = i != null ? e[k][+i] : e[k];
        s.append(this.numField(label, val, (v) => {
          if (i != null) e[k] = e[k].slice(), e[k][+i] = v; else e[k] = k === 'n' ? Math.max(3, Math.round(v)) : v;
          this.sketchChanged();
        }, /a0|a1|rot/.test(k) ? '°' : k === 'n' ? '' : 'mm', 'e.' + path));
      }
      if (e.type === 'circle') s.append(this.numField('Diamètre', e.r * 2, (v) => { e.r = v / 2; this.sketchChanged(); }, 'mm', 'e.diam'));
      if (e.type === 'line') s.append(E('div', { class: 'info' }, E('span', {}, 'Longueur'), E('b', {}, fmt(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])) + ' mm')));
      p.append(s);
    } else if (sel.length > 1) {
      p.append(E('div', { class: 'sec' }, E('h4', {}, 'Sélection'), E('div', { class: 'note' }, `${sel.length} éléments sélectionnés.`)));
    }
    p.append(E('div', { class: 'sec' }, E('h4', {}, 'Saisie au clavier'), E('div', { class: 'note', html: `Pendant un tracé, tapez directement une valeur puis <span class="kbd">Entrée</span> :<br>
      • ligne : <span class="kbd">50</span> (longueur), <span class="kbd">50&lt;30</span> (longueur&lt;angle), <span class="kbd">20;10</span> (dx;dy)<br>
      • rectangle : <span class="kbd">80;40</span><br>• cercle / polygone : <span class="kbd">25</span> (diamètre)<br>
      • 1er point : <span class="kbd">x;y</span><br><span class="kbd">Maj</span> désactive l'aimantation.` })));
    p.append(E('div', { class: 'sec' }, E('button', { class: 'btn big primary', onclick: () => this.exitSketch(), html: icon('check', 16) + 'Terminer l\'esquisse' }),
      E('div', { class: 'btnrow', style: 'margin-top:6px' },
        E('button', { class: 'btn', onclick: () => this.fromSketch('extrude'), html: icon('extrude', 15) + 'Extruder' }),
        E('button', { class: 'btn', onclick: () => this.fromSketch('pocket'), html: icon('pocket', 15) + 'Poche' }),
        E('button', { class: 'btn', onclick: () => this.fromSketch('revolve'), html: icon('revolve', 15) + 'Révolution' }))));
  }

  numField(label, val, onset, unit = 'mm', key, options) {
    const inp = E('input', { type: 'text', inputmode: 'decimal', value: fmtIn(val ?? 0), 'data-k': key, list: options ? 'dl-' + key : null });
    inp.addEventListener('change', () => {
      const v = evalNum(inp.value);
      if (v == null) { inp.value = fmtIn(val); this.toast('Valeur invalide', true); return; }
      onset(v);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const v = (evalNum(inp.value) ?? 0) + (e.key === 'ArrowUp' ? step : -step);
        inp.value = fmtIn(v);
        onset(v);
      }
    });
    const dl = options ? E('datalist', { id: 'dl-' + key }, ...options.map((x) => E('option', { value: x }))) : null;
    return E('div', { class: 'field' }, E('label', {}, label), inp, dl, E('span', { class: 'unit' }, unit));
  }

  selField(label, val, options, onset, key) {
    const s = E('select', { 'data-k': key, onchange: () => onset(s.value) });
    for (const o of options) {
      const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o;
      s.append(E('option', { value: v, selected: String(v) === String(val) }, l));
    }
    return E('div', { class: 'field' }, E('label', {}, label), s, E('span', { class: 'unit' }));
  }

  xyzField(label, arr, onset, key) {
    const d = E('div', { class: 'xyz' });
    ['x', 'y', 'z'].forEach((ax, i) => {
      const inp = E('input', { type: 'text', inputmode: 'decimal', value: fmtIn(arr[i]), 'data-k': key + i, title: `${label} ${ax.toUpperCase()}` });
      inp.addEventListener('change', () => { const v = evalNum(inp.value); if (v == null) { inp.value = fmtIn(arr[i]); return; } onset(i, v); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      d.append(E('span', { class: ax }, ax.toUpperCase()), inp);
    });
    return d;
  }

  updateXYZFields(o) {
    for (let i = 0; i < 3; i++) {
      const a = document.querySelector(`[data-k="pos${i}"]`), b = document.querySelector(`[data-k="rot${i}"]`);
      if (a) a.value = fmtIn(o.pos[i]);
      if (b) b.value = fmtIn(o.rot[i]);
    }
  }

  // ================================================================ accueil
  updateWelcome() {
    const w = $('#welcome');
    const empty = this.model.objects.length === 0 && this.mode === 'normal';
    w.classList.toggle('hidden', !empty);
    if (!empty) return;
    let hasAuto = false;
    try { hasAuto = !!localStorage.getItem('formacad.autosave') && JSON.parse(localStorage.getItem('formacad.autosave')).objects.length > 0; } catch { /* rien */ }
    const btn = (ic, t, sub, fn) => E('button', { onclick: fn, html: icon(ic, 30) + `<span>${t}</span><small>${sub}</small>` });
    w.innerHTML = '';
    w.append(E('div', { class: 'card' },
      E('h1', {}, 'Bienvenue dans FormaCAD'),
      E('p', {}, 'Concevez vos pièces en quelques clics, puis exportez-les en DXF, STEP, STL…'),
      E('div', { class: 'grid' },
        btn('sketch', 'Dessiner une esquisse', 'puis l\'extruder en volume', () => this.newSketchDialog()),
        btn('box', 'Poser un bloc', 'volume paramétré', () => this.placeBasic('box')),
        btn('catalog', 'Catalogue', 'vis, roulements, profilés…', () => this.showPane('lib')),
        btn('import', 'Importer', 'STEP, IGES, STL, DXF…', () => this.openFile('.step,.stp,.iges,.igs,.brep,.stl,.obj,.glb,.gltf,.ply,.3mf,.dxf')),
        hasAuto ? btn('undo', 'Reprendre', 'le dernier projet', () => this.restoreAutosave()) : btn('open', 'Ouvrir un projet', 'fichier .fcad', () => this.openFile('.fcad,.json')),
        btn('play', 'Voir un exemple', 'assemblage de démonstration', () => this.loadExample()))));
  }

  restoreAutosave() {
    try {
      this.model.fromFile(localStorage.getItem('formacad.autosave'));
      this.selection = [];
      this.commit(false);
      this.refresh();
      this.setStdView('iso');
    } catch (e) { this.toast('Impossible de restaurer : ' + e.message, true); }
  }

  // ================================================================ messages
  setHint(t) { $('#hint').textContent = t; }
  refreshHint() { if (this.mode === 'sketch') this.setHint('✏️ ' + this.editor.hint()); }
  setCoords(t) { $('#coords').textContent = t; }
  setCursorLabel(t) {
    const l = $('#cursorLabel');
    if (!t || !this.lastMouse) { l.classList.add('hidden'); return; }
    const r = this.viewer.container.getBoundingClientRect();
    l.textContent = t;
    l.style.left = this.lastMouse.clientX - r.left + 'px';
    l.style.top = this.lastMouse.clientY - r.top + 'px';
    l.classList.remove('hidden');
  }
  toast(msg, err = false) {
    const d = E('div', { class: err ? 'err' : '' }, msg);
    $('#toast').append(d);
    setTimeout(() => d.remove(), 4200);
  }
  modal(content, onMount) {
    const m = $('#modal'), b = m.querySelector('.box');
    b.innerHTML = '';
    if (typeof content === 'string') b.innerHTML = content; else b.append(content);
    m.classList.remove('hidden');
    onMount?.(b);
    return b;
  }
  closeModal() { $('#modal').classList.add('hidden'); }

  // ================================================================ modes (placement, mesure, choix de face)
  cancelMode() {
    if (this.mode === 'place' && this.place) { this.viewer.overlay.remove(this.place.ghost); this.place = null; }
    if (this.mode === 'measure') this.clearMeasure();
    if (this.mode === 'sketch') return this.exitSketch();
    this.mode = 'normal';
    $('#cursorLabel').classList.add('hidden');
    this.refresh();
  }

  libSearch(q) {
    this.showPane('lib');
    const i = $('#libsearch');
    i.value = q;
    this.renderLibList(q);
  }

  placeSheet(kind) {
    const params = SHEET_DEFAULTS(kind);
    this.startPlace({ type: 'sheet', params, name: '' }, { hint: `Cliquez dans la vue pour poser : ${SHEET[kind].label} — Échap pour terminer. Réglez ensuite les cotes à droite.` });
  }

  flatDialog(o) {
    let f;
    try { f = sheetFlat(o.params); } catch (e) { return this.toast(e.message, true); }
    const ents = f.entities, texts = f.texts || [];
    const shapes = (() => { try { return sketchShapesArea(ents); } catch { return 0; } })();
    const mass = (shapes * o.params.e / 1000) * (MATERIALS[o.material]?.density || 7.85);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of ents) for (const q of entityPts(e)) { minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]); }
    const W = maxX - minX, H = maxY - minY, m = Math.max(W, H) * 0.08 + 10;
    const sw = Math.max(W, H) / 700;
    const path = ents.map((e) => {
      const pts = entityPts(e);
      const d = pts.map((q, i) => `${i ? 'L' : 'M'}${(q[0] - minX + m).toFixed(2)} ${(maxY - q[1] + m).toFixed(2)}`).join('') + (e.closed || e.type === 'circle' ? 'Z' : '');
      const col = e.layer === 'PLIAGE' ? '#c62828' : e.construction ? '#888' : '#111';
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw * (e.construction ? 1 : 1.8)}" ${e.construction ? `stroke-dasharray="${sw * 8} ${sw * 5}"` : ''}/>`;
    }).join('');
    const tx = texts.map((t) => `<text x="${t.p[0] - minX + m}" y="${maxY - t.p[1] + m}" font-size="${t.h * 1.4}" fill="${t.layer === 'PLIAGE' ? '#c62828' : '#1565c0'}" font-family="Arial">${esc(t.txt)}</text>`).join('');
    const dims = `<g fill="#1565c0" font-family="Arial" font-size="${Math.max(W, H) / 45}"><text x="${m + W / 2}" y="${m * 0.6}" text-anchor="middle">${fmt(W, 1)} mm</text><text x="${m + W + m * 0.15}" y="${m + H / 2}">${fmt(H, 1)} mm</text></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W + 2 * m} ${H + 2 * m}" width="100%" height="100%"><rect width="100%" height="100%" fill="#fff"/>${path}${tx}${dims}</svg>`;
    const name = safeName(this.model.displayName(o)) + '_developpe';
    const toDxf = () => {
      const dxf = new EX.DxfWriter();
      EX.sketchToDxf(dxf, ents);
      for (const t of texts) dxf.text(t.p, t.h, t.txt, dxf.layer(t.layer || 'TEXTE', 3));
      return dxf.toString();
    };
    const rows = [
      ['Encombrement du flan', `${fmt(W, 1)} × ${fmt(H, 1)} mm`],
      ['Surface', `${fmt(shapes / 1e6, 4)} m²`],
      ['Épaisseur / matériau', `${o.params.e} mm – ${o.material}`],
      ['Masse du flan', mass >= 1000 ? `${fmt(mass / 1000, 2)} kg` : `${fmt(mass, 0)} g`],
      ...f.info.map(([k, v]) => [k, typeof v === 'number' ? fmt(v, 2) + (/segments|°/.test(k) ? '' : ' mm') : v]),
    ];
    this.modal(E('div', {},
      E('h2', { html: icon('flat', 22) + 'Développé – ' + esc(this.model.displayName(o)) }),
      E('div', { class: 'drawing-wrap' },
        E('div', { class: 'drawing-preview', html: svg }),
        E('div', { class: 'drawing-opts', style: 'width:280px' },
          E('div', { class: 'info', style: 'margin-bottom:10px' }, ...rows.flatMap(([k, v]) => [E('span', {}, k), E('b', {}, String(v))])),
          E('div', { class: 'note' }, 'Calcul à la fibre neutre. Calques DXF : CONTOUR (découpe), PLIAGE (lignes de pli / roulage), AXE, TEXTE. Échelle 1:1 en mm.'),
          E('button', { class: 'btn big primary', style: 'margin-top:10px', onclick: () => { download(toDxf(), name + '.dxf', 'application/dxf'); this.toast('Développé exporté en DXF'); }, html: icon('export', 16) + 'Télécharger DXF' }),
          E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => download(svg.replace('width="100%" height="100%"', `width="${W + 2 * m}mm" height="${H + 2 * m}mm"`), name + '.svg', 'image/svg+xml'), html: icon('export', 16) + 'Télécharger SVG' }),
          E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => {
            const sk = this.model.add({ type: 'sketch', name: 'Développé ' + this.model.displayName(o), params: { entities: structuredClone(ents) } });
            this.closeModal(); this.commit(); this.selection = [sk.id]; this.refresh(); this.setStdView('top');
            this.toast('Développé ajouté comme esquisse : modifiable, extrudable, exportable');
          }, html: icon('sketch', 16) + 'Créer une esquisse' }),
          E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => this.printSvg(svg.replace('width="100%" height="100%"', '')), html: icon('drawing', 16) + 'Imprimer / PDF' }),
          E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => this.closeModal() }, 'Fermer')))));
  }

  placeBasic(type) {
    const def = BASIC[type];
    const params = Object.fromEntries(def.params.map((p) => [p.k, p.def]));
    this.startPlace({ type, params, name: '' }, { hint: `Cliquez dans la vue (sur le sol ou sur une face) pour poser : ${def.label} — Échap pour terminer` });
  }

  placePart(fam, size) {
    const params = partDefaults(fam, size);
    this.startPlace({ type: 'part', params, name: '', material: fam.cat === 'Profilés aluminium' ? 'Aluminium' : 'Acier' }, { hint: `Cliquez pour poser ${partLabel(params)} (accroche automatique dans les trous) — Échap pour terminer`, snapHoles: true });
  }

  startPlace(spec, opts = {}) {
    if (this.mode === 'sketch') this.exitSketch();
    if (this.mode !== 'normal') this.cancelMode();
    let geom;
    try { geom = this.model.baseGeometry(spec); } catch (e) { return this.toast(e.message, true); }
    this.mode = 'place';
    const ghost = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: opts.target ? 0xe53935 : 0x1e88e5, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    ghost.visible = false;
    ghost.renderOrder = 3;
    this.viewer.overlay.add(ghost);
    this.place = { spec, opts, ghost };
    this.updateWelcome();
    this.viewer.tc.detach();
    this.setHint(opts.hint || 'Cliquez pour placer — Échap pour terminer');
    if (this.lastMouse) this.placeMove(this.lastMouse);
  }

  surfaceHit(e, excludeIds = []) {
    const hits = this.viewer.pick(e, [this.viewer.world]);
    for (const h of hits) {
      if (!h.object.userData.solid || !isShown(h.object) || excludeIds.includes(h.object.userData.id)) continue;
      const n = h.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize();
      if (n.dot(this.viewer.raycaster.ray.direction) > 0) n.negate();
      return { point: h.point.clone(), normal: n, id: h.object.userData.id, object: h.object, face: h.face };
    }
    return null;
  }

  placeCompute(e) {
    const opts = this.place.opts;
    const hit = this.surfaceHit(e);
    let pos, quat = new THREE.Quaternion(), targetId = null;
    const g = this.settings.grid;
    const sn = (v) => (this.settings.snapGrid && !e.shiftKey ? Math.round(v / g) * g : v);
    if (hit) {
      pos = hit.point;
      quat.setFromUnitVectors(Z, hit.normal);
      targetId = hit.id;
      const n = hit.normal;
      if (Math.abs(n.z) > 0.999) { pos.x = sn(pos.x); pos.y = sn(pos.y); }
      else if (Math.abs(n.x) > 0.999) { pos.y = sn(pos.y); pos.z = sn(pos.z); }
      else if (Math.abs(n.y) > 0.999) { pos.x = sn(pos.x); pos.z = sn(pos.z); }
    } else {
      const ray = this.viewer.rayFromEvent(e);
      pos = new THREE.Vector3();
      if (!ray.intersectPlane(new THREE.Plane(Z, 0), pos)) return null;
      pos.x = sn(pos.x); pos.y = sn(pos.y);
    }
    let snapped = false;
    if (opts.snapHoles) {
      let best = 16;
      for (const h of this.model.objects) {
        if (h.type !== 'hole' || !this.model.isVisible(this.model.get(h.parent) || h)) continue;
        const m = this.model.worldMatrix(h);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        const s = this.viewer.toScreen(p);
        const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
        if (d < best) {
          best = d; pos = p; snapped = true;
          quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
          if (h.params.kind === 'lamage') pos = p.clone().add(new THREE.Vector3(0, 0, -h.params.h2).applyQuaternion(quat));
          if (h.params.kind === 'fraisage') pos = p.clone();
        }
      }
    }
    return { pos, quat, targetId, snapped };
  }

  placeMove(e) {
    const r = this.placeCompute(e);
    const gh = this.place.ghost;
    if (!r) { gh.visible = false; return; }
    gh.visible = true;
    gh.position.copy(r.pos);
    gh.quaternion.copy(r.quat);
    this.setCoords(`X ${fmt(r.pos.x, 1)}  Y ${fmt(r.pos.y, 1)}  Z ${fmt(r.pos.z, 1)}`);
    this.setCursorLabel(r.snapped ? '🎯 Dans le trou' : this.place.opts.target && r.targetId == null ? 'Cliquez sur une face' : '');
  }

  placeClick(e) {
    const r = this.placeCompute(e);
    if (!r) return;
    const { spec, opts } = this.place;
    if (opts.target && r.targetId == null) return this.toast('Cliquez sur une face d\'un solide', true);
    const o = this.model.add({ ...spec, params: structuredClone(spec.params) });
    if (opts.target) { o.parent = r.targetId; o.role = 'cut'; }
    this.model.setWorldMatrix(o, new THREE.Matrix4().compose(r.pos, r.quat, new THREE.Vector3(1, 1, 1)));
    this.commit();
    this.selection = [o.id];
    this.rebuildScene();
    this.viewer.tc.detach();
    this.renderTree();
    this.renderProps();
    this.updateWelcome();
    this.toast(`${this.model.displayName(o)} ajouté – cliquez encore pour en placer d'autres, Échap pour terminer`);
  }

  // ---- mesure
  startMeasure() {
    if (this.mode === 'sketch') this.exitSketch();
    if (this.mode !== 'normal') this.cancelMode();
    this.mode = 'measure';
    this.meas = { pts: [], group: new THREE.Group() };
    this.viewer.overlay.add(this.meas.group);
    this.updateWelcome();
    this.viewer.tc.detach();
    this.setHint('📏 Cliquez deux points (accroche aux sommets) — Échap pour terminer');
    this.renderRibbon();
  }

  measurePoint(e) {
    const hit = this.surfaceHit(e);
    if (!hit) {
      const p = new THREE.Vector3();
      return this.viewer.rayFromEvent(e).intersectPlane(new THREE.Plane(Z, 0), p) ? { p, snap: false } : null;
    }
    // accroche au sommet le plus proche du triangle touché
    const pos = hit.object.geometry.getAttribute('position');
    let best = null, bd = 14;
    for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
      const s = this.viewer.toScreen(v);
      const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
      if (d < bd) { bd = d; best = v; }
    }
    return { p: best || hit.point, snap: !!best };
  }

  measureMove(e) {
    const r = this.measurePoint(e);
    this.setCursorLabel(r?.snap ? '◆ sommet' : '');
    if (r) this.setCoords(`X ${fmt(r.p.x)}  Y ${fmt(r.p.y)}  Z ${fmt(r.p.z)}`);
  }

  measureClick(e) {
    const r = this.measurePoint(e);
    if (!r) return;
    if (this.meas.pts.length >= 2) this.meas.pts = [];
    this.meas.pts.push(r.p);
    const g = this.meas.group;
    while (g.children.length) g.remove(g.children[0]);
    const sz = this.viewer.worldPerPixel(r.p) * 5;
    for (const p of this.meas.pts) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(sz, 12, 8), new THREE.MeshBasicMaterial({ color: 0xc62828, depthTest: false }));
      s.position.copy(p); s.renderOrder = 10; g.add(s);
    }
    const lab = $('#measureLabel');
    if (this.meas.pts.length === 2) {
      const [a, b] = this.meas.pts;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xc62828, depthTest: false }));
      l.renderOrder = 10; g.add(l);
      const d = b.clone().sub(a);
      lab.innerHTML = `<b>${fmt(d.length())} mm</b> &nbsp; ΔX ${fmt(d.x)} ΔY ${fmt(d.y)} ΔZ ${fmt(d.z)}`;
      lab.classList.remove('hidden');
      this.setHint(`📏 Distance : ${fmt(d.length())} mm (ΔX ${fmt(d.x)}, ΔY ${fmt(d.y)}, ΔZ ${fmt(d.z)}) — cliquez pour une nouvelle mesure`);
    } else lab.classList.add('hidden');
  }

  clearMeasure() {
    if (this.meas) this.viewer.overlay.remove(this.meas.group);
    this.meas = null;
    $('#measureLabel').classList.add('hidden');
  }

  // ================================================================ esquisse
  newSketchDialog() {
    if (this.mode === 'sketch') this.exitSketch();
    if (this.mode !== 'normal') this.cancelMode();
    const hasSolid = this.model.objects.some((o) => this.model.isSolid(o) && !o.role);
    const off = E('input', { type: 'text', value: '0', inputmode: 'decimal', style: 'width:90px' });
    const choose = (k) => {
      const v = evalNum(off.value) || 0;
      this.closeModal();
      const P = PLANES[k];
      const n = new THREE.Vector3(...P.n);
      this.createSketch(new THREE.Vector3(...P.u), new THREE.Vector3(...P.v), n, n.clone().multiplyScalar(v), null, `Esquisse ${P.label.split(' ')[0]}`);
    };
    const box = E('div', {},
      E('h2', { html: icon('sketch', 22) + 'Nouvelle esquisse' }),
      E('p', { style: 'color:var(--muted);margin-top:0' }, 'Choisissez le plan de dessin :'),
      E('div', { class: 'choice' },
        E('button', { onclick: () => choose('XY'), html: icon('top', 28) + 'Dessus<small>plan XY (sol)</small>' }),
        E('button', { onclick: () => choose('XZ'), html: icon('front', 28) + 'Face<small>plan XZ</small>' }),
        E('button', { onclick: () => choose('YZ'), html: icon('right', 28) + 'Droite<small>plan YZ</small>' })),
      E('div', { class: 'field', style: 'margin-top:12px' }, E('label', {}, 'Décalage du plan'), off, E('span', { class: 'unit' }, 'mm')),
      hasSolid ? E('button', { class: 'btn big', style: 'margin-top:8px', onclick: () => { this.closeModal(); this.startPickFace(); }, html: icon('select', 16) + 'Sur une face plane d\'un solide…' }) : null,
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Annuler')));
    this.modal(box);
  }

  startPickFace() {
    this.mode = 'pickface';
    this.updateWelcome();
    this.viewer.tc.detach();
    this.setHint('Cliquez sur une face plane d\'un solide pour y dessiner — Échap pour annuler');
  }

  pickFaceClick(e) {
    const hit = this.surfaceHit(e);
    if (!hit) return this.toast('Cliquez sur une face d\'un solide', true);
    const n = hit.normal;
    let v = Math.abs(n.z) < 0.9 ? Z.clone().sub(n.clone().multiplyScalar(n.z)).normalize() : null;
    let u;
    if (v) u = v.clone().cross(n).normalize();
    else { u = new THREE.Vector3(1, 0, 0).sub(n.clone().multiplyScalar(n.x)).normalize(); v = n.clone().cross(u).normalize(); }
    this.mode = 'normal';
    this.createSketch(u, v, n, hit.point, hit.id, 'Esquisse sur face');
  }

  createSketch(u, v, n, origin, onBody, name) {
    const m = new THREE.Matrix4().makeBasis(u, v, n);
    m.setPosition(origin);
    const o = this.model.add({ type: 'sketch', name: name + ' ' + (this.model.objects.filter((x) => x.type === 'sketch').length + 1), params: { entities: [], onBody } });
    this.model.setWorldMatrix(o, m);
    this.commit();
    this.enterSketch(o);
  }

  enterSketch(o) {
    if (!o) return;
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.mode !== 'normal') this.cancelMode();
    this.mode = 'sketch';
    this.editor = new SketchEditor(this, o);
    this.selection = [o.id];
    this.viewer.overlay.add(this.editor.preview, this.editor.marker);
    this.viewer.setNavMode('sketch');
    this.viewer.tc.detach();
    this.prevOrtho = this.settings.ortho;
    this.viewer.setOrtho(true);
    const m = this.model.worldMatrix(o);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const box = this.sceneBox();
    const org = new THREE.Vector3().setFromMatrixPosition(m);
    box.expandByPoint(org.clone().addScalar(-60)).expandByPoint(org.clone().addScalar(60));
    if (o.params.entities.length) this.viewer.setView(n, box);
    else {
      const b = new THREE.Box3().setFromCenterAndSize(org, new THREE.Vector3(200, 200, 200));
      this.viewer.setView(n, b);
    }
    const banner = $('#sketchbanner');
    banner.innerHTML = '';
    banner.append(E('span', {}, '✏️ Mode esquisse : ' + this.model.displayName(o)), E('button', { onclick: () => this.exitSketch() }, 'Terminer ✓'));
    banner.classList.remove('hidden');
    this.editor.setTool(o.params.entities.length ? 'select' : 'line');
    this.refresh();
    this.refreshHint();
  }

  exitSketch(silent = false) {
    if (this.mode !== 'sketch') return;
    const o = this.editor.obj;
    this.viewer.overlay.remove(this.editor.preview, this.editor.marker);
    this.mode = 'normal';
    this.viewer.setNavMode('normal');
    this.viewer.setOrtho(this.prevOrtho);
    $('#sketchbanner').classList.add('hidden');
    $('#cursorLabel').classList.add('hidden');
    const empty = !o.params.entities.length;
    if (empty && this.model.get(o.id) && !this.model.objects.some((x) => x.params?.sketch === o.id)) {
      this.model.remove(o.id);
      this.selection = [];
      this.commit();
    } else this.selection = this.model.get(o.id) ? [o.id] : [];
    this.editor = null;
    this.refresh();
    if (!silent && !empty) {
      const dep = this.model.objects.some((x) => x.params?.sketch === o.id);
      if (!dep && findLoops(o.params.entities).length) this.toast('Esquisse terminée : utilisez « Extruder », « Poche » ou « Révolution » dans le panneau de droite');
    }
  }

  updateSketchUI() { this.renderRibbon(); this.renderProps(); this.refreshHint(); this.editor?.drawPreview(); }

  sketchChanged(commit = true) {
    if (commit) this.commit();
    this.rebuildScene();
    this.renderProps();
    this.renderTree();
    this.refreshHint();
    this.editor?.drawPreview();
  }

  toggleConstruction() {
    const ed = this.editor;
    if (!ed.selected.size) return this.toast('Sélectionnez des éléments avec l\'outil Sélection');
    for (const i of ed.selected) { const e = ed.entities[i]; e.construction = !e.construction; }
    this.sketchChanged();
  }

  findSketch() {
    if (this.mode === 'sketch') return this.editor.obj;
    const s = this.selObjs().find((o) => o.type === 'sketch');
    if (s) return s;
    const sks = this.model.objects.filter((o) => o.type === 'sketch');
    if (sks.length === 1) return sks[0];
    return null;
  }

  fromSketch(kind, sk = null) {
    sk = sk || this.findSketch();
    if (!sk) return this.toast('Sélectionnez d\'abord une esquisse (ou créez-en une)', true);
    if (!findLoops(sk.params.entities).length) return this.toast('L\'esquisse ne contient aucun contour fermé', true);
    const proceed = (target) => {
      if (this.mode === 'sketch') this.exitSketch(true);
      const count = this.model.objects.filter((o) => o.type === kind || (kind === 'pocket' && o.type === 'extrude')).length + 1;
      const o = this.model.add({
        type: kind === 'revolve' ? 'revolve' : 'extrude',
        name: { extrude: 'Extrusion', pocket: 'Poche', revolve: 'Révolution' }[kind] + ' ' + count,
        params: kind === 'revolve' ? { sketch: sk.id, angle: 360 } : { sketch: sk.id, h: kind === 'pocket' ? 10 : 20, dir: kind === 'pocket' ? 'Inverse' : 'Normale' },
        material: target ? target.material : 'Acier',
      });
      const wm = this.model.worldMatrix(sk);
      if (target) { o.parent = target.id; o.role = 'cut'; }
      this.model.setWorldMatrix(o, wm);
      sk.visible = false;
      this.commit();
      this.selection = [o.id];
      this.refresh();
      this.toast(kind === 'revolve' ? 'Révolution créée (axe = axe vertical de l\'esquisse)' : 'Volume créé : réglez la hauteur dans le panneau de droite');
    };
    if (kind !== 'pocket') return proceed(null);
    const solids = this.model.objects.filter((o) => this.model.isSolid(o) && !o.role);
    const on = sk.params.onBody && this.model.get(sk.params.onBody);
    if (on) return proceed(on);
    if (!solids.length) return this.toast('Aucun solide dans lequel creuser la poche', true);
    if (solids.length === 1) return proceed(solids[0]);
    const sel = E('select', {}, ...solids.map((s) => E('option', { value: s.id }, this.model.displayName(s))));
    this.modal(E('div', {}, E('h2', { html: icon('pocket', 22) + 'Poche : dans quel solide ?' }), E('div', { class: 'field' }, E('label', {}, 'Solide'), sel),
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Annuler'),
        E('button', { class: 'btn primary', onclick: () => { this.closeModal(); proceed(this.model.get(+sel.value)); } }, 'Créer la poche'))));
  }

  // ================================================================ perçage
  holeDialog() {
    if (this.mode === 'sketch') this.exitSketch();
    if (!this.model.objects.some((o) => this.model.isSolid(o) && !o.role)) return this.toast('Ajoutez d\'abord un solide à percer', true);
    const st = this.lastHole || { kind: 'simple', d: 6.6, depth: 10, through: true, D2: 11, h2: 6.5 };
    const preset = E('select', {}, E('option', { value: '' }, '— Personnalisé —'), ...Object.entries(HOLE_PRESETS).map(([k, v]) => E('option', { value: v }, k)));
    const kind = E('select', {}, ...['simple', 'lamage', 'fraisage'].map((k) => E('option', { value: k, selected: st.kind === k }, { simple: 'Trou simple', lamage: 'Lamage (vis CHC)', fraisage: 'Fraisage (vis FHC)' }[k])));
    const d = E('input', { type: 'text', value: fmtIn(st.d) });
    const through = E('input', { type: 'checkbox', checked: st.through });
    const depth = E('input', { type: 'text', value: fmtIn(st.depth) });
    const D2 = E('input', { type: 'text', value: fmtIn(st.D2) });
    const h2 = E('input', { type: 'text', value: fmtIn(st.h2) });
    const CB = { 3.4: [6.5, 3.4], 4.5: [8, 4.4], 5.5: [10, 5.4], 6.6: [11, 6.5], 9: [15, 8.6], 11: [18, 10.8], 13.5: [20, 13], 17.5: [26, 17.5], 22: [33, 21.5] };
    preset.addEventListener('change', () => {
      if (!preset.value) return;
      d.value = fmtIn(+preset.value);
      const cb = CB[+preset.value];
      if (cb) { D2.value = fmtIn(cb[0]); h2.value = fmtIn(cb[1]); }
    });
    const F = (l, i, u = 'mm') => E('div', { class: 'field' }, E('label', {}, l), i, E('span', { class: 'unit' }, u));
    this.modal(E('div', {},
      E('h2', { html: icon('hole', 22) + 'Perçage' }),
      F('Norme / usage', preset, ''), F('Type', kind, ''), F('Diamètre', d), F('Débouchant', through, ''), F('Profondeur (si non débouchant)', depth),
      F('Ø lamage / fraisure', D2), F('Profondeur du lamage', h2),
      E('div', { class: 'note' }, 'Après validation, cliquez sur les faces à percer (plusieurs clics possibles). Le perçage reste modifiable.'),
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Annuler'),
        E('button', { class: 'btn primary', onclick: () => {
          const p = { kind: kind.value, d: evalNum(d.value) || 5, through: through.checked, depth: evalNum(depth.value) || 10, D2: evalNum(D2.value) || 10, h2: evalNum(h2.value) || 5 };
          this.lastHole = p;
          this.closeModal();
          this.startPlace({ type: 'hole', params: p, name: `Perçage Ø${fmt(p.d)}` }, { target: true, hint: '🔩 Cliquez sur les faces à percer — Échap pour terminer' });
        } }, 'Placer les trous'))));
  }

  // ================================================================ modifications
  isDescendant(o, ancestor) {
    let p = o.parent;
    while (p != null) { if (p === ancestor.id) return true; p = this.model.get(p)?.parent; }
    return false;
  }

  setRelation(o, role, targetId) {
    const wm = this.model.worldMatrix(o);
    if (!role) { o.parent = null; o.role = null; }
    else {
      const t = this.model.get(targetId);
      if (!t || t.id === o.id || this.isDescendant(t, o)) return this.toast('Opération impossible', true);
      o.parent = t.id; o.role = role;
    }
    this.model.setWorldMatrix(o, wm);
    this.commit();
    this.refresh();
  }

  booleanSel(role) {
    const sel = this.selObjs().filter((o) => this.model.isSolid(o));
    if (sel.length < 2) return this.toast('Sélectionnez au moins 2 solides (Maj + clic). Le premier est le corps principal.', true);
    const [a, ...rest] = sel;
    for (const b of rest) {
      if (this.isDescendant(a, b)) continue;
      const wm = this.model.worldMatrix(b);
      b.parent = a.id; b.role = role;
      this.model.setWorldMatrix(b, wm);
    }
    this.commit();
    this.selection = [a.id];
    this.refresh();
    this.toast({ cut: 'Soustraction effectuée', add: 'Union effectuée', inter: 'Intersection effectuée' }[role] + ' (modifiable dans l\'arbre)');
  }

  cloneDeep(o, parent = o.parent) {
    const c = this.model.add({ ...structuredClone(o), parent });
    for (const k of this.model.children(o.id)) this.cloneDeep(k, c.id);
    return c;
  }

  duplicate() {
    const sel = this.selObjs();
    if (!sel.length) return;
    const ids = sel.map((o) => {
      const c = this.cloneDeep(o);
      if (o.name) c.name = o.name + ' (copie)';
      if (o.type !== 'sketch') { c.pos = [...o.pos]; c.pos[0] += this.settings.grid * 4; }
      return c.id;
    });
    this.commit();
    this.selection = ids;
    this.refresh();
    this.toast('Copie créée (décalée en X)');
  }

  patternDialog(kind) {
    const o = this.selObjs()[0];
    if (!o) return this.toast('Sélectionnez un objet', true);
    const n = E('input', { type: 'text', value: kind === 'lin' ? '4' : '6' });
    const a = E('input', { type: 'text', value: kind === 'lin' ? '50' : '360' });
    const b = E('input', { type: 'text', value: '0' });
    const c = E('input', { type: 'text', value: '0' });
    const F = (l, i, u = 'mm') => E('div', { class: 'field' }, E('label', {}, l), i, E('span', { class: 'unit' }, u));
    const frame = o.parent != null ? 'dans le repère du parent' : 'dans le repère global';
    this.modal(E('div', {},
      E('h2', { html: icon(kind === 'lin' ? 'patlin' : 'patcirc', 22) + (kind === 'lin' ? 'Répétition linéaire' : 'Répétition circulaire') }),
      E('p', { style: 'color:var(--muted);margin-top:0' }, `Objet : ${this.model.displayName(o)} (${frame})`),
      F('Nombre total d\'exemplaires', n, ''),
      ...(kind === 'lin' ? [F('Pas en X', a), F('Pas en Y', b), F('Pas en Z', c)] : [F('Angle total', a, '°'), F('Centre X', b), F('Centre Y', c)]),
      kind === 'circ' ? E('div', { class: 'note' }, 'Rotation autour de l\'axe Z. Pour 360°, les exemplaires sont répartis régulièrement.') : null,
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Annuler'),
        E('button', { class: 'btn primary', onclick: () => {
          const N = Math.max(2, Math.round(evalNum(n.value) || 2)), A = evalNum(a.value) || 0, B = evalNum(b.value) || 0, C = evalNum(c.value) || 0;
          this.closeModal();
          this.pattern(o, kind, N, A, B, C);
        } }, 'Créer'))));
  }

  pattern(o, kind, N, A, B, C) {
    const base = this.model.localMatrix(o);
    const ids = [o.id];
    for (let i = 1; i < N; i++) {
      let m;
      if (kind === 'lin') m = new THREE.Matrix4().makeTranslation(A * i, B * i, C * i).multiply(base);
      else {
        const step = Math.abs(A) >= 360 ? 360 / N : A / (N - 1);
        m = new THREE.Matrix4().makeTranslation(B, C, 0).multiply(new THREE.Matrix4().makeRotationZ(step * i * DEG)).multiply(new THREE.Matrix4().makeTranslation(-B, -C, 0)).multiply(base);
      }
      const c = this.cloneDeep(o);
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(pos, q, s);
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      c.pos = [pos.x, pos.y, pos.z].map((v) => Math.round(v * 1e4) / 1e4);
      c.rot = [e.x, e.y, e.z].map((v) => Math.round((v / DEG) * 1e4) / 1e4);
      ids.push(c.id);
    }
    this.commit();
    this.selection = ids;
    this.refresh();
    this.toast(`${N} exemplaires`);
  }

  dropToGround() {
    for (const o of this.selObjs()) {
      if (o.parent != null || o.type === 'sketch') continue;
      const f = this.model.finalGeometry(o);
      if (!f) continue;
      const g = f.geom.clone().applyMatrix4(this.model.worldMatrix(o));
      g.computeBoundingBox();
      o.pos[2] = Math.round((o.pos[2] - g.boundingBox.min.z) * 1e4) / 1e4;
    }
    this.commit();
    this.refresh();
  }

  deleteSel() {
    const sel = this.selObjs();
    if (!sel.length) return;
    for (const o of sel) if (this.model.get(o.id)) this.model.remove(o.id);
    this.selection = [];
    this.commit();
    this.refresh();
  }

  freezeSel() {
    const o = this.selObjs()[0];
    const f = this.model.finalGeometry(o);
    if (!f) return;
    for (const c of this.model.children(o.id)) this.model.remove(c.id);
    const key = 'b' + Date.now().toString(36);
    this.model.blobs.set(key, { position: new Float32Array(f.geom.getAttribute('position').array) });
    o.name = this.model.displayName(o);
    o.type = 'mesh';
    o.params = { blob: key, source: 'conversion' };
    this.commit();
    this.refresh();
  }

  // ================================================================ fichiers
  newProject() {
    if (this.model.objects.length && !confirm('Créer un nouveau projet ? Les modifications non enregistrées seront perdues.')) return;
    if (this.mode !== 'normal') this.cancelMode();
    this.model.reset();
    this.model.blobs.clear();
    this.model.cache.clear();
    this.selection = [];
    this.docName = 'Sans titre';
    this.undoStack = [];
    this.commit();
    this.refresh();
  }

  saveProject() {
    download(this.model.toFile(), safeName(this.docName) + '.fcad', 'application/json');
    this.toast('Projet enregistré (fichier .fcad)');
  }

  openFile(accept) {
    const i = $('#fileInput');
    i.accept = accept;
    i.multiple = true;
    i.click();
  }

  async handleFiles(files) {
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      try {
        if (ext === 'fcad' || ext === 'json') {
          if (this.mode !== 'normal') this.cancelMode();
          this.model.fromFile(await f.text());
          this.docName = f.name.replace(/\.[^.]+$/, '');
          this.selection = [];
          this.undoStack = [];
          this.commit();
          this.refresh();
          this.setStdView('iso');
          this.toast('Projet ouvert : ' + f.name);
          continue;
        }
        this.setHint('⏳ Import de ' + f.name + '…');
        if (/^(step|stp|iges|igs|brep|brp)$/.test(ext)) this.toast('Lecture du fichier ' + ext.toUpperCase() + ' (noyau OpenCascade)…');
        const r = await importFile(f);
        if (r.sketch) {
          if (this.mode === 'sketch') {
            this.editor.obj.params.entities.push(...r.sketch);
            this.sketchChanged();
            this.fitView();
          } else {
            const o = this.model.add({ type: 'sketch', name: r.name, params: { entities: r.sketch } });
            this.commit();
            this.selection = [o.id];
            this.refresh();
            this.setStdView('top');
          }
          this.toast(`DXF importé comme esquisse (${r.sketch.length} éléments) : vous pouvez l'extruder`);
          continue;
        }
        const ids = [];
        for (const b of r.bodies) {
          const key = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          this.model.blobs.set(key, { position: b.position });
          const o = this.model.add({ type: 'mesh', name: b.name, params: { blob: key, source: f.name }, color: b.color, material: 'Acier' });
          ids.push(o.id);
        }
        this.commit();
        this.selection = ids;
        this.refresh();
        this.fitView();
        this.toast(`${f.name} importé`);
      } catch (e) {
        console.error(e);
        this.toast(`Échec de l'import de ${f.name} : ${e.message}`, true);
        this.refresh();
      }
    }
  }

  exportBodies() {
    const ids = this.selection.length ? this.selObjs().filter((o) => !o.role && this.model.isSolid(o)).map((o) => o.id) : null;
    const b = this.model.worldBodies(ids && ids.length ? ids : null);
    if (!b.length) this.toast('Rien à exporter : aucun solide visible', true);
    return b;
  }

  async export3D(fmtName) {
    const b = this.exportBodies();
    if (!b.length) return;
    const n = safeName(this.selection.length === 1 ? this.model.displayName(this.selObjs()[0]) : this.docName);
    try {
      switch (fmtName) {
        case 'step': download(EX.toSTEP(b, n + '.step'), n + '.step', 'application/step'); break;
        case 'stl': download(EX.toSTL(b), n + '.stl', 'model/stl'); break;
        case 'obj': download(EX.toOBJ(b), n + '.obj', 'text/plain'); break;
        case 'ply': download(EX.toPLY(b), n + '.ply', 'text/plain'); break;
        case 'glb': download(await EX.toGLB(b), n + '.glb', 'model/gltf-binary'); break;
        case 'dxf3d': download(EX.toDxf3D(b), n + '_3d.dxf', 'application/dxf'); break;
      }
      this.toast(`Export ${fmtName.toUpperCase()} : ${b.length} corps (${this.selection.length ? 'sélection' : 'tout le visible'})`);
    } catch (e) { this.toast('Erreur d\'export : ' + e.message, true); }
  }

  exportSketch(kind, sk = null) {
    sk = sk || this.findSketch();
    if (!sk) return this.toast('Sélectionnez une esquisse (ou utilisez « Plan 2D » pour exporter les volumes)', true);
    const n = safeName(this.model.displayName(sk));
    if (kind === 'dxf') {
      const dxf = new EX.DxfWriter();
      EX.sketchToDxf(dxf, sk.params.entities);
      download(dxf.toString(), n + '.dxf', 'application/dxf');
    } else download(EX.sketchToSvg(sk.params.entities), n + '.svg', 'image/svg+xml');
    this.toast(`Esquisse exportée en ${kind.toUpperCase()} (cotes réelles en mm)`);
  }

  exportPNG() {
    const url = this.viewer.screenshot();
    fetch(url).then((r) => r.blob()).then((b) => download(b, safeName(this.docName) + '.png'));
  }

  exportDialog() {
    const it = (ic, t, s, fn) => E('button', { onclick: () => { this.closeModal(); fn(); }, html: icon(ic, 26) + `<div><b>${t}</b><small>${s}</small></div>` });
    this.modal(E('div', {},
      E('h2', { html: icon('export', 22) + 'Exporter' }),
      E('p', { style: 'color:var(--muted);margin-top:0' }, this.selection.length ? 'Export de la sélection.' : 'Export de tous les corps visibles. Sélectionnez des objets pour n\'exporter qu\'eux.'),
      E('div', { class: 'exp-grid' },
        it('drawing', 'Plan 2D – DXF / SVG / PDF', 'vues, lignes cachées, cotes', () => this.drawingDialog()),
        it('sketch', 'Esquisse – DXF', 'contour exact pour laser / CNC', () => this.exportSketch('dxf')),
        it('export', 'STEP (.step)', 'échange avec toute CAO', () => this.export3D('step')),
        it('export', 'STL (.stl)', 'impression 3D', () => this.export3D('stl')),
        it('export', 'OBJ (.obj)', 'rendu, Blender', () => this.export3D('obj')),
        it('export', 'GLB (.glb)', 'web, réalité augmentée', () => this.export3D('glb')),
        it('export', 'PLY (.ply)', 'maillage coloré', () => this.export3D('ply')),
        it('export', 'DXF 3D (.dxf)', 'faces 3D pour AutoCAD', () => this.export3D('dxf3d')),
        it('camera', 'Image (.png)', 'capture de la vue', () => this.exportPNG()),
        it('save', 'Projet (.fcad)', 'réouvrable dans FormaCAD', () => this.saveProject())),
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Fermer'))));
  }

  drawingDialog() {
    const bodies = this.exportBodies();
    if (!bodies.length) return;
    const views = { 'Face': true, 'Dessus': true, 'Gauche': true, 'Droite': false, 'Isométrique': true };
    const opts = { hidden: true, dims: true, title: this.docName };
    const prev = E('div', { class: 'drawing-preview' });
    let layout = null;
    const update = () => {
      const names = Object.keys(views).filter((v) => views[v]);
      if (!names.length) { prev.innerHTML = ''; return; }
      prev.innerHTML = '<div style="padding:20px;color:#888">Calcul des vues…</div>';
      setTimeout(() => {
        layout = EX.layoutDrawing(bodies, names, { hidden: opts.hidden });
        prev.innerHTML = EX.drawingToSvg(layout, { ...opts, forScreen: true });
      }, 20);
    };
    const cb = (label, obj, k) => { const c = E('input', { type: 'checkbox', checked: obj[k], onchange: () => { obj[k] = c.checked; update(); } }); return E('label', { class: 'field', style: 'cursor:pointer' }, c, E('span', { style: 'flex:1' }, label)); };
    const title = E('input', { type: 'text', value: opts.title, style: 'width:100%', onchange: () => { opts.title = title.value; update(); } });
    const n = safeName(this.docName);
    const box = E('div', {},
      E('h2', { html: icon('drawing', 22) + 'Mise en plan' }),
      E('div', { class: 'drawing-wrap' }, prev, E('div', { class: 'drawing-opts' },
        E('h4', {}, 'Vues'), ...Object.keys(views).map((v) => cb(v, views, v)),
        E('h4', {}, 'Options'), cb('Lignes cachées (pointillés)', opts, 'hidden'), cb('Cotes d\'encombrement', opts, 'dims'),
        E('div', { style: 'margin:8px 0 4px;color:var(--muted)' }, 'Titre'), title,
        E('div', { class: 'note', style: 'margin-top:10px' }, 'Échelle 1:1, unités en mm. Calques DXF : VISIBLE, CACHE, COTES, TEXTE.'),
        E('button', { class: 'btn big primary', style: 'margin-top:10px', onclick: () => { if (layout) { download(EX.drawingToDxf(layout, opts), n + '_plan.dxf', 'application/dxf'); this.toast('Plan exporté en DXF'); } }, html: icon('export', 16) + 'Télécharger DXF' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => { if (layout) download(EX.drawingToSvg(layout, opts), n + '_plan.svg', 'image/svg+xml'); }, html: icon('export', 16) + 'Télécharger SVG' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => { if (layout) this.printSvg(EX.drawingToSvg(layout, opts)); }, html: icon('drawing', 16) + 'Imprimer / PDF' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => this.closeModal() }, 'Fermer'))));
    this.modal(box);
    update();
  }

  printSvg(svg) {
    const w = window.open('', '_blank');
    if (!w) { this.toast('Impression indisponible ici : téléchargement du plan en SVG (imprimable)'); return download(svg, safeName(this.docName) + '_plan.svg', 'image/svg+xml'); }
    w.document.write(`<!doctype html><html><head><title>${esc(this.docName)} – plan</title><style>@page{size:A4 landscape;margin:10mm}html,body{margin:0}svg{width:100%;height:auto;max-height:190mm}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  }

  physicalDialog() {
    const bodies = this.model.worldBodies();
    if (!bodies.length) return this.toast('Aucun solide visible', true);
    let tv = 0, tm = 0;
    const box = new THREE.Box3();
    const rows = bodies.map((b) => {
      const v = Model.volume(b.geom) / 1000;
      const m = v * (MATERIALS[b.obj.material]?.density || 1);
      tv += v; tm += m;
      b.geom.computeBoundingBox(); box.union(b.geom.boundingBox);
      return `<tr><td>${esc(b.name)}</td><td>${esc(b.obj.material)}</td><td style="text-align:right">${fmt(v)}</td><td style="text-align:right">${fmt(m, 1)}</td></tr>`;
    }).join('');
    const sz = box.getSize(new THREE.Vector3());
    this.modal(`<h2>${icon('layers', 22)}Propriétés physiques</h2>
      <table style="border-collapse:collapse;width:100%;font-size:12.5px"><tr style="text-align:left;color:var(--muted)"><th>Corps</th><th>Matériau</th><th style="text-align:right">Volume (cm³)</th><th style="text-align:right">Masse (g)</th></tr>${rows}
      <tr style="font-weight:700;border-top:1px solid var(--line)"><td>Total</td><td></td><td style="text-align:right">${fmt(tv)}</td><td style="text-align:right">${fmt(tm, 1)}</td></tr></table>
      <p>Encombrement global : <b>${fmt(sz.x, 1)} × ${fmt(sz.y, 1)} × ${fmt(sz.z, 1)} mm</b></p>
      <div class="actions"><button class="btn" onclick="document.getElementById('modal').classList.add('hidden')">Fermer</button></div>`);
  }

  helpDialog() {
    const k = (a, b) => `<span><span class="kbd">${a}</span></span><span>${b}</span>`;
    this.modal(`<h2>${icon('help', 22)}Raccourcis et prise en main</h2>
      <div class="help-grid">
      ${k('Clic gauche', 'Sélectionner (Maj/Ctrl + clic : sélection multiple)')}
      ${k('Glisser gauche', 'Tourner la vue')}${k('Glisser droit / molette', 'Déplacer la vue')}${k('Molette', 'Zoom (vers le curseur)')}
      ${k('F', 'Tout afficher')}${k('0 / 1 / 3 / 7', 'Vue iso / face / droite / dessus')}
      ${k('S', 'Nouvelle esquisse')}${k('E', 'Modifier l\'esquisse de l\'objet sélectionné')}${k('H', 'Perçage')}${k('B', 'Catalogue')}${k('I', 'Importer un fichier')}${k('D', 'Mesurer une distance')}
      ${k('M / T', 'Poignées de déplacement / rotation')}${k('Ctrl+D', 'Dupliquer')}${k('Suppr', 'Supprimer')}
      ${k('Ctrl+Z / Ctrl+Y', 'Annuler / rétablir')}${k('Ctrl+S / Ctrl+O', 'Enregistrer / ouvrir')}${k('Échap', 'Annuler l\'action en cours')}
      <b style="grid-column:1/3;margin-top:8px">En esquisse</b>
      ${k('L R C A P O', 'Ligne, Rectangle, Cercle, Arc, Polygone, Oblong')}${k('Maj+R', 'Rectangle centré')}
      ${k('Chiffres + Entrée', 'Saisir une longueur / un diamètre / x;y')}${k('Maj (maintenue)', 'Désactiver l\'aimantation')}${k('Entrée', 'Terminer l\'esquisse')}
      </div>
      <div class="actions"><button class="btn primary" onclick="document.getElementById('modal').classList.add('hidden')">OK</button></div>`);
  }

  toggleTheme() {
    const d = document.documentElement;
    const dark = d.dataset.theme !== 'dark';
    if (dark) d.dataset.theme = 'dark'; else delete d.dataset.theme;
    try { localStorage.setItem('formacad.theme', dark ? 'dark' : 'light'); } catch { /* rien */ }
  }

  loadExample() {
    if (this.mode !== 'normal') this.cancelMode();
    if (this.model.objects.length && !confirm('Remplacer le projet actuel par l\'exemple ?')) return;
    this.model.reset();
    const M = this.model;
    const plate = M.add({ type: 'plate', name: 'Platine', params: { l: 160, w: 100, h: 20, r: 8, hd: 0, m: 12 }, material: 'Aluminium' });
    for (const [x, y] of [[68, 38], [-68, 38], [-68, -38], [68, -38]]) {
      M.add({ type: 'hole', name: 'Perçage M8 lamé', params: { kind: 'lamage', d: 9, through: true, depth: 10, D2: 15, h2: 8.6 }, parent: plate.id, role: 'cut', pos: [x, y, 20] });
    }
    M.add({ type: 'hole', name: 'Logement roulement', params: { kind: 'lamage', d: 30, through: true, depth: 10, D2: 47, h2: 14 }, parent: plate.id, role: 'cut', pos: [0, 0, 20] });
    for (const [x, y] of [[68, 38], [-68, 38], [-68, -38], [68, -38]]) {
      M.add({ type: 'part', params: { ...partDefaults(familyById('iso4762'), 'M8'), L: 30 }, pos: [x, y, 11.4] });
    }
    M.add({ type: 'part', params: partDefaults(familyById('brg6200'), '6204'), pos: [0, 0, 6] });
    M.add({ type: 'part', name: 'Arbre Ø20', params: { ...partDefaults(familyById('round'), 'Ø20'), L: 90, axis: 'Z' }, pos: [0, 0, -25], material: 'Acier inoxydable' });
    M.add({ type: 'part', params: { ...partDefaults(familyById('gear'), 'm2'), z: 30, b: 12, bore: 20 }, pos: [0, 0, 40], material: 'Laiton' });
    M.add({ type: 'part', params: { ...partDefaults(familyById('iso4032'), 'M8') }, pos: [68, 38, -6.8] });
    this.docName = 'Exemple – support de pignon';
    this.selection = [];
    this.commit();
    this.refresh();
    this.setStdView('iso');
    this.toast('Exemple chargé : cliquez sur les objets pour voir et modifier leurs paramètres');
  }
}

function entityPts(e) {
  if (e.type === 'poly') return e.pts;
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'arc') { let a1 = e.a1; while (a1 <= e.a0) a1 += 360; const n = Math.max(8, Math.ceil((a1 - e.a0) / 3)); return Array.from({ length: n + 1 }, (_, i) => { const t = (e.a0 + ((a1 - e.a0) * i) / n) * Math.PI / 180; return [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]; }); }
  if (e.type === 'circle') return Array.from({ length: 73 }, (_, i) => [e.c[0] + e.r * Math.cos(i * Math.PI / 36), e.c[1] + e.r * Math.sin(i * Math.PI / 36)]);
  return [];
}

function sketchShapesArea(ents) {
  let a = 0;
  for (const s of sketchShapes(ents)) {
    a += Math.abs(THREE.ShapeUtils.area(s.getPoints()));
    for (const h of s.holes) a -= Math.abs(THREE.ShapeUtils.area(h.getPoints()));
  }
  return a;
}

function isShown(o) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

window.app = new App();
