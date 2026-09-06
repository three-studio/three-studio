# Le relevé de référence

Des nombres, pris une fois, pour que les suivants aient quelque chose à quoi se comparer. Le lot 7 est
le seul dont les résultats sont des nombres, et il n'avait pas de point de départ écrit.

**Ce relevé n'est pas un seuil.** Rien n'échoue s'il bouge. C'est une photographie datée, avec la
machine et la version de three dessus, et la recette pour en reprendre une.

## La machine et la pile

| | |
|---|---|
| Machine | MacBook Pro, Apple M1 Pro, 16 Go |
| Système | macOS 26.3.1 (25D2128) |
| Écran | Liquid Retina XDR intégré, 3024 × 1964, ProMotion (adaptatif jusqu'à 120 Hz) |
| three | 0.185.1, plus `patches/three+0.185.1.patch` |
| Backend | WebGPU (la barre d'état affiche `WEBGPU`) |
| Electron | 43.2.0 · Node 22.11.0 |
| Build | `npm run dev` — développement, non minifié |
| Commit | `cbb0799` (T-059), arbre de travail propre hors `docs/` |
| Date | 2026-09-06 |

**La fenêtre compte, et c'est la première chose à vérifier avant de comparer.** Fenêtre Electron par
défaut : 1512 × 849 CSS pour le dock, panneau *Scene* 952 × 601 CSS, surface de dessin 1904 × 1202
pixels physiques (`maxPixelRatio` 2). Un autre écran ou une autre taille de fenêtre déplace les temps
de frame et **rien d'autre** : les appels de dessin, les triangles, les pools et la mémoire sont
indépendants de la surface.

## La scène

3005 entités : 3000 accessoires sur une grille de 60 × 50 au pas de 3,5 m, un sol, un soleil ombré,
une nappe d'eau de 90 × 90, une caméra principale, et l'entité `Scene` racine.

- **Six formes × six couleurs** → 36 lots (`BatchedMesh`), 8 géométries distinctes (les six formes,
  le sol, le plan d'eau).
- **Le ciel analytique**, vu *et* éclairant : `backgroundMode: 'sky'`, `environmentMode: 'background'`.
  Aucune texture à charger, aucun asset dans le projet.
- **Réglages de rendu par défaut** : `batching` vrai, `shadows` vrai, `shadowMapSize` 2048,
  `antialias` vrai, `maxPixelRatio` 2, `exposure` 1.

Le projet n'est pas dans le dépôt — cinq mégaoctets de JSON généré que personne ne relirait. La
recette est dans `baseline/make-scene.mjs`, et elle se construit sur les fabriques de `core`, donc une
scène refaite dans un an est une scène que ce build sait ouvrir.

## Le relevé

Médiane, p95 et max sur 239 frames, après 60 frames de chauffe. Les trois lectures sont prises dans
**un seul passage** de l'application : comparer des temps de frame entre deux lancements, c'est
comparer deux états thermiques et deux jeux de shaders déjà compilés. Trois passages consécutifs
ci-dessous (D, E, F) pour montrer l'étalement.

| | Édition | Play, tel que livré | Play, vue Scene détachée |
|---|---|---|---|
| **Frame, médiane** | **11,0 ms** (11,0 / 11,0 / 11,0) | **20,1 ms** (20,1 / 20,1 / 20,1) | **10,8 ms** (10,8 / 10,8 / 10,8) |
| Frame, p95 | 12,3 – 12,5 ms | 22,1 – 22,3 ms | 12,4 – 12,6 ms |
| Frame, max | 13,2 – 14,0 ms | 24,1 – 25,0 ms | 13,3 – 14,1 ms |
| **Appels de dessin** | **9 010** | **18 016** | **9 006** |
| **Triangles** | **17 274 051** | **34 548 102** | **17 274 051** |
| **Pools** (`binder.poolSizes`) | 8 géométries, 0 matériaux | idem | idem |
| **Mémoire GPU** (`info.memory.total`) | **88 590 056 o** (84,5 Mo) | **146 987 812 o** (140,2 Mo) | idem |

Un passage sur trois a lu 2,7 Mo de plus des deux côtés (91 436 280 o et 149 833 876 o) pour le même
nombre de textures. C'est l'ordre de grandeur de l'étalement sur la mémoire ; le reste ne bouge pas
d'un octet.

**La médiane n'est pas le vsync.** 11,0 ms n'est ni 8,33 (120 Hz) ni 16,67 (60 Hz), et le p95 est à
1,4 ms au-dessus : la scène est assez lourde pour que la frame soit décidée par le travail et non par
l'écran. C'est ce qu'on demande à une scène de référence, et c'est ce qui manquait au repère de la
compétence `smoke-harness` (65 entités, 8,3 ms — le vsync, donc rien).

### Ce que la mémoire GPU contient

`renderer.info.memory` est la comptabilité de three, pas une estimation : chaque tampon, texture et
cible de rendu y entre à l'allocation et en sort à la libération. C'est un cumul pour tout le
`WebGPURenderer`, donc la colonne Play **contient** ce que le viewport d'édition tient encore.

| | Édition | Play |
|---|---|---|
| Textures | 84 · 86 600 462 o | 163 · 143 098 558 o |
| Attributs | 113 · 968 196 o | 221 · 1 897 764 o |
| Attributs d'index | 829 752 o | 1 659 504 o |
| Cibles de rendu | 5 | 9 |
| Géométries | 54 | 105 |
| Programmes | 22 | 28 |

**Appuyer sur Play coûte 55,7 Mo de plus** — tout est doublé à une unité près. Le moteur construit son
propre `SceneBinder`, ses propres lots, sa propre capture de ciel et sa propre cible de réflexion ; le
viewport ne lâche rien parce que le jeu démarre. C'est le prix, mesuré, de pouvoir regarder la scène
et le jeu côte à côte.

### Ce que les appels de dessin contiennent

Une frame d'édition, décomposée en interceptant `renderer.render` :

| Passe | Appels |
|---|---|
| Carte d'ombre du soleil (caméra orthographique) | 3 000 |
| Réflexion de l'eau (`Scene [ Reflector ]`) | 3 004 |
| Passe couleur | 3 006 |
| **Total** | **9 010** |

**Ce ne sont pas 9 010 soumissions.** Pour un `BatchedMesh`, `WebGPUBackend.js:1832` appelle
`info.update` **une fois par entrée du multi-draw** : le nombre affiché est donc « instances ×
passes », et les soumissions réelles sont les 36 lots. À savoir avant de lire une amélioration dans
ce chiffre.

**Les accessoires sont dessinés trois fois par frame**, et la réflexion de l'eau est la moitié
coûteuse : elle re-rend le champ entier depuis une caméra miroir. Une nappe d'eau dans une scène de
plusieurs milliers d'entités est le poste le plus cher qu'il y ait.

### Le culling par instance ne cull rien

`_multiDrawCount` = `_instanceInfo.length` = 3000, dans les trois lectures. C'est T-056, confirmé sur
une autre scène : une lumière qui projette une ombre éteint le culling par instance du batcher, et
tout projet neuf porte un soleil `castShadow`. Les 3 000 accessoires sont dessinés que la caméra les
voie ou non.

### Les pools tiennent 8 géométries et 0 matériau

Attendu, et ce n'est pas une anomalie à corriger : `ResourceArena.materials` pool les **assets** de
matériau, et les 3 000 accessoires portent un matériau en ligne (`materialId: null`). Un projet qui
utiliserait la bibliothèque de matériaux remplirait cette colonne. Les 8 géométries sont les six
formes, le sol et le plan d'eau — un `BufferGeometry` par définition distincte, partagé par les 3 000.

### La vue Scene continue de dessiner pendant Play

**Le seul écart entre les colonnes 2 et 3, et il vaut 9,3 ms.** Amener l'onglet *Game* au premier plan
n'arrête pas la vue *Scene* : dockview gare l'onglet inactif hors de l'écran **à la taille de la
fenêtre entière** au lieu de le replier, donc `host.clientWidth` reste non nul, `Presentation.visible`
reste vrai, et `EditorViewport.tick` dessine les deux vues. D'où 18 016 appels au lieu de 9 006.

Mesuré, pas déduit : la troisième colonne est le même passage avec `viewport.detachScene()`, et elle
retombe exactement sur le temps d'édition. Inscrit dans `RESTES.md` — **T-060 mesure, T-060 ne
corrige pas.**

## Refaire le relevé

```bash
SCRATCH=/tmp/baseline          # n'importe quel dossier neuf, jamais un projet réel
node docs/chantier/baseline/make-scene.mjs "$SCRATCH/projet"

STUDIO_SMOKE=1 \
STUDIO_SMOKE_PROJECT="$SCRATCH/projet" \
STUDIO_SMOKE_SETTLE=500 \
STUDIO_SMOKE_SETUP="$(cat docs/chantier/baseline/measure.js)" \
npm run dev > "$SCRATCH/run.log" 2>&1

sed -n '/\[smoke\] setup/,/\[smoke\] result/p' "$SCRATCH/run.log"
grep "renderer errors" "$SCRATCH/run.log"
```

Voir la compétence `smoke-harness` pour les règles du harnais — en particulier : jamais en tâche de
fond, jamais dans un tube vers `head`, jamais sur un projet réel.

**Lire `renderer errors: none` avant de croire un chiffre.** Les trois passages ci-dessus sont propres.

### Ce qui doit être identique, et ce qui n'a pas à l'être

Se retrouvent **au chiffre près** sur n'importe quelle machine, parce qu'ils ne dépendent que de la
scène et du code : appels de dessin, triangles, taille des pools, nombre de textures, de géométries,
de cibles de rendu et de programmes. Un écart là est une régression ou un changement de comportement,
pas du bruit.

Ne se retrouvent qu'**en ordre de grandeur** : les temps de frame, et la mémoire à 3 % près. Ils
dépendent du GPU, de la taille de la fenêtre et de l'état thermique.

### Deux pièges qui ont chacun coûté un passage

**La disposition du dock persiste, et elle est partagée par tous les projets.** `DockLayout` écrit
`layouts.json` dans les données d'application à **chaque** changement de disposition. Une première
version de `measure.js` fermait le panneau *Scene* pour isoler le jeu : la disposition sans onglet
*Scene* a été enregistrée, et les deux passages suivants sont morts sur « the viewport never appeared »
— plus rien ne construisait le viewport. `measure.js` détache la vue au lieu de fermer le panneau, et
remet l'onglet *Scene* au premier plan en sortant.

**Un onglet inactif n'a pas la même taille qu'un onglet actif**, et la lecture d'édition a bougé de
1,5 ms selon l'onglet que le passage précédent avait laissé devant. `measure.js` épingle l'onglet
*Scene* avant de mesurer quoi que ce soit. Sans cet épinglage, le relevé mesure le passage d'avant.

## Les fichiers

| | |
|---|---|
| `baseline/make-scene.mjs` | Écrit le projet de référence. Refuse un dossier existant |
| `baseline/measure.js` | Le script de setup du harnais. Les trois lectures, dans un passage |
