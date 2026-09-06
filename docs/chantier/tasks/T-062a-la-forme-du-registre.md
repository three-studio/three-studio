# T-062a — `CommandId` se dérive de la table
Lot 8 · dépend de T-046 · statut: **FAIT** · tranche 1/6 de **T-062**

## Pourquoi
C'est la phrase de T-062 sans laquelle les cinq autres tranches sont impossibles :

> `CommandId` cesse d'être une union fermée écrite à la main — sinon c'est une cinquantième liste à
> tenir.

Et il y a une objection écrite en toutes lettres dans `registry.ts`, qu'il faut lever avant de sortir
la moindre commande du fichier :

> « a registry filled by an import has one silent failure mode — a module nobody imports registers
> nothing, and the command simply goes missing »

Elle est juste **pour un registre rempli par effet de bord**. Une table littérale n'a pas ce mode
d'échec : les clés *sont* l'union, donc une famille non importée fait disparaître ses ids du type, et
tout appelant qui les nomme cesse de compiler. C'est plus fort que le `throw` au chargement du
registre de composants, qui lui n'a le choix qu'entre ça et rien parce que `COMPONENT_TYPES` est une
union canonique indépendante. Ici il n'y en a pas — et c'est précisément pour ça que l'union doit
venir de la table.

## Quoi
1. Une table littérale par famille, composées dans `registry.ts` ; `CommandId = keyof typeof COMMANDS`.
2. La `Map` et l'effet de bord de `defineCommand` disparaissent — `commandById` lit la table.
   `commandById(id: CommandId)` devient **total** : plus de `Command | undefined` à traiter chez
   chaque appelant.
3. `run` peut rendre une promesse : la moitié des gestes qui restent à faire entrer sont asynchrones.
4. **Le menu Scène comme patron** : `newScene`, `saveSceneAs`, `duplicateCurrentScene`,
   `renameCurrentSceneWithPrompt`, `deleteCurrentScene` deviennent des commandes. Cinq gestes sans
   cible et sans valeur de retour — de quoi prouver la forme sans y mêler une question de conception.

`EditorContext` **ne bouge pas**. Les gestes qui portent une cible arrivent en T-062b, avec leurs
appelants ; un champ ajouté ici n'en aurait aucun.

## Ce que ça corrige au passage, et qui n'était pas cherché
`MenuBar` écrit ses propres gardes pour les entrées de scène, ou n'en écrit pas :
- **`Duplicate Scene…` et `Rename Scene…` n'ont aucun `disabled`**, alors que les deux fonctions font
  `if (sceneId === null) return`. Le menu propose une action qui ne fait rien.
- **`Save Scene As…`** pareil, avec `if (!summary) return`.
- **`Delete Scene`** porte `disabled: scenes.length <= 1` dans le menu, pas dans le geste.

C'est la divergence exacte que le registre existe pour tuer, retrouvée sur une deuxième famille.

## Terminé quand
- [x] `CommandId` n'est plus écrit à la main : `keyof typeof COMMANDS`, et **`id` a disparu de la
      déclaration** — la clé sous laquelle une commande est rangée *est* son id, écrite une fois
- [x] Les cinq gestes du menu Scène passent par le registre, avec un libellé et un `can()` réel
- [x] Cassé pour vérifier : deux familles qui se disputent un id font tomber le test de comptage
      (`expected 13, got 12`), au lieu de faire disparaître une commande sans bruit
- [x] Vérifié dans l'application : à une seule scène, `Delete Scene` est grisé et les trois autres
      sont actives ; le menu Fichier est inchangé. `renderer errors: none`
- [x] `npm run typecheck && npm test` verts — 977 tests

## Commit
`refactor(editor): the command ids come from the table, not from a list`
