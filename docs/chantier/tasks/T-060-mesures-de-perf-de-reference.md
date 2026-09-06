# T-060 — Des mesures de référence
Lot 7 · dépend de T-059 · statut: **FAIT**

## Pourquoi
Le lot 7 est le seul dont les résultats sont des nombres, et il n'y a pas de point de départ écrit.
`renderProbe.ts` (395 l.) existe et s'arme par `studio.probe.render` dans localStorage — l'outil est là,
la mesure ne l'est pas.

> ⚠️ **`renderProbe` ne mesure pas la performance de rendu**, contrairement à ce que cette phrase
> laisse croire : c'est un compteur d'erreurs « Destroyed texture ». Déjà noté en T-056. La recette
> pour du temps de frame est dans la compétence `smoke-harness`, et c'est celle qui a servi.

## Quoi
Une scène de référence (quelques milliers d'entités, un soleil ombré, de l'eau, un ciel) et un relevé
écrit : temps de frame, draw calls, triangles, taille des pools, mémoire GPU. En édition et en Play.

Le déposer dans `docs/chantier/` pour que les tâches suivantes s'y comparent.

## Terminé quand
- [x] Le relevé existe, avec la machine et la version de three sur lesquelles il a été pris —
      `docs/chantier/PERF-BASELINE.md`
- [x] Reproductible : quelqu'un d'autre retrouve le même ordre de grandeur. La scène se refait par
      `baseline/make-scene.mjs`, la mesure par `baseline/measure.js` ; trois passages consécutifs
      donnent la même médiane à 0,1 ms près, et le relevé dit lesquels de ses nombres doivent être
      identiques au chiffre près et lesquels ne le seront qu'en ordre de grandeur
- [x] `npm run typecheck && npm test` verts — 975 tests

## Commit
`docs: a performance baseline, so the next change can be compared to something`
