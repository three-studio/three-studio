# T-050 — Une écriture atomique, pas cinq
Lot 5 · dépend de T-049 · petite tâche · statut: **TODO**

## Pourquoi
Le motif « écrire dans `.tmp` puis `rename` » est réécrit **cinq fois**, avec **cinq gestions d'erreur
différentes** : `project.ts:119-122` (scène), `:141-143` (projet), `scenes.ts:260-262`,
`preferences.ts:40-43` (avale et journalise), `assets.ts:159-169` (suffixé par id, nettoie et relance).

## Quoi
Un module, un comportement d'erreur décidé. Les cinq sites l'appellent.

Garder la particularité de `assets.ts` : le fichier temporaire y est suffixé par un id
(`${target}.${createId()}.tmp`) précisément parce que deux scans concurrents peuvent écrire le même
sidecar. Le module doit l'admettre plutôt que de la perdre.

Au passage, deux **classes de caractères différentes** assainissent des noms qui atterrissent dans la
même arborescence : `/[<>:"/\\|?*\x00-\x1f]/g` (`project.ts:240`, `scenes.ts:60`) et
`/[/\\:*?"<>|]/g` (`assets.ts:535,606,678,785`, plus `assetCommands.ts:72,153`). La première retire
aussi les caractères de contrôle. Une seule règle.

## Terminé quand
- [ ] Un seul module d'écriture atomique, un seul assainisseur de nom
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(desktop): one atomic write and one filename rule, not five and two`
