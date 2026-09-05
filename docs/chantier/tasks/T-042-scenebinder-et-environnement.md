# T-042 — `SceneBinder` rend l'environnement
Lot 4 · dépend de T-029 · statut: **TODO**

## Pourquoi
`SceneBinder.ts` (892 l.) se décrit comme « un coordinateur » (`:78-95`) et fait **onze métiers**.
Le plus gros et le plus séparable : **tout le sous-système environnement/IBL, ~280 lignes**
(`:334-662`) — deux slots (background / environment), un refcount d'`EnvironmentMap` par id d'asset,
une carte *pending* pour le décodage différé, l'échange différé avec contrôle de péremption
(`:603-624`), la libération (`:632-662`), les instances `Color`/`Fog`/`FogExp2` réutilisées, et
l'attache du ciel avec la capture de radiance.

## Quoi
Un `EnvironmentBinder`. `SceneBinder` garde la projection d'entités et lui délègue.

## Attention
`environmentScene` (`:353`) est un champ **unique** : un binder ne sert qu'une seule `Scene`. Cette
contrainte déménage avec le code, et elle doit rester visible — c'est elle qui a tué l'idée de partager
un binder entre l'éditeur et le moteur (voir `PLAN.md` § Pipeline unifié).

Les instances réutilisées (`:355-369`, `fogFor:484-499`) le sont parce que le backend WebGPU indexe la
reconstruction de nœuds sur l'**identité** de l'objet. Ne pas « nettoyer » en construisant du neuf.

`equirectangular` (`:501-560`) réimplémente la détection de disponibilité parce que
`HDRLoader`/`EXRLoader` renvoient un placeholder 1×1 que `PMREMNode` prend pour prêt et cache à jamais.
Le commentaire part avec le code.

## Terminé quand
- [ ] `SceneBinder` ne contient plus rien d'environnement/IBL
- [ ] Le test de parité (T-011) reste vert
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(runtime): the environment is its own binder`
