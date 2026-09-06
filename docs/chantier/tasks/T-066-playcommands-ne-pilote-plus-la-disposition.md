# T-066 — Une commande ne pilote pas la disposition
Lot 8 · dépend de T-065 · petite tâche · statut: **FAIT**

## Pourquoi
`commands/playCommands.ts:1` importe `shell/dockApi` et appelle `showPanel('game'|'viewport')` : la
couche commande atteint la disposition des panneaux. `dockApi` garde d'ailleurs l'API impérative de
dockview dans un `let` au niveau du module.

## Quoi
Démarrer le jeu et montrer le panneau Game sont deux choses. La seconde est une réaction à la première,
et sa place est du côté de la coque.

> ⚠️ **Il y avait deux sites, pas un.** `assetCommands.ts:37` appelait `showPanel('project')` de la
> même façon. T-062b avait écrit que ce n'était « pas le jalon 8.5 » au motif qu'amener le panneau
> devant *est* le geste de révéler — mais le critère de cette fiche est mécanique (« `commands/`
> n'importe plus `shell/` ») et il couvre les deux. Le sortir a d'ailleurs **payé** : n'importe quel
> chemin qui pose `revealed` amène maintenant le panneau devant, alors qu'avant seule la commande le
> faisait.

**La décision est une transition, jamais un état.** `panelForChange(before, after)` tourne à chaque
changement de store — une sélection, un filtre, une mutation. Décider depuis l'état ramènerait
l'onglet Scene au premier plan à chaque fois que quoi que ce soit bouge, et une fois au démarrage
par-dessus l'onglet que l'auteur avait laissé devant. Cassé pour vérifier : trois tests tombent.

## Terminé quand
- [x] `commands/` n'importe plus `shell/` — vérifié sur tout le dossier, les deux sites sont sortis
- [x] Play montre toujours le panneau Game, Stop revient à Scene. Vérifié dans l'application :
      `game` en jouant, **`game` toujours en pause** (une pause n'est pas une transition), `viewport`
      à l'arrêt, et `project` sur un `reveal` venu du store seul
- [x] `revealAsset` la fonction disparaît : elle ne faisait plus qu'une ligne une fois `showPanel`
      parti, et la commande appelle le store directement
- [x] `npm run typecheck && npm test` verts — 999 tests. `renderer errors: none`

## Ce qui reste sans appelant, et pour un commit seulement
`togglePlay` n'est appelé par personne. **T-062f est la tranche qui met les trois gestes de transport
dans le registre**, et elle avait été placée après celle-ci exactement pour ne pas enregistrer un
geste qui atteignait le dock. Elle est débloquée.

## Commit
`refactor(editor): starting the game and showing a panel are two things`
