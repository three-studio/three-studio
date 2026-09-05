# T-005 — Les listes permissives deviennent des `Record` totaux
Lot 0 · dépend de T-004 · statut: **TODO**

## Pourquoi
La liste des types de composants est écrite **neuf fois** dans le repo. Une seule est vérifiée par le
compilateur — `COMPONENT_SCHEMAS` (`editor/src/inspector/schema.ts:390`) — et c'est **parce qu'elle est
un `Record<ComponentType, …>` total**. Les autres sont des tableaux ou des `Partial<Record<…>>`, deux
formes où l'omission est légale et silencieuse.

Un type oublié dans l'une d'elles ne casse rien : il donne une icône générique, un objet non cliquable
dans le viewport, une entrée absente du menu Add. On le découvre en s'en servant.

## Quoi
Convertir les formes permissives en la forme totale que TypeScript vérifie déjà. **Aucun nouvel helper
de type** : `Record<ComponentType, X>` suffit, et c'est ce que le codebase fait déjà à un endroit.

| Aujourd'hui | Devient |
|---|---|
| `InspectorPanel.tsx:17` `ADDABLE: readonly ComponentType[]` | dérivé du registre — plus de liste du tout |
| `HierarchyPanel.tsx:96` `ICON_PRIORITY` | `Record<ComponentType, number>` — un ordre reste un ordre, et il est total |
| `markerStyles.ts:34` `STYLES: Partial<Record<…>>` | `Record<ComponentType, MarkerStyle \| null>` — le `null` est une décision, pas un oubli |
| `markerStyles.ts:22,32` `RENDERABLE`, `PRIORITY` | dérivés de ce `Record` |

Ne **pas** toucher :
- `COMPONENT_TYPES` (`core/src/scene/components.ts:21`) — l'omission y est déjà attrapée par le `throw`
  de `core/src/components/index.ts:39` et par `registry.test.ts`
- la `Map` de systèmes du `Reconciler` (`:77-83`) — elle part au lot 1, quand les systèmes
  s'enregistreront eux-mêmes ; `componentCoverage.test.ts` la couvre entre-temps

`markerStyles.ts:26-31` documente que l'ordre de `PRIORITY` diverge **volontairement** de
`ICON_PRIORITY` : « l'ordre est une décision sur *cet* affichage, pas sur les types ». Garder les deux
ordres et le commentaire. On rend les tables totales, on ne les fusionne pas.

## Fichiers
- `packages/editor/src/panels/InspectorPanel.tsx:17-28`
- `packages/editor/src/panels/HierarchyPanel.tsx:96-109`
- `packages/editor/src/viewport/overlay/markerStyles.ts:22,32,34`

## Terminé quand
- [ ] Ajouter un membre à l'union `ComponentDoc` produit une erreur de compilation à chacun de ces
      endroits (le vérifier, puis annuler)
- [ ] Les deux ordres de priorité restent distincts, commentaire compris
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the per-type tables become total, so a new type cannot be forgotten`
