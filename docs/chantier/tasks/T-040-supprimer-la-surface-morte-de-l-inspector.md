# T-040 — Supprimer la surface morte de l'Inspector
Lot 3 · dépend de T-039 · petite tâche · statut: **TODO**

## Pourquoi
`inspector/target.ts` porte des choses que personne n'appelle :
- `EntityTarget.write()` est un no-op documenté dans **les deux** implémentations (`:96-100`, `:140-143`)
- `EntityTarget.can()` n'a **aucun appelant**
- `Reading.mixed` (`:58-62`) est calculé par `compare()` (`:251-258`) et **lu par personne** —
  `buildInspector.ts:309-315` le jette. Le tiret « que Unity et Unreal montrent tous les deux » est
  spécifié et non implémenté

Une surface morte se lit comme une intention, et coûte à chaque relecture.

## Quoi
Supprimer les trois. Si l'indicateur « valeurs mixtes » est voulu, c'est une fonctionnalité à écrire —
avec son affichage — pas un champ à laisser en attente.

## Terminé quand
- [ ] Les trois n'existent plus, ou `mixed` est réellement affiché
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): delete the inspector surface nothing calls`
