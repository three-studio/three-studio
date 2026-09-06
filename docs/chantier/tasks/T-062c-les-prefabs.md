# T-062c — Les prefabs entrent dans le registre
Lot 8 · dépend de T-062b · statut: **FAIT** · tranche 3/6 de **T-062**

## Quoi
Huit gestes, tous appelés depuis `HierarchyPanel.tsx` et `InspectorPanel.tsx` :
`createPrefabFromEntity`, `createPrefabVariant`, `instantiatePrefab`, `applyInstanceOverrides`,
`revertInstanceOverrides`, `revertEntityOverride`, `selectPrefabInstances`, `unpackPrefabInstance`.

`instanceInfo` et `overridesOf` sont des **lecteurs**, pas des gestes : ils restent des fonctions.

## Vérifié : ce n'était plus vrai, et les deux côtés ne s'accordaient pas
« Decided in exactly one place » est faux. Quatre gestes sont décidés **deux fois** — le menu
contextuel de la hiérarchie et le schéma d'Inspector du composant `prefabInstance` — et les deux
divergeaient :

| | Hiérarchie | Inspector |
|---|---|---|
| Apply Overrides | grisé sans override | **bouton actif, clic sans effet** |
| Revert Overrides | grisé sans override | **bouton actif, clic sans effet** |
| Show in Project | grisé si le prefab manque | **actif, clic avalé** |
| Unpack · Select All Instances | grisé en multi-sélection | **aucun verdict** |

**Et une cinquième, trouvée en chemin : il y avait deux façons de révéler un asset, chacune faisant la
moitié du travail.** `revealAsset` vidait dossier et filtres et amenait le panneau devant, sans jamais
poser `revealed` — donc ni surlignage ni défilement. `assetStore.reveal` posait `revealed` et
n'amenait pas le panneau devant — depuis un onglet Project caché derrière un autre, le bouton ne
faisait rien de visible. Le geste appelle maintenant le store et ajoute la seule moitié qui n'est pas
la sienne ; trois lignes qui en étaient une copie disparaissent.

`instantiatePrefab` **n'entre pas** : il est appelé avec le point où le drop a atterri, donc c'est une
mutation paramétrée. Même frontière que le reste de la couche.

## Terminé quand
- [x] Sept gestes passent par le registre, avec un libellé et un `can()` réel. Le huitième,
      `instantiatePrefab`, est une mutation paramétrée — dit ci-dessus
- [x] Le motif de l'exclusion est écrit là où il a été trouvé faux, en tête de la table dans
      `prefabCommands.ts`
- [x] Le libellé porte le compte d'instances, donc le bouton de l'Inspector l'a maintenant lui aussi —
      il ne l'avait jamais eu
- [x] Cassé pour vérifier : `can()` sans la garde d'overrides → le test tombe
- [x] Ce qui n'a pas été fait — les boutons de l'Inspector refusent mais ne sont pas *dessinés*
      grisés — est dans `RESTES.md` avec sa raison (T-057)
- [x] `npm run typecheck && npm test` verts — 982 tests

## Commit
`refactor(editor): the prefab gestures are commands`
