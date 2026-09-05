# T-057 — `expandedScene()` sort du rendu React
Lot 7 · dépend de T-056 · statut: **TODO**

## Pourquoi
`expandedScene()` est appelé **pendant le rendu** à huit endroits (`HierarchyPanel.tsx:137,149,228,366`,
`InspectorPanel.tsx:37,70,168`, `MenuBar.tsx:62`). C'est une mémo au niveau module, pas un hook : les
composants la lisent **sans s'y abonner** et comptent sur qu'un *autre* abonnement
(`structureRevision`, `prefabs`, `selection`) ait déclenché d'abord.

`state/derived.ts:14-25` nomme le problème et **renonce** à le corriger. C'est une correction en attente
d'un moment — et le lot 4 vient de rendre ces panneaux plus petits, donc le moment est là.

## Quoi
Un abonnement explicite. `derived.ts` est une primitive de mémoïsation de 60 lignes avec **un seul**
utilisateur (`expansion.ts:26`) : soit elle devient un vrai hook, soit elle disparaît au profit de ce
que zustand fait déjà.

## Terminé quand
- [ ] Aucun appel à `expandedScene()` pendant un rendu
- [ ] Modifier un prefab met à jour hiérarchie et Inspector sans dépendre d'un autre abonnement
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(editor): the expanded scene is subscribed to, not read during render`
