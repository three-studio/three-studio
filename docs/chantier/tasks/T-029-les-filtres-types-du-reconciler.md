# T-029 — Les trois filtres typés du `Reconciler` deviennent des capacités déclarées
Lot 1 · dépend de T-028 · statut: **TODO**

## Pourquoi
Après T-028 le `Reconciler` ne nomme plus de type dans sa **dispatch**, mais il en nomme encore trois
fois ailleurs :

- `meshHandles()` (`:222-228`) — `doc.type === 'mesh'`, ce que le batcher groupe
- `entitiesUsingMaterialAssets()` (`:241-255`) — `'mesh' | 'model'`
- `entitiesWithModels()` (`:258-266`) — `'model'`
- plus `whenLoaded()` (`:231-233`), câblé en dur sur `modelSystem`

Chacun est une **capacité** : « ce type est batchable », « ce type peut porter un matériau asset »,
« ce type charge de façon asynchrone ». Un type neuf qui a l'une d'elles ne le dira à personne.
Le commentaire de `:249` documente déjà la fois où ça a mordu : n'interroger que les meshes laissait
une modification de matériau partagé atteindre tous les cubes et aucun des modèles importés.

## Quoi
Les capacités se déclarent sur le système. Les trois parcours deviennent « tous les montés dont le
système déclare X », et `whenLoaded()` attend tous les systèmes asynchrones, pas seulement les modèles.

**Trois capacités, trois consommateurs qui existent aujourd'hui.** Ne pas en inventer une quatrième
« au cas où ».

## Terminé quand
- [ ] `Reconciler.ts` ne contient plus aucun `doc.type === …`
- [ ] Un second système asynchrone serait attendu par `whenLoaded()` sans toucher au `Reconciler`
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(runtime): batching, material assets and async loading are declared capabilities`
