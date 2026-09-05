# T-058 — Le fork `WaterSurface` et le monkey-patch de `StudioTime`, revus
Lot 7 · dépend de T-057 · statut: **TODO**

## Pourquoi
Trois endroits où l'on se bat contre three, chacun justifié quand il a été écrit, chacun à revérifier
contre la version visée :

- `WaterSurface.ts` — un **fork maintenu de 298 lignes** de `WaterMesh.js`, parce que quatre de ses
  paramètres ne sont réglables qu'à la construction (`:36-50`)
- `StudioTime.install()` (`time/StudioTime.ts:17-30`) — **remplace les singletons TSL** `time` et
  `deltaTime` de three, parce que `Node.onUpdate` *remplace* au lieu d'ajouter. C'est ce qui fait que
  Pause et le timescale arrêtent l'eau et le ciel en même temps que la physique : ça vaut son prix, mais
  le prix doit être connu
- `patches/three+0.185.1.patch` — `FBXLoader` lit `LayerElementNormal[0].Normals` sans vérifier qu'il
  est là, et le throw perd **tout le fichier** plutôt qu'une couche vide

## Quoi
Pour chacun : vérifier si l'amont a bougé, et **remonter le correctif chez three** quand c'est
recevable. Sinon, dater la vérification dans le commentaire pour que la prochaine revue sache d'où elle
part.

## Terminé quand
- [ ] Les trois sont vérifiés contre la version de three visée, avec la date écrite
- [ ] Ce qui peut remonter chez three a une issue ou une PR ouverte
- [ ] `npm run typecheck && npm test` verts

## Commit
`chore(runtime): re-check what we fork and patch in three, and date the answer`
