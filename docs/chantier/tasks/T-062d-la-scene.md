# T-062d — Les gestes de scène entrent dans le registre
Lot 8 · dépend de T-062c · statut: **FAIT** · tranche 4/6 de **T-062**

## Quoi
> ⚠️ **Cette fiche annonçait cinq gestes ; un seul entre.** Elle a été écrite en listant les imports,
> sans lire les signatures. Vérifié : `addEntity(template)` prend le template construit au drop,
> `renameEntity(id, name)` le nom saisi, `reparentSelection(selection, parent, index)` la cible d'un
> glisser-déposer, `addComponentWithDependencies(id, type)` le type choisi dans un menu. **Ce sont des
> valeurs, pas des cibles** — seul l'appelant qui les a produites pourrait les fournir.

Il reste **un** geste : `setEntityVisible`, sous la forme d'un `toggleVisibility` — « masque-le » ne
demande qu'une cible. Le bouton œil de la hiérarchie y passe.

Le vrai livrable est donc la **frontière**, écrite en tête de `sceneCommands.ts`.

## La frontière, corrigée
« Ce qu'un auteur peut demander sans argument » était approximatif : `deleteAsset` prend une cible et
est une commande. Le test est **quel genre** d'argument :

- une **cible** — quelle entité, quel asset — le contexte peut la porter, donc un menu, une touche ou
  une palette peut la fournir. C'est une commande.
- une **valeur** — le nom tapé, le point du drop, le type choisi, le parent et l'index d'un glisser —
  n'est connue que de l'appelant. Rien d'autre ne pourrait la dispatcher, donc une entrée de registre
  serait une enveloppe autour d'un seul site d'appel.

Le reste de `sceneCommands.ts` — `setTransform`, `transformSelection`, `setComponentNestedField`,
`setEnvironmentField`, `setSkyField`, `setLinkedMaterialField` — est du côté valeur, et le gizmo en
appelle certains soixante fois par seconde.

## Terminé quand
- [x] Le seul geste qui en est un — `toggleVisibility` — passe par le registre, avec un libellé qui
      bascule Hide/Show et un `can()` qui interroge la capacité `toggleVisible`
- [x] La frontière est écrite en tête de `sceneCommands.ts`, là où quelqu'un la cherchera, et résumée
      dans le « what is not here » de `registry.ts`
- [x] Trouvé en chemin et inscrit dans `RESTES.md` : **`setEntityLocked` n'a aucun appelant** et aucun
      `.tsx` ne mentionne `locked` — rien ne permet de verrouiller une entité, alors que le verrou
      fonctionne partout ailleurs
- [x] `npm run typecheck && npm test` verts — 984 tests

## Commit
`refactor(editor): the scene gestures are commands`
