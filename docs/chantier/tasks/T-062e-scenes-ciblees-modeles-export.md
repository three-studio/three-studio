# T-062e — Les scènes ciblées, les modèles, l'export
Lot 8 · dépend de T-062d · statut: **TODO** · tranche 5/6 de **T-062**

## Quoi
Ce qui reste, et qui ne fait pas une famille à soi seul :
- **une scène nommée** : `openScene`, `openSceneInNewWindow`, `chooseStartScene` — une entrée de menu
  *par scène*, donc la cible que T-062b aura mise dans `EditorContext` sert une deuxième fois ;
- **les modèles** : `unpackModel` (`HierarchyPanel`) ;
- **l'export** : `runExport` (`PackageDialog`).

## Terminé quand
- [ ] Les cinq gestes passent par le registre
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the remaining gestures are commands`
