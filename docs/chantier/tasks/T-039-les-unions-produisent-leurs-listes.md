# T-039 — Les unions du document produisent leurs listes
Lot 3 · dépend de T-038 · statut: **TODO**

## Pourquoi
Chaque union du document est **ré-énumérée à la main** en littéral Tweakpane `{ Label: 'value' }` :
`MaterialSide` (`schema.ts:177`), `bodyType`, `shape` de collider, `projection` de caméra,
`bus` et `distanceModel` audio, `mode` de playerController (`:729-757, 838-841, 868-870, 1000`).
Rien ne vérifie ces littéraux contre `core`.

La preuve que ça a mordu : `sameShape()` (`commands/sceneCommands.ts:534-542`) existe précisément parce
que « le schéma de l'Inspector appariant un champ à un contrôle qui lui va est une promesse que le
compilateur ne peut pas vérifier ».

## Quoi
Les listes se dérivent des unions, avec les libellés à côté de l'union — donc dans la tranche du type
après T-030. `sameShape()` disparaît, ou devient un test au lieu d'une rustine d'exécution.

## Terminé quand
- [ ] Ajouter un membre à une union du document est une erreur de compilation tant que son libellé manque
- [ ] `sameShape()` n'est plus appelé à l'exécution
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): dropdown options are derived from the unions they show`
