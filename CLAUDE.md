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
  incrémente son numéro de version. Un fichier d'une autre version est refusé avec un diagnostic s'il
  fait partie du projet (`project.json`, scènes, prefabs, assets et leurs sidecars). S'il fait partie
  des données de l'application (dispositions des panneaux, raccourcis, disposition du clavier, projets
  récents, réglages des appareils, certificat), il n'est pas lu : l'éditeur repart des valeurs par
  défaut et le dit une fois. Pas de code de migration : n'en ajoutez pas, et celui qui reste est appelé
  à disparaître. Les données d'un type inconnu, comme le composant d'un module absent, restent
  exactement telles qu'elles ont été trouvées. **À partir de la 1.0.0, la règle additive revient :**
  ajoutez des champs, n'en supprimez jamais, et remplissez les champs manquants à partir de la factory
  propre au type, jamais à partir d'une seconde liste.
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
- `packages/core` n'importe rien d'autre que `.` et `node:`. `packages/runtime` n'importe jamais
  l'éditeur. Ces deux règles sont vérifiées par des tests.
- `npm run typecheck && npm test` doit être au vert à chaque commit.

On parle et on échange en français, mais on écrit en anglais.
