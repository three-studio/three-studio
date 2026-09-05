# T-013 — Voir la Scene et le Game en même temps
Lot 2 · dépend de T-010 · statut: **TODO**

## Pourquoi
Il n'y a **qu'un seul canvas**, déplacé entre les deux panneaux : `ViewportPanel.tsx:22-42` se détache
dès que `playState !== 'stopped'`, `GamePanel.tsx:24-32` s'attache. On ne peut donc jamais voir la
scène et le jeu côte à côte — ce que Unity et Unreal font tous les deux, et ce que comparer les deux
rendus exigerait précisément.

Ce n'est pas un oubli : deux `WebGPURenderer` dessinant dans la même frame se détruisent mutuellement
leur render target, et `RendererFactory.ts:68` (`rendererCount`) existe pour ça.

## Quoi
Un seul renderer, deux présentations : rendre vers une render target, puis présenter le résultat dans
N canvas 2D. Lire d'abord le long commentaire de `RendererFactory.ts:44-67`, qui décrit exactement le
bug que ça contourne.

Relire `PLAN.md` § « Pipeline unifié » avant de commencer : la forme dépend de ce que T-009 et T-010
auront produit.

## Terminé quand
- [ ] Les deux panneaux affichent en même temps pendant Play
- [ ] Aucun message `Destroyed texture … used in a submit`
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(editor): the Scene and the Game are visible at the same time`
