# FormaCAD

**Logiciel de CAO 3D simple et ergonomique**, en français, gratuit, sans installation.
Esquisses 2D, volumes paramétrés, perçages, opérations booléennes, catalogue de composants
normalisés, mise en plan, et export **DXF, STEP, STL, OBJ, GLB, PLY, SVG, PNG**.

---

## 🚀 Télécharger et utiliser

**[⬇ Télécharger FormaCAD (.zip)](https://github.com/k6vft5k7cw-glitch/copie-top-solid/raw/main/release/FormaCAD.zip)**, environ 5 Mo, pour Windows, Mac et Linux.

1. Faites un clic droit sur `FormaCAD.zip`, puis **Extraire tout**.
2. Double-cliquez sur **`FormaCAD.html`** : il s'ouvre dans votre navigateur (Chrome, Edge ou Firefox).
3. Rien à installer. **Tout fonctionne hors ligne**, y compris l'import STEP. Seul l'assistant IA a besoin d'internet et d'une clé API Anthropic.

**Version en ligne**, sans téléchargement : https://k6vft5k7cw-glitch.github.io/copie-top-solid/ (une fois GitHub Pages activé, voir plus bas).

> Vos projets s'enregistrent en fichiers `.fcad` (Ctrl+S). Une sauvegarde automatique est aussi faite dans le navigateur.

---

## ✨ Fonctions

| Domaine | Ce que vous pouvez faire |
|---|---|
| **Esquisse 2D** | Ligne, rectangle, rectangle centré, cercle, arc, polygone, oblong ; aimantation grille, extrémités, centres et milieux ; **saisie des cotes au clavier** (`50`, `50<30`, `80;40`) ; traits de construction ; esquisse sur les plans XY / XZ / YZ ou **directement sur une face** d'un solide ; détection automatique des contours fermés et des trous |
| **Esquisse intelligente** | **Congé et chanfrein de coin** (clic sur le coin), **contraintes** horizontal / vertical / parallèle / perpendiculaire / égal / concentrique, **points déplaçables à la souris** (les lignes connectées suivent), **cotes affichées et cliquables** pour les modifier |
| **Volumes** | Extrusion (normale, inverse, symétrique), **poche** (enlèvement), **révolution** ; bloc, cylindre, tube, cône, sphère, tore, coin, plaque percée — tout reste **paramétrique** et modifiable |
| **Usinage** | **Perçage** en un clic sur une face : simple, **lamé** (vis CHC), **fraisé** (vis FHC), débouchant ou borgne, préréglages ISO (passage et taraudage M3 à M20) |
| **Chaudronnerie** | Générateurs 3D paramétriques avec **développé à plat exact** (fibre neutre) : **virole**, **tronc de cône** droit ou excentré, **coude segmenté**, **piquage** tube sur tube (avec excentration et découpe du tube principal), **transitions carré-rond et rectangle-rectangle** (centrées ou décalées) ; surface, masse du flan, lignes de pliage / roulage ; export **DXF** (calques CONTOUR, PLIAGE, AXE, TEXTE), SVG, PDF, ou conversion en esquisse |
| **Tôlerie** | **Tôle pliée** (U, L, Z, cornière… saisie « 40;90;80;90;40 »), rayon intérieur, **facteur K**, longueur développée et lignes de pli avec sens et angle |
| **Tuyauterie** | Brides plates PN16 (EN 1092-1), coudes 3D 45/90/180° (EN 10253), tubes EN 10220 DN15 à DN300, fonds bombés GRC (Klöpper) et elliptiques |
| **Atelier – découpe** | **G-code** laser, plasma et oxycoupage avec compensation de saignée, amorçages dans la chute, trous avant contour ; **imbrication** des pièces sur la tôle (formats standards ou personnalisés), taux de chute, DXF de la tôle et G-code de la tôle |
| **Atelier – usinage** | **G-code de fraisage 2D** (contournage compensé, passes, perçages G81 automatiques) ; **conditions de coupe** (Vc, N, Vf) en fraisage, perçage et tournage |
| **Structure / charpente** | **Calcul de poutre** (flèche, contrainte, taux de travail) avec les vraies sections du catalogue (IPE, HEA, HEB, UPN, tubes, alu…) ; **boulons et cordons de soudure** (Eurocode 3 simplifié) |
| **Transmission / maintenance** | Courroies, chaînes (nombre de maillons), engrenages, **durée de vie des roulements (L10)**, raideur des ressorts, ajustements ISO |
| **Pneumatique / hydraulique** | Effort et vitesse des **vérins**, consommation d'air, puissance hydraulique ; **vérins ISO 15552** et **moteurs IEC** au catalogue |
| **Booléens** | Soustraction, union, intersection, modifiables à tout moment depuis l'arbre |
| **Modifier** | Poignées de déplacement et de rotation (avec pas), coordonnées numériques, poser au sol, dupliquer, **répétitions linéaires et circulaires**, figer |
| **Catalogue** | Brides, coudes, tubes, fonds bombés, vis CHC, H, FHC, BHC, sans tête, tiges filetées, écrous, écrous Nylstop, rondelles plates et larges, roulements 60xx / 62xx / 63xx / miniatures, goupilles, clavettes, **engrenages à développante**, ressorts, poutrelles IPE / HEA / HEB / UPN, cornières, tubes, plats, ronds, **profilés aluminium rainurés** |
| **Assemblage rapide** | Les vis et goupilles **se posent automatiquement dans les trous** (alignement et lamage pris en compte) |
| **Catalogues fabricants** | Liens vers TraceParts, 3D ContentCentral, MISUMI, SKF, Festo, Bosch Rexroth, item, igus, HIWIN… : téléchargez le modèle **STEP** du fabricant, glissez-le dans FormaCAD |
| **Mesure et analyse** | Distance entre 2 points (accroche aux sommets), encombrement, volume, **masse** selon le matériau (acier, inox, alu, laiton, PLA, ABS, bois…) |
| **Mise en plan** | Vues de face, dessus, gauche, droite et isométrique, **lignes cachées en pointillés**, cotes d'encombrement, cartouche ; export **DXF**, SVG ou **PDF** (impression) |
| **Import** | **STEP, IGES, BREP** (noyau OpenCascade intégré), STL, OBJ, glTF / GLB, PLY, 3MF, **DXF** (devient une esquisse prête à extruder) |
| **Export** | **DXF** (esquisse exacte pour laser / plasma / CNC, plan 2D, maillage 3D), **STEP** (lu par SolidWorks, TopSolid, Fusion 360, FreeCAD, CATIA, Inventor…), **STL** (impression 3D), OBJ, GLB, PLY, SVG, PNG, projet `.fcad` |
| **Assistant IA** (en ligne : compte Claude ; version téléchargée : clé API Anthropic + internet) | Décrivez en français ce que vous voulez (« platine inox 200×100 ép. 10 avec 4 trous M8 lamés ») : l'assistant crée les pièces, perce, fait la tôlerie / chaudronnerie, modifie, et répond aux questions techniques ; il peut lire la **photo d'un croquis coté** |
| **Prise en main** | **Palette de commandes `Ctrl+K`** (toutes les actions et tout le catalogue au clavier), **menu clic droit** contextuel, **cotes modifiables directement dans la vue 3D**, **guides pas à pas** avec « Faire pour moi » |
| **Assemblage** | **Contact face contre face** en 2 clics, **vue éclatée** réglable, **isoler** une sélection, cordons de soudure comptés en nomenclature |
| **Plan pro** | Formats **A4 à A0**, **échelle normalisée automatique**, **cartouche** (société, dessinateur, indice, date, matière, masse) mémorisé, **nomenclature** sur le plan |
| **Atelier** | **Nomenclature + débits** (profilés, tôles) en **CSV Excel**, **tous les développés en un ZIP** classés par épaisseur, **calculateurs** : ajustements **ISO 286** (H7/g6…), pliage (facteur K), masses, perçage / taraudage / lamage / couples de serrage |
| **Rendu et finitions** | Ombres, matériaux réalistes (inox, galvanisé, Corten, alu anodisé…), couleurs **RAL** ; **congés / chanfreins des arêtes** (blocs, cylindres, extrusions, plaques) ; **filetage réel hélicoïdal** ISO sur vis et tiges filetées ; **poignées orange pour étirer** les pièces à la souris |
| **Soudure** | Cordons en 2 clics, comptés en nomenclature, **symboles normalisés (ISO 2553) sur le plan** |
| **Confort** | Annuler / rétablir illimité, calculs dans les champs (`120/2+5`), aides contextuelles en bas de l'écran, thème sombre, glisser-déposer de fichiers |

---

## ⌨️ Raccourcis

| Touche | Action | Touche | Action |
|---|---|---|---|
| `S` | Nouvelle esquisse | `H` | Perçage |
| `B` | Catalogue | `I` | Importer |
| `D` | Mesurer | `E` | Modifier l'esquisse |
| `M` / `T` | Déplacer / tourner | `F` | Tout afficher |
| `0` `1` `3` `7` | Vues iso / face / droite / dessus | `Suppr` | Supprimer |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / rétablir | `Ctrl+D` | Dupliquer |
| `Ctrl+S` / `Ctrl+O` | Enregistrer / ouvrir | `Échap` | Annuler l'action |
| `Ctrl+K` | Rechercher une commande | Clic droit | Menu contextuel |
| `A` | Contact face / face | `X` | Vue éclatée |
| `Q` | Isoler | `W` | Soudure |
| `C` | Calculateurs | | |

En esquisse : `L` ligne, `R` rectangle, `Maj+R` rectangle centré, `C` cercle, `A` arc, `P` polygone, `O` oblong,
chiffres + `Entrée` pour saisir une cote, `Maj` maintenue pour désactiver l'aimantation, `Entrée` pour terminer.

**Souris** : clic gauche = sélectionner, glisser gauche = tourner, glisser droit ou molette = déplacer, molette = zoom.

---

## 🌐 Publier le site de téléchargement (GitHub Pages)

Le dossier `docs/` contient une page d'accueil (`index.html`), l'application en ligne (`app.html`) et le `.zip`.
Pour l'activer : **Settings → Pages → Source : Deploy from a branch → Branch : `main`, dossier `/docs` → Save**.
Le site est ensuite disponible à l'adresse `https://k6vft5k7cw-glitch.github.io/copie-top-solid/`.

## 🛠️ Pour les développeurs

```bash
npm install
npm run dev       # serveur de développement
npm run build     # dist/ (version web) + release/FormaCAD.html (fichier unique hors ligne)
```

Structure :

```
src/
  main.js        interface, interactions, dialogues
  viewer.js      scène 3D (three.js), caméra Z vers le haut, gizmos
  model.js       document, arbre, reconstruction paramétrique, booléens (three-bvh-csg)
  sketch.js      esquisse 2D : entités, contours fermés, éditeur
  shapes.js      primitives et perçages
  library.js     catalogue normalisé (dimensions ISO / DIN / EN)
  exporters.js   DXF, STEP, STL, OBJ, GLB, PLY, SVG, mise en plan avec lignes cachées
  importers.js   STEP / IGES / BREP (occt-import-js), STL, OBJ, glTF, PLY, 3MF, DXF
```

## ⚠️ Limites actuelles

- Le noyau géométrique travaille en **maillage** (facettes) : l'export STEP est un B-rep à facettes, parfaitement
  lisible par les autres logiciels, mais les cylindres y sont des facettes et non des surfaces exactes.
  L'export **DXF d'esquisse** conserve, lui, les cercles et arcs exacts.
- Les contraintes d'esquisse s'appliquent à la demande (pas de solveur permanent) ; les congés / chanfreins 3D portent sur les arêtes haut / bas des extrusions et plaques (et toutes les arêtes des blocs).
- Filetage réel disponible sur les vis et tiges ; les écrous restent simplifiés.
- Les catalogues des fabricants ne peuvent pas être intégrés directement (licences propriétaires) : FormaCAD les
  importe au format STEP.

## Licences

FormaCAD est sous licence MIT. Il utilise three.js, three-bvh-csg, three-mesh-bvh, SDK Anthropic (MIT), clipper-lib (Boost) et occt-import-js /
Open CASCADE Technology (LGPL 2.1) — textes de licence dans [`release/`](release/).
