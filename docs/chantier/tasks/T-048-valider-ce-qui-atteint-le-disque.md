# T-048 — Valider ce qui vient du renderer et atteint le disque
Lot 5 · dépend de T-047 · statut: **TODO**

## Pourquoi
**Il n'y a aucune validation d'exécution des arguments IPC, nulle part.** Les types sont effacés à la
compilation. `project:updateSettings` (`ipc.ts:484`) étale un patch venu du renderer **directement dans
`project.json`**. `AssetSettings`, `MaterialDef`, `PrefabDoc`, `ImportPlanItem`, `LayoutPreferences`
sont écrits tels quels.

Ce qui existe déjà et qui est bon : `requireProject()` (`:82`) — le renderer ne nomme jamais une racine
de projet ; `resolveInside()` (`paths.ts:18`) — tout chemin nommé par le renderer est prouvé à
l'intérieur ; les jetons de capacité (`exportedDirs:436`, `ImportSession.resolvePreview`). La
**forme** des données est le trou.

## Quoi
Valider à la frontière, une fois — c'est la règle que le repo tient déjà
(`docs/ARCHITECTURE.md:349-355` : « défendre à la frontière, pas à chaque site de lecture »).

**Aucune dépendance nouvelle** : des gardes écrites à la main dans `core`, sur le même idiome que
`fillComponent` — remplir depuis la fabrique du type, laisser intact ce qu'on ne reconnaît pas, refuser
seulement ce qui ne peut pas être réparé. `core` doit rester sans dépendance (T-004 le vérifie).

## Terminé quand
- [ ] Un `updateSettings` malformé est refusé, pas écrit
- [ ] Un `MaterialDef` avec un champ de mauvais type ne corrompt pas le fichier
- [ ] Tests écrivant des charges malformées à la main
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(desktop): validate what the renderer sends before it reaches the disk`
