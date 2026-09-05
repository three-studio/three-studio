# T-006 — Le smoke harness tourne en CI
Lot 0 · dépend de T-005 · statut: **TODO**

## Pourquoi
`apps/desktop/src/main/smoke.ts` boote toute la pile sans tête, rapporte ce que le renderer a
réellement peint, et sort. C'est le **seul** bout-en-bout du repo — il n'y a ni Playwright, ni
Spectron. Et il **ne tourne jamais en CI** : `.github/workflows/ci.yml` fait `typecheck` puis `test`,
rien d'autre.

Une fenêtre blanche et une fenêtre qui marche sont identiques dans un log de build. Le chantier va
bouger le pipeline de rendu (lot 2) : sans ce filet, une régression de rendu passe.

## Quoi
Ajouter un job CI qui lance le harness sur un projet jetable, avec un GPU logiciel
(`xvfb-run` + swiftshader/llvmpipe sur ubuntu), et échoue si le probe rapporte une erreur renderer ou
un canvas de taille nulle.

## Attention
`.claude/skills/smoke-harness/SKILL.md` est le mode d'emploi et il liste des pièges qui coûtent cher :
**ne jamais** le lancer en arrière-plan, **ne jamais** le piper dans `head` (le SIGPIPE orpheline
Electron et laisse une fenêtre à l'écran), **ne jamais** le pointer sur un vrai projet utilisateur.
Le lire avant d'écrire le job.

Variables : `STUDIO_SMOKE=1`, `STUDIO_SMOKE_PROJECT=<dir>`, `STUDIO_SMOKE_SETUP=<js>`,
`STUDIO_SMOKE_SETTLE=<ms>` (défaut 800), `STUDIO_SMOKE_SHOT=<png>`.
`STUDIO_SMOKE` change trois comportements de production : pas d'invite de sauvegarde
(`windows.ts:337,404`), pas d'écriture des récents (`recentProjects.ts:54`), et `beginQuit()` avant
`app.exit()`.

## Terminé quand
- [ ] Le job passe sur une PR
- [ ] Casser volontairement le rendu (par exemple ne plus appeler `renderer.render`) le fait échouer
- [ ] Le job publie la capture en artefact, pour qu'un échec soit regardable

## Commit
`ci: boot the whole stack headless, because a blank window looks like a working one in a log`
