# T-022 — Un verrou d'écriture sur `project.json`
Lot 9 · dépend de T-021 · statut: **TODO**

## Pourquoi
`windows.ts:43` tient `editors: Editor[]` — **N fenêtres d'édition, une par scène**, sur le même
projet. Toutes écrivent `project.json`. Il y a bien une fan-out `announce()` (`ipc.ts:138`) pour
prévenir les autres fenêtres, mais **aucun verrou** : deux écritures concurrentes se perdent l'une
l'autre.

(Au passage : `docs/ARCHITECTURE.md:106-111` décrit encore « un launcher et **un** éditeur ». Le doc a
une fonctionnalité entière de retard — c'est T-070.)

## Quoi
Sérialiser les écritures de `project.json` dans le processus principal — c'est le seul écrivain, donc
une file par projet suffit et ne demande aucun verrou de système de fichiers. Vérifier ensuite que
`announce()` part **après** l'écriture, jamais avant.

Réutiliser le module d'écriture atomique de T-050 s'il est déjà passé ; sinon, le noter dans `STATE.md`
pour que T-050 récupère ce site.

## Terminé quand
- [ ] Deux fenêtres qui renomment deux scènes différentes en même temps : les deux renommages survivent
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(desktop): serialise writes to project.json across editor windows`
