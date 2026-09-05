# T-055 — Un environnement DOM, et des tests sur les panneaux qui portent de la logique
Lot 6 · dépend de T-054 · statut: **TODO**

## Pourquoi
Les **30 fichiers `.tsx`** de l'éditeur n'ont **aucun test**. Il n'y a ni jsdom, ni happy-dom, ni
`@testing-library` dans le repo. `test/prefabMode.test.ts:20` documente qu'on **contourne** l'absence
de pont.

L'absence était défendable tant que les panneaux ne portaient que de l'affichage. Ce n'est plus vrai :
`HierarchyPanel` fabrique son propre windowing (`:161-183`, avec `ROW_HEIGHT = 24` en dur pour
correspondre à une classe Tailwind `h-6`), et `InspectorPanel` tient une mémoïsation dont les
dépendances sont annotées de trois bugs historiques.

## Quoi
Ajouter l'environnement DOM, et **seulement** les tests des panneaux qui portent une décision — pas de
la couverture pour la couverture. Le fait que le viewport soit déjà testé sans DOM
(`overlay.test.ts`, 32 cas) montre où est la vraie frontière.

## Attention
Le repo a délibérément un seul `vitest.config.ts` en `environment: 'node'`. Ne pas basculer tout le
monde : les tests DOM se déclarent, le reste ne bouge pas.

## Terminé quand
- [ ] Le windowing de la hiérarchie est testé, et `ROW_HEIGHT` ne peut plus diverger de sa classe CSS
- [ ] Les tests node existants tournent inchangés
- [ ] `npm run typecheck && npm test` verts

## Commit
`test(editor): the panels that hold logic get tests`
