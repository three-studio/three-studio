# T-066 — Une commande ne pilote pas la disposition
Lot 8 · dépend de T-065 · petite tâche · statut: **TODO**

## Pourquoi
`commands/playCommands.ts:1` importe `shell/dockApi` et appelle `showPanel('game'|'viewport')` : la
couche commande atteint la disposition des panneaux. `dockApi` garde d'ailleurs l'API impérative de
dockview dans un `let` au niveau du module.

## Quoi
Démarrer le jeu et montrer le panneau Game sont deux choses. La seconde est une réaction à la première,
et sa place est du côté de la coque.

## Terminé quand
- [ ] `commands/` n'importe plus `shell/`
- [ ] Play montre toujours le panneau Game, Stop revient à Scene
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): starting the game and showing a panel are two things`
