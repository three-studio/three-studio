# T-070 — `docs/ARCHITECTURE.md` remis d'accord avec le code
Lot 11 · dépend de T-069 · **dernière tâche du chantier** · statut: **FAIT**

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

## Une septième, non annoncée
`:394` — « `project.json` names its scenes by `SceneEntry.id` ». Le lot 9 a **supprimé la liste** :
`scenes/**/*.scene.json` *est* la liste, découverte au disque et mise en cache dans
`.studio/scenes.index.json`. Le paragraphe disait vrai sur les ids et faux sur l'endroit. Corrigé, avec
la raison — une liste stockée était un cache de la marche qui pouvait périmer.

## Terminé quand
- [x] Les six divergences sont corrigées, plus la septième ci-dessus. Chacune **vérifiée sur pièces**
      avant d'être réécrite : les trois `tsconfig.build.json`, `editors: Editor[]`, `rapier 0.20.0`
      épinglé, le pin `0.2.0` du web-template, `apps/*/test/**` dans le tsconfig, et
      `package-boundary.test.ts` qui n'existe plus — c'est `test/architecture.test.ts`
- [x] Le multi-fenêtres est décrit : une fenêtre par scène, le focus au lieu d'une seconde fenêtre sur
      le même fichier, la fan-out `announce()`, et le rechargement au changement de scène
- [x] Un lecteur qui n'a pas suivi le chantier comprend le projet : le document s'ouvre sur ce qui le
      tient — le document est la vérité, un seul pipeline pour trois consommateurs — et dit **où vit
      le raisonnement** (`docs/adr/`, `docs/bugs.md`). Une section **Gestures** décrit la couche de
      commandes du lot 8, qui n'existait pas quand le document a été écrit
- [x] Les quatre changements que la fiche demandait de rendre compte y sont : format de projet (lot 9),
      format d'export (lot 10), pipeline unifié (lot 2), tranche verticale (lot 1)
- [x] `STATE.md` marque le chantier terminé

## Commit
`docs: the architecture document describes the architecture again`
