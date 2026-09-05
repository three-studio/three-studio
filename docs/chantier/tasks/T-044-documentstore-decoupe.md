# T-044 — `documentStore` découpé
Lot 4 · dépend de T-043 · statut: **TODO**

## Pourquoi
704 lignes : la scène, l'historique, **quatre** compteurs de révision (`:175-206`), un journal de
révisions tenu **hors** de zustand (`:418-471`), l'élagage de la sélection, la validation DEV de la
hiérarchie, et les notifications de changement de bibliothèque.

## Quoi
`documentStore` (la scène et les mutations) · `history.ts` (pile, coalescence, `ExternalEdit`,
`takeHistory`/`restoreHistory`) · `revisionLog.ts` (le journal et `changesSince`).

## Attention
- `selectionBefore`/`selectionAfter` ne sont **pas** optionnels, et c'est le sujet (`:108-113`) : un
  champ optionnel est un champ qu'on oublie, et c'est comme ça que l'undo laissait le gizmo pointer une
  entité qu'il venait de supprimer.
- `revision` **descend** à l'undo — c'est le marqueur de sauvegarde. Le compteur strictement croissant
  est un autre, hors zustand, « parce que rien ne s'en rend ».
- `compact()` (`:368`) réduit ~600 paires de patches à 1 sur un drag de 10 s. Ne pas le perdre.
- `test/history.test.ts:126-160` teste une **propriété** : 40 commandes aléatoires, N undos ramènent au
  départ, N redos à la fin. C'est le filet de cette tâche.

## Terminé quand
- [ ] Les trois fichiers ont chacun un métier
- [ ] `history.test.ts` vert **sans modification**
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the document, its history and its revision log are three things`
