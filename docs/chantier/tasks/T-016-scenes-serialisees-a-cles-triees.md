# T-016 — Les scènes se sérialisent à clés triées
Lot 9 · dépend de T-002 · statut: **TODO**

## Pourquoi
`serializeScene` est `JSON.stringify(scene, null, 2)` (`core/src/scene/serialization.ts:21`). L'ordre
des clés suit l'ordre d'insertion, donc **l'historique d'édition**. `putComponent`
(`scene/components.ts:145`) ajoute avec `??=`, donc l'ordre des composants d'une entité dépend de
l'ordre dans lequel l'auteur les a ajoutés.

Résultat : bouger une entité peut produire un diff qui touche des lignes sans rapport, et deux machines
peuvent écrire deux fichiers différents pour le même document. C'est la condition qui manque pour qu'un
projet vive dans git — et c'est le préalable à tout le reste du lot 9.

## Quoi
Trier les clés à l'écriture. Un `replacer` de `JSON.stringify` qui trie les clés d'objet suffit ;
attention à **ne pas** trier les tableaux, dont l'ordre est porteur (`rootOrder`, `children`, et tout
`Vec3`).

## Fichiers
- `packages/core/src/scene/serialization.ts:21`
- au besoin, la même chose pour les prefabs et les matériaux, qui passent par les mêmes écritures

## Terminé quand
- [ ] Sérialiser deux documents équivalents construits dans des ordres différents donne des chaînes
      **identiques** — c'est le test à écrire
- [ ] Les tableaux gardent leur ordre (test sur `rootOrder` et `children`)
- [ ] Ouvrir un projet existant, sauver sans rien changer, puis `git diff` : le diff est une
      réorganisation unique et ensuite stable
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(core): scenes serialise with sorted keys, so a diff is reviewable`
