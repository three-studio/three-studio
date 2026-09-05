# T-070 — `docs/ARCHITECTURE.md` remis d'accord avec le code
Lot 11 · dépend de T-069 · **dernière tâche du chantier** · statut: **TODO**

## Pourquoi
Le document diverge du code sur six points, dont un franchement faux et une fonctionnalité entière
absente :

| # | Le doc dit | Le code fait |
|---|---|---|
| 1 | `:151` « aucune étape de build par package, Vite transpile la source » | **Faux.** Chaque package a un `build` en deux passes et un `tsconfig.build.json` ; `README.md:243` dit l'inverse et a raison |
| 2 | `:106-111` « un launcher et **un** éditeur » | `windows.ts:43` tient `editors: Editor[]` — **N fenêtres, une par scène**, avec `openSceneWindow`, `isSceneOpenElsewhere` et la fan-out `announce()`. Fonctionnalité entière absente du doc |
| 3 | `:380` Rapier `0.19.x`, « `npm ls` doit montrer 0.19.3 » | `packages/runtime/package.json:41` épingle `0.20.0` |
| 4 | `:50` web-template épingle core `0.1.0` | il épingle `0.2.0` ; l'avertissement tient, la valeur non |
| 5 | `:29` « typecheck across every workspace » | il omettait `apps/*/test/**` — corrigé par T-002 |
| 6 | `:93-100` variables du smoke | `STUDIO_SMOKE_SETTLE` manque, et le fait que `STUDIO_SMOKE` change trois comportements de production |

Plus : `apps/web-template` est absent du bloc « Layout » (`:140-144`), qui ne liste que quatre des cinq
workspaces.

## Quoi
Corriger les six, ajouter le multi-fenêtres, et rendre compte de ce que le chantier a changé — le format
de projet (lot 9), le format d'export (lot 10), le pipeline unifié (lot 2), la tranche verticale (lot 1).

C'est la dernière tâche parce que c'est là seulement qu'on sait ce qu'on a construit.

## Terminé quand
- [ ] Les six divergences sont corrigées
- [ ] Le multi-fenêtres est décrit
- [ ] Un lecteur qui n'a pas suivi le chantier comprend le projet en lisant ce fichier
- [ ] `STATE.md` marque le chantier terminé

## Commit
`docs: the architecture document describes the architecture again`
