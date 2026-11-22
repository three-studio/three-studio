# Three Studio

Un éditeur de jeux vidéo 3D pour ordinateur, basé sur Three.js (WebGPU), React et Electron.
Voir `README.md` pour savoir comment le lancer.

## Les notes de travail ne sont pas dans le dépôt

`docs/` est **ignoré par git**. Les notes, les plans et les documents de décision y vivent en local et
n'y sont jamais commités. Si le dossier est là sur cette machine, il est à lire ; s'il ne l'est pas
après un clone, c'est normal, et rien dans le code n'en dépend.

Conséquence à connaître : **n'ajoutez pas de citation vers un document de `docs/`** dans un commentaire.
Elle ne résoudrait pour personne d'autre. Le raisonnement va dans le commentaire lui-même — c'est de
toute façon là qu'il est le plus utile, juste à côté du code qu'il explique.

## Conventions déjà imposées par ce dépôt

- **Les commentaires expliquent *pourquoi*, avec autant de détails que nécessaire lorsque le pourquoi
  a déjà fait perdre une matinée à quelqu'un.** Faites de même. Un commentaire qui se contente de
  reformuler le code est du bruit ; un commentaire qui explique le problème ou l'échec ayant motivé
  le code est utile.
- **Jusqu'à la 1.0.0, un format persisté change en changeant de version.** Tout changement de format
  incrémente son numéro de version. `PROJECT_FORMAT_VERSION` bouge avec tout changement de format d'un
  fichier du projet, et un projet d'une autre version est refusé à l'ouverture, avant qu'une scène soit
  lue. Un fichier refusé l'est avec ses diagnostics — le fichier, l'endroit, la raison — montrés à
  l'ouverture ; aucun décodeur ne remplit ni ne convertit ce qu'il lit, et seule la hiérarchie d'une
  scène est soignée à la lecture. Un fichier d'une autre version est refusé avec un diagnostic s'il fait
  partie du projet (`project.json`, scènes, prefabs, assets et leurs sidecars). S'il fait partie des
  données de l'application (dispositions des panneaux, raccourcis, disposition du clavier, projets
  récents, réglages des appareils, certificat), il n'est pas lu : l'éditeur repart des valeurs par défaut
  et le dit une fois. Pas de code de migration : n'en ajoutez pas, et celui qui reste est appelé à
  disparaître. Les données d'un type inconnu, comme le composant d'un module absent, restent exactement
  telles qu'elles ont été trouvées. **À partir de la 1.0.0, la règle additive revient :** ajoutez des
  champs, n'en supprimez jamais, et remplissez les champs manquants à partir de la factory propre au
  type, jamais à partir d'une seconde liste.
- **Un type de composant se décrit par son schéma.** `defineComponent` en dérive le type TypeScript
  (`Infer`), la factory, le décodeur, les références et la pane de l'Inspector ; on n'écrit à la main ni
  interface, ni `fill`, ni liste de références, ni pane. Ce que le schéma ne peut pas dire passe par
  l'extension de pane du type (`drawers`, `after`). Ce qu'un type exige ou refuse à côté de lui
  (`requires`, `excludes`, `multiple`), ce qu'il devient quand le dessin de son entité passe à d'autres
  (`followsDrawing`), les champs qui se règlent pendant Play (`tunable`) et l'objet qu'un asset remplit
  (`linkedBy`) se déclarent sur le type, jamais dans une table du noyau : l'Inspector, les commandes de
  scène et le réglage en Play ne nomment aucun type de composant, ce que `test/architecture.test.ts`
  vérifie. Chaque type porte sa `version`, et chaque fichier de scène ou de prefab enregistre dans
  `componentVersions` celle de chaque type dont il tient un composant : un type connu à une autre version
  fait refuser le fichier, un type inconnu garde la sienne telle qu'elle a été trouvée. Changer les
  champs d'un type du noyau incrémente sa version et `PROJECT_FORMAT_VERSION` ; un module n'incrémente
  que la version de son type.
- **Un asset chargé appartient au cache du projet.** Un modèle ou une image se tient (`holdModel`,
  `holdTexture`, `preload`) et se rend ; celui qui le tient ne le libère jamais : le cache le libère
  après la dernière prise, au-delà de son budget, à la frame suivante. Ce qu'un monde en cours de jeu
  peut changer d'un asset — les matériaux d'un modèle — est sa copie ; géométrie et images sont
  partagées, en lecture seule.
