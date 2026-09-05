# T-052 — Les handlers IPC deviennent testables
Lot 6 · dépend de T-051 · statut: **TODO**

## Pourquoi
`ipc.ts` : **zéro test**. Aucun test du bureau ne l'importe. Les 45 handlers, la fan-out `announce()`,
`unsavedByWindow`, `exportedDirs` et `requireProject()` ne sont exercés par rien.

Le chemin est court : `IpcDeps` (`ipc.ts:105-122`) montre déjà que l'injection marche ici.

## Quoi
Extraire les handlers en fonctions pures prenant leurs dépendances, testées sans Electron. Le fichier
d'enregistrement ne garde que le câblage — que T-047 a déjà réduit à une table.

## Terminé quand
- [ ] Les handlers non triviaux ont un test qui n'ouvre pas Electron
- [ ] `requireProject()` et le jeton `exportedDirs` sont testés, cas de refus compris
- [ ] `npm run typecheck && npm test` verts

## Commit
`test(desktop): the IPC handlers are functions, and now they have tests`
