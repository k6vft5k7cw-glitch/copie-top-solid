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
import { HOLES, SHAFTS, COMMON_FITS, fit, deviation, bend, THREADS, CUT_MATERIALS, fzFor, BEAM_CASES, STEELS, sectionProps, BOLT_AS, BOLT_CLASSES, boltCheck, weldCheck, beltLength, chainLinks, SPRING_G, bearingLife } from './calc.js';
import * as FAB from './fab.js';
import { icon, TYPE_ICON, FAMILY_ICON } from './icons.js';
import { Assistant } from './assistant.js';

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
    this.ai = new Assistant(this);
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
    $('#topbar').insertBefore(E('button', { id: 'ai-btn', title: 'Assistant IA : décrivez ce que vous voulez, il le construit', onclick: () => this.ai.toggle(), html: '✨ Assistant IA' }), $('#docname'));
    const tabs = [['create', 'Créer'], ['sheet', 'Chaudronnerie'], ['fab', 'Atelier'], ['modify', 'Modifier'], ['tools', 'Outils'], ['export', 'Plan & Export'], ['help', 'Aide']];
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
        { g: 'Coins', b: [tool('fillet', 'Congé', 'filletc', 'G'), tool('chamfer', 'Chanfrein', 'chamferc', 'J')] },
        { g: 'Contraintes (sur la sélection)', b: [
          { label: 'Horizontal', ic: 'horiz', fn: () => this.editor.constrain('H') },
          { label: 'Vertical', ic: 'vert', fn: () => this.editor.constrain('V') },
          { label: 'Parallèle', ic: 'para', fn: () => this.editor.constrain('parallel') },
          { label: 'Perpendic.', ic: 'perp', fn: () => this.editor.constrain('perp'), title: 'Perpendiculaire' },
          { label: 'Égal', ic: 'equal', fn: () => this.editor.constrain('equal'), title: 'Longueurs ou rayons égaux' },
          { label: 'Concentrique', ic: 'circle', fn: () => this.editor.constrain('concentric') },
          { label: this.showSkDims === false ? 'Afficher cotes' : 'Masquer cotes', ic: 'measure', fn: () => { this.showSkDims = this.showSkDims === false; this.renderSketchDims(); this.renderRibbon(); } },
        ] },
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
      case 'fab': return [
        { g: 'Découpe', b: [
          { label: 'Programme découpe', ic: 'cnc', fn: () => this.camDialog('laser'), primary: true, title: 'G-code laser, plasma ou oxycoupage avec compensation de saignée' },
          { label: 'Imbrication', ic: 'nest', fn: () => this.nestDialog(), title: 'Placer les pièces sur une tôle, taux de chute, DXF et G-code de la tôle' },
        ] },
        { g: 'Usinage', b: [
          { label: 'Programme fraisage', ic: 'cnc', fn: () => this.camDialog('mill'), title: 'Contournage 2D avec compensation d\'outil et perçages G81' },
          { label: 'Conditions de coupe', ic: 'rotate', fn: () => this.calcDialog('cut'), title: 'Vc, N, avance : fraisage, perçage, tournage' },
        ] },
        { g: 'Structure / charpente', b: [
          { label: 'Calcul de poutre', ic: 'beam2', fn: () => this.calcDialog('beam'), title: 'Flèche, contrainte, taux de travail avec les profilés du catalogue' },
          { label: 'Boulons et soudures', ic: 'weld', fn: () => this.calcDialog('joint'), title: 'Eurocode 3 simplifié' },
        ] },
        { g: 'Transmission / maintenance', b: [
          { label: 'Courroies, chaînes, engrenages', ic: 'gear', fn: () => this.calcDialog('trans') },
          { label: 'Roulements, ressorts', ic: 'bearing', fn: () => this.calcDialog('bearing') },
          { label: 'Ajustements ISO', ic: 'calc', fn: () => this.calcDialog('fit') },
        ] },
        { g: 'Pneumatique / hydraulique', b: [
          { label: 'Vérins et hydraulique', ic: 'cylinder2', fn: () => this.calcDialog('fluid') },
          { label: 'Vérins ISO', ic: 'cylinder2', fn: () => this.libSearch('vérin') },
          { label: 'Moteurs IEC', ic: 'motor', fn: () => this.libSearch('moteur') },
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
        { g: 'Assemblage', b: [
          { label: 'Contact face / face', ic: 'align', fn: () => this.startAlign(), active: this.mode === 'align', title: 'Cliquez une face de la pièce à déplacer, puis la face d\'appui (A)' },
          { label: 'Vue éclatée', ic: 'explode', fn: () => this.toggleExplode(), active: this.explode > 0, title: 'Écarte les pièces pour voir l\'assemblage (X)' },
          { label: 'Isoler', ic: 'eye', fn: () => this.toggleIsolate(), active: !!this.isolate, title: 'N\'afficher que la sélection (Q)' },
        ] },
        { g: 'Soudure', b: [{ label: 'Cordon de soudure', ic: 'weld', fn: () => this.startWeld(), active: this.mode === 'weld', title: 'Cliquez le début puis la fin du cordon (accroche aux sommets) – (W)' }] },
        { g: 'Analyse', b: [
          { label: 'Propriétés physiques', ic: 'layers', fn: () => this.physicalDialog(), title: 'Volume, masse, encombrement de tous les corps' },
          { label: 'Nomenclature', ic: 'list', fn: () => this.bomDialog(), title: 'Liste des pièces, quantités, masses, débits' },
        ] },
        { g: 'Atelier', b: [{ label: 'Calculateurs', ic: 'calc', fn: () => this.calcDialog(), primary: true, title: 'Ajustements ISO, pliage, masses, perçages / taraudages' }] },
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
        { g: 'Atelier', b: [
          { label: 'Nomenclature (CSV)', ic: 'list', fn: () => this.exportBomCsv(), title: 'Nomenclature + débits (profilés, tôles) pour Excel' },
          { label: 'Tous les développés (ZIP)', ic: 'flat', fn: () => this.exportAllFlats(), title: 'Un DXF par tôle, classés par épaisseur' },
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
          { label: 'Assistant IA', ic: 'sun', fn: () => this.ai.toggle(), primary: true, title: 'Décrivez votre pièce en français, l\'IA la construit' },
          { label: 'Pas à pas', ic: 'play', fn: () => this.tutorialsDialog(), title: 'Guides : première pièce, tôle pliée, carré-rond, assemblage, plan' },
          { label: 'Rechercher une commande', ic: 'search', fn: () => this.openPalette(), title: 'Ctrl+K' },
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
    cv.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, b: e.button, axis: this.viewer.tc.axis };
      if (this.mode === 'sketch' && e.button === 0 && this.editor.onDown(e)) this.skDragging = true;
    });
    cv.addEventListener('pointerdown', (e) => this.handleDown(e), { capture: true });
    cv.addEventListener('pointerup', (e) => {
      if (this.skDragging) { this.skDragging = false; if (this.editor?.onUp()) { this.down = null; return; } }
      if (this.handleDrag) { this.handleUp(); this.down = null; return; }
      const d = this.down;
      this.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || d.axis) return;
      if (d.b === 0) this.onClick(e);
      if (d.b === 2) {
        if (['place', 'measure', 'pickface', 'align', 'weld'].includes(this.mode)) this.cancelMode();
        else if (this.mode === 'normal') this.contextMenu(e);
      }
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
    if (ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); return this.openPalette(); }
    this.closeMenu();
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
      case 'a': case 'A': this.startAlign(); break;
      case 'w': case 'W': this.startWeld(); break;
      case 'x': case 'X': this.toggleExplode(); break;
      case 'q': case 'Q': this.toggleIsolate(); break;
      case 'c': case 'C': this.calcDialog(); break;
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
    const map = { l: 'line', r: e.shiftKey ? 'crect' : 'rect', c: 'circle', a: 'arc', p: 'polygon', o: 'slot', g: 'fillet', j: 'chamfer', s: 'select' };
    if (map[k]) ed.setTool(map[k]);
    if (k === 'f') this.fitView();
  }

  onClick(e) {
    if (this.mode === 'sketch') return this.editor.onClick(e);
    if (this.mode === 'place') return this.placeClick(e);
    if (this.mode === 'measure') return this.measureClick(e);
    if (this.mode === 'align') return this.alignClick(e);
    if (this.mode === 'weld') return this.weldClick(e);
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
    if (this.skDragging) return this.editor.onDrag(e);
    if (this.handleDrag) return this.handleMove(e);
    if (this.mode === 'sketch') return this.editor.onMove(e);
    if (this.mode === 'place') return this.placeMove(e);
    if (this.mode === 'measure' || this.mode === 'weld') return this.measureMove(e);
    if (this.mode === 'align') { const h = this.surfaceHit(e); this.setCursorLabel(h ? (this.alignA ? 'Face d\'appui' : 'Face à plaquer') : ''); return; }
    const ray = this.viewer.rayFromEvent(e);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(new THREE.Plane(Z, 0), hit)) this.setCoords(`X ${fmt(hit.x, 1)}  Y ${fmt(hit.y, 1)}  Z 0`);
  }

  onFrame() {
    this.positionHud();
    this.positionSketchDims();
    this.positionHandles();
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
    for (const o of this.model.roots()) {
      const g = this.buildGroup(o);
      if (this.isolate && !this.isolate.includes(o.id) && o.type !== 'sketch') g.visible = false;
      w.add(g);
    }
    if (this.explode > 0) {
      w.updateMatrixWorld(true);
      const all = new THREE.Box3();
      const boxes = new Map();
      for (const g of w.children) { if (!g.visible) continue; const b = new THREE.Box3().setFromObject(g, true); if (!b.isEmpty()) { boxes.set(g, b); all.union(b); } }
      const C = all.getCenter(new THREE.Vector3()), R = all.getSize(new THREE.Vector3()).length() / 2 || 1;
      for (const [g, b] of boxes) {
        const d = b.getCenter(new THREE.Vector3()).sub(C);
        if (d.length() < R * 0.02) d.set(0, 0, 1).multiplyScalar(R * 0.3);
        g.position.add(d.multiplyScalar(this.explode));
      }
    }
    w.traverse((c) => { if (c.isMesh && c.userData.solid) { c.castShadow = true; c.receiveShadow = true; } });
    this.viewer.fitShadows(this.sceneBox(), this.settings.shadows !== false && !this.settings.wire);
    this.attachGizmo();
    this.renderHud();
    if (!this.handleDrag) this.renderHandles();
    else for (const m of this.handles || []) { const hd = m.userData.handle; const M = this.model.worldMatrix(hd.obj); const defs = this.handleDefs(hd.obj); const nd = defs.find((x) => x.axis.equals(hd.axis)); if (nd) m.position.copy(nd.pt.applyMatrix4(M)); }
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
          const M = MATERIALS[o.material] || {};
          const mat = new THREE.MeshStandardMaterial({
            color: this.model.color(o), metalness: o.color ? 0.2 : (M.metal ?? 0.3), roughness: o.color ? 0.5 : (M.rough ?? 0.5), side: THREE.DoubleSide, wireframe: this.settings.wire,
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
    if (this.mode !== 'normal' || this.selection.length !== 1 || !o || !o.visible || this.explode > 0) { tc.detach(); return; }
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
      for (const d of BASIC[o.type].params) {
        if (d.options) ps.append(this.selField(d.label, o.params[d.k] ?? d.def, d.options, (v) => set(() => { o.params[d.k] = v; }), 'p.' + d.k));
        else ps.append(this.numField(d.label, o.params[d.k] ?? d.def, (v) => set(() => { o.params[d.k] = Math.max(d.min ?? -Infinity, v); }), d.unit, 'p.' + d.k));
      }
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
    } else if (o.type === 'weld') {
      ps.append(this.numField('Gorge a', o.params.a, (v) => set(() => { o.params.a = Math.max(1, v); this.weldA = o.params.a; }), 'mm', 'p.a'));
      ps.append(this.numField('Longueur', o.params.L, (v) => set(() => { o.params.L = Math.max(0.5, v); }), 'mm', 'p.L'));
      ps.append(E('div', { class: 'note' }, 'Cordon d\'angle représenté de façon simplifiée. Il est compté dans la nomenclature (longueur totale par gorge).'));
    } else if (o.type === 'extrude') {
      ps.append(this.numField('Hauteur', o.params.h, (v) => set(() => { o.params.h = Math.max(0.01, v); }), 'mm', 'p.h'));
      ps.append(this.selField('Sens', o.params.dir, ['Normale', 'Inverse', 'Symétrique'], (v) => set(() => { o.params.dir = v; }), 'p.dir'));
      ps.append(this.selField('Arêtes haut / bas', o.params.edge || 'Aucun', ['Aucun', 'Congé', 'Chanfrein'], (v) => set(() => { o.params.edge = v; if (!o.params.er) o.params.er = 1; }), 'p.edge'));
      if (o.params.edge && o.params.edge !== 'Aucun') ps.append(this.numField(o.params.edge === 'Congé' ? 'Rayon du congé' : 'Taille du chanfrein', o.params.er || 1, (v) => set(() => { o.params.er = Math.max(0.1, v); }), 'mm', 'p.er'));
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
          if (i != null) { const old = e[k].slice(); const nw = e[k].slice(); nw[+i] = v; if (e.type === 'line' || e.type === 'slot') ed.movePoint(old, nw); e[k] = nw; } else e[k] = k === 'n' ? Math.max(3, Math.round(v)) : v;
          this.sketchChanged();
        }, /a0|a1|rot/.test(k) ? '°' : k === 'n' ? '' : 'mm', 'e.' + path));
      }
      if (e.type === 'circle') s.append(this.numField('Diamètre', e.r * 2, (v) => { e.r = v / 2; this.sketchChanged(); }, 'mm', 'e.diam'));
      if (e.type === 'line') {
        s.append(this.numField('Longueur', Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), (v) => { this.setLineLength(e, v); }, 'mm', 'e.len'));
        s.append(this.numField('Angle', (Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180) / Math.PI, (v) => { const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); const nb = [e.a[0] + L * Math.cos(v * DEG), e.a[1] + L * Math.sin(v * DEG)]; ed.movePoint(e.b, nb); e.b = nb; this.sketchChanged(); }, '°', 'e.ang'));
      }
      p.append(s);
    } else if (sel.length > 1) {
      p.append(E('div', { class: 'sec' }, E('h4', {}, 'Sélection'), E('div', { class: 'note' }, `${sel.length} éléments sélectionnés (le premier sert de référence).`)));
    }
    if (sel.length) {
      const c = (lab, k) => E('button', { class: 'btn', onclick: () => ed.constrain(k) }, lab);
      p.append(E('div', { class: 'sec' }, E('h4', {}, 'Contraintes'), E('div', { class: 'btnrow' }, c('Horizontal', 'H'), c('Vertical', 'V'), c('Parallèle', 'parallel'), c('Perpendiculaire', 'perp'), c('Égal', 'equal'), c('Concentrique', 'concentric')),
        E('div', { class: 'note' }, 'Astuce : glissez les points à la souris (outil Sélection) ; les lignes connectées suivent. Cliquez une cote affichée pour la modifier.')));
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
    if (this.mode === 'measure' || this.mode === 'weld') this.clearMeasure();
    if (this.mode === 'align') this.alignA = null;
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
    this.renderSketchDims();
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
    $('#skdims')?.remove();
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
    this.renderSketchDims();
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

  // ================================================================ ATELIER : FAO (G-code) et imbrication
  fabProfiles(objs) {
    const out = [];
    for (const o of objs) {
      const pr = FAB.objectProfile(o, this.model, sheetFlat);
      if (pr && FAB.profileLoops(pr.entities).length) out.push({ o, ...pr });
    }
    return out;
  }

  camDialog(process = 'laser') {
    let src = this.fabProfiles(this.selObjs());
    if (!src.length) src = this.fabProfiles(this.model.objects.filter((o) => o.type === 'sheet' && !o.role));
    if (!src.length) return this.toast('Sélectionnez une pièce plane (esquisse, tôle, plaque, extrusion) à découper ou usiner', true);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('formacad.cam') || '{}'); } catch { /* rien */ }
    const D = {
      laser: { comp: 0.3, feed: 3000, on: 'M3', off: 'M5', pierce: 0.3, lead: 3 }, plasma: { comp: 1.6, feed: 2500, on: 'M3', off: 'M5', pierce: 0.6, lead: 5 },
      oxy: { comp: 2, feed: 500, on: 'M3', off: 'M5', pierce: 15, lead: 8 }, mill: { comp: 6, feed: 800, spindle: 12000, plungeFeed: 200, safeZ: 5, stepDown: 1.5, drillMax: 0 },
    };
    const o = { process, ...D[process], ...(saved[process] || {}) };
    const n = (v) => E('input', { type: 'text', inputmode: 'decimal', value: fmtIn(v), style: 'width:90px' });
    const Fl = (l, i, u = '') => E('div', { class: 'field' }, E('label', {}, l), i, E('span', { class: 'unit' }, u));
    const proc = E('select', {}, ...[['laser', 'Découpe laser'], ['plasma', 'Découpe plasma'], ['oxy', 'Oxycoupage'], ['mill', 'Fraisage 2D / défonceuse']].map(([k, l]) => E('option', { value: k, selected: k === process }, l)));
    proc.addEventListener('change', () => { this.closeModal(); this.camDialog(proc.value); });
    const pick = E('select', {}, ...src.map((s, i) => E('option', { value: i }, this.model.displayName(s.o) + (s.thickness ? ` (ép. ${fmt(s.thickness)})` : ''))));
    const mill = process === 'mill';
    const f = {
      comp: n(mill ? o.comp : o.comp), feed: n(o.feed), lead: n(o.lead ?? 0), pierce: n(o.pierce ?? 0), on: E('input', { type: 'text', value: o.on || 'M3', style: 'width:90px' }), off: E('input', { type: 'text', value: o.off || 'M5', style: 'width:90px' }),
      spindle: n(o.spindle ?? 12000), plungeFeed: n(o.plungeFeed ?? 200), safeZ: n(o.safeZ ?? 5), stepDown: n(o.stepDown ?? 1.5), depth: n(src[0].thickness || 5), drillMax: n(o.drillMax ?? 0),
    };
    const prev = E('div', { class: 'cam-prev' }), stats = E('div', { class: 'info', style: 'margin:8px 0' });
    let result = null;
    const read = () => {
      const v = (k) => evalNum(f[k].value) ?? 0;
      const opt = mill
        ? { process, comp: v('comp') / 2, feed: v('feed'), spindle: v('spindle'), plungeFeed: v('plungeFeed'), safeZ: v('safeZ'), stepDown: v('stepDown'), depth: v('depth'), drillMax: v('drillMax') }
        : { process, comp: v('comp') / 2, feed: v('feed'), lead: v('lead'), pierce: v('pierce'), on: f.on.value.trim() || 'M3', off: f.off.value.trim() || 'M5' };
      return opt;
    };
    const update = () => {
      const s = src[+pick.value];
      const opt = read();
      if (mill) f.depth.dataset.k = 'depth';
      const tp = FAB.toolpaths(s.entities, { comp: opt.comp, lead: opt.lead || 0, drillMax: opt.drillMax || 0 });
      result = FAB.gcode(tp, { ...opt, name: this.model.displayName(s.o) });
      try { const sv = JSON.parse(localStorage.getItem('formacad.cam') || '{}'); const { process: _p, ...rest } = opt; sv[process] = { ...rest, comp: opt.comp * 2 }; localStorage.setItem('formacad.cam', JSON.stringify(sv)); } catch { /* rien */ }
      // aperçu
      const loops = FAB.profileLoops(s.entities);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const l of [...loops.map((l) => l.pts), ...tp.paths.map((p) => p.pts)]) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const m = Math.max(x1 - x0, y1 - y0) * 0.08 + 5, W = x1 - x0 + 2 * m, H = y1 - y0 + 2 * m, sw = Math.max(W, H) / 600;
      const P = ([x, y]) => `${(x - x0 + m).toFixed(2)} ${(y1 - y + m).toFixed(2)}`;
      const path = (pts, closed) => 'M' + pts.map(P).join('L') + (closed ? 'Z' : '');
      let cur = [0, 0], rap = '';
      for (const p of tp.paths) { const st = p.lead || p.pts[0]; rap += `M${P(cur)}L${P(st)}`; cur = p.pts[0]; }
      for (const d of tp.drills) { rap += `M${P(cur)}L${P(d.c)}`; cur = d.c; }
      prev.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%"><rect width="100%" height="100%" fill="#fff"/>
        ${loops.map((l) => `<path d="${path(l.pts, true)}" fill="${l.hole ? '#fff' : '#eef3f8'}" stroke="#9aa4ad" stroke-width="${sw}"/>`).join('')}
        <path d="${rap}" fill="none" stroke="#e53935" stroke-width="${sw * 0.8}" stroke-dasharray="${sw * 4} ${sw * 3}"/>
        ${tp.paths.map((p, i) => `<path d="${(p.lead ? `M${P(p.lead)}L${P(p.pts[0])}` : '') + path(p.pts, true)}" fill="none" stroke="#1565c0" stroke-width="${sw * 1.4}"/><text x="${(p.pts[0][0] - x0 + m).toFixed(1)}" y="${(y1 - p.pts[0][1] + m).toFixed(1)}" font-size="${sw * 12}" fill="#1565c0">${i + 1}</text>`).join('')}
        ${tp.drills.map((d) => `<circle cx="${(d.c[0] - x0 + m).toFixed(2)}" cy="${(y1 - d.c[1] + m).toFixed(2)}" r="${d.d / 2}" fill="none" stroke="#2e7d32" stroke-width="${sw * 1.4}"/>`).join('')}</svg>`;
      stats.innerHTML = '';
      stats.append(E('span', {}, 'Longueur de coupe'), E('b', {}, `${fmt(result.length / 1000, 2)} m`), E('span', {}, mill ? 'Contours × passes' : 'Amorçages'), E('b', {}, mill ? `${result.pierces} × ${result.passes}` : String(result.pierces)),
        E('span', {}, mill ? 'Perçages (G81)' : 'Rapides'), E('b', {}, mill ? String(result.drills) : `${fmt(result.rapid / 1000, 2)} m`), E('span', {}, 'Temps estimé'), E('b', {}, `${fmt(result.minutes, 1)} min`));
    };
    for (const i of [pick, ...Object.values(f)]) { i.addEventListener('change', update); }
    const opts = mill
      ? [Fl('Ø de la fraise', f.comp, 'mm'), Fl('Profondeur totale', f.depth, 'mm'), Fl('Profondeur par passe', f.stepDown, 'mm'), Fl('Avance', f.feed, 'mm/min'), Fl('Avance de plongée', f.plungeFeed, 'mm/min'), Fl('Vitesse de broche', f.spindle, 'tr/min'), Fl('Z de sécurité', f.safeZ, 'mm'), Fl('Percer (G81) les trous ≤', f.drillMax, 'mm')]
      : [Fl('Saignée (largeur de coupe)', f.comp, 'mm'), Fl('Vitesse de coupe', f.feed, 'mm/min'), Fl('Amorçage (lead-in)', f.lead, 'mm'), Fl('Temporisation de perçage', f.pierce, 's'), Fl('Code allumage', f.on), Fl('Code extinction', f.off)];
    this.modal(E('div', {},
      E('h2', { html: icon('cnc', 22) + 'Programme CN (G-code)' }),
      E('div', { class: 'cam-wrap' }, prev, E('div', { class: 'cam-opts' },
        Fl('Procédé', proc), Fl('Pièce', pick), E('h4', {}, 'Paramètres'), ...opts, stats,
        E('div', { class: 'note' }, mill ? 'Contournage avec compensation du rayon d\'outil (extérieurs à l\'extérieur, trous à l\'intérieur). Vérifiez toujours en simulation avant usinage.' : 'Compensation de la demi-saignée intégrée, trous découpés avant le contour extérieur, amorçage dans la chute. Vérifiez toujours en simulation avant découpe.'),
        E('button', { class: 'btn big primary', style: 'margin-top:10px', onclick: () => { if (result) { download(result.text, safeName(this.model.displayName(src[+pick.value].o)) + (mill ? '_fraisage' : '_' + process) + '.nc', 'text/plain'); this.toast('Programme G-code exporté (.nc)'); } }, html: icon('export', 16) + 'Télécharger le G-code (.nc)' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => { if (result) { this.modal(E('div', {}, E('h2', {}, 'G-code'), E('pre', { style: 'max-height:70vh;overflow:auto;font-size:12px;background:var(--panel2);padding:10px;border-radius:8px' }, result.text.slice(0, 200000)), E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.camDialog(process) }, 'Retour')))); } } }, 'Voir le code'),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => this.closeModal() }, 'Fermer')))));
    update();
  }

  nestDialog() {
    const src = this.fabProfiles(this.model.objects.filter((o) => !o.role && o.type !== 'sketch' || (o.type === 'sketch' && o.visible)));
    if (!src.length) return this.toast('Aucune pièce plane à imbriquer (tôles, plaques, extrusions, esquisses)', true);
    const rows = src.map((s) => ({ s, on: E('input', { type: 'checkbox', checked: s.o.type === 'sheet' || s.o.type === 'plate' || src.length < 6 }), qty: E('input', { type: 'text', value: '1' }) }));
    const formats = { '3000 × 1500': [3000, 1500], '2500 × 1250': [2500, 1250], '2000 × 1000': [2000, 1000], '4000 × 2000': [4000, 2000], 'Personnalisé': null };
    const fmtSel = E('select', {}, ...Object.keys(formats).map((k) => E('option', { value: k }, k)));
    const W = E('input', { type: 'text', value: '3000', style: 'width:70px' }), H = E('input', { type: 'text', value: '1500', style: 'width:70px' });
    const gap = E('input', { type: 'text', value: '8', style: 'width:70px' }), margin = E('input', { type: 'text', value: '10', style: 'width:70px' });
    const rot = E('input', { type: 'checkbox', checked: true });
    const prev = E('div', { class: 'cam-prev' }), stats = E('div', { class: 'info', style: 'margin:8px 0' });
    fmtSel.addEventListener('change', () => { const f = formats[fmtSel.value]; if (f) { W.value = f[0]; H.value = f[1]; } run(); });
    let res = null, parts = [];
    const run = () => {
      parts = rows.filter((r) => r.on.checked).map((r) => ({ name: this.model.displayName(r.s.o), loops: FAB.profileLoops(r.s.entities), qty: Math.max(0, Math.round(evalNum(r.qty.value) || 0)), e: r.s.thickness }));
      const sw = evalNum(W.value) || 3000, sh = evalNum(H.value) || 1500;
      res = FAB.nest(parts.filter((p) => p.qty > 0), { W: sw, H: sh, gap: evalNum(gap.value) ?? 8, margin: evalNum(margin.value) ?? 10, rotate: rot.checked });
      const nS = res.sheets.length, gapY = sh * 0.06;
      const TH = Math.max(1, nS) * (sh + gapY), s1 = Math.max(sw, TH) / 700;
      let svg = '';
      res.sheets.forEach((S, k) => {
        const oy = k * (sh + gapY);
        svg += `<rect x="0" y="${oy}" width="${sw}" height="${sh}" fill="#f3f6fa" stroke="#555" stroke-width="${s1 * 1.5}"/><text x="${sw * 0.01}" y="${oy - gapY * 0.2}" font-size="${gapY * 0.6}" fill="#1565c0">Tôle ${k + 1}</text>`;
        for (const it of S.items) for (const l of it.part.loops) { const q = FAB.placedLoop(it, l.pts); svg += `<path d="M${q.map(([x, y]) => `${x.toFixed(1)} ${(oy + sh - y).toFixed(1)}`).join('L')}Z" fill="${l.hole ? '#f3f6fa' : '#90caf9'}" stroke="#0d47a1" stroke-width="${s1}"/>`; }
      });
      prev.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-sw * 0.02} ${-gapY} ${sw * 1.04} ${TH + gapY}" width="100%" height="100%"><rect x="${-sw}" y="${-TH}" width="${sw * 4}" height="${TH * 4}" fill="#fff"/>${svg}</svg>`;
      const placed = res.sheets.reduce((a, s) => a + s.items.length, 0);
      stats.innerHTML = '';
      stats.append(E('span', {}, 'Tôles nécessaires'), E('b', {}, String(nS)), E('span', {}, 'Pièces placées'), E('b', {}, `${placed}${res.unplaced.length ? ` (+${res.unplaced.length} trop grandes)` : ''}`),
        E('span', {}, 'Taux d\'utilisation'), E('b', {}, nS ? `${fmt((100 * res.used) / (res.sheetArea * nS), 1)} %` : '–'), E('span', {}, 'Chute'), E('b', {}, nS ? `${fmt((res.sheetArea * nS - res.used) / 1e6, 2)} m²` : '–'));
    };
    for (const r of rows) { r.on.addEventListener('change', run); r.qty.addEventListener('change', run); }
    for (const i of [W, H, gap, margin, rot]) i.addEventListener('change', run);
    const sheetEnts = (k) => {
      const S = res.sheets[k], ents = [];
      for (const it of S.items) for (const l of it.part.loops) ents.push({ type: 'poly', pts: FAB.placedLoop(it, l.pts), closed: true });
      return ents;
    };
    const exportDxf = () => {
      if (!res?.sheets.length) return;
      const dxf = new EX.DxfWriter(), sw = evalNum(W.value) || 3000, sh = evalNum(H.value) || 1500;
      const LT = dxf.layer('TOLE', 8), LX = dxf.layer('TEXTE', 3);
      res.sheets.forEach((S, k) => {
        const ox = k * (sw + 200);
        dxf.polyline([[ox, 0], [ox + sw, 0], [ox + sw, sh], [ox, sh]], true, LT);
        dxf.text([ox, sh + 30], 25, `Tole ${k + 1} - ${sw}x${sh}`, LX);
        EX.sketchToDxf(dxf, sheetEnts(k), 'CONTOUR', [ox, 0]);
        for (const it of S.items) dxf.text([ox + it.x + 2, it.y + 2], 8, String(it.part.name).slice(0, 30), LX);
      });
      download(dxf.toString(), safeName(this.docName) + '_imbrication.dxf', 'application/dxf');
      this.toast('Imbrication exportée en DXF (une tôle à côté de l\'autre)');
    };
    const gcodeSheet = () => {
      if (!res?.sheets.length) return;
      const k = Math.max(0, Math.min(res.sheets.length - 1, (evalNum(which.value) || 1) - 1));
      const tp = FAB.toolpaths(sheetEnts(k), { comp: 0.15, lead: 3 });
      let cam = {};
      try { cam = JSON.parse(localStorage.getItem('formacad.cam') || '{}').laser || {}; } catch { /* rien */ }
      const g = FAB.gcode(FAB.toolpaths(sheetEnts(k), { comp: (cam.comp ?? 0.3) / 2, lead: cam.lead ?? 3 }), { process: 'laser', feed: cam.feed ?? 3000, on: cam.on || 'M3', off: cam.off || 'M5', pierce: cam.pierce ?? 0.3, name: `Tole ${k + 1}` });
      void tp;
      download(g.text, safeName(this.docName) + `_tole${k + 1}.nc`, 'text/plain');
      this.toast(`G-code de la tôle ${k + 1} : ${fmt(g.length / 1000, 1)} m de coupe, ≈ ${fmt(g.minutes, 0)} min (réglages laser de « Programme CN »)`);
    };
    const which = E('input', { type: 'text', value: '1', style: 'width:50px' });
    this.modal(E('div', {},
      E('h2', { html: icon('nest', 22) + 'Imbrication sur tôle' }),
      E('div', { class: 'cam-wrap' }, prev, E('div', { class: 'cam-opts' },
        E('h4', {}, 'Pièces et quantités'),
        E('div', { class: 'nest-list' }, ...rows.map((r) => E('label', {}, r.on, E('span', { style: 'flex:1' }, this.model.displayName(r.s.o) + (r.s.thickness ? ` – ép. ${fmt(r.s.thickness)}` : '')), r.qty, '×'))),
        E('div', { class: 'field' }, E('label', {}, 'Format de tôle'), fmtSel), E('div', { class: 'field' }, E('label', {}, 'Dimensions'), W, '×', H),
        E('div', { class: 'field' }, E('label', {}, 'Espace entre pièces'), gap, E('span', { class: 'unit' }, 'mm')), E('div', { class: 'field' }, E('label', {}, 'Marge de bord'), margin, E('span', { class: 'unit' }, 'mm')),
        E('label', { class: 'field' }, rot, E('span', { style: 'flex:1' }, 'Autoriser la rotation à 90°')),
        stats,
        E('div', { class: 'note' }, 'Placement par rectangles englobants (rangement en bandes). Regroupez les pièces de même épaisseur et matière sur une même imbrication.'),
        E('button', { class: 'btn big primary', style: 'margin-top:10px', onclick: exportDxf, html: icon('export', 16) + 'Télécharger le DXF' }),
        E('div', { class: 'field', style: 'margin-top:8px' }, E('label', {}, 'G-code laser de la tôle n°'), which, E('button', { class: 'btn', onclick: gcodeSheet }, '.nc')),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => this.closeModal() }, 'Fermer')))));
    run();
  }

  // ================================================================ cotes cliquables en esquisse
  setLineLength(e, L) {
    const d = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
    const nb = [e.a[0] + ((e.b[0] - e.a[0]) / d) * L, e.a[1] + ((e.b[1] - e.a[1]) / d) * L];
    this.editor.movePoint(e.b, nb);
    e.b = nb;
    this.sketchChanged();
  }

  renderSketchDims() {
    $('#skdims')?.remove();
    this.skDimItems = [];
    if (this.mode !== 'sketch' || this.showSkDims === false) return;
    const box = E('div', { id: 'skdims' });
    const ed = this.editor, ents = ed.entities;
    const add = (pt, txt, onset, cur) => {
      const b = E('button', { class: 'skdim', title: 'Cliquez pour modifier' }, txt);
      b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const inp = E('input', { type: 'text', value: fmtIn(cur), class: 'skdim-in' });
        b.replaceWith(inp);
        inp.focus(); inp.select();
        let finished = false;
        const done = (ok) => { if (finished) return; finished = true; const v = evalNum(inp.value); setTimeout(() => { if (ok && v != null && v > 0) onset(v); else this.renderSketchDims(); }, 0); };
        inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
        this.skDimItems.find((x) => x.el === b).el = inp;
      });
      box.append(b);
      this.skDimItems.push({ el: b, pt });
    };
    for (const e of ents.slice(0, 80)) {
      if (e.construction) continue;
      if (e.type === 'line') { const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); add([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], fmt(L, 2), (v) => this.setLineLength(e, v), L); }
      if (e.type === 'circle') add([e.c[0] + e.r * 0.71, e.c[1] + e.r * 0.71], 'Ø' + fmt(2 * e.r, 2), (v) => { e.r = v / 2; this.sketchChanged(); }, 2 * e.r);
      if (e.type === 'arc') { let a1 = e.a1; while (a1 <= e.a0) a1 += 360; const m = ((e.a0 + a1) / 2) * DEG; add([e.c[0] + e.r * Math.cos(m), e.c[1] + e.r * Math.sin(m)], 'R' + fmt(e.r, 2), (v) => { e.r = v; this.sketchChanged(); }, e.r); }
      if (e.type === 'rect') {
        const x0 = Math.min(e.x, e.x + e.w), y0 = Math.min(e.y, e.y + e.h), w = Math.abs(e.w), h = Math.abs(e.h);
        add([x0 + w / 2, y0], fmt(w, 2), (v) => { e.x = x0; e.w = v; e.y = y0; e.h = h; this.sketchChanged(); }, w);
        add([x0 + w, y0 + h / 2], fmt(h, 2), (v) => { e.x = x0; e.w = w; e.y = y0; e.h = v; this.sketchChanged(); }, h);
      }
      if (e.type === 'polygon') add([e.c[0], e.c[1] - e.r], 'Ø' + fmt(2 * e.r, 2), (v) => { e.r = v / 2; this.sketchChanged(); }, 2 * e.r);
      if (e.type === 'slot') { const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); add([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], '↔' + fmt(L, 2), (v) => { const d = L || 1; e.b = [e.a[0] + ((e.b[0] - e.a[0]) / d) * v, e.a[1] + ((e.b[1] - e.a[1]) / d) * v]; this.sketchChanged(); }, L); }
    }
    $('#viewport').append(box);
    this.positionSketchDims();
  }

  positionSketchDims() {
    if (!this.skDimItems?.length || this.mode !== 'sketch') return;
    const r = this.viewer.container.getBoundingClientRect();
    for (const it of this.skDimItems) {
      const sc = this.viewer.toScreen(this.editor.toWorld(it.pt));
      it.el.style.left = sc.x - r.left + 'px';
      it.el.style.top = sc.y - r.top + 'px';
    }
  }

  // ================================================================ poignées d'étirement 3D
  handleDefs(o) {
    const p = o.params, H = [];
    const h = (pt, axis, get, set) => H.push({ pt: new THREE.Vector3(...pt), axis: new THREE.Vector3(...axis), get, set });
    if (['box', 'plate', 'wedge'].includes(o.type)) {
      h([p.l / 2, 0, p.h / 2], [1, 0, 0], (t) => 2 * t, (v) => { p.l = v; });
      h([0, p.w / 2, p.h / 2], [0, 1, 0], (t) => 2 * t, (v) => { p.w = v; });
      h([0, 0, p.h], [0, 0, 1], (t) => t, (v) => { p.h = v; });
    } else if (['cylinder', 'tube'].includes(o.type)) {
      const k = o.type === 'tube' ? 'de' : 'd';
      h([p[k] / 2, 0, p.h / 2], [1, 0, 0], (t) => 2 * t, (v) => { p[k] = v; if (o.type === 'tube' && p.di >= v) p.di = v * 0.8; });
      h([0, 0, p.h], [0, 0, 1], (t) => t, (v) => { p.h = v; });
    } else if (o.type === 'cone') {
      h([p.d1 / 2, 0, 0], [1, 0, 0], (t) => 2 * t, (v) => { p.d1 = v; });
      h([0, 0, p.h], [0, 0, 1], (t) => t, (v) => { p.h = v; });
    } else if (o.type === 'sphere') {
      h([0, 0, p.d], [0, 0, 1], (t) => t, (v) => { p.d = v; });
    } else if (o.type === 'extrude') {
      const sg = p.dir === 'Inverse' ? -1 : 1, f = p.dir === 'Symétrique' ? 0.5 : 1;
      let c = [0, 0];
      try { const f2 = this.model.cached('B' + this.model.baseKey(o), () => this.model.baseGeometry(o)); f2.computeBoundingBox(); const b = f2.boundingBox; c = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2]; } catch { /* rien */ }
      h([c[0], c[1], sg * p.h * f], [0, 0, sg], (t) => t / f, (v) => { p.h = v; });
    } else if (o.type === 'sheet' && o.params.kind === 'shell') {
      h([0, 0, p.H], [0, 0, 1], (t) => t, (v) => { p.H = v; });
    } else if (o.type === 'sheet' && o.params.kind === 'bent') {
      h([0, p.W / 2, 0], [0, 1, 0], (t) => 2 * t, (v) => { p.W = v; });
    } else if (o.type === 'part' && p.L != null) {
      const fam = familyById(p.family);
      if (!fam) return H;
      if (fam.cat === 'Visserie' && fam.id !== 'din975') h([0, 0, -p.L], [0, 0, -1], (t) => t, (v) => { p.L = v; o.name = ''; });
      else {
        const ax = p.axis === 'X' ? [1, 0, 0] : p.axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
        h(ax.map((x) => x * p.L), ax, (t) => t, (v) => { p.L = v; o.name = ''; });
      }
    }
    return H;
  }

  renderHandles() {
    if (!this.handleGroup) { this.handleGroup = new THREE.Group(); this.viewer.overlay.add(this.handleGroup); }
    const G = this.handleGroup;
    while (G.children.length) G.remove(G.children[0]);
    this.handles = [];
    const o = this.selObjs()[0];
    if (this.mode !== 'normal' || this.selection.length !== 1 || !o || !o.visible || this.explode > 0 || o.role) return;
    const defs = this.handleDefs(o);
    const M = this.model.worldMatrix(o);
    const rot = new THREE.Matrix4().extractRotation(M);
    for (const d of defs) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff6d00, depthTest: false }));
      m.renderOrder = 20;
      m.userData.handle = { ...d, world: d.pt.clone().applyMatrix4(M), dirW: d.axis.clone().applyMatrix4(rot).normalize(), originW: new THREE.Vector3().setFromMatrixPosition(M), obj: o };
      m.position.copy(m.userData.handle.world);
      G.add(m);
      this.handles.push(m);
    }
    this.positionHandles();
  }

  positionHandles() {
    if (!this.handles?.length) return;
    for (const m of this.handles) m.scale.setScalar(this.viewer.worldPerPixel(m.position) * 6);
  }

  handleDown(e) {
    if (e.button !== 0 || this.mode !== 'normal' || !this.handles?.length) return;
    const hits = this.viewer.pick(e, this.handles);
    if (!hits.length) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.handleDrag = hits[0].object.userData.handle;
    this.viewer.controls.enabled = false;
    this.handleDrag.before = JSON.stringify(this.handleDrag.obj.params);
  }

  handleMove(e) {
    const H = this.handleDrag;
    const ray = this.viewer.rayFromEvent(e);
    // point de l'axe le plus proche du rayon souris
    const w0 = H.originW.clone().sub(ray.origin), d = H.dirW, r = ray.direction;
    const a = d.dot(d), b = d.dot(r), c = r.dot(r), dd = d.dot(w0), ee = r.dot(w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return;
    const t = (b * ee - c * dd) / den;
    let v = H.get(t);
    const g = this.settings.snapGrid && !e.shiftKey ? this.settings.grid : 0.1;
    v = Math.max(g, Math.round(v / g) * g);
    H.set(v);
    this.setCursorLabel(`${fmt(v, 2)} mm`);
    if (!this._hraf) this._hraf = requestAnimationFrame(() => { this._hraf = null; this.rebuildScene(); });
  }

  handleUp() {
    this.viewer.controls.enabled = true;
    const H = this.handleDrag;
    this.handleDrag = null;
    $('#cursorLabel').classList.add('hidden');
    if (H && JSON.stringify(H.obj.params) !== H.before) { this.commit(); this.refresh(); }
  }

  // ================================================================ menu contextuel (clic droit)
  contextMenu(e) {
    this.closeMenu();
    const p = this.pickObject(e);
    const o = p && this.model.get(p.id);
    if (o && !this.selection.includes(o.id)) this.select([o.id]);
    const items = [];
    const it = (label, ic, fn, cls = '') => items.push({ label, ic, fn, cls });
    const sep = () => items.push(null);
    if (o) {
      const solid = this.model.isSolid(o) && !o.role;
      if (solid) {
        it('Esquisser sur cette face', 'sketch', () => this.pickFaceClick(e));
        it('Percer ici…', 'hole', () => this.holeDialog());
        it('Plaquer contre une autre face', 'align', () => { this.startAlign(); this.alignClick(e); });
      }
      if (o.type === 'sheet') it('Développé à plat (DXF)', 'flat', () => this.flatDialog(o));
      if (FAB.objectProfile(o, this.model, sheetFlat)) { it('Programme de découpe (G-code)', 'cnc', () => this.camDialog('laser')); it('Programme de fraisage (G-code)', 'cnc', () => this.camDialog('mill')); }
      if (o.type === 'sketch') { it('Modifier l\'esquisse', 'sketch', () => this.enterSketch(o)); it('Extruder', 'extrude', () => this.fromSketch('extrude', o)); }
      if (o.params?.sketch && this.model.get(o.params.sketch)) it('Modifier l\'esquisse', 'sketch', () => this.enterSketch(this.model.get(o.params.sketch)));
      sep();
      it('Dupliquer', 'duplicate', () => this.duplicate());
      it('Répétition linéaire…', 'patlin', () => this.patternDialog('lin'));
      it('Répétition circulaire…', 'patcirc', () => this.patternDialog('circ'));
      it(this.isolate ? 'Tout réafficher' : 'Isoler', 'eye', () => this.toggleIsolate());
      it('Masquer', 'eyeoff', () => { o.visible = false; this.commit(); this.refresh(); });
      if (solid) it('Poser au sol', 'ground', () => this.dropToGround());
      sep();
      it('Supprimer', 'trash', () => this.deleteSel(), 'danger');
    } else {
      it('Nouvelle esquisse', 'sketch', () => this.newSketchDialog());
      it('Poser un bloc', 'box', () => this.placeBasic('box'));
      it('Catalogue de composants', 'catalog', () => this.showPane('lib'));
      it('Importer un fichier…', 'import', () => this.openFile('.step,.stp,.iges,.igs,.brep,.stl,.obj,.glb,.gltf,.ply,.3mf,.dxf'));
      sep();
      it('Tout afficher', 'fit', () => this.fitView());
      it('Vue isométrique', 'iso', () => this.setStdView('iso'));
      if (this.isolate) it('Tout réafficher', 'eye', () => this.toggleIsolate());
      it(this.explode > 0 ? 'Rassembler (fin de vue éclatée)' : 'Vue éclatée', 'explode', () => this.toggleExplode());
      it('Rechercher une commande…  Ctrl+K', 'search', () => this.openPalette());
      it('Demander à l\'assistant IA', 'sun', () => this.ai.toggle());
    }
    const m = E('div', { class: 'ctxmenu' });
    for (const x of items) {
      if (!x) { m.append(E('hr')); continue; }
      m.append(E('button', { class: x.cls, html: icon(x.ic, 16) + `<span>${esc(x.label)}</span>`, onclick: () => { this.closeMenu(); x.fn(); } }));
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
    this.menu = m;
    setTimeout(() => window.addEventListener('pointerdown', this._closer = (ev) => { if (!m.contains(ev.target)) this.closeMenu(); }), 0);
  }

  closeMenu() {
    if (this.menu) { this.menu.remove(); this.menu = null; window.removeEventListener('pointerdown', this._closer); }
  }

  // ================================================================ palette de commandes (Ctrl+K)
  commandList() {
    const cmds = [];
    const saveTab = this.tab, saveMode = this.mode;
    const tabs = { create: 'Créer', sheet: 'Chaudronnerie', fab: 'Atelier', modify: 'Modifier', tools: 'Outils', export: 'Plan & Export', help: 'Aide' };
    if (this.mode === 'normal') {
      for (const [t, tl] of Object.entries(tabs)) {
        this.tab = t;
        for (const g of this.ribbonDef()) for (const b of g.b) cmds.push({ label: b.label, group: `${tl} › ${g.g}`, ic: b.ic, fn: b.fn, kw: b.title || '' });
      }
      this.tab = saveTab;
    } else {
      for (const g of this.ribbonDef()) for (const b of g.b) cmds.push({ label: b.label, group: `Esquisse › ${g.g}`, ic: b.ic, fn: b.fn, kw: b.title || '' });
    }
    this.mode = saveMode;
    for (const [v, l] of [['iso', 'Vue isométrique'], ['front', 'Vue de face'], ['top', 'Vue de dessus'], ['right', 'Vue de droite']]) cmds.push({ label: l, group: 'Affichage', ic: v, fn: () => this.setStdView(v) });
    if (this.selection.length) for (const m of Object.keys(MATERIALS)) cmds.push({ label: 'Matériau : ' + m, group: 'Sélection', ic: 'layers', fn: () => { for (const o of this.selObjs()) { o.material = m; o.color = null; } this.commit(); this.refresh(); } });
    for (const f of LIBRARY) for (const sz of Object.keys(f.sizes)) cmds.push({ label: `${f.name} ${sz}`, group: `Catalogue › ${f.std}`, ic: FAMILY_ICON(f), fn: () => this.placePart(f, sz), kw: f.cat });
    return cmds;
  }

  openPalette() {
    if (this.palette) return;
    this.closeMenu();
    const cmds = this.commandList();
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const idx = cmds.map((c) => norm(`${c.label} ${c.group} ${c.kw}`));
    const labs = cmds.map((c) => norm(c.label));
    const input = E('input', { type: 'text', placeholder: 'Que voulez-vous faire ? (ex. : coude, bride DN100, percer, développé, M8…)' });
    const list = E('div', { class: 'pal-list' });
    const wrap = E('div', { id: 'palette' }, E('div', { class: 'pal-box' }, input, list));
    let shown = [], sel = 0;
    const close = () => { wrap.remove(); this.palette = null; };
    const run = (c) => { close(); c.fn(); };
    const render = () => {
      const terms = norm(input.value).split(/\s+/).filter(Boolean);
      const q = terms.join(' ');
      const scored = [];
      for (let i = 0; i < cmds.length; i++) {
        if (!terms.every((t) => idx[i].includes(t))) continue;
        const lab = labs[i];
        let sc = 0;
        if (lab === q) sc = 100; else if (lab.startsWith(q)) sc = 60; else if (terms.every((t) => lab.includes(t))) sc = 40;
        if (cmds[i].group.startsWith('Catalogue')) sc -= 5;
        scored.push([sc, i]);
      }
      scored.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      shown = scored.map(([, i]) => cmds[i]);
      if (!terms.length) shown = shown.filter((c) => !c.group.startsWith('Catalogue'));
      shown = shown.slice(0, 14);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      shown.forEach((c, i) => list.append(E('button', { class: i === sel ? 'on' : '', onclick: () => run(c), onmousemove: () => { if (sel !== i) { sel = i; render(); } }, html: icon(c.ic, 18) + `<span>${esc(c.label)}</span><small>${esc(c.group)}</small>` })));
      if (!shown.length) list.append(E('div', { class: 'pal-empty' }, 'Aucune commande trouvée'));
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) run(shown[sel]);
      else if (e.key === 'Escape') close();
      e.stopPropagation();
    });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    document.body.append(wrap);
    this.palette = wrap;
    render();
    input.focus();
  }

  // ================================================================ cotes modifiables dans la vue 3D
  hudParams(o) {
    const num = (k, label, unit = 'mm') => ({ k, label, unit });
    if (BASIC[o.type]) return BASIC[o.type].params.filter((d) => !d.options).slice(0, 4).map((d) => num(d.k, d.label.replace(/\s*\(.*\)/, ''), d.unit));
    if (o.type === 'part') {
      const fam = familyById(o.params.family);
      if (!fam) return [];
      return [{ k: 'size', label: 'Taille', options: Object.keys(fam.sizes) }, ...fam.extra.filter((x) => !(x.options && typeof x.options[0] === 'string')).slice(0, 3).map((x) => ({ k: x.k, label: x.label, unit: x.unit, options: x.options }))];
    }
    if (o.type === 'sheet') return SHEET[o.params.kind].params.filter((d) => !d.options).slice(0, 4).map((d) => (d.text ? { k: d.k, label: 'Profil', text: true } : num(d.k, d.label.replace(/\s*\(.*\)/, ''), d.unit)));
    if (o.type === 'extrude') return [num('h', 'Hauteur')];
    if (o.type === 'revolve') return [num('angle', 'Angle', '°')];
    if (o.type === 'hole') return [num('d', 'Ø'), ...(o.params.through ? [] : [num('depth', 'Profondeur')])];
    if (o.type === 'weld') return [num('a', 'Gorge a'), num('L', 'Longueur')];
    return [];
  }

  renderHud() {
    let hud = $('#hud');
    if (!hud) { hud = E('div', { id: 'hud' }); $('#viewport').append(hud); }
    const o = this.selObjs()[0];
    this.hudObj = null;
    hud.innerHTML = '';
    if (this.mode !== 'normal' || this.selection.length !== 1 || !o || o.type === 'sketch' || this.explode > 0 || !o.visible) { hud.classList.add('hidden'); return; }
    const fields = this.hudParams(o);
    hud.classList.remove('hidden');
    hud.append(E('div', { class: 'hud-t' }, this.model.displayName(o)));
    const row = E('div', { class: 'hud-row' });
    for (const f of fields) {
      let inp;
      const apply = (v) => { o.params[f.k] = v; if (o.type === 'part') o.name = ''; this.commit(); setTimeout(() => this.refresh(), 0); };
      if (f.options && typeof f.options[0] === 'string') {
        inp = E('select', { 'data-k': 'hud.' + f.k, onchange: () => apply(inp.value) }, ...f.options.map((x) => E('option', { value: x, selected: x === o.params[f.k] }, x)));
      } else if (f.text) {
        inp = E('input', { type: 'text', value: o.params[f.k], 'data-k': 'hud.' + f.k, style: 'width:120px', onchange: () => apply(inp.value) });
      } else {
        inp = E('input', { type: 'text', inputmode: 'decimal', value: fmtIn(o.params[f.k] ?? 0), 'data-k': 'hud.' + f.k });
        inp.addEventListener('change', () => { const v = evalNum(inp.value); if (v == null || v < 0) { inp.value = fmtIn(o.params[f.k]); return; } apply(v); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = Math.max(0, (evalNum(inp.value) ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)); inp.value = fmtIn(v); apply(v); } });
      }
      row.append(E('label', {}, E('span', {}, f.label + (f.unit ? ` (${f.unit})` : '')), inp));
    }
    if (fields.length) hud.append(row);
    try {
      const f = this.model.finalGeometry(o);
      const g = f.geom.clone().applyMatrix4(this.model.worldMatrix(o));
      g.computeBoundingBox();
      const sz = g.boundingBox.getSize(new THREE.Vector3());
      hud.append(E('div', { class: 'hud-dim' }, `↔ ${fmt(sz.x, 1)}   ↕ ${fmt(sz.y, 1)}   ⇵ ${fmt(sz.z, 1)} mm`));
      this.hudAnchor = new THREE.Vector3((g.boundingBox.min.x + g.boundingBox.max.x) / 2, (g.boundingBox.min.y + g.boundingBox.max.y) / 2, g.boundingBox.max.z);
    } catch { this.hudAnchor = new THREE.Vector3(...o.pos); }
    this.hudObj = o;
    this.positionHud();
  }

  positionHud() {
    const hud = $('#hud');
    if (!hud || !this.hudObj || hud.classList.contains('hidden')) return;
    if (this.viewer.tc.dragging) { hud.style.opacity = '0.25'; } else hud.style.opacity = '';
    const s = this.viewer.toScreen(this.hudAnchor);
    const r = this.viewer.container.getBoundingClientRect();
    let x = s.x - r.left, y = s.y - r.top - 70;
    const w = hud.offsetWidth, h = hud.offsetHeight;
    x = Math.max(w / 2 + 8, Math.min(r.width - w / 2 - 60, x));
    y = Math.max(h + 8, Math.min(r.height - 8, y));
    hud.style.left = x + 'px';
    hud.style.top = y + 'px';
  }

  // ================================================================ assemblage : contact face / face
  startAlign() {
    if (this.mode === 'sketch') this.exitSketch();
    if (this.mode !== 'normal') this.cancelMode();
    if (!this.model.objects.some((o) => this.model.isSolid(o) && !o.role)) return this.toast('Il faut au moins deux pièces', true);
    this.mode = 'align';
    this.alignA = null;
    this.viewer.tc.detach();
    this.updateWelcome();
    this.setHint('🧲 1/2 : cliquez la face de la pièce à déplacer — Échap pour annuler');
    this.renderRibbon();
  }

  alignClick(e) {
    const h = this.surfaceHit(e);
    if (!h) return this.toast('Cliquez sur une face', true);
    if (!this.alignA) {
      this.alignA = h;
      this.setHint('🧲 2/2 : cliquez la face d\'appui (sur une autre pièce)');
      return;
    }
    const A = this.alignA;
    if (h.id === A.id) return this.toast('Choisissez une face d\'une autre pièce', true);
    const o = this.model.get(A.id);
    const q = new THREE.Quaternion().setFromUnitVectors(A.normal, h.normal.clone().negate());
    const M = new THREE.Matrix4().makeTranslation(h.point.x, h.point.y, h.point.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-A.point.x, -A.point.y, -A.point.z))
      .multiply(this.model.worldMatrix(o));
    this.model.setWorldMatrix(o, M);
    this.alignA = null;
    this.mode = 'normal';
    $('#cursorLabel').classList.add('hidden');
    this.commit();
    this.selection = [o.id];
    this.refresh();
    this.toast('Pièce plaquée face contre face — ajustez sa position avec les flèches');
  }

  toggleExplode() {
    if (this.explode > 0) { this.explode = 0; this.refresh(); return; }
    const panel = E('div', { id: 'explodebar' }, E('span', {}, 'Vue éclatée'),
      E('input', { type: 'range', min: 0, max: 150, value: 60, oninput: (ev) => { this.explode = ev.target.value / 100; this.rebuildScene(); } }),
      E('button', { class: 'btn', onclick: () => { this.explode = 0; panel.remove(); this.refresh(); } }, 'Fermer'));
    $('#explodebar')?.remove();
    $('#viewport').append(panel);
    this.explode = 0.6;
    this.refresh();
    const obs = setInterval(() => { if (!this.explode) { panel.remove(); clearInterval(obs); } }, 400);
  }

  toggleIsolate() {
    if (this.isolate) this.isolate = null;
    else {
      const ids = this.selObjs().filter((o) => o.parent == null).map((o) => o.id);
      if (!ids.length) return this.toast('Sélectionnez les pièces à isoler', true);
      this.isolate = ids;
      this.toast('Pièces isolées — Q ou clic droit pour tout réafficher');
    }
    this.refresh();
  }

  // ================================================================ soudure
  startWeld() {
    if (this.mode === 'sketch') this.exitSketch();
    if (this.mode !== 'normal') this.cancelMode();
    this.mode = 'weld';
    this.meas = { pts: [], group: new THREE.Group() };
    this.viewer.overlay.add(this.meas.group);
    this.viewer.tc.detach();
    this.updateWelcome();
    this.setHint(`🔥 Cordon a=${this.weldA || 4} : cliquez le début puis la fin (accroche aux sommets) — Échap pour terminer`);
    this.renderRibbon();
  }

  weldClick(e) {
    const r = this.measurePoint(e);
    if (!r) return;
    this.meas.pts.push(r.p);
    const g = this.meas.group;
    const sz = this.viewer.worldPerPixel(r.p) * 5;
    const s = new THREE.Mesh(new THREE.SphereGeometry(sz, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff6d00, depthTest: false }));
    s.position.copy(r.p); s.renderOrder = 10; g.add(s);
    if (this.meas.pts.length < 2) return;
    const [a, b] = this.meas.pts;
    const L = a.distanceTo(b);
    this.meas.pts = [];
    while (g.children.length) g.remove(g.children[0]);
    if (L < 0.5) return;
    const A = this.weldA || 4;
    const o = this.model.add({ type: 'weld', name: '', params: { a: A, L: Math.round(L * 100) / 100 }, material: 'Acier' });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
    this.model.setWorldMatrix(o, new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    this.commit();
    this.selection = [o.id];
    this.rebuildScene();
    this.viewer.tc.detach();
    this.renderTree();
    this.renderProps();
    this.toast(`Cordon a${A} de ${fmt(L, 1)} mm ajouté — continuez ou Échap`);
  }

  // ================================================================ nomenclature
  bom() {
    const rows = new Map();
    for (const o of this.model.objects) {
      if (!this.model.isSolid(o) || o.role) continue;
      let name = this.model.displayName(o), mat = o.material, key, L = 0;
      if (o.type === 'part') { const fam = familyById(o.params.family); mat = `${fam?.std || ''} – ${o.material}`; }
      if (o.type === 'sheet') mat = `Tôle ép. ${o.params.e} – ${o.material}`;
      if (o.type === 'weld') { name = `Cordon de soudure a${o.params.a}`; mat = 'Soudure'; L = o.params.L; }
      key = name + '|' + mat;
      let mass = 0;
      try { mass = (Model.volume(this.model.finalGeometry(o).geom) / 1000) * (MATERIALS[o.material]?.density || 7.85); } catch { /* rien */ }
      const r = rows.get(key) || { name, mat, qty: 0, mass, L: 0, objs: [] };
      r.qty++; r.L += L; r.objs.push(o);
      rows.set(key, r);
    }
    return [...rows.values()].map((r, i) => ({
      rep: i + 1, qty: r.qty, name: r.L ? `${r.name} (Σ ${fmt(r.L, 0)} mm)` : r.name, mat: r.mat,
      unit: r.mass, total: r.mass * r.qty, mass: r.mass >= 1000 ? `${fmt(r.mass / 1000, 2)} kg` : `${fmt(r.mass, 0)} g`, objs: r.objs,
    }));
  }

  cutList() {
    const prof = new Map(), sheets = new Map();
    for (const o of this.model.objects) {
      if (o.role) continue;
      if (o.type === 'part' && o.params.L) {
        const fam = familyById(o.params.family);
        if (!fam || !/Profilés|Tuyauterie/.test(fam.cat)) continue;
        const k = `${fam.name} ${o.params.size}|${o.params.L}`;
        const r = prof.get(k) || { name: `${fam.name} ${o.params.size}`, L: o.params.L, qty: 0, mat: o.material };
        r.qty++; prof.set(k, r);
      }
      if (o.type === 'sheet') {
        try {
          const f = sheetFlat(o.params);
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
          for (const e of f.entities) if (!e.construction) for (const q of entityPts(e)) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); }
          const k = this.model.displayName(o) + '|' + o.params.e;
          const r = sheets.get(k) || { name: this.model.displayName(o), e: o.params.e, W: c - a, H: d - b, area: sketchShapesArea(f.entities), qty: 0, mat: o.material };
          r.qty++; sheets.set(k, r);
        } catch { /* développé impossible */ }
      }
    }
    return { prof: [...prof.values()], sheets: [...sheets.values()] };
  }

  bomDialog() {
    const rows = this.bom();
    if (!rows.length) return this.toast('Aucune pièce dans le projet', true);
    const { prof, sheets } = this.cutList();
    const total = rows.reduce((a, r) => a + r.total, 0);
    const tr = (cells, th = false) => `<tr>${cells.map((c, i) => `<${th ? 'th' : 'td'} style="${i === 0 || i === 1 || /\d/.test(String(c)) && i > 3 ? 'text-align:right' : ''}">${esc(c)}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
    let html = `<h2>${icon('list', 22)}Nomenclature</h2><table class="tbl">${tr(['Rep.', 'Qté', 'Désignation', 'Matière / norme', 'Masse unit.', 'Masse totale'], true)}${rows.map((r) => tr([r.rep, r.qty, r.name, r.mat, r.mass, r.total >= 1000 ? fmt(r.total / 1000, 2) + ' kg' : fmt(r.total, 0) + ' g'])).join('')}</table><p><b>Masse totale : ${fmt(total / 1000, 2)} kg</b></p>`;
    if (prof.length) html += `<h3>Débit des profilés et tubes</h3><table class="tbl">${tr(['Désignation', 'Longueur', 'Qté', 'Longueur totale'], true)}${prof.map((r) => tr([r.name, r.L + ' mm', r.qty, fmt((r.L * r.qty) / 1000, 2) + ' m'])).join('')}</table>`;
    if (sheets.length) html += `<h3>Débit des tôles (flans développés)</h3><table class="tbl">${tr(['Pièce', 'Épaisseur', 'Flan', 'Qté', 'Surface totale'], true)}${sheets.map((r) => tr([r.name, r.e + ' mm', `${fmt(r.W, 0)} × ${fmt(r.H, 0)}`, r.qty, fmt((r.area * r.qty) / 1e6, 3) + ' m²'])).join('')}</table>`;
    const box = this.modal(html);
    box.append(E('div', { class: 'actions' }, E('button', { class: 'btn primary', onclick: () => this.exportBomCsv(), html: icon('export', 16) + 'Exporter CSV (Excel)' }), E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Fermer')));
  }

  exportBomCsv() {
    const rows = this.bom();
    if (!rows.length) return this.toast('Aucune pièce dans le projet', true);
    const { prof, sheets } = this.cutList();
    const c = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const n = (v) => String(Math.round(v * 1000) / 1000).replace('.', ',');
    const lines = [`${c('Nomenclature – ' + this.docName)}`, '', ['Rep', 'Qté', 'Désignation', 'Matière / norme', 'Masse unitaire (kg)', 'Masse totale (kg)'].map(c).join(';')];
    for (const r of rows) lines.push([r.rep, r.qty, c(r.name), c(r.mat), n(r.unit / 1000), n(r.total / 1000)].join(';'));
    if (prof.length) { lines.push('', c('DÉBIT PROFILÉS / TUBES'), ['Désignation', 'Longueur (mm)', 'Qté', 'Matière'].map(c).join(';')); for (const r of prof) lines.push([c(r.name), n(r.L), r.qty, c(r.mat)].join(';')); }
    if (sheets.length) { lines.push('', c('DÉBIT TÔLES'), ['Pièce', 'Épaisseur (mm)', 'Flan L (mm)', 'Flan l (mm)', 'Surface unitaire (m²)', 'Qté', 'Matière'].map(c).join(';')); for (const r of sheets) lines.push([c(r.name), n(r.e), n(r.W), n(r.H), n(r.area / 1e6), r.qty, c(r.mat)].join(';')); }
    download('﻿' + lines.join('\r\n'), safeName(this.docName) + '_nomenclature.csv', 'text/csv');
    this.toast('Nomenclature exportée (s\'ouvre dans Excel / LibreOffice)');
  }

  async exportAllFlats() {
    const list = this.model.objects.filter((o) => o.type === 'sheet' && !o.role);
    if (!list.length) return this.toast('Aucune pièce de chaudronnerie / tôlerie dans le projet', true);
    const { zipSync, strToU8 } = await import('three/addons/libs/fflate.module.js');
    const files = {};
    let ok = 0;
    list.forEach((o, i) => {
      try {
        const f = sheetFlat(o.params);
        const dxf = new EX.DxfWriter();
        EX.sketchToDxf(dxf, f.entities);
        for (const t of f.texts || []) dxf.text(t.p, t.h, t.txt, dxf.layer(t.layer || 'TEXTE', 3));
        files[`ep${String(o.params.e).replace('.', ',')}mm/${String(i + 1).padStart(2, '0')}_${safeName(this.model.displayName(o))}_${o.material.split(' ')[0]}.dxf`] = strToU8(dxf.toString());
        ok++;
      } catch (e) { this.toast(`${this.model.displayName(o)} : ${e.message}`, true); }
    });
    download(new Blob([zipSync(files)]), safeName(this.docName) + '_developpes.zip', 'application/zip');
    this.toast(`${ok} développé(s) exporté(s), classés par épaisseur`);
  }

  // ================================================================ calculateurs d'atelier
  calcDialog(tab = 'fit') {
    const F = (l, i, u = '') => E('div', { class: 'field' }, E('label', {}, l), i, E('span', { class: 'unit' }, u));
    const num = (v) => E('input', { type: 'text', inputmode: 'decimal', value: fmtIn(v) });
    const out = E('div', { class: 'calc-out' });
    const body = E('div', {});
    const tabs = [['fit', 'Ajustements ISO'], ['cut', 'Usinage'], ['beam', 'Poutre (RDM)'], ['joint', 'Boulons / soudure'], ['trans', 'Transmission'], ['bearing', 'Roulements / ressorts'], ['fluid', 'Vérins / hydraulique'], ['bend', 'Pliage'], ['mass', 'Masse'], ['thread', 'Perçage / taraudage']];
    const head = E('div', { class: 'calc-tabs' }, ...tabs.map(([k, l]) => E('button', { class: k === tab ? 'on' : '', onclick: () => this.calcDialog(k) }, l)));
    const sel = (opts, v) => E('select', {}, ...opts.map((o) => E('option', { value: o, selected: o === v }, o)));
    const um = (v) => (Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '+' : '') + fmt(v, 1)) + ' µm';
    if (tab === 'fit') {
      const D = num(25), H = sel(HOLES, 'H7'), S = sel(SHAFTS, 'g6');
      const calc = () => {
        const d = evalNum(D.value);
        const r = d && fit(d, H.value, S.value);
        if (!r) { out.innerHTML = '<div class="errbox">Diamètre hors plage (1 à 500 mm) ou combinaison non disponible.</div>'; return; }
        const mm = (v) => fmt(d + v / 1000, 3);
        out.innerHTML = `<table class="tbl"><tr><th></th><th>Écart sup.</th><th>Écart inf.</th><th>Maxi</th><th>Mini</th></tr>
          <tr><td>Alésage Ø${fmt(d)} ${H.value}</td><td>${um(r.H.up)}</td><td>${um(r.H.low)}</td><td>${mm(r.H.up)}</td><td>${mm(r.H.low)}</td></tr>
          <tr><td>Arbre Ø${fmt(d)} ${S.value}</td><td>${um(r.S.up)}</td><td>${um(r.S.low)}</td><td>${mm(r.S.up)}</td><td>${mm(r.S.low)}</td></tr></table>
          <p><b>${r.type}</b> — ${r.jmin >= 0 ? `jeu de ${fmt(r.jmin, 1)} à ${fmt(r.jmax, 1)} µm` : r.jmax <= 0 ? `serrage de ${fmt(-r.jmax, 1)} à ${fmt(-r.jmin, 1)} µm` : `de ${fmt(-r.jmin, 1)} µm de serrage à ${fmt(r.jmax, 1)} µm de jeu`}</p>`;
      };
      for (const i of [D, H, S]) i.addEventListener('input', calc), i.addEventListener('change', calc);
      body.append(F('Diamètre nominal', D, 'mm'), F('Alésage', H), F('Arbre', S),
        E('div', { class: 'chips' }, ...COMMON_FITS.map(([h, s, t]) => E('button', { class: 'chip', title: t, onclick: () => { H.value = h; S.value = s; calc(); } }, `${h}/${s}`))),
        E('div', { class: 'note' }, ...COMMON_FITS.map(([h, s, t]) => E('div', {}, E('b', {}, `${h}/${s}`), ' : ' + t))));
      calc();
    } else if (tab === 'bend') {
      const a = num(50), b = num(30), A = num(90), e = num(2), Ri = num(2), K = num(0.33);
      const calc = () => {
        const r = bend({ a: evalNum(a.value) || 0, b: evalNum(b.value) || 0, A: evalNum(A.value) || 90, e: evalNum(e.value) || 1, Ri: evalNum(Ri.value) || 0, K: evalNum(K.value) ?? 0.33 });
        out.innerHTML = `<table class="tbl"><tr><td>Longueur développée</td><td><b>${fmt(r.L, 2)} mm</b></td></tr><tr><td>Longueur d'arc (BA)</td><td>${fmt(r.ba, 2)} mm</td></tr><tr><td>Retrait extérieur (SB)</td><td>${fmt(r.sb, 2)} mm</td></tr><tr><td>Déduction de pli (BD)</td><td>${fmt(r.bd, 2)} mm</td></tr></table>`;
      };
      for (const i of [a, b, A, e, Ri, K]) i.addEventListener('input', calc);
      body.append(F('Aile 1 (cote extérieure)', a, 'mm'), F('Aile 2 (cote extérieure)', b, 'mm'), F('Angle de pliage', A, '°'), F('Épaisseur', e, 'mm'), F('Rayon intérieur', Ri, 'mm'), F('Facteur K', K),
        E('div', { class: 'note' }, 'Facteur K usuel : 0,33 en pliage en V acier (Ri ≈ e), 0,4 à 0,45 pour Ri ≈ 2e, 0,5 pour les grands rayons. Pour plusieurs plis, utilisez « Tôle pliée » (onglet Chaudronnerie).'));
      calc();
    } else if (tab === 'mass') {
      const shapes = ['Tôle / plat (L × l × e)', 'Tube rond (De × e × L)', 'Rond plein (D × L)', 'Tube carré (a × e × L)', 'Carré plein (a × L)'];
      const sh = sel(shapes, shapes[0]), mat = sel(Object.keys(MATERIALS), 'Acier');
      const x = num(1000), y = num(500), z = num(3);
      const calc = () => {
        const X = evalNum(x.value) || 0, Y = evalNum(y.value) || 0, Zz = evalNum(z.value) || 0, i = shapes.indexOf(sh.value);
        let A = 0, Lm = 0; // section mm² et longueur
        if (i === 0) { A = Y * Zz; Lm = X; }
        if (i === 1) { A = Math.PI / 4 * (X * X - (X - 2 * Y) ** 2); Lm = Zz; }
        if (i === 2) { A = Math.PI / 4 * X * X; Lm = Y; }
        if (i === 3) { A = X * X - (X - 2 * Y) ** 2; Lm = Zz; }
        if (i === 4) { A = X * X; Lm = Y; }
        const rho = MATERIALS[mat.value].density;
        const kgm = A * rho / 1000;
        out.innerHTML = `<table class="tbl"><tr><td>Masse</td><td><b>${fmt(kgm * Lm / 1000, 3)} kg</b></td></tr><tr><td>Masse linéique</td><td>${fmt(kgm, 3)} kg/m</td></tr>${i === 0 ? `<tr><td>Masse surfacique</td><td>${fmt(Zz * rho, 2)} kg/m²</td></tr>` : ''}</table>`;
      };
      const labels = () => { const i = shapes.indexOf(sh.value); return [['Longueur L', 'Largeur l', 'Épaisseur e'], ['Ø extérieur', 'Épaisseur', 'Longueur'], ['Diamètre', 'Longueur', '—'], ['Côté a', 'Épaisseur', 'Longueur'], ['Côté a', 'Longueur', '—']][i]; };
      const fx = F('', x, 'mm'), fy = F('', y, 'mm'), fz = F('', z, 'mm');
      const relabel = () => { const l = labels(); fx.firstChild.textContent = l[0]; fy.firstChild.textContent = l[1]; fz.firstChild.textContent = l[2]; fz.style.display = l[2] === '—' ? 'none' : ''; calc(); };
      for (const i of [x, y, z]) i.addEventListener('input', calc);
      sh.addEventListener('change', relabel); mat.addEventListener('change', calc);
      body.append(F('Forme', sh), F('Matériau', mat), fx, fy, fz);
      relabel();
    } else if (tab === 'cut') {
      const op = sel(['Fraisage', 'Perçage', 'Tournage'], 'Fraisage'), mat = sel(Object.keys(CUT_MATERIALS), 'Acier doux (S235, C35)'), tool = sel(['Carbure', 'Acier rapide (HSS)'], 'Carbure');
      const D = num(10), z = num(3), f = num(0.15);
      const calc = () => {
        const m = CUT_MATERIALS[mat.value], d = evalNum(D.value) || 1, carb = tool.value === 'Carbure';
        let vc = op.value === 'Tournage' ? (carb ? m.turn : m.hss * 1.2) : carb ? m.carb : m.hss;
        if (op.value === 'Perçage') vc *= 0.7;
        const N = (1000 * vc) / (Math.PI * d);
        let vf, extra;
        if (op.value === 'Fraisage') { const fz = fzFor(d, mat.value); vf = fz * (evalNum(z.value) || 1) * N; extra = `<tr><td>Avance par dent fz</td><td>${fmt(fz, 3)} mm/dent</td></tr>`; }
        else if (op.value === 'Perçage') { const fr = Math.max(0.03, d * 0.015 * (/Aluminium|Plastiques/.test(mat.value) ? 1.5 : 1)); vf = fr * N; extra = `<tr><td>Avance par tour</td><td>${fmt(fr, 3)} mm/tr</td></tr>`; }
        else { const fr = evalNum(f.value) || 0.1; vf = fr * N; extra = `<tr><td>Avance par tour</td><td>${fmt(fr, 3)} mm/tr</td></tr>`; }
        out.innerHTML = `<table class="tbl"><tr><td>Vitesse de coupe Vc</td><td>${fmt(vc, 0)} m/min</td></tr><tr><td><b>Vitesse de rotation N</b></td><td><b>${fmt(N, 0)} tr/min</b></td></tr>${extra}<tr><td><b>Vitesse d'avance Vf</b></td><td><b>${fmt(vf, 0)} mm/min</b></td></tr></table><div class="note">Valeurs de départ indicatives (outil revêtu, arrosage). Ajustez selon le fabricant d'outil, la rigidité de la machine et l'état de surface visé.</div>`;
        fz_.style.display = op.value === 'Fraisage' ? '' : 'none'; ff_.style.display = op.value === 'Tournage' ? '' : 'none';
        fD_.firstChild.textContent = op.value === 'Tournage' ? 'Ø de la pièce' : 'Ø de l\'outil';
      };
      const fD_ = F('Ø de l\'outil', D, 'mm'), fz_ = F('Nombre de dents', z), ff_ = F('Avance par tour', f, 'mm/tr');
      for (const i of [op, mat, tool, D, z, f]) { i.addEventListener('input', calc); i.addEventListener('change', calc); }
      body.append(F('Opération', op), F('Matière usinée', mat), F('Outil', tool), fD_, fz_, ff_);
      calc();
    } else if (tab === 'beam') {
      const fams = LIBRARY.filter((f) => /Profilés|Tuyauterie/.test(f.cat) && f.extra.some((x) => x.k === 'axis'));
      const fam = sel(fams.map((f) => f.name), fams[0].name), size = E('select', {}), axis = sel(['Fort (hauteur verticale)', 'Faible'], 'Fort (hauteur verticale)');
      const mat = sel(Object.keys(STEELS), 'Acier S235'), cas = sel(Object.keys(BEAM_CASES), Object.keys(BEAM_CASES)[0]);
      const L = num(3000), Fk = num(5), q = num(0), lim = sel(['L/200', 'L/300', 'L/500'], 'L/300');
      const pp = E('input', { type: 'checkbox', checked: true });
      const fillSizes = () => { const f = fams.find((x) => x.name === fam.value); size.innerHTML = ''; for (const k of Object.keys(f.sizes)) size.append(E('option', { value: k, selected: k === f.defSize }, k)); };
      const calc = () => {
        const f = fams.find((x) => x.name === fam.value);
        const g = this.model.baseGeometry({ type: 'part', params: { ...partDefaults(f, size.value), L: 10, axis: 'Z' } });
        const s = sectionProps(g, 10), M_ = STEELS[mat.value];
        const strong = axis.value.startsWith('Fort');
        const I = strong ? s.Ix : s.Iy, v = strong ? s.vy : s.vx, W = I / v;
        const Lm = evalNum(L.value) || 1, F_ = (evalNum(Fk.value) || 0) * 1000, qn = (evalNum(q.value) || 0) + (pp.checked ? (s.A * M_.rho * 9.81) / 1e6 : 0); // N/mm
        const c = BEAM_CASES[cas.value];
        const M = c.M(F_, qn, Lm), fl = c.f(F_, qn, Lm, M_.E * I), sig = M / W;
        const flim = Lm / +lim.value.split('/')[1];
        const okS = sig <= M_.fy, okF = fl <= flim;
        out.innerHTML = `<table class="tbl">
          <tr><td>Section A</td><td>${fmt(s.A / 100, 2)} cm²</td><td>Masse linéique</td><td>${fmt((s.A * M_.rho) / 1000, 2)} kg/m</td></tr>
          <tr><td>Inertie I</td><td>${fmt(I / 1e4, 1)} cm⁴</td><td>Module W</td><td>${fmt(W / 1000, 1)} cm³</td></tr>
          <tr><td>Moment maxi</td><td>${fmt(M / 1e6, 2)} kN·m</td><td>Charge répartie totale</td><td>${fmt(qn, 3)} kN/m</td></tr>
          <tr><td><b>Contrainte maxi</b></td><td><b>${fmt(sig, 1)} MPa</b> / fy ${M_.fy}</td><td>${okS ? '✅' : '❌'} Taux</td><td><b>${fmt((100 * sig) / M_.fy, 0)} %</b></td></tr>
          <tr><td><b>Flèche maxi</b></td><td><b>${fmt(fl, 2)} mm</b></td><td>${okF ? '✅' : '❌'} Limite ${lim.value}</td><td>${fmt(flim, 1)} mm</td></tr></table>
          <div class="note">Vérification élastique simplifiée (sans déversement, flambement, ni coefficients de pondération). Section calculée sur la géométrie du profilé. Pour un ouvrage, faites valider par un bureau d'études.</div>`;
      };
      fam.addEventListener('change', () => { fillSizes(); calc(); });
      for (const i of [size, axis, mat, cas, L, Fk, q, lim, pp]) { i.addEventListener('input', calc); i.addEventListener('change', calc); }
      fillSizes();
      body.append(F('Profilé', fam), F('Taille', size), F('Axe de flexion', axis), F('Matériau', mat), F('Cas de charge', cas), F('Portée L', L, 'mm'), F('Charge ponctuelle F', Fk, 'kN'), F('Charge répartie q', q, 'kN/m'), F('Poids propre inclus', pp), F('Flèche admissible', lim));
      calc();
    } else if (tab === 'joint') {
      const size = sel(Object.keys(BOLT_AS), 'M12'), cls = sel(Object.keys(BOLT_CLASSES), '8.8'), n = num(4), pl = sel(['1', '2'], '1'), V = num(40), N = num(0);
      const st = sel(Object.keys(STEELS).filter((k) => k.startsWith('Acier')), 'Acier S235'), a = num(4), Lw = num(100), Fw = num(50);
      const res1 = E('div'), res2 = E('div');
      const calc = () => {
        const b = boltCheck({ size: size.value, cls: cls.value, n: Math.max(1, evalNum(n.value) || 1), planes: +pl.value, V: evalNum(V.value) || 0, N: evalNum(N.value) || 0 });
        res1.innerHTML = `<table class="tbl"><tr><td>Résistance au cisaillement / boulon</td><td>${fmt(b.FvRd, 1)} kN</td><td>Effort par boulon</td><td>${fmt(b.Fv, 1)} kN</td></tr><tr><td>Résistance à la traction / boulon</td><td>${fmt(b.FtRd, 1)} kN</td><td>Effort par boulon</td><td>${fmt(b.Ft, 1)} kN</td></tr><tr><td><b>Taux d'utilisation</b></td><td colspan="3"><b>${b.ratio <= 1 && b.ratioT <= 1 ? '✅' : '❌'} ${fmt(b.ratio * 100, 0)} %</b> (cisaillement + traction combinés)</td></tr></table>`;
        const w = weldCheck({ steel: st.value, a: evalNum(a.value) || 1, L: evalNum(Lw.value) || 1, F: evalNum(Fw.value) || 0 });
        res2.innerHTML = `<table class="tbl"><tr><td>Résistance du cordon</td><td>${fmt(w.fvw, 0)} MPa</td><td>Effort admissible</td><td>${fmt(w.FwRd, 1)} kN</td></tr><tr><td><b>Taux d'utilisation</b></td><td colspan="3"><b>${w.ratio <= 1 ? '✅' : '❌'} ${fmt(w.ratio * 100, 0)} %</b></td></tr></table>`;
      };
      for (const i of [size, cls, n, pl, V, N, st, a, Lw, Fw]) { i.addEventListener('input', calc); i.addEventListener('change', calc); }
      body.append(E('h4', {}, 'Assemblage boulonné (cisaillement / traction)'), F('Diamètre', size), F('Classe', cls), F('Nombre de boulons', n), F('Plans de cisaillement', pl), F('Effort tranchant total V', V, 'kN'), F('Effort de traction total N', N, 'kN'), res1,
        E('h4', {}, 'Cordon de soudure d\'angle (méthode simplifiée)'), F('Acier', st), F('Gorge a', a, 'mm'), F('Longueur utile', Lw, 'mm'), F('Effort', Fw, 'kN'), res2,
        E('div', { class: 'note' }, 'Méthodes simplifiées de l\'Eurocode 3 (EN 1993-1-8), γM2 = 1,25, valeurs de calcul (efforts déjà pondérés). La pression diamétrale et le poinçonnement ne sont pas vérifiés.'));
      calc();
    } else if (tab === 'trans') {
      const D = num(200), d = num(100), C = num(500), N1 = num(1450);
      const p = num(12.7), z1 = num(17), z2 = num(34), Cc = num(400);
      const m = num(2), g1 = num(20), g2 = num(60);
      const r1 = E('div'), r2 = E('div'), r3 = E('div');
      const calc = () => {
        const Dv = evalNum(D.value) || 1, dv = evalNum(d.value) || 1, Cv = evalNum(C.value) || 1, n1 = evalNum(N1.value) || 0;
        r1.innerHTML = `<table class="tbl"><tr><td>Longueur primitive de courroie</td><td><b>${fmt(beltLength(Dv, dv, Cv), 0)} mm</b></td></tr><tr><td>Rapport</td><td>${fmt(Dv / dv, 3)}</td></tr><tr><td>Vitesse de la poulie menée</td><td>${fmt((n1 * dv) / Dv, 0)} tr/min</td></tr><tr><td>Vitesse linéaire de courroie</td><td>${fmt((Math.PI * dv * n1) / 60000, 2)} m/s</td></tr></table>`;
        const ch = chainLinks(evalNum(p.value) || 1, evalNum(z1.value) || 1, evalNum(z2.value) || 1, evalNum(Cc.value) || 1);
        r2.innerHTML = `<table class="tbl"><tr><td>Nombre de maillons (pair)</td><td><b>${ch.n}</b> (calcul ${fmt(ch.X, 2)})</td></tr><tr><td>Rapport</td><td>${fmt((evalNum(z2.value) || 1) / (evalNum(z1.value) || 1), 3)}</td></tr></table>`;
        const mv = evalNum(m.value) || 1, a1 = evalNum(g1.value) || 1, a2 = evalNum(g2.value) || 1;
        r3.innerHTML = `<table class="tbl"><tr><td>Entraxe</td><td><b>${fmt((mv * (a1 + a2)) / 2, 2)} mm</b></td></tr><tr><td>Rapport de réduction</td><td>${fmt(a2 / a1, 3)}</td></tr><tr><td>Ø primitifs</td><td>${fmt(mv * a1, 1)} / ${fmt(mv * a2, 1)} mm</td></tr></table>`;
      };
      for (const i of [D, d, C, N1, p, z1, z2, Cc, m, g1, g2]) i.addEventListener('input', calc);
      body.append(E('h4', {}, 'Courroie (2 poulies)'), F('Ø grande poulie', D, 'mm'), F('Ø petite poulie (motrice)', d, 'mm'), F('Entraxe', C, 'mm'), F('Vitesse moteur', N1, 'tr/min'), r1,
        E('h4', {}, 'Chaîne à rouleaux'), F('Pas (12,7 = 08B / ½")', p, 'mm'), F('Dents pignon', z1), F('Dents couronne', z2), F('Entraxe', Cc, 'mm'), r2,
        E('h4', {}, 'Engrenages droits'), F('Module', m), F('Dents pignon', g1), F('Dents roue', g2), r3);
      calc();
    } else if (tab === 'bearing') {
      const C = num(13.5), P = num(2), N = num(1500), typ = sel(['Billes', 'Rouleaux'], 'Billes');
      const dw = num(2), De = num(20), na = num(8), gm = sel(Object.keys(SPRING_G), Object.keys(SPRING_G)[0]), fl = num(5);
      const r1 = E('div'), r2 = E('div');
      const calc = () => {
        const b = bearingLife(evalNum(C.value) || 1, evalNum(P.value) || 1, evalNum(N.value) || 1, typ.value === 'Rouleaux');
        r1.innerHTML = `<table class="tbl"><tr><td>Durée L10</td><td>${fmt(b.L10, 1)} millions de tours</td></tr><tr><td><b>Durée en heures</b></td><td><b>${fmt(b.hours, 0)} h</b> (≈ ${fmt(b.hours / 2000, 1)} ans à 8 h/jour)</td></tr></table><div class="note">C = charge dynamique de base du catalogue fabricant (ex. 6204 : C ≈ 13,5 kN). P = charge équivalente.</div>`;
        const d = evalNum(dw.value) || 0.1, Dm = (evalNum(De.value) || 1) - d, n = evalNum(na.value) || 1;
        const k = (SPRING_G[gm.value] * d ** 4) / (8 * Dm ** 3 * n);
        const f = evalNum(fl.value) || 0, Fs = k * f, tau = (8 * Fs * Dm) / (Math.PI * d ** 3) * (1 + 0.5 * d / Dm);
        r2.innerHTML = `<table class="tbl"><tr><td><b>Raideur k</b></td><td><b>${fmt(k, 2)} N/mm</b></td></tr><tr><td>Effort à ${fmt(f, 1)} mm</td><td>${fmt(Fs, 1)} N</td></tr><tr><td>Contrainte de torsion</td><td>${fmt(tau, 0)} MPa</td></tr></table>`;
      };
      for (const i of [C, P, N, typ, dw, De, na, gm, fl]) { i.addEventListener('input', calc); i.addEventListener('change', calc); }
      body.append(E('h4', {}, 'Durée de vie d\'un roulement (ISO 281)'), F('Charge dynamique C', C, 'kN'), F('Charge équivalente P', P, 'kN'), F('Vitesse', N, 'tr/min'), F('Type', typ), r1,
        E('h4', {}, 'Ressort de compression'), F('Ø du fil', dw, 'mm'), F('Ø extérieur', De, 'mm'), F('Spires actives', na), F('Matériau', gm), F('Flèche', fl, 'mm'), r2);
      calc();
    } else if (tab === 'fluid') {
      const D = num(50), d = num(20), p = num(6), Q = num(20), c = num(200), cyc = num(10);
      const r1 = E('div');
      const calc = () => {
        const Dv = evalNum(D.value) || 1, dv = Math.min(evalNum(d.value) || 0, Dv * 0.99), pv = evalNum(p.value) || 0, Qv = evalNum(Q.value) || 0, cv = evalNum(c.value) || 0;
        const S = Math.PI * Dv * Dv / 4, S2 = S - Math.PI * dv * dv / 4;
        const air = ((S + S2) * cv / 1e6) * (pv + 1.013); // litres normaux par cycle aller-retour
        out.innerHTML = '';
        r1.innerHTML = `<table class="tbl"><tr><td><b>Poussée (sortie)</b></td><td><b>${fmt(pv * 0.1 * S / 1000, 2)} kN</b> (${fmt(pv * 0.1 * S / 9.81, 0)} kg)</td></tr><tr><td><b>Traction (rentrée)</b></td><td><b>${fmt(pv * 0.1 * S2 / 1000, 2)} kN</b></td></tr>
          <tr><td>Vitesse de sortie (hydraulique, débit Q)</td><td>${fmt((Qv * 1e6 / 60) / S / 1000, 3)} m/s</td></tr><tr><td>Vitesse de rentrée</td><td>${fmt((Qv * 1e6 / 60) / S2 / 1000, 3)} m/s</td></tr>
          <tr><td>Puissance hydraulique p·Q</td><td>${fmt((pv * Qv) / 600, 2)} kW</td></tr>
          <tr><td>Consommation d'air (pneumatique)</td><td>${fmt(air, 2)} NL/cycle — ${fmt(air * (evalNum(cyc.value) || 0), 1)} NL/min</td></tr></table>
          <div class="note">Efforts théoriques (sans frottement : comptez 85 à 90 % en pratique). Consommation d'air en litres normaux pour un aller-retour.</div>`;
      };
      for (const i of [D, d, p, Q, c, cyc]) i.addEventListener('input', calc);
      body.append(F('Alésage du vérin', D, 'mm'), F('Ø de la tige', d, 'mm'), F('Pression', p, 'bar'), F('Débit (hydraulique)', Q, 'L/min'), F('Course', c, 'mm'), F('Cycles par minute', cyc), r1,
        E('div', { class: 'btnrow' }, E('button', { class: 'btn', onclick: () => { this.closeModal(); this.libSearch('vérin'); } }, 'Vérins ISO 15552 au catalogue'), E('button', { class: 'btn', onclick: () => { this.closeModal(); this.libSearch('moteur'); } }, 'Moteurs IEC au catalogue')));
      calc();
    } else {
      const rows = Object.entries(THREADS).map(([k, v]) => `<tr><td><b>${k}</b></td><td>${fmt(v[0], 2)}</td><td>${fmt(v[1], 1)}</td><td>${fmt(v[2], 1)}</td><td>${fmt(v[3], 1)} × ${fmt(v[4], 1)}</td><td>${v[5]}</td></tr>`).join('');
      out.innerHTML = `<table class="tbl"><tr><th>Filet</th><th>Pas</th><th>Ø foret taraudage</th><th>Ø passage (moyen)</th><th>Lamage CHC Ø × prof.</th><th>Couple 8.8 (N·m)*</th></tr>${rows}</table><div class="note">* Couple de serrage indicatif pour vis classe 8.8, frottement µ ≈ 0,14 (lubrification légère). Vérifiez selon votre application.</div>`;
    }
    this.modal(E('div', { style: 'min-width:520px' }, E('h2', { html: icon('calc', 22) + 'Calculateurs d\'atelier' }), head, body, out,
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Fermer'))));
  }

  // ================================================================ guides pas à pas
  tutorialsDialog() {
    const T = this.tutorials();
    this.modal(E('div', { style: 'max-width:640px' }, E('h2', { html: icon('play', 22) + 'Guides pas à pas' }),
      E('p', { style: 'color:var(--muted);margin-top:0' }, 'Choisissez un guide : une bulle vous accompagne étape par étape, avec un bouton « Faire pour moi » à chaque étape.'),
      E('div', { class: 'exp-grid' }, ...T.map((t, i) => E('button', { onclick: () => { this.closeModal(); this.startCoach(i); }, html: icon(t.ic, 26) + `<div><b>${t.title}</b><small>${t.sub}</small></div>` }))),
      E('div', { class: 'actions' }, E('button', { class: 'btn', onclick: () => this.closeModal() }, 'Fermer'))));
  }

  tutorials() {
    const sel = (type, kind) => () => { const o = this.model.objects.find((x) => x.type === type && (!kind || x.params.kind === kind)); if (o) this.select([o.id]); return o; };
    return [
      { title: 'Ma première pièce', sub: 'esquisse → volume → perçage → plan', ic: 'sketch', steps: [
        ['Créez une esquisse sur le plan du dessus.', () => { this.newSketchDialog(); }],
        ['Tapez R, puis « 0;0 » Entrée et « 120;80 » Entrée : un rectangle de 120 × 80 est dessiné.', () => { if (this.mode !== 'sketch') this.createSketch(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), Z.clone(), new THREE.Vector3(), null, 'Esquisse'); this.editor.obj.params.entities.push({ type: 'rect', x: -60, y: -40, w: 120, h: 80 }); this.sketchChanged(); this.fitView(); }],
        ['Cliquez « Extruder » : la plaque prend du volume. Réglez la hauteur dans le panneau de droite ou directement dans la bulle au-dessus de la pièce.', () => { this.fromSketch('extrude'); }],
        ['Perçage : touche H, choisissez « Passage M8 », puis cliquez sur le dessus de la plaque.', () => { this.holeDialog(); }],
        ['Mise en plan : onglet « Plan & Export » → « Plan 2D ». Choisissez le format, remplissez le cartouche et téléchargez le DXF ou le PDF.', () => { this.drawingDialog(); }],
      ] },
      { title: 'Tôle pliée en U', sub: 'profil, facteur K, développé DXF', ic: 'bent', steps: [
        ['Onglet « Chaudronnerie » → « Tôle pliée », puis cliquez dans la vue.', () => { this.tab = 'sheet'; this.renderRibbon(); const p = SHEET_DEFAULTS('bent'); const o = this.model.add({ type: 'sheet', params: p }); this.commit(); this.select([o.id]); this.fitView(); }],
        ['Le profil s\'écrit « longueur;angle;longueur… » : 40;90;80;90;40 donne un U. Modifiez-le dans la bulle ou le panneau de droite.', sel('sheet', 'bent')],
        ['Réglez l\'épaisseur, le rayon intérieur et le facteur K (0,33 en pliage en V courant).', sel('sheet', 'bent')],
        ['Cliquez « Développé à plat (DXF) » : vous obtenez le flan avec les lignes de pli, prêt pour la découpe.', () => { const o = sel('sheet', 'bent')(); if (o) this.flatDialog(o); }],
      ] },
      { title: 'Carré-rond de ventilation', sub: 'transition et son développé', ic: 'hopper', steps: [
        ['Onglet « Chaudronnerie » → « Carré-rond / trémie ».', () => { this.tab = 'sheet'; this.renderRibbon(); const o = this.model.add({ type: 'sheet', params: SHEET_DEFAULTS('transition') }); this.commit(); this.select([o.id]); this.fitView(); }],
        ['Saisissez le rectangle du bas, le Ø du haut et la hauteur. Le décalage permet une transition excentrée.', sel('sheet', 'transition')],
        ['« Développé (DXF) » : le gabarit avec les lignes de roulage (en rouge) et le joint au milieu d\'un côté.', () => { const o = sel('sheet', 'transition')(); if (o) this.flatDialog(o); }],
      ] },
      { title: 'Assemblage vissé', sub: 'perçages lamés + vis CHC automatiques', ic: 'screw', steps: [
        ['Posez un bloc (onglet Créer → Bloc, clic dans la vue).', () => { const o = this.model.add({ type: 'box', params: { l: 120, w: 80, h: 20, r: 0 } }); this.commit(); this.select([o.id]); this.fitView(); }],
        ['Touche H → « Passage M8 », type « Lamage », puis cliquez 2 ou 3 fois sur le dessus du bloc.', () => { this.holeDialog(); }],
        ['Catalogue → « Vis CHC » → M8 : approchez la souris d\'un trou, la vis s\'y place toute seule (🎯).', () => { this.libSearch('chc M8'); }],
        ['Outils → Nomenclature : la liste des pièces avec quantités et masses, exportable vers Excel.', () => { this.bomDialog(); }],
      ] },
      { title: 'Plan professionnel', sub: 'format, échelle, cartouche, nomenclature', ic: 'drawing', steps: [
        ['Chargez l\'exemple (ou votre projet).', () => { if (!this.model.objects.length) this.loadExample(); }],
        ['Plan & Export → « Plan 2D » : choisissez A4 / A3…, l\'échelle normalisée est calculée automatiquement.', () => { this.drawingDialog(); }],
        ['Remplissez société, dessinateur, indice : ils sont mémorisés pour vos prochains plans. Téléchargez en DXF ou imprimez en PDF.', () => {}],
      ] },
    ];
  }

  startCoach(i) {
    const t = this.tutorials()[i];
    let k = 0;
    $('#coach')?.remove();
    const box = E('div', { id: 'coach' });
    const draw = () => {
      const [txt, act] = t.steps[k];
      box.innerHTML = '';
      box.append(E('div', { class: 'coach-h' }, E('b', {}, t.title), E('span', {}, `Étape ${k + 1} / ${t.steps.length}`)), E('p', {}, txt),
        E('div', { class: 'btnrow' },
          E('button', { class: 'btn', onclick: () => { try { act(); } catch (e) { this.toast(e.message, true); } } }, '✨ Faire pour moi'),
          k > 0 ? E('button', { class: 'btn', onclick: () => { k--; draw(); } }, '◀') : null,
          k < t.steps.length - 1 ? E('button', { class: 'btn primary', onclick: () => { k++; draw(); } }, 'Suivant ▶') : E('button', { class: 'btn primary', onclick: () => box.remove() }, 'Terminer ✓'),
          E('button', { class: 'btn', title: 'Fermer le guide', onclick: () => box.remove() }, '✕')));
    };
    draw();
    $('#viewport').append(box);
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

  exportBodies(opts = {}) {
    const ids = this.selection.length ? this.selObjs().filter((o) => !o.role && this.model.isSolid(o)).map((o) => o.id) : null;
    const b = this.model.worldBodies(ids && ids.length ? ids : null, opts);
    if (!b.length) this.toast('Rien à exporter : aucun solide visible', true);
    return b;
  }

  async export3D(fmtName) {
    const b = this.exportBodies({ simplifyThreads: fmtName === 'step' });
    if (!b.length) return;
    const n = safeName(this.selection.length === 1 ? this.model.displayName(this.selObjs()[0]) : this.docName);
    try {
      switch (fmtName) {
        case 'step': {
          const txt = EX.toSTEP(b, n + '.step');
          if (txt.length > 8e6 && b.length > 1) {
            // très gros fichier : proposer un STEP par pièce (plus fiable pour tous les logiciels)
            const one = async () => {
              const { zipSync, strToU8 } = await import('three/addons/libs/fflate.module.js');
              const files = {}, used = new Map();
              for (const body of b) { let base = safeName(body.name); const k = used.get(base) || 0; used.set(base, k + 1); if (k) base += '_' + (k + 1); files[base + '.step'] = strToU8(EX.toSTEP([body], base + '.step')); }
              download(new Blob([zipSync(files)]), n + '_STEP_par_piece.zip', 'application/zip');
              this.closeModal();
            };
            this.modal(E('div', { style: 'max-width:520px' }, E('h2', { html: icon('export', 22) + 'Export STEP volumineux' }),
              E('p', {}, `L'assemblage fait ${fmt(txt.length / 1e6, 1)} Mo en STEP (${b.length} pièces). Au-delà d'environ 10 Mo, certains logiciels (dont FormaCAD lui-même) peuvent ne pas le relire.`),
              E('div', { class: 'actions' },
                E('button', { class: 'btn', onclick: () => { download(txt, n + '.step', 'application/step'); this.closeModal(); } }, 'Un seul fichier'),
                E('button', { class: 'btn primary', onclick: one }, 'Un STEP par pièce (ZIP) – recommandé'))));
            break;
          }
          download(txt, n + '.step', 'application/step');
          if (this.model.objects.some((o) => String(o.params?.thread || '').startsWith('Réel'))) this.toast('STEP : filetages exportés en version simplifiée (standard pour l\'échange CAO)');
          break;
        }
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
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('formacad.cartouche') || '{}'); } catch { /* rien */ }
    const ids = bodies.map((b) => b.obj.id);
    const bomAll = this.bom().filter((r) => r.objs.some((o) => ids.includes(o.id)));
    const mats = {};
    for (const b of bodies) mats[b.obj.material] = (mats[b.obj.material] || 0) + 1;
    const mainMat = Object.entries(mats).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
    const totalMass = bomAll.reduce((a, r) => a + r.total, 0);
    const opts = {
      hidden: true, dims: true, title: this.docName, paper: saved.paper || 'A3', withBom: bomAll.length > 1, withWelds: true,
      fields: { societe: saved.societe || '', auteur: saved.auteur || '', indice: saved.indice || 'A', matiere: Object.keys(mats).length > 1 ? 'Voir nomenclature' : mainMat, date: new Date().toLocaleDateString('fr-FR'), masse: `Masse : ${totalMass >= 1000 ? fmt(totalMass / 1000, 2) + ' kg' : fmt(totalMass, 0) + ' g'}` },
    };
    const welds = this.model.objects.filter((o) => o.type === 'weld' && this.model.isVisible(o)).map((o) => ({ a: o.params.a, L: o.params.L, mid: new THREE.Vector3(o.params.L / 2, 0, 0).applyMatrix4(this.model.worldMatrix(o)) }));
    const full = () => ({ ...opts, bom: opts.withBom ? bomAll : null, welds: opts.withWelds ? welds : null });
    const prev = E('div', { class: 'drawing-preview' });
    const scaleInfo = E('b', {}, '');
    let layout = null;
    const redraw = () => {
      if (!layout) return;
      const d = EX.drawingPrims(layout, full());
      scaleInfo.textContent = d.paper ? `${d.paper} paysage – échelle ${EX.scaleLabel(d.scale)}` : 'Échelle 1:1 (sans cadre)';
      prev.innerHTML = EX.drawingToSvg(layout, { ...full(), forScreen: true });
    };
    const update = () => {
      const names = Object.keys(views).filter((v) => views[v]);
      if (!names.length) { prev.innerHTML = ''; layout = null; return; }
      prev.innerHTML = '<div style="padding:20px;color:#888">Calcul des vues…</div>';
      setTimeout(() => { layout = EX.layoutDrawing(bodies, names, { hidden: opts.hidden }); redraw(); }, 20);
    };
    const persist = () => { try { localStorage.setItem('formacad.cartouche', JSON.stringify({ paper: opts.paper, societe: opts.fields.societe, auteur: opts.fields.auteur, indice: opts.fields.indice })); } catch { /* rien */ } };
    const cb = (label, obj, k, full = false) => { const c = E('input', { type: 'checkbox', checked: obj[k], onchange: () => { obj[k] = c.checked; full ? update() : redraw(); } }); return E('label', { class: 'field', style: 'cursor:pointer' }, c, E('span', { style: 'flex:1' }, label)); };
    const txt = (label, obj, k) => { const i = E('input', { type: 'text', value: obj[k] || '', style: 'width:100%', onchange: () => { obj[k] = i.value; persist(); redraw(); } }); return E('div', { class: 'f2' }, E('span', {}, label), i); };
    const paper = E('select', { onchange: () => { opts.paper = paper.value; persist(); redraw(); } }, ...['A4', 'A3', 'A2', 'A1', 'A0', 'Aucun'].map((p) => E('option', { value: p, selected: p === opts.paper }, p === 'Aucun' ? 'Sans cadre (1:1)' : p + ' paysage')));
    const n = safeName(this.docName);
    const box = E('div', {},
      E('h2', { html: icon('drawing', 22) + 'Mise en plan' }),
      E('div', { class: 'drawing-wrap' }, prev, E('div', { class: 'drawing-opts' },
        E('div', { class: 'field' }, E('label', {}, 'Format'), paper), E('div', { class: 'note', style: 'margin-bottom:6px' }, scaleInfo),
        E('h4', {}, 'Vues'), ...Object.keys(views).map((v) => cb(v, views, v, true)),
        E('h4', {}, 'Options'), cb('Lignes cachées', opts, 'hidden', true), cb('Cotes d\'encombrement', opts, 'dims'), cb('Nomenclature', opts, 'withBom'), welds.length ? cb(`Symboles de soudure (${welds.length})`, opts, 'withWelds') : null,
        E('h4', {}, 'Cartouche'), txt('Titre', opts, 'title'), txt('Société', opts.fields, 'societe'), txt('Dessiné par', opts.fields, 'auteur'), txt('Matière', opts.fields, 'matiere'), txt('Indice', opts.fields, 'indice'),
        E('button', { class: 'btn big primary', style: 'margin-top:10px', onclick: () => { if (layout) { download(EX.drawingToDxf(layout, full()), n + '_plan.dxf', 'application/dxf'); this.toast('Plan exporté en DXF (échelle papier, cotes en vraie grandeur)'); } }, html: icon('export', 16) + 'Télécharger DXF' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => { if (layout) this.printSvg(EX.drawingToSvg(layout, full()), opts.paper); }, html: icon('drawing', 16) + 'Imprimer / PDF' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => { if (layout) download(EX.drawingToSvg(layout, full()), n + '_plan.svg', 'image/svg+xml'); }, html: icon('export', 16) + 'Télécharger SVG' }),
        E('button', { class: 'btn big', style: 'margin-top:6px', onclick: () => this.closeModal() }, 'Fermer'))));
    this.modal(box);
    update();
  }

  printSvg(svg, paper = 'A4') {
    const w = window.open('', '_blank');
    if (!w) { this.toast('Impression indisponible ici : téléchargement du plan en SVG (imprimable)'); return download(svg, safeName(this.docName) + '_plan.svg', 'image/svg+xml'); }
    w.document.write(`<!doctype html><html><head><title>${esc(this.docName)} – plan</title><style>@page{size:${EX.PAPERS[paper] ? paper : 'A4'} landscape;margin:0}html,body{margin:0}svg{width:100%;height:auto;display:block}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
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
      ${k('Ctrl+K', 'Rechercher n\'importe quelle commande ou pièce du catalogue')}${k('Clic droit', 'Menu des actions possibles à cet endroit')}
      ${k('A', 'Contact face contre face')}${k('X', 'Vue éclatée')}${k('Q', 'Isoler la sélection')}${k('W', 'Cordon de soudure')}${k('C', 'Calculateurs d\'atelier')}
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
