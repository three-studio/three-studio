# T-033 — Toutes les scènes sous `scenes/<id>.json`
Lot 10 · dépend de T-032 · statut: **TODO**

## Pourquoi
La scène d'entrée est renommée en `scene.json` à la racine du build pendant que les autres vont dans
`scenes/` (`exportWeb.ts:210`). Cette asymétrie coûte **trois fonctions** :

- `sceneMap`, qu'il faut clé **et par nom et par id** (`:222-224`), parce qu'un script peut tenir l'un
  ou l'autre
- `loadingSceneName()` (`:301-304`), qui re-résout un id en nom « parce que le fichier est censé être
  lisible »
- `sceneFileName()` (`:307`)

Un build n'est pas fait pour être édité à la main. L'id gagne.

## Quoi
Toutes les scènes sous `scenes/<sceneId>.json`, adressées par id partout. `sceneMap`,
`loadingSceneName()` et `sceneFileName()` disparaissent. `ADR-15` — une référence est un id, jamais un
nom ni un chemin — s'applique enfin jusqu'au bout de la chaîne.

Un script qui appelle `scenes.go('Level2')` par **nom** doit continuer à marcher : le manifeste garde
une table nom → id, ce qui est une table d'alias et non un second adressage.

## Terminé quand
- [ ] Aucun `scene.json` à la racine du build
- [ ] Un script nommant une scène par son nom fonctionne toujours
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(export): every scene is scenes/<id>.json, addressed by id`
