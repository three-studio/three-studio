# T-060 — Des mesures de référence
Lot 7 · dépend de T-059 · statut: **TODO**

## Pourquoi
Le lot 7 est le seul dont les résultats sont des nombres, et il n'y a pas de point de départ écrit.
`renderProbe.ts` (395 l.) existe et s'arme par `studio.probe.render` dans localStorage — l'outil est là,
la mesure ne l'est pas.

## Quoi
Une scène de référence (quelques milliers d'entités, un soleil ombré, de l'eau, un ciel) et un relevé
écrit : temps de frame, draw calls, triangles, taille des pools, mémoire GPU. En édition et en Play.

Le déposer dans `docs/chantier/` pour que les tâches suivantes s'y comparent.

## Terminé quand
- [ ] Le relevé existe, avec la machine et la version de three sur lesquelles il a été pris
- [ ] Reproductible : quelqu'un d'autre retrouve le même ordre de grandeur

## Commit
`docs: a performance baseline, so the next change can be compared to something`
