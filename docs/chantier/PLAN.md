# Chantier de ré-architecture — Three Studio

## Contexte

Three Studio est un éditeur de jeu 3D (Three.js/WebGPU + Electron + React), 62 k lignes, 5 workspaces,
737 tests, zéro `TODO`, 50 échappatoires de typage. **Ce n'est pas un codebase à réécrire.** Le socle est
déjà bon : tables de composants par type au lieu de tableaux, `Reconciler` piloté par table et non par
`switch`, undo par patches immer, frontières de packages vérifiées par test, formats versionnés.

Le chantier vise trois douleurs nommées par l'auteur, plus ce que l'audit a trouvé sous elles :

1. **Ajouter un type de composant coûte trop cher.** `particleEmitter` de bout en bout = **9 fichiers
   obligatoires** dans `core`+`runtime`, **14** pour qu'il soit utilisable, **~18** avec overlays et
   compagnons. La liste des types de composants est écrite **9 fois** ; **2 seulement** sont vérifiées
   par le compilateur.
2. **Des god objects.** `inspector/schema.ts` 1409 l., `EditorViewport.ts` 963 l. (7 responsabilités),
   `SceneBinder.ts` 892 l. (11 métiers distincts), `assets.ts` 820 l., `ProjectPanel.tsx` 741 l.,
   `documentStore.ts` 704 l.
3. **Le rendu éditeur ≠ le rendu jeu**, et l'Inspector répond mal sur certaines lumières/objets.
   Deux causes distinctes, toutes deux localisées : il y a **trois** projections du même `SceneDoc`
   (édition, Play, build exporté) et **leurs réglages de rendu sont écrits séparément** — `shadowMapSize`
   n'est appliqué que dans l'éditeur, donc un projet réglé sur 4096 obtient 2048 en Play *et* dans le
   build. Et l'Inspector maintient **à la main** un miroir de son propre schéma pour décider quand
   reconstruire un panneau ; ce miroir a déjà divergé.

S'y ajoutent deux sujets demandés explicitement, et l'audit leur a trouvé de la matière :

4. **Le format de projet sur disque** — `project.json` tient un registre de scènes qui **double le
   système de fichiers** et peut périmer, coûte 263 lignes d'invariants, et fait de chaque ajout de
   scène un conflit de merge.
5. **L'export** — six requêtes avant la première frame, une asymétrie sur la scène d'entrée qui coûte
   trois fonctions, et aucun hachage de contenu, donc un cache navigateur périmé au re-export.

Objectif énoncé : un logiciel **utilisable en production par d'autres entreprises**. Cela déplace la barre
au-delà du refactor : contrats typés aux frontières process, validation des entrées, couverture de test
sur les couches aujourd'hui nues, garde-fous qui empêchent l'architecture de re-pourrir.

Contraintes actées : **une seule branche, une seule MR, commits séparés** ; **carte blanche sur les
formats disque** (aucune migration à écrire, personne d'autre n'a de projet) ; `packages/core` reste sans
dépendance ; `packages/runtime` n'importe jamais l'éditeur ; `apps/web-template` doit continuer à
tourner sur le même `SceneHost`.

Et une contrainte de forme qui décide de la structure du chantier : **le plan doit vivre dans le repo**,
découpé en tâches assez autonomes pour qu'une conversation neuve reprenne sur un simple « go ». Voir la
section « Le chantier vit dans le repo ».

---

## Diagnostic

Chaque défaut ci-dessous est constaté, pas supposé, avec sa preuve.

### D1 — La connaissance d'un composant est rangée par couche, jamais par composant

Pour le type `light`, ce qui le définit vit dans 7 fichiers : le type dans `core/src/scene/schema.ts:211-280`,
la fabrique dans `core/src/scene/defaults.ts:133-185` et `:472-505`, la définition dans
`core/src/components/light.ts`, le panneau dans `editor/src/inspector/schema.ts` (dans un `Record` de
637 lignes), le système dans `runtime/src/systems/LightSystem.ts`, l'aide de sélection dans
`editor/src/viewport/overlay/helpers/LightShape.ts`, le marqueur dans
`editor/src/viewport/overlay/markerStyles.ts`.

Les 9 endroits où la liste des types est réécrite, et ce qui les protège :

| Emplacement | Forme | Vérifié ? |
|---|---|---|
| `core/src/scene/schema.ts:533` | union `ComponentDoc` | source de vérité |
| `core/src/scene/components.ts:21` | `COMPONENT_TYPES` | `satisfies` — attrape l'extra, **pas l'oubli** |
| `core/src/components/index.ts:14-25` | 12 `import` | jette au chargement + test |
| `runtime/src/Reconciler.ts:77-83` | `Map` de 5 systèmes | **rien** |
| `runtime/src/behaviour/*` | `registerBehaviour` ×3 | `componentCoverage.test.ts` |
| `editor/src/inspector/schema.ts:390` | `Record<ComponentType, …>` | **compilateur** |
| `editor/src/panels/InspectorPanel.tsx:17` | `ADDABLE` (tableau) | **rien** |
| `editor/src/panels/HierarchyPanel.tsx:96` | `ICON_PRIORITY` | **rien** |
| `editor/src/viewport/overlay/markerStyles.ts:22,32,34` | 3 listes partielles | **rien** |

Un type oublié dans les six lignes « rien » ne casse rien : il donne une icône générique, un objet non
cliquable dans le viewport, une entrée absente du menu Add. On le découvre en s'en servant.

### D2 — Trois projections du même document, aux réglages écrits séparément

`EditorViewport.tick()` (`editor/src/viewport/EditorViewport.ts:562`) branche :

```
playing  → renderer.render(engine.scene, engine.activeCamera)
éditant  → syncDocument() puis renderer.render(this.scene, this.camera)
```

`this.scene` est peuplée par le `SceneBinder` de l'éditeur (`:84`) ; `engine.scene` par un **second**
`SceneBinder` construit dans `Engine` (`runtime/src/Engine.ts:130-175`). `beginPlay` (`:267-383`) prend
déjà soin de partager le renderer, le canvas, le resolver, les matériaux, les prefabs et le contexte
audio — mais chaque binder garde **son propre** `ResourceArena`, `ModelCache`, `MeshBatcher`, et son
propre sous-système environnement/IBL de ~280 lignes (`SceneBinder.ts:334-662`).

**La divergence la plus nette, et c'est très probablement celle que tu vois :**
`shadowMapSize` n'est écrit **qu'à un seul endroit dans tout le repo** — `EditorViewport.ts:187-189`,
depuis `project.settings.rendering.shadowMapSize`. `EngineOptions` (`Engine.ts:39-90`) **n'a pas ce
champ**, le constructeur ne l'écrit jamais, et `SceneBinder.ts:109` vaut `2048` par défaut. `LightSystem`
le lit via `ctx.shadowMapSize` (`:48`, `:115`, `:185`).

> Un projet réglé sur 4096 obtient **4096 dans la vue Scene, 2048 en Play, et 2048 dans le build exporté.**

**Et le build exporté est un troisième mode divergent.** `apps/web-template/src/main.ts:148` appelle
`createRenderer({ canvas, forceWebGL: build.forceWebGL })` : `antialias`, `maxPixelRatio`, `shadows` et
`exposure` sont **jetés**. Ça ne se voit pas encore parce que les défauts de `createRenderer` coïncident
avec ceux de `createRenderingSettings()` — un accord accidentel, qui se rompra à la première modification
de l'un des deux.

**Play se téléporte.** Quand une scène n'a pas de caméra, `Engine.pickCamera` place la caméra de secours
en `(8,6,12)` regardant l'origine (`Engine.ts:443-444`) — exactement la pose *initiale* de la caméra
d'édition (`EditorViewport.ts:174-176`). Volez ailleurs, appuyez sur Play : la vue saute.

Les autres divergences, chacune visible à l'écran :

- `SceneBinder.shadowMapSize` est un champ public mutable (`:109`) — deux binders, deux valeurs possibles.
- `batching` : l'éditeur écrit `true` (`EditorViewport.ts:193`), `Engine` a `true` par défaut
  (`:137`), et `beginPlay` n'en passe aucun. Ils s'accordent parce que **deux défauts écrits séparément
  s'accordent**. Le commentaire de `Engine.ts:135-136` (« allumé pour un jeu, éteint dans l'éditeur »)
  est périmé et décrit une divergence qui serait réelle si on le croyait.
