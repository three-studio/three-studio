# T-007 — La forme de l'Inspector se dérive du schéma qu'il construit
Lot 3 (avancée) · dépend de T-002 · autonome · statut: **TODO**

## Pourquoi
C'est la moitié « l'Inspector répond mal » du symptôme rapporté, et elle se corrige seule.

`buildInspector.ts:401-460` contient `inspectorSignature()` : un `switch` à 9 bras qui **réécrit à la
main** chaque prédicat `visibleWhen` déclaré dans `schema.ts`. Il finit sur
`default: return component.type` (`:456`). Un type de composant dont le champ structurant n'est pas
nommé dans ce `switch` **ne reconstruit jamais son panneau** : les valeurs se rafraîchissent, les lignes
conditionnelles n'apparaissent pas.

Le miroir a **déjà divergé**, deux fois :

- `sceneSignature` (`schema.ts:1279-1297`) a la même trappe un cran plus haut : il liste quatre champs
  d'environnement à la main et **rate `section.visibleWhen`**, que `buildScene` consulte pourtant
  (`buildInspector.ts:135`).
- Sur une lumière `rectArea`, `castShadow` est lui-même conditionnel (`schema.ts:633` — « three n'a
  aucun chemin d'ombre pour elle, la case serait un mensonge »), et la signature écrite à la main
  interpole `component.castShadow` quoi qu'il arrive.

## Quoi
La structure d'un panneau ne dépend que d'une chose : **quelles lignes sont visibles**. La signature
*est* cet ensemble, et elle se dérive de la déclaration que le constructeur lit déjà.

1. **Extraire la liste, une fois.** `buildComponent` déplie les entrées dynamiques en ligne
   (`buildInspector.ts:268-271`). Déplacer ça dans `schema.ts`, sous une fonction qui renvoie aussi sa
   propre identité :

   ```ts
   export function paneEntriesFor(component: ComponentDoc): {
     key: string;   // 'mesh:box', 'script:PlayerMove', sinon component.type
     entries: readonly Exclude<PaneEntry, GeometrySlotSpec>[];
   }
   ```

   La `key` nomme les deux endroits où c'est la *liste* qui varie et non la visibilité d'une ligne : la
   géométrie d'un mesh, et les propriétés déclarées par un script.

2. **Une fonction de forme, partagée par les deux panneaux** — nouveau fichier
   `packages/editor/src/inspector/signature.ts` :

   ```ts
   export function shapeOf<S>(
     entries: readonly { visibleWhen?: (subject: S) => boolean }[],
     subject: S,
   ): string {
     let shape = '';
     for (const entry of entries) shape += entry.visibleWhen?.(subject) === false ? '0' : '1';
     return shape;
   }
   ```

   **Une chaîne de bits, pas une liste de chemins** — et ce n'est pas cosmétique : voir Performance.

3. **Les deux signatures se réduisent à ça.** `inspectorSignature` devient une boucle sur
   `componentsOf`, chacune donnant `` `${key}/${shapeOf(entries, effective)}` ``. `sceneSignature`
   devient la même expression sur `SCENE_SCHEMA`, en incluant cette fois le prédicat de section que la
   version manuelle n'a jamais eu.

4. **La révision de script sort de là.** `buildInspector.ts:454` lit
   `useScriptStore.getState().revision` depuis l'intérieur d'un `switch`. Sa place est à côté des autres
   révisions dans `InspectorPanel.tsx:92-105`, qui s'abonne déjà à `scriptRevision` (`:81`) uniquement
   comme dépendance de `useMemo`.

## Attention
`sceneSignature` prend aujourd'hui un `EnvironmentDef` (`schema.ts:1283`) pour que l'identité immer le
garde bon marché, et `InspectorPanel.tsx:34` s'abonne à `s.scene.environment` pour la même raison. Mais
les prédicats de `SCENE_SCHEMA` sont typés `(subject: SceneDoc)`. Élargir coûterait l'optimisation
d'identité : garder le paramètre en `EnvironmentDef` et construire le prête-nom `{ environment }`.
Les prédicats ne lisent que `scene.environment.*` (vérifié : `schema.ts:1262`, `:1271`). **Le
commenter** — c'est une contrainte réelle sur les futurs prédicats du panneau de scène.

## Fichiers
- nouveau : `packages/editor/src/inspector/signature.ts`
- `packages/editor/src/inspector/schema.ts` — `paneEntriesFor`, `sceneSignature:1279-1297`
- `packages/editor/src/inspector/buildInspector.ts` — le `switch` `:401-460` **supprimé**, `:268-271`
  lit `paneEntriesFor`
- `packages/editor/src/panels/InspectorPanel.tsx:95` — gagne `#${scriptRevision}`
- nouveau : `packages/editor/test/inspectorSignature.test.ts`

## Performance
Pire cas : `InspectorPanel.tsx:104`, 40 entités sélectionnées × ~40 entrées = 1600 prédicats, une fois
par bump de `componentRevision` — donc une fois par frame de drag de slider (déjà accepté aujourd'hui,
voir le commentaire à `:99-115`). Chaque prédicat est un `===` et un `includes` sur au plus quatre
chaînes : de l'ordre de 100 µs, contre un refresh Tweakpane qui coûte davantage. **C'est l'encodage en
bits qui rend ça vrai** — joindre des chemins allouerait ~40 Ko par frame.

## Terminé quand
- [ ] Le `switch` à 9 bras et son `default:` n'existent plus
- [ ] Tests : aucun type de composant ne tombe dans un cas par défaut ; chaque `kind` de lumière donne
      une forme distincte ; basculer `castShadow` change la forme ; passer une eau en `Custom` change la
      forme ; les trois `backgroundMode` du panneau de scène donnent trois signatures distinctes
- [ ] À la main : changer le `kind` d'une lumière, la projection d'une caméra, la forme d'un collider,
      le `sunSource` d'une eau — le panneau se reconstruit à chaque fois
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): derive the inspector's shape from the schema it builds from`