- **Une scène tourne dans un monde.** La vue d'édition est un `World` qui ne simule rien ; Play, un device et
  le player font tourner un `World` en jeu. Ses phases sont fixes (`update`, `fixed`, `lateUpdate`,
  `renderPrep`) et le noyau tient le pas fixe ; ce qui simule est un sous-système enregistré
  (`RuntimeRegistries.subsystems`), avec sa place dans chaque phase, ses diagnostics et son accesseur
  (`physicsOf(world)`), jamais un champ du monde ni un contexte fourre-tout. `runtime/src/world/` ne nomme
  aucun type de composant, ce que `test/architecture.test.ts` vérifie, et ce que le code du runtime alloue
  par frame tient dans un budget, ce que `worldAllocations.test.ts` vérifie.
- **Un monde en jeu tient son propre document.** `spawn`, `instantiate`, `destroy`, `putComponent`,
  `deleteComponent` et `setAssetValues` le changent et marquent ce qu'ils touchent ; une seule passe par
  frame, après `lateUpdate`, monte, rapièce et démonte le dessin et chaque sous-système, selon les types
  qu'il déclare (`mounts`). L'état chaud — poses, vitesses — n'y passe jamais, et un réglage en Play est
  une écriture de ce document. Les behaviours d'une scène naissent quand elle est construite tout entière,
  tous les `onAwake` puis tous les `onStart` ; ceux d'un spawn à la fin de sa passe, avant leur premier
  `onUpdate`.
- **Un script passe par la façade.** Il tient une entité par un handle (`this.entity`, `this.world.entity(id)`, un par
  entité et par monde), la déplace par `this.transform` — les vecteurs du dessin, jamais le document —, lit un composant
  en lecture seule et en écrit un entier, décodé (`setComponent`) ; il crée et détruit par `this.world` et l'entité, et
  parle à une autre par `send`, entendu à la frame suivante. L'`Object3D` reste accessible (`object3D`), hors contrat : la
  géométrie et les textures d'un modèle y sont partagées et en lecture seule. Ce qu'un module donne aux scripts
  (`this.body`, `this.audio`) est une contribution (`RuntimeRegistries.scriptMembers`), avec ses noms réservés et ses
  lignes de typings ; `runtime/src/scripting/` ne nomme ni la physique ni l'audio, ce que `test/architecture.test.ts`
  vérifie, et les typings d'un projet sont générés depuis les registres. Ce qu'un script voit change avec
  `SCRIPT_API_VERSION`.
- **Un jeu tient un seul monde, où ses scènes se chargent.** Play, un device et le player font tourner un `Game` : un
  `World` pour toute la partie, où une scène se construit à part, cachée et montée par aucun sous-système, puis démarre
  d'un coup quand on l'active — prête n'est pas montrée. Une scène est active, et `go` la remplace ; les scènes additives
  restent jusqu'à `unload`, et ce qui doit survivre à un changement de scène vit dans l'une d'elles ou dans
  `this.scenes.data`. Une scène tient chaque asset qu'elle nomme, prefabs instanciables compris, de sa lecture à son
  déchargement. Deux scènes d'un monde n'ont jamais un id d'entité en commun : un chargement en conflit est refusé avec
  un diagnostic.
- **Aucune assertion de type ni état de module au-delà du ratchet.** `test/ratchet.test.ts` compte,
  fichier par fichier, les `as` (sauf `as const`) et les `<T>x`, les `!`, les `any`, les `@ts-ignore`,
  `@ts-expect-error` et `@ts-nocheck`, et l'état mutable au niveau d'un module : un `let` ou un `var`,
  un `new` (sauf une `WeakMap` ou un `WeakSet`, une table déclarée `ReadonlyMap` ou `ReadonlySet` et un
  objet-valeur comme un `Vector3`), une collection créée vide (sauf un tableau déclaré `readonly`), un
  store. Les comptes de `test/ratchetRecord.ts` ne font que baisser, et un nouveau fichier part de
  zéro. Une donnée venue de l'extérieur se décode, elle ne s'affirme pas — même quand une bibliothèque
  la rend en `any` : typer la variable n'est pas la décoder. Là où `!` supposait une valeur présente,
  `assertDefined` (`@three-studio/core`) la vérifie. Une exception permanente va dans la liste blanche
  du test, avec sa raison, et seulement dans le noyau.
