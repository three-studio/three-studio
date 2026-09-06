# T-062f — Le transport entre dans le registre
Lot 8 · **dépend de T-066**, pas de T-062e · statut: **TODO** · tranche 6/6 de **T-062**

## Pourquoi elle est la dernière
`startPlay` appelle `showPanel('game')`, et `stopPlay` `showPanel('viewport')`. En faire des commandes
avant T-066 (« `playCommands.ts` cesse d'appeler `shell/dockApi` : une commande ne pilote pas la
disposition », jalon 8.5) enregistrerait dans le registre exactement ce que T-066 doit en sortir.

L'ordre du lot est donc : T-062a → e, puis T-063, T-064, T-065, T-066, **puis celle-ci**.

## Quoi
`startPlay`, `stopPlay`, `togglePlay` deviennent des commandes, avec le `can()` qui manque : la barre
d'outils et `GamePanel` décident aujourd'hui chacune de leur côté à partir de `playState`.

## Terminé quand
- [ ] Les trois gestes passent par le registre
- [ ] Aucune commande n'appelle `shell/dockApi`
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): play and stop are commands`
