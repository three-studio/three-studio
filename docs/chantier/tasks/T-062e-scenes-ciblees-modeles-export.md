# T-062e — Les scènes ciblées, les modèles, l'export
Lot 8 · dépend de T-062d · statut: **FAIT** · tranche 5/6 de **T-062**

## Quoi
Ce qui reste, et qui ne fait pas une famille à soi seul :
- **une scène nommée** : `openScene`, `openSceneInNewWindow`, `chooseStartScene` — une entrée de menu
  *par scène*, donc la cible que T-062b aura mise dans `EditorContext` sert une deuxième fois ;
- **les modèles** : `unpackModel` (`HierarchyPanel`) ;
- **l'export** : `runExport` (`PackageDialog`).

## Ce que les gardes ont donné
Chaque geste avait sa règle écrite chez son appelant, et deux fois pour les scènes :

- **`openScene`** portait `disabled: scene.shadowedBy !== null` dans le menu ; **`openSceneInNewWindow`**
  disait la même chose plus « pas la scène courante » dans un `.filter`, avec ses propres mots. Une
  formulation chacun pour une question commune — « cette scène est-elle ouvrable ? ».
- **`unpackModel`** : la hiérarchie calculait `unpackable` — trois conditions, dont
  `nodePath === ''`, que rien n'expliquait ailleurs. La constante disparaît ; le menu demande à la
  commande.
- **`runExport`** : le paramètre `profileId` **contredisait** l'intention du dialogue. `PackageDialog`
  écrit `active: activeId` sur disque d'abord — son commentaire dit « a build must be reproducible
  from what is on disk, not from what happened to be typed into a dialog » — puis rejouait la valeur
  du dialogue par-dessus le fichier écrit pour cette raison. Le paramètre est parti ; le main relit le
  projet et retombe sur `settings.build.active`, qui est maintenant le seul à décider.

## Terminé quand
- [x] Les cinq gestes passent par le registre. `EditorContext` gagne `sceneId`, avec ses trois
      appelants — la deuxième cible après `assetId`, comme la fiche l'annonçait
- [x] Les deux formulations de « cette scène est-elle ouvrable » deviennent une, et le sous-menu
      *Open in New Window* filtre sur `can()`
- [x] `unpackable` supprimé de `HierarchyPanel` ; `runExport` perd un paramètre qui contredisait
      l'intention de son appelant, avec une ligne `RESTES.md` pour le canal IPC qui le porte encore
- [x] Cassé pour vérifier : `openable` sans la règle `shadowedBy` → le test tombe
- [x] Vérifié dans l'application : menus Fichier et Scène inchangés, libellés désormais du registre.
      `renderer errors: none`
- [x] `npm run typecheck && npm test` verts — 985 tests

## Commit
`refactor(editor): the remaining gestures are commands`
