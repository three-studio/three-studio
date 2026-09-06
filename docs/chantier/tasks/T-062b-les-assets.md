# T-062b — Les assets entrent dans le registre
Lot 8 · dépend de T-062a · statut: **FAIT** · tranche 2/6 de **T-062**

## Quoi
`revealAsset` et `deleteAsset` deviennent des commandes. Ce sont les deux qui agissent sur une
**cible** — un asset précis, pas la sélection — donc c'est ici que `EditorContext` gagne de quoi la
porter, avec plusieurs appelants d'un coup : `AssetList.tsx`, `tiles.tsx`, `InspectorPanel.tsx`.

## La question à trancher, pas à supposer
`createFolder`, `renameFolder` et `deleteFolder` **rendent une valeur dont un appelant dépend** :
`DestinationBrowser.tsx:253-265` navigue vers le dossier créé, suit celui qui a été renommé, et quitte
celui qui a été supprimé. `Command.run` ne rend rien.

Trois issues, à choisir sur pièces :
- elles restent des fonctions, et la ligne « aucun geste appelé depuis React sans passer par le
  registre » les exclut explicitement ;
- `run` rend `unknown` et l'appelant qui en a besoin le sait — ce qui affaiblit le type pour un seul
  appelant ;
- le navigateur d'import s'abonne au store au lieu de lire un retour.

## Tranché : les trois gestes de dossier restent des fonctions
La raison est **structurelle**, pas une commodité. `Command.run` revérifie `can()` et sort quand il
refuse — un refus n'a pas de valeur à rendre, donc `run` ne peut pas en rendre. Les trois en rendent
une, et `DestinationBrowser` la lit. Les faire entrer forcerait `run` à rendre `unknown` pour toutes
les commandes de l'éditeur, au service d'un seul appelant.

Donc la ligne « aucun geste appelé depuis React sans passer par le registre » a un bord, et il est
là : **un geste dont un appelant lit le résultat est un appel de fonction, pas une commande.** Une
commande est ce qu'une personne a demandé, lancé par un menu, une touche ou une palette — dont
aucune n'est en position de faire quoi que ce soit d'une valeur de retour. Écrit au-dessus de
`subtreeOf`, et une ligne dans `RESTES.md`.

## Terminé quand
- [x] `revealAsset` et `deleteAsset` passent par le registre — et **cessent d'être exportés** : la
      commande est la seule porte, une fonction publique à côté serait la seconde
- [x] La cible est dans `EditorContext`, avec ses trois appelants. C'est un **id**, pas l'`AssetEntry`
      que l'appelant tient : le contexte se lit au moment où il sert, une entrée copiée dedans
      pourrait être périmée, et c'est aussi ce qui donne à `can()` de quoi répondre « cet asset n'est
      plus là »
- [x] Le sort des trois gestes de dossier est tranché et écrit (ci-dessus + `RESTES.md`)
- [x] Vérifié dans l'application : le bouton d'une tuile ouvre un dialogue qui nomme **`tex-0000`**,
      l'asset exact visé, et l'annulation laisse les 3000 en place. `renderer errors: none`
- [x] Cassé pour vérifier : un `can()` qui ne regarde plus la cible → le test tombe
- [x] `npm run typecheck && npm test` verts — 979 tests

## Commit
`refactor(editor): the asset gestures are commands`
