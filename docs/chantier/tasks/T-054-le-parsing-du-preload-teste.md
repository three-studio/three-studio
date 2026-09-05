# T-054 — Le parsing du preload testé
Lot 6 · dépend de T-053 · petite tâche · statut: **TODO**

## Pourquoi
`preload/index.ts` : **zéro test**. `argValue` (`:30`) et `queryValue` (`:44`) décident de ce qu'est la
fenêtre **avant le premier rendu**. Un cas documenté et non asserté : une valeur peut contenir un `=`.

## Quoi
Les deux fonctions dans un module à part, testées. Le preload garde l'exposition.

## Terminé quand
- [ ] Les deux sont testées, `=` dans la valeur compris
- [ ] `npm run typecheck && npm test` verts

## Commit
`test(desktop): the preload's argv and query parsing`
