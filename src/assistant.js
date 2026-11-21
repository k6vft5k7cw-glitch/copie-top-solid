// Assistant IA : pilote FormaCAD en langage naturel (version en ligne claude.ai, capacité « sample »)
import * as THREE from 'three';
import { BASIC } from './shapes.js';
import { LIBRARY, familyById, partDefaults } from './library.js';
import { SHEET, SHEET_DEFAULTS } from './sheet.js';
import { MATERIALS } from './model.js';
import { icon } from './icons.js';

const E = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

function rules() {
  const basic = Object.entries(BASIC).map(([k, v]) => `  - ${k} (${v.label}) : ${v.params.map((p) => p.k + (p.options ? '=' + p.options.join('|') : '')).join(', ')}`).join('\n');
  const sheet = Object.entries(SHEET).map(([k, v]) => `  - kind=${k} (${v.label}) : ${v.params.map((p) => p.k + (p.options ? '=' + p.options.join('|') : '')).join(', ')}`).join('\n');
  const fams = LIBRARY.map((f) => `  - ${f.id} : ${f.name} (${f.std}) ; tailles ${Object.keys(f.sizes).slice(0, 14).join(', ')}${Object.keys(f.sizes).length > 14 ? '…' : ''} ; paramètres ${['size', ...f.extra.map((x) => x.k)].join(', ')}`).join('\n');
  return `Tu es l'assistant intégré de FormaCAD, un logiciel de CAO 3D (mécanique, chaudronnerie, tôlerie). Tu réponds en français, brièvement et concrètement.
Tu peux agir dans le logiciel avec les outils fournis. Quand l'utilisateur demande de créer ou modifier quelque chose, fais-le avec les outils (ne te contente pas d'expliquer), puis résume en 1 à 3 phrases ce que tu as fait.
Conventions : unités en millimètres, axe Z vers le haut, le sol est Z=0. pos = [x,y,z] position, rot = [rx,ry,rz] en degrés.
- Volumes simples (type) et leurs paramètres, posés sur leur base, centrés en X/Y :
${basic}
- Chaudronnerie / tôlerie : type "sheet" avec params.kind :
${sheet}
  (bent.profile = "longueur;angle;longueur…" ex. "40;90;80;90;40", ref = Extérieur|Intérieur|Fibre neutre)
- Composants du catalogue : type "part", params.family = id ci-dessous, params.size = une taille, + paramètres listés (L = longueur, axis = X|Y|Z pour les profilés, thread = "Simplifié"|"Réel (hélicoïdal)"). Les vis ont la tête à z=0..k et la tige vers le bas (z négatif).
${fams}
- Perçage : add_hole sur un solide, position dans le repère de ce solide (le dessus d'un bloc de hauteur h est à z=h), le trou va vers -Z. Passages : M3 3,4 / M4 4,5 / M5 5,5 / M6 6,6 / M8 9 / M10 11 / M12 13,5 / M16 17,5 ; taraudages : M6 5 / M8 6,8 / M10 8,5 / M12 10,2. Lamage CHC M8 : D2=15 h2=8,6.
- Esquisse + extrusion : sketch_extrude avec des entités 2D : {type:"rect",x,y,w,h} (x,y = coin), {type:"circle",c:[x,y],r}, {type:"line",a:[x,y],b:[x,y]}, {type:"arc",c,r,a0,a1 (degrés, sens trigo)}, {type:"polygon",c,r,n,rot}, {type:"slot",a,b,r}. Un contour fermé inclus dans un autre devient un trou.
Matériaux disponibles : ${Object.keys(MATERIALS).join(', ')}.
Le logiciel couvre aussi l'atelier : G-code de découpe (laser, plasma, oxycoupage) et de fraisage, imbrication sur tôle, calcul de poutre (RDM), boulons et soudures (Eurocode 3), transmission, roulements, ressorts, vérins et hydraulique, conditions de coupe : ouvre l'outil adapté avec show quand c'est utile, et réponds aux questions techniques de tous les métiers de la mécanique industrielle (usinage, chaudronnerie, soudure, maintenance, charpente, hydraulique, pneumatique).
Commence par get_project si tu as besoin de connaître le projet. Ne supprime rien sans demande explicite.`;
}

const KEY_STORE = 'formacad.apikey';
const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const setKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* stockage indisponible */ } };

const blobToB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });

