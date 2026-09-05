# T-053 — La politique multi-fenêtres testée
Lot 6 · dépend de T-052 · statut: **TODO**

## Pourquoi
`windows.ts` (427 l.) : **zéro test**. Tout y est de la politique — retrouver la fenêtre qui montre
déjà une scène, l'annulation de `closeAllEditors`, `transitioning`, `switchScene` par rechargement, le
retour au launcher seulement quand le **dernier** éditeur ferme (`:355`). Vérifiable aujourd'hui
uniquement à la main.

## Quoi
Séparer la décision de l'effet : les règles deviennent des fonctions sur un état de fenêtres, testables ;
`BrowserWindow` reste derrière.

## Terminé quand
- [ ] Les règles sont testées, cas limites compris (dernier éditeur, transition, scène déjà ouverte)
- [ ] `npm run typecheck && npm test` verts

## Commit
`test(desktop): the window policy is a decision, and decisions can be tested`
