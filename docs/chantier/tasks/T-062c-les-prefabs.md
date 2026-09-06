# T-062c — Les prefabs entrent dans le registre
Lot 8 · dépend de T-062b · statut: **TODO** · tranche 3/6 de **T-062**

## Quoi
Huit gestes, tous appelés depuis `HierarchyPanel.tsx` et `InspectorPanel.tsx` :
`createPrefabFromEntity`, `createPrefabVariant`, `instantiatePrefab`, `applyInstanceOverrides`,
`revertInstanceOverrides`, `revertEntityOverride`, `selectPrefabInstances`, `unpackPrefabInstance`.

`instanceInfo` et `overridesOf` sont des **lecteurs**, pas des gestes : ils restent des fonctions.

## Attention
`registry.ts` exclut aujourd'hui « the prefab entries of the hierarchy's context menu », au motif
qu'elles sont « decided in exactly one place, and a registry earns its keep by removing a second ».
Ce n'est plus vrai dès que l'Inspector décide des mêmes gestes de son côté — le vérifier avant de
coder, et si c'est encore vrai, le dire plutôt que d'enregistrer pour enregistrer.

## Terminé quand
- [ ] Les huit gestes passent par le registre, avec un libellé et un `can()` réel
- [ ] Le commentaire d'exclusion de `registry.ts` est à jour
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the prefab gestures are commands`