export class Assistant {
  constructor(app) {
    this.app = app;
    this.turns = [];
    this.sample = null;
    this.ready = (async () => {
      try {
        if (!window.claude?.use) return null;
        this.sample = await window.claude.use('sample');
        this.limits = this.sample ? await this.sample.limits().catch(() => null) : null;
      } catch { this.sample = null; }
      return this.sample;
    })();
  }

  // ------------------------------------------------------------ outils offerts à Claude
  tools() {
    const app = this.app, M = app.model;
    const log = (t) => this.log(t);
    const done = (o) => { app.commit(); app.selection = o ? [o.id] : app.selection; app.refresh(); };
    const num3 = (v, d = [0, 0, 0]) => (Array.isArray(v) && v.length === 3 ? v.map(Number) : d);
    const summary = (o) => ({ id: o.id, name: M.displayName(o), type: o.type, params: o.type === 'mesh' ? '(maillage importé)' : o.type === 'sketch' ? `${o.params.entities.length} entités` : o.params, pos: o.pos, rot: o.rot, material: o.material, parent: o.parent, role: o.role, visible: o.visible });
    return [
      {
        name: 'get_project', description: 'Renvoie la liste des objets du projet (id, nom, type, paramètres, position, matériau, relation booléenne).',
        execute: () => M.objects.map(summary),
      },
      {
        name: 'add_object', description: 'Ajoute un volume simple (type parmi les volumes), une pièce de chaudronnerie (type "sheet" + params.kind) ou un composant du catalogue (type "part" + params.family/size). Renvoie l\'objet créé.',
        inputSchema: { type: 'object', properties: { type: { type: 'string' }, params: { type: 'object' }, pos: { type: 'array', items: { type: 'number' } }, rot: { type: 'array', items: { type: 'number' } }, material: { type: 'string' }, name: { type: 'string' } }, required: ['type'] },
        execute: (i) => {
          const type = String(i.type);
          let params = i.params && typeof i.params === 'object' ? { ...i.params } : {};
          if (BASIC[type]) params = { ...Object.fromEntries(BASIC[type].params.map((p) => [p.k, p.def])), ...params };
          else if (type === 'sheet') { if (!SHEET[params.kind]) throw new Error('kind inconnu : ' + params.kind); params = { ...SHEET_DEFAULTS(params.kind), ...params }; }
          else if (type === 'part') {
            const fam = familyById(params.family);
            if (!fam) throw new Error('famille inconnue : ' + params.family);
            if (params.size && !fam.sizes[params.size]) throw new Error(`taille inconnue pour ${fam.id} : ${params.size}. Tailles : ${Object.keys(fam.sizes).join(', ')}`);
            params = { ...partDefaults(fam, params.size), ...params };
          } else throw new Error('type inconnu : ' + type);
          const o = M.add({ type, params, pos: num3(i.pos), rot: num3(i.rot), material: MATERIALS[i.material] ? i.material : (type === 'part' && familyById(params.family)?.cat === 'Profilés aluminium' ? 'Aluminium' : 'Acier'), name: i.name ? String(i.name) : '' });
          M.baseGeometry(o); // valide (lève une erreur si paramètres incohérents)
          log('➕ ' + M.displayName(o));
          done(o);
          return summary(o);
        },
      },
      {
        name: 'update_object', description: 'Modifie un objet existant : params (fusionnés), pos, rot, material, name, visible.',
        inputSchema: { type: 'object', properties: { id: { type: 'number' }, params: { type: 'object' }, pos: { type: 'array', items: { type: 'number' } }, rot: { type: 'array', items: { type: 'number' } }, material: { type: 'string' }, name: { type: 'string' }, visible: { type: 'boolean' } }, required: ['id'] },
        execute: (i) => {
          const o = M.get(Number(i.id));
          if (!o) throw new Error('objet introuvable');
          if (i.params && typeof i.params === 'object' && o.type !== 'mesh' && o.type !== 'sketch') { Object.assign(o.params, i.params); if (o.type === 'part') o.name = ''; }
          if (i.pos) o.pos = num3(i.pos, o.pos);
          if (i.rot) o.rot = num3(i.rot, o.rot);
          if (i.material && MATERIALS[i.material]) { o.material = i.material; o.color = null; }
          if (i.name != null) o.name = String(i.name);
          if (typeof i.visible === 'boolean') o.visible = i.visible;
          log('✏️ ' + M.displayName(o));
          done(o);
          return summary(o);
        },
      },
      {
        name: 'delete_object', description: 'Supprime un objet (et ses perçages / outils booléens). À n\'utiliser que sur demande explicite.',
        inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
        execute: (i) => { const o = M.get(Number(i.id)); if (!o) throw new Error('objet introuvable'); log('🗑 ' + M.displayName(o)); M.remove(o.id); app.selection = []; done(null); return 'supprimé'; },
      },
      {
        name: 'add_hole', description: 'Perce un solide. pos = centre du trou à la surface, dans le repère du solide ; rot optionnel (défaut : trou vertical vers -Z, depuis le dessus). kind = simple|lamage|fraisage.',
        inputSchema: { type: 'object', properties: { target_id: { type: 'number' }, pos: { type: 'array', items: { type: 'number' } }, rot: { type: 'array', items: { type: 'number' } }, d: { type: 'number' }, through: { type: 'boolean' }, depth: { type: 'number' }, kind: { type: 'string' }, D2: { type: 'number' }, h2: { type: 'number' } }, required: ['target_id', 'pos', 'd'] },
        execute: (i) => {
          const t = M.get(Number(i.target_id));
          if (!t || !M.isSolid(t)) throw new Error('solide cible introuvable');
          const p = { kind: ['lamage', 'fraisage'].includes(i.kind) ? i.kind : 'simple', d: Number(i.d), through: i.through !== false, depth: Number(i.depth) || 10, D2: Number(i.D2) || Number(i.d) * 1.7, h2: Number(i.h2) || Number(i.d) };
          const o = M.add({ type: 'hole', name: `Perçage Ø${p.d}`, params: p, parent: t.id, role: 'cut', pos: num3(i.pos), rot: num3(i.rot) });
          log(`🔩 Perçage Ø${p.d} dans ${M.displayName(t)}`);
          done(t);
          return { id: o.id };
        },
      },
      {
        name: 'sketch_extrude', description: 'Crée une esquisse sur un plan (XY par défaut, décalage offset) avec des entités 2D, puis l\'extrude de h (ou la creuse dans target_id si pocket=true). Renvoie l\'id du volume.',
        inputSchema: { type: 'object', properties: { plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'] }, offset: { type: 'number' }, entities: { type: 'array', items: { type: 'object' } }, h: { type: 'number' }, pocket: { type: 'boolean' }, target_id: { type: 'number' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['entities', 'h'] },
        execute: (i) => {
          const P = { XY: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], XZ: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], YZ: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] }[i.plane || 'XY'] || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
          const [u, v, n] = P.map((a) => new THREE.Vector3(...a));
          const m = new THREE.Matrix4().makeBasis(u, v, n).setPosition(n.clone().multiplyScalar(Number(i.offset) || 0));
          const sk = M.add({ type: 'sketch', name: (i.name || 'Esquisse') + ' (esquisse)', params: { entities: i.entities }, visible: false });
          M.setWorldMatrix(sk, m);
          const o = M.add({ type: 'extrude', name: i.name ? String(i.name) : '', params: { sketch: sk.id, h: Number(i.h), dir: i.pocket ? 'Inverse' : 'Normale' }, material: MATERIALS[i.material] ? i.material : 'Acier' });
          M.setWorldMatrix(o, m);
          if (i.pocket) {
            const t = M.get(Number(i.target_id));
            if (!t) throw new Error('target_id requis pour une poche');
            const wm = M.worldMatrix(o); o.parent = t.id; o.role = 'cut'; M.setWorldMatrix(o, wm);
          }
          M.finalGeometry(o.parent ? M.get(o.parent) : o);
          log('📐 ' + M.displayName(o));
          done(o.parent ? M.get(o.parent) : o);
          return { id: o.id, sketch_id: sk.id };
        },
      },
      {
        name: 'boolean', description: 'Opération booléenne : op = cut (soustraire tools de target), add (unir) ou inter (intersection).',
        inputSchema: { type: 'object', properties: { target_id: { type: 'number' }, tool_ids: { type: 'array', items: { type: 'number' } }, op: { type: 'string', enum: ['cut', 'add', 'inter'] } }, required: ['target_id', 'tool_ids', 'op'] },
        execute: (i) => {
          const t = M.get(Number(i.target_id));
          if (!t) throw new Error('cible introuvable');
          for (const id of i.tool_ids || []) { const b = M.get(Number(id)); if (!b || b === t) continue; const wm = M.worldMatrix(b); b.parent = t.id; b.role = ['cut', 'add', 'inter'].includes(i.op) ? i.op : 'cut'; M.setWorldMatrix(b, wm); }
          log('⚙️ Booléen sur ' + M.displayName(t));
          done(t);
          return 'ok';
        },
      },
      {
        name: 'show', description: 'Affiche quelque chose à l\'utilisateur : what = fit (tout afficher), iso, front, top, right, flat (développé d\'une tôle, id requis), drawing (mise en plan), bom (nomenclature), calc (calculateurs ; tab = fit|cut|beam|joint|trans|bearing|fluid|bend|mass|thread), cam (G-code de découpe ; id de la pièce), mill (G-code de fraisage ; id), nest (imbrication sur tôle).',
        inputSchema: { type: 'object', properties: { what: { type: 'string' }, id: { type: 'number' }, tab: { type: 'string' } }, required: ['what'] },
        execute: (i) => {
          const w = String(i.what);
          if (w === 'fit') app.fitView();
          else if (['iso', 'front', 'top', 'right'].includes(w)) app.setStdView(w);
          else if (w === 'flat') { const o = M.get(Number(i.id)); if (!o || o.type !== 'sheet') throw new Error('id de tôle requis'); this.after = () => app.flatDialog(o); }
          else if (w === 'drawing') this.after = () => app.drawingDialog();
          else if (w === 'bom') this.after = () => app.bomDialog();
          else if (w === 'calc') this.after = () => app.calcDialog(i.tab || 'fit');
          else if (w === 'cam' || w === 'mill') { if (i.id) app.selection = [Number(i.id)]; this.after = () => app.camDialog(w === 'mill' ? 'mill' : 'laser'); }
          else if (w === 'nest') this.after = () => app.nestDialog();
          return 'ok';
        },
      },
    ];
  }

  /** 'claude' (page claude.ai), 'api' (clé API) ou null */
  async mode() {
    const s = await this.ready;
    if (s) return 'claude';
    return getKey() ? 'api' : null;
  }

  keyBox() {
    const inp = E('input', { type: 'password', placeholder: 'sk-ant-…', value: getKey(), autocomplete: 'off' });
    const box = E('div', { class: 'ai-msg ai ai-key' },
      E('div', { html: '<b>🔑 Clé API Anthropic</b><br>Dans la version téléchargée, l\'assistant utilise votre propre clé API (facturée à l\'usage par Anthropic, environ quelques centimes par demande).<br>1. Créez un compte sur <b>console.anthropic.com</b>, ajoutez un moyen de paiement<br>2. Menu <b>API Keys → Create Key</b>, copiez la clé<br>3. Collez-la ici. Elle reste uniquement sur cet ordinateur.' }),
      E('div', { class: 'ai-keyrow' }, inp,
        E('button', { class: 'btn primary', onclick: () => { const k = inp.value.trim(); if (!/^sk-ant-/.test(k)) { this.app.toast('Clé invalide : elle commence par « sk-ant- »', true); return; } setKey(k); box.remove(); this.addMsg('ai', '✅ Clé enregistrée. Je suis prêt : décrivez ce que vous voulez concevoir.'); } }, 'Enregistrer')),
      getKey() ? E('button', { class: 'btn', style: 'margin-top:6px', onclick: () => { setKey(''); inp.value = ''; this.app.toast('Clé supprimée de cet ordinateur'); } }, 'Supprimer la clé enregistrée') : null);
    this.msgs.append(box);
    this.msgs.scrollTop = 1e9;
    setTimeout(() => inp.focus(), 50);
  }

  // ------------------------------------------------------------ interface
  toggle() {
    if (this.panel) { this.panel.remove(); this.panel = null; return; }
    this.open();
  }

  open() {
    const p = E('div', { id: 'ai-panel' });
    const msgs = E('div', { class: 'ai-msgs' });
    const ta = E('textarea', { rows: 3, placeholder: 'Ex. : « Fais une platine 200×100 ép. 10 en inox avec 4 trous M8 à 15 mm des bords » ou « Quel ajustement pour monter un roulement 6204 sur un arbre ? »' });
    const file = E('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const imgBtn = E('button', { class: 'btn', title: 'Joindre une photo de croquis ou de plan', html: icon('camera', 16) });
    const send = E('button', { class: 'btn primary', html: icon('play', 16) + 'Envoyer' });
    const stop = E('button', { class: 'btn hidden' }, 'Stop');
    const chip = (t) => E('button', { class: 'chip', onclick: () => { ta.value = t; ta.focus(); } }, t);
    this.msgs = msgs;
    p.append(
      E('div', { class: 'ai-head' }, E('b', { html: '✨ Assistant IA' }), E('button', { class: 'btn', onclick: () => this.toggle() }, '✕')),
      msgs,
      E('div', { class: 'ai-sugg' },
        chip('Fais une platine 200×100 ép. 10 avec 4 trous Ø9 à 15 mm des bords'),
        chip('Ajoute un carré-rond 400×300 vers Ø250, hauteur 300, tôle de 2'),
        chip('Mets des vis CHC M8×30 dans tous les trous'),
        chip('Quel ajustement pour un roulement sur un arbre ?')),
      E('div', { class: 'ai-input' }, ta, E('div', { class: 'ai-btns' }, imgBtn, file, stop, send)),
    );
    this.panel = p;
    document.querySelector('#viewport').append(p);
    this.addMsg('ai', 'Bonjour ! Décrivez ce que vous voulez concevoir ou demandez-moi un conseil. Je peux créer et modifier les pièces, percer, faire des tôles et de la chaudronnerie, et vous guider. Vous pouvez aussi joindre la photo d\'un croquis coté.');
    let image = null;
    imgBtn.onclick = () => file.click();
    file.onchange = () => { image = file.files[0] || null; imgBtn.classList.toggle('primary', !!image); if (image) this.addMsg('me', `📎 ${image.name}`); };
    const go = async () => {
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      send.disabled = true; stop.classList.remove('hidden');
      this.ctl = new AbortController();
      stop.onclick = () => this.ctl.abort();
      try { await this.ask(text, image); } finally { image = null; imgBtn.classList.remove('primary'); file.value = ''; send.disabled = false; stop.classList.add('hidden'); }
    };
    send.onclick = go;
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    setTimeout(() => ta.focus(), 50);
    p.querySelector('.ai-head').insertBefore(E('button', { class: 'btn', title: 'Clé API Anthropic (version téléchargée)', onclick: () => this.keyBox(), html: '🔑' }), p.querySelector('.ai-head').lastChild);
    this.ready.then((s) => { if (!s && !getKey()) this.keyBox(); });
  }

  addMsg(who, text, cls = '') {
    const d = E('div', { class: `ai-msg ${who} ${cls}` });
    d.textContent = text;
    this.msgs.append(d);
    this.msgs.scrollTop = 1e9;
    return d;
  }

  log(t) {
    if (!this.cur) return;
    const l = E('div', { class: 'ai-log' }, t);
    this.cur.before(l);
    this.msgs.scrollTop = 1e9;
  }

  async ask(text, image) {
    this.addMsg('me', text);
    const s = await this.ready;
    if (!s) {
      if (!getKey()) { this.addMsg('ai', 'Pour utiliser l\'IA dans cette version, enregistrez d\'abord une clé API (bouton 🔑).', 'warn'); this.keyBox(); return; }
      return this.askApi(text, image);
    }
    this.cur = this.addMsg('ai', 'Réflexion…', 'pending');
    this.after = null;
    this.turns.push({ role: 'user', content: text + (image ? '\n(Une image est jointe : un croquis ou plan à interpréter ; cotes en mm.)' : '') });
    if (this.turns.length > 12) this.turns = this.turns.slice(-12);
    if (this.turns[0].role !== 'user') this.turns.shift();
    const input = [{ role: 'user', content: rules() + '\n\nÉtat actuel du projet : ' + JSON.stringify(this.app.model.objects.slice(0, 60).map((o) => ({ id: o.id, name: this.app.model.displayName(o), type: o.type, pos: o.pos, parent: o.parent }))) }, ...this.turns];
    const opts = { signal: this.ctl.signal, cache: false, onText: ({ text: t }) => { this.cur.textContent = t; this.cur.classList.remove('pending'); this.msgs.scrollTop = 1e9; } };
    if (this.limits?.tools) opts.tools = this.tools();
    if (image && this.limits?.images) opts.images = [image];
    try {
      const { text: answer, truncated } = await s(input, opts);
      this.cur.textContent = answer + (truncated ? ' …(réponse coupée)' : '');
      this.turns.push({ role: 'assistant', content: answer });
      if (this.after) this.after();
    } catch (e) {
      this.cur.classList.remove('pending');
      const msg = {
        cancelled: 'Arrêté.', not_granted: 'L\'accès à Claude n\'a pas été autorisé pour cette page.', sampling_disabled: 'Claude n\'est pas disponible pour ce compte.',
        rate_limited: 'Trop de demandes pour le moment : réessayez dans un instant.', session_expired: 'Reconnectez-vous à Claude puis réessayez.',
        refused: 'Je ne peux pas traiter cette demande ; reformulez-la.', image_rejected: 'Image refusée (format ou taille).', images_unavailable: 'Les images ne sont pas disponibles ici.',
      }[e?.code] || 'Problème de connexion avec l\'assistant : réessayez.';
      this.cur.textContent = (e?.text ? e.text + '\n\n' : '') + msg;
      this.cur.classList.add('warn');
      this.turns.pop();
    }
    this.cur = null;
  }

  // ------------------------------------------------------------ mode clé API (version téléchargée, internet requis)
  async askApi(text, image) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true, ...(window.__formacadFetch ? { fetch: window.__formacadFetch } : {}) });
    const tools = this.tools();
    const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    const content = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.type || 'image/png', data: await blobToB64(image) } });
    content.push({ type: 'text', text: text + '\n\nÉtat actuel du projet : ' + JSON.stringify(this.app.model.objects.slice(0, 60).map((o) => ({ id: o.id, name: this.app.model.displayName(o), type: o.type, pos: o.pos, parent: o.parent }))) });
    this.apiMsgs = this.apiMsgs || [];
    const start = this.apiMsgs.length;
    this.apiMsgs.push({ role: 'user', content });
    this.cur = this.addMsg('ai', 'Réflexion…', 'pending');
    this.after = null;
    const show = (t) => { this.cur.textContent = t; this.cur.classList.remove('pending'); this.msgs.scrollTop = 1e9; };
    let said = '';
    try {
      for (let round = 0; round < 15; round++) {
        if (this.ctl.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
        const r = await client.beta.messages.create({
          model: 'claude-opus-5-5',
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: rules(),
          tools: apiTools,
          messages: this.apiMsgs,
        }, { signal: this.ctl.signal });
        this.apiMsgs.push({ role: 'assistant', content: r.content });
        const txt = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (txt) { said = said ? said + '\n\n' + txt : txt; show(said); }
        if (r.stop_reason === 'refusal') { show((said ? said + '\n\n' : '') + 'Je ne peux pas traiter cette demande ; reformulez-la.'); break; }
        if (r.stop_reason === 'pause_turn') continue;
        if (r.stop_reason !== 'tool_use') break;
        const results = [];
        for (const b of r.content) {
          if (b.type !== 'tool_use') continue;
          const t = tools.find((x) => x.name === b.name);
          try {
            if (!t) throw new Error('outil inconnu');
            const out = await t.execute(b.input || {});
            results.push({ type: 'tool_result', tool_use_id: b.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: 'Erreur : ' + (e?.message || e), is_error: true });
          }
        }
        this.apiMsgs.push({ role: 'user', content: results });
        if (!said) show('Construction en cours…');
      }
      if (!said) show('C\'est fait.');
      if (this.after) this.after();
    } catch (e) {
      // on retire l'échange inachevé pour garder un historique valide
      this.apiMsgs.length = start;
      this.cur.classList.remove('pending');
      let msg = 'Problème de connexion avec Claude : vérifiez votre connexion internet puis réessayez.';
      if (e?.code === 'cancelled' || e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) msg = 'Arrêté.';
      else if (e instanceof Anthropic.AuthenticationError) msg = 'Clé API refusée : vérifiez-la (bouton 🔑).';
      else if (e instanceof Anthropic.PermissionDeniedError) msg = 'Cette clé n\'a pas accès à ce modèle.';
      else if (e instanceof Anthropic.RateLimitError) msg = 'Limite d\'utilisation atteinte : patientez un peu, ou vérifiez le crédit de votre compte Anthropic.';
      else if (e instanceof Anthropic.BadRequestError) msg = /credit|billing/i.test(e.message) ? 'Crédit insuffisant sur votre compte Anthropic (console.anthropic.com → Billing).' : 'Requête refusée : ' + e.message;
      else if (e instanceof Anthropic.APIConnectionError) msg = 'Impossible de joindre Claude : l\'assistant a besoin d\'internet.';
      else if (e instanceof Anthropic.APIError) msg = `Erreur du service (${e.status}) : réessayez dans un instant.`;
      this.cur.textContent = (said ? said + '\n\n' : '') + msg;
      this.cur.classList.add('warn');
    }
    if (this.apiMsgs.length > 40) this.apiMsgs = [];
    this.cur = null;
  }
}
