# T-062b — Les assets entrent dans le registre
Lot 8 · dépend de T-062a · statut: **TODO** · tranche 2/6 de **T-062**

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

## Terminé quand
- [ ] `revealAsset` et `deleteAsset` passent par le registre
- [ ] La cible est dans `EditorContext`, avec ses appelants
- [ ] Le sort des trois gestes de dossier est tranché **et écrit**, ici ou dans `RESTES.md`
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the asset gestures are commands`
