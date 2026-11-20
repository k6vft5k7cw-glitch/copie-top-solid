# FormaCAD

**Logiciel de CAO 3D simple et ergonomique**, en français, gratuit, sans installation.
Esquisses 2D, volumes paramétrés, perçages, opérations booléennes, catalogue de composants
normalisés, mise en plan, et export **DXF, STEP, STL, OBJ, GLB, PLY, SVG, PNG**.

---

## 🚀 Utilisation immédiate (aucune installation)

1. Téléchargez **[`release/FormaCAD.html`](release/FormaCAD.html)** (bouton *Download raw file* sur GitHub).
2. Double-cliquez dessus : il s'ouvre dans votre navigateur (Chrome, Edge, Firefox).
3. C'est tout. **Tout fonctionne hors ligne**, y compris l'import STEP.

> Vos projets s'enregistrent en fichiers `.fcad` (Ctrl+S) et une sauvegarde automatique est faite dans le navigateur.

---

## ✨ Fonctions

| Domaine | Ce que vous pouvez faire |
|---|---|
| **Esquisse 2D** | Ligne, rectangle, rectangle centré, cercle, arc, polygone, oblong ; aimantation grille, extrémités, centres et milieux ; **saisie des cotes au clavier** (`50`, `50<30`, `80;40`) ; traits de construction ; esquisse sur les plans XY / XZ / YZ ou **directement sur une face** d'un solide ; détection automatique des contours fermés et des trous |
| **Volumes** | Extrusion (normale, inverse, symétrique), **poche** (enlèvement), **révolution** ; bloc, cylindre, tube, cône, sphère, tore, coin, plaque percée — tout reste **paramétrique** et modifiable |
| **Usinage** | **Perçage** en un clic sur une face : simple, **lamé** (vis CHC), **fraisé** (vis FHC), débouchant ou borgne, préréglages ISO (passage et taraudage M3 à M20) |
| **Booléens** | Soustraction, union, intersection, modifiables à tout moment depuis l'arbre |
| **Modifier** | Poignées de déplacement et de rotation (avec pas), coordonnées numériques, poser au sol, dupliquer, **répétitions linéaires et circulaires**, figer |
| **Catalogue** | Vis CHC, H, FHC, BHC, sans tête, tiges filetées, écrous, écrous Nylstop, rondelles plates et larges, roulements 60xx / 62xx / 63xx / miniatures, goupilles, clavettes, **engrenages à développante**, ressorts, poutrelles IPE / HEA / HEB / UPN, cornières, tubes, plats, ronds, **profilés aluminium rainurés** |
| **Assemblage rapide** | Les vis et goupilles **se posent automatiquement dans les trous** (alignement et lamage pris en compte) |
| **Catalogues fabricants** | Liens vers TraceParts, 3D ContentCentral, MISUMI, SKF, Festo, Bosch Rexroth, item, igus, HIWIN… : téléchargez le modèle **STEP** du fabricant, glissez-le dans FormaCAD |
| **Mesure et analyse** | Distance entre 2 points (accroche aux sommets), encombrement, volume, **masse** selon le matériau (acier, inox, alu, laiton, PLA, ABS, bois…) |
| **Mise en plan** | Vues de face, dessus, gauche, droite et isométrique, **lignes cachées en pointillés**, cotes d'encombrement, cartouche ; export **DXF**, SVG ou **PDF** (impression) |
| **Import** | **STEP, IGES, BREP** (noyau OpenCascade intégré), STL, OBJ, glTF / GLB, PLY, 3MF, **DXF** (devient une esquisse prête à extruder) |
| **Export** | **DXF** (esquisse exacte pour laser / plasma / CNC, plan 2D, maillage 3D), **STEP** (lu par SolidWorks, TopSolid, Fusion 360, FreeCAD, CATIA, Inventor…), **STL** (impression 3D), OBJ, GLB, PLY, SVG, PNG, projet `.fcad` |
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

En esquisse : `L` ligne, `R` rectangle, `Maj+R` rectangle centré, `C` cercle, `A` arc, `P` polygone, `O` oblong,
chiffres + `Entrée` pour saisir une cote, `Maj` maintenue pour désactiver l'aimantation, `Entrée` pour terminer.

**Souris** : clic gauche = sélectionner, glisser gauche = tourner, glisser droit ou molette = déplacer, molette = zoom.

---

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
- Pas encore de congés / chanfreins, de contraintes d'esquisse ni de contraintes d'assemblage.
- Les filetages sont représentés de façon simplifiée (cylindre au diamètre nominal), comme dans la plupart des CAO.
- Les catalogues des fabricants ne peuvent pas être intégrés directement (licences propriétaires) : FormaCAD les
  importe au format STEP.

## Licences

FormaCAD est sous licence MIT. Il utilise three.js, three-bvh-csg, three-mesh-bvh (MIT) et occt-import-js /
Open CASCADE Technology (LGPL 2.1) — textes de licence dans [`release/`](release/).