- `binder.batching` est un setter (`:135`) et `Engine` reçoit `batching` en option ; `MeshBatcher`
  abandonne `perObjectFrustumCulled` dès qu'**une** lumière projette une ombre (`MeshBatcher.ts:403`) et
  coupe `frustumCulled` (`:433`) et `sortObjects` (`:419`). Un désaccord de batching se voit.
- `buildFallbackLighting()` (`EditorViewport.ts:935`) ajoute une hémisphérique + une directionnelle
  quand la scène n'a aucune lumière. **Éditeur uniquement** : la scène est éclairée en édition et noire
  en Play.
- La radiance du ciel est capturée par PMREM en 256 px **par binder**, deux fois, à des frames différentes.
- La caméra d'édition est une perspective 60° / 0.1 / 5000 codée en dur ; celle du jeu vient d'un
  `CameraComponent` avec ses propres fov/near/far.

**Rien n'assure que les deux s'accordent, et rien ne le teste.**

Deux conséquences de structure, vérifiées, qui tiennent à la même cause :

- **Il n'y a qu'un seul canvas**, déplacé entre le panneau Scene et le panneau Game
  (`ViewportPanel.tsx:22-42` se détache dès que `playState !== 'stopped'`, `GamePanel.tsx:24-32`
  s'attache). On ne peut donc **jamais voir la scène et le jeu en même temps** — ce que Unity et Unreal
  font tous les deux, et ce que la comparaison visuelle exigerait précisément ici.
- L'aperçu de la boîte d'import crée un **second renderer** (`import/preview/ModelPreview.ts:61`,
  avec `shadows: false`). `rendererCount() > 1` fait alors **cesser de dessiner le viewport principal**
  (`EditorViewport.ts:557`) — le remède à un vrai bug de `WebGPURenderer` (deux renderers dans la même
  frame se détruisent mutuellement leur render target), mais qui se lit à l'écran comme « le viewport
  s'est figé ».

### D3 — Inspector : un miroir maintenu à la main

`editor/src/inspector/buildInspector.ts:401-460` contient `inspectorSignature()`, un `switch` à 9 bras qui
**réécrit à la main** chaque prédicat `visibleWhen` déclaré dans `schema.ts`. Il finit sur
`default: return component.type`. Conséquence : un type dont le champ structurant n'est pas nommé dans ce
`switch` **ne reconstruit jamais son panneau** — les valeurs se rafraîchissent, les lignes conditionnelles
n'apparaissent pas. C'est exactement le symptôme « la lumière répond mal à l'Inspector ».

Deux copies supplémentaires du même savoir : `RAD_TO_DEG`/`DEG_TO_RAD` sont définis à l'identique dans
`schema.ts:167` et `buildInspector.ts:47` ; chaque union du document est ré-énumérée en littéral Tweakpane
`{ Label: 'value' }`, non vérifié contre `core` (`sameShape()` dans `sceneCommands.ts:534` est le rustine
d'exécution de ce trou).

### D4 — Les contrats de frontière sont recopiés, pas dérivés

`StudioBridge` est typé **une seule fois** dans `core/src/bridge.ts:268` — c'est le bon modèle. Mais :

- **47 noms de canaux IPC** sont des littéraux dupliqués entre `apps/desktop/src/main/ipc.ts` (45
  `handle` + 2 `send`) et `apps/desktop/src/preload/index.ts`. Rien ne lie la signature d'un handler au
  membre de `StudioBridge` correspondant. Une faute de frappe est une erreur d'exécution, pas de compilation.
- **Aucune validation d'exécution des arguments IPC, nulle part.** `project:updateSettings`
  (`ipc.ts:484`) étale un patch venu du renderer directement dans `project.json`.
- **`build.json`** est écrit par un littéral non annoté (`exportWeb.ts:248-273`) et relu via une interface
  redéclarée à la main (`apps/web-template/src/main.ts:39-65`), plus une troisième copie partielle
  (`entryScene.ts:4-9`). C'est le seul contrat inter-process qui ne soit pas centralisé.
- **`RUNTIME_DTS`** (`main/scripts.ts:114-289`) est ~115 lignes de TypeScript en template literal qui
  recopient à la main `ScriptPropertyDef`, `EntityHandle`, `AudioBus`, `StudioInput`, `StudioAudio` et la
  classe `Behaviour` avec ses 7 hooks. Les noms de hooks apparaissent une **troisième** fois dans
  `RESERVED_PROPERTY_NAMES` ; `AudioBus` une **quatrième** dans le schéma de l'Inspector.

### D5 — God objects, mesurés par responsabilité et non par taille

| Fichier | l. | Métiers distincts |
|---|---|---|
| `editor/src/inspector/schema.ts` | 1409 | vocabulaire de champ · convertisseurs · géométries · matériaux · **12 panneaux de composants** · panneau de scène · compilateur de propriétés de script |
| `editor/src/viewport/EditorViewport.ts` | 963 | renderer · caméra · canvas · boucle de frame · cycle Play · construction du `SceneHost` · arbitrage pointeur · clic-sélection · resize · stats · éclairage de secours · diff d'expansion prefab. Lit 8 stores. |
| `runtime/src/SceneBinder.ts` | 892 | racine · sous-objets · `SystemContext` · swap de resolver · bibliothèque de matériaux · boucle d'entités · **environnement/IBL (~280 l.)** · file de retrait · requête `sunOf` · services éditeur |
| `desktop/src/main/assets.ts` | 820 | scan/adopt · sidecars concurrents (`link()` en CAS) · sniffing de contenu · mutations · bibliothèques prefab/matériau · utilitaires exportés à 4 modules |
| `editor/src/panels/ProjectPanel.tsx` | 741 | navigateur · fil d'Ariane · tuiles · liste · waveform · scrubber audio · drag/drop · import — **sur un abonnement au store entier** (`:77`) |
| `editor/src/state/documentStore.ts` | 704 | scène · historique · 4 compteurs de révision · journal hors-zustand · élagage de sélection · validation DEV · notifications de bibliothèque |

### D6 — Deux cycles d'import dans l'éditeur, et des violations de couche

```
importStore → plan → settingsPane → PaneBinder → assetField → importStore
viewportHost → EditorViewport → sceneFiles → projectStore → viewportHost
```

Violations qui les produisent : `state/toastStore.ts:2` importe un composant React (`../ui/Alert`) ;
`state/projectStore.ts:10` importe `../viewport/viewportHost` et appelle
`peekViewport()?.binder.setAssetResolver(...)` (`:75`) ; `inspector/schema.ts:24` appelle
`peekViewport()?.binder.containerFor(entityId)` (`:801`) ; `viewport/EditorViewport.ts:35` lit
`overlayStore` pour décider s'il dessine.

### D7 — Des couches entières sans aucun test

`ipc.ts` (45 handlers, la fan-out `announce()`, `activeProjectPath`, `exportedDirs`) : **0 test**.
`windows.ts` (toute la politique multi-fenêtres) : **0 test**. `preload/index.ts` (le parsing d'`argv`
et de la query string) : **0 test**. `protocol.ts`, `security.ts`, `preferences.ts`, `recentProjects.ts` :
**0 test chacun**. Les **30 fichiers `.tsx`** de l'éditeur : **0 test** — il n'y a ni jsdom, ni
happy-dom, ni `@testing-library` dans le repo. Le seul bout-en-bout est `main/smoke.ts`, qui ne tourne
jamais en CI.

`npm run typecheck` **ne typecheck pas** `apps/*/test/**` : le `include` du `tsconfig.json` racine les
omet, soit ~99 cas de test jamais vérifiés.

### D8 — Duplications transverses

Écriture atomique via `.tmp` : **5 copies** à la main, avec 5 gestions d'erreur différentes.
Sanitisation de nom de fichier : **2 classes de caractères différentes** sur 8 sites, appliquées à des
noms qui atterrissent dans la même arborescence. URL `studio-asset://` construite à la main **4 fois**.
Alias des packages du workspace : **4 copies** (`tsconfig.base.json`, `vitest.config.ts`, les deux
configs Vite) — et l'alias `three → three/webgpu` manque dans `vitest.config.ts`. Extensions de modèle et
d'image : 2 et 3 copies partiellement divergentes. `KIND_FILTERS` (`ProjectPanel.tsx:59`) a **déjà
divergé** : `'prefab'` y manque et le type ne peut pas l'attraper.

### D9 — Les décisions sont citées partout et n'existent nulle part

63 citations d'**ADR-1 … ADR-16** dans le code, et **aucun document ADR dans le repo**. La numérotation
entre en collision : `ADR-4`, cité 14 fois, désigne « un seul `AudioContext`, deux racines » dans
`runtime/src/audio/*` **et** la propriété d'aller-retour de l'undo dans `editor/test/history.test.ts` —
deux séries distinctes sous les mêmes numéros.

| ADR | cites | sujet visible dans les citations |
|---|---|---|
| 4 | 14 | **collision** : contexte audio / propriété de l'undo |
| 16 | 9 | tables de composants, pas de scan par frame |
| 12 | 8 | une scène par fenêtre |
| 15 | 8 | une référence est un id, jamais un nom ni un chemin |
| 7 | 6 | le contexte est un paramètre, jamais un `new` enfoui |
| 9 | 5 | (audio) l'auditeur : le composant, sinon la caméra active |
| 6, 14 | 3 | faits d'un fichier via le renderer / — |
| 13 | 2 | l'entité racine n'est ni protégée ni spéciale |
| 1, 2, 3, 5, 8 | 1 | — |

S'y ajoutent **13 identifiants de bugs** `B1`…`B15` cités dans les commentaires (« ce qui ferme B15 »,
« c'est B8 »), sans registre non plus. Le raisonnement lui-même n'est pas perdu — il est dans les
commentaires, souvent en détail — mais il n'est plus adressable.

### D10 — Le moteur : les endroits où l'on se bat contre Three.js

À garder en tête, car ils bornent ce qu'on peut simplifier :

- `MeshBatcher` **abandonne le frustum culling par objet dès qu'une lumière projette une ombre**
  (`:403`). Une scène avec un seul soleil ombré = aucun culling sur les meshes batchés.
- `refreshDrawList` (`:283`) rend une instance invisible puis visible pour forcer three à reconstruire
  une multi-draw list qu'il n'expose par aucun drapeau.
- `StudioTime.install()` (`time/StudioTime.ts:17`) remplace les singletons TSL `time`/`deltaTime` de three.
- `WaterSurface.ts` est un fork maintenu de 298 lignes de `WaterMesh.js` de three.
- `SceneBinder.equirectangular` (`:501-560`) réimplémente la détection de disponibilité parce que
  `HDRLoader`/`EXRLoader` renvoient un placeholder 1×1 que `PMREMNode` prend pour prêt et cache à jamais.
- `patches/three+0.185.1.patch` corrige `FBXLoader`, réappliqué à chaque install.
- `scanAssets` fait une **marche récursive complète** de `assets/` à **chaque** mutation
  (`ipc.ts:302` rappelle `assets:list` après chacune, et `assetStore.ts` l'appelle depuis 14 sites).
  Un renommage coûte un parcours O(n) du disque.
- `EntityDoc.chunk?: string` (`core/src/scene/schema.ts:569`) **n'est lu nulle part** : un champ de
  streaming déclaré et jamais implémenté. À implémenter ou à retirer, pas à laisser.
- Il n'y a **aucun pipeline de post-traitement** dans le runtime — seule la scène décorative du lanceur
  utilise `pass()`. Ce n'est pas un défaut, c'est une absence à nommer : un éditeur destiné à la
  production en aura besoin, et le pipeline unifié ne doit pas l'interdire.

### D11 — Le registre de commandes couvre 7 gestes sur ~50

`editor/src/commands/registry.ts:55-62` déclare un `CommandId` fermé de **sept** entrées
(`undo | redo | save | duplicate | delete | group | rename`). À côté, `commands/` exporte **~50 fonctions
libres** qui sont exactement des gestes — `addEntity`, `deleteSelection`, `reparentSelection`,
`transformSelection`, `createPrefabFromEntity`, `unpackModel`, `runExport`, `startPlay`,
`addComponentWithDependencies`… — sans `can()`, sans label, sans identifiant, appelées directement par
React et par les boutons Tweakpane. `rename` est même un demi-geste : son `run` délègue à un emplacement
mutable de module (`registry.ts:227`) que le panneau hiérarchie remplit.

Ce n'est pas une faute de style, c'est ce qui **rend trois fonctionnalités impossibles** : une palette de
commandes, des raccourcis remappables, et le pilotage de l'éditeur par script — les trois attendues d'un
outil professionnel.

### D12 — Deux systèmes parallèles pour « déclarer une propriété éditable »

`runtime/src/scripting/ScriptApi.ts:9-19` déclare `ScriptPropertyDef` — 8 variantes
(number, boolean, string, color, vec3, enum, entity, asset). `editor/src/inspector/schema.ts:66`
déclare `FieldSpec`, et `COMPONENT_SCHEMAS` s'en sert pour les 12 composants. Ce sont **le même concept**.
`scriptFields()` (`schema.ts:1313-1408`) est un adaptateur d'une centaine de lignes, avec un `switch` sur
`def.type`, qui traduit l'un vers l'autre.

Un champ de composant et une propriété de script devraient partager un seul vocabulaire. C'est aussi,
très exactement, le vocabulaire dont aurait besoin une extension tierce — voir ci-dessous.

### D14 — Le format de projet : un registre de scènes qui double le système de fichiers

Ce qu'un projet est aujourd'hui sur disque :

```
MyProject/
  project.json     version, name, engineVersion, scenes[{id,name,path}], startScene, settings{…}
  scenes/main.scene.json
  assets/models|textures|materials|scripts/…  + un .meta.json par fichier
  .studio/         caches, tsconfig et .d.ts des scripts, .gitignore '*'
```

- **`scenes[]` est un cache du système de fichiers, et il peut périmer.** L'`id` est déjà *dans* le
  document de scène, le `name` est dérivable du chemin (`sceneName()` existe déjà,
  `project/schema.ts:88`), et le `path` est où le fichier se trouve. Ce registre coûte `scenes.ts`
  (263 l.) et **quatre invariants** tenus à la main (noms uniques, `startScene` valide, les profils
  suivent une suppression, la dernière scène reste). Supprimer un `.scene.json` dans le Finder → le
  projet refuse de s'ouvrir. En ajouter un à la main → il est invisible.
- **`project.json` est un aimant à conflits de merge.** Registre de scènes + rendu + physique + profils
  de build dans un seul fichier : deux personnes qui ajoutent chacune une scène entrent en conflit.
- **`readProjectFile` refuse de migrer** (`project.ts:170-183`) : `version < PROJECT_FORMAT_VERSION`
  lève « Create it again ». Politique intenable pour un outil de production.
- **Le scaffolding crée 4 dossiers d'assets sur 7** (`project.ts:47` code en dur
  `models|textures|materials|scripts`) alors que `ASSET_KIND_INFO` en déclare sept.
- **`engineVersion` est écrit et jamais lu.** `assets/manifest.json` est documenté dans l'en-tête de
  `project/schema.ts:9` et **jamais écrit**.
- **Aucun `.gitignore` à la racine du projet créé** — seulement dans `.studio/`.
- **`serializeScene` est `JSON.stringify(scene, null, 2)`** (`serialization.ts:21`) : l'ordre des clés
  suit l'ordre d'insertion, donc il dépend de l'historique d'édition. Un diff de scène est illisible et
  ingérable en revue.
- **Aucun verrou** : deux fenêtres d'édition sur le même projet écrivent toutes deux `project.json`.

### D15 — L'export : six requêtes et une asymétrie qui coûte trois fonctions

Ce qu'un build produit :

```
out/
  index.html      _studio/…        le player prébâti (Vite)
  assets/…        les fichiers du projet, noms d'origine
  scene.json      la scène d'entrée, renommée, à la racine
  scenes/<nom>.scene.json          les autres
  assets.json  materials.json  prefabs.json  scripts.mjs  build.json
```

- **Six requêtes avant la première frame** (`build.json`, `assets.json`, `materials.json`,
  `prefabs.json`, `scene.json`, `scripts.mjs`). Les trois du milieu sont petites et toujours nécessaires.
- **L'asymétrie de la scène d'entrée coûte trois fonctions.** Elle est renommée en `scene.json` à la
  racine pendant que les autres vont dans `scenes/` — d'où `sceneMap` qu'il faut clé **et par nom et par
  id** (`exportWeb.ts:222-224`), `loadingSceneName()` qui re-résout un id en nom, et `sceneFileName()`.
- **Aucun hachage de contenu sur les assets copiés.** Le bundle Vite est haché, les fichiers du projet
  gardent leur nom : re-exporter avec une texture modifiée sert la version périmée depuis le cache du
  navigateur. Or l'indirection existe déjà — `assets.json` mappe id → chemin, le player ne voit jamais
  un nom de fichier.
- **Aucun manifeste des fichiers émis avec leurs empreintes**, donc un build n'est pas vérifiable en CI.
- **Aucun rapport de taille, aucune compression** (Draco, KTX2, WebP). Une absence à nommer.

*Ce qui est déjà bien fait et qu'on ne touche pas :* le `<base href>` unique plutôt qu'une réécriture
d'URL ; `assetsDir: '_studio'` dans la config Vite du player, avec le commentaire qui dit précisément
pourquoi (« deux choses qui écrivent dans un même dossier, c'est une collision qui attend la première
texture nommée comme un chunk ») ; la copie des compagnons d'un `.gltf`.

### D13 — Rien d'extérieur ne peut ajouter quoi que ce soit

Tout est compilé dans le binaire : les types de composants, les systèmes, les panneaux, les importeurs,
les commandes. Une entreprise qui adopterait l'outil ne peut pas ajouter un type de composant maison, un
importeur pour son format interne, ni un panneau. **C'est la fonctionnalité manquante la plus lourde**
pour l'objectif « utilisable en production par d'autres entreprises ».

Le remède n'est pas d'écrire un système de plugins maintenant — il n'aurait aucun second implémenteur
aujourd'hui, et ce serait exactement le point d'extension spéculatif qui coûte cher à vie. Le remède est
que **la tranche verticale (A1) et le vocabulaire de champ unifié (D12) sont précisément ce qui le rendra
possible plus tard** : une fois qu'un type de composant est trois fichiers qui s'enregistrent, un plugin
est ces trois mêmes fichiers chargés autrement. À acter comme décision, pas à coder.

---

## Architecture cible

Cinq principes, chacun avec le défaut qu'il ferme.

### A1 — Tranche verticale par type de composant  *(ferme D1)*

Un type de composant est **un dossier par package**, jamais une ligne dans six tables :

```
packages/core/src/components/light/
  schema.ts      LightKind, ShadowSettings, LightComponent      (sort de scene/schema.ts)
  defaults.ts    createLight, createShadowSettings, createLightEntity  (sort de scene/defaults.ts)
  index.ts       defineComponent({ type:'light', create, fill, assets, icon, runtime })

packages/runtime/src/components/light/
  LightSystem.ts + son enregistrement           (le Reconciler ne le nomme plus)

packages/editor/src/components/light/
  inspector.ts   le panneau Tweakpane           (sort de inspector/schema.ts)
  overlay.ts     LightShape + style de marqueur (sort de overlay/helpers/ + markerStyles.ts)
  menu.ts        l'entrée du menu Add           (sort de shell/addMenu.ts)
```

`scene/schema.ts` ne garde que l'union et les primitives partagées ; `scene/defaults.ts` ne garde que
transform/material/geometry et les fabriques de scène. Le cycle que `components/index.ts:60-66` documente
disparaît de lui-même : une définition n'importe plus `defaults.ts`, elle **contient** sa fabrique.

**Le mécanisme qui rend l'oubli impossible n'est pas à inventer : c'est `Record<ComponentType, X>`.**
Le codebase s'en sert déjà — `COMPONENT_SCHEMAS` est la *seule* des neuf listes que le compilateur
protège, et c'est parce qu'elle est un `Record` total. Les six listes non protégées sont des **tableaux**
ou des `Partial<Record<…>>`, deux formes où l'omission est légale.

| Aujourd'hui | Devient |
|---|---|
| `ADDABLE: readonly ComponentType[]` | dérivé du registre (`componentDefinitions()`), plus de liste du tout |
| `ICON_PRIORITY: readonly ComponentType[]` | `Record<ComponentType, number>` — un ordre reste un ordre, et il est total |
| `markerStyles.STYLES: Partial<Record<…>>` | `Record<ComponentType, MarkerStyle \| null>` — le `null` est une décision, pas un oubli |
| `RENDERABLE`, `PRIORITY` (tableaux) | dérivés de ce `Record` |
| `Reconciler`'s `Map` de 5 systèmes | les systèmes s'enregistrent ; `componentCoverage.test.ts` vérifie déjà la couverture |
| `COMPONENT_TYPES` (tableau, omission silencieuse) | déjà couvert par le `throw` de `components/index.ts:39` et `registry.test.ts` — ne rien ajouter |

Aucun nouvel helper de type, aucun nouveau mécanisme : on convertit six formes permissives en la forme
totale que le langage vérifie déjà, et on supprime deux listes en les dérivant.

Coût cible d'un nouveau type : **une ligne dans l'union `ComponentDoc`, puis trois dossiers à la même
adresse dans les trois packages**. Aucun fichier existant à retrouver et à modifier, et chaque dossier
manquant est une erreur de compilation ou un test rouge — contre 14 fichiers dispersés aujourd'hui, dont
un seul est attrapé par `tsc`.

### A2 — Un seul jeu de réglages, une seule façon de construire une projection  *(ferme D2)*

Les trois modes (édition, Play, build exporté) gardent chacun leur binder — leurs durées de vie sont
authentiquement différentes — mais cessent d'avoir chacun leurs réglages. Ce qui doit en sortir :

- `RenderingSettings` est **l'objet unique qui décide de l'apparence**, et il traverse les trois modes.
- `shadowMapSize` et `batching` cessent d'être des champs publics mutables : ils sont pris à la
  construction et deviennent `readonly`.
- **Un seul constructeur nommé**, `bindScene()`, qui porte l'ordre des opérations dans sa docstring, avec
  deux sites d'appel et deux seulement.
- `EngineOptions.rendering` **requis** : le typecheck refuse un mode qui l'oublie.
- L'éclairage de secours devient un overlay déclaré qui **dit son nom des deux côtés**.
- Un **test de parité** qui échoue quand deux modes divergent, sur une liste d'exceptions nommées.

Le raisonnement complet — pourquoi partager le binder ou l'arène est un piège, et ce que ça coûte de ne
pas les partager — est en section « Pipeline unifié » ci-dessous.

### A3 — Les contrats de frontière sont dérivés, jamais recopiés  *(ferme D4)*

- **IPC** : une table de canaux unique, typée depuis `StudioBridge`, d'où l'on dérive et
  l'enregistrement `ipcMain.handle` et le pont preload. Un handler manquant ou une signature qui
  diverge devient une erreur de compilation.
- **Validation à la frontière** : tout ce qui vient du renderer et finit sur le disque est validé, avec
  des gardes écrites à la main dans `core` (aucune dépendance nouvelle — c'est le même idiome que
  `fillComponent`, qui existe déjà).
- **`BuildManifest`** monte dans `packages/core` ; `exportWeb.ts` le renvoie typé, `web-template`
  l'importe. Les trois déclarations deviennent une.
- **`RUNTIME_DTS`** cesse d'être un template literal recopié : il est produit à partir des vraies
  sources, ou à défaut un test compile le `.d.ts` généré contre `ScriptApi` réel.

### A4 — Découper par responsabilité  *(ferme D5, D6)*

Aucun fichier ne garde plus d'un métier. Le découpage suit les responsabilités relevées en D5, pas un
seuil de lignes. Les deux cycles d'import sont cassés en retirant les trois violations de couche qui les
ferment (un store n'importe ni une vue ni le viewport ; une table de champs déclarative n'appelle pas le
renderer).

### A5 — Des garde-fous qui empêchent la re-pourriture  *(ferme D7, D8)*

- Le test de frontière de packages passe d'un scan regex sur `src/` à une **vraie analyse du graphe
  d'imports**, étendue à `apps/` et aux tests, avec **détection de cycles**.
- Le `include` du `tsconfig.json` racine couvre enfin `apps/*/test/**`.
- Les couches nues (`ipc.ts`, `windows.ts`, `preload`) deviennent testables par extraction des handlers
  en fonctions pures — `IpcDeps` existe déjà et montre la voie.
- Les duplications de D8 sont collapsées en un module chacune (`atomicWrite`, `safeFileName`,
  `assetUrl`, les alias de workspace lus depuis une source unique).

---

### A6 — Le projet : le disque est la vérité  *(ferme D14)*

**Les scènes se découvrent, elles ne se déclarent plus.** `scenes/**/*.scene.json` est la liste ; l'`id`
se lit dans le document, le `name` se dérive du nom de fichier. `project.json` ne garde que ce qui n'est
pas dérivable : `startScene` (un id), `loadingScene`, `rendering`, `physics`, les profils de build.

Ce que ça supprime : le registre, ses quatre invariants, l'essentiel de `scenes.ts` (263 l.), et la classe
entière de bugs « le fichier et le registre ne sont plus d'accord ». Ce que ça rend possible : copier une
scène dans le Finder et la voir apparaître, supprimer un fichier sans casser le projet, et deux personnes
qui ajoutent chacune une scène sans conflit de merge.

Ce que ça coûte : ouvrir un projet lit l'en-tête de chaque `.scene.json` pour son id. Quelques dizaines de
petites lectures, mises en cache dans `.studio/scenes.index.json` (chemin + mtime + taille), invalidé par
mtime — le même mécanisme que pour les assets ci-dessous.

Le reste :

- **Migrer au lieu de refuser.** `readProjectFile` cesse de lever sur une version antérieure.
- **`.studio/assets.index.json`** : chemin + mtime + taille par asset, pour que `scanAssets` coûte
  O(ce qui a changé) au lieu de O(tout) à chaque mutation (D10, jalon 7.2).
- **Sérialisation à clés triées.** `serializeScene` trie ses clés : un diff de scène redevient lisible et
  reviewable, ce qui est la condition pour qu'un projet vive dans git.
- Les 7 dossiers d'assets scaffoldés depuis `ASSET_KIND_INFO`, pas depuis une liste de 4 en dur.
- Un `.gitignore` à la racine du projet créé (`.studio/`, et rien d'autre).
- `engineVersion` : soit un lecteur, soit la suppression. `assets/manifest.json` : sortir de la doc.
- Les sidecars `.meta.json` **restent**. C'est ce qui fait voyager l'id avec le fichier, survivre au
  renommage d'un dossier et fonctionner dans git. Le problème n'était pas le sidecar, c'était le scan.

### A7 — L'export : un manifeste, des scènes par id, des noms hachés  *(ferme D15)*

```
out/
  index.html   _studio/…                 le player prébâti — inchangé
  build.json                             manifeste : + materials, prefabs, table des assets
  scenes/<sceneId>.json                  toutes les scènes, y compris l'entrée
  assets/<nom>.<hash8>.<ext>             hachés par contenu
  scripts.mjs
```

- **`assets.json`, `materials.json` et `prefabs.json` se replient dans `build.json`.** Six requêtes
  avant la première frame deviennent trois. Les trois repliés sont petits et toujours nécessaires.
- **Toutes les scènes sous `scenes/<id>.json`, adressées par id.** Disparaissent : `sceneMap` clé deux
  fois, `loadingSceneName()`, `sceneFileName()`, et la question « nom ou id ? » à chaque frontière.
- **Noms d'assets hachés par contenu.** L'indirection id → chemin existe déjà dans le manifeste, donc
  c'est gratuit — et ça règle le cache navigateur périmé au re-export.
- **`build.json` porte `rendering`** (voir A2) : le build cesse d'être un troisième mode divergent.
- **Un manifeste des fichiers émis avec leur empreinte**, pour qu'un build soit vérifiable en CI.
- **Un rapport de taille** par catégorie dans `ExportResult` — ce que l'auteur regarde en premier.
- La compression (Draco, KTX2, WebP) est **nommée et laissée dehors** : c'est une fonctionnalité, pas une
  dette, et elle entre par le seam des importeurs quand on la voudra.

---

## Pipeline unifié — la décision de fond

L'invariant visé : **ce qu'on voit en éditant est ce qu'on voit en jouant, aux overlays d'éditeur près,
et la liste de ces overlays est écrite quelque part.**

Deux façons d'y arriver, et elles ne se valent pas.

Trois façons d'y arriver. La première est tentante et fausse, la deuxième aussi, et c'est la troisième
qui tient.

**1. Le moteur emprunte le binder de l'éditeur.** Tué net par un fait du code : `SceneHost.swap`
(`SceneHost.ts:173-209`) peut déplacer le moteur vers un **autre** `SceneDoc` — un script appelant
`scenes.go('Level2')` fait exactement ça, et `beginPlay` l'autorise explicitement. Le binder de l'éditeur
tiendrait alors le Level 2 pendant que `useDocumentStore` tient le Level 1 : le `Picker`, le
`SelectionOutline`, le gizmo et les marqueurs résolvent tous leurs ids par `binder.getObject`, et
pointeraient sur un graphe qui ne correspond plus au document. Aujourd'hui c'est impossible par
construction. Ajoutons que `SceneBinder.environmentScene` (`:353`) est un champ **unique** : un binder ne
sert qu'une seule `Scene`. Et `Engine.dispose()` appelle `this.binder.dispose()` (`:383`), donc Stop
détruirait le binder de l'éditeur.

**2. L'éditeur fait tourner un `Engine` en permanence, sans simuler.** `Engine` n'a **pas** de sync
incrémental : il synchronise une fois dans le constructeur (`:140`) et plus jamais. Toute la latence
d'édition tient au dirty set (`expandDirty`, `setMaterialLibrary` qui renvoie les ids invalidés). Et
`Engine.create` est `async` et attend chaque modèle (`:253`), alors que `syncDocument` est synchrone dans
`tick`. On finirait avec un `EngineOptions` portant `enablePhysics`, `enableBehaviours`, `enableInput`,
`incremental` — quatre drapeaux à un consommateur chacun, exactement l'anti-motif.

**3. Retenu — deux binders, mais un seul chemin de construction et un seul jeu de réglages.**
Ce qui fait mal n'est pas qu'il y ait deux objets binder : c'est que **les réglages vivent sur des champs
publics mutables, écrits par deux sites d'appel différents, dans deux ordres différents**. On corrige les
réglages, pas le nombre d'instances. Les deux binders ont d'ailleurs des durées de vie authentiquement
différentes : celui de l'éditeur doit survivre à Play et rester lié au *document* ; celui du moteur doit
pouvoir être jeté à chaque changement de scène.

> **Correction d'une piste que j'avais prise.** J'avais d'abord proposé de partager `ResourceArena`,
> `ModelCache` et la bibliothèque de matériaux entre les deux modes. C'est faux, et pour une raison
> précise : la file de retrait de l'arène est vidée par `beginFrame`, et **un seul** des deux appelants
> tourne par frame selon le mode (`tick` sort tôt en Play, `EditorViewport.ts:617`). Arène partagée →
> soit plus personne ne vide ce que le moteur retire, soit on vide deux fois dans la même frame, ce qui
> est très exactement le bug B6 que `ResourceArena.ts:87-95` documente. Et les refcounts de `SharedPool`
> enjamberaient deux durées de vie : Stop décrémenterait des clés que l'éditeur tient encore.

Le mécanisme, en trois changements, sans nouvelle classe ni nouveau point d'extension :

1. **`RenderingSettings` devient l'objet unique qui décide de l'apparence.** Il existe déjà
   (`core/src/project/schema.ts:107-122`). Il gagne un champ `batching`. Pas de bump de version :
   `main/project.ts:188` fait déjà `{ ...createRenderingSettings(), ...settings.rendering }`.
2. **`SceneBinder` reçoit ses réglages à la construction**, et ils deviennent `readonly`.
   `shadowMapSize` (`:109`) et la paire d'accesseurs `batching` (`:131-137`) cessent d'être mutables.
3. **Un constructeur nommé unique, `bindScene(scene, doc, options)`**, qui porte l'ordre dans sa
   docstring — matériaux avant le premier sync (sinon tout matériau lié retombe silencieusement sur sa
   copie embarquée), renderer avant l'environnement (capturer un ciel analytique, c'est six draw calls),
   entités avant environnement (qui lit les matrices monde qu'on vient d'écrire). **Deux sites d'appel et
   deux seulement** : `Engine`, et le `createEditorProjection` de l'éditeur.

**Ce qui rend l'oubli impossible : `EngineOptions.rendering` est requis, pas optionnel.** Le typecheck
échoue tant que `beginPlay` et `apps/web-template/src/main.ts` n'en fournissent pas un. C'est une
garantie plus forte qu'un test, parce qu'elle ne peut pas être sautée. `EngineOptions.batching` (`:84`)
est supprimé — il vit maintenant dans `rendering`. Et le build exporté cesse d'être un troisième mode :
`build.json` porte `rendering`, le player le lit.

Le coût qu'on **assume et documente au lieu de le supprimer** : pendant Play il existe trois `ModelCache`
(éditeur `SceneBinder.ts:158`, moteur `Engine.ts:131`, préchargeur `SceneHost.ts:102`), donc chaque glTF
est résident deux à trois fois et chaque ciel équirect subit une seconde cuisson PMREM. C'est de la
mémoire GPU pendant la durée de Play, pas de la latence. Le remède (`releaseEnvironment()` sur `beginPlay`)
serait une méthode publique à un seul appelant, et ferait clignoter la couleur de fond au Stop. On
l'écrit dans un commentaire, on ne le construit pas.

L'éclairage de secours reste, mais **dit son nom des deux côtés** : un booléen dans `useViewportStore`,
une ligne dans la boîte de stats qui existe déjà (`ViewportPanel.tsx:114-147`) — `Lighting · Editor
default` — et un warning du moteur dans le vocabulaire que `checkPhysicsSetup` emploie déjà : « cette
scène n'a pas de lumière, elle rend noir ; la vue Scene montre un éclairage par défaut qu'un build n'aura
pas ». `GamePanel.tsx:64-78` affiche déjà `playWarnings` : aucune plomberie nouvelle.

Et la liste des différences devient une **constante exportée** — `EDITOR_OVERLAYS` : grille, marqueurs
d'entité, aides de sélection, contour, gizmo, éclairage d'aperçu. Ce qui diffère et n'est pas sur cette
liste est un bug, et le test de parité est ce qui le dit.

### Le test de parité, concrètement

Vitest tourne en `environment: 'node'` — pas de GPU, pas de jsdom. On ne peut donc pas comparer des
pixels. Mais on n'en a pas besoin : `SceneBinder` est déjà construit sans renderer dans
`runtime/test/sceneBinder.test.ts` (813 l.) et `runtime/test/systems/systems.test.ts` (699 l.). Le graphe
est donc **descriptible sans dessiner**.

Le digest — un **helper de test**, `packages/runtime/test/sceneDigest.ts`, pas du code livré : il n'a
aucun appelant en production aujourd'hui. Il ne lit que l'API publique (`binder.root`, `binder.poolSizes`,
`resolveEntityId`) et **rien qui porte un `uuid`** : l'identité est encodée structurellement.

```ts
interface ProjectionDigest {
  /** `scene.children` hors racine du binder, par nom. Vide en Play, EDITOR_OVERLAYS en édition. */
  overlays: string[];
  environment: { background, backgroundIntensity, backgroundRotationY,
                 environment, environmentIntensity, fog };  // '#rrggbb' | 'tex:1024x512:srgb:equirect'
  lights: { entityId, type, color, intensity, castShadow,
            shadowMapSize: [number, number], shadowBias, shadowNormalBias }[];
  draws:  { entityId, type, geometry: 'BoxGeometry:pos=24:idx=36',
            material: 'MeshStandardNodeMaterial:{…}', castShadow, receiveShadow, visible,
            batch: null | { members, perObjectFrustumCulled, sortObjects, frustumCulled } }[];
  pools:  { geometries: number; materials: number };   // attrape la même ressource bâtie deux fois
}
```

Deux points qui comptent : il digère **`binder.root`, pas `scene.children`** — les overlays sont donc hors
périmètre par construction, *et* une lumière d'aperçu posée par erreur sous `binder.root` apparaîtrait
dans `lights` avec `entityId: ''`, ce qui est exactement le mode de défaillance à garder. Et tout est
**trié** avant comparaison : l'ordre d'insertion diffère entre un sync complet et un sync incrémental, et
ce n'est pas une divergence que quiconque peut voir.

Le test (`packages/editor/test/parity.test.ts`) bâtit **le même `SceneDoc`** par les deux chemins :

```ts
expect(view.overlays).toEqual([...EDITOR_OVERLAYS]);
expect(play.overlays).toEqual([]);
expect({ ...view, overlays: [] }).toEqual(play);      // identiques, aux overlays nommés près
```

Quatre lignes de `beforeAll` suffisent à faire tourner `Engine.create` pour de vrai — `Input` est la seule
dépendance navigateur sur le chemin, `enablePhysics: false` saute Rapier, et omettre `audioContext` saute
l'audio. **Aucune modification de production pour rendre le code testable.**

Avec le code d'aujourd'hui, ce test **échoue sur `lights[0].shadowMapSize` : `[4096,4096]` contre
`[2048,2048]`**. C'est la divergence principale, attrapée.

Ce que le test ne couvre pas, et c'est écrit dans sa propre docstring : les pixels (pas de GPU) ; l'état
du renderer (exposition, tone mapping, pixel ratio, MSAA) — garanti à la place par le fait que
`createRenderer` **et** `SceneBinder` prennent le même `RenderingSettings`, avec un seul producteur par
mode ; et le timing asynchrone d'un décodage de texture.

### Supprimer le miroir de l'Inspector

`inspectorSignature` est un `switch` de 55 lignes qui réécrit à la main les prédicats `visibleWhen`. Or la
structure d'un panneau ne dépend que d'**une** chose : quels champs sont visibles. La signature *est* cet
ensemble, et elle se dérive de la déclaration que le constructeur lit déjà :

```ts
/** paneEntriesFor() : toutes les lignes possibles, sous-listes dynamiques dépliées. */
/** Sa `key` nomme les deux endroits où c'est la *liste* qui varie et non la visibilité
 *  d'une ligne : la géométrie d'un mesh (`mesh:box`) et les propriétés d'un script
 *  (`script:PlayerMove`). Tout le reste est répondu par les prédicats. */

/** shapeOf() : un caractère par ligne — une chaîne de bits, pas une liste de chemins. */
function shapeOf<S>(entries: readonly { visibleWhen?: (s: S) => boolean }[], subject: S): string {
  let shape = '';
  for (const e of entries) shape += e.visibleWhen?.(subject) === false ? '0' : '1';
  return shape;
}
```

Le `switch` à 9 bras et son `default: return component.type` disparaissent. Une seule fonction sert le
panneau **et** sa signature, donc il n'y a plus de second endroit où écrire un prédicat.

Deux bugs latents que cette dérivation corrige au passage, et qu'il faut nommer parce qu'ils prouvent que
le miroir manuel avait déjà divergé :

- **`sceneSignature` (`schema.ts:1279-1297`) a la même trappe, un cran plus haut** : il liste quatre
  champs d'environnement à la main et **rate `section.visibleWhen`**, que `buildScene` consulte pourtant
  (`buildInspector.ts:135`).
- **Sur une lumière `rectArea`, `castShadow` est lui-même conditionnel** (`schema.ts:633` — « three n'a
  aucun chemin d'ombre pour elle, la case serait un mensonge »), et la signature écrite à la main
  interpolait `component.castShadow` quoi qu'il arrive.

`water`, avant et après :

```
avant :  `water:${component.sunSource === SUN_CUSTOM ? 'custom' : 'linked'}`
après :  water/11111111111111011      sunSource = SUN_FROM_SKY  (lignes 15,16 masquées)
         water/11111111111111111      sunSource = SUN_CUSTOM
```

Même discrimination, zéro maintenance à la main — et ça suivra tout seul le jour où quelqu'un ajoutera une
ligne derrière le même prédicat. La dérivation couvre aussi les **boutons d'action**, que l'ancien `switch`
encodait à la main : `Save as Asset…` / `Make Unique` d'un mesh, `Unpack Model` d'un modèle.

Perf : le pire cas est 40 entités sélectionnées × ~40 lignes = 1600 prédicats, une fois par bump de
`componentRevision` (donc une fois par frame de drag). Chaque prédicat est un `===` et un `includes` sur
au plus quatre chaînes : de l'ordre de 100 µs, contre un refresh Tweakpane qui coûte davantage. **C'est
l'encodage en chaîne de bits qui rend ça vrai** — joindre des chemins allouerait ~40 Ko par frame.

---

## Le chantier vit dans le repo, pas dans cette conversation

C'est la contrainte qui décide de la forme : **tu dois pouvoir ouvrir une conversation neuve et dire
« go »**, sans rien réexpliquer. Donc l'état du chantier est un fichier versionné, pas un contexte.

```
CLAUDE.md                    ← chargé automatiquement à chaque conversation. Pointe vers ↓
docs/chantier/
  README.md                  la boucle : comment on prend une tâche, comment on la finit
  STATE.md                   LE fichier mutable : tâche courante, faites, notes de reprise
  PLAN.md                    ce document — le diagnostic et la cible (le « pourquoi »)
  tasks/
    T-001-….md               une tâche = un commit
    T-002-….md
    …
```

**Ce que « go » déclenche**, écrit dans `docs/chantier/README.md` :

1. lire `STATE.md` → identifier la tâche courante ;
2. ouvrir `tasks/T-xxx-….md` → l'exécuter ;
3. `npm run typecheck && npm test` ;
4. commit avec le message que la tâche porte ;
5. mettre à jour `STATE.md` (tâche suivante + notes de reprise) ;
6. s'arrêter et rendre la main.

Une tâche par commit, une tâche exécutable **sans avoir lu les autres**. Le format :

```markdown
# T-014 — Le binder prend ses réglages à la construction
Lot 2 · dépend de T-013 · bloque T-015 · statut: TODO

## Pourquoi
`shadowMapSize` n'est écrit qu'en `EditorViewport.ts:187`. `EngineOptions` n'a pas le champ.
Un projet réglé sur 4096 obtient 2048 en Play et dans le build.

## Quoi
`SceneBinder` reçoit `RenderingSettings` à la construction ; `shadowMapSize` et `batching`
deviennent `readonly` ; `EngineOptions.rendering` devient requis.

## Fichiers
- `packages/runtime/src/SceneBinder.ts:109,131-137` — champs mutables → readonly
- `packages/runtime/src/Engine.ts:84` — `batching` supprimé, `rendering` requis
- …

## Terminé quand
- [ ] `npm run typecheck && npm test` verts
- [ ] retirer `rendering` d'un des trois appelants est une erreur de compilation

## Commit
refactor(runtime): the binder takes its rendering settings at construction
```

`STATE.md` tient en quinze lignes : branche, dernier commit, tâche courante, liste des faites, et un
paragraphe libre « ce qu'il faut savoir pour reprendre » — la seule chose qu'un fichier de tâche ne peut
pas anticiper.

**La toute première tâche du chantier est d'écrire ce dispositif** (T-001), avant toute modification de
code. Sinon la première interruption coûte le contexte.

---

## Jalons

Une branche `refactor/architecture`, une MR, un commit par tâche, `npm run typecheck && npm test` vert à
chaque commit.

**L'ordre de départ, par bénéfice visible :**

| | | |
|---|---|---|
| 1 | **T-001** | le dispositif de reprise. Rien avant. |
| 2 | **Lot 0** | le filet : sans lui, rien d'autre ne se fait en sécurité. |
| 3 | **Lot 3, tâche 1** | la dérivation de l'Inspector — autonome, un commit, corrige à lui seul la moitié « répond mal à l'Inspector ». |
| 4 | **Lot 2** | la parité. Corrige `shadowMapSize`, très probablement ce que tu vois. |
| 5 | **Lot 9** | le format de projet — à faire tôt : tout ce qui touche aux scènes en dépend. |
| 6 | **Lot 1** | la tranche verticale. Le plus gros, et celui dont tout le reste tire sa scalabilité. |
| 7 | le reste | 4 à 8 et 10-11 commutent largement ; lot 4 dépend du lot 1, lot 3 (hors sa tâche 1) dépend de 1.7. |

### T-001 — Le dispositif de reprise

Écrire `CLAUDE.md`, `docs/chantier/{README,STATE,PLAN}.md` et `docs/chantier/tasks/*.md` — une tâche par
commit prévu, générées depuis les lots ci-dessous. Aucune modification de code.
Commit : `docs: the refactor is a repo document, not a conversation`.

### Lot 0 — Filet (avant de toucher à quoi que ce soit)

| # | Jalon | Fichiers |
|---|---|---|
| 0.1 | `include` du tsconfig racine couvre `apps/*/test/**` ; corriger ce que ça révèle | `tsconfig.json` |
| 0.2 | Alias workspace lus depuis une source unique au lieu de 4 copies ; ajouter `three → three/webgpu` à Vitest | `vitest.config.ts`, les 2 configs Vite, `tsconfig.base.json` |
| 0.3 | Remplacer le scan regex par une analyse du graphe d'imports : `core` sans dépendance, `runtime` sans éditeur, `editor` sans `apps`, **et détection de cycles** | `packages/runtime/test/package-boundary.test.ts` → `tools/architecture.test.ts` |
| 0.4 | Les 6 listes permissives deviennent des `Record<ComponentType, …>` totaux ou disparaissent par dérivation (voir A1) | `Reconciler.ts`, `markerStyles.ts`, `InspectorPanel.tsx`, `HierarchyPanel.tsx` |
| 0.5 | Le smoke harness tourne en CI sur un runner avec GPU logiciel | `.github/workflows/ci.yml` |

### Lot 1 — Tranche verticale par composant

| # | Jalon |
|---|---|
| 1.1 | Créer `core/src/components/<type>/` ; déplacer type + fabriques depuis `scene/schema.ts` et `scene/defaults.ts`, un type par commit |
| 1.2 | `scene/schema.ts` réduit à l'union et aux primitives partagées ; `scene/defaults.ts` aux fabriques de scène |
| 1.3 | Supprimer le `switch` géométrique de `createComponentForEntity` en le rendant à la définition de `collider` |
| 1.4 | Les 9 `fill` identiques (`{...createX(), ...stored}`) deviennent le défaut de `defineComponent`, seuls `mesh`/`light`/`water` gardent le leur |
| 1.5 | `runtime/src/components/<type>/` ; les systèmes s'enregistrent eux-mêmes, `Reconciler` ne nomme plus aucun type |
| 1.6 | Les 3 filtres typés du `Reconciler` (`meshHandles`, `entitiesUsingMaterialAssets`, `entitiesWithModels`) deviennent des capacités déclarées par le système |
| 1.7 | `editor/src/components/<type>/` : panneau, overlay, entrée de menu ; `inspector/schema.ts` réduit au vocabulaire de champ |
| 1.8 | Ajouter un type de composant neuf de bout en bout comme épreuve du dispositif |

### Lot 2 — Parité éditeur / jeu

| # | Jalon |
|---|---|
Chaîne dure : 2.2 → 2.3 → 2.4 → 2.5. Les autres commutent.

| # | Jalon | Commit |
|---|---|---|
| 2.1 | `batching` devient un réglage de rendu du projet (`core/src/project/schema.ts`) — sans consommateur encore, donc vert seul | `feat(core): batching is a project rendering setting` |
| 2.2 | `SceneBinder` prend ses réglages à la construction ; `shadowMapSize` et `batching` deviennent `readonly` ; `bindScene()` porte l'ordre ; **`EngineOptions.rendering` requis** ; le build exporté transporte `rendering` dans `build.json` | `refactor(runtime): the binder takes its rendering settings at construction` |
| 2.3 | Extraire `createEditorProjection` + `EDITOR_OVERLAYS` d'`EditorViewport` — ce que le test de parité appelle sans canvas ; les six groupes d'overlay prennent chacun un nom | `feat(editor): the Scene view's half of the projection` |
| 2.4 | Le digest et le test de parité. **C'est ici que la divergence `shadowMapSize` est attrapée** | `test: assert the Scene view and Play project a scene the same way` |
| 2.5 | L'éclairage de secours dit son nom : un booléen, une ligne dans la boîte de stats existante, un warning moteur dans la plomberie `playWarnings` existante | `feat: say out loud when the Scene view is lit and a build would not be` |
| 2.6 | Rendre possible **Scene et Game visibles en même temps** (rendu vers une render target, présentée à N canvas) — ce que le canvas unique interdit aujourd'hui | |
| 2.7 | L'aperçu d'import cesse d'exiger un second renderer, donc de figer le viewport (`rendererCount() > 1`) | |
| 2.8 | Laisser la place à un pipeline de post-traitement sans l'écrire : le seam de rendu doit l'admettre | |

### Lot 3 — Inspector

| # | Jalon |
|---|---|
| 3.1 | **Part en premier, indépendant de tout le reste** — `inspectorSignature` et `sceneSignature` dérivés de la déclaration ; le `switch` à 9 bras supprimé. Commit `refactor(editor): derive the inspector's shape from the schema it builds from` |
| 3.2 | Les unions du document produisent leurs listes Tweakpane par dérivation ; `sameShape()` disparaît |
| 3.3 | Supprimer la surface morte : `EntityTarget.write()` no-op ×2, `EntityTarget.can()` sans appelant, `Reading.mixed` calculé et jamais lu |
| 3.4 | `assetField.ts` (517 l. de plugin Tweakpane à la main) ne rejoint plus `dockApi`/`importStore` — le cycle 1 se casse là |
| 3.5 | **Un seul vocabulaire de champ** pour les composants et pour les propriétés de script : `ScriptPropertyDef` et `FieldSpec` fusionnent, `scriptFields()` (100 l. d'adaptateur) disparaît |
| 3.6 | `inspector/schema.ts` réduit au vocabulaire ; les 12 panneaux sont partis dans leur tranche (dépend de 1.7) |

### Lot 4 — God objects

| # | Jalon |
|---|---|
| 4.1 | `SceneBinder` → projection d'entités + `EnvironmentBinder` |
| 4.2 | `EditorViewport` → `ViewportRenderer` · `EditorStage` · `PlaySession` · `ViewportInput`, la classe restant la racine de composition et la boucle |
| 4.3 | `documentStore` → document + historique + journal de révisions |
| 4.4 | `assets.ts` → scan/sidecars · mutations · bibliothèques · `atomicWrite` partagé |
| 4.5 | `ProjectPanel.tsx` découpé ; l'abonnement au store entier (`:77`) devient des sélecteurs |

### Lot 5 — Contrats de frontière

| # | Jalon |
|---|---|
| 5.1 | Table de canaux IPC unique dérivée de `StudioBridge` ; handler manquant = erreur de compilation |
| 5.2 | Validation d'exécution de toute charge IPC qui atteint le disque |
| 5.3 | `BuildManifest` dans `core` ; les 3 déclarations deviennent une |
| 5.4 | `RUNTIME_DTS` dérivé des vraies sources, ou vérifié par compilation contre elles |
| 5.5 | Collapser D8 : `atomicWrite`, `safeFileName`, `assetUrl`, les listes d'extensions |

### Lot 6 — Couverture des couches nues

| # | Jalon |
|---|---|
| 6.1 | Handlers IPC extraits en fonctions pures et testés sans Electron |
| 6.2 | Politique multi-fenêtres de `windows.ts` testée |
| 6.3 | Parsing `argv`/query du preload extrait et testé |
| 6.4 | Environnement DOM pour les tests, et tests sur les panneaux React qui portent une logique |

### Lot 7 — Moteur et performance

| # | Jalon |
|---|---|
| 7.1 | Récupérer le culling perdu quand une lumière projette une ombre (`MeshBatcher.ts:403`) |
| 7.2 | `scanAssets` cesse de reparcourir le disque à chaque mutation (14 sites d'appel) |
| 7.3 | `expandedScene()` n'est plus appelé pendant le rendu React (8 sites) |
| 7.4 | Revoir le fork `WaterSurface` et le monkey-patch `StudioTime` contre la version de three visée |
| 7.5 | `EntityDoc.chunk` : l'implémenter ou le retirer — un champ que personne ne lit |

### Lot 8 — Couche de commandes

| # | Jalon |
|---|---|
| 8.1 | Chaque geste de `commands/` devient une `Command` déclarée : id, label, `can()`, `run()` — les ~50 fonctions libres entrent dans le registre |
| 8.2 | `rename` cesse d'être un demi-geste branché sur un emplacement mutable de module (`registry.ts:227`) |
| 8.3 | Les raccourcis se lisent depuis le registre, donc deviennent remappables |
| 8.4 | Palette de commandes — elle tombe du registre, elle n'est plus une fonctionnalité à écrire |
| 8.5 | `playCommands.ts` cesse d'appeler `shell/dockApi` : une commande ne pilote pas la disposition |

### Lot 9 — Le format de projet  *(à faire tôt : tout ce qui touche aux scènes en dépend)*

| # | Jalon |
|---|---|
| 9.1 | `serializeScene` écrit ses clés triées — un diff de scène redevient reviewable |
| 9.2 | **Les scènes se découvrent depuis `scenes/**/*.scene.json`** ; `ProjectFile.scenes[]` disparaît |
| 9.3 | `scenes.ts` (263 l.) fond : les 4 invariants du registre n'ont plus d'objet |
| 9.4 | `.studio/scenes.index.json` (chemin + mtime + taille) pour ne pas relire les en-têtes à chaque ouverture |
| 9.5 | `readProjectFile` migre au lieu de refuser une version antérieure |
| 9.6 | Les 7 dossiers d'assets scaffoldés depuis `ASSET_KIND_INFO` ; `.gitignore` à la racine du projet |
| 9.7 | `engineVersion` : un lecteur ou la suppression. `assets/manifest.json` sort de la doc de `project/schema.ts:9` |
| 9.8 | Verrou d'écriture sur `project.json` entre fenêtres |

### Lot 10 — L'export

| # | Jalon |
|---|---|
| 10.1 | `assets.json` + `materials.json` + `prefabs.json` se replient dans `build.json` — 6 requêtes → 3 |
| 10.2 | Toutes les scènes sous `scenes/<id>.json` ; `sceneMap`, `loadingSceneName()` et `sceneFileName()` disparaissent |
| 10.3 | Noms d'assets hachés par contenu (l'indirection id → chemin existe déjà) |
| 10.4 | `build.json` porte `rendering` — dépend de 2.2 |
| 10.5 | Manifeste des fichiers émis avec empreintes ; un build devient vérifiable en CI |
| 10.6 | Rapport de taille par catégorie dans `ExportResult` |

### Lot 11 — Mémoire du projet

| # | Jalon |
|---|---|
| 11.1 | Reconstruire les ADR depuis les commentaires du code, dans `docs/adr/` ; renuméroter en deux séries distinctes pour lever la collision `ADR-4` ; mettre à jour les 63 citations |
| 11.2 | Registre des bugs `B1`…`B15` cités dans le code, ou remplacement des citations par ce qu'elles disent |
| 11.3 | `docs/ARCHITECTURE.md` remis d'accord avec le code — 6 divergences relevées, dont une fausse (« pas d'étape de build par package », alors que chaque package en a une) et une fonctionnalité entière absente du doc (N fenêtres d'édition, une par scène) |
| 11.4 | ADR neuf : **l'extensibilité tierce** (D13) — ce que la tranche verticale rend possible, ce qu'on ne code pas encore, et le seam par lequel ça entrera |

---

## Vérification

À chaque commit : `npm run typecheck && npm test` (737 tests + les nouveaux).

Par lot :

- **Lot 0** — le test d'architecture échoue si on réintroduit un cycle ou une dépendance interdite ;
  retirer un type de `COMPONENT_TYPES` doit produire une erreur de compilation nommant le type.
- **Lot 1** — l'épreuve 1.8 : ajouter un type de composant neuf ne doit toucher que les 3 fichiers de sa
  tranche, toute omission apparaissant au typecheck.
- **Lot 2** — le test de parité doit être **rouge avant 2.2 et vert après**, en échouant précisément sur
  `lights[0].shadowMapSize`. Puis à la main via le smoke harness
  (`STUDIO_SMOKE=1 STUDIO_SMOKE_PROJECT=… STUDIO_SMOKE_SHOT=…`) : régler le projet sur 4096, capturer en
  édition puis en Play, comparer les ombres — c'est la vérification directe du symptôme rapporté. Répéter
  sur une scène sans lumière, une scène à ciel procédural, une scène avec HDRI, une scène avec eau.
  Enfin exporter et ouvrir le build : il doit maintenant avoir les mêmes réglages que les deux autres.
- **Lot 3** — éditer le `kind` d'une lumière, la projection d'une caméra, la forme d'un collider, le
  `sunSource` d'une eau : le panneau doit se reconstruire à chaque fois.
- **Lot 4** — purement structurel ; la suite existante est le filet.
- **Lot 5** — supprimer un handler IPC doit casser la compilation ; un `updateSettings` malformé doit
  être refusé, pas écrit.
- **Lot 7** — mesurer avant/après avec `renderProbe` (`studio.probe.render` dans localStorage) sur une
  scène de plusieurs milliers d'entités.
- **Lot 9** — à la main, et c'est le test qui compte : copier un `.scene.json` dans le Finder, rouvrir le
  projet, la scène est là. En supprimer un, le projet s'ouvre quand même. Renommer un dossier d'assets,
  rien ne casse. Puis `git diff` sur une scène après avoir bougé une entité : le diff doit tenir en
  quelques lignes.
- **Lot 10** — exporter, servir le dossier (`npx serve`), compter les requêtes avant la première frame
  dans l'onglet réseau : trois. Re-exporter avec une texture modifiée sans vider le cache : la nouvelle
  texture doit apparaître. Vérifier le build contre son propre manifeste d'empreintes.
- **Le dispositif lui-même** — la vraie épreuve : ouvrir une conversation neuve, dire « go », et vérifier
  qu'elle reprend à la bonne tâche sans rien demander.