- **Une référence est un identifiant** — jamais un nom, jamais un chemin. Les ids d'entité, de
  composant, d'asset et de scène ont leur propre type (`EntityId`, `ComponentId`, `AssetId`, `SceneId`)
  et ne naissent que dans `packages/core/src/ids.ts` : une fabrique (`createEntityId()`…), une
  vérification là où la valeur entre (`isEntityId(valeur)`…), ou `fixedId('entity', 'cube')` pour une
  constante écrite en dur. En mémoire, une collection dont on relit les clés comme des ids est une `Map`.
  Un record indexé par des ids ne vit que dans une forme JSON (un fichier, un message, les données d'un
  composant) : on y cherche par id, et ses clés ne redeviennent des ids qu'à travers `idMapOf`. Le test
  du ratchet refuse une vérification d'id écrite ailleurs que dans `ids.ts`.
- **Rien ne s'enregistre à l'import.** Un type de composant, un système, un behaviour ou un importer est
  une définition exportée. Il n'entre dans un registre — un `Registry` de `@three-studio/core`, qui refuse
  un id déjà pris — que par l'`activate…` de sa couche, et seule la racine de composition de chaque app
  appelle les `activate…` : la fenêtre de l'éditeur (`apps/desktop/src/renderer/src/main.tsx`), le player
  (`apps/web-template/src/main.ts`), le main Electron (`apps/desktop/src/main/index.ts`) ; les tests et
  `tools/` construisent les leurs. Une fonction qui lit un registre le reçoit en paramètre, jamais d'un
  module. Les classes d'un bundle de scripts appartiennent à ce bundle et passent au moteur en paramètre.
  Une racine n'accepte aucune mise à jour à chaud : en dev, une édition sous ce qu'elle active recharge la
  fenêtre. `test/architecture.test.ts` vérifie les racines.
- **Un module est un dossier, et le noyau ne le nomme pas.** `modules/<id>/` contient un `package.json`
  (`@three-studio/<id>`, son manifeste : ses modules et ses paquets tiers y sont déclarés) et une partie
  par couche où il a quelque chose, `src/core`, `src/runtime`, `src/editor`, chacune avec un `index.ts`
  qui exporte son `activate` et s'importe par `@three-studio/<id>/<partie>`. Une partie n'atteint le noyau
  que par les points d'entrée de ses paquets (`@three-studio/core`, jamais un chemin profond), à sa couche
  ou en dessous ; ses propres parties plus basses et celles d'un module déclaré par leur chemin de paquet ;
  un import relatif ne sort pas de sa partie. Un type de composant s'ajoute au document depuis le module
  (`declare module '@three-studio/core' { interface ComponentTypes { … } }`) et se décrit par un schéma
  (`defineComponent`), d'où viennent son type, sa fabrique, son décodeur, ses références et sa pane. Aucun
  fichier hors du module ne l'importe ni ne nomme son id ou celui de ses types, sauf les racines de
  composition, qui activent chaque partie de leurs couches après celle du noyau. Ajouter ou retirer un
  module, c'est son dossier et ces lignes-là : `npm run typecheck` compile aussi le noyau seul
  (`tsconfig.kernel.json`), et un composant dont le module manque reste dans la scène tel qu'il a été
  trouvé. `test/architecture.test.ts` vérifie ces règles, et aucune assertion de type n'est admise dans un
  module.
- `packages/core` n'importe rien d'autre que `.` et `node:`. `packages/runtime` n'importe jamais
  l'éditeur. Ces deux règles sont vérifiées par des tests.
- `npm run typecheck && npm test` doit être au vert à chaque commit.
- **Node se prend dans `.nvmrc`.** La version par défaut de nvm sur cette machine n'est pas celle du dépôt, et sous une
  autre version `worldAllocations.test.ts` échoue (V8 n'alloue pas pareil), ce qui a déjà été pris pour une machine
  saturée. Dans Claude Code, le shell repart du profil à chaque commande : un `nvm use` lancé seul ne vaut que pour sa
  commande. Chaque commande qui lance `node`, `npm` ou `npx` commence donc par `nvm use >/dev/null &&`.

On parle et on échange en français, mais on écrit en anglais.
