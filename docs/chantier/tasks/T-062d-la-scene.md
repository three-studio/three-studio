# T-062d — Les gestes de scène entrent dans le registre
Lot 8 · dépend de T-062c · statut: **TODO** · tranche 4/6 de **T-062**

## Quoi
Les cinq gestes de `sceneCommands.ts` appelés depuis React : `addEntity` (`ViewportPanel`),
`renameEntity`, `setEntityVisible`, `reparentSelection` (`HierarchyPanel`),
`addComponentWithDependencies` (`InspectorPanel`).

## Ce qui n'entre pas, et pourquoi le dire ici
Le reste de `sceneCommands.ts` — `setTransform`, `transformSelection`, `setComponentNestedField`,
`setEnvironmentField`, `setSkyField`, `setLinkedMaterialField` — est appelé par le gizmo et par
l'Inspector Tweakpane, **avec des arguments, parfois soixante fois par seconde**. Ce sont des
mutations paramétrées, pas des gestes qu'une palette pourrait lancer : `setEnvironmentField('fogNear',
30)` n'a pas de `run(ctx)`. Le critère de T-062 est « aucun geste appelé depuis **React** », et aucun
`.tsx` ne les appelle.

À écrire dans le commit plutôt qu'à laisser deviner : la frontière n'est pas « tout ce qui est dans
`commands/` », c'est « ce qu'un auteur peut demander sans argument ».

## Terminé quand
- [ ] Les cinq gestes passent par le registre
- [ ] La frontière « geste » / « mutation paramétrée » est écrite quelque part de durable
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the scene gestures are commands`
