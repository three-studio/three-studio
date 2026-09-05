# T-015 — Le seam de rendu admet un post-traitement
Lot 2 · dépend de T-014 · statut: **TODO**

## Pourquoi
Il n'y a **aucun** pipeline de post-traitement dans le runtime — seule la scène décorative du lanceur
utilise `pass()` (`launcher/LauncherScene.ts:180`). Ce n'est pas une dette, c'est une absence : un
éditeur destiné à la production en aura besoin.

## Quoi
**Ne pas écrire le post-traitement.** Vérifier seulement que le seam produit par T-009 à T-014 ne
l'interdit pas : que le point où l'on rend puisse devenir le point où l'on compose, sans reprendre
l'ownership du renderer ni la boucle de frame.

Si c'est déjà vrai, la tâche est un commentaire à l'endroit qui le garantit, plus une ligne dans
`PLAN.md`. Si c'est faux, la tâche est le plus petit déplacement qui le rend vrai — **sans** ajouter de
point d'extension sans appelant.

## Terminé quand
- [ ] Écrit noir sur blanc, à l'endroit du code concerné, comment un `EffectComposer` entrerait
- [ ] Aucune classe ni interface nouvelle sans appelant aujourd'hui
- [ ] `npm run typecheck && npm test` verts

## Commit
`docs(runtime): name where post-processing enters the frame`
